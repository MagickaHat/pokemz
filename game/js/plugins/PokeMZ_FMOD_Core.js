//=============================================================================
// PokéMZ - FMOD_Core.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] FMOD Studio runtime: startup, banks, event instances,
 * parameters, snapshots, mixer, callbacks and programmer sounds.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 *
 * @param folder
 * @text Bank Folder
 * @desc Folder holding the built .bank files.
 * @type string
 * @default audio/fmod/
 *
 * @param startupBanks
 * @text Startup Banks
 * @desc Loaded before the title screen and never unloaded. The strings bank
 * is needed to look events up by path.
 * @type string[]
 * @default ["Master.bank","Master.strings.bank"]
 *
 * @param preloadSampleData
 * @text Preload Startup Samples
 * @desc Decompress all samples of the startup banks up front (more memory,
 * no first-play delay).
 * @type boolean
 * @default false
 *
 * @param encryptionKey
 * @text Bank Encryption Key
 * @desc Only if the banks were built with an encryption key in FMOD Studio.
 * @type string
 * @default
 *
 * @param maxChannels
 * @text Max Channels
 * @type number
 * @min 16
 * @default 128
 *
 * @param memoryMb
 * @text Initial Memory (MB)
 * @desc Starting heap for the FMOD wasm module. It grows when needed.
 * @type number
 * @min 16
 * @default 64
 *
 * @param dspBufferLength
 * @text DSP Buffer Length
 * @desc Samples per mix block. Browsers need large blocks (2048) to avoid
 * crackling; lower values reduce latency.
 * @type select
 * @option 512
 * @option 1024
 * @option 2048
 * @option 4096
 * @default 2048
 *
 * @param dspBufferCount
 * @text DSP Buffer Count
 * @type number
 * @min 2
 * @max 8
 * @default 2
 *
 * @param handedness
 * @text 3D Handedness
 * @desc Coordinate system of positions passed to FMOD. "right" matches
 * Three.js (+X east, +Y up, -Z north). "left" flips Z.
 * @type select
 * @option right
 * @option left
 * @default right
 *
 * @param dopplerScale
 * @text Doppler Scale
 * @type number
 * @decimals 2
 * @min 0
 * @default 1.00
 *
 * @param distanceFactor
 * @text Tiles Per Meter
 * @desc Map units (tiles) per meter. Event min/max distances authored in
 * FMOD Studio are in these units.
 * @type number
 * @decimals 2
 * @min 0.01
 * @default 1.00
 *
 * @param rolloffScale
 * @text Rolloff Scale
 * @type number
 * @decimals 2
 * @min 0
 * @default 1.00
 *
 * @param globalDefaults
 * @text Global Parameter Defaults
 * @desc Applied at startup and on New Game, e.g. "TimeOfDay:12, Weather:Clear"
 * (a non-number is a label).
 * @type string
 * @default
 *
 * @param eventDefaults
 * @text Event Default Overrides
 * @desc Parameter values, volume and pitch applied to every new instance
 * of an event.
 * @type struct<EventDefault>[]
 * @default []
 *
 * @param whenHidden
 * @text When Tab/Window Hidden
 * @type select
 * @option mute
 * @option pause
 * @option none
 * @default mute
 *
 * @param whenUnfocused
 * @text When Window Unfocused
 * @type select
 * @option mute
 * @option pause
 * @option none
 * @default none
 *
 * @param bootTimeout
 * @text Boot Timeout (seconds)
 * @desc Give up waiting for FMOD after this long and use MZ audio.
 * @type number
 * @min 1
 * @default 15
 *
 * @param memory
 * @text Memory
 *
 * @param budgetMb
 * @text Memory Budget (MB)
 * @parent memory
 * @desc FMOD memory (samples, streams, instances) above which preloaded
 * sample data is unloaded, least recently used first. 0 = no budget.
 * @type number
 * @decimals 1
 * @min 0
 * @default 0
 *
 * @param evictAfter
 * @text Evict After (seconds unused)
 * @parent memory
 * @desc Preloads used more recently than this are never unloaded.
 * @type number
 * @min 0
 * @default 10
 *
 * @param idlePoolKb
 * @text Idle Sample Pool (KB)
 * @parent memory
 * @desc Recently released sample data FMOD keeps for quick replay
 * (FMOD default 256). 0 = free at once.
 * @type number
 * @min 0
 * @default 256
 *
 * @param platforms
 * @text Platform Overrides
 * @parent memory
 * @desc Per-platform values; empty fields keep the settings above.
 * Desktop = NW.js, Mobile = phones/tablets, Browser = everything else.
 * @type struct<Platforms>
 * @default {"desktop":"{}","browser":"{}","mobile":"{\"budgetMb\":\"64\",\"maxChannels\":\"48\",\"idlePoolKb\":\"0\"}"}
 *
 * @help
 * ============================================================================
 * PokeMZ_FMOD_Core
 * ============================================================================
 * Runs FMOD Studio (js/libs/fmodstudio.js + .wasm, HTML5 build 2.03) inside
 * MZ. Put this plugin above the other PokeMZ_FMOD_* plugins. It does nothing
 * to MZ's audio on its own: PokeMZ_FMOD_Audio routes BGM/BGS/ME/SE to FMOD.
 *
 * Without banks (or if FMOD fails to start) the game keeps running with MZ's
 * normal .ogg audio. Setup steps and Studio conventions: audio/fmod/README.md.
 *
 * NW.js note: js/libs/fmodstudio.js must contain
 *   var ENVIRONMENT_IS_NODE=false&&typeof process=="object"...
 * (re-apply this one edit after upgrading FMOD, see audio/fmod/README.md).
 *
 * Script API (window.PokeMZ.FMOD):
 *   available  ready  version
 *   loadBank(name, {sampleData})  -> Promise     unloadBank(name)
 *   play(path, opts) -> Handle   oneShot(path, opts)   create(path, opts)
 *   handle(name)  stop(name, immediate)  stopScope(scope)  stopAll()
 *   setGlobalParameter(name, value)  getGlobalParameter(name)
 *   startSnapshot(path, intensity)  stopSnapshot(path, immediate)
 *   setMixerVolume("vca:/SE" | "bus:/Music", v)  setMixerPaused / Mute
 *   playProgrammer(path, key, opts)
 *   on(type, fn): ready, bankLoaded, bankError, marker, beat, stopped, error
 *
 * Memory:
 *   preload(target, {pinned}) -> Promise<boolean>   (event path or bank)
 *   releasePreload(target)  memory() -> {current, peak, budget, ...}
 *   platform -> "desktop" | "browser" | "mobile"  (?fmodPlatform=mobile
 *   in playtest pretends to be another platform)
 * Sample data of an event loads when an instance is created and unloads
 * when the last one is released. Preloading keeps it (no first-play
 * delay). With a Memory Budget, preloads unused for "Evict After" seconds
 * are dropped, oldest first, while FMOD uses more than the budget; they
 * come back the next time the event plays. Pinned preloads stay.
 *
 * Handle opts: name, scope (global | map | scene), persistent, volume,
 * pitch, params {Name: value}, position {x,y,z}, follow () => {position,
 * velocity, forward, up}, programmerKey, timeline (ms), fadeIn (seconds).
 * Handle: start stop pause resume setVolume setPitch fadeTo setParameter
 * getParameter keyOff setTimeline timeline isPlaying on(type, fn) release.
 *
 * FMOD Studio by Firelight Technologies Pty Ltd.
 */

/*~struct~Platforms:
 * @param desktop
 * @text Desktop (NW.js)
 * @type struct<Platform>
 * @default {}
 *
 * @param browser
 * @text Browser
 * @type struct<Platform>
 * @default {}
 *
 * @param mobile
 * @text Mobile
 * @type struct<Platform>
 * @default {"budgetMb":"64","maxChannels":"48","idlePoolKb":"0"}
 */

/*~struct~Platform:
 * @param budgetMb
 * @text Memory Budget (MB)
 * @type number
 * @decimals 1
 * @min 0
 *
 * @param maxChannels
 * @text Max Channels
 * @type number
 * @min 16
 *
 * @param memoryMb
 * @text Initial Memory (MB)
 * @type number
 * @min 16
 *
 * @param idlePoolKb
 * @text Idle Sample Pool (KB)
 * @type number
 * @min 0
 *
 * @param dspBufferLength
 * @text DSP Buffer Length
 * @type select
 * @option
 * @option 512
 * @option 1024
 * @option 2048
 * @option 4096
 *
 * @param preloadSampleData
 * @text Preload Startup Samples
 * @type select
 * @option
 * @option true
 * @option false
 */

/*~struct~EventDefault:
 * @param event
 * @text Event Path
 * @type string
 * @default event:/
 *
 * @param params
 * @text Parameters
 * @desc e.g. "Intensity:0.5, Surface:Grass"
 * @type string
 * @default
 *
 * @param volume
 * @text Volume (0-1)
 * @type number
 * @decimals 2
 * @min 0
 * @default 1.00
 *
 * @param pitch
 * @text Pitch (multiplier)
 * @type number
 * @decimals 2
 * @min 0
 * @default 1.00
 */

(() => {
    "use strict";

    //=========================================================================
    // Engine (pure: no MZ, DOM or FMOD globals; also used by tests)
    //=========================================================================

    /**
     * @brief Splits note-tag arguments: "event:/A x=3 param=Flow:0.5 loop"
     *        gives positional ["event:/A", "loop"] and named {x: "3",
     *        param: "Flow:0.5"}. Double quotes keep spaces.
     * @param {string} text Argument text.
     * @return {{positional: Array<string>, named: Object<string, string>}} Parsed arguments.
     */
    function parseArgs(text) {
        const out = { positional: [], named: {} };
        const re = /"([^"]*)"|(\S+)/g;
        let m;
        while ((m = re.exec(String(text || "")))) {
            const token = m[1] !== undefined ? m[1] : m[2];
            const eq = m[1] === undefined ? token.indexOf("=") : -1;
            if (eq > 0) {
                let value = token.slice(eq + 1);
                if (value.startsWith('"')) {
                    const close = text.indexOf('"', m.index + eq + 2);
                    value = text.slice(m.index + eq + 2, close < 0 ? undefined : close);
                    re.lastIndex = close < 0 ? text.length : close + 1;
                }
                out.named[token.slice(0, eq).toLowerCase()] = value;
            } else {
                out.positional.push(token);
            }
        }
        return out;
    }

    /**
     * @brief Parses "A:1, B:Label" into {A: 1, B: "Label"} (numbers become
     *        numbers, anything else is a label).
     * @param {string|Object} text Parameter list (objects pass through).
     * @return {Object<string, number|string>} Parameters.
     */
    function parseParamList(text) {
        if (text && typeof text === "object") {
            return Object.assign({}, text);
        }
        const out = {};
        for (const part of String(text || "").split(/[,;]/)) {
            const i = part.indexOf(":");
            if (i <= 0) {
                continue;
            }
            const name = part.slice(0, i).trim();
            const raw = part.slice(i + 1).trim();
            const num = Number(raw);
            out[name] = raw !== "" && Number.isFinite(num) ? num : raw;
        }
        return out;
    }

    /**
     * @brief Finds every <FMOD Tag: args> (or <FMOD Tag>) in a note or comment.
     * @param {string} note Note text.
     * @param {string} tag Tag name after "FMOD", case-insensitive.
     * @return {Array<string>} Argument strings, one per occurrence.
     */
    function noteTags(note, tag) {
        const out = [];
        const re = new RegExp(`<FMOD[ _]${tag}(?:\\s*:\\s*([^>]*))?>`, "gi");
        let m;
        while ((m = re.exec(String(note || "")))) {
            out.push((m[1] || "").trim());
        }
        return out;
    }

    /**
     * @brief Converts a right-handed (Three.js) vector to the handedness FMOD
     *        was initialised with.
     * @param {{x: number, y: number, z: number}} v Vector (right-handed).
     * @param {string} handedness "right" or "left".
     * @return {{x: number, y: number, z: number}} New vector for FMOD.
     */
    function toFmodVector(v, handedness) {
        const x = +v.x || 0;
        const y = +v.y || 0;
        const z = +v.z || 0;
        return { x, y, z: handedness === "left" ? 0 - z : z };
    }

    /**
     * @brief Builds a full FMOD_3D_ATTRIBUTES object (FMOD rejects partial ones).
     * @param {Object} a {position, velocity, forward, up}; missing parts use
     *        zero velocity, forward -Z (north) and up +Y.
     * @param {string} handedness "right" or "left".
     * @return {Object} Attributes ready for set3DAttributes / setListenerAttributes.
     */
    function makeAttributes(a, handedness) {
        return {
            position: toFmodVector(a.position || {}, handedness),
            velocity: toFmodVector(a.velocity || {}, handedness),
            forward: toFmodVector(a.forward || { x: 0, y: 0, z: -1 }, handedness),
            up: toFmodVector(a.up || { x: 0, y: 1, z: 0 }, handedness),
        };
    }

    /**
     * @brief Error log that reports each distinct message once and keeps the
     *        most recent entries for the debug overlay.
     * @param {number} [limit=50] Entries kept.
     * @return {Object} {add(what, code, text) -> boolean firstTime, entries, count}.
     */
    function createErrorLog(limit = 50) {
        const seen = new Set();
        return {
            entries: [],
            count: 0,
            /**
             * @brief Records an error.
             * @param {string} what The call that failed.
             * @param {number} code FMOD_RESULT.
             * @param {string} text Readable message.
             * @return {boolean} True the first time this exact error is seen.
             */
            add(what, code, text) {
                this.count++;
                const key = `${what}|${code}`;
                this.entries.push({ what, code, text, time: Date.now() });
                if (this.entries.length > limit) {
                    this.entries.shift();
                }
                if (seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            },
        };
    }

    /**
     * @brief Resolves MZ audio names to FMOD event paths.
     *
     * Order: explicit table ("bgm/Battle1" or "Battle1" for any category) ->
     * convention ("event:/BGM/{name}") -> null (fall back to MZ). Results are
     * cached until clear() (called whenever banks change).
     * @param {Object} options {explicit: Array<{type, name, event}>,
     *        conventions: {bgm: "event:/BGM/{name}", ...}, exists(path) -> boolean}.
     * @return {{resolve: Function, clear: Function}} The mapper.
     */
    function createNameMapper(options) {
        const explicit = new Map();
        for (const row of options.explicit || []) {
            if (!row || !row.name || !row.event) {
                continue;
            }
            const type = String(row.type || "any").toLowerCase();
            explicit.set(`${type}/${row.name}`, row.event);
        }
        const conventions = options.conventions || {};
        const cache = new Map();
        return {
            /**
             * @brief Finds the event for an MZ sound.
             * @param {string} type bgm, bgs, me, se or system.
             * @param {string} name File name without extension.
             * @return {string|null} Event path, or null to use MZ audio.
             */
            resolve(type, name) {
                if (!name) {
                    return null;
                }
                const key = `${type}/${name}`;
                if (cache.has(key)) {
                    return cache.get(key);
                }
                let path = explicit.get(key) || explicit.get(`any/${name}`) || null;
                if (path === "-" || path === "none") {
                    path = null; // explicitly forced to MZ audio
                } else if (path && !options.exists(path)) {
                    path = null;
                } else if (!path && conventions[type]) {
                    const guess = conventions[type].replace(/\{name\}/g, name);
                    path = options.exists(guess) ? guess : null;
                }
                cache.set(key, path);
                return path;
            },
            /** @brief Forgets cached lookups (banks changed). */
            clear() {
                cache.clear();
            },
        };
    }

    /**
     * @brief Merges the default overrides that apply to an event path. Later
     *        rows win; a row's event may end in "*" to match a folder.
     * @param {Array<Object>} rows {event, params, volume, pitch} rows.
     * @param {string} path Event path.
     * @return {{params: Object, volume: number, pitch: number}} Merged defaults.
     */
    function resolveDefaults(rows, path) {
        const out = { params: {}, volume: 1, pitch: 1 };
        for (const row of rows || []) {
            const ev = String(row.event || "");
            const match = ev.endsWith("*") ? path.startsWith(ev.slice(0, -1)) : ev === path;
            if (!match) {
                continue;
            }
            Object.assign(out.params, parseParamList(row.params));
            if (row.volume !== undefined && row.volume !== "") {
                out.volume = Number(row.volume);
            }
            if (row.pitch !== undefined && row.pitch !== "") {
                out.pitch = Number(row.pitch);
            }
        }
        return out;
    }

    /**
     * @brief Reference-counted bank loading on top of an async loader.
     * @param {Object} io {load(name) -> Promise<bank>, unload(name, bank)}.
     * @return {Object} The manager.
     */
    function createBankManager(io) {
        const banks = new Map();
        return {
            banks,
            /**
             * @brief Adds a reference and loads the bank if needed.
             * @param {string} name Bank file name.
             * @param {Object} [opts] Passed to io.load.
             * @return {Promise<*>} Resolves with the bank (rejects on error).
             */
            acquire(name, opts) {
                let entry = banks.get(name);
                if (!entry) {
                    entry = { name, refs: 0, state: "loading", bank: null, error: null };
                    entry.promise = Promise.resolve()
                        .then(() => io.load(name, opts))
                        .then(
                            bank => {
                                entry.bank = bank;
                                if (entry.refs > 0) {
                                    entry.state = "loaded";
                                } else {
                                    // Released while loading.
                                    banks.delete(name);
                                    io.unload(name, bank);
                                }
                                return bank;
                            },
                            error => {
                                entry.state = "error";
                                entry.error = error;
                                banks.delete(name);
                                throw error;
                            }
                        );
                    banks.set(name, entry);
                }
                entry.refs++;
                return entry.promise;
            },
            /**
             * @brief Drops a reference; unloads at zero.
             * @param {string} name Bank file name.
             * @return {boolean} True if the bank was unloaded (or will be).
             */
            release(name) {
                const entry = banks.get(name);
                if (!entry) {
                    return false;
                }
                entry.refs = Math.max(0, entry.refs - 1);
                if (entry.refs > 0) {
                    return false;
                }
                if (entry.state === "loaded") {
                    banks.delete(name);
                    io.unload(name, entry.bank);
                }
                return true;
            },
            /**
             * @param {string} name Bank file name.
             * @return {string} "loading", "loaded" or "unloaded".
             */
            state(name) {
                const entry = banks.get(name);
                return entry ? entry.state : "unloaded";
            },
            /** @return {boolean} True while any bank is still loading. */
            busy() {
                for (const entry of banks.values()) {
                    if (entry.state === "loading" && entry.refs > 0) {
                        return true;
                    }
                }
                return false;
            },
        };
    }

    /**
     * @brief Linear volume fade.
     * @param {number} from Start factor.
     * @param {number} to End factor.
     * @param {number} seconds Duration.
     * @return {Object} Fade state for stepFade().
     */
    function createFade(from, to, seconds) {
        return { from, to, duration: Math.max(0, seconds) * 1000, elapsed: 0 };
    }

    /**
     * @brief Advances a fade.
     * @param {Object} fade From createFade().
     * @param {number} ms Milliseconds elapsed.
     * @return {{value: number, done: boolean}} Current factor and completion.
     */
    function stepFade(fade, ms) {
        fade.elapsed += ms;
        if (fade.duration <= 0 || fade.elapsed >= fade.duration) {
            return { value: fade.to, done: true };
        }
        const t = fade.elapsed / fade.duration;
        return { value: fade.from + (fade.to - fade.from) * t, done: false };
    }

    /**
     * @brief Interprets a timeline marker name as an MZ action.
     *        "Switch:12=on", "Variable:5=3", "CommonEvent:7".
     * @param {string} name Marker name.
     * @return {Object|null} {type, id, value} or null for plain markers.
     */
    function parseMarkerAction(name) {
        const m = /^\s*(switch|variable|commonevent)\s*:\s*(\d+)\s*(?:=\s*(\S+))?\s*$/i.exec(String(name || ""));
        if (!m) {
            return null;
        }
        const type = m[1].toLowerCase();
        const id = Number(m[2]);
        if (type === "switch") {
            return { type, id, value: !/^(off|false|0)$/i.test(m[3] || "on") };
        }
        if (type === "variable") {
            return { type, id, value: Number(m[3] || 0) };
        }
        return { type, id };
    }

    /**
     * @brief Copies the saveable FMOD state into a plain object.
     * @param {Object} s {globals, snapshots: Map|Object, handles: Iterable,
     *        banks: Array<string>, preloads: Array<string>}.
     * @return {Object} JSON-safe state.
     */
    function serializeState(s) {
        const handles = [];
        for (const h of s.handles || []) {
            if (!h.persistent || !h.name || h.stopped) {
                continue;
            }
            handles.push({
                name: h.name,
                path: h.path,
                scope: h.scope,
                volume: h.volume,
                pitch: h.pitch,
                params: Object.assign({}, h.params),
                timeline: typeof h.timeline === "function" ? h.timeline() : 0,
                paused: !!h.paused,
                programmerKey: h.programmerKey || "",
            });
        }
        const snapshots = {};
        const src = s.snapshots instanceof Map ? Object.fromEntries(s.snapshots) : s.snapshots || {};
        for (const [path, snap] of Object.entries(src)) {
            snapshots[path] = typeof snap === "object" ? snap.intensity : snap;
        }
        return {
            version: 1,
            globals: Object.assign({}, s.globals),
            snapshots,
            handles,
            banks: (s.banks || []).slice(),
            preloads: (s.preloads || []).slice(),
        };
    }

    /**
     * @brief Applies a platform's overrides; empty fields keep the base value.
     * @param {Object} base Base config.
     * @param {Object} overrides {field: string} from the plugin parameters.
     * @return {Object} New config.
     */
    function resolvePlatformConfig(base, overrides) {
        const out = Object.assign({}, base);
        for (const [key, raw] of Object.entries(overrides || {})) {
            if (raw === undefined || raw === null || raw === "" || !(key in base)) {
                continue;
            }
            if (typeof base[key] === "boolean") {
                out[key] = raw === true || raw === "true";
            } else if (typeof base[key] === "number") {
                if (Number.isFinite(Number(raw))) {
                    out[key] = Number(raw);
                }
            } else {
                out[key] = String(raw);
            }
        }
        return out;
    }

    /**
     * @brief Preloads that may be unloaded to get under the budget, best
     *        candidates (least recently used) first.
     * @param {Iterable<Object>} entries {key, state, pinned, lastUsed}.
     * @param {number} now Current time (ms).
     * @param {number} minIdleMs Entries used more recently are kept.
     * @return {Array<Object>} Candidates.
     */
    function pickEvictions(entries, now, minIdleMs) {
        return Array.from(entries)
            .filter(e => e.state === "loaded" && !e.pinned && now - e.lastUsed >= minIdleMs)
            .sort((a, b) => a.lastUsed - b.lastUsed);
    }

    /**
     * @brief Budget state with hysteresis: "over" starts above the budget and
     *        ends below 90% of it, so warnings don't flicker.
     * @param {number} usage Bytes in use.
     * @param {number} budget Budget in bytes (0 = none).
     * @param {boolean} wasOver Previous state.
     * @return {{over: boolean, started: boolean, ended: boolean}} State.
     */
    function budgetState(usage, budget, wasOver) {
        if (!(budget > 0)) {
            return { over: false, started: false, ended: wasOver };
        }
        const over = wasOver ? usage > budget * 0.9 : usage > budget;
        return { over, started: over && !wasOver, ended: !over && wasOver };
    }

    const Engine = {
        resolvePlatformConfig,
        pickEvictions,
        budgetState,
        parseArgs,
        parseParamList,
        noteTags,
        toFmodVector,
        makeAttributes,
        createErrorLog,
        createNameMapper,
        resolveDefaults,
        createBankManager,
        createFade,
        stepFade,
        parseMarkerAction,
        serializeState,
    };

    // Outside MZ (Node: tests) only the engine is needed.
    if (typeof PluginManager === "undefined") {
        if (typeof module !== "undefined" && module.exports) {
            module.exports = Engine;
        }
        return;
    }

    //=========================================================================
    // Runtime (RPG Maker MZ)
    //=========================================================================

    const PLUGIN_NAME = "PokeMZ_FMOD_Core";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const parseBool = (v, fallback) => (v === undefined || v === "" ? fallback : v === "true");
    const parseJson = (v, fallback) => {
        try {
            return v ? JSON.parse(v) : fallback;
        } catch (e) {
            return fallback;
        }
    };
    const num = (v, fallback) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? fallback : Number(v));

    const CONFIG = {
        folder: (params.folder || "audio/fmod/").replace(/\/?$/, "/"),
        startupBanks: parseJson(params.startupBanks, ["Master.bank", "Master.strings.bank"]),
        preloadSampleData: parseBool(params.preloadSampleData, false),
        encryptionKey: params.encryptionKey || "",
        maxChannels: num(params.maxChannels, 128),
        memoryMb: num(params.memoryMb, 64),
        dspBufferLength: num(params.dspBufferLength, 2048),
        dspBufferCount: num(params.dspBufferCount, 2),
        handedness: params.handedness === "left" ? "left" : "right",
        dopplerScale: num(params.dopplerScale, 1),
        distanceFactor: num(params.distanceFactor, 1),
        rolloffScale: num(params.rolloffScale, 1),
        globalDefaults: parseParamList(params.globalDefaults || ""),
        eventDefaults: parseJson(params.eventDefaults, []).map(s => parseJson(s, {})),
        whenHidden: params.whenHidden || "mute",
        whenUnfocused: params.whenUnfocused || "none",
        bootTimeout: num(params.bootTimeout, 15),
        budgetMb: num(params.budgetMb, 0),
        evictAfter: num(params.evictAfter, 10),
        idlePoolKb: num(params.idlePoolKb, 256),
    };

    /**
     * @brief Which platform profile applies.
     * @return {string} desktop, browser or mobile.
     */
    function detectPlatform() {
        const forced = /[?&]fmodPlatform=(desktop|browser|mobile)/.exec(typeof location === "object" ? location.search : "");
        if (forced && typeof Utils !== "undefined" && Utils.isOptionValid("test")) {
            return forced[1];
        }
        if (typeof Utils !== "undefined") {
            if (Utils.isNwjs()) {
                return "desktop";
            }
            if (Utils.isMobileDevice()) {
                return "mobile";
            }
        }
        return "browser";
    }

    const PLATFORM = detectPlatform();
    Object.assign(
        CONFIG,
        resolvePlatformConfig(CONFIG, parseJson(parseJson(params.platforms, {})[PLATFORM], {}))
    );

    /** @brief The FMOD Emscripten module (constants, classes, FS). */
    let F = null;
    /** @brief Studio::System. */
    let studio = null;
    /** @brief Core System. */
    let core = null;

    const errors = createErrorLog(80);
    const listeners = new Map();
    const hooks = [];
    const live = new Set();
    const named = new Map();
    const snapshots = new Map();
    const globals = Object.assign({}, CONFIG.globalDefaults);
    const eventCache = new Map();
    const callbackQueue = [];
    const out = {};

    //-------------------------------------------------------------------------
    // Errors and events
    //-------------------------------------------------------------------------

    /**
     * @brief Checks an FMOD_RESULT. Logs each distinct failure once; never throws.
     * @param {number} result FMOD_RESULT.
     * @param {string} what Description of the call.
     * @param {boolean} [quiet=false] Record without logging to the console.
     * @return {boolean} True if the call succeeded.
     */
    function check(result, what, quiet) {
        if (!F || result === F.OK) {
            return true;
        }
        const text = F.ErrorString ? F.ErrorString(result) : String(result);
        if (errors.add(what, result, text) && !quiet) {
            console.warn(`PokeMZ_FMOD: ${what} failed: ${text} (${result})`);
        }
        emit("error", { what, code: result, text });
        return false;
    }

    /**
     * @brief Calls a function and turns exceptions (embind type errors etc.)
     *        into logged errors.
     * @param {string} what Description.
     * @param {Function} fn Function returning an FMOD_RESULT.
     * @return {boolean} True on success.
     */
    function safe(what, fn) {
        try {
            return check(fn(), what);
        } catch (e) {
            if (errors.add(what, -1, e.message)) {
                console.warn(`PokeMZ_FMOD: ${what} threw:`, e);
            }
            return false;
        }
    }

    /**
     * @brief Subscribes to an FMOD runtime event.
     * @param {string} type ready, bankLoaded, bankError, marker, beat, stopped,
     *        error, update, mapChanged.
     * @param {Function} fn Listener.
     * @return {Function} Unsubscribes.
     */
    function on(type, fn) {
        if (!listeners.has(type)) {
            listeners.set(type, new Set());
        }
        listeners.get(type).add(fn);
        return () => listeners.get(type).delete(fn);
    }

    /**
     * @brief Calls the listeners of a runtime event.
     * @param {string} type Event type.
     * @param {*} data Payload.
     */
    function emit(type, data) {
        const set = listeners.get(type);
        if (!set) {
            return;
        }
        for (const fn of Array.from(set)) {
            try {
                fn(data);
            } catch (e) {
                console.error(`PokeMZ_FMOD: "${type}" listener failed`, e);
            }
        }
    }

    //-------------------------------------------------------------------------
    // Files and banks
    //-------------------------------------------------------------------------

    /**
     * @brief Downloads a file as bytes (XHR works for file:// under NW.js,
     *        like MZ's own data loading).
     * @param {string} url Relative URL.
     * @return {Promise<Uint8Array>} The bytes.
     */
    function fetchBytes(url) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", url);
            xhr.responseType = "arraybuffer";
            xhr.onload = () => {
                if (xhr.status < 400 && xhr.response) {
                    resolve(new Uint8Array(xhr.response));
                } else {
                    reject(new Error(`HTTP ${xhr.status} for ${url}`));
                }
            };
            xhr.onerror = () => reject(new Error(`Could not load ${url}`));
            xhr.send();
        });
    }

    /**
     * @brief Normalises a bank name ("Forest" -> "Forest.bank").
     * @param {string} name Bank name.
     * @return {string} File name.
     */
    const bankFile = name => (/\.bank$/i.test(name) ? name : `${name}.bank`);

    let fsReady = false;
    const pendingBanks = new Set();

    /**
     * @brief Copies a bank into the wasm file system and starts a
     *        non-blocking load; resolves once FMOD reports it loaded.
     * @param {string} file Bank file name.
     * @param {Object} [opts] {sampleData: boolean}.
     * @return {Promise<Object>} The Studio::Bank.
     */
    function loadBankIo(file, opts) {
        return fetchBytes(CONFIG.folder + file).then(bytes => {
            if (!studio) {
                throw new Error("FMOD is not running");
            }
            if (!fsReady) {
                F.FS_createPath("/", "banks", true, true);
                fsReady = true;
            }
            try {
                F.FS_unlink(`/banks/${file}`);
            } catch (e) {
                // Not there yet.
            }
            F.FS_createDataFile("/banks", file, bytes, true, false, false);
            const result = studio.loadBankFile(`/banks/${file}`, F.STUDIO_LOAD_BANK_NONBLOCKING, out);
            if (!check(result, `loadBankFile(${file})`)) {
                throw new Error(F.ErrorString(result));
            }
            const bank = out.val;
            return new Promise((resolve, reject) => {
                pendingBanks.add({ file, bank, resolve, reject, sampleData: !!(opts && opts.sampleData) });
            });
        });
    }

    /**
     * @brief Polls the loading state of pending banks (called every frame).
     */
    function pollBanks() {
        for (const p of Array.from(pendingBanks)) {
            const state = {};
            const result = p.bank.getLoadingState(state);
            if (result !== F.OK || state.val === F.STUDIO_LOADING_STATE_ERROR) {
                pendingBanks.delete(p);
                check(result === F.OK ? F.ERR_FILE_BAD : result, `load bank ${p.file}`);
                safeUnlink(p.file);
                p.reject(new Error(`Bank ${p.file} failed to load`));
            } else if (state.val === F.STUDIO_LOADING_STATE_LOADED) {
                pendingBanks.delete(p);
                if (p.sampleData) {
                    check(p.bank.loadSampleData(), `loadSampleData(${p.file})`);
                }
                p.resolve(p.bank);
            }
        }
    }

    /**
     * @brief Removes a bank file from the wasm file system.
     * @param {string} file Bank file name.
     */
    function safeUnlink(file) {
        try {
            F.FS_unlink(`/banks/${file}`);
        } catch (e) {
            // Already gone.
        }
    }

    const bankManager = createBankManager({
        load: (file, opts) => loadBankIo(file, opts),
        unload: (file, bank) => {
            if (bank && studio) {
                check(bank.unload(), `unload ${file}`);
                safeUnlink(file);
            }
            onBanksChanged();
            emit("bankUnloaded", file);
        },
    });

    /** @brief Clears caches that depend on which banks are loaded. */
    function onBanksChanged() {
        eventCache.clear();
        mixerCache.clear();
        emit("banksChanged");
    }

    /**
     * @brief Loads a bank (reference counted).
     * @param {string} name Bank name ("Forest" or "Forest.bank").
     * @param {Object} [opts] {sampleData: decompress samples now}.
     * @return {Promise<boolean>} True when loaded, false on error (never rejects).
     */
    function loadBank(name, opts) {
        const file = bankFile(name);
        if (!api.available) {
            return Promise.resolve(false);
        }
        return bankManager.acquire(file, opts).then(
            () => {
                onBanksChanged();
                emit("bankLoaded", file);
                return true;
            },
            error => {
                if (errors.add(`bank ${file}`, -2, error.message)) {
                    console.warn(`PokeMZ_FMOD: ${error.message}`);
                }
                emit("bankError", { file, error });
                return false;
            }
        );
    }

    /**
     * @brief Releases a bank reference (unloads at zero).
     * @param {string} name Bank name.
     */
    function unloadBank(name) {
        bankManager.release(bankFile(name));
    }

    //-------------------------------------------------------------------------
    // Event descriptions
    //-------------------------------------------------------------------------

    /**
     * @brief Looks up an event description (cached; needs the strings bank
     *        for paths, or use "{guid}").
     * @param {string} path "event:/..." or "snapshot:/...".
     * @return {Object|null} EventDescription or null.
     */
    function getEvent(path) {
        if (!studio || !path) {
            return null;
        }
        if (eventCache.has(path)) {
            return eventCache.get(path);
        }
        const result = studio.getEvent(path, out);
        const desc = result === F.OK ? out.val : null;
        eventCache.set(path, desc);
        return desc;
    }

    /**
     * @param {string} path Event path.
     * @return {boolean} True if the event exists in a loaded bank.
     */
    const hasEvent = path => !!getEvent(path);

    /**
     * @brief Reads simple facts about an event.
     * @param {string} path Event path.
     * @return {Object|null} {oneShot, is3D, length, minDistance, maxDistance, params}.
     */
    function eventInfo(path) {
        const desc = getEvent(path);
        if (!desc) {
            return null;
        }
        const read = (fn, fallback) => {
            const o = {};
            return fn(o) === F.OK ? o.val : fallback;
        };
        const min = {};
        const max = {};
        desc.getMinMaxDistance(min, max);
        const params = [];
        const count = read(o => desc.getParameterDescriptionCount(o), 0);
        for (let i = 0; i < count; i++) {
            const pd = F.STUDIO_PARAMETER_DESCRIPTION();
            if (desc.getParameterDescriptionByIndex(i, pd) === F.OK) {
                params.push({ name: pd.name, min: pd.minimum, max: pd.maximum, default: pd.defaultvalue });
            }
        }
        return {
            path,
            oneShot: !!read(o => desc.isOneshot(o), false),
            is3D: !!read(o => desc.is3D(o), false),
            snapshot: !!read(o => desc.isSnapshot(o), false),
            length: read(o => desc.getLength(o), 0),
            minDistance: min.val || 0,
            maxDistance: max.val || 0,
            params,
        };
    }

    //-------------------------------------------------------------------------
    // Instances
    //-------------------------------------------------------------------------

    let nextId = 1;

    /**
     * @brief A playing (or ready) FMOD event instance.
     *
     * The effective volume is volume x gain x fade: "volume" is what scripts
     * set, "gain" belongs to the owner (e.g. MZ's option volume when no VCA
     * exists) and "fade" is driven by fadeTo().
     */
    class Handle {
        /**
         * @param {string} path Event path.
         * @param {Object} [opts] See the plugin help.
         */
        constructor(path, opts = {}) {
            const defaults = resolveDefaults(CONFIG.eventDefaults, path);
            this.id = nextId++;
            this.path = path;
            this.name = opts.name || "";
            this.scope = opts.scope || "global";
            this.persistent = !!opts.persistent;
            this.volume = opts.volume !== undefined ? Number(opts.volume) : defaults.volume;
            this.pitch = opts.pitch !== undefined ? Number(opts.pitch) : defaults.pitch;
            this.gain = opts.gain !== undefined ? Number(opts.gain) : 1;
            this.fadeValue = 1;
            this.fade = null;
            this.params = Object.assign({}, defaults.params, parseParamList(opts.params || {}));
            this.position = opts.position || null;
            this.follow = opts.follow || null;
            this.programmerKey = opts.programmerKey || "";
            this.autoRelease = !!opts.oneShot;
            this.paused = false;
            this.started = false;
            this.stopped = false;
            this.released = false;
            this.instance = null;
            this.desc = getEvent(path);
            this.listeners = new Map();
            touchPreload(path);
            this.callbackMask = 0;
            if (!this.desc) {
                this.stopped = true;
                return;
            }
            if (!safe(`createInstance(${path})`, () => this.desc.createInstance(out))) {
                this.stopped = true;
                return;
            }
            this.instance = out.val;
            this.applyVolume();
            if (this.pitch !== 1) {
                check(this.instance.setPitch(this.pitch), `setPitch(${path})`);
            }
            for (const [k, v] of Object.entries(this.params)) {
                this.setParameter(k, v);
            }
            if (opts.timeline) {
                this.setTimeline(opts.timeline);
            }
            this.updateCallback();
            this.update3D(0);
            live.add(this);
            if (this.name) {
                const old = named.get(this.name);
                if (old && old !== this) {
                    old.stop(true);
                }
                named.set(this.name, this);
            }
        }

        /** @return {boolean} True if an instance exists. */
        get valid() {
            return !!this.instance && !this.released;
        }

        /**
         * @brief Starts playback.
         * @param {number} [fadeIn=0] Fade-in seconds.
         * @return {Handle} This.
         */
        start(fadeIn) {
            if (!this.valid) {
                return this;
            }
            if (fadeIn > 0) {
                this.fadeValue = 0;
                this.fadeTo(1, fadeIn);
            }
            this.update3D(0);
            check(this.instance.start(), `start(${this.path})`);
            this.started = true;
            emit("instanceStarted", this);
            this.stopped = false;
            if (this.autoRelease) {
                check(this.instance.release(), `release(${this.path})`);
            }
            return this;
        }

        /**
         * @brief Stops playback.
         * @param {boolean|number} [mode] true = immediate, a number = fade
         *        out over that many seconds, otherwise FMOD's authored fade-out.
         * @return {Handle} This.
         */
        stop(mode) {
            if (!this.valid) {
                return this;
            }
            if (typeof mode === "number" && mode > 0) {
                this.fadeTo(0, mode, () => this.stop(true));
                return this;
            }
            check(this.instance.stop(mode === true ? F.STUDIO_STOP_IMMEDIATE : F.STUDIO_STOP_ALLOWFADEOUT), `stop(${this.path})`);
            if (mode === true || !this.started) {
                this.finish();
            }
            return this;
        }

        /** @brief Pauses (setPaused(true)). @return {Handle} This. */
        pause() {
            return this.setPaused(true);
        }

        /** @brief Resumes after pause(). @return {Handle} This. */
        resume() {
            return this.setPaused(false);
        }

        /**
         * @param {boolean} paused Paused state.
         * @return {Handle} This.
         */
        setPaused(paused) {
            this.paused = !!paused;
            if (this.valid) {
                check(this.instance.setPaused(this.paused), `setPaused(${this.path})`);
            }
            return this;
        }

        /**
         * @param {number} v Volume (1 = as authored).
         * @return {Handle} This.
         */
        setVolume(v) {
            this.volume = Math.max(0, Number(v) || 0);
            return this.applyVolume();
        }

        /**
         * @param {number} g Owner gain (see class notes).
         * @return {Handle} This.
         */
        setGain(g) {
            this.gain = Math.max(0, Number(g) || 0);
            return this.applyVolume();
        }

        /** @brief Pushes volume x gain x fade to FMOD. @return {Handle} This. */
        applyVolume() {
            if (this.valid) {
                check(this.instance.setVolume(this.volume * this.gain * this.fadeValue), `setVolume(${this.path})`);
            }
            return this;
        }

        /**
         * @param {number} p Pitch multiplier.
         * @return {Handle} This.
         */
        setPitch(p) {
            this.pitch = Math.max(0, Number(p) || 0);
            if (this.valid) {
                check(this.instance.setPitch(this.pitch), `setPitch(${this.path})`);
            }
            return this;
        }

        /**
         * @brief Fades the extra fade factor.
         * @param {number} to Target factor (0-1).
         * @param {number} seconds Duration.
         * @param {Function} [done] Called at the end.
         * @return {Handle} This.
         */
        fadeTo(to, seconds, done) {
            this.fade = createFade(this.fadeValue, to, seconds);
            this.fadeDone = done || null;
            if (!(seconds > 0)) {
                this.stepFade(0);
            }
            return this;
        }

        /**
         * @brief Advances the current fade.
         * @param {number} ms Elapsed milliseconds.
         */
        stepFade(ms) {
            if (!this.fade) {
                return;
            }
            const r = stepFade(this.fade, ms);
            this.fadeValue = r.value;
            this.applyVolume();
            if (r.done) {
                const done = this.fadeDone;
                this.fade = null;
                this.fadeDone = null;
                if (done) {
                    done();
                }
            }
        }

        /**
         * @brief Sets a local parameter (a string value sets a label).
         * @param {string} name Parameter name.
         * @param {number|string} value Value or label.
         * @param {boolean} [ignoreSeek=false] Jump without seek speed.
         * @return {Handle} This.
         */
        setParameter(name, value, ignoreSeek) {
            this.params[name] = value;
            if (this.valid) {
                const result =
                    typeof value === "string"
                        ? this.instance.setParameterByNameWithLabel(name, value, !!ignoreSeek)
                        : this.instance.setParameterByName(name, Number(value), !!ignoreSeek);
                check(result, `setParameter(${this.path}, ${name})`);
            }
            return this;
        }

        /**
         * @param {string} name Parameter name.
         * @return {number|null} Current (final) value, null if unknown.
         */
        getParameter(name) {
            if (!this.valid) {
                return null;
            }
            const value = {};
            const final = {};
            return this.instance.getParameterByName(name, value, final) === F.OK ? final.val : null;
        }

        /** @brief Moves past the next sustain point. @return {Handle} This. */
        keyOff() {
            if (this.valid) {
                check(this.instance.keyOff(), `keyOff(${this.path})`);
            }
            return this;
        }

        /**
         * @param {number} ms Timeline position in milliseconds.
         * @return {Handle} This.
         */
        setTimeline(ms) {
            if (this.valid) {
                check(this.instance.setTimelinePosition(Math.max(0, Math.floor(ms))), `setTimelinePosition(${this.path})`);
            }
            return this;
        }

        /** @return {number} Timeline position in milliseconds. */
        timeline() {
            if (!this.valid) {
                return 0;
            }
            const o = {};
            return this.instance.getTimelinePosition(o) === F.OK ? o.val : 0;
        }

        /** @return {number} FMOD_STUDIO_PLAYBACK_STATE, or STOPPED when gone. */
        playbackState() {
            if (!this.valid) {
                return F ? F.STUDIO_PLAYBACK_STOPPED : 2;
            }
            const o = {};
            return this.instance.getPlaybackState(o) === F.OK ? o.val : F.STUDIO_PLAYBACK_STOPPED;
        }

        /** @return {boolean} True while started and not stopped. */
        isPlaying() {
            return this.started && !this.stopped;
        }

        /**
         * @brief Listens to this instance: marker, beat, stopped.
         * @param {string} type Event type.
         * @param {Function} fn Listener.
         * @return {Handle} This.
         */
        on(type, fn) {
            if (!this.listeners.has(type)) {
                this.listeners.set(type, new Set());
            }
            this.listeners.get(type).add(fn);
            this.updateCallback();
            return this;
        }

        /**
         * @brief Calls this handle's listeners.
         * @param {string} type Event type.
         * @param {*} data Payload.
         */
        emit(type, data) {
            const set = this.listeners.get(type);
            if (set) {
                for (const fn of Array.from(set)) {
                    try {
                        fn(data, this);
                    } catch (e) {
                        console.error(`PokeMZ_FMOD: handle "${type}" listener failed`, e);
                    }
                }
            }
        }

        /** @brief (Re)installs the FMOD callback with the needed mask. */
        updateCallback() {
            if (!this.valid) {
                return;
            }
            let mask = F.STUDIO_EVENT_CALLBACK_TIMELINE_MARKER | F.STUDIO_EVENT_CALLBACK_STOPPED;
            if (this.listeners.has("beat") || listeners.has("beat")) {
                mask |= F.STUDIO_EVENT_CALLBACK_TIMELINE_BEAT;
            }
            if (this.programmerKey) {
                mask |= F.STUDIO_EVENT_CALLBACK_CREATE_PROGRAMMER_SOUND | F.STUDIO_EVENT_CALLBACK_DESTROY_PROGRAMMER_SOUND;
            }
            if (mask === this.callbackMask) {
                return;
            }
            this.callbackMask = mask;
            const self = this;
            safe(`setCallback(${this.path})`, () =>
                this.instance.setCallback(function(type, event, props) {
                    return onInstanceCallback(self, type, props);
                }, mask)
            );
        }

        /**
         * @brief Places a 3D event (position or follow function).
         * @param {number} dtMs Elapsed milliseconds (for velocity).
         */
        update3D(dtMs) {
            if (!this.valid || (!this.position && !this.follow)) {
                return;
            }
            const a = this.follow ? this.follow(this) : { position: this.position };
            if (!a || !a.position) {
                return;
            }
            if (!a.velocity && this.lastPos && dtMs > 0) {
                const s = 1000 / dtMs;
                a.velocity = {
                    x: (a.position.x - this.lastPos.x) * s,
                    y: (a.position.y - this.lastPos.y) * s,
                    z: (a.position.z - this.lastPos.z) * s,
                };
            }
            this.lastPos = { x: a.position.x, y: a.position.y, z: a.position.z };
            this.worldPosition = this.lastPos;
            safe(`set3DAttributes(${this.path})`, () => this.instance.set3DAttributes(makeAttributes(a, CONFIG.handedness)));
        }

        /** @brief Marks the handle finished and notifies listeners once. */
        finish() {
            if (this.stopped && !this.instance) {
                return;
            }
            const wasStopped = this.stopped;
            this.stopped = true;
            if (!this.autoRelease && this.instance && !this.released) {
                check(this.instance.release(), `release(${this.path})`);
            }
            this.released = true;
            live.delete(this);
            if (this.name && named.get(this.name) === this) {
                named.delete(this.name);
            }
            if (!wasStopped) {
                this.emit("stopped");
                emit("stopped", this);
            }
            this.instance = null;
        }

        /** @brief Frees the instance (stops immediately). */
        release() {
            this.stop(true);
        }
    }

    /**
     * @brief FMOD instance callback. Runs inside studio.update(): copies the
     *        data out and queues it, except programmer sounds, which must be
     *        answered right away.
     * @param {Handle} handle The owning handle.
     * @param {number} type FMOD_STUDIO_EVENT_CALLBACK_TYPE.
     * @param {Object} props Callback parameters.
     * @return {number} FMOD_OK.
     */
    function onInstanceCallback(handle, type, props) {
        try {
            if (type === F.STUDIO_EVENT_CALLBACK_TIMELINE_MARKER) {
                callbackQueue.push({ handle, type: "marker", data: { name: props.name, position: props.position } });
            } else if (type === F.STUDIO_EVENT_CALLBACK_TIMELINE_BEAT) {
                callbackQueue.push({
                    handle,
                    type: "beat",
                    data: { bar: props.bar, beat: props.beat, position: props.position, tempo: props.tempo },
                });
            } else if (type === F.STUDIO_EVENT_CALLBACK_STOPPED) {
                callbackQueue.push({ handle, type: "stopped" });
            } else if (type === F.STUDIO_EVENT_CALLBACK_CREATE_PROGRAMMER_SOUND) {
                createProgrammerSound(handle, props);
            } else if (type === F.STUDIO_EVENT_CALLBACK_DESTROY_PROGRAMMER_SOUND) {
                if (props.sound) {
                    props.sound.release();
                }
            }
        } catch (e) {
            errors.add("instance callback", -1, e.message);
        }
        return F.OK;
    }

    /**
     * @brief Answers CREATE_PROGRAMMER_SOUND from an audio table entry.
     * @param {Handle} handle Handle with programmerKey.
     * @param {Object} props FMOD_STUDIO_PROGRAMMER_SOUND_PROPERTIES.
     */
    function createProgrammerSound(handle, props) {
        const info = F.STUDIO_SOUND_INFO();
        if (!check(studio.getSoundInfo(handle.programmerKey, info), `getSoundInfo(${handle.programmerKey})`)) {
            return;
        }
        const mode = F.LOOP_NORMAL | F.CREATECOMPRESSEDSAMPLE | F.NONBLOCKING | info.mode;
        const sound = {};
        if (check(core.createSound(info.name_or_data, mode, info.exinfo, sound), `createSound(${handle.programmerKey})`)) {
            props.sound = sound.val;
            props.subsoundIndex = info.subsoundindex;
        }
    }

    /** @brief Dispatches callbacks queued during studio.update(). */
    function flushCallbacks() {
        while (callbackQueue.length) {
            const { handle, type, data } = callbackQueue.shift();
            if (type === "stopped") {
                if (handle.autoRelease || handle.started) {
                    handle.finish();
                }
                continue;
            }
            handle.emit(type, data);
            emit(type, Object.assign({ handle }, data));
        }
    }

    /**
     * @brief Creates an instance without starting it.
     * @param {string} path Event path.
     * @param {Object} [opts] Handle options.
     * @return {Handle} The handle (handle.valid is false if the event is missing).
     */
    function create(path, opts) {
        return new Handle(path, opts);
    }

    /**
     * @brief Creates and starts an instance.
     * @param {string} path Event path.
     * @param {Object} [opts] Handle options (+ fadeIn seconds).
     * @return {Handle} The handle.
     */
    function play(path, opts = {}) {
        return create(path, opts).start(opts.fadeIn);
    }

    /**
     * @brief Fire-and-forget: starts and releases at once.
     * @param {string} path Event path.
     * @param {Object} [opts] Handle options.
     * @return {Handle} The handle (for listeners only).
     */
    function oneShot(path, opts = {}) {
        return play(path, Object.assign({}, opts, { oneShot: true, name: "" }));
    }

    /**
     * @brief Plays an event whose programmer instrument plays an audio table
     *        entry (e.g. one "event:/Cry" for every Pokémon cry).
     * @param {string} path Event path.
     * @param {string} key Audio table key.
     * @param {Object} [opts] Handle options.
     * @return {Handle} The handle.
     */
    function playProgrammer(path, key, opts = {}) {
        return play(path, Object.assign({}, opts, { programmerKey: String(key) }));
    }

    /**
     * @param {string} name Handle name.
     * @return {Handle|null} The named handle.
     */
    const handle = name => named.get(name) || null;

    /**
     * @brief Stops a named handle.
     * @param {string} name Handle name.
     * @param {boolean|number} [mode] See Handle.stop().
     */
    function stop(name, mode) {
        const h = handle(name);
        if (h) {
            h.stop(mode);
        }
    }

    /**
     * @brief Stops every handle of a scope (map, scene, global).
     * @param {string} scope Scope.
     * @param {boolean|number} [mode] See Handle.stop().
     */
    function stopScope(scope, mode) {
        for (const h of Array.from(live)) {
            if (h.scope === scope && !h.owner) {
                h.stop(mode);
            }
        }
    }

    /**
     * @brief Stops all script-created handles (MZ BGM/BGS etc. are owned by
     *        PokeMZ_FMOD_Audio and stay unless includeOwned).
     * @param {boolean|number} [mode] See Handle.stop() (true = immediate,
     *        seconds = timed fade, otherwise authored fade-out).
     * @param {boolean} [includeOwned=false] Also stop owned handles.
     */
    function stopAll(mode, includeOwned) {
        for (const h of Array.from(live)) {
            if (includeOwned || !h.owner) {
                h.stop(mode);
            }
        }
    }

    //-------------------------------------------------------------------------
    // Global parameters, snapshots, mixer
    //-------------------------------------------------------------------------

    /**
     * @brief Sets a global parameter (a string sets a label). Remembered for
     *        save files and re-applied after banks load.
     * @param {string} name Parameter name.
     * @param {number|string} value Value or label.
     * @return {boolean} True on success.
     */
    function setGlobalParameter(name, value) {
        globals[name] = value;
        emit("globalParameter", { name, value });
        if (!studio) {
            return false;
        }
        const result =
            typeof value === "string"
                ? studio.setParameterByNameWithLabel(name, value, false)
                : studio.setParameterByName(name, Number(value), false);
        return check(result, `setGlobalParameter(${name})`, result === F.ERR_EVENT_NOTFOUND);
    }

    /**
     * @param {string} name Parameter name.
     * @return {number|string|null} Current value (or the remembered label).
     */
    function getGlobalParameter(name) {
        if (studio) {
            const value = {};
            const final = {};
            if (studio.getParameterByName(name, value, final) === F.OK) {
                return typeof globals[name] === "string" ? globals[name] : final.val;
            }
        }
        return name in globals ? globals[name] : null;
    }

    /** @brief Applies every remembered global parameter (quietly). */
    function applyGlobals() {
        for (const [k, v] of Object.entries(globals)) {
            setGlobalParameter(k, v);
        }
    }

    /**
     * @brief Starts (or re-targets) a snapshot.
     * @param {string} path "snapshot:/...".
     * @param {number} [intensity=100] Snapshot intensity 0-100 (needs an
     *        exposed Intensity parameter in Studio to change while active).
     * @return {boolean} True if active.
     */
    function startSnapshot(path, intensity = 100) {
        let snap = snapshots.get(path);
        if (!snap || !snap.handle.valid) {
            const h = create(path, { scope: "global" });
            if (!h.valid) {
                return false;
            }
            h.owner = "snapshot";
            h.start();
            snap = { handle: h, intensity: 100 };
            snapshots.set(path, snap);
            emit("snapshotStarted", path);
        }
        snap.intensity = intensity;
        if (intensity !== 100) {
            safe(`snapshot intensity ${path}`, () => snap.handle.instance.setParameterByName("Intensity", intensity, false));
        }
        return true;
    }

    /**
     * @brief Stops a snapshot.
     * @param {string} path Snapshot path.
     * @param {boolean} [immediate=false] Skip its fade-out.
     */
    function stopSnapshot(path, immediate) {
        const snap = snapshots.get(path);
        if (snap) {
            snap.handle.stop(!!immediate);
            snapshots.delete(path);
            emit("snapshotStopped", path);
        }
    }

    const mixerCache = new Map();

    /**
     * @brief Finds a bus or VCA.
     * @param {string} path "bus:/..." or "vca:/...".
     * @return {Object|null} Studio::Bus or Studio::VCA.
     */
    function getMixer(path) {
        if (!studio || !path) {
            return null;
        }
        if (mixerCache.has(path)) {
            return mixerCache.get(path);
        }
        const isVca = /^vca:/i.test(path);
        const result = isVca ? studio.getVCA(path, out) : studio.getBus(path, out);
        const obj = result === F.OK ? out.val : null;
        mixerCache.set(path, obj);
        return obj;
    }

    /**
     * @brief Sets a bus or VCA volume.
     * @param {string} path "bus:/..." or "vca:/...".
     * @param {number} volume Linear volume (1 = unchanged).
     * @return {boolean} True if the bus/VCA exists.
     */
    function setMixerVolume(path, volume) {
        const m = getMixer(path);
        return !!m && check(m.setVolume(Math.max(0, volume)), `setVolume(${path})`);
    }

    /**
     * @brief Pauses a bus.
     * @param {string} path "bus:/...".
     * @param {boolean} paused State.
     * @return {boolean} True if the bus exists.
     */
    function setMixerPaused(path, paused) {
        const m = getMixer(path);
        return !!m && !!m.setPaused && check(m.setPaused(!!paused), `setPaused(${path})`);
    }

    /**
     * @brief Mutes a bus.
     * @param {string} path "bus:/...".
     * @param {boolean} muted State.
     * @return {boolean} True if the bus exists.
     */
    function setMixerMute(path, muted) {
        const m = getMixer(path);
        return !!m && !!m.setMute && check(m.setMute(!!muted), `setMute(${path})`);
    }

    //-------------------------------------------------------------------------
    // Browser audio policy, focus
    //-------------------------------------------------------------------------

    let unlocked = false;

    /**
     * @brief Resumes the mixer after the first user gesture (browsers block
     *        audio until then; in NW.js this is a harmless no-op).
     */
    function unlock() {
        if (unlocked || !core) {
            return;
        }
        unlocked = true;
        check(core.mixerSuspend(), "mixerSuspend");
        check(core.mixerResume(), "mixerResume");
        for (const fn of ["OutputAudioWorklet_resumeAudio", "OutputWebAudio_resumeAudio"]) {
            if (typeof F[fn] === "function") {
                try {
                    F[fn]();
                } catch (e) {
                    // Not that output.
                }
            }
        }
        for (const type of UNLOCK_EVENTS) {
            document.removeEventListener(type, unlock, true);
        }
    }

    const UNLOCK_EVENTS = ["pointerdown", "mousedown", "touchstart", "touchend", "keydown"];

    const focusState = { hidden: false, blurred: false, applied: "none" };

    /** @brief Applies the hidden / unfocused behaviour to the master channel group. */
    function applyFocus() {
        if (!core) {
            return;
        }
        let mode = "none";
        if (focusState.hidden) {
            mode = CONFIG.whenHidden;
        }
        if (mode === "none" && focusState.blurred) {
            mode = CONFIG.whenUnfocused;
        }
        if (mode === focusState.applied) {
            return;
        }
        focusState.applied = mode;
        if (core.getMasterChannelGroup(out) !== F.OK) {
            return;
        }
        const master = out.val;
        safe("master mute", () => master.setMute(mode === "mute"));
        safe("master pause", () => master.setPaused(mode === "pause"));
    }

    /** @brief Installs gesture, visibility and focus listeners. */
    function installListeners() {
        for (const type of UNLOCK_EVENTS) {
            document.addEventListener(type, unlock, true);
        }
        document.addEventListener("visibilitychange", () => {
            focusState.hidden = document.visibilityState === "hidden";
            applyFocus();
        });
        window.addEventListener("blur", () => {
            focusState.blurred = true;
            applyFocus();
        });
        window.addEventListener("focus", () => {
            focusState.blurred = false;
            applyFocus();
        });
        if (typeof nw === "object" && nw.Window) {
            const win = nw.Window.get();
            win.on("blur", () => {
                focusState.blurred = true;
                applyFocus();
            });
            win.on("focus", () => {
                focusState.blurred = false;
                applyFocus();
            });
            win.on("minimize", () => {
                focusState.hidden = true;
                applyFocus();
            });
            win.on("restore", () => {
                focusState.hidden = false;
                applyFocus();
            });
        }
        window.addEventListener("beforeunload", shutdown);
    }

    //-------------------------------------------------------------------------
    // Startup, update, shutdown
    //-------------------------------------------------------------------------

    let bootStarted = 0;

    /** @brief Creates the wasm module; init() runs when it is ready. */
    function boot() {
        bootStarted = performance.now();
        if (typeof FMODModule !== "function") {
            fail("js/libs/fmodstudio.js is not loaded (add it to js/main.js)");
            return;
        }
        // The wasm is read with XHR (like MZ's data files) so it loads the
        // same way from file:// (NW.js), chrome-extension:// and http(s).
        fetchBytes(WASM_URL).then(
            bytes => createModule(bytes),
            () => createModule(null)
        );
    }

    const WASM_URL = "js/libs/fmodstudio.wasm";

    /**
     * @brief Instantiates the Emscripten module.
     * @param {Uint8Array|null} wasmBinary Pre-loaded wasm, or null to let
     *        FMOD fetch it.
     */
    function createModule(wasmBinary) {
        const module = {
            INITIAL_MEMORY: CONFIG.memoryMb * 1024 * 1024,
            locateFile: file => `js/libs/${file}`,
            onRuntimeInitialized: () => init(module),
            print: text => console.log(`[FMOD] ${text}`),
            printErr: text => console.warn(`[FMOD] ${text}`),
        };
        if (wasmBinary) {
            module.wasmBinary = wasmBinary;
        }
        try {
            const p = FMODModule(module);
            if (p && p.catch) {
                p.catch(e => fail(e && e.message ? e.message : String(e)));
            }
        } catch (e) {
            fail(e.message);
        }
    }

    /**
     * @brief Creates and initialises the Studio system.
     * @param {Object} module The ready Emscripten module.
     */
    function init(module) {
        if (api.failed) {
            return; // Timed out already.
        }
        F = module;
        api.module = F;
        try {
            if (!check(F.Studio_System_Create(out), "Studio_System_Create")) {
                throw new Error("Studio_System_Create failed");
            }
            studio = out.val;
            check(studio.getCoreSystem(out), "getCoreSystem");
            core = out.val;
            check(core.setDSPBufferSize(CONFIG.dspBufferLength, CONFIG.dspBufferCount), "setDSPBufferSize");
            const adv = F.STUDIO_ADVANCEDSETTINGS();
            check(studio.getAdvancedSettings(adv), "getAdvancedSettings");
            adv.idlesampledatapoolsize = Math.floor(CONFIG.idlePoolKb * 1024);
            if (CONFIG.encryptionKey) {
                adv.encryptionkey = CONFIG.encryptionKey;
            }
            check(studio.setAdvancedSettings(adv), "setAdvancedSettings");
            if (api.outputType !== undefined) {
                check(core.setOutput(api.outputType), "setOutput");
            }
            const coreFlags = F.INIT_NORMAL | (CONFIG.handedness === "right" ? F.INIT_3D_RIGHTHANDED : 0);
            const result = studio.initialize(CONFIG.maxChannels, F.STUDIO_INIT_NORMAL, coreFlags, null);
            if (!check(result, "Studio initialize")) {
                throw new Error(F.ErrorString(result));
            }
            check(core.set3DSettings(CONFIG.dopplerScale, CONFIG.distanceFactor, CONFIG.rolloffScale), "set3DSettings");
            const ver = {};
            if (core.getVersion(ver, {}) === F.OK) {
                const v = ver.val;
                api.version = `${(v >> 16) & 0xffff}.${((v >> 8) & 0xff).toString(16).padStart(2, "0")}.${(v & 0xff).toString(16).padStart(2, "0")}`;
            }
        } catch (e) {
            fail(e.message);
            return;
        }
        api.available = true;
        try {
            installListeners();
        } catch (e) {
            errors.add("installListeners", -1, e.message);
        }
        lastTime = performance.now();
        Promise.all(CONFIG.startupBanks.map(b => loadBank(b, { sampleData: CONFIG.preloadSampleData }))).then(loaded => {
            if (api.failed) {
                return;
            }
            applyGlobals();
            api.ready = true;
            const ok = loaded.filter(Boolean).length;
            console.log(`PokeMZ_FMOD: FMOD ${api.version} running, ${ok}/${loaded.length} startup bank(s) loaded`);
            for (const hook of hooks) {
                if (hook.onReady) {
                    hook.onReady();
                }
            }
            emit("ready");
        });
    }

    /**
     * @brief Gives up on FMOD; MZ audio is used from now on.
     * @param {string} reason Why.
     */
    function fail(reason) {
        if (api.failed) {
            return;
        }
        console.warn(`PokeMZ_FMOD: FMOD unavailable (${reason}); using MZ audio.`);
        errors.add("startup", -3, reason);
        api.failed = true;
        api.available = false;
        api.ready = false;
        emit("failed", reason);
    }

    /** @return {boolean} True once FMOD is ready or has given up. */
    function settled() {
        if (api.ready || api.failed) {
            return true;
        }
        if (bootStarted && performance.now() - bootStarted > CONFIG.bootTimeout * 1000) {
            fail(`not ready after ${CONFIG.bootTimeout} s`);
            return true;
        }
        return false;
    }

    let lastTime = 0;

    /**
     * @brief Once per rendered frame: hooks, fades, 3D positions, studio
     *        update, callbacks and bank loading.
     */
    function update() {
        if (!api.available || !studio) {
            return;
        }
        const now = performance.now();
        api.timing.frames++;
        const dt = Math.min(250, now - lastTime);
        lastTime = now;
        for (const hook of hooks) {
            if (hook.onPreUpdate) {
                hook.onPreUpdate(dt);
            }
        }
        for (const h of Array.from(live)) {
            if (h.fade) {
                h.stepFade(dt);
            }
            h.update3D(dt);
        }
        const t0 = performance.now();
        check(studio.update(), "studio update");
        api.timing.studioUpdateMs = performance.now() - t0;
        flushCallbacks();
        // STOPPED normally arrives through the callback; poll as a safety net
        // (a destroyed one-shot reports an invalid handle, read as stopped).
        for (const h of Array.from(live)) {
            if (h.started && h.playbackState() === F.STUDIO_PLAYBACK_STOPPED) {
                h.finish();
            }
        }
        pollBanks();
        pollPreloads();
        if (api.timing.frames % 30 === 0) {
            enforceBudget();
        }
        for (const hook of hooks) {
            if (hook.onUpdate) {
                hook.onUpdate(dt);
            }
        }
        api.timing.updateMs = performance.now() - now;
        emit("update", dt);
    }

    /** @brief Releases everything (window closing). */
    function shutdown() {
        if (!studio) {
            return;
        }
        for (const hook of hooks) {
            if (hook.onShutdown) {
                hook.onShutdown();
            }
        }
        try {
            studio.unloadAll();
            studio.release();
        } catch (e) {
            // Closing anyway.
        }
        studio = null;
        core = null;
        api.available = false;
        api.ready = false;
        live.clear();
        named.clear();
    }

    //-------------------------------------------------------------------------
    // Sample data preloading and memory budget
    //-------------------------------------------------------------------------

    /** @brief key -> {key, kind, path, file, refs, pinned, state, lastUsed, waiters}. */
    const preloads = new Map();
    let overBudget = false;

    /**
     * @brief Normalises a preload target.
     * @param {string} target "event:/..." / "snapshot:/..." or a bank name.
     * @return {{key: string, kind: string}} Key and kind (event or bank).
     */
    function preloadKey(target) {
        const t = String(target || "").trim();
        return /^(event|snapshot):\//i.test(t) || /^\{.*\}$/.test(t) ? { key: t, kind: "event" } : { key: bankFile(t), kind: "bank" };
    }

    /**
     * @brief Asks FMOD to load (or unload) the sample data of an entry.
     * @param {Object} e Preload entry.
     * @param {boolean} load Load or unload.
     * @return {boolean} True if the request was accepted.
     */
    function requestSamples(e, load) {
        let target = null;
        if (e.kind === "event") {
            target = getEvent(e.key);
        } else {
            const b = bankManager.banks.get(e.key);
            target = b && b.state === "loaded" ? b.bank : null;
        }
        if (!target) {
            return false;
        }
        return check(load ? target.loadSampleData() : target.unloadSampleData(), `${load ? "load" : "unload"}SampleData(${e.key})`);
    }

    /**
     * @brief Settles waiters of an entry.
     * @param {Object} e Preload entry.
     * @param {boolean} ok Result.
     */
    function settlePreload(e, ok) {
        for (const fn of e.waiters.splice(0)) {
            fn(ok);
        }
    }

    /**
     * @brief Keeps an event's (or a bank's) sample data in memory.
     *        Reference counted: call releasePreload() once per preload().
     * @param {string} target Event path or bank name.
     * @param {Object} [opts] {pinned: never evicted by the budget}.
     * @return {Promise<boolean>} True once the samples are loaded.
     */
    function preload(target, opts = {}) {
        if (!api.available) {
            return Promise.resolve(false);
        }
        const { key, kind } = preloadKey(target);
        let e = preloads.get(key);
        if (!e) {
            e = { key, kind, refs: 0, pinned: false, state: "loading", lastUsed: performance.now(), waiters: [] };
            preloads.set(key, e);
            const begin = () => {
                if (!preloads.has(key)) {
                    return;
                }
                if (requestSamples(e, true)) {
                    e.state = "loading";
                } else {
                    e.state = "error";
                    settlePreload(e, false);
                }
            };
            if (kind === "bank") {
                loadBank(key).then(ok => (ok ? begin() : ((e.state = "error"), settlePreload(e, false))));
            } else {
                begin();
            }
        }
        e.refs++;
        e.pinned = e.pinned || !!opts.pinned;
        e.lastUsed = performance.now();
        emit("preload", { key, refs: e.refs });
        if (e.state === "loaded") {
            return Promise.resolve(true);
        }
        if (e.state === "error") {
            return Promise.resolve(false);
        }
        return new Promise(resolve => e.waiters.push(resolve));
    }

    /**
     * @brief Drops one preload reference; unloads the samples at zero.
     * @param {string} target Event path or bank name.
     */
    function releasePreload(target) {
        const { key, kind } = preloadKey(target);
        const e = preloads.get(key);
        if (!e || --e.refs > 0) {
            return;
        }
        preloads.delete(key);
        if (e.state === "loaded" || e.state === "loading") {
            requestSamples(e, false);
        }
        settlePreload(e, false);
        if (kind === "bank") {
            unloadBank(key);
        }
    }

    /**
     * @brief Notes that an event was used; reloads it if it was evicted.
     * @param {string} path Event path.
     */
    function touchPreload(path) {
        const e = preloads.get(path);
        if (!e) {
            return;
        }
        e.lastUsed = performance.now();
        if (e.state === "evicted" && requestSamples(e, true)) {
            e.state = "loading";
        }
    }

    /** @brief Checks the sample loading state of pending preloads. */
    function pollPreloads() {
        for (const e of preloads.values()) {
            if (e.state !== "loading") {
                continue;
            }
            let target = null;
            if (e.kind === "event") {
                target = getEvent(e.key);
            } else {
                const b = bankManager.banks.get(e.key);
                target = b && b.bank;
            }
            const o = {};
            if (!target || target.getSampleLoadingState(o) !== F.OK) {
                e.state = "error";
                settlePreload(e, false);
            } else if (o.val === F.STUDIO_LOADING_STATE_LOADED) {
                e.state = "loaded";
                settlePreload(e, true);
            } else if (o.val === F.STUDIO_LOADING_STATE_ERROR) {
                e.state = "error";
                check(F.ERR_FILE_BAD, `sample data ${e.key}`);
                settlePreload(e, false);
            }
        }
    }

    /**
     * @brief FMOD memory usage and the budget.
     * @return {Object} {current, peak, heap, budget, over, platform} in bytes.
     */
    function memory() {
        const out = { current: 0, peak: 0, heap: 0, budget: CONFIG.budgetMb * 1048576, over: overBudget, platform: PLATFORM };
        if (F) {
            const cur = {};
            const max = {};
            if (F.Memory_GetStats(cur, max, false) === F.OK) {
                out.current = cur.val;
                out.peak = max.val;
            }
            out.heap = F.HEAP8 ? F.HEAP8.length : 0;
        }
        return out;
    }

    /**
     * @brief Over budget: unloads the least recently used preload (one per
     *        check, as FMOD frees memory over the next updates). Warns once
     *        per episode when nothing more can be unloaded.
     */
    function enforceBudget() {
        const mem = memory();
        const state = budgetState(mem.current, mem.budget, overBudget);
        overBudget = state.over;
        if (state.ended) {
            emit("budget", { over: false, memory: mem });
            budgetWarned = false;
        }
        if (!state.over) {
            return;
        }
        if (state.started) {
            emit("budget", { over: true, memory: mem });
        }
        const victim = pickEvictions(preloads.values(), performance.now(), CONFIG.evictAfter * 1000)[0];
        if (victim) {
            requestSamples(victim, false);
            victim.state = "evicted";
            emit("evicted", { key: victim.key, memory: mem });
        } else if (!budgetWarned) {
            budgetWarned = true;
            const mb = n => (n / 1048576).toFixed(1);
            const text = `${mb(mem.current)} MB in use, budget ${mb(mem.budget)} MB, nothing left to unload`;
            errors.add("memory budget", -4, text);
            console.warn(`PokeMZ_FMOD: over memory budget: ${text}`);
        }
    }

    let budgetWarned = false;
    const extraPreloads = [];

    /**
     * @brief Preload kept across saves (plugin command preloads).
     * @param {string} target Event path or bank name.
     * @return {Promise<boolean>} Loaded.
     */
    function preloadSaved(target) {
        const { key } = preloadKey(target);
        if (extraPreloads.includes(key)) {
            return Promise.resolve(true);
        }
        extraPreloads.push(key);
        return preload(key);
    }

    /**
     * @brief Releases a preloadSaved() target.
     * @param {string} target Event path or bank name.
     */
    function releaseSaved(target) {
        const { key } = preloadKey(target);
        const i = extraPreloads.indexOf(key);
        if (i >= 0) {
            extraPreloads.splice(i, 1);
            releasePreload(key);
        }
    }

    //-------------------------------------------------------------------------
    // Save data (extended by PokeMZ_FMOD_Audio)
    //-------------------------------------------------------------------------

    /**
     * @brief Captures globals, snapshots, persistent handles and extra banks.
     * @return {Object} JSON-safe state.
     */
    function saveState() {
        return serializeState({
            globals,
            snapshots,
            handles: live,
            banks: extraBanks.slice(),
            preloads: extraPreloads.slice(),
        });
    }

    const extraBanks = [];

    /**
     * @brief Loads a bank and keeps it across saves (plugin command banks).
     * @param {string} name Bank name.
     * @return {Promise<boolean>} Loaded.
     */
    function loadSavedBank(name) {
        const file = bankFile(name);
        if (!extraBanks.includes(file)) {
            extraBanks.push(file);
            return loadBank(file);
        }
        return Promise.resolve(bankManager.state(file) === "loaded");
    }

    /**
     * @brief Unloads a bank loaded with loadSavedBank().
     * @param {string} name Bank name.
     */
    function unloadSavedBank(name) {
        const file = bankFile(name);
        const i = extraBanks.indexOf(file);
        if (i >= 0) {
            extraBanks.splice(i, 1);
            unloadBank(file);
        }
    }

    /**
     * @brief Restores a saveState() object (after loading a save).
     * @param {Object} state Saved state.
     * @return {Promise} Resolves once banks are back and handles restarted.
     */
    function restoreState(state) {
        stopAll(true);
        for (const path of Array.from(snapshots.keys())) {
            stopSnapshot(path, true);
        }
        for (const file of extraBanks.splice(0)) {
            unloadBank(file);
        }
        for (const key of extraPreloads.splice(0)) {
            releasePreload(key);
        }
        for (const k of Object.keys(globals)) {
            delete globals[k];
        }
        Object.assign(globals, CONFIG.globalDefaults);
        if (!state) {
            applyGlobals();
            return Promise.resolve();
        }
        Object.assign(globals, state.globals || {});
        for (const key of state.preloads || []) {
            preloadSaved(key);
        }
        return Promise.all((state.banks || []).map(loadSavedBank)).then(() => {
            applyGlobals();
            for (const [path, intensity] of Object.entries(state.snapshots || {})) {
                startSnapshot(path, intensity);
            }
            for (const s of state.handles || []) {
                const opts = Object.assign({}, s, { persistent: true });
                const h = s.programmerKey ? playProgrammer(s.path, s.programmerKey, opts) : play(s.path, opts);
                if (s.paused) {
                    h.pause();
                }
            }
        });
    }

    /** @brief Resets to New Game state. */
    function resetState() {
        return restoreState(null);
    }

    //-------------------------------------------------------------------------
    // Public API
    //-------------------------------------------------------------------------

    const api = {
        version: "",
        config: CONFIG,
        engine: Engine,
        available: false,
        ready: false,
        failed: false,
        module: null,
        /** @brief Set to FMOD.OUTPUTTYPE_* before boot to force an output (tests). */
        outputType: undefined,
        /** @return {Object|null} Studio::System. */
        get studio() {
            return studio;
        },
        /** @return {Object|null} Core System. */
        get core() {
            return core;
        },
        errors,
        check,
        on,
        emit,
        /**
         * @brief Registers update hooks: onReady(), onPreUpdate(dtMs),
         *        onUpdate(dtMs), onShutdown().
         * @param {Object} hook Hook object.
         */
        addHook: hook => hooks.push(hook),
        Handle,
        live,
        named,
        snapshots,
        globals,
        bankFile,
        banks: bankManager,
        loadBank,
        unloadBank,
        loadSavedBank,
        unloadSavedBank,
        /** @return {boolean} True while banks are loading. */
        banksBusy: () => bankManager.busy(),
        getEvent,
        hasEvent,
        eventInfo,
        create,
        play,
        oneShot,
        playProgrammer,
        handle,
        stop,
        stopScope,
        stopAll,
        setGlobalParameter,
        getGlobalParameter,
        applyGlobals,
        startSnapshot,
        stopSnapshot,
        getMixer,
        setMixerVolume,
        setMixerPaused,
        setMixerMute,
        unlock,
        update,
        shutdown,
        settled,
        saveState,
        restoreState,
        resetState,
        /** @return {Object} Focus state (debug). */
        focusState: () => Object.assign({}, focusState),
        platform: PLATFORM,
        /** @brief Frame timing: updateMs (whole FMOD update), studioUpdateMs, frames. */
        timing: { updateMs: 0, studioUpdateMs: 0, frames: 0 },
        preloads,
        preload,
        releasePreload,
        preloadSaved,
        releaseSaved,
        memory,
        enforceBudget,
    };

    window.PokeMZ = window.PokeMZ || {};
    window.PokeMZ.FMOD = api;

    //-------------------------------------------------------------------------
    // MZ hooks
    //-------------------------------------------------------------------------

    const _updateMain = SceneManager.updateMain;
    SceneManager.updateMain = function() {
        _updateMain.apply(this, arguments);
        update();
    };

    const _terminate = SceneManager.terminate;
    SceneManager.terminate = function() {
        shutdown();
        _terminate.apply(this, arguments);
    };

    const _bootIsReady = Scene_Boot.prototype.isReady;
    Scene_Boot.prototype.isReady = function() {
        return _bootIsReady.apply(this, arguments) && settled();
    };

    // Scene scope ends with the scene.
    const _changeScene = SceneManager.changeScene;
    SceneManager.changeScene = function() {
        const changing = this.isSceneChanging() && !this.isCurrentSceneBusy() && this._nextScene;
        if (changing && api.available) {
            stopScope("scene");
        }
        _changeScene.apply(this, arguments);
    };

    boot();
})();
