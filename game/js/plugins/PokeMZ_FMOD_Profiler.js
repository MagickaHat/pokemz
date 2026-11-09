//=============================================================================
// PokéMZ - FMOD_Profiler.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] FMOD profiler: live graphs, event statistics, session
 * log, recordings (JSON) and FMOD command captures.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_FMOD_Core
 * @orderAfter PokeMZ_FMOD_Debug
 *
 * @param panelKey
 * @text Panel Key
 * @desc Shows/hides the profiler panel (with Shift held).
 * @type string
 * @default F6
 *
 * @param recordKey
 * @text Record Key
 * @desc Starts/stops a recording (with Ctrl held).
 * @type string
 * @default F6
 *
 * @param historySeconds
 * @text Graph History (seconds)
 * @type number
 * @min 2
 * @default 10
 *
 * @param maxRecordMinutes
 * @text Max Recording (minutes)
 * @desc A recording stops (and is saved) after this long.
 * @type number
 * @min 1
 * @default 10
 *
 * @param commandCapture
 * @text FMOD Command Capture
 * @desc Also record FMOD's own command capture (.fmodcmd) next to the
 * JSON. Uses memory while recording.
 * @type boolean
 * @default true
 *
 * @param spikeMs
 * @text Spike Threshold (ms)
 * @desc FMOD updates slower than this are logged as spikes.
 * @type number
 * @decimals 1
 * @min 0
 * @default 4
 *
 * @param folder
 * @text Save Folder (NW.js)
 * @desc Folder (next to index.html) receiving recordings. In a browser
 * they are downloaded instead.
 * @type string
 * @default fmod-profiles
 *
 * @param releaseBuild
 * @text Also Outside Playtest
 * @type boolean
 * @default false
 *
 * @help
 * ============================================================================
 * PokeMZ_FMOD_Profiler
 * ============================================================================
 * FMOD's Live Update / Profiler connection doesn't exist in HTML5 builds,
 * so this plugin records the same kind of data inside the game.
 *
 * While playtesting:
 *   Shift+F6   profiler panel: CPU, memory vs budget, channels, update time
 *              graphs, the busiest events and the latest log lines
 *   Ctrl+F6    start / stop a recording. Stopping saves
 *              fmod-profiles/fmod-profile-<date>.json (and .fmodcmd when
 *              command capture is on) in NW.js, or downloads them in a
 *              browser.
 *
 * Every frame records: Studio and core CPU (dsp, stream, update), FMOD
 * memory and peak, wasm heap, channels playing (total / real), live
 * instances, file I/O (sample, stream, other bytes per second), Studio
 * command queue and handle usage, and how long FMOD's update took.
 *
 * The session log has instance starts/stops, banks, preloads, evictions,
 * budget warnings, snapshots, global parameters, markers, scene and map
 * changes, update spikes and errors. Event statistics count plays, peak
 * simultaneous instances and total playing time per event path.
 *
 * The .fmodcmd file is FMOD's command capture (Studio::System::
 * startCommandCapture): it can be replayed with loadCommandReplay to
 * reproduce exactly what the game asked FMOD to do.
 *
 * Console (PokeMZ.FMOD.profiler):
 *   start()  stop() -> Promise   recording  summary()  eventStats()
 *   log  samples()  exportData()  toggle()
 */

(() => {
    "use strict";

    //=========================================================================
    // Engine (pure; also used by tests)
    //=========================================================================

    /**
     * @brief Fixed-size ring buffer.
     * @param {number} size Capacity.
     * @return {Object} {push(v), toArray(), length, last()}.
     */
    function createRing(size) {
        const items = new Array(size);
        let start = 0;
        let length = 0;
        return {
            /** @param {*} v Value to append (drops the oldest when full). */
            push(v) {
                items[(start + length) % size] = v;
                if (length < size) {
                    length++;
                } else {
                    start = (start + 1) % size;
                }
            },
            /** @return {Array} Oldest first. */
            toArray() {
                const out = [];
                for (let i = 0; i < length; i++) {
                    out.push(items[(start + i) % size]);
                }
                return out;
            },
            /** @return {*} Newest value. */
            last() {
                return length ? items[(start + length - 1) % size] : undefined;
            },
            /** @return {number} Stored values. */
            get length() {
                return length;
            },
        };
    }

    /**
     * @brief Average and peak of every numeric field of the samples.
     * @param {Array<Object>} samples Samples.
     * @return {Object<string, {avg: number, peak: number}>} Summary.
     */
    function summarize(samples) {
        const out = {};
        for (const s of samples) {
            for (const [k, v] of Object.entries(s)) {
                if (typeof v !== "number" || k === "t") {
                    continue;
                }
                const o = out[k] || (out[k] = { sum: 0, n: 0, peak: -Infinity });
                o.sum += v;
                o.n++;
                o.peak = Math.max(o.peak, v);
            }
        }
        for (const k of Object.keys(out)) {
            out[k] = { avg: out[k].sum / out[k].n, peak: out[k].peak };
        }
        return out;
    }

    /**
     * @brief Per-event statistics: plays, peak simultaneous instances, time.
     * @return {Object} {start(path, t), stop(path, t), table(now)}.
     */
    function createEventStats() {
        const map = new Map();
        const get = path => {
            if (!map.has(path)) {
                map.set(path, { path, plays: 0, active: 0, peak: 0, totalMs: 0, since: 0 });
            }
            return map.get(path);
        };
        return {
            /**
             * @param {string} path Event path.
             * @param {number} t Time (ms).
             */
            start(path, t) {
                const e = get(path);
                if (e.active === 0) {
                    e.since = t;
                }
                e.plays++;
                e.active++;
                e.peak = Math.max(e.peak, e.active);
            },
            /**
             * @param {string} path Event path.
             * @param {number} t Time (ms).
             */
            stop(path, t) {
                const e = get(path);
                if (e.active <= 0) {
                    return;
                }
                e.active--;
                if (e.active === 0) {
                    e.totalMs += t - e.since;
                }
            },
            /**
             * @param {number} now Current time (ms), to count running time.
             * @return {Array<Object>} Rows, most played first.
             */
            table(now) {
                return Array.from(map.values())
                    .map(e => ({
                        path: e.path,
                        plays: e.plays,
                        active: e.active,
                        peak: e.peak,
                        totalMs: Math.round(e.totalMs + (e.active > 0 ? now - e.since : 0)),
                    }))
                    .sort((a, b) => b.plays - a.plays || b.totalMs - a.totalMs);
            },
            /** @brief Forgets everything. */
            clear() {
                map.clear();
            },
        };
    }

    /**
     * @brief Converts a cumulative counter into a per-second rate.
     * @param {number|undefined} prev Previous counter value.
     * @param {number} cur Current value.
     * @param {number} dtMs Elapsed milliseconds.
     * @return {number} Rate per second (0 on the first sample or a reset).
     */
    function rate(prev, cur, dtMs) {
        if (prev === undefined || dtMs <= 0 || cur < prev) {
            return 0;
        }
        return ((cur - prev) * 1000) / dtMs;
    }

    const Engine = { createRing, summarize, createEventStats, rate };

    if (typeof PluginManager === "undefined") {
        if (typeof module !== "undefined" && module.exports) {
            module.exports = Engine;
        }
        return;
    }

    //=========================================================================
    // Runtime
    //=========================================================================

    const PLUGIN_NAME = "PokeMZ_FMOD_Profiler";
    const FMOD = window.PokeMZ && window.PokeMZ.FMOD;
    if (!FMOD) {
        console.error(`${PLUGIN_NAME}: PokeMZ_FMOD_Core must be enabled above this plugin.`);
        return;
    }
    const params = PluginManager.parameters(PLUGIN_NAME);
    const num = (v, fallback) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? fallback : Number(v));
    const CONFIG = {
        panelKey: params.panelKey || "F6",
        recordKey: params.recordKey || "F6",
        historySeconds: num(params.historySeconds, 10),
        maxRecordMinutes: num(params.maxRecordMinutes, 10),
        commandCapture: params.commandCapture !== "false",
        spikeMs: num(params.spikeMs, 4),
        folder: params.folder || "fmod-profiles",
        releaseBuild: params.releaseBuild === "true",
    };

    const enabled = CONFIG.releaseBuild || (typeof Utils !== "undefined" && Utils.isOptionValid("test"));

    //-------------------------------------------------------------------------
    // Sampling
    //-------------------------------------------------------------------------

    let prevIo = {};
    let prevTime = 0;
    const t0 = performance.now();

    /**
     * @brief Reads one sample of FMOD's counters.
     * @return {Object|null} Sample (times in ms, memory in bytes), or null
     *         when FMOD isn't running.
     */
    function takeSample() {
        const F = FMOD.module;
        const studio = FMOD.studio;
        const core = FMOD.core;
        if (!FMOD.available || !F || !studio || !core) {
            return null;
        }
        const now = performance.now();
        const s = { t: Math.round(now - t0) };
        const read = (what, fn) => {
            try {
                fn();
            } catch (e) {
                FMOD.errors.add(`profiler ${what}`, -1, e.message);
            }
        };
        read("cpu", () => {
            const su = F.STUDIO_CPU_USAGE();
            const cu = F.CPU_USAGE();
            if (studio.getCPUUsage(su, cu) === F.OK) {
                s.cpuStudio = su.update;
                s.cpuDsp = cu.dsp;
                s.cpuStream = cu.stream;
                s.cpuUpdate = cu.update;
            }
        });
        const mem = FMOD.memory();
        s.memory = mem.current;
        s.memoryPeak = mem.peak;
        s.heap = mem.heap;
        read("channels", () => {
            const total = {};
            const real = {};
            if (core.getChannelsPlaying(total, real) === F.OK) {
                s.channels = total.val;
                s.channelsReal = real.val;
            }
        });
        read("file", () => {
            const a = {};
            const b = {};
            const c = {};
            if (core.getFileUsage(a, b, c) === F.OK) {
                const dt = now - prevTime;
                s.ioSample = rate(prevIo.sample, a.val, dt);
                s.ioStream = rate(prevIo.stream, b.val, dt);
                s.ioOther = rate(prevIo.other, c.val, dt);
                prevIo = { sample: a.val, stream: b.val, other: c.val };
            }
        });
        read("buffers", () => {
            const u = F.STUDIO_BUFFER_USAGE();
            if (studio.getBufferUsage(u) === F.OK) {
                s.commandQueue = u["studiocommandqueue.peakusage"] || 0;
                s.handles = u["studiohandle.currentusage"] || 0;
            }
        });
        s.instances = FMOD.live.size;
        s.updateMs = FMOD.timing.updateMs;
        s.studioUpdateMs = FMOD.timing.studioUpdateMs;
        prevTime = now;
        return s;
    }

    //-------------------------------------------------------------------------
    // Session log and event statistics
    //-------------------------------------------------------------------------

    const history = createRing(Math.max(60, Math.round(CONFIG.historySeconds * 60)));
    const log = createRing(500);
    const stats = createEventStats();
    let recording = null;

    /**
     * @brief Appends a log line (also to the recording).
     * @param {string} type Kind of entry.
     * @param {Object} [data] Details.
     */
    function addLog(type, data) {
        if (!enabled) {
            return;
        }
        const entry = Object.assign({ t: Math.round(performance.now() - t0), type }, data || {});
        log.push(entry);
        if (recording) {
            recording.log.push(entry);
        }
    }

    const started = new WeakSet();
    FMOD.on("instanceStarted", h => {
        if (!enabled) {
            return;
        }
        started.add(h);
        stats.start(h.path, performance.now());
        if (recording) {
            recording.stats.start(h.path, performance.now());
        }
        addLog("start", { path: h.path, name: h.name || undefined, owner: h.owner || undefined });
    });
    FMOD.on("stopped", h => {
        if (!started.has(h)) {
            return;
        }
        started.delete(h);
        stats.stop(h.path, performance.now());
        if (recording) {
            recording.stats.stop(h.path, performance.now());
        }
        addLog("stop", { path: h.path });
    });
    FMOD.on("bankLoaded", file => addLog("bankLoaded", { file }));
    FMOD.on("bankUnloaded", file => addLog("bankUnloaded", { file }));
    FMOD.on("bankError", e => addLog("bankError", { file: e.file, error: e.error && e.error.message }));
    FMOD.on("preload", e => addLog("preload", e));
    FMOD.on("evicted", e => addLog("evicted", { key: e.key, memory: e.memory.current }));
    FMOD.on("budget", e => addLog(e.over ? "overBudget" : "underBudget", { memory: e.memory.current, budget: e.memory.budget }));
    FMOD.on("snapshotStarted", path => addLog("snapshotStarted", { path }));
    FMOD.on("snapshotStopped", path => addLog("snapshotStopped", { path }));
    FMOD.on("globalParameter", e => addLog("globalParameter", e));
    FMOD.on("marker", m => addLog("marker", { path: m.handle && m.handle.path, name: m.name, position: m.position }));
    FMOD.on("mapChanged", mapId => addLog("map", { mapId }));
    FMOD.on("error", e => addLog("error", { what: e.what, code: e.code, text: e.text }));

    let lastScene = null;

    FMOD.addHook({
        onUpdate() {
            if (!enabled) {
                return;
            }
            const s = takeSample();
            if (!s) {
                return;
            }
            history.push(s);
            if (recording) {
                recording.samples.push(s);
                if (performance.now() - recording.start > CONFIG.maxRecordMinutes * 60000) {
                    stop();
                }
            }
            if (CONFIG.spikeMs > 0 && s.updateMs > CONFIG.spikeMs) {
                addLog("spike", { updateMs: +s.updateMs.toFixed(2), studioUpdateMs: +s.studioUpdateMs.toFixed(2) });
            }
            const scene = SceneManager._scene && SceneManager._scene.constructor.name;
            if (scene !== lastScene) {
                lastScene = scene;
                addLog("scene", { scene });
            }
        },
    });

    //-------------------------------------------------------------------------
    // Recording, command capture, export
    //-------------------------------------------------------------------------

    let captureId = 0;

    /**
     * @brief Starts FMOD's command capture into a wasm device that streams
     *        the bytes back to JS.
     * @return {Object|null} {chunks, length} collector, or null.
     */
    function startCommandCapture() {
        const F = FMOD.module;
        if (!CONFIG.commandCapture || !F || !F.FS_createDevice) {
            return null;
        }
        const cap = { chunks: [new Uint8Array(65536)], used: 0, length: 0 };
        const name = `fmodcapture${++captureId}`;
        try {
            F.FS_createDevice("/", name, null, byte => {
                if (byte === null || byte === undefined) {
                    return;
                }
                let chunk = cap.chunks[cap.chunks.length - 1];
                if (cap.used === chunk.length) {
                    chunk = new Uint8Array(chunk.length);
                    cap.chunks.push(chunk);
                    cap.used = 0;
                }
                chunk[cap.used++] = byte;
                cap.length++;
            });
            if (!FMOD.check(FMOD.studio.startCommandCapture(`/${name}`, F.STUDIO_COMMANDCAPTURE_NORMAL), "startCommandCapture")) {
                return null;
            }
        } catch (e) {
            FMOD.errors.add("startCommandCapture", -1, e.message);
            return null;
        }
        cap.device = name;
        return cap;
    }

    /**
     * @brief Stops the command capture.
     * @param {Object} cap Collector.
     * @return {Uint8Array|null} Captured bytes.
     */
    function stopCommandCapture(cap) {
        if (!cap) {
            return null;
        }
        try {
            FMOD.check(FMOD.studio.stopCommandCapture(), "stopCommandCapture");
            FMOD.module.FS_unlink(`/${cap.device}`);
        } catch (e) {
            FMOD.errors.add("stopCommandCapture", -1, e.message);
        }
        const out = new Uint8Array(cap.length);
        let offset = 0;
        cap.chunks.forEach((chunk, i) => {
            const n = i === cap.chunks.length - 1 ? cap.used : chunk.length;
            out.set(chunk.subarray(0, n), offset);
            offset += n;
        });
        return out;
    }

    /**
     * @brief Starts a recording.
     * @return {boolean} False if one is running or FMOD isn't available.
     */
    function start() {
        if (recording || !FMOD.available) {
            return false;
        }
        recording = {
            start: performance.now(),
            date: new Date(),
            samples: [],
            log: [],
            stats: createEventStats(),
            capture: startCommandCapture(),
        };
        // Instances already playing count as started now.
        for (const h of FMOD.live) {
            if (h.started && !h.stopped) {
                recording.stats.start(h.path, recording.start);
            }
        }
        addLog("recordStart", { capture: !!recording.capture });
        console.log("PokeMZ_FMOD: profiler recording...");
        return true;
    }

    /**
     * @brief Builds the export object of a recording (or of the history).
     * @param {Object} [rec] Recording; defaults to the live history.
     * @return {Object} JSON-safe profile.
     */
    function exportData(rec) {
        const now = performance.now();
        const samples = rec ? rec.samples : history.toArray();
        return {
            format: "pokemz-fmod-profile",
            version: 1,
            date: (rec ? rec.date : new Date()).toISOString(),
            fmodVersion: FMOD.version,
            platform: FMOD.platform,
            durationMs: Math.round(rec ? now - rec.start : samples.length ? samples[samples.length - 1].t - samples[0].t : 0),
            config: { core: FMOD.config, profiler: CONFIG },
            memory: FMOD.memory(),
            summary: summarize(samples),
            events: (rec ? rec.stats : stats).table(now),
            banks: Array.from(FMOD.banks.banks.values()).map(b => ({ name: b.name, state: b.state, refs: b.refs })),
            preloads: Array.from(FMOD.preloads.values()).map(p => ({ key: p.key, state: p.state, refs: p.refs, pinned: p.pinned })),
            errors: FMOD.errors.entries.slice(),
            log: rec ? rec.log : log.toArray(),
            samples,
        };
    }

    /**
     * @brief Saves a file: into the profile folder under NW.js, as a
     *        download in a browser.
     * @param {string} name File name.
     * @param {string|Uint8Array} data Contents.
     * @return {Promise<string>} Where it went.
     */
    function saveFile(name, data) {
        if (typeof Utils !== "undefined" && Utils.isNwjs()) {
            const fs = require("fs");
            const path = require("path");
            const dir = path.join(path.dirname(process.mainModule.filename), CONFIG.folder);
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, name);
            fs.writeFileSync(file, typeof data === "string" ? data : Buffer.from(data));
            return Promise.resolve(file);
        }
        const blob = new Blob([data], { type: typeof data === "string" ? "application/json" : "application/octet-stream" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return Promise.resolve(`download: ${name}`);
    }

    /**
     * @brief Stops the recording and saves it.
     * @return {Promise<Object|null>} {data, files} or null if not recording.
     */
    function stop() {
        if (!recording) {
            return Promise.resolve(null);
        }
        const rec = recording;
        const capture = stopCommandCapture(rec.capture);
        addLog("recordStop", { samples: rec.samples.length });
        recording = null;
        const data = exportData(rec);
        const stamp = rec.date.toISOString().replace(/[:.]/g, "-");
        const base = `fmod-profile-${stamp}`;
        const saves = [saveFile(`${base}.json`, JSON.stringify(data))];
        if (capture && capture.length) {
            saves.push(saveFile(`${base}.fmodcmd`, capture));
        }
        return Promise.all(saves).then(
            files => {
                console.log("PokeMZ_FMOD: profile saved:", files.join(", "));
                return { data, files, capture };
            },
            e => {
                console.error("PokeMZ_FMOD: could not save the profile", e);
                return { data, files: [], capture };
            }
        );
    }

    //-------------------------------------------------------------------------
    // Panel
    //-------------------------------------------------------------------------

    const GRAPHS = [
        { title: "CPU %", keys: ["cpuStudio", "cpuDsp", "cpuStream"], colors: ["#7cf", "#fc6", "#f8a"], fmt: v => v.toFixed(1) },
        {
            title: "Memory MB",
            keys: ["memory"],
            colors: ["#8f8"],
            scale: 1 / 1048576,
            fmt: v => v.toFixed(1),
            limit: () => FMOD.memory().budget / 1048576,
        },
        { title: "Channels", keys: ["channels", "channelsReal"], colors: ["#ccc", "#7cf"], fmt: v => String(Math.round(v)) },
        { title: "FMOD update ms", keys: ["updateMs", "studioUpdateMs"], colors: ["#fc6", "#7cf"], fmt: v => v.toFixed(2) },
    ];

    let panel = null;
    let timer = null;

    /**
     * @brief Draws one graph.
     * @param {CanvasRenderingContext2D} ctx Context.
     * @param {Object} g Graph description.
     * @param {Array<Object>} samples Samples.
     * @param {number} y Top.
     * @param {number} w Width.
     * @param {number} h Height.
     */
    function drawGraph(ctx, g, samples, y, w, h) {
        const scale = g.scale || 1;
        const limit = g.limit ? g.limit() : 0;
        let max = limit > 0 ? limit * 1.1 : 0;
        for (const s of samples) {
            for (const k of g.keys) {
                max = Math.max(max, (s[k] || 0) * scale);
            }
        }
        max = max || 1;
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(0, y, w, h);
        if (limit > 0) {
            const ly = y + h - (limit / max) * h;
            ctx.strokeStyle = "#f55";
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(0, ly);
            ctx.lineTo(w, ly);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        g.keys.forEach((k, i) => {
            ctx.strokeStyle = g.colors[i];
            ctx.beginPath();
            samples.forEach((s, x) => {
                const px = (x / Math.max(1, samples.length - 1)) * w;
                const py = y + h - (((s[k] || 0) * scale) / max) * h;
                if (x === 0) {
                    ctx.moveTo(px, py);
                } else {
                    ctx.lineTo(px, py);
                }
            });
            ctx.stroke();
        });
        const last = samples[samples.length - 1] || {};
        ctx.fillStyle = "#dfe";
        ctx.fillText(
            `${g.title}: ${g.keys.map(k => g.fmt((last[k] || 0) * scale)).join(" / ")}  (max ${g.fmt(max)}${limit > 0 ? `, budget ${g.fmt(limit)}` : ""})`,
            4,
            y + 11
        );
    }

    /** @brief Redraws the panel. */
    function draw() {
        if (!panel) {
            return;
        }
        const samples = history.toArray();
        const canvas = panel.querySelector("canvas");
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = "10px monospace";
        const gh = 46;
        GRAPHS.forEach((g, i) => drawGraph(ctx, g, samples, i * (gh + 4), canvas.width, gh));
        const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
        const rows = stats
            .table(performance.now())
            .slice(0, 8)
            .map(e => `${esc(e.path)}  x${e.plays}  peak ${e.peak}  ${(e.totalMs / 1000).toFixed(1)}s${e.active ? "  ▶" : ""}`);
        const lines = log
            .toArray()
            .slice(-6)
            .map(l => `${(l.t / 1000).toFixed(1)}s ${esc(l.type)} ${esc(l.path || l.file || l.key || l.name || l.scene || l.what || "")}`);
        const rec = recording ? `<span style="color:#f66">● REC ${((performance.now() - recording.start) / 1000).toFixed(0)}s</span>` : "Ctrl+F6 to record";
        panel.querySelector("div").innerHTML =
            `<b>FMOD profiler</b> ${FMOD.platform} ${rec}<br><b>Events</b><br>${rows.join("<br>") || "-"}<br><b>Log</b><br>${lines.join("<br>")}`;
    }

    /** @brief Shows or hides the panel. */
    function toggle() {
        if (panel) {
            clearInterval(timer);
            panel.remove();
            panel = null;
            return;
        }
        panel = document.createElement("div");
        panel.id = "pokemz-fmod-profiler";
        panel.style.cssText =
            "position:fixed;right:4px;top:4px;z-index:1001;width:340px;padding:6px;background:rgba(0,0,0,0.8);" +
            "color:#dfe;font:10px/1.35 monospace;pointer-events:none;border-radius:4px;white-space:nowrap;overflow:hidden";
        const canvas = document.createElement("canvas");
        canvas.width = 340;
        canvas.height = GRAPHS.length * 50;
        panel.appendChild(canvas);
        panel.appendChild(document.createElement("div"));
        document.body.appendChild(panel);
        draw();
        timer = setInterval(draw, 250);
    }

    FMOD.profiler = {
        engine: Engine,
        config: CONFIG,
        takeSample,
        start,
        stop,
        toggle,
        exportData: () => exportData(recording),
        /** @return {boolean} True while recording. */
        get recording() {
            return !!recording;
        },
        /** @return {Array<Object>} The graph history. */
        samples: () => history.toArray(),
        /** @return {Object} Average/peak of the history. */
        summary: () => summarize(history.toArray()),
        /** @return {Array<Object>} Event statistics of the session. */
        eventStats: () => stats.table(performance.now()),
        log,
    };

    if (!enabled) {
        return;
    }
    const toggleRecording = () => {
        if (recording) {
            stop();
        } else {
            start();
        }
    };
    const PInput = window.PokeMZ && window.PokeMZ.Input;
    if (PInput) {
        PInput.registerHotkey({ key: CONFIG.panelKey, shift: true, label: "FMOD profiler" }, () => toggle());
        PInput.registerHotkey({ key: CONFIG.recordKey, ctrl: true, label: "FMOD record" }, toggleRecording);
    } else {
        document.addEventListener("keydown", e => {
            if (e.repeat) {
                return;
            }
            if (e.key === CONFIG.panelKey && e.shiftKey) {
                toggle();
                e.preventDefault();
                e.stopImmediatePropagation();
            } else if (e.key === CONFIG.recordKey && e.ctrlKey) {
                toggleRecording();
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }, true);
    }
})();
