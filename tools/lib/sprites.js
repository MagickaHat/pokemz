//=============================================================================
// PokéMZ - tools/lib/sprites.js
//=============================================================================

/**
 * @file Sprite formatting and palette harmonizing engine (pure: no file
 *       system access, so it can be unit-tested with in-memory buffers).
 *
 * A "unit" is one folder of img/pokemon/ holding sprites (a species, a form
 * sub-folder, an egg folder, question_mark). Every sprite of a unit is
 * rewritten as a 4bpp indexed PNG whose PLTE is the unit's normal.pal, so the
 * runtime shiny swap of PokeMZ_PBS_Graphics.js (match normal.pal color ->
 * use shiny.pal color at the same index) works for battlers, icons and
 * overworld sheets alike.
 *
 * GBA rules: 16 colors, index 0 is the transparent key, 1-15 are free, and
 * colors are 15-bit (5 bits per channel, stored as (c >> 3) << 3).
 */

"use strict";

const PNG = require("./png.js");
const Runtime = require("../../game/js/plugins/PokeMZ_PBS_Graphics.js");

/** @brief Bump to invalidate every build cache entry. */
const VERSION = 1;

/** @brief Colors per GBA palette (index 0 = transparent). */
const PAL_SIZE = 16;

/** @brief Key color used for index 0 when a palette has to be derived. */
const DEFAULT_KEY = [248, 0, 248];

/** @brief Sprite files by name: canvas layout of each view. */
const VIEWS = {
    "front.png": { view: "front", cols: 1, rows: 1, frame: [96, 96] },
    "back.png": { view: "back", cols: 1, rows: 1, frame: [96, 96] },
    "frontf.png": { view: "front", cols: 1, rows: 1, frame: [96, 96] },
    "backf.png": { view: "back", cols: 1, rows: 1, frame: [96, 96] },
    "icon.png": { view: "icon", cols: 1, rows: 2, frame: [32, 32] },
    "overworld.png": { view: "overworld", cols: 3, rows: 4, frame: null },
    "overworldf.png": { view: "overworld", cols: 3, rows: 4, frame: null }
};

/** @brief Sprite files that must exist, by unit kind. */
const REQUIRED = {
    species: ["front.png", "back.png", "icon.png"],
    form: [],
    egg: ["front.png", "icon.png"],
    special: ["front.png", "icon.png"]
};

/** @brief Folder names that are not species. */
const SPECIAL_UNITS = { egg: "egg", question_mark: "special" };

//-----------------------------------------------------------------------------
// Colors and palettes
//-----------------------------------------------------------------------------

/**
 * @brief Snaps a channel to GBA 5-bit depth (pokeemerald's (c >> 3) << 3).
 * @param {number} c 8-bit channel.
 * @return {number} Snapped channel.
 */
const snap = c => (c >> 3) << 3;

/**
 * @brief Snaps a color to 15-bit.
 * @param {Array<number>} c [r, g, b].
 * @return {Array<number>} Snapped color.
 */
const snapColor = c => [snap(c[0]), snap(c[1]), snap(c[2])];

/**
 * @brief 15-bit key of a color (equal keys = same color on the GBA, and the
 *        same match in the runtime's 5-bit fallback).
 * @param {Array<number>} c [r, g, b].
 * @return {number} Key.
 */
const key15 = c => ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3);

/**
 * @brief Formats a color for messages.
 * @param {Array<number>} c [r, g, b].
 * @return {string} "r g b".
 */
const fmt = c => (c ? c.join(" ") : "-");

/**
 * @brief Parses a JASC-PAL file (the runtime parser).
 * @param {string} text File text.
 * @return {Array<Array<number>>} Colors.
 * @throws {Error} When the text is not a JASC palette.
 */
function parsePal(text) {
    const pal = Runtime.parseJascPal(text);
    for (const c of pal) {
        if (c.length !== 3 || c.some(v => !Number.isInteger(v) || v < 0 || v > 255)) {
            throw new Error(`bad color "${c.join(" ")}"`);
        }
    }
    return pal;
}

/**
 * @brief Writes a JASC-PAL file.
 * @param {Array<Array<number>>} pal Colors.
 * @return {string} File text (LF line endings, like the existing files).
 */
function writePal(pal) {
    return ["JASC-PAL", "0100", String(pal.length), ...pal.map(fmt)].join("\n") + "\n";
}

/**
 * @brief Snaps a palette to 15-bit and pads it to 16 entries.
 * @param {Array<Array<number>>} pal Colors.
 * @return {{pal: Array<Array<number>>, snapped: number}} Palette and how
 *         many colors changed.
 */
function normalizePalette(pal) {
    let snapped = 0;
    const out = pal.slice(0, PAL_SIZE).map(c => {
        const s = snapColor(c);
        if (s[0] !== c[0] || s[1] !== c[1] || s[2] !== c[2]) {
            snapped++;
        }
        return s;
    });
    while (out.length < PAL_SIZE) {
        out.push([0, 0, 0]);
    }
    return { pal: out, snapped };
}

/**
 * @brief Builds a palette from decoded sprites when a unit has no
 *        normal.pal: the PLTE of the first indexed sprite, else the opaque
 *        colors by frequency behind a transparent key.
 * @param {Array<{name: string, img: Object}>} sprites Decoded sprites,
 *        most authoritative first (front.png).
 * @return {{pal: ?Array<Array<number>>, source: string, error: ?string}}
 *         Palette (unpadded, unsnapped) and where it came from.
 */
function derivePalette(sprites) {
    for (const { name, img } of sprites) {
        if (img.indices && img.palette.length <= PAL_SIZE) {
            const pal = img.palette.map(c => c.slice());
            const t = img.trns ? img.trns.findIndex(a => a < 128) : -1;
            if (t > 0) {
                [pal[0], pal[t]] = [pal[t], pal[0]];
            }
            return { pal, source: `${name} PLTE`, error: null };
        }
    }
    const counts = new Map();
    let transparent = false;
    for (const { img } of sprites) {
        const d = img.rgba;
        for (let p = 0; p < d.length; p += 4) {
            if (d[p + 3] < 128) {
                transparent = true;
                continue;
            }
            const k = key15([d[p], d[p + 1], d[p + 2]]);
            counts.set(k, (counts.get(k) || 0) + 1);
        }
    }
    const unkey = k => [(k >> 10) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];
    let key;
    if (transparent || !sprites.length) {
        key = DEFAULT_KEY.slice();
        while (counts.has(key15(key))) {
            key[1] += 8; // find a free 15-bit color for the key
        }
    } else {
        // No alpha: the top-left pixel is the background (GBA style).
        const d = sprites[0].img.rgba;
        key = snapColor([d[0], d[1], d[2]]);
        counts.delete(key15(key));
    }
    const colors = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([k]) => unkey(k));
    if (colors.length > PAL_SIZE - 1) {
        return {
            pal: null,
            source: "pixels",
            error: `${colors.length} opaque colors (max ${PAL_SIZE - 1} plus the transparent key)`
        };
    }
    return { pal: [key, ...colors], source: "pixels", error: null };
}

//-----------------------------------------------------------------------------
// Pixel remapping
//-----------------------------------------------------------------------------

/**
 * @brief Converts a decoded sprite to indices of the unit palette.
 *
 * An indexed sprite whose PLTE already is the palette (after 15-bit
 * snapping, for every index it uses) keeps its indices verbatim, so two
 * slots with the same color are never merged. Otherwise each pixel is
 * matched by 15-bit color (the runtime's rule); when that is ambiguous the
 * sprite's own index wins; with a tolerance, near colors snap to the closest
 * entry; anything else is reported as a stray color.
 *
 * @param {Object} img Decoded PNG (png.decode).
 * @param {Array<Array<number>>} pal Unit palette (16, snapped).
 * @param {Object} [o] Options.
 * @param {number} [o.tolerance=0] Max RGB distance for near colors.
 * @param {number} [o.count=16] Meaningful palette entries (the rest is
 *        padding and only kept when a sprite already uses it by index).
 * @return {{indices: Uint8Array, verbatim: boolean,
 *          strays: Array<{color: Array<number>, count: number, x: number,
 *          y: number}>, approx: number, ambiguous: Array<Array<number>>}}
 *         Indices and what had to be guessed.
 */
function toIndices(img, pal, o = {}) {
    const n = img.width * img.height;
    const indices = new Uint8Array(n);
    const tolerance = o.tolerance || 0;
    const transparentIdx = i => img.trns && i < img.trns.length && img.trns[i] < 128;

    if (img.indices) {
        let same = true;
        const seen = new Set(img.indices);
        for (const i of seen) {
            if (i >= PAL_SIZE || (!transparentIdx(i) && key15(img.palette[i]) !== key15(pal[i]))) {
                same = false;
                break;
            }
        }
        if (same) {
            for (let p = 0; p < n; p++) {
                indices[p] = transparentIdx(img.indices[p]) ? 0 : img.indices[p];
            }
            return { indices, verbatim: true, strays: [], approx: 0, ambiguous: [] };
        }
    }

    const count = Math.min(o.count || PAL_SIZE, pal.length);
    const byKey = new Map();
    pal.slice(0, count).forEach((c, i) => {
        const k = key15(c);
        if (!byKey.has(k)) {
            byKey.set(k, []);
        }
        byKey.get(k).push(i);
    });
    const strays = new Map();
    const ambiguous = new Map();
    let approx = 0;
    const d = img.rgba;
    for (let p = 0; p < n; p++) {
        const q = p * 4;
        if (d[q + 3] < 128) {
            indices[p] = 0;
            continue;
        }
        const c = [d[q], d[q + 1], d[q + 2]];
        const hits = byKey.get(key15(c));
        if (hits) {
            let i = hits[0];
            if (hits.length > 1) {
                const own = img.indices ? img.indices[p] : -1;
                if (hits.includes(own)) {
                    i = own;
                } else {
                    ambiguous.set(key15(c), c);
                }
            }
            indices[p] = i;
            continue;
        }
        let best = 0;
        let bestD = Infinity;
        for (let i = 1; i < count; i++) {
            const dist = Math.hypot(pal[i][0] - c[0], pal[i][1] - c[1], pal[i][2] - c[2]);
            if (dist < bestD) {
                bestD = dist;
                best = i;
            }
        }
        if (bestD <= tolerance) {
            indices[p] = best;
            approx++;
            continue;
        }
        indices[p] = 0;
        const k = key15(c);
        const s = strays.get(k);
        if (s) {
            s.count++;
        } else {
            strays.set(k, { color: c, count: 1, x: p % img.width, y: Math.floor(p / img.width) });
        }
    }
    return { indices, verbatim: false, strays: [...strays.values()], approx, ambiguous: [...ambiguous.values()] };
}

//-----------------------------------------------------------------------------
// Canvas
//-----------------------------------------------------------------------------

/**
 * @brief Bounding box of non-transparent (index != 0) pixels in a region.
 * @param {Uint8Array} idx Indices.
 * @param {number} stride Image width.
 * @param {number} x0 Region left.
 * @param {number} y0 Region top.
 * @param {number} w Region width.
 * @param {number} h Region height.
 * @return {?{x0: number, y0: number, x1: number, y1: number}} Box relative
 *         to the region (inclusive), null when empty.
 */
function bbox(idx, stride, x0, y0, w, h) {
    let box = null;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (idx[(y0 + y) * stride + x0 + x]) {
                if (!box) {
                    box = { x0: x, y0: y, x1: x, y1: y };
                } else {
                    box.x0 = Math.min(box.x0, x);
                    box.x1 = Math.max(box.x1, x);
                    box.y0 = Math.min(box.y0, y);
                    box.y1 = Math.max(box.y1, y);
                }
            }
        }
    }
    return box;
}

/**
 * @brief Brings a sprite sheet to its target canvas: same grid of frames,
 *        each frame padded / cropped to the target frame size. Frames are
 *        anchored bottom-center (the ground line stays put); when that would
 *        cut opaque pixels the frame is shifted just enough to keep them.
 *        Art is never rescaled.
 * @param {string} name File name (key of VIEWS).
 * @param {{width: number, height: number, indices: Uint8Array}} img Image.
 * @param {Object} [o] Options.
 * @param {?Array<number>} [o.owFrame] Overworld frame size [w, h].
 * @return {{img: ?Object, issues: Array<Object>, shift: ?Array<number>}}
 *         New image (null on error), issues and the shift of frame 0.
 */
function normalizeCanvas(name, img, o = {}) {
    const spec = VIEWS[name];
    const issues = [];
    let { cols, rows } = spec;
    if (spec.view === "icon" && img.height === img.width) {
        issues.push({ level: "warn", code: "icon-single-frame", message: "one frame only: duplicated into two" });
        rows = 1;
    }
    if (img.width % cols || img.height % rows) {
        issues.push({
            level: "error",
            code: "bad-grid",
            message: `${img.width}x${img.height} does not split into ${cols}x${rows} frames`
        });
        return { img: null, issues, shift: null };
    }
    const fw = img.width / cols;
    const fh = img.height / rows;
    const [tw, th] = spec.frame || o.owFrame || [fw, fh];
    const outRows = spec.rows;
    const out = { width: tw * cols, height: th * outRows, indices: new Uint8Array(tw * cols * th * outRows) };
    let shift = null;
    for (let r = 0; r < outRows; r++) {
        const sr = Math.min(r, rows - 1);
        for (let c = 0; c < cols; c++) {
            let dx = Math.floor((tw - fw) / 2);
            let dy = th - fh;
            if (fw !== tw || fh !== th) {
                const box = bbox(img.indices, img.width, c * fw, sr * fh, fw, fh);
                if (box) {
                    const bw = box.x1 - box.x0 + 1;
                    const bh = box.y1 - box.y0 + 1;
                    if (bw > tw || bh > th) {
                        issues.push({
                            level: "error",
                            code: "too-big",
                            message: `frame ${r * cols + c}: art is ${bw}x${bh}, canvas is ${tw}x${th}`
                        });
                        return { img: null, issues, shift: null };
                    }
                    const fix = (d, lo, hi, size) => Math.min(Math.max(d, -lo), size - 1 - hi);
                    const ndx = fix(dx, box.x0, box.x1, tw);
                    const ndy = fix(dy, box.y0, box.y1, th);
                    if (ndx !== dx || ndy !== dy) {
                        issues.push({
                            level: "warn",
                            code: "reanchored",
                            message: `frame ${r * cols + c}: moved ${ndx - dx},${ndy - dy} px off the bottom-center anchor to fit`
                        });
                    }
                    dx = ndx;
                    dy = ndy;
                }
            }
            if (!shift) {
                shift = [dx, dy];
            }
            for (let y = 0; y < fh; y++) {
                const ty = y + dy;
                if (ty < 0 || ty >= th) {
                    continue;
                }
                for (let x = 0; x < fw; x++) {
                    const tx = x + dx;
                    if (tx < 0 || tx >= tw) {
                        continue;
                    }
                    out.indices[(r * th + ty) * out.width + c * tw + tx] =
                        img.indices[(sr * fh + y) * img.width + c * fw + x];
                }
            }
        }
    }
    if (out.width !== img.width || out.height !== img.height) {
        issues.push({
            level: "info",
            code: "canvas-resized",
            message: `${img.width}x${img.height} -> ${out.width}x${out.height} (frame 0 moved ${shift[0]},${shift[1]} px)`
        });
    }
    return { img: out, issues, shift };
}

//-----------------------------------------------------------------------------
// Duplicates
//-----------------------------------------------------------------------------

/**
 * @brief Finds palette slots the runtime can't tell apart: used slots with
 *        the same 15-bit normal color but a different shiny color, and used
 *        opaque slots that look like the transparent key (index 0). With
 *        fix, the later slot is nudged one 15-bit step to a free color.
 * @param {Array<Array<number>>} normal Normal palette (changed when fixing).
 * @param {?Array<Array<number>>} shiny Shiny palette.
 * @param {Set<number>} used Indices used by the sprites.
 * @param {boolean} fix Nudge colors instead of failing.
 * @return {Array<Object>} Issues.
 */
function checkDuplicates(normal, shiny, used, fix) {
    const issues = [];
    const slots = [...used].filter(i => i < normal.length).sort((a, b) => a - b);
    if (!slots.includes(0)) {
        slots.unshift(0);
    }
    const taken = () => new Set(slots.map(i => key15(normal[i])));
    for (let b = 1; b < slots.length; b++) {
        const j = slots[b];
        for (let a = 0; a < b; a++) {
            const i = slots[a];
            if (key15(normal[i]) !== key15(normal[j])) {
                continue;
            }
            const sameShiny = shiny && shiny[i] && shiny[j] && key15(shiny[i]) === key15(shiny[j]);
            if (i !== 0 && (sameShiny || !shiny)) {
                issues.push({
                    level: "info",
                    code: "duplicate-color",
                    message: `slots ${i} and ${j} are both ${fmt(normal[i])} with the same shiny color (kept as is)`
                });
                break;
            }
            const what =
                i === 0
                    ? `slot ${j} (${fmt(normal[j])}) equals the transparent key in slot 0: it would be drawn transparent`
                    : `slots ${i} and ${j} are both ${fmt(normal[i])} but shiny ${fmt(shiny[i])} vs ${fmt(shiny[j])}: the runtime swap would merge them`;
            if (!fix) {
                issues.push({ level: "error", code: "duplicate-color", message: `${what} (use --fix-dupes)` });
                break;
            }
            const nudged = nudge(normal[j], taken());
            if (!nudged) {
                issues.push({ level: "error", code: "duplicate-color", message: `${what}; no free color to nudge to` });
                break;
            }
            issues.push({
                level: "warn",
                code: "nudged",
                message: `${what}; slot ${j} nudged ${fmt(normal[j])} -> ${fmt(nudged)}`
            });
            normal[j] = nudged;
            break;
        }
    }
    return issues;
}

/**
 * @brief Moves a color one 15-bit step to a color not in use, trying the
 *        least visible channel first (blue, red, then green).
 * @param {Array<number>} c Color (snapped).
 * @param {Set<number>} taken 15-bit keys in use.
 * @return {?Array<number>} New color, null when every neighbour is taken.
 */
function nudge(c, taken) {
    for (const ch of [2, 0, 1]) {
        for (const step of [8, -8]) {
            const v = c[ch] + step;
            if (v < 0 || v > 248) {
                continue;
            }
            const n = c.slice();
            n[ch] = v;
            if (!taken.has(key15(n))) {
                return n;
            }
        }
    }
    return null;
}

//-----------------------------------------------------------------------------
// Units
//-----------------------------------------------------------------------------

/**
 * @brief Kind of a unit from its path under img/pokemon/.
 * @param {string} id "sylveon", "raichu/alola", "pichu/egg", "egg"...
 * @return {string} "species" | "form" | "egg" | "special".
 */
function unitKind(id) {
    const parts = id.split("/");
    if (parts.length === 1) {
        return SPECIAL_UNITS[id] || "species";
    }
    return parts[parts.length - 1] === "egg" ? "egg" : "form";
}

/**
 * @brief Formats and harmonizes one unit.
 * @param {Object} unit Unit.
 * @param {string} unit.id Unit path ("sylveon", "raichu/alola").
 * @param {Object<string, Buffer>} unit.files File name -> bytes (only the
 *        sprite PNGs and the .pal files are looked at).
 * @param {?{normal: Array<Array<number>>, shiny: ?Array<Array<number>>,
 *        count: number}} [unit.base] Palettes of the base species and their
 *        meaningful color count (forms may inherit them).
 * @param {Object} [o] Options.
 * @param {boolean} [o.fixDupes] Nudge duplicate colors.
 * @param {number} [o.tolerance] Near-color tolerance (RGB distance).
 * @param {?Array<number>} [o.owFrame] Overworld frame size.
 * @return {{id: string, kind: string, issues: Array<Object>,
 *          outputs: Object<string, Buffer>, normal: ?Array<Array<number>>,
 *          shiny: ?Array<Array<number>>, sprites: Object<string, Object>,
 *          ok: boolean}} Result: outputs holds only the files whose bytes
 *          change; sprites holds the final indexed images (for previews).
 */
function processUnit(unit, o = {}) {
    const kind = unitKind(unit.id);
    const issues = [];
    const add = (level, code, message, file) => issues.push({ level, code, message, file: file || null });
    const files = unit.files || {};

    for (const name of Object.keys(files)) {
        if (!VIEWS[name] && name !== "normal.pal" && name !== "shiny.pal") {
            add("warn", "unknown-file", "not a sprite or palette file (ignored)", name);
        }
    }
    for (const name of REQUIRED[kind]) {
        if (!files[name]) {
            add(kind === "species" ? "error" : "warn", "missing-file", "missing", name);
        }
    }
    const pairs = [
        ["frontf.png", "front.png"],
        ["backf.png", "back.png"]
    ];
    for (const [f, m] of pairs) {
        if (files[f] && !files[m]) {
            add("warn", "female-without-male", `${f} without ${m}`, f);
        }
    }

    // Decode sprites (front first: it is the most authoritative).
    const order = Object.keys(VIEWS);
    const sprites = [];
    for (const name of order) {
        if (!files[name]) {
            continue;
        }
        try {
            sprites.push({ name, img: PNG.decode(files[name]) });
        } catch (e) {
            add("error", "bad-png", e.message, name);
        }
    }

    // Authoritative palette.
    let normal = null;
    let shiny = null;
    let normalCount = 0;
    if (files["normal.pal"]) {
        try {
            normal = parsePal(files["normal.pal"].toString("utf8"));
            normalCount = normal.length;
            if (normal.length > PAL_SIZE) {
                add("error", "palette-too-big", `${normal.length} colors (max ${PAL_SIZE})`, "normal.pal");
            }
        } catch (e) {
            add("error", "bad-palette", e.message, "normal.pal");
        }
    } else if (sprites.length) {
        const inherit =
            kind === "form" && unit.base && unit.base.normal ? fits(sprites, unit.base.normal) : false;
        if (inherit) {
            normal = unit.base.normal.map(c => c.slice());
            shiny = unit.base.shiny ? unit.base.shiny.map(c => c.slice()) : null;
            normalCount = unit.base.count || PAL_SIZE;
            add("info", "inherited-palette", "no normal.pal: using the base species' palettes", "normal.pal");
        } else {
            const d = derivePalette(sprites);
            if (d.error) {
                add("error", "too-many-colors", d.error, sprites[0].name);
            } else {
                normal = d.pal;
                normalCount = d.pal.length;
                add("info", "derived-palette", `no normal.pal: built from ${d.source}`, "normal.pal");
            }
        }
    }
    if (normal) {
        const n = normalizePalette(normal);
        normal = n.pal;
        if (n.snapped) {
            add("info", "snapped", `${n.snapped} color(s) snapped to 15-bit`, "normal.pal");
        }
    }
    if (files["shiny.pal"]) {
        try {
            const raw = parsePal(files["shiny.pal"].toString("utf8"));
            if (normalCount && raw.length !== normalCount && raw.length !== PAL_SIZE) {
                add("warn", "palette-size", `${raw.length} colors, normal.pal has ${normalCount}`, "shiny.pal");
            }
            if (raw.length > PAL_SIZE) {
                add("error", "palette-too-big", `${raw.length} colors (max ${PAL_SIZE})`, "shiny.pal");
            }
            const n = normalizePalette(raw);
            shiny = n.pal;
            if (n.snapped) {
                add("info", "snapped", `${n.snapped} color(s) snapped to 15-bit`, "shiny.pal");
            }
        } catch (e) {
            add("error", "bad-palette", e.message, "shiny.pal");
        }
    } else if (shiny) {
        shiny = normalizePalette(shiny).pal;
    } else if (sprites.length && kind !== "egg") {
        add("warn", "missing-shiny", "no shiny.pal: shinies will look normal", "shiny.pal");
    }

    const result = { id: unit.id, kind, issues, outputs: {}, normal, shiny, count: normalCount, sprites: {}, ok: false };
    if (!normal) {
        result.ok = !issues.some(i => i.level === "error");
        return result;
    }

    // Remap and normalize every sprite against the one palette.
    const used = new Set([0]);
    const indexed = [];
    for (const { name, img } of sprites) {
        const r = toIndices(img, normal, { ...o, count: normalCount });
        for (const s of r.strays.slice(0, 8)) {
            add(
                "error",
                "stray-color",
                `${fmt(s.color)} (${s.count} px, first at ${s.x},${s.y}) is not in normal.pal`,
                name
            );
        }
        if (r.strays.length > 8) {
            add("error", "stray-color", `...and ${r.strays.length - 8} more stray colors`, name);
        }
        if (r.approx) {
            add("warn", "approx-color", `${r.approx} px snapped to the nearest palette color`, name);
        }
        for (const c of r.ambiguous) {
            add("warn", "ambiguous-color", `${fmt(c)} matches several palette slots; used the first`, name);
        }
        const canvas = normalizeCanvas(name, { width: img.width, height: img.height, indices: r.indices }, o);
        for (const i of canvas.issues) {
            add(i.level, i.code, i.message, name);
        }
        if (!canvas.img) {
            continue;
        }
        canvas.img.indices.forEach(i => used.add(i));
        indexed.push({ name, img: canvas.img, src: img });
    }

    for (const i of checkDuplicates(normal, shiny, used, o.fixDupes)) {
        add(i.level, i.code, i.message, "normal.pal");
    }

    // Quality checks.
    if (shiny && [...used].every(i => i === 0 || key15(normal[i]) === key15(shiny[i]))) {
        add("warn", "shiny-same", "shiny.pal gives the same colors as normal.pal", "shiny.pal");
    }
    for (const { name, img } of indexed) {
        if (!img.indices.some(Boolean)) {
            add("warn", "empty-sprite", "every pixel is transparent", name);
        }
        if (name === "icon.png") {
            const half = img.indices.length / 2;
            const a = img.indices.subarray(0, half);
            const b = img.indices.subarray(half);
            if (a.every((v, i) => v === b[i])) {
                add("info", "icon-static", "both icon frames are identical", name);
            }
        }
    }
    const unused = [];
    for (let i = 1; i < normalCount && i < PAL_SIZE; i++) {
        if (!used.has(i) && key15(normal[i]) !== 0) {
            unused.push(i);
        }
    }
    if (unused.length && indexed.length) {
        add("info", "unused-slot", `slot(s) ${unused.join(", ")} not used by any sprite`, "normal.pal");
    }

    // Outputs (only files whose bytes change).
    for (const { name, img } of indexed) {
        const buf = PNG.encodeIndexed({ ...img, palette: normal }, { bitDepth: 4 });
        result.sprites[name] = img;
        if (!files[name].equals(buf)) {
            result.outputs[name] = buf;
        }
    }
    const palText = writePal(normal);
    if (!files["normal.pal"] || files["normal.pal"].toString("utf8") !== palText) {
        result.outputs["normal.pal"] = Buffer.from(palText);
    }
    if (shiny) {
        const t = writePal(shiny);
        if (!files["shiny.pal"] || files["shiny.pal"].toString("utf8") !== t) {
            result.outputs["shiny.pal"] = Buffer.from(t);
        }
    }
    result.ok = !issues.some(i => i.level === "error");
    return result;
}

/**
 * @brief Whether every opaque pixel of the sprites has a palette color.
 * @param {Array<{img: Object}>} sprites Decoded sprites.
 * @param {Array<Array<number>>} pal Palette.
 * @return {boolean} All colors fit.
 */
function fits(sprites, pal) {
    const keys = new Set(pal.slice(1).map(key15));
    return sprites.every(({ img }) => {
        const d = img.rgba;
        for (let p = 0; p < d.length; p += 4) {
            const k = key15([d[p], d[p + 1], d[p + 2]]);
            if (d[p + 3] >= 128 && !keys.has(k) && k !== key15(pal[0])) {
                return false;
            }
        }
        return true;
    });
}

/**
 * @brief Renders an indexed sprite to RGBA with a palette (index 0
 *        transparent), for previews.
 * @param {{width: number, height: number, indices: Uint8Array}} img Image.
 * @param {Array<Array<number>>} pal Palette.
 * @return {{width: number, height: number, rgba: Uint8Array}} RGBA image.
 */
function render(img, pal) {
    const rgba = new Uint8Array(img.width * img.height * 4);
    img.indices.forEach((i, p) => {
        if (!i) {
            return;
        }
        const c = pal[i] || [0, 0, 0];
        rgba.set([c[0], c[1], c[2], 255], p * 4);
    });
    return { width: img.width, height: img.height, rgba };
}

module.exports = {
    VERSION,
    PAL_SIZE,
    VIEWS,
    snap,
    snapColor,
    key15,
    parsePal,
    writePal,
    normalizePalette,
    derivePalette,
    toIndices,
    normalizeCanvas,
    checkDuplicates,
    nudge,
    unitKind,
    processUnit,
    render
};
