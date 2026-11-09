//=============================================================================
// PokéMZ - tools/lib/png.js
//=============================================================================

/**
 * @file Dependency-free PNG codec for the sprite tools (Node, zlib).
 *
 * Decodes every standard PNG (gray, RGB, indexed, gray+alpha, RGBA; bit
 * depths 1-16; PLTE + tRNS; Adam7 interlacing) and encodes indexed PNGs
 * (1/2/4/8 bpp) with a PLTE, which is what GBA-style sprites need. Output is
 * deterministic (same pixels -> same bytes) so file hashes are stable.
 */

"use strict";

const zlib = require("zlib");

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @brief Channels per pixel for each PNG color type. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** @brief Adam7 passes: [x0, y0, dx, dy]. */
const ADAM7 = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2]
];

//-----------------------------------------------------------------------------
// CRC
//-----------------------------------------------------------------------------

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        t[n] = c;
    }
    return t;
})();

/**
 * @brief CRC-32 of a buffer (PNG chunk checksum).
 * @param {Buffer} buf Bytes.
 * @return {number} Unsigned CRC.
 */
function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ -1) >>> 0;
}

//-----------------------------------------------------------------------------
// Decoding
//-----------------------------------------------------------------------------

/**
 * @brief Paeth predictor.
 * @param {number} a Left.
 * @param {number} b Up.
 * @param {number} c Up-left.
 * @return {number} Predicted byte.
 */
function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) {
        return a;
    }
    return pb <= pc ? b : c;
}

/**
 * @brief Undoes the scanline filters of one (sub)image.
 * @param {Buffer} data Inflated bytes.
 * @param {number} offset Start offset in data.
 * @param {number} width Image width in pixels.
 * @param {number} height Image height in pixels.
 * @param {number} bpp Bits per pixel.
 * @return {{rows: Array<Uint8Array>, end: number}} Unfiltered rows and the
 *         offset after the last row.
 * @throws {Error} On unknown filter types or truncated data.
 */
function unfilter(data, offset, width, height, bpp) {
    const stride = Math.ceil((width * bpp) / 8);
    const step = Math.max(1, bpp >> 3);
    const rows = [];
    let prev = new Uint8Array(stride);
    let o = offset;
    for (let y = 0; y < height; y++) {
        if (o + 1 + stride > data.length) {
            throw new Error("truncated image data");
        }
        const type = data[o++];
        const row = new Uint8Array(data.subarray(o, o + stride));
        o += stride;
        for (let i = 0; i < stride; i++) {
            const a = i >= step ? row[i - step] : 0;
            const b = prev[i];
            const c = i >= step ? prev[i - step] : 0;
            switch (type) {
                case 0:
                    break;
                case 1:
                    row[i] = (row[i] + a) & 0xff;
                    break;
                case 2:
                    row[i] = (row[i] + b) & 0xff;
                    break;
                case 3:
                    row[i] = (row[i] + ((a + b) >> 1)) & 0xff;
                    break;
                case 4:
                    row[i] = (row[i] + paeth(a, b, c)) & 0xff;
                    break;
                default:
                    throw new Error(`bad filter type ${type}`);
            }
        }
        rows.push(row);
        prev = row;
    }
    return { rows, end: o };
}

/**
 * @brief Reads one sample from an unfiltered row.
 * @param {Uint8Array} row Row bytes.
 * @param {number} i Sample index in the row.
 * @param {number} depth Bit depth.
 * @return {number} Sample value.
 */
function sample(row, i, depth) {
    if (depth === 8) {
        return row[i];
    }
    if (depth === 16) {
        return (row[i * 2] << 8) | row[i * 2 + 1];
    }
    const perByte = 8 / depth;
    const byte = row[Math.floor(i / perByte)];
    const shift = 8 - depth * ((i % perByte) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
}

/**
 * @brief Decodes a PNG file.
 * @param {Buffer} buf File bytes.
 * @return {{width: number, height: number, colorType: number,
 *          bitDepth: number, rgba: Uint8Array, indices: ?Uint8Array,
 *          palette: ?Array<Array<number>>, trns: ?Array<number>}}
 *         RGBA pixels (8 bits per channel); for indexed images also the
 *         palette indices and the PLTE colors.
 * @throws {Error} When the file is not a valid PNG.
 */
function decode(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
        throw new Error("not a PNG file");
    }
    let o = 8;
    let ihdr = null;
    let palette = null;
    let trns = null;
    const idat = [];
    while (o + 8 <= buf.length) {
        const len = buf.readUInt32BE(o);
        const type = buf.toString("latin1", o + 4, o + 8);
        const data = buf.subarray(o + 8, o + 8 + len);
        if (data.length !== len) {
            throw new Error(`truncated ${type} chunk`);
        }
        o += 12 + len;
        if (type === "IHDR") {
            ihdr = {
                width: data.readUInt32BE(0),
                height: data.readUInt32BE(4),
                bitDepth: data[8],
                colorType: data[9],
                interlace: data[12]
            };
        } else if (type === "PLTE") {
            palette = [];
            for (let i = 0; i + 2 < data.length; i += 3) {
                palette.push([data[i], data[i + 1], data[i + 2]]);
            }
        } else if (type === "tRNS") {
            trns = Array.from(data);
        } else if (type === "IDAT") {
            idat.push(data);
        } else if (type === "IEND") {
            break;
        }
    }
    if (!ihdr) {
        throw new Error("missing IHDR");
    }
    const { width, height, bitDepth, colorType, interlace } = ihdr;
    const channels = CHANNELS[colorType];
    if (!channels) {
        throw new Error(`unsupported color type ${colorType}`);
    }
    if (colorType === 3 && !palette) {
        throw new Error("indexed PNG without PLTE");
    }
    const bpp = channels * bitDepth;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const rgba = new Uint8Array(width * height * 4);
    const indices = colorType === 3 ? new Uint8Array(width * height) : null;
    const max = (1 << bitDepth) - 1;
    const to8 = v => (bitDepth === 16 ? v >> 8 : Math.round((v * 255) / max));
    const trnsKey =
        trns && colorType === 0 ? (trns[0] << 8) | trns[1] : null;
    const trnsRgb =
        trns && colorType === 2
            ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]]
            : null;

    /** @brief Writes the pixel at sample x of row into image (px, py). */
    const put = (row, x, px, py) => {
        const p = py * width + px;
        const q = p * 4;
        if (colorType === 3) {
            const i = sample(row, x, bitDepth);
            const c = palette[i] || [0, 0, 0];
            indices[p] = i;
            rgba[q] = c[0];
            rgba[q + 1] = c[1];
            rgba[q + 2] = c[2];
            rgba[q + 3] = trns && i < trns.length ? trns[i] : 255;
        } else if (colorType === 0 || colorType === 4) {
            const v = sample(row, x * channels, bitDepth);
            const g = to8(v);
            rgba[q] = rgba[q + 1] = rgba[q + 2] = g;
            if (colorType === 4) {
                rgba[q + 3] = to8(sample(row, x * channels + 1, bitDepth));
            } else {
                rgba[q + 3] = trnsKey !== null && v === trnsKey ? 0 : 255;
            }
        } else {
            const r = sample(row, x * channels, bitDepth);
            const g = sample(row, x * channels + 1, bitDepth);
            const b = sample(row, x * channels + 2, bitDepth);
            rgba[q] = to8(r);
            rgba[q + 1] = to8(g);
            rgba[q + 2] = to8(b);
            if (colorType === 6) {
                rgba[q + 3] = to8(sample(row, x * channels + 3, bitDepth));
            } else {
                rgba[q + 3] =
                    trnsRgb && r === trnsRgb[0] && g === trnsRgb[1] && b === trnsRgb[2] ? 0 : 255;
            }
        }
    };

    if (interlace) {
        let off = 0;
        for (const [x0, y0, dx, dy] of ADAM7) {
            const w = Math.ceil((width - x0) / dx);
            const h = Math.ceil((height - y0) / dy);
            if (w <= 0 || h <= 0) {
                continue;
            }
            const { rows, end } = unfilter(raw, off, w, h, bpp);
            off = end;
            rows.forEach((row, y) => {
                for (let x = 0; x < w; x++) {
                    put(row, x, x0 + x * dx, y0 + y * dy);
                }
            });
        }
    } else {
        const { rows } = unfilter(raw, 0, width, height, bpp);
        rows.forEach((row, y) => {
            for (let x = 0; x < width; x++) {
                put(row, x, x, y);
            }
        });
    }
    return { width, height, colorType, bitDepth, rgba, indices, palette, trns };
}

//-----------------------------------------------------------------------------
// Encoding
//-----------------------------------------------------------------------------

/**
 * @brief Builds one PNG chunk.
 * @param {string} type Four-letter chunk type.
 * @param {Buffer} data Chunk data.
 * @return {Buffer} Chunk bytes (length, type, data, CRC).
 */
function chunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
}

/**
 * @brief Encodes an indexed PNG.
 * @param {Object} img Image.
 * @param {number} img.width Width.
 * @param {number} img.height Height.
 * @param {Uint8Array} img.indices Palette index per pixel.
 * @param {Array<Array<number>>} img.palette PLTE colors ([r, g, b]).
 * @param {Object} [o] Options.
 * @param {number} [o.bitDepth] 1, 2, 4 or 8 (default: smallest that fits
 *        the palette, at least 4 so GBA sprites stay 4bpp).
 * @param {Array<number>} [o.trns] Alpha per palette index (tRNS chunk).
 * @return {Buffer} PNG bytes.
 * @throws {Error} When an index does not fit the bit depth.
 */
function encodeIndexed(img, o = {}) {
    const { width, height, indices, palette } = img;
    const depth = o.bitDepth || (palette.length <= 16 ? 4 : 8);
    if (![1, 2, 4, 8].includes(depth)) {
        throw new Error(`bad bit depth ${depth}`);
    }
    const max = (1 << depth) - 1;
    const stride = Math.ceil((width * depth) / 8);
    const raw = Buffer.alloc((stride + 1) * height);
    const perByte = 8 / depth;
    for (let y = 0; y < height; y++) {
        const base = y * (stride + 1);
        raw[base] = 0; // filter: none (indexed art compresses fine without)
        for (let x = 0; x < width; x++) {
            const v = indices[y * width + x];
            if (v > max) {
                throw new Error(`index ${v} does not fit ${depth} bpp`);
            }
            const shift = 8 - depth * ((x % perByte) + 1);
            raw[base + 1 + Math.floor(x / perByte)] |= v << shift;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = depth;
    ihdr[9] = 3;
    const plte = Buffer.alloc(palette.length * 3);
    palette.forEach((c, i) => {
        plte[i * 3] = c[0];
        plte[i * 3 + 1] = c[1];
        plte[i * 3 + 2] = c[2];
    });
    const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("PLTE", plte)];
    if (o.trns && o.trns.length) {
        parts.push(chunk("tRNS", Buffer.from(o.trns)));
    }
    parts.push(chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)));
    return Buffer.concat(parts);
}

/**
 * @brief Encodes an 8-bit RGBA PNG (used for tests and previews).
 * @param {{width: number, height: number, rgba: Uint8Array}} img Image.
 * @return {Buffer} PNG bytes.
 */
function encodeRGBA(img) {
    const { width, height, rgba } = img;
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        SIGNATURE,
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

module.exports = { decode, encodeIndexed, encodeRGBA, crc32 };
