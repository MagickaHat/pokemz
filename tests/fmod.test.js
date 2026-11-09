//=============================================================================
// PokéMZ - tests for the FMOD integration (node --test)
//=============================================================================

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const E = require("../game/js/plugins/PokeMZ_FMOD_Core.js");
const P = require("../game/js/plugins/PokeMZ_FMOD_Profiler.js");

const ROOT = path.join(__dirname, "..", "game");

//=============================================================================
// Engine
//=============================================================================

test("parseArgs splits positional and named arguments", () => {
    const a = E.parseArgs('event:/SFX/Fire x=3 params="Size:2, Type:Camp" loop');
    assert.deepEqual(a.positional, ["event:/SFX/Fire", "loop"]);
    assert.equal(a.named.x, "3");
    assert.equal(a.named.params, "Size:2, Type:Camp");
    assert.deepEqual(E.parseArgs(""), { positional: [], named: {} });
});

test("parseParamList turns numbers into numbers and keeps labels", () => {
    assert.deepEqual(E.parseParamList("Intensity:0.5, Surface:Grass; Wet:1"), { Intensity: 0.5, Surface: "Grass", Wet: 1 });
    assert.deepEqual(E.parseParamList(""), {});
    assert.deepEqual(E.parseParamList({ A: 1 }), { A: 1 });
});

test("noteTags finds every FMOD tag of a kind", () => {
    const note = "<FMOD Bank: Forest, Caves>\n<FMOD Ambient: event:/Amb/Sea region=30>\n<fmod bank: Extra><FMOD Bank>";
    assert.deepEqual(E.noteTags(note, "Bank"), ["Forest, Caves", "Extra", ""]);
    assert.deepEqual(E.noteTags(note, "Ambient"), ["event:/Amb/Sea region=30"]);
    assert.deepEqual(E.noteTags(null, "Bank"), []);
});

test("handedness conversion flips Z only for left-handed", () => {
    assert.deepEqual(E.toFmodVector({ x: 1, y: 2, z: 3 }, "right"), { x: 1, y: 2, z: 3 });
    assert.deepEqual(E.toFmodVector({ x: 1, y: 2, z: 3 }, "left"), { x: 1, y: 2, z: -3 });
    const a = E.makeAttributes({ position: { x: 5, y: 0, z: 7 } }, "left");
    assert.deepEqual(a.position, { x: 5, y: 0, z: -7 });
    assert.deepEqual(a.velocity, { x: 0, y: 0, z: 0 });
    assert.deepEqual(a.forward, { x: 0, y: 0, z: 1 }, "north (-Z) becomes +Z in left-handed space");
    assert.deepEqual(a.up, { x: 0, y: 1, z: 0 });
});

test("error log reports each distinct error once but counts all", () => {
    const log = E.createErrorLog(2);
    assert.equal(log.add("getEvent", 74, "not found"), true);
    assert.equal(log.add("getEvent", 74, "not found"), false);
    assert.equal(log.add("getBus", 74, "not found"), true);
    assert.equal(log.count, 3);
    assert.equal(log.entries.length, 2);
});

test("name mapper: explicit table, conventions, forced fallback, cache", () => {
    let events = new Set(["event:/BGM/Battle1", "event:/Music/Route1", "event:/System/Cursor"]);
    let lookups = 0;
    const mapper = E.createNameMapper({
        explicit: [
            { type: "bgm", name: "Field1", event: "event:/Music/Route1" },
            { type: "any", name: "Battle2", event: "-" },
            { type: "se", name: "Missing", event: "event:/Nope" },
        ],
        conventions: { bgm: "event:/BGM/{name}", se: "event:/SE/{name}", system: "event:/System/{name}" },
        exists: p => {
            lookups++;
            return events.has(p);
        },
    });
    assert.equal(mapper.resolve("bgm", "Field1"), "event:/Music/Route1");
    assert.equal(mapper.resolve("bgm", "Battle1"), "event:/BGM/Battle1");
    assert.equal(mapper.resolve("bgm", "Battle2"), null, '"-" forces the .ogg');
    assert.equal(mapper.resolve("se", "Missing"), null, "missing explicit event falls back to MZ");
    assert.equal(mapper.resolve("system", "Cursor"), "event:/System/Cursor");
    assert.equal(mapper.resolve("me", "Victory1"), null, "no convention");
    assert.equal(mapper.resolve("bgm", ""), null);
    const before = lookups;
    mapper.resolve("bgm", "Battle1");
    assert.equal(lookups, before, "cached");
    events = new Set();
    assert.equal(mapper.resolve("bgm", "Battle1"), "event:/BGM/Battle1", "still cached");
    mapper.clear();
    assert.equal(mapper.resolve("bgm", "Battle1"), null, "re-checked after banks change");
});

test("default overrides merge in order with folder wildcards", () => {
    const rows = [
        { event: "event:/SFX/*", params: "Surface:Grass", volume: "0.8" },
        { event: "event:/SFX/Step", params: "Speed:2", pitch: "1.1" },
        { event: "event:/Other", params: "X:1" },
    ];
    assert.deepEqual(E.resolveDefaults(rows, "event:/SFX/Step"), {
        params: { Surface: "Grass", Speed: 2 },
        volume: 0.8,
        pitch: 1.1,
    });
    assert.deepEqual(E.resolveDefaults(rows, "event:/BGM/A"), { params: {}, volume: 1, pitch: 1 });
});

test("bank manager reference counts and unloads at zero", async () => {
    const calls = [];
    const m = E.createBankManager({
        load: name => {
            calls.push(`load ${name}`);
            return name === "Bad.bank" ? Promise.reject(new Error("bad")) : Promise.resolve({ name });
        },
        unload: name => calls.push(`unload ${name}`),
    });
    const p1 = m.acquire("A.bank");
    const p2 = m.acquire("A.bank");
    assert.equal(m.state("A.bank"), "loading");
    assert.equal(m.busy(), true);
    await Promise.all([p1, p2]);
    assert.equal(m.state("A.bank"), "loaded");
    assert.equal(m.busy(), false);
    assert.deepEqual(calls, ["load A.bank"], "loaded once");
    assert.equal(m.release("A.bank"), false);
    assert.equal(m.release("A.bank"), true);
    assert.equal(m.state("A.bank"), "unloaded");
    assert.deepEqual(calls, ["load A.bank", "unload A.bank"]);

    // Released while still loading: unloaded as soon as it arrives.
    const p3 = m.acquire("B.bank");
    m.release("B.bank");
    await p3;
    assert.equal(m.state("B.bank"), "unloaded");
    assert.ok(calls.includes("unload B.bank"));

    await assert.rejects(m.acquire("Bad.bank"));
    assert.equal(m.state("Bad.bank"), "unloaded", "a failed bank can be retried");
});

test("fades are linear and finish exactly", () => {
    const f = E.createFade(1, 0, 1);
    assert.deepEqual(E.stepFade(f, 500), { value: 0.5, done: false });
    assert.deepEqual(E.stepFade(f, 600), { value: 0, done: true });
    assert.deepEqual(E.stepFade(E.createFade(0, 1, 0), 0), { value: 1, done: true });
});

test("marker names can drive switches, variables and common events", () => {
    assert.deepEqual(E.parseMarkerAction("Switch:12=on"), { type: "switch", id: 12, value: true });
    assert.deepEqual(E.parseMarkerAction("switch: 3 = off"), { type: "switch", id: 3, value: false });
    assert.deepEqual(E.parseMarkerAction("Variable:5=3"), { type: "variable", id: 5, value: 3 });
    assert.deepEqual(E.parseMarkerAction("CommonEvent:7"), { type: "commonevent", id: 7 });
    assert.equal(E.parseMarkerAction("Chorus"), null);
});

test("save state keeps only persistent named handles", () => {
    const handles = [
        { name: "rain", path: "event:/Amb/Rain", persistent: true, scope: "global", volume: 0.5, pitch: 1, params: { Wet: 1 }, timeline: () => 1234 },
        { name: "tmp", path: "event:/X", persistent: false, params: {} },
        { name: "", path: "event:/Y", persistent: true, params: {} },
        { name: "old", path: "event:/Z", persistent: true, stopped: true, params: {} },
    ];
    const s = E.serializeState({
        globals: { TimeOfDay: 18, Weather: "Rain" },
        snapshots: new Map([["snapshot:/Cave", { intensity: 60 }]]),
        handles,
        banks: ["Forest.bank"],
    });
    assert.equal(s.version, 1);
    assert.deepEqual(s.globals, { TimeOfDay: 18, Weather: "Rain" });
    assert.deepEqual(s.snapshots, { "snapshot:/Cave": 60 });
    assert.equal(s.handles.length, 1);
    assert.equal(s.handles[0].timeline, 1234);
    assert.deepEqual(s.handles[0].params, { Wet: 1 });
    assert.deepEqual(s.banks, ["Forest.bank"]);
    assert.doesNotThrow(() => JSON.stringify(s));
});

test("platform overrides replace only filled-in fields", () => {
    const base = { budgetMb: 0, maxChannels: 128, preloadSampleData: false, folder: "audio/fmod/" };
    const out = E.resolvePlatformConfig(base, { budgetMb: "64", maxChannels: "", preloadSampleData: "true", bogus: "1", folder: "x/" });
    assert.deepEqual(out, { budgetMb: 64, maxChannels: 128, preloadSampleData: true, folder: "x/" });
    assert.deepEqual(E.resolvePlatformConfig(base, undefined), base);
    assert.equal(E.resolvePlatformConfig(base, { maxChannels: "abc" }).maxChannels, 128);
});

test("budget eviction picks unpinned, idle, loaded preloads oldest first", () => {
    const entries = [
        { key: "a", state: "loaded", pinned: false, lastUsed: 5000 },
        { key: "b", state: "loaded", pinned: false, lastUsed: 1000 },
        { key: "c", state: "loaded", pinned: true, lastUsed: 0 },
        { key: "d", state: "loading", pinned: false, lastUsed: 0 },
        { key: "e", state: "loaded", pinned: false, lastUsed: 9500 },
        { key: "f", state: "evicted", pinned: false, lastUsed: 0 },
    ];
    assert.deepEqual(E.pickEvictions(entries, 10000, 1000).map(e => e.key), ["b", "a"]);
    assert.deepEqual(E.pickEvictions(entries, 10000, 0).map(e => e.key), ["b", "a", "e"]);
});

test("budget state has hysteresis", () => {
    assert.deepEqual(E.budgetState(50, 0, false), { over: false, started: false, ended: false });
    assert.deepEqual(E.budgetState(101, 100, false), { over: true, started: true, ended: false });
    assert.deepEqual(E.budgetState(95, 100, true), { over: true, started: false, ended: false }, "stays over above 90%");
    assert.deepEqual(E.budgetState(89, 100, true), { over: false, started: false, ended: true });
    assert.deepEqual(E.budgetState(95, 100, false), { over: false, started: false, ended: false });
});

test("profiler ring buffer keeps the newest values", () => {
    const r = P.createRing(3);
    assert.equal(r.last(), undefined);
    [1, 2, 3, 4, 5].forEach(v => r.push(v));
    assert.deepEqual(r.toArray(), [3, 4, 5]);
    assert.equal(r.length, 3);
    assert.equal(r.last(), 5);
});

test("profiler summary averages and peaks numeric fields", () => {
    const sum = P.summarize([
        { t: 0, cpu: 1, mem: 10, name: "x" },
        { t: 16, cpu: 3, mem: 30 },
    ]);
    assert.deepEqual(sum, { cpu: { avg: 2, peak: 3 }, mem: { avg: 20, peak: 30 } });
    assert.deepEqual(P.summarize([]), {});
});

test("profiler event statistics track plays, overlap and time", () => {
    const st = P.createEventStats();
    st.start("event:/A", 0);
    st.start("event:/A", 100);
    st.stop("event:/A", 200);
    st.stop("event:/A", 500);
    st.stop("event:/A", 600); // extra stop is ignored
    st.start("event:/B", 1000);
    const t = st.table(1300);
    assert.deepEqual(t[0], { path: "event:/A", plays: 2, active: 0, peak: 2, totalMs: 500 });
    assert.deepEqual(t[1], { path: "event:/B", plays: 1, active: 1, peak: 1, totalMs: 300 });
});

test("profiler rates handle first samples and counter resets", () => {
    assert.equal(P.rate(undefined, 100, 16), 0);
    assert.equal(P.rate(100, 1100, 500), 2000);
    assert.equal(P.rate(500, 100, 16), 0);
});

//=============================================================================
// Runtime against the real FMOD wasm (silent output)
//=============================================================================

/**
 * @brief Loads js/libs/fmodstudio.js in its own context.
 * @return {Function} FMODModule.
 */
function loadFmodModule() {
    const src = fs.readFileSync(path.join(ROOT, "js/libs/fmodstudio.js"), "utf8");
    const ctx = vm.createContext({ console, setTimeout, clearTimeout, performance, TextDecoder, URL, WebAssembly });
    return vm.runInContext(`${src}\nFMODModule;`, ctx);
}

/**
 * @brief Runs PokeMZ_FMOD_Core with minimal MZ stubs.
 * @param {Object} params Plugin parameters.
 * @return {Object} {api, context}.
 */
function bootCore(params, extra) {
    const real = loadFmodModule();
    const wasmBinary = fs.readFileSync(path.join(ROOT, "js/libs/fmodstudio.wasm"));
    const noop = () => {};
    class FakeXhr {
        open(method, url) {
            this.url = url;
        }
        send() {
            setTimeout(() => {
                const file = path.resolve(ROOT, this.url);
                if (fs.existsSync(file)) {
                    this.status = 200;
                    const b = fs.readFileSync(file);
                    this.response = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
                    this.onload();
                } else {
                    this.status = 404;
                    this.onload();
                }
            }, 0);
        }
    }
    const context = {
        console: { log: noop, warn: noop, error: console.error },
        setTimeout,
        clearTimeout,
        performance,
        XMLHttpRequest: FakeXhr,
        document: { addEventListener: noop, removeEventListener: noop, visibilityState: "visible" },
        addEventListener: noop,
        PluginManager: { parameters: () => params },
        SceneManager: {
            updateMain: noop,
            terminate: noop,
            changeScene: noop,
            isSceneChanging: () => false,
            isCurrentSceneBusy: () => false,
        },
        Scene_Boot: { prototype: { isReady: () => true } },
        FMODModule: m => real(Object.assign(m, { wasmBinary })),
    };
    Object.assign(context, extra || {});
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js/plugins/PokeMZ_FMOD_Core.js"), "utf8"), context);
    const api = context.PokeMZ.FMOD;
    api.outputType = 2; // FMOD_OUTPUTTYPE_NOSOUND
    return { api, context };
}

/**
 * @brief Pumps FMOD updates until cond() is true.
 * @param {Object} api PokeMZ.FMOD.
 * @param {Function} cond Condition.
 * @param {number} [ms=5000] Timeout.
 */
async function until(api, cond, ms = 5000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) {
            throw new Error("timed out");
        }
        api.update();
        await new Promise(r => setTimeout(r, 5));
    }
}

test("runtime: boots real FMOD, survives missing and broken banks", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokemz-fmod-"));
    fs.writeFileSync(path.join(dir, "Junk.bank"), Buffer.from("definitely not a bank"));
    const { api, context } = bootCore({
        folder: dir + "/",
        startupBanks: JSON.stringify(["Master.bank", "Master.strings.bank"]),
        globalDefaults: "TimeOfDay:12, Weather:Clear",
    });
    await until(api, () => api.ready || api.failed);
    assert.equal(api.failed, false);
    assert.equal(api.ready, true);
    assert.match(api.version, /^2\.\d\d\.\d\d$/);
    assert.ok(api.errors.entries.some(e => /Master\.bank/.test(e.what)), "missing bank logged");
    assert.equal(context.Scene_Boot.prototype.isReady(), true, "boot no longer waits");

    // A corrupt bank resolves false instead of throwing.
    let result = null;
    api.loadBank("Junk").then(r => (result = r));
    await until(api, () => result !== null);
    assert.equal(result, false);
    assert.equal(api.banks.state("Junk.bank"), "unloaded");

    // Missing content never throws.
    const h = api.play("event:/Nope", { name: "x" });
    assert.equal(h.valid, false);
    assert.equal(api.handle("x"), null);
    h.setParameter("A", 1).setVolume(0.5).stop(true);
    assert.equal(api.hasEvent("event:/Nope"), false);
    assert.equal(api.setMixerVolume("vca:/BGM", 0.5), false);
    assert.equal(api.startSnapshot("snapshot:/Nope"), false);
    assert.equal(api.setGlobalParameter("Weather", "Rain"), false);
    assert.equal(api.getGlobalParameter("Weather"), "Rain", "remembered for saves");

    // Save state round trip.
    const saved = JSON.parse(JSON.stringify(api.saveState()));
    assert.deepEqual(saved.globals, { TimeOfDay: 12, Weather: "Rain" });
    await api.resetState();
    assert.deepEqual(Object.assign({}, api.globals), { TimeOfDay: 12, Weather: "Clear" });
    await api.restoreState(saved);
    assert.equal(api.globals.Weather, "Rain");

    // Focus handling and unlock work on the real core system.
    api.unlock();
    api.update();
    api.shutdown();
    assert.equal(api.available, false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("runtime: falls back to MZ audio when the library is missing", async () => {
    const context = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout,
        performance,
        document: { addEventListener() {}, removeEventListener() {} },
        PluginManager: { parameters: () => ({}) },
        SceneManager: { updateMain() {}, terminate() {}, changeScene() {} },
        Scene_Boot: { prototype: { isReady: () => true } },
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js/plugins/PokeMZ_FMOD_Core.js"), "utf8"), context);
    const api = context.PokeMZ.FMOD;
    assert.equal(api.failed, true);
    assert.equal(api.available, false);
    assert.equal(context.Scene_Boot.prototype.isReady(), true);
    assert.equal(api.play("event:/A").valid, false);
});

test("the vendored library has the NW.js fix applied", () => {
    const src = fs.readFileSync(path.join(ROOT, "js/libs/fmodstudio.js"), "utf8");
    assert.match(src, /var ENVIRONMENT_IS_NODE=false&&/);
});

test("runtime: memory budget, preloads and the profiler on real FMOD", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokemz-fmod-"));
    const downloads = [];
    const params = {
        PokeMZ_FMOD_Core: {
            folder: dir + "/",
            startupBanks: "[]",
            budgetMb: "4",
            idlePoolKb: "0",
            platforms: JSON.stringify({ browser: JSON.stringify({ budgetMb: "0.1", maxChannels: "32" }) }),
        },
        PokeMZ_FMOD_Profiler: { commandCapture: "true" },
    };
    const { api, context } = bootCore(null, {
        PluginManager: { parameters: name => params[name] || {} },
        Utils: { isOptionValid: () => true, isNwjs: () => false, isMobileDevice: () => false },
        Blob,
        URL,
    });
    await until(api, () => api.ready || api.failed);
    assert.equal(api.platform, "browser");
    assert.equal(api.config.budgetMb, 0.1, "platform override applied");
    assert.equal(api.config.maxChannels, 32);

    const mem = api.memory();
    assert.ok(mem.current > 0 && mem.peak >= mem.current, "FMOD memory stats");
    assert.equal(mem.budget, 0.1 * 1048576);
    assert.ok(mem.heap >= 16 * 1048576);

    // Over budget with nothing to evict: one warning, no exception.
    let budgetEvents = 0;
    api.on("budget", () => budgetEvents++);
    api.enforceBudget();
    api.enforceBudget();
    assert.equal(api.memory().over, true);
    assert.equal(budgetEvents, 1);
    assert.equal(api.errors.entries.filter(e => e.what === "memory budget").length, 1);

    // Preloading something that doesn't exist resolves false.
    assert.equal(await api.preload("event:/Nope"), false);
    let bankResult = null;
    api.preload("Missing").then(r => (bankResult = r));
    await until(api, () => bankResult !== null);
    assert.equal(bankResult, false);
    api.releasePreload("event:/Nope");
    api.releasePreload("Missing");
    assert.equal(api.preloads.size, 0);

    // Profiler: samples from the real system and a command capture.
    context.SceneManager._scene = null;
    context.document.createElement = () => ({ click() { downloads.push(this.download); }, remove() {} });
    context.document.body = { appendChild() {} };
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js/plugins/PokeMZ_FMOD_Profiler.js"), "utf8"), context);
    const prof = api.profiler;
    const sample = prof.takeSample();
    for (const k of ["cpuStudio", "cpuDsp", "memory", "memoryPeak", "heap", "channels", "channelsReal", "instances", "handles", "updateMs"]) {
        assert.equal(typeof sample[k], "number", k);
    }
    assert.equal(prof.start(), true);
    assert.equal(prof.recording, true);
    api.setGlobalParameter("TimeOfDay", 6);
    for (let i = 0; i < 5; i++) {
        api.update();
    }
    const result = await prof.stop();
    assert.equal(prof.recording, false);
    assert.equal(result.data.format, "pokemz-fmod-profile");
    assert.equal(result.data.samples.length, 5);
    assert.ok(result.data.log.some(l => l.type === "globalParameter" && l.name === "TimeOfDay"));
    assert.ok(result.capture && result.capture.length > 0, "command capture bytes");
    assert.equal(downloads.length, 2, "json + command capture downloaded");
    assert.match(downloads[0], /^fmod-profile-.*\.json$/);
    assert.doesNotThrow(() => JSON.stringify(result.data));

    api.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
});
