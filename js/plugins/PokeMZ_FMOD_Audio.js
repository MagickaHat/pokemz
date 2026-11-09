//=============================================================================
// PokéMZ - FMOD_Audio.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Routes MZ's BGM/BGS/ME/SE and system sounds to FMOD
 * events, with .ogg fallback, volume options, save/load and plugin commands.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_FMOD_Core
 * @orderAfter PokeMZ_FMOD_Core
 *
 * @param mapping
 * @text Name Mapping
 * @desc Explicit MZ name -> FMOD event pairs. Checked before the naming
 * conventions. Event "-" forces the .ogg file.
 * @type struct<Mapping>[]
 * @default []
 *
 * @param conventions
 * @text Naming Conventions
 * @type struct<Conventions>
 * @default {"bgm":"event:/BGM/{name}","bgs":"event:/BGS/{name}","me":"event:/ME/{name}","se":"event:/SE/{name}","system":"event:/System/{name}"}
 *
 * @param enabled
 * @text Use FMOD For
 * @desc Categories routed to FMOD when a matching event exists.
 * @type struct<Enabled>
 * @default {"bgm":"true","bgs":"true","me":"true","se":"true","system":"true"}
 *
 * @param vcas
 * @text Volume Option VCAs
 * @desc VCAs driven by the Options volume sliders. A missing VCA makes the
 * slider scale the event volume instead.
 * @type struct<Vcas>
 * @default {"master":"vca:/Master","bgm":"vca:/BGM","bgs":"vca:/BGS","me":"vca:/ME","se":"vca:/SE"}
 *
 * @param masterOption
 * @text Master Volume Option
 * @desc Adds "Master Volume" to Options (scales FMOD and MZ audio).
 * @type boolean
 * @default true
 *
 * @param masterOptionName
 * @text Master Volume Label
 * @parent masterOption
 * @type string
 * @default Master Volume
 *
 * @param meMode
 * @text ME Behaviour
 * @desc What an ME does to an FMOD BGM. restart: MZ's way (stop, then
 * resume from the same spot). pause: pause and resume. duck: keep playing
 * under the snapshot below. overlap: keep playing.
 * @type select
 * @option restart
 * @option pause
 * @option duck
 * @option overlap
 * @default pause
 *
 * @param meDuckSnapshot
 * @text ME Duck Snapshot
 * @parent meMode
 * @type string
 * @default snapshot:/MEDuck
 *
 * @param panParameter
 * @text Pan Parameter
 * @desc Local parameter receiving MZ's pan (-1..1), if the event has it.
 * MZ pitch uses setPitch.
 * @type string
 * @default Pan
 *
 * @param mapFade
 * @text Map Scope Fade (seconds)
 * @desc Fade for map-scoped instances when leaving the map. 0 = FMOD's
 * authored fade-out.
 * @type number
 * @decimals 2
 * @min 0
 * @default 0.50
 *
 * @param menuSnapshot
 * @text Menu Snapshot
 * @desc Active while a menu scene is open (e.g. muffle the world).
 * @type string
 * @default
 *
 * @param battleSnapshot
 * @text Battle Snapshot
 * @type string
 * @default
 *
 * @param markerActions
 * @text Marker Actions
 * @desc Timeline markers named "Switch:12=on", "Variable:5=3" or
 * "CommonEvent:7" act on the game.
 * @type boolean
 * @default true
 *
 * @command playEvent
 * @text Play Event
 * @desc Starts an FMOD event instance you can control later by name.
 *
 * @arg event
 * @text Event Path
 * @type string
 * @default event:/
 *
 * @arg name
 * @text Handle Name
 * @desc Name used by other commands. Playing a name again replaces it.
 * @type string
 * @default
 *
 * @arg scope
 * @text Scope
 * @desc map: stops when leaving the map. scene: when the scene changes.
 * @type select
 * @option global
 * @option map
 * @option scene
 * @default map
 *
 * @arg persistent
 * @text Keep In Save Files
 * @type boolean
 * @default false
 *
 * @arg target
 * @text Position (3D)
 * @desc none, player, this, event 5, or tile 10 12.
 * @type string
 * @default none
 *
 * @arg volume
 * @text Volume %
 * @type number
 * @min 0
 * @default 100
 *
 * @arg pitch
 * @text Pitch %
 * @type number
 * @min 1
 * @default 100
 *
 * @arg params
 * @text Parameters
 * @desc e.g. "Intensity:0.5, Surface:Grass"
 * @type string
 * @default
 *
 * @arg fadeIn
 * @text Fade In (seconds)
 * @type number
 * @decimals 2
 * @min 0
 * @default 0
 *
 * @arg wait
 * @text Wait For End
 * @type boolean
 * @default false
 *
 * @command playOneShot
 * @text Play One-Shot
 * @desc Fire-and-forget event (footsteps, UI, impacts).
 *
 * @arg event
 * @text Event Path
 * @type string
 * @default event:/
 *
 * @arg target
 * @text Position (3D)
 * @desc none, player, this, event 5, or tile 10 12.
 * @type string
 * @default none
 *
 * @arg volume
 * @text Volume %
 * @type number
 * @min 0
 * @default 100
 *
 * @arg pitch
 * @text Pitch %
 * @type number
 * @min 1
 * @default 100
 *
 * @arg params
 * @text Parameters
 * @type string
 * @default
 *
 * @command playProgrammer
 * @text Play Programmer Sound
 * @desc Plays an event whose programmer instrument plays an audio table key
 * (e.g. event:/Cry with key Cry025).
 *
 * @arg event
 * @text Event Path
 * @type string
 * @default event:/Cry
 *
 * @arg key
 * @text Audio Table Key
 * @type string
 * @default
 *
 * @arg name
 * @text Handle Name
 * @type string
 * @default
 *
 * @arg target
 * @text Position (3D)
 * @type string
 * @default none
 *
 * @arg volume
 * @text Volume %
 * @type number
 * @min 0
 * @default 100
 *
 * @arg wait
 * @text Wait For End
 * @type boolean
 * @default false
 *
 * @command stopEvent
 * @text Stop Event
 *
 * @arg name
 * @text Handle Name
 * @type string
 * @default
 *
 * @arg mode
 * @text Stop Mode
 * @desc fade (FMOD's authored fade-out), immediate, or seconds (e.g. 1.5).
 * @type string
 * @default fade
 *
 * @command pauseEvent
 * @text Pause / Resume Event
 *
 * @arg name
 * @text Handle Name
 * @desc A handle name, or bgm / bgs.
 * @type string
 * @default
 *
 * @arg paused
 * @text Paused
 * @type boolean
 * @default true
 *
 * @command setParameter
 * @text Set Parameter
 * @desc Sets a local parameter on a handle, or on the current BGM/BGS.
 *
 * @arg name
 * @text Handle Name
 * @desc A handle name, or bgm / bgs.
 * @type string
 * @default bgm
 *
 * @arg parameter
 * @text Parameter
 * @type string
 * @default
 *
 * @arg value
 * @text Value
 * @desc A number, a label, or \V[n] for a variable.
 * @type string
 * @default 0
 *
 * @arg instant
 * @text Ignore Seek Speed
 * @type boolean
 * @default false
 *
 * @command setGlobalParameter
 * @text Set Global Parameter
 *
 * @arg parameter
 * @text Parameter
 * @type string
 * @default
 *
 * @arg value
 * @text Value
 * @desc A number, a label, or \V[n] for a variable.
 * @type string
 * @default 0
 *
 * @command startSnapshot
 * @text Start Snapshot
 *
 * @arg snapshot
 * @text Snapshot Path
 * @type string
 * @default snapshot:/
 *
 * @arg intensity
 * @text Intensity %
 * @type number
 * @min 0
 * @max 100
 * @default 100
 *
 * @command stopSnapshot
 * @text Stop Snapshot
 *
 * @arg snapshot
 * @text Snapshot Path
 * @type string
 * @default snapshot:/
 *
 * @arg immediate
 * @text Immediate
 * @type boolean
 * @default false
 *
 * @command loadBank
 * @text Load Bank
 * @desc Loads a bank and keeps it loaded (also after loading a save).
 *
 * @arg bank
 * @text Bank
 * @type string
 * @default
 *
 * @arg wait
 * @text Wait Until Loaded
 * @type boolean
 * @default true
 *
 * @command unloadBank
 * @text Unload Bank
 *
 * @arg bank
 * @text Bank
 * @type string
 * @default
 *
 * @command setMixerVolume
 * @text Set Bus / VCA Volume
 *
 * @arg path
 * @text Bus or VCA Path
 * @type string
 * @default vca:/
 *
 * @arg volume
 * @text Volume %
 * @type number
 * @min 0
 * @default 100
 *
 * @command keyOff
 * @text Key Off (Sustain Point)
 *
 * @arg name
 * @text Handle Name
 * @type string
 * @default
 *
 * @command setTimeline
 * @text Set Timeline Position
 *
 * @arg name
 * @text Handle Name
 * @desc A handle name, or bgm / bgs.
 * @type string
 * @default
 *
 * @arg ms
 * @text Position (ms)
 * @type number
 * @min 0
 * @default 0
 *
 * @command waitForEvent
 * @text Wait For Event End
 *
 * @arg name
 * @text Handle Name
 * @type string
 * @default
 *
 * @command waitForMarker
 * @text Wait For Marker
 *
 * @arg name
 * @text Handle Name
 * @desc A handle name, or bgm / bgs.
 * @type string
 * @default bgm
 *
 * @arg marker
 * @text Marker Name
 * @desc Empty = any marker.
 * @type string
 * @default
 *
 * @command stopAll
 * @text Stop All Script Events
 * @desc Stops every instance started by commands/scripts (not BGM/BGS/ME).
 *
 * @arg immediate
 * @text Immediate
 * @type boolean
 * @default false
 *
 * @help
 * ============================================================================
 * PokeMZ_FMOD_Audio
 * ============================================================================
 * Place below PokeMZ_FMOD_Core. Every MZ sound (event commands, map BGM,
 * battle music, system sounds, PokeMZ UI sounds) checks for an FMOD event:
 *   1. Name Mapping table (type + MZ file name -> event path)
 *   2. Naming conventions, e.g. bgm "Battle1" -> event:/BGM/Battle1
 *      system sounds use their role: event:/System/Cursor, Ok, Cancel ...
 *   3. Otherwise the .ogg file plays as usual (fallback).
 * Volume % -> event volume, pitch % -> setPitch, pan -> "Pan" parameter.
 * FMOD events loop (or not) as authored in Studio.
 *
 * Map note:
 *   <FMOD Bank: Forest, Caves>   banks loaded while on this map (the map
 *                                waits for them before it starts)
 *
 * Save files keep the BGM/BGS timeline and parameters, global parameters,
 * snapshots started by command, persistent handles and banks loaded by
 * command.
 *
 * Script: $gameSystem's BGM parameters
 *   PokeMZ.FMOD.audio.setBgmParameter("Intensity", 1)
 *   PokeMZ.FMOD.audio.bgm()   -> Handle of the current FMOD BGM (or null)
 *
 * Positions ("Position (3D)") need PokeMZ_FMOD_Spatial.
 */

/*~struct~Mapping:
 * @param type
 * @text Type
 * @type select
 * @option any
 * @option bgm
 * @option bgs
 * @option me
 * @option se
 * @option system
 * @default any
 *
 * @param name
 * @text MZ Name
 * @desc File name without extension; for system: Cursor, Ok, Cancel,
 * Buzzer, Equip, Save, Load, BattleStart, Escape, ...
 * @type string
 * @default
 *
 * @param event
 * @text Event Path
 * @type string
 * @default event:/
 */

/*~struct~Conventions:
 * @param bgm
 * @type string
 * @default event:/BGM/{name}
 * @param bgs
 * @type string
 * @default event:/BGS/{name}
 * @param me
 * @type string
 * @default event:/ME/{name}
 * @param se
 * @type string
 * @default event:/SE/{name}
 * @param system
 * @type string
 * @default event:/System/{name}
 */

/*~struct~Enabled:
 * @param bgm
 * @type boolean
 * @default true
 * @param bgs
 * @type boolean
 * @default true
 * @param me
 * @type boolean
 * @default true
 * @param se
 * @type boolean
 * @default true
 * @param system
 * @type boolean
 * @default true
 */

/*~struct~Vcas:
 * @param master
 * @type string
 * @default vca:/Master
 * @param bgm
 * @type string
 * @default vca:/BGM
 * @param bgs
 * @type string
 * @default vca:/BGS
 * @param me
 * @type string
 * @default vca:/ME
 * @param se
 * @type string
 * @default vca:/SE
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_FMOD_Audio";
    const FMOD = window.PokeMZ && window.PokeMZ.FMOD;
    if (!FMOD) {
        console.error(`${PLUGIN_NAME}: PokeMZ_FMOD_Core must be enabled above this plugin.`);
        return;
    }
    const E = FMOD.engine;
    const params = PluginManager.parameters(PLUGIN_NAME);
    const parseJson = (v, fallback) => {
        try {
            return v ? JSON.parse(v) : fallback;
        } catch (e) {
            return fallback;
        }
    };
    const parseBool = (v, fallback) => (v === undefined || v === "" ? fallback : v === "true" || v === true);
    const num = (v, fallback) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? fallback : Number(v));

    const enabled = parseJson(params.enabled, {});
    const CONFIG = {
        mapping: parseJson(params.mapping, []).map(s => parseJson(s, {})),
        conventions: Object.assign(
            {
                bgm: "event:/BGM/{name}",
                bgs: "event:/BGS/{name}",
                me: "event:/ME/{name}",
                se: "event:/SE/{name}",
                system: "event:/System/{name}",
            },
            parseJson(params.conventions, {})
        ),
        enabled: {
            bgm: parseBool(enabled.bgm, true),
            bgs: parseBool(enabled.bgs, true),
            me: parseBool(enabled.me, true),
            se: parseBool(enabled.se, true),
            system: parseBool(enabled.system, true),
        },
        vcas: Object.assign(
            { master: "vca:/Master", bgm: "vca:/BGM", bgs: "vca:/BGS", me: "vca:/ME", se: "vca:/SE" },
            parseJson(params.vcas, {})
        ),
        masterOption: parseBool(params.masterOption, true),
        masterOptionName: params.masterOptionName || "Master Volume",
        meMode: params.meMode || "pause",
        meDuckSnapshot: params.meDuckSnapshot || "",
        panParameter: params.panParameter || "Pan",
        mapFade: num(params.mapFade, 0.5),
        menuSnapshot: params.menuSnapshot || "",
        battleSnapshot: params.battleSnapshot || "",
        markerActions: parseBool(params.markerActions, true),
    };

    /** @brief MZ system sound index -> role name used for mapping. */
    const SYSTEM_SOUNDS = [
        "Cursor", "Ok", "Cancel", "Buzzer", "Equip", "Save", "Load", "BattleStart",
        "Escape", "EnemyAttack", "EnemyDamage", "EnemyCollapse", "BossCollapse1",
        "BossCollapse2", "ActorDamage", "ActorCollapse", "Recovery", "Miss",
        "Evasion", "MagicEvasion", "Reflection", "Shop", "UseItem", "UseSkill",
    ];

    //=========================================================================
    // Name mapping
    //=========================================================================

    const mapper = E.createNameMapper({
        explicit: CONFIG.mapping,
        conventions: CONFIG.conventions,
        exists: path => FMOD.hasEvent(path),
    });

    /**
     * @brief Finds the FMOD event for an MZ sound, or null to use the .ogg.
     * @param {string} type bgm, bgs, me, se or system.
     * @param {string} name MZ file name or system role.
     * @return {string|null} Event path.
     */
    function mapAudio(type, name) {
        if (!FMOD.available || !CONFIG.enabled[type] || !name) {
            return null;
        }
        return mapper.resolve(type, name);
    }

    FMOD.on("banksChanged", () => {
        mapper.clear();
        panCache.clear();
        vcaApplied.clear();
        // Static SE buffers made before a bank arrived may point at the
        // wrong backend; MZ recreates them on demand.
        AudioManager._staticBuffers = AudioManager._staticBuffers.filter(b => {
            if (b.isPlaying()) {
                return true;
            }
            b.destroy();
            return false;
        });
    });

    //=========================================================================
    // Volume
    //=========================================================================

    const vcaApplied = new Map();

    /**
     * @param {string} type bgm, bgs, me or se.
     * @return {boolean} True if the option slider drives a VCA.
     */
    const hasVca = type => !!FMOD.getMixer(CONFIG.vcas[type]);

    /**
     * @brief Event-volume factor for an MZ category when its VCA is missing.
     * @param {string} type bgm, bgs, me, se or system.
     * @return {number} Factor (0-1).
     */
    function categoryGain(type) {
        const t = type === "system" ? "se" : type;
        if (hasVca(t)) {
            return 1;
        }
        return (AudioManager[`_${t}Volume`] !== undefined ? AudioManager[`_${t}Volume`] : 100) / 100;
    }

    /** @brief Pushes the Options volumes to the VCAs when they change. */
    function syncVcas() {
        const values = {
            master: ConfigManager.pokemzMasterVolume / 100,
            bgm: AudioManager._bgmVolume / 100,
            bgs: AudioManager._bgsVolume / 100,
            me: AudioManager._meVolume / 100,
            se: AudioManager._seVolume / 100,
        };
        for (const [type, value] of Object.entries(values)) {
            if (vcaApplied.get(type) === value) {
                continue;
            }
            vcaApplied.set(type, value);
            if (!FMOD.setMixerVolume(CONFIG.vcas[type], value) && type === "master") {
                FMOD.setMixerVolume("bus:/", value);
            }
        }
    }

    const panCache = new Map();

    /**
     * @param {string} path Event path.
     * @return {boolean} True if the event has the pan parameter.
     */
    function hasPan(path) {
        if (!panCache.has(path)) {
            const info = FMOD.eventInfo(path);
            panCache.set(path, !!info && info.params.some(p => p.name === CONFIG.panParameter));
        }
        return panCache.get(path);
    }

    //=========================================================================
    // FmodBuffer: a WebAudio look-alike so AudioManager runs unchanged
    //=========================================================================

    /**
     * @brief Stands in for MZ's WebAudio for sounds mapped to FMOD. Every
     *        play() creates a fresh event instance.
     */
    class FmodBuffer {
        /**
         * @param {string} type bgm, bgs, me, se or system.
         * @param {string} name MZ name.
         * @param {string} path Event path.
         */
        constructor(type, name, path) {
            this.isFmod = true;
            this.type = type;
            this.name = name;
            this.path = path;
            this.url = path;
            this.frameCount = Graphics.frameCount;
            this.handle = null;
            this.params = {};
            this._volume = 1;
            this._pitch = 1;
            this._pan = 0;
            this._isPlaying = false;
            this._stopListeners = [];
            this.pausedForMe = false;
        }

        /** @return {number} Volume (0-1, MZ sound volume only). */
        get volume() {
            return this._volume;
        }

        /** @param {number} v Volume. */
        set volume(v) {
            this._volume = v;
            if (this.handle) {
                this.handle.setVolume(v).setGain(categoryGain(this.type));
            }
        }

        /** @return {number} Pitch multiplier. */
        get pitch() {
            return this._pitch;
        }

        /** @param {number} p Pitch multiplier. */
        set pitch(p) {
            this._pitch = p || 1;
            if (this.handle) {
                this.handle.setPitch(this._pitch);
            }
        }

        /** @return {number} Pan (-1..1). */
        get pan() {
            return this._pan;
        }

        /** @param {number} p Pan (-1..1). */
        set pan(p) {
            this._pan = p;
            if (this.handle && hasPan(this.path)) {
                this.handle.setParameter(CONFIG.panParameter, p);
            }
        }

        /** @return {boolean} Always true (banks are loaded up front). */
        isReady() {
            return true;
        }

        /** @return {boolean} Never true: FMOD problems never stop the game. */
        isError() {
            return false;
        }

        /** @return {boolean} True between play() and stop()/fadeOut(). */
        isPlaying() {
            return this._isPlaying;
        }

        /**
         * @brief Starts a new instance.
         * @param {boolean} loop Ignored (looping is authored in FMOD Studio).
         * @param {number} [offset=0] Start position in seconds.
         */
        play(loop, offset) {
            this.dropHandle();
            const h = FMOD.create(this.path, {
                volume: this._volume,
                pitch: this._pitch,
                gain: categoryGain(this.type),
                params: this.params,
                timeline: offset > 0 ? offset * 1000 : 0,
            });
            h.owner = "mz";
            if (hasPan(this.path) && this._pan) {
                h.setParameter(CONFIG.panParameter, this._pan);
            }
            h.on("stopped", () => {
                if (this.handle === h) {
                    this.handle = null;
                    this._isPlaying = false;
                    this.fireStop();
                }
            });
            this.handle = h;
            this.pausedForMe = false;
            h.start();
            this._isPlaying = true;
        }

        /** @brief Stops the current instance without notifying listeners. */
        dropHandle() {
            const h = this.handle;
            this.handle = null;
            if (h) {
                h.stop(true);
            }
        }

        /** @brief Calls (and clears) the stop listeners, like WebAudio. */
        fireStop() {
            while (this._stopListeners.length > 0) {
                this._stopListeners.shift()();
            }
        }

        /** @brief Stops playback and notifies stop listeners. */
        stop() {
            this._isPlaying = false;
            this.pausedForMe = false;
            this.dropHandle();
            this.fireStop();
        }

        /** @brief Same as stop(). */
        destroy() {
            this.stop();
        }

        /** @brief Nothing to reload. */
        retry() {}

        /**
         * @param {number} duration Fade-in seconds.
         */
        fadeIn(duration) {
            if (this.handle) {
                this.handle.fadeValue = 0;
                this.handle.applyVolume();
                this.handle.fadeTo(1, duration);
            }
        }

        /**
         * @brief Fades out, then stops the instance. Like WebAudio, the
         *        buffer reports "not playing" right away.
         * @param {number} duration Fade-out seconds.
         */
        fadeOut(duration) {
            const h = this.handle;
            if (h) {
                h.fadeTo(0, duration, () => {
                    if (this.handle === h) {
                        this.handle = null;
                    }
                    h.stop(true);
                });
            }
            this._isPlaying = false;
        }

        /** @return {number} Timeline position in seconds. */
        seek() {
            return this.handle ? this.handle.timeline() / 1000 : 0;
        }

        /** @param {Function} listener Called at once (always ready). */
        addLoadListener(listener) {
            listener();
        }

        /** @param {Function} listener Called when playback stops. */
        addStopListener(listener) {
            this._stopListeners.push(listener);
        }

        /**
         * @brief Sets a local parameter, kept for future instances.
         * @param {string} name Parameter.
         * @param {number|string} value Value or label.
         * @param {boolean} [instant=false] Ignore seek speed.
         */
        setParameter(name, value, instant) {
            this.params[name] = value;
            if (this.handle) {
                this.handle.setParameter(name, value, instant);
            }
        }

        /** @brief ME started (pause mode): pause without stopping. */
        pauseForMe() {
            if (this.handle) {
                this.handle.pause();
                this.pausedForMe = true;
            }
        }

        /**
         * @brief ME ended (pause mode): resume with a fade-in.
         * @param {number} fade Fade-in seconds.
         */
        resumeAfterMe(fade) {
            this.pausedForMe = false;
            if (this.handle) {
                this.handle.resume();
                this.fadeIn(fade);
            }
        }
    }

    //=========================================================================
    // AudioManager / SoundManager patches
    //=========================================================================

    const _createBuffer = AudioManager.createBuffer;
    AudioManager.createBuffer = function(folder, name) {
        const type = folder.replace(/\/$/, "");
        const path = mapAudio(type, name);
        if (path) {
            return new FmodBuffer(type, name, path);
        }
        return _createBuffer.apply(this, arguments);
    };

    const _updateBufferParameters = AudioManager.updateBufferParameters;
    AudioManager.updateBufferParameters = function(buffer, configVolume, audio) {
        if (buffer && buffer.isFmod && audio) {
            buffer.volume = (audio.volume || 0) / 100;
            buffer.pitch = (audio.pitch || 100) / 100;
            buffer.pan = (audio.pan || 0) / 100;
            if (audio.fmodParams) {
                for (const [k, v] of Object.entries(audio.fmodParams)) {
                    buffer.setParameter(k, v);
                }
            }
            return;
        }
        _updateBufferParameters.apply(this, arguments);
    };

    // Keep FMOD parameters with the current/saved BGM and BGS so battles,
    // "Save BGM" / "Replay BGM" and save files restore them.
    for (const kind of ["Bgm", "Bgs"]) {
        const _updateCurrent = AudioManager[`updateCurrent${kind}`];
        AudioManager[`updateCurrent${kind}`] = function(audio) {
            _updateCurrent.apply(this, arguments);
            const buffer = this[`_${kind.toLowerCase()}Buffer`];
            const params = audio.fmodParams || (buffer && buffer.isFmod ? buffer.params : null);
            if (params && Object.keys(params).length) {
                this[`_current${kind}`].fmodParams = Object.assign({}, params);
            }
        };
        const _save = AudioManager[`save${kind}`];
        AudioManager[`save${kind}`] = function() {
            const saved = _save.apply(this, arguments);
            const buffer = this[`_${kind.toLowerCase()}Buffer`];
            if (saved.name && buffer && buffer.isFmod && Object.keys(buffer.params).length) {
                saved.fmodParams = Object.assign({}, buffer.params);
            }
            return saved;
        };
    }

    let meMode = null;

    const _playMe = AudioManager.playMe;
    AudioManager.playMe = function(me) {
        const bgm = this._bgmBuffer;
        const mode = CONFIG.meMode;
        if (!me.name || !bgm || !bgm.isFmod || !this._currentBgm || mode === "restart") {
            _playMe.apply(this, arguments);
            return;
        }
        this.stopMe();
        if (mode === "pause") {
            bgm.pauseForMe();
        } else if (mode === "duck" && CONFIG.meDuckSnapshot) {
            FMOD.startSnapshot(CONFIG.meDuckSnapshot);
        }
        meMode = mode;
        this._meBuffer = this.createBuffer("me/", me.name);
        this.updateMeParameters(me);
        this._meBuffer.play(false);
        this._meBuffer.addStopListener(this.stopMe.bind(this));
    };

    const _stopMe = AudioManager.stopMe;
    AudioManager.stopMe = function() {
        const mode = meMode;
        if (!mode) {
            _stopMe.apply(this, arguments);
            return;
        }
        const me = this._meBuffer;
        this._meBuffer = null;
        meMode = null;
        if (me) {
            me.destroy();
        }
        const bgm = this._bgmBuffer;
        if (bgm && this._currentBgm) {
            if (bgm.pausedForMe) {
                bgm.resumeAfterMe(this._replayFadeTime);
            } else if (!bgm.isPlaying()) {
                // A new BGM was set while the ME played.
                bgm.play(true, this._currentBgm.pos);
                bgm.fadeIn(this._replayFadeTime);
            }
        }
        if (mode === "duck" && CONFIG.meDuckSnapshot) {
            FMOD.stopSnapshot(CONFIG.meDuckSnapshot);
        }
    };

    const _playSystemSound = SoundManager.playSystemSound;
    SoundManager.playSystemSound = function(n) {
        const path = mapAudio("system", SYSTEM_SOUNDS[n]);
        if (path && $dataSystem) {
            const se = $dataSystem.sounds[n] || {};
            FMOD.oneShot(path, {
                volume: se.name ? (se.volume || 0) / 100 : 1,
                pitch: se.name ? (se.pitch || 100) / 100 : 1,
                gain: categoryGain("system"),
            }).owner = "mz";
            return;
        }
        _playSystemSound.apply(this, arguments);
    };

    const _stopAll = AudioManager.stopAll;
    AudioManager.stopAll = function() {
        _stopAll.apply(this, arguments);
        if (FMOD.available) {
            FMOD.stopAll(true);
        }
    };

    //=========================================================================
    // Options: master volume
    //=========================================================================

    let masterVolume = 100;
    Object.defineProperty(ConfigManager, "pokemzMasterVolume", {
        get: () => masterVolume,
        set: value => {
            masterVolume = Math.max(0, Math.min(100, Number(value)));
            WebAudio.setMasterVolume(masterVolume / 100);
        },
        configurable: true,
    });

    const _makeData = ConfigManager.makeData;
    ConfigManager.makeData = function() {
        const config = _makeData.apply(this, arguments);
        config.pokemzMasterVolume = this.pokemzMasterVolume;
        return config;
    };

    const _applyData = ConfigManager.applyData;
    ConfigManager.applyData = function(config) {
        _applyData.apply(this, arguments);
        this.pokemzMasterVolume = this.readVolume(config, "pokemzMasterVolume");
    };

    if (CONFIG.masterOption) {
        const _addVolumeOptions = Window_Options.prototype.addVolumeOptions;
        Window_Options.prototype.addVolumeOptions = function() {
            const text =
                window.PokeMZ.L10n && window.PokeMZ.L10n.has && window.PokeMZ.L10n.has("UI.Options.MasterVolume")
                    ? window.PokeMZ.L10n.t("UI.Options.MasterVolume")
                    : CONFIG.masterOptionName;
            this.addCommand(text, "pokemzMasterVolume");
            _addVolumeOptions.apply(this, arguments);
        };
    }

    //=========================================================================
    // Map banks, map scope, scene snapshots, markers
    //=========================================================================

    let mapBanks = [];

    /**
     * @brief Banks named by a map's <FMOD Bank: ...> tags.
     * @param {Object} data $dataMap.
     * @return {Array<string>} Bank file names.
     */
    function banksOfMap(data) {
        const out = [];
        for (const arg of E.noteTags(data && data.note, "Bank")) {
            for (const name of arg.split(",")) {
                if (name.trim()) {
                    out.push(FMOD.bankFile(name.trim()));
                }
            }
        }
        return out;
    }

    /**
     * @brief Loads the new map's banks first, then releases the old ones
     *        (banks shared by both maps stay loaded).
     * @param {Array<string>} wanted Bank file names.
     */
    function setMapBanks(wanted) {
        const old = mapBanks;
        mapBanks = wanted;
        for (const b of wanted) {
            FMOD.loadBank(b);
        }
        for (const b of old) {
            FMOD.unloadBank(b);
        }
    }

    // The map's banks must be loaded before onMapLoaded() runs, because the
    // transfer starts the map's BGM/BGS right there.
    const _mapIsReady = Scene_Map.prototype.isReady;
    Scene_Map.prototype.isReady = function() {
        if (!this._mapLoaded && DataManager.isMapLoaded() && FMOD.available) {
            const wanted = banksOfMap($dataMap);
            if (wanted.join("|") !== mapBanks.join("|")) {
                setMapBanks(wanted);
            }
            if (FMOD.banksBusy()) {
                return false;
            }
            finishPendingLoad();
        }
        return _mapIsReady.apply(this, arguments);
    };

    const _setup = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function(mapId) {
        const changed = mapId !== this._mapId;
        if (changed && FMOD.available) {
            FMOD.stopScope("map", CONFIG.mapFade > 0 ? CONFIG.mapFade : undefined);
        }
        _setup.apply(this, arguments);
        if (changed) {
            FMOD.emit("mapChanged", mapId);
        }
    };

    /** @brief Snapshots tied to the current scene type. */
    const sceneSnapshots = { menu: null, battle: null };

    /**
     * @brief Starts/stops an automatic scene snapshot.
     * @param {string} key menu or battle.
     * @param {string} path Snapshot path ("" = feature off).
     * @param {boolean} active Wanted state.
     */
    function syncSceneSnapshot(key, path, active) {
        const h = sceneSnapshots[key];
        if (!path || active === !!(h && h.valid) || (active && !FMOD.hasEvent(path))) {
            return;
        }
        if (active) {
            const snap = FMOD.create(path, {});
            snap.owner = "scene-snapshot";
            sceneSnapshots[key] = snap.start();
        } else {
            h.stop();
            sceneSnapshots[key] = null;
        }
    }

    /**
     * @brief Runs a marker's MZ action ("Switch:12=on" etc.).
     * @param {Object} marker {name}.
     */
    function runMarkerAction(marker) {
        const action = E.parseMarkerAction(marker.name);
        if (!action || !$gameSwitches) {
            return;
        }
        if (action.type === "switch") {
            $gameSwitches.setValue(action.id, action.value);
        } else if (action.type === "variable") {
            $gameVariables.setValue(action.id, action.value);
        } else if (action.type === "commonevent") {
            $gameTemp.reserveCommonEvent(action.id);
        }
    }

    if (CONFIG.markerActions) {
        FMOD.on("marker", runMarkerAction);
    }

    FMOD.addHook({
        onUpdate() {
            syncVcas();
            const scene = SceneManager._scene;
            syncSceneSnapshot("menu", CONFIG.menuSnapshot, scene instanceof Scene_MenuBase);
            syncSceneSnapshot("battle", CONFIG.battleSnapshot, scene instanceof Scene_Battle);
        },
    });

    //=========================================================================
    // Save / load / new game
    //=========================================================================

    const _onBeforeSave = Game_System.prototype.onBeforeSave;
    Game_System.prototype.onBeforeSave = function() {
        _onBeforeSave.apply(this, arguments);
        this._pokemzFmod = FMOD.available ? FMOD.saveState() : this._pokemzFmod || null;
    };

    // MZ replays the saved BGM/BGS in Scene_Load.terminate, before the
    // saved map's banks are loaded. With FMOD running, that replay waits
    // until Scene_Map has the banks (see Scene_Map.isReady above).
    let pendingLoad = null;

    const _onAfterLoad = Game_System.prototype.onAfterLoad;
    Game_System.prototype.onAfterLoad = function() {
        if (!FMOD.available) {
            _onAfterLoad.apply(this, arguments);
            return;
        }
        FMOD.stopAll(true);
        pendingLoad = { system: this, args: arguments };
    };

    /** @brief Runs a deferred onAfterLoad and restores the FMOD state. */
    function finishPendingLoad() {
        const p = pendingLoad;
        if (!p) {
            return;
        }
        pendingLoad = null;
        _onAfterLoad.apply(p.system, p.args);
        FMOD.restoreState(p.system._pokemzFmod || null);
    }

    // The title screen ends everything that scripts started.
    const _titleStart = Scene_Title.prototype.start;
    Scene_Title.prototype.start = function() {
        if (FMOD.available) {
            FMOD.stopAll(true);
        }
        _titleStart.apply(this, arguments);
    };

    const _setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function() {
        _setupNewGame.apply(this, arguments);
        if (FMOD.available) {
            FMOD.resetState();
        }
    };

    //=========================================================================
    // Plugin commands
    //=========================================================================

    /**
     * @brief Expands \V[n] in a command argument.
     * @param {string} text Argument.
     * @return {string} Expanded text.
     */
    const expand = text => String(text === undefined ? "" : text).replace(/\\V\[(\d+)\]/gi, (_, n) => $gameVariables.value(Number(n)));

    /**
     * @brief Parses a parameter value: number or label.
     * @param {string} text Value text.
     * @return {number|string} Value.
     */
    function paramValue(text) {
        const s = expand(text).trim();
        const n = Number(s);
        return s !== "" && Number.isFinite(n) ? n : s;
    }

    /**
     * @brief The handle (or FmodBuffer) addressed by a command.
     * @param {string} name Handle name, or bgm / bgs.
     * @return {Object|null} Handle-like object with setParameter etc.
     */
    function target(name) {
        const key = String(name || "").trim();
        if (/^(bgm|bgs)$/i.test(key)) {
            const buffer = AudioManager[`_${key.toLowerCase()}Buffer`];
            return buffer && buffer.isFmod ? buffer : null;
        }
        return FMOD.handle(key);
    }

    /**
     * @brief The live Handle of a target (FmodBuffer -> its handle).
     * @param {string} name Handle name, or bgm / bgs.
     * @return {Handle|null} Handle.
     */
    function liveHandle(name) {
        const t = target(name);
        return t && t.isFmod ? t.handle : t;
    }

    /**
     * @brief Handle options for a "Position (3D)" argument.
     * @param {string} text none, player, this, event N, tile X Y.
     * @param {Game_Interpreter} interpreter Calling interpreter.
     * @return {Object} {follow} or {}.
     */
    function positionOpts(text, interpreter) {
        const spatial = FMOD.spatial;
        const t = String(text || "none").trim().toLowerCase();
        if (!spatial || t === "none" || t === "") {
            return {};
        }
        let m;
        if (t === "player") {
            return { follow: spatial.follow($gamePlayer) };
        }
        if (t === "this") {
            const ev = $gameMap.event(interpreter.eventId());
            return ev ? { follow: spatial.follow(ev) } : {};
        }
        if ((m = /^event\s*:?\s*(\d+)$/.exec(t))) {
            const ev = $gameMap.event(Number(m[1]));
            return ev ? { follow: spatial.follow(ev) } : {};
        }
        if ((m = /^tile\s*:?\s*(\d+)[\s,]+(\d+)$/.exec(t))) {
            return { position: spatial.tilePosition(Number(m[1]), Number(m[2])) };
        }
        return {};
    }

    /**
     * @brief Makes the interpreter wait until fn() returns false.
     * @param {Game_Interpreter} interpreter Interpreter.
     * @param {Function} fn Returns true while waiting.
     */
    function waitWhile(interpreter, fn) {
        interpreter._pokemzFmodWait = fn;
        interpreter.setWaitMode("pokemzFmod");
    }

    const _updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
    Game_Interpreter.prototype.updateWaitMode = function() {
        if (this._waitMode === "pokemzFmod") {
            const fn = this._pokemzFmodWait;
            if (fn && fn()) {
                return true;
            }
            this._pokemzFmodWait = null;
            this._waitMode = "";
            return false;
        }
        return _updateWaitMode.apply(this, arguments);
    };

    /**
     * @brief Shared code of Play Event / Play Programmer Sound.
     * @param {Game_Interpreter} interpreter Interpreter.
     * @param {Object} args Command arguments.
     * @param {string} [key] Programmer sound key.
     */
    function playFromCommand(interpreter, args, key) {
        if (!FMOD.available) {
            return;
        }
        const opts = Object.assign(
            {
                name: expand(args.name || "").trim(),
                scope: args.scope || "map",
                persistent: args.persistent === "true",
                volume: num(args.volume, 100) / 100,
                pitch: num(args.pitch, 100) / 100,
                params: E.parseParamList(expand(args.params || "")),
                fadeIn: num(args.fadeIn, 0),
            },
            positionOpts(args.target, interpreter)
        );
        const h = key ? FMOD.playProgrammer(expand(args.event), expand(key), opts) : FMOD.play(expand(args.event), opts);
        if (args.wait === "true" && h.valid) {
            waitWhile(interpreter, () => !h.stopped);
        }
    }

    /**
     * @brief Plugin command handlers (called with the interpreter as this).
     *        Arguments are the strings from the editor; see the @command
     *        blocks in the header.
     */
    const commands = {
        playEvent(args) {
            playFromCommand(this, args);
        },
        playOneShot(args) {
            if (FMOD.available) {
                FMOD.oneShot(
                    expand(args.event),
                    Object.assign(
                        {
                            volume: num(args.volume, 100) / 100,
                            pitch: num(args.pitch, 100) / 100,
                            params: E.parseParamList(expand(args.params || "")),
                        },
                        positionOpts(args.target, this)
                    )
                );
            }
        },
        playProgrammer(args) {
            playFromCommand(this, Object.assign({ scope: "map" }, args), args.key);
        },
        stopEvent(args) {
            const t = target(args.name);
            if (!t) {
                return;
            }
            const mode = String(args.mode || "fade").trim();
            if (t.isFmod) {
                // The current BGM/BGS: go through AudioManager so MZ agrees.
                const kind = t.type === "bgs" ? "Bgs" : "Bgm";
                if (/^\d/.test(mode)) {
                    AudioManager[`fadeOut${kind}`](Number(mode));
                } else {
                    AudioManager[`stop${kind}`]();
                }
            } else {
                t.stop(mode === "immediate" ? true : /^\d/.test(mode) ? Number(mode) : undefined);
            }
        },
        pauseEvent(args) {
            const h = liveHandle(args.name);
            if (h) {
                h.setPaused(args.paused !== "false");
            }
        },
        setParameter(args) {
            const t = target(args.name);
            if (t) {
                t.setParameter(args.parameter, paramValue(args.value), args.instant === "true");
            }
        },
        setGlobalParameter(args) {
            FMOD.setGlobalParameter(args.parameter, paramValue(args.value));
        },
        startSnapshot(args) {
            FMOD.startSnapshot(args.snapshot, num(args.intensity, 100));
        },
        stopSnapshot(args) {
            FMOD.stopSnapshot(args.snapshot, args.immediate === "true");
        },
        loadBank(args) {
            const p = FMOD.loadSavedBank(expand(args.bank));
            if (args.wait !== "false") {
                let done = false;
                p.then(() => (done = true));
                waitWhile(this, () => !done);
            }
        },
        unloadBank(args) {
            FMOD.unloadSavedBank(expand(args.bank));
        },
        setMixerVolume(args) {
            FMOD.setMixerVolume(args.path, num(args.volume, 100) / 100);
        },
        keyOff(args) {
            const h = liveHandle(args.name);
            if (h) {
                h.keyOff();
            }
        },
        setTimeline(args) {
            const h = liveHandle(args.name);
            if (h) {
                h.setTimeline(num(args.ms, 0));
            }
        },
        waitForEvent(args) {
            const h = FMOD.handle(expand(args.name));
            if (h && !h.stopped) {
                waitWhile(this, () => !h.stopped);
            }
        },
        waitForMarker(args) {
            const h = liveHandle(args.name);
            if (!h || h.stopped) {
                return;
            }
            const wanted = String(args.marker || "");
            let hit = false;
            h.on("marker", m => {
                if (!wanted || m.name === wanted) {
                    hit = true;
                }
            });
            waitWhile(this, () => !hit && !h.stopped);
        },
        stopAll(args) {
            FMOD.stopAll(args.immediate === "true");
        },
    };

    for (const [name, fn] of Object.entries(commands)) {
        PluginManager.registerCommand(PLUGIN_NAME, name, fn);
    }

    //=========================================================================
    // API
    //=========================================================================

    FMOD.audio = {
        config: CONFIG,
        mapper,
        mapAudio,
        FmodBuffer,
        SYSTEM_SOUNDS,
        banksOfMap,
        /** @return {Handle|null} The current FMOD BGM handle. */
        bgm: () => liveHandle("bgm"),
        /** @return {Handle|null} The current FMOD BGS handle. */
        bgs: () => liveHandle("bgs"),
        /**
         * @brief Sets a parameter on the current BGM (kept in saves).
         * @param {string} name Parameter.
         * @param {number|string} value Value or label.
         */
        setBgmParameter: (name, value) => {
            const t = target("bgm");
            if (t) {
                t.setParameter(name, value);
            }
        },
        /**
         * @brief Sets a parameter on the current BGS (kept in saves).
         * @param {string} name Parameter.
         * @param {number|string} value Value or label.
         */
        setBgsParameter: (name, value) => {
            const t = target("bgs");
            if (t) {
                t.setParameter(name, value);
            }
        },
    };
})();
