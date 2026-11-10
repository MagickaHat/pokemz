//=============================================================================
// PokéMZ - tests for the pixel-perfect display math (node --test)
//=============================================================================

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../game/js/plugins/PokeMZ_Display.js");

test("parseResolutions reads WxH and drops bad or duplicate entries", () => {
    assert.deepEqual(D.parseResolutions(["256x192", "320×240", "bad", "256x192", "0x10"]), [
        { w: 256, h: 192 },
        { w: 320, h: 240 },
    ]);
    assert.deepEqual(D.parseResolutions([]), [{ w: 256, h: 192 }]);
});

test("pixel perfect scaling uses the largest whole multiple that fits", () => {
    const o = { viewW: 1000, viewH: 700, w: 256, h: 192, dpr: 1, scaling: "pixel", windowScale: "auto" };
    assert.equal(D.deviceScale(o), 3);
    assert.equal(D.deviceScale({ ...o, viewW: 200, viewH: 100 }), 1, "never below 1x");
});

test("scaling is whole in device pixels on high-DPI screens", () => {
    // 1000 CSS px at 1.25 dpr = 1250 device px -> 4x (1024 device px).
    const s = D.deviceScale({ viewW: 1000, viewH: 800, w: 256, h: 192, dpr: 1.25, scaling: "pixel", windowScale: "auto" });
    assert.equal(s, 4);
    const box = D.placement(1000, 800, 256, 192, s, 1.25);
    assert.equal(box.width * 1.25, 1024);
    assert.equal(box.height * 1.25, 768);
    assert.ok(Number.isInteger(box.left * 1.25) && Number.isInteger(box.top * 1.25), "corner on a device pixel");
});

test("a fixed window scale is capped by what fits", () => {
    const o = { viewW: 1000, viewH: 700, w: 256, h: 192, dpr: 1, scaling: "pixel" };
    assert.equal(D.deviceScale({ ...o, windowScale: 2 }), 2);
    assert.equal(D.deviceScale({ ...o, windowScale: 6 }), 3);
});

test("fit scaling fills the window (may be fractional)", () => {
    const s = D.deviceScale({ viewW: 1000, viewH: 700, w: 256, h: 192, dpr: 1, scaling: "fit", windowScale: "auto" });
    assert.ok(Math.abs(s - 700 / 192) < 1e-9);
});

test("placement centres the screen", () => {
    assert.deepEqual(D.placement(1000, 700, 256, 192, 3, 1), { left: 116, top: 62, width: 768, height: 576 });
});

test("window metrics follow the font size", () => {
    assert.deepEqual(D.windowMetrics(16), { lineHeight: 18, padding: 6, itemPadding: 4, rowExtra: 2 });
});

test("thresholdAlpha snaps alpha to 0 or 255", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 10, 0, 0, 0, 127, 0, 0, 0, 128, 0, 0, 0, 250]);
    D.thresholdAlpha(data);
    assert.deepEqual([data[3], data[7], data[11], data[15]], [0, 0, 255, 255]);
});

test("cycle wraps both ways", () => {
    assert.equal(D.cycle(["auto", 1, 2], "auto", -1), 2);
    assert.equal(D.cycle(["auto", 1, 2], 2, 1), "auto");
    assert.equal(D.cycle(["auto", 1, 2], "missing", 1), "auto");
});
