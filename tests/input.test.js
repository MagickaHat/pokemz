//=============================================================================
// PokéMZ - tests for the input layer engine (node --test)
//=============================================================================

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../game/js/plugins/PokeMZ_Input.js");

/**
 * @brief A fresh engine with an optional fake gamepad list.
 * @param {Array<Object>} [pads] Gamepad-like objects (mutable).
 * @return {Engine} Engine.
 */
function makeEngine(pads) {
    const e = new I.Engine();
    e.pollPads = () => pads || [];
    return e;
}

/**
 * @brief A standard-mapping gamepad stub.
 * @param {string} [id] Gamepad id.
 * @return {Object} {id, connected, buttons, axes}.
 */
function pad(id = "Xbox 360 Controller (XInput STANDARD GAMEPAD)") {
    return { id, connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
}

/**
 * @brief Runs n frames.
 * @param {Engine} e Engine.
 * @param {number} n Frames.
 */
const frames = (e, n) => {
    for (let i = 0; i < n; i++) {
        e.update();
    }
};

test("actions: press, trigger, release and the per-frame snapshot", () => {
    const e = makeEngine();
    e.setRaw("key:KeyZ", 1);
    e.update();
    assert.equal(e.isTriggered("confirm"), true);
    assert.equal(e.isTriggered("ok"), true, "MZ name maps to the action");
    assert.equal(e.isPressed("confirm"), true);
    // Raw changes mid-frame don't change this frame's snapshot.
    e.setRaw("key:KeyZ", 0);
    assert.equal(e.isPressed("confirm"), true);
    e.update();
    assert.equal(e.isPressed("confirm"), false);
    assert.equal(e.isReleased("confirm"), true);
    e.update();
    assert.equal(e.isReleased("confirm"), false);
});

test("a press released before the next frame still counts once", () => {
    const e = makeEngine();
    e.setRaw("key:KeyZ", 1);
    e.setRaw("key:KeyZ", 0);
    e.update();
    assert.equal(e.isTriggered("confirm"), true);
    e.update();
    assert.equal(e.isPressed("confirm"), false);
    e.update();
    assert.equal(e.isTriggered("confirm"), false);
});

test("legacy names: escape counts as cancel and menu on the keyboard only", () => {
    const p = pad();
    const e = makeEngine([p]);
    e.setRaw("key:KeyX", 1);
    e.update();
    assert.equal(e.isTriggered("cancel"), true);
    assert.equal(e.isTriggered("escape"), true);
    assert.equal(e.isTriggered("menu"), true);
    assert.equal(e.state("menu").viaFallback, true);
    e.setRaw("key:KeyX", 0);
    e.update();
    p.buttons[1].pressed = true; // B
    e.update();
    assert.equal(e.isTriggered("cancel"), true);
    assert.equal(e.isTriggered("menu"), false);
    p.buttons[1].pressed = false;
    p.buttons[3].pressed = true; // Y
    e.update();
    assert.equal(e.isTriggered("menu"), true);
    assert.equal(e.state("menu").viaFallback, false);
});

test("repeat: wait, interval, latest button only, accessibility scaling", () => {
    const e = makeEngine();
    e.setRaw("key:ArrowDown", 1);
    const hits = [];
    for (let f = 0; f < 40; f++) {
        e.update();
        if (e.isRepeated("down")) {
            hits.push(f);
        }
    }
    assert.deepEqual(hits, [0, 24, 30, 36]);
    // Pressing another key makes it the latest: down stops repeating.
    e.setRaw("key:ArrowRight", 1);
    e.update();
    assert.equal(e.isRepeated("right"), true);
    frames(e, 30);
    assert.equal(e.isRepeated("down"), false);

    const slow = makeEngine();
    slow.setOption("repeatDelay", 2);
    slow.setRaw("key:ArrowUp", 1);
    const slowHits = [];
    for (let f = 0; f < 60; f++) {
        slow.update();
        if (slow.isRepeated("up")) {
            slowHits.push(f);
        }
    }
    assert.deepEqual(slowHits.slice(0, 2), [0, 48]);
});

test("long press follows the hold-time option", () => {
    const e = makeEngine();
    e.setOption("holdTime", 0.5);
    e.setRaw("key:KeyZ", 1);
    frames(e, 12);
    assert.equal(e.isLongPressed("ok"), false);
    e.update();
    assert.equal(e.isLongPressed("ok"), true);
});

test("analog: radial deadzone, scaling and digital hysteresis", () => {
    assert.deepEqual(I.radialDeadzone(0.1, 0.1, 0.2, 0.95), { x: 0, y: 0 });
    const v = I.radialDeadzone(1, 0, 0.2, 0.95);
    assert.equal(v.x, 1);
    const half = I.radialDeadzone(0.575, 0, 0.2, 0.95);
    assert.ok(Math.abs(half.x - 0.5) < 1e-9);

    const p = pad();
    const e = makeEngine([p]);
    p.axes[0] = 0.8; // right
    e.update();
    assert.equal(e.isPressed("right"), true);
    assert.ok(Math.abs(e.value("right") - 0.8) < 1e-9);
    // Between release (0.35) and press (0.5): stays pressed.
    p.axes[0] = 0.55;
    e.update();
    assert.equal(e.isPressed("right"), true);
    p.axes[0] = 0.3;
    e.update();
    assert.equal(e.isPressed("right"), false);
    p.axes[0] = 0.55; // scaled ~0.47: below the press threshold
    e.update();
    assert.equal(e.isPressed("right"), false);
});

test("direction: last pressed key wins, release returns to the older one", () => {
    const e = makeEngine();
    e.setRaw("key:ArrowUp", 1);
    e.update();
    assert.equal(e.dir4, 8);
    e.setRaw("key:ArrowRight", 1);
    e.update();
    assert.equal(e.dir4, 6);
    assert.equal(e.dir8, 9);
    e.setRaw("key:ArrowRight", 0);
    e.update();
    assert.equal(e.dir4, 8);
    e.setRaw("key:ArrowUp", 0);
    e.update();
    assert.equal(e.dir4, 0);
});

test("direction: stick sectors with hysteresis around diagonals", () => {
    const p = pad();
    const e = makeEngine([p]);
    const set = deg => {
        const r = (deg * Math.PI) / 180;
        p.axes[0] = Math.cos(r);
        p.axes[1] = Math.sin(r);
        e.update();
    };
    set(0);
    assert.equal(e.dir4, 6);
    set(50); // past the 45 degree edge, inside the 10 degree margin
    assert.equal(e.dir4, 6);
    set(60);
    assert.equal(e.dir4, 2);
    set(40);
    assert.equal(e.dir4, 2);
    p.axes[0] = p.axes[1] = 0;
    e.update();
    assert.equal(e.dir4, 0);
});

test("direction: camera rotation and dirHeld for tap-to-turn", () => {
    assert.equal(I.quartersForYaw(0), 0);
    assert.equal(I.rotateDir(8, I.quartersForYaw(90)), 4, "yaw 90: screen up is map left");
    assert.equal(I.rotateDir(6, I.quartersForYaw(90)), 8);
    assert.equal(I.rotateDir(8, I.quartersForYaw(180)), 2);
    assert.equal(I.rotateDir(8, I.quartersForYaw(-90)), 6);
    assert.equal(I.rotateDir(9, 1), 3);

    const e = makeEngine();
    e.rotation = I.quartersForYaw(90);
    e.setRaw("key:ArrowUp", 1);
    e.update();
    assert.equal(e.dir4, 8);
    assert.equal(e.moveDirection(), 4);
    assert.equal(e.dirHeld, 0);
    frames(e, 5);
    assert.equal(e.dirHeld, 5);
});

test("contexts: blocking contexts hide actions from readers below them", () => {
    const e = makeEngine();
    const ctx = e.pushContext("cutscene", { allow: ["confirm"] });
    e.setRaw("key:KeyX", 1);
    e.setRaw("key:KeyZ", 1);
    e.setRaw("key:ArrowUp", 1);
    e.update();
    assert.equal(e.isTriggered("cancel"), false);
    assert.equal(e.isTriggered("confirm"), true);
    assert.equal(e.moveDirection(), 0);
    assert.equal(ctx.isTriggered("cancel"), true, "the context's own reads see everything");
    ctx.pop();
    assert.equal(e.isTriggered("cancel"), true);
    // A non-blocking context changes nothing.
    e.pushContext("ui", { block: false });
    assert.equal(e.isTriggered("cancel"), true);
});

test("consumption hides a trigger for the rest of the frame only", () => {
    const e = makeEngine();
    e.setRaw("key:KeyZ", 1);
    e.update();
    e.consume("ok");
    assert.equal(e.isTriggered("confirm"), false);
    assert.equal(e.isPressed("confirm"), true);
    e.setRaw("key:KeyZ", 0);
    e.update();
    e.setRaw("key:KeyZ", 1);
    e.update();
    assert.equal(e.isTriggered("confirm"), true);
});

test("buffering: presses are accepted within the window, once", () => {
    const e = makeEngine();
    e.setRaw("key:KeyZ", 1);
    e.update();
    e.setRaw("key:KeyZ", 0);
    frames(e, 5);
    assert.equal(e.isBuffered("confirm", 8), true);
    assert.equal(e.consumeBuffered("confirm", 8), true);
    assert.equal(e.consumeBuffered("confirm", 8), false);
    e.mark("player.confirm");
    frames(e, 9);
    assert.equal(e.isBuffered("player.confirm", 8), false);
});

test("focus loss releases everything and held keys need a new press", () => {
    const p = pad();
    const e = makeEngine([p]);
    e.setRaw("key:ArrowLeft", 1);
    p.buttons[0].pressed = true;
    e.update();
    assert.equal(e.isPressed("left"), true);
    e.blur();
    assert.equal(e.isPressed("left"), false);
    // The OS swallowed keyup while unfocused; the pad button is still down.
    e.setRaw("key:ArrowLeft", 1);
    e.update();
    assert.equal(e.isPressed("left"), false);
    assert.equal(e.isPressed("confirm"), false);
    e.setRaw("key:ArrowLeft", 0);
    p.buttons[0].pressed = false;
    e.update();
    e.setRaw("key:ArrowLeft", 1);
    e.update();
    assert.equal(e.isTriggered("left"), true);
});

test("rebinding: swap with the previous owner, slots and reset", () => {
    const e = makeEngine();
    e.bind("confirm", "keyboard", "key:KeyX");
    assert.equal(e.sourcesOf("confirm", "keyboard")[0], "key:KeyX");
    assert.equal(e.sourcesOf("back", "keyboard")[0], "key:KeyZ", "back gets confirm's old primary");
    e.bind("confirm", "keyboard", "key:Enter");
    assert.deepEqual(e.sourcesOf("confirm", "keyboard").slice(0, 2), ["key:Enter", "key:KeyX"], "own source moves to the slot");
    e.bind("menu", "gamepad", "pad:0");
    assert.deepEqual(e.sourcesOf("menu", "gamepad"), ["pad:0"]);
    assert.deepEqual(e.sourcesOf("confirm", "gamepad"), ["pad:3"]);
    e.resetBindings("gamepad");
    assert.deepEqual(e.sourcesOf("confirm", "gamepad"), ["pad:0"]);
    assert.equal(e.sourcesOf("confirm", "keyboard")[0], "key:Enter", "keyboard untouched");
    e.resetBindings();
    assert.equal(e.sourcesOf("confirm", "keyboard")[0], "key:KeyZ");
});

test("rebinding: swapConfirmBack swaps the gamepad buttons only", () => {
    const p = pad();
    const e = makeEngine([p]);
    e.setOption("swapConfirmBack", true);
    p.buttons[0].pressed = true;
    e.update();
    assert.equal(e.isTriggered("back"), true);
    assert.equal(e.isTriggered("confirm"), false);
    e.setRaw("key:KeyZ", 1);
    e.update();
    assert.equal(e.isTriggered("confirm"), true);
});

test("capture: next new key, Escape cancels, reserved keys ignored", async () => {
    const e = makeEngine();
    e.setRaw("key:KeyZ", 1);
    e.update();
    const got = e.captureNext("keyboard");
    e.update(); // Z is still held from before: locked, not captured
    e.setRaw("key:F5", 1);
    e.update();
    e.setRaw("key:KeyP", 1);
    e.update();
    assert.equal(await got, "key:KeyP");
    assert.equal(e.isPressed("confirm"), false);

    const cancelled = e.captureNext("keyboard");
    e.setRaw("key:Escape", 1);
    e.update();
    assert.equal(await cancelled, null);

    const timeout = e.captureNext("gamepad", { frames: 3 });
    frames(e, 3);
    assert.equal(await timeout, null);
});

test("persistence: serialize/load round trip and legacy mapper migration", () => {
    const a = makeEngine();
    a.bind("run", "keyboard", "key:KeyR");
    a.setOption("toggleRun", true);
    a.setOption("deadzone", 5); // clamped
    const data = JSON.parse(JSON.stringify(a.serialize()));
    const b = makeEngine();
    b.load(data);
    assert.equal(b.sourcesOf("run", "keyboard")[0], "key:KeyR");
    assert.equal(b.options.toggleRun, true);
    assert.equal(b.options.deadzone, 0.9);
    assert.equal(data.bindings.control, undefined, "hidden actions aren't saved");

    const c = makeEngine();
    c.importLegacy({ 13: "ok", 32: "ok", 90: "escape", 88: "ok", 16: "shift", 38: "up", 40: "down", 37: "left", 39: "right", 65: "custom" }, { 1: "ok", 0: "cancel" });
    assert.deepEqual(c.sourcesOf("confirm", "keyboard").sort(), ["key:Enter", "key:KeyX", "key:Space"]);
    assert.deepEqual(c.sourcesOf("back", "keyboard"), ["key:KeyZ"]);
    assert.deepEqual(c.sourcesOf("confirm", "gamepad"), ["pad:1"]);
    assert.ok(c.sourcesOf("up", "gamepad").includes("axis:1-"), "stick directions kept");
    assert.equal(c.actions.get("custom").hidden, true, "unknown MZ names become hidden actions");
    c.setRaw("key:KeyA", 1);
    c.update();
    assert.equal(c.isTriggered("custom"), true);
    // And back out as an MZ mapper.
    const map = c.deviceMap("keyboard");
    assert.equal(map[90], "escape");
    assert.equal(map[13], "ok");
});

test("devices: active device and gamepad family detection", () => {
    assert.equal(I.familyOf("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)"), "xbox");
    assert.equal(I.familyOf("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"), "playstation");
    assert.equal(I.familyOf("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"), "switch");
    assert.equal(I.familyOf("8BitDo SN30"), "generic");

    const p = pad("DualSense Wireless Controller (Vendor: 054c)");
    const e = makeEngine([p]);
    const seen = [];
    e.on("devicechange", (d, f) => seen.push(`${d}/${f}`));
    p.axes[0] = 0.1; // inside the deadzone: not a device switch
    e.update();
    assert.equal(e.device, "keyboard");
    p.buttons[0].pressed = true;
    e.update();
    assert.equal(e.device, "gamepad");
    assert.equal(e.family, "playstation");
    e.setRaw("key:KeyZ", 1);
    e.update();
    assert.equal(e.device, "keyboard");
    assert.deepEqual(seen, ["gamepad/playstation", "keyboard/playstation"]);
});

test("glyphs: names follow the device, family and fallback", () => {
    const e = makeEngine();
    const t = (k, fb) => fb;
    assert.equal(e.sourceName(e.glyphSource("ok"), "keyboard", t), "Z");
    assert.equal(e.sourceName(e.glyphSource("menu"), "keyboard", t), "X", "menu falls back to Cancel's key");
    assert.equal(e.sourceName(e.glyphSource("ok", "gamepad"), "playstation", t), "✕");
    assert.equal(e.sourceName(e.glyphSource("ok", "gamepad"), "switch", t), "B");
    assert.equal(e.sourceName("axis:1-", "xbox", t), "LS↑");
    assert.equal(e.sourceName("key:Numpad4", "keyboard", t), "Num 4");
    assert.equal(e.sourceName("key:Escape", "keyboard", t), "Esc");
    e.setOption("glyphStyle", "switch");
    assert.deepEqual(e.glyphTarget(), { device: "gamepad", family: "switch" });
});

test("toggle run and camera values", () => {
    const p = pad();
    const e = makeEngine([p]);
    e.setOption("toggleRun", true);
    e.setRaw("key:ShiftLeft", 1);
    e.update();
    e.setRaw("key:ShiftLeft", 0);
    e.update();
    assert.equal(e.isRunning(), true);
    e.setRaw("key:ShiftLeft", 1);
    e.update();
    assert.equal(e.isRunning(), false);

    p.axes[2] = 1;
    p.buttons[7].pressed = true;
    p.buttons[7].value = 1;
    e.addCameraDelta(0, 50, 0);
    e.update();
    let c = e.camera();
    assert.equal(c.yaw, 1);
    assert.equal(c.pitch, 0.5);
    assert.equal(c.zoom, -1);
    e.setOption("invertCameraX", true);
    c = e.camera();
    assert.equal(c.yaw, -1);
});

test("recorder: replay reproduces the same snapshots", () => {
    const script = [["key:ArrowUp", 1], null, ["key:KeyZ", 1], ["key:ArrowUp", 0], null, ["key:KeyZ", 0], null];
    const p = pad();
    const a = makeEngine([p]);
    const live = [];
    a.recorder.start();
    script.forEach((step, i) => {
        if (step) {
            a.setRaw(step[0], step[1]);
        }
        p.axes[0] = i === 4 ? 0.9 : 0;
        a.update();
        live.push(JSON.stringify([a.dir4, a.isTriggered("ok"), a.isPressed("right"), a.isPressed("up")]));
    });
    const rec = JSON.parse(JSON.stringify(a.recorder.stop()));
    assert.equal(rec.frames.length, script.length);

    const b = makeEngine();
    let ended = false;
    b.on("recorder", what => what === "end" && (ended = true));
    b.recorder.play(rec);
    const replay = [];
    for (let i = 0; i < script.length; i++) {
        b.update();
        replay.push(JSON.stringify([b.dir4, b.isTriggered("ok"), b.isPressed("right"), b.isPressed("up")]));
    }
    assert.deepEqual(replay, live);
    assert.equal(ended, true);
});

test("virtual devices: taps last one frame, holds report touch", () => {
    const e = makeEngine();
    e.tap("ok");
    e.update();
    assert.equal(e.isTriggered("confirm"), true);
    e.update();
    assert.equal(e.isPressed("confirm"), false);
    e.setVirtual("up", true);
    e.update();
    assert.equal(e.device, "touch");
    assert.equal(e.dir4, 8);
    e.setVirtual("up", false);
    e.update();
    assert.equal(e.dir4, 0);
});

test("players: player 2 joins with a free gamepad and gets their own input", async () => {
    const p1pad = pad("Xbox Wireless Controller (Vendor: 045e)");
    const p2pad = pad("DualSense Wireless Controller (Vendor: 054c)");
    p1pad.index = 0;
    p2pad.index = 1;
    const e = makeEngine([p1pad, p2pad]);
    // Player 1 uses pad 0.
    p1pad.buttons[0].pressed = true;
    e.update();
    p1pad.buttons[0].pressed = false;
    e.update();
    assert.equal(e.lastDeviceId, "pad#0");

    const joined = e.joinNext({ exclude: e.lastDeviceId });
    e.update(); // learns what is held
    p1pad.buttons[0].pressed = true; // player 1's device can't join
    e.update();
    assert.equal(e.isTriggered("confirm"), true, "player 1 still gets their press");
    p1pad.buttons[0].pressed = false;
    p2pad.buttons[9].pressed = true; // Start on pad 1
    e.update();
    assert.deepEqual(await joined, { index: 2, deviceId: "pad#1" });
    const p2 = e.player(2);
    assert.equal(p2.device, "gamepad");
    assert.equal(p2.family, "playstation");
    assert.equal(p2.isPressed("menu"), false, "the joining press doesn't act");
    p2pad.buttons[9].pressed = false;
    e.update();

    // Separate snapshots: pad 1 only reaches player 2.
    p2pad.buttons[0].pressed = true;
    p2pad.axes[0] = -1;
    e.update();
    assert.equal(p2.isTriggered("confirm"), true);
    assert.equal(p2.dir4, 4);
    assert.equal(e.isTriggered("confirm"), false);
    assert.equal(e.dir4, 0);
    // Player 1 still has the keyboard and pad 0.
    e.setRaw("key:KeyZ", 1);
    e.update();
    assert.equal(e.isTriggered("confirm"), true);
    assert.equal(p2.isTriggered("confirm"), false);
    // Shared bindings and options.
    assert.equal(p2.bindings, e.bindings);
    e.setOption("swapConfirmBack", true);
    assert.equal(p2.options.swapConfirmBack, true);
});

test("players: unplugging player 2's pad frees the slot; leave returns the device", async () => {
    const pads = [pad(), pad()];
    pads[0].index = 0;
    pads[1].index = 1;
    const e = makeEngine(pads);
    const lost = [];
    e.on("playerlost", (i, id) => lost.push(`${i}:${id}`));
    const joined = e.joinNext({ exclude: "keyboard" });
    e.update();
    pads[1].buttons[0].pressed = true;
    e.update();
    await joined;
    pads[1].buttons[0].pressed = false;
    e.update();
    // Unplug pad 1.
    const unplugged = pads.pop();
    e.update();
    assert.deepEqual(lost, ["2:pad#1"]);
    assert.equal(e.player(2).deviceId, null, "player 2 keeps the slot without a device");
    // It comes back: it belongs to player 1 until player 2 joins again.
    pads.push(unplugged);
    unplugged.buttons[0].pressed = true;
    e.update();
    assert.equal(e.isTriggered("confirm"), true);
    unplugged.buttons[0].pressed = false;
    e.update();
    const again = e.joinNext({ exclude: "keyboard" });
    assert.ok(again instanceof Promise);
    e.update();
    unplugged.buttons[0].pressed = true;
    e.update();
    assert.deepEqual(await again, { index: 2, deviceId: "pad#1" });
    e.removePlayer(2);
    assert.equal(e.player(2), null);
    unplugged.buttons[0].pressed = false;
    e.update();
    unplugged.buttons[0].pressed = true;
    e.update();
    assert.equal(e.isTriggered("confirm"), true);
});

test("players: the keyboard can be player 2's device; joins time out and cap at 2", async () => {
    const p1pad = pad();
    p1pad.index = 0;
    const e = makeEngine([p1pad]);
    const joined = e.joinNext({ exclude: "pad#0" });
    e.update();
    e.setRaw("key:Enter", 1);
    e.update();
    assert.deepEqual(await joined, { index: 2, deviceId: "keyboard" });
    e.setRaw("key:Enter", 0);
    e.update();
    e.setRaw("key:ArrowUp", 1);
    e.update();
    assert.equal(e.player(2).dir4, 8);
    assert.equal(e.dir4, 0, "player 1 lost the keyboard");

    assert.equal(await e.joinNext({ index: 3 }), null, "only two players");
    e.removePlayer(2);
    const timeout = e.joinNext({ frames: 3 });
    I.Engine.prototype.update.call(e);
    e.update();
    e.update();
    assert.equal(await timeout, null);
});
