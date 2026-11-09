//=============================================================================
// PokéMZ - FMOD_Debug.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] FMOD debug overlay and console tools (playtest only).
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_FMOD_Core
 * @orderAfter PokeMZ_FMOD_Spatial
 *
 * @param key
 * @text Toggle Key
 * @desc Keyboard key (KeyboardEvent.key) that shows/hides the overlay.
 * @type string
 * @default F6
 *
 * @param showOnStart
 * @text Show On Start
 * @type boolean
 * @default false
 *
 * @param releaseBuild
 * @text Also Outside Playtest
 * @desc Enable the overlay in deployed games too (not recommended).
 * @type boolean
 * @default false
 *
 * @help
 * ============================================================================
 * PokeMZ_FMOD_Debug
 * ============================================================================
 * Press F6 while playtesting for an overlay with: FMOD version and status,
 * CPU, memory against the budget, preloads, banks and their state, live event instances (path, owner,
 * state, volume, parameters, distance), listener, global parameters,
 * snapshots, focus state and the latest errors.
 *
 * Console (PokeMZ.FMOD.debug):
 *   listEvents()        paths of every event in the loaded banks
 *   info(path)          oneShot, 3D, length, distances, parameters
 *   play(path, opts)    play any event (returns the Handle)
 *   stopAll()           stop everything, BGM included
 *   errors()            error log
 *   toggle()            show/hide the overlay
 *
 * FMOD's Live Update / Profiler is not available in HTML5 builds: use
 * PokeMZ_FMOD_Profiler (Shift+F6 panel, Ctrl+F6 recordings) instead.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_FMOD_Debug";
    const FMOD = window.PokeMZ && window.PokeMZ.FMOD;
    if (!FMOD) {
        console.error(`${PLUGIN_NAME}: PokeMZ_FMOD_Core must be enabled above this plugin.`);
        return;
    }
    const params = PluginManager.parameters(PLUGIN_NAME);
    const CONFIG = {
        key: params.key || "F6",
        showOnStart: params.showOnStart === "true",
        releaseBuild: params.releaseBuild === "true",
    };

    const STATES = ["playing", "sustaining", "stopped", "starting", "stopping"];

    /**
     * @brief Paths of every event in the loaded banks.
     * @return {Array<string>} Sorted event paths.
     */
    function listEvents() {
        const studio = FMOD.studio;
        const F = FMOD.module;
        const paths = new Set();
        if (!studio) {
            return [];
        }
        for (const entry of FMOD.banks.banks.values()) {
            const bank = entry.bank;
            if (!bank) {
                continue;
            }
            try {
                const count = {};
                if (bank.getEventCount(count) !== F.OK || !count.val) {
                    continue;
                }
                const list = {};
                bank.getEventList(list, count.val, {});
                for (const desc of list.val || []) {
                    const path = {};
                    if (desc.getPath(path, 512, {}) === F.OK) {
                        paths.add(path.val);
                    }
                }
            } catch (e) {
                FMOD.errors.add("listEvents", -1, e.message);
            }
        }
        return Array.from(paths).sort();
    }

    /**
     * @brief Reads CPU and memory usage.
     * @return {Object} {studio, dsp, stream, update, memory, memoryMax}.
     */
    function stats() {
        const F = FMOD.module;
        const out = {};
        try {
            const s = F.STUDIO_CPU_USAGE();
            const c = F.CPU_USAGE();
            if (FMOD.studio.getCPUUsage(s, c) === F.OK) {
                Object.assign(out, { studio: s.update, dsp: c.dsp, stream: c.stream, update: c.update });
            }
            const cur = {};
            const max = {};
            if (F.Memory_GetStats(cur, max, false) === F.OK) {
                out.memory = cur.val;
                out.memoryMax = max.val;
            }
        } catch (e) {
            // Stats are optional.
        }
        return out;
    }

    const fmt = (n, d = 1) => (typeof n === "number" ? n.toFixed(d) : "-");
    const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    const vec = v => (v ? `${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)}` : "-");

    /**
     * @brief Distance of a handle from the listener's attenuation point.
     * @param {Handle} h Handle.
     * @return {string} Distance text.
     */
    function distanceOf(h) {
        const sp = FMOD.spatial;
        if (!sp || !h.worldPosition) {
            return "2D";
        }
        const a = sp.listener.attenuation || sp.listener.position;
        const p = h.worldPosition;
        return fmt(Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z));
    }

    /**
     * @brief Builds the overlay HTML.
     * @return {string} HTML.
     */
    function render() {
        const rows = [];
        const status = FMOD.failed ? "FAILED (MZ audio)" : FMOD.ready ? "ready" : FMOD.available ? "loading banks" : "starting";
        rows.push(`<b>FMOD ${esc(FMOD.version || "")}</b> ${status}`);
        if (FMOD.available) {
            const s = stats();
            const m = FMOD.memory();
            const mb = n => fmt(n / 1048576);
            const budget = m.budget > 0 ? ` budget ${mb(m.budget)}` : "";
            const color = m.over ? "#f88" : "inherit";
            rows.push(`CPU studio ${fmt(s.studio)}% dsp ${fmt(s.dsp)}% stream ${fmt(s.stream)}%`);
            rows.push(
                `<span style="color:${color}">mem ${mb(m.current)} MB (peak ${mb(m.peak)}${budget}${m.over ? " OVER" : ""})</span>` +
                    ` heap ${mb(m.heap)} MB | ${FMOD.platform}`
            );
            const pre = Array.from(FMOD.preloads.values());
            if (pre.length) {
                rows.push(`preloads: ${esc(pre.map(p => `${p.key} ${p.state}${p.pinned ? " pinned" : ""}`).join(", "))}`);
            }
        }
        const focus = FMOD.focusState();
        rows.push(`focus: hidden=${focus.hidden} blurred=${focus.blurred} applied=${focus.applied}`);
        rows.push("<b>Banks</b>");
        for (const e of FMOD.banks.banks.values()) {
            rows.push(`&nbsp;${esc(e.name)} - ${e.state} (refs ${e.refs})`);
        }
        rows.push(`<b>Instances</b> (${FMOD.live.size})`);
        for (const h of FMOD.live) {
            const params = Object.entries(h.params)
                .map(([k, v]) => `${k}=${v}`)
                .join(" ");
            const state = STATES[h.playbackState()] || "?";
            rows.push(
                `&nbsp;${esc(h.path)}${h.name ? ` [${esc(h.name)}]` : ""} ${h.owner || h.scope} ${state}` +
                    `${h.paused ? " paused" : ""} vol ${fmt(h.volume * h.gain * h.fadeValue, 2)} d ${distanceOf(h)}` +
                    (params ? ` <i>${esc(params)}</i>` : "")
            );
        }
        if (FMOD.spatial) {
            const l = FMOD.spatial.listener;
            rows.push(`<b>Listener</b> pos ${vec(l.position)} fwd ${vec(l.forward)} atten ${vec(l.attenuation)}`);
            rows.push(`emitters: ${FMOD.spatial.emitters.size}`);
        }
        const globals = Object.entries(FMOD.globals);
        if (globals.length) {
            rows.push(`<b>Globals</b> ${esc(globals.map(([k, v]) => `${k}=${v}`).join(" "))}`);
        }
        if (FMOD.snapshots.size) {
            rows.push(`<b>Snapshots</b> ${esc(Array.from(FMOD.snapshots.keys()).join(", "))}`);
        }
        const errs = FMOD.errors.entries.slice(-5);
        if (errs.length) {
            rows.push(`<b>Errors</b> (${FMOD.errors.count})`);
            for (const e of errs) {
                rows.push(`&nbsp;<span style="color:#f88">${esc(e.what)}: ${esc(e.text)}</span>`);
            }
        }
        return rows.join("<br>");
    }

    let panel = null;
    let timer = null;

    /** @brief Shows or hides the overlay. */
    function toggle() {
        if (panel) {
            clearInterval(timer);
            panel.remove();
            panel = null;
            return;
        }
        panel = document.createElement("div");
        panel.id = "pokemz-fmod-debug";
        panel.style.cssText =
            "position:fixed;left:4px;top:4px;z-index:1000;max-width:60vw;max-height:90vh;overflow:auto;" +
            "padding:6px 8px;background:rgba(0,0,0,0.75);color:#dfe;font:11px/1.35 monospace;" +
            "pointer-events:none;border-radius:4px;white-space:nowrap";
        document.body.appendChild(panel);
        const draw = () => {
            panel.innerHTML = render();
        };
        draw();
        timer = setInterval(draw, 250);
    }

    FMOD.debug = {
        listEvents,
        info: path => FMOD.eventInfo(path),
        play: (path, opts) => FMOD.play(path, opts),
        stopAll: () => FMOD.stopAll(true, true),
        errors: () => FMOD.errors.entries.slice(),
        stats,
        render,
        toggle,
    };

    const enabled = CONFIG.releaseBuild || Utils.isOptionValid("test");
    if (!enabled) {
        return;
    }
    document.addEventListener("keydown", e => {
        if (e.key === CONFIG.key && !e.repeat && !e.shiftKey && !e.ctrlKey) {
            toggle();
            e.preventDefault();
        }
    });
    if (CONFIG.showOnStart) {
        const start = () => (document.body ? toggle() : setTimeout(start, 100));
        start();
    }
})();
