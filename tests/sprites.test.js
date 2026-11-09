//=============================================================================
// PokéMZ - tests for the sprite formatter (node --test)
//=============================================================================

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const PNG = require("../tools/lib/png.js");
const S = require("../tools/lib/sprites.js");
const Tool = require("../tools/sprites.js");
const Runtime = require("../game/js/plugins/PokeMZ_PBS_Graphics.js");

const ROOT = path.join(__dirname, "..", "game");

const KEY = [248, 0, 248];
const NORMAL = [KEY, [16, 16, 16], [232, 112, 152], [104, 24, 56], [200, 200, 200]];
const SHINY = [KEY, [8, 8, 8], [136, 200, 240], [64, 136, 152], [248, 248, 248]];

/**
 * @brief Builds an indexed image from rows of hex digits ("0" transparent).
 * @param {Array<string>} rows Rows of palette indices.
 * @return {{width: number, height: number, indices: Uint8Array}} Image.
 */
function grid(rows) {
    const width = rows[0].length;
    const indices = new Uint8Array(width * rows.length);
    rows.forEach((r, y) => [...r].forEach((ch, x) => (indices[y * width + x] = parseInt(ch, 16))));
    return { width, height: rows.length, indices };
}

/**
 * @brief An indexed image of a given size with a small blob at (x, y).
 * @param {number} w Width.
 * @param {number} h Height.
 * @param {Array<Array<number>>} dots [x, y, index] pixels.
 * @return {{width: number, height: number, indices: Uint8Array}} Image.
 */
function canvas(w, h, dots) {
    const indices = new Uint8Array(w * h);
    for (const [x, y, i] of dots) {
        indices[y * w + x] = i;
    }
    return { width: w, height: h, indices };
}

/**
 * @brief RGBA PNG of an indexed image (index 0 transparent).
 * @param {Object} img Indexed image.
 * @param {Array<Array<number>>} pal Palette.
 * @return {Buffer} PNG.
 */
const rgbaPng = (img, pal) => PNG.encodeRGBA(S.render(img, pal));

/**
 * @brief Indexed 4bpp PNG of an image.
 * @param {Object} img Indexed image.
 * @param {Array<Array<number>>} pal Palette.
 * @return {Buffer} PNG.
 */
const idxPng = (img, pal) => PNG.encodeIndexed({ ...img, palette: pal }, { bitDepth: 4 });

/**
 * @brief A complete species unit with the given sprites.
 * @param {Object} [over] File overrides.
 * @return {Object<string, Buffer>} Files.
 */
function speciesFiles(over = {}) {
    const front = canvas(96, 96, [[40, 90, 1], [41, 90, 2], [42, 90, 3], [43, 90, 4]]);
    const icon = canvas(32, 64, [[10, 20, 2], [10, 52, 3]]);
    return {
        "front.png": idxPng(front, S.normalizePalette(NORMAL).pal),
        "back.png": idxPng(front, S.normalizePalette(NORMAL).pal),
        "icon.png": idxPng(icon, S.normalizePalette(NORMAL).pal),
        "normal.pal": Buffer.from(S.writePal(NORMAL)),
        "shiny.pal": Buffer.from(S.writePal(SHINY)),
        ...over
    };
}

const codes = r => r.issues.map(i => i.code);

//-----------------------------------------------------------------------------
// PNG codec
//-----------------------------------------------------------------------------

test("png: indexed 4bpp round trip", () => {
    const img = grid(["0123", "4560", "789a", "bcdf"]);
    const pal = Array.from({ length: 16 }, (_, i) => [i * 16, 255 - i * 16, i]);
    const d = PNG.decode(PNG.encodeIndexed({ ...img, palette: pal }));
    assert.equal(d.bitDepth, 4);
    assert.equal(d.colorType, 3);
    assert.deepEqual([...d.indices], [...img.indices]);
    assert.deepEqual(d.palette, pal);
    assert.deepEqual([...d.rgba.subarray(4, 8)], [16, 239, 1, 255]);
});

test("png: 8-bit palette, tRNS and RGBA round trip", () => {
    const img = grid(["01", "20"]);
    const d = PNG.decode(PNG.encodeIndexed({ ...img, palette: NORMAL }, { bitDepth: 8, trns: [0] }));
    assert.equal(d.bitDepth, 8);
    assert.equal(d.rgba[3], 0);
    assert.equal(d.rgba[7], 255);
    const rgba = PNG.decode(rgbaPng(img, NORMAL));
    assert.equal(rgba.colorType, 6);
    assert.deepEqual([...rgba.rgba.subarray(4, 8)], [16, 16, 16, 255]);
});

test("png: encoding is deterministic", () => {
    const img = grid(["0110", "1221"]);
    assert.ok(idxPng(img, NORMAL).equals(idxPng(img, NORMAL)));
});

test("png: rejects non-PNG data", () => {
    assert.throws(() => PNG.decode(Buffer.from("hello world")), /not a PNG/);
});

test("png: decodes the committed sprites", () => {
    const d = PNG.decode(fs.readFileSync(path.join(ROOT, "img", "pokemon", "sylveon", "front.png")));
    assert.equal(d.width, 96);
    assert.equal(d.height, 96);
});

//-----------------------------------------------------------------------------
// Palettes
//-----------------------------------------------------------------------------

test("palette: 15-bit snapping and padding", () => {
    const { pal, snapped } = S.normalizePalette([[181, 230, 29], [16, 16, 16]]);
    assert.equal(pal.length, 16);
    assert.deepEqual(pal[0], [176, 224, 24]);
    assert.deepEqual(pal[15], [0, 0, 0]);
    assert.equal(snapped, 1);
});

test("palette: JASC round trip", () => {
    assert.deepEqual(S.parsePal(S.writePal(NORMAL)), NORMAL);
    assert.throws(() => S.parsePal("JASC-PAL\n0100\n1\n300 0 0\n"), /bad color/);
});

test("palette: derived from RGBA pixels behind a free key", () => {
    const img = PNG.decode(rgbaPng(grid(["0112", "0113"]), NORMAL));
    const d = S.derivePalette([{ name: "front.png", img }]);
    assert.deepEqual(d.pal[0], KEY);
    assert.deepEqual(d.pal[1], [16, 16, 16]); // most frequent first
    assert.equal(d.pal.length, 4);
});

test("palette: too many colors cannot be derived", () => {
    const pal = Array.from({ length: 17 }, (_, i) => [i * 8, 0, 0]);
    const img = { width: 17, height: 1, rgba: new Uint8Array(17 * 4) };
    pal.forEach((c, i) => img.rgba.set([...c, 255], i * 4));
    assert.match(S.derivePalette([{ name: "front.png", img }]).error, /opaque colors/);
});

//-----------------------------------------------------------------------------
// Remapping
//-----------------------------------------------------------------------------

test("remap: RGBA pixels become palette indices (15-bit match)", () => {
    const pal = S.normalizePalette(NORMAL).pal;
    const img = PNG.decode(rgbaPng(grid(["0123"]), [KEY, [17, 18, 19], [233, 113, 155], [107, 29, 56]]));
    const r = S.toIndices(img, pal, { count: NORMAL.length });
    assert.deepEqual([...r.indices], [0, 1, 2, 3]);
    assert.equal(r.verbatim, false);
});

test("remap: indexed sprites on the palette keep duplicate slots apart", () => {
    const dup = [KEY, [16, 16, 16], [16, 16, 16]];
    const pal = S.normalizePalette(dup).pal;
    const img = PNG.decode(idxPng(grid(["0122"]), pal));
    const r = S.toIndices(img, pal, { count: 3 });
    assert.equal(r.verbatim, true);
    assert.deepEqual([...r.indices], [0, 1, 2, 2]);
});

test("remap: stray colors are reported, tolerance snaps them", () => {
    const pal = S.normalizePalette(NORMAL).pal;
    const img = PNG.decode(rgbaPng(grid(["01"]), [KEY, [40, 16, 16]]));
    const strict = S.toIndices(img, pal, { count: NORMAL.length });
    assert.equal(strict.strays.length, 1);
    assert.deepEqual(strict.strays[0], { color: [40, 16, 16], count: 1, x: 1, y: 0 });
    const loose = S.toIndices(img, pal, { count: NORMAL.length, tolerance: 30 });
    assert.equal(loose.approx, 1);
    assert.equal(loose.indices[1], 1);
});

test("remap: padding slots never make colors ambiguous", () => {
    const pal = S.normalizePalette([KEY, [0, 0, 0]]).pal; // slots 2-15 pad with black
    const img = PNG.decode(rgbaPng(grid(["01"]), [KEY, [0, 0, 0]]));
    const r = S.toIndices(img, pal, { count: 2 });
    assert.deepEqual(r.ambiguous, []);
    assert.equal(r.indices[1], 1);
});

//-----------------------------------------------------------------------------
// Duplicates
//-----------------------------------------------------------------------------

test("duplicates: same normal color with different shinies is an error", () => {
    const normal = S.normalizePalette([KEY, [16, 16, 16], [17, 17, 17]]).pal;
    const shiny = S.normalizePalette([KEY, [8, 8, 8], [200, 0, 0]]).pal;
    const issues = S.checkDuplicates(normal, shiny, new Set([0, 1, 2]), false);
    assert.equal(issues[0].level, "error");
    assert.match(issues[0].message, /merge/);
});

test("duplicates: --fix-dupes nudges the later slot to a free color", () => {
    const normal = S.normalizePalette([KEY, [16, 16, 16], [16, 16, 16]]).pal;
    const shiny = S.normalizePalette([KEY, [8, 8, 8], [200, 0, 0]]).pal;
    const issues = S.checkDuplicates(normal, shiny, new Set([0, 1, 2]), true);
    assert.equal(issues[0].code, "nudged");
    assert.deepEqual(normal[2], [16, 16, 24]);
    assert.notEqual(S.key15(normal[1]), S.key15(normal[2]));
});

test("duplicates: identical shinies are harmless, unused slots ignored", () => {
    const normal = S.normalizePalette([KEY, [16, 16, 16], [16, 16, 16], [0, 0, 0]]).pal;
    const shiny = S.normalizePalette([KEY, [8, 8, 8], [8, 8, 8], [0, 0, 0]]).pal;
    const issues = S.checkDuplicates(normal, shiny, new Set([0, 1, 2]), false);
    assert.deepEqual(issues.map(i => i.level), ["info"]);
});

test("duplicates: an opaque slot equal to the transparent key is an error", () => {
    const normal = S.normalizePalette([KEY, KEY]).pal;
    const issues = S.checkDuplicates(normal, null, new Set([0, 1]), false);
    assert.match(issues[0].message, /transparent key/);
});

//-----------------------------------------------------------------------------
// Canvas
//-----------------------------------------------------------------------------

test("canvas: small battler is padded, anchored bottom-center", () => {
    const r = S.normalizeCanvas("front.png", canvas(64, 64, [[0, 63, 1], [63, 0, 2]]));
    assert.equal(r.img.width, 96);
    assert.equal(r.img.height, 96);
    assert.deepEqual(r.shift, [16, 32]);
    assert.equal(r.img.indices[95 * 96 + 16], 1);
    assert.equal(r.img.indices[32 * 96 + 79], 2);
});

test("canvas: big battler is cropped around its art, never scaled", () => {
    const r = S.normalizeCanvas("front.png", canvas(128, 128, [[20, 10, 1], [100, 100, 2]]));
    assert.equal(r.img.width, 96);
    assert.equal(r.img.indices.filter(Boolean).length, 2);
    assert.ok(r.issues.some(i => i.code === "reanchored"));
});

test("canvas: art larger than the canvas is an error", () => {
    const r = S.normalizeCanvas("front.png", canvas(128, 128, [[0, 0, 1], [127, 127, 1]]));
    assert.equal(r.img, null);
    assert.equal(r.issues[0].code, "too-big");
});

test("canvas: icon frames are anchored separately; single frames doubled", () => {
    const two = S.normalizeCanvas("icon.png", canvas(24, 48, [[0, 23, 1], [0, 47, 2]]));
    assert.equal(two.img.width, 32);
    assert.equal(two.img.height, 64);
    assert.equal(two.img.indices[31 * 32 + 4], 1);
    assert.equal(two.img.indices[63 * 32 + 4], 2);
    const one = S.normalizeCanvas("icon.png", canvas(32, 32, [[5, 5, 3]]));
    assert.equal(one.img.height, 64);
    assert.equal(one.img.indices[37 * 32 + 5], 3);
    assert.equal(one.issues[0].code, "icon-single-frame");
});

test("canvas: overworld sheets keep their 3x4 grid", () => {
    const ok = S.normalizeCanvas("overworld.png", canvas(96, 128, [[47, 63, 1]]));
    assert.deepEqual(ok.issues, []);
    assert.deepEqual([...ok.img.indices], [...canvas(96, 128, [[47, 63, 1]]).indices]);
    const resized = S.normalizeCanvas("overworld.png", canvas(72, 96, [[12, 23, 1]]), { owFrame: [32, 32] });
    assert.equal(resized.img.width, 96);
    assert.equal(resized.img.height, 128);
    assert.equal(resized.img.indices[31 * 96 + 16], 1);
    assert.equal(S.normalizeCanvas("overworld.png", canvas(100, 128, [])).issues[0].code, "bad-grid");
});

//-----------------------------------------------------------------------------
// Units
//-----------------------------------------------------------------------------

test("unit: kinds from folder paths", () => {
    assert.equal(S.unitKind("sylveon"), "species");
    assert.equal(S.unitKind("raichu/alola"), "form");
    assert.equal(S.unitKind("pichu/egg"), "egg");
    assert.equal(S.unitKind("egg"), "egg");
    assert.equal(S.unitKind("question_mark"), "special");
});

test("unit: RGBA sprites, icon and overworld share one palette", () => {
    const pal = S.normalizePalette(NORMAL).pal;
    const files = speciesFiles({
        "front.png": rgbaPng(canvas(96, 96, [[1, 95, 1], [2, 95, 2]]), NORMAL),
        "overworld.png": rgbaPng(canvas(96, 128, [[47, 31, 3], [48, 31, 4]]), NORMAL)
    });
    const r = S.processUnit({ id: "testmon", files });
    assert.equal(r.ok, true, JSON.stringify(r.issues));
    for (const name of ["front.png", "overworld.png"]) {
        const d = PNG.decode(r.outputs[name]);
        assert.equal(d.bitDepth, 4);
        assert.deepEqual(d.palette, pal);
    }
    assert.ok(!r.outputs["icon.png"], "already normalized files are not rewritten");
});

test("unit: built sprites give exact shinies through the runtime swap", () => {
    const files = speciesFiles({ "front.png": rgbaPng(canvas(96, 96, [[1, 95, 1], [2, 95, 2], [3, 95, 3], [4, 95, 4]]), NORMAL) });
    const r = S.processUnit({ id: "testmon", files });
    const d = PNG.decode(r.outputs["front.png"]);
    const normal = S.parsePal(r.outputs["normal.pal"] ? r.outputs["normal.pal"].toString() : files["normal.pal"].toString());
    const shiny = S.parsePal(files["shiny.pal"].toString());
    const rgba = Uint8ClampedArray.from(d.rgba);
    Runtime.remapPalette(rgba, normal, shiny, { transparentIndex0: true });
    for (let p = 0; p < d.indices.length; p++) {
        const i = d.indices[p];
        if (i === 0) {
            assert.equal(rgba[p * 4 + 3], 0);
        } else {
            assert.deepEqual([...rgba.subarray(p * 4, p * 4 + 3)], shiny[i]);
        }
    }
});

test("unit: missing files, stray colors and missing shiny are reported", () => {
    const files = speciesFiles({ "front.png": rgbaPng(canvas(96, 96, [[1, 1, 1]]), [KEY, [1, 99, 200]]) });
    delete files["back.png"];
    delete files["shiny.pal"];
    const r = S.processUnit({ id: "testmon", files });
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("missing-file"));
    assert.ok(codes(r).includes("stray-color"));
    assert.ok(codes(r).includes("missing-shiny"));
});

test("unit: forms inherit the base palette when their colors fit", () => {
    const base = { normal: S.normalizePalette(NORMAL).pal, shiny: S.normalizePalette(SHINY).pal, count: NORMAL.length };
    const files = { "front.png": rgbaPng(canvas(96, 96, [[5, 95, 2]]), NORMAL) };
    const r = S.processUnit({ id: "testmon/alt", files, base });
    assert.ok(codes(r).includes("inherited-palette"));
    assert.equal(r.outputs["normal.pal"].toString(), S.writePal(base.normal));
    assert.equal(r.outputs["shiny.pal"].toString(), S.writePal(base.shiny));
    const other = S.processUnit({
        id: "testmon/alt",
        files: { "front.png": rgbaPng(canvas(96, 96, [[5, 95, 1]]), [KEY, [96, 200, 40]]) },
        base
    });
    assert.ok(codes(other).includes("derived-palette"));
});

test("unit: duplicate colors block the build unless fixed", () => {
    const normal = [KEY, [16, 16, 16], [16, 16, 16]];
    const shiny = [KEY, [8, 8, 8], [200, 0, 0]];
    const pal = S.normalizePalette(normal).pal;
    const files = speciesFiles({
        "front.png": idxPng(canvas(96, 96, [[1, 95, 1], [2, 95, 2]]), pal),
        "back.png": idxPng(canvas(96, 96, [[1, 95, 1]]), pal),
        "icon.png": idxPng(canvas(32, 64, [[1, 31, 1]]), pal),
        "normal.pal": Buffer.from(S.writePal(normal)),
        "shiny.pal": Buffer.from(S.writePal(shiny))
    });
    assert.equal(S.processUnit({ id: "testmon", files }).ok, false);
    const fixed = S.processUnit({ id: "testmon", files }, { fixDupes: true });
    assert.equal(fixed.ok, true);
    assert.match(fixed.outputs["normal.pal"].toString(), /\n16 16 24\n/);
    assert.deepEqual(PNG.decode(fixed.outputs["front.png"]).indices[95 * 96 + 2], 2);
});

//-----------------------------------------------------------------------------
// CLI: build, cache, check
//-----------------------------------------------------------------------------

/**
 * @brief A temporary game folder with img/pokemon units.
 * @param {Object<string, Object<string, Buffer>>} units Unit id -> files.
 * @return {string} Game folder.
 */
function tempRoot(units) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pmz-sprites-"));
    for (const [id, files] of Object.entries(units)) {
        const dir = path.join(root, "img", "pokemon", ...id.split("/"));
        fs.mkdirSync(dir, { recursive: true });
        for (const [n, b] of Object.entries(files)) {
            fs.writeFileSync(path.join(dir, n), b);
        }
    }
    return root;
}

test("cli: build rewrites, then the cache skips unchanged folders", t => {
    const root = tempRoot({
        testmon: speciesFiles({ "front.png": rgbaPng(canvas(64, 64, [[1, 63, 1]]), NORMAL) }),
        "testmon/alt": { "front.png": rgbaPng(canvas(96, 96, [[5, 95, 2]]), NORMAL) }
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(Tool.scanUnits(path.join(root, "img", "pokemon")), ["testmon", "testmon/alt"]);
    const check1 = Tool.build(root, { cacheDir: root, write: false });
    assert.ok(Tool.makeReport(check1).issues.some(i => i.code === "needs-build"));
    const first = Tool.build(root, { cacheDir: root, write: true });
    assert.equal(first.written, 2);
    assert.ok(fs.existsSync(path.join(root, "img", "pokemon", "testmon", "alt", "normal.pal")));
    const second = Tool.build(root, { cacheDir: root, write: true });
    assert.equal(second.skipped, 2);
    assert.equal(Tool.makeReport(Tool.build(root, { cacheDir: root, write: false })).summary.errors, 0);
    // A changed file invalidates only its folder.
    const front = path.join(root, "img", "pokemon", "testmon", "front.png");
    fs.writeFileSync(front, rgbaPng(canvas(96, 96, [[3, 95, 3]]), NORMAL));
    const third = Tool.build(root, { cacheDir: root, write: true });
    assert.equal(third.skipped, 1);
    assert.equal(third.written, 1);
    // --force ignores the cache.
    assert.equal(Tool.build(root, { cacheDir: root, write: true, force: true }).skipped, 0);
});

test("cli: build leaves folders with errors untouched", t => {
    const files = speciesFiles({ "front.png": rgbaPng(canvas(96, 96, [[1, 1, 1]]), [KEY, [1, 99, 200]]) });
    const root = tempRoot({ testmon: files });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const res = Tool.build(root, { cacheDir: root, write: true });
    assert.equal(res.written, 0);
    assert.ok(fs.readFileSync(path.join(root, "img", "pokemon", "testmon", "front.png")).equals(files["front.png"]));
    assert.ok(Tool.makeReport(res).summary.errors > 0);
});

test("cli: option parsing", () => {
    const o = Tool.parseArgs(["--only", "a, b", "--fix-dupes", "--ow-frame", "32x48", "--tolerance", "12"]);
    assert.deepEqual([...o.only], ["a", "b"]);
    assert.equal(o.fixDupes, true);
    assert.deepEqual(o.owFrame, [32, 48]);
    assert.equal(o.tolerance, 12);
    assert.throws(() => Tool.parseArgs(["--ow-frame", "big"]), /ow-frame/);
});

test("game: committed sprites pass the check", () => {
    const report = Tool.makeReport(Tool.build(ROOT, { write: false, noCache: true }));
    assert.deepEqual(report.issues.filter(i => i.level === "error"), []);
});
