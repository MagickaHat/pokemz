//=============================================================================
// PokéMZ - FMOD_Spatial.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] FMOD 3D audio: listener, event emitters and ambient
 * emitters on 2D and Three.js maps.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_FMOD_Core
 * @orderAfter PokeMZ_FMOD_Core
 * @orderAfter PokeMZ_Three_Core
 *
 * @param listenerMode
 * @text Listener
 * @desc camera: ears at the 3D camera, distance measured from the player
 * (recommended). player: ears at the player.
 * @type select
 * @option camera
 * @option player
 * @default camera
 *
 * @param listenerHeight
 * @text 2D Listener Height
 * @desc On 2D maps the listener floats this many tiles above the player.
 * 0 = at the player.
 * @type number
 * @decimals 2
 * @min 0
 * @default 0
 *
 * @param characterHeight
 * @text Sound Height
 * @desc Height (tiles) of sounds attached to characters.
 * @type number
 * @decimals 2
 * @min 0
 * @default 0.5
 *
 * @param cullDistance
 * @text Emitter Cull Distance
 * @desc Emitters further than this (tiles) are stopped and restarted when
 * the player comes back. 0 = never.
 * @type number
 * @min 0
 * @default 40
 *
 * @help
 * ============================================================================
 * PokeMZ_FMOD_Spatial
 * ============================================================================
 * Coordinates: 1 unit = 1 tile, +X east, +Y up, -Z north (Three.js, right-
 * handed). PokeMZ_FMOD_Core's "3D Handedness" converts for FMOD. Event
 * min/max distances in FMOD Studio are in tiles (see "Tiles Per Meter").
 *
 * Listener: on 3D maps it sits at the camera and faces where the camera
 * looks, while distance attenuation is measured from the player. On 2D maps
 * it sits at the player facing north (up the screen).
 *
 * Event page comment (or event note) - emitter that follows the event while
 * that page is active:
 *   <FMOD Emitter: event:/SFX/Fountain>
 *   <FMOD Emitter: event:/SFX/Fire volume=0.8 params="Size:2, Type:Camp">
 *
 * Map note - ambient emitters:
 *   <FMOD Ambient: event:/Amb/Waterfall x=12 y=4>     fixed point
 *   <FMOD Ambient: event:/Amb/Sea region=30>          area: the sound sits on
 *                                                     the region tile nearest
 *                                                     the listener
 *   <FMOD Ambient: event:/Amb/Wind>                   2D, whole map
 *   options: volume=0.5 params="A:1" height=1
 *
 * Script:
 *   PokeMZ.FMOD.spatial.follow(character)  -> follow function for play()
 *   PokeMZ.FMOD.spatial.tilePosition(x, y) -> {x, y, z}
 *   PokeMZ.FMOD.spatial.listener           -> last listener attributes
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_FMOD_Spatial";
    const FMOD = window.PokeMZ && window.PokeMZ.FMOD;
    if (!FMOD) {
        console.error(`${PLUGIN_NAME}: PokeMZ_FMOD_Core must be enabled above this plugin.`);
        return;
    }
    const E = FMOD.engine;
    const params = PluginManager.parameters(PLUGIN_NAME);
    const num = (v, fallback) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? fallback : Number(v));

    const CONFIG = {
        listenerMode: params.listenerMode === "player" ? "player" : "camera",
        listenerHeight: num(params.listenerHeight, 0),
        characterHeight: num(params.characterHeight, 0.5),
        cullDistance: num(params.cullDistance, 40),
    };

    /** @return {Object|null} PokeMZ.Three when a 3D map is on screen. */
    const three = () => {
        const T = window.PokeMZ.Three;
        return T && T.isActive && T.isActive() ? T : null;
    };

    /**
     * @brief Ground height at a fractional tile position (0 on 2D maps).
     * @param {number} x Tile X (centre = x + 0.5).
     * @param {number} z Tile Y.
     * @return {number} Height in tiles.
     */
    function groundAt(x, z) {
        const T = three();
        return T && T.heightAtWorld ? T.heightAtWorld(x, z) : 0;
    }

    /**
     * @brief World position of a tile centre.
     * @param {number} x Tile X.
     * @param {number} y Tile Y.
     * @param {number} [height] Extra height above the ground.
     * @return {{x: number, y: number, z: number}} Position.
     */
    function tilePosition(x, y, height) {
        const wx = x + 0.5;
        const wz = y + 0.5;
        return { x: wx, y: groundAt(wx, wz) + (height === undefined ? CONFIG.characterHeight : height), z: wz };
    }

    /**
     * @brief World position of a character (smoothly moving, jumps included).
     * @param {Game_Character} c Character.
     * @param {number} [height] Height above the ground.
     * @return {{x: number, y: number, z: number}} Position.
     */
    function characterPosition(c, height) {
        const wx = c._realX + 0.5;
        const wz = c._realY + 0.5;
        const jump = c.jumpHeight ? c.jumpHeight() / $gameMap.tileHeight() : 0;
        return {
            x: wx,
            y: groundAt(wx, wz) + (height === undefined ? CONFIG.characterHeight : height) + jump,
            z: wz,
        };
    }

    /**
     * @brief A follow function for FMOD.play(path, {follow}).
     * @param {Game_Character} c Character to follow.
     * @param {number} [height] Height above the ground.
     * @return {Function} Returns {position} each frame.
     */
    const follow = (c, height) => () => ({ position: characterPosition(c, height) });

    //=========================================================================
    // Listener
    //=========================================================================

    const listener = {
        position: { x: 0, y: 0, z: 0 },
        forward: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        attenuation: null,
    };
    let lastListenerPos = null;

    /**
     * @brief Computes and sends the listener attributes.
     * @param {number} dt Milliseconds since the last frame.
     */
    function updateListener(dt) {
        if (!$gamePlayer || !$gameMap || !(SceneManager._scene instanceof Scene_Map)) {
            return;
        }
        const player = characterPosition($gamePlayer);
        const T = three();
        const cam = T && T.view && T.view.camera;
        if (cam && CONFIG.listenerMode === "camera") {
            cam.updateMatrixWorld();
            const e = cam.matrixWorld.elements;
            listener.position = { x: e[12], y: e[13], z: e[14] };
            // Camera looks down its local -Z; local +Y is up.
            listener.forward = normalize({ x: -e[8], y: -e[9], z: -e[10] });
            listener.up = normalize({ x: e[4], y: e[5], z: e[6] });
            listener.attenuation = player;
        } else {
            listener.position = { x: player.x, y: player.y + CONFIG.listenerHeight, z: player.z };
            listener.forward = { x: 0, y: 0, z: -1 };
            listener.up = { x: 0, y: 1, z: 0 };
            listener.attenuation = CONFIG.listenerHeight > 0 ? player : null;
        }
        if (lastListenerPos && dt > 0) {
            const s = 1000 / dt;
            listener.velocity = {
                x: (listener.position.x - lastListenerPos.x) * s,
                y: (listener.position.y - lastListenerPos.y) * s,
                z: (listener.position.z - lastListenerPos.z) * s,
            };
        }
        lastListenerPos = Object.assign({}, listener.position);
        const hand = FMOD.config.handedness;
        const attrs = E.makeAttributes(listener, hand);
        const atten = listener.attenuation ? E.toFmodVector(listener.attenuation, hand) : null;
        try {
            FMOD.check(FMOD.studio.setListenerAttributes(0, attrs, atten), "setListenerAttributes");
        } catch (e) {
            FMOD.errors.add("setListenerAttributes", -1, e.message);
        }
    }

    /**
     * @brief Normalises a vector (zero stays zero).
     * @param {{x: number, y: number, z: number}} v Vector.
     * @return {{x: number, y: number, z: number}} Unit vector.
     */
    function normalize(v) {
        const l = Math.hypot(v.x, v.y, v.z) || 1;
        return { x: v.x / l, y: v.y / l, z: v.z / l };
    }

    /**
     * @brief Squared distance from the attenuation point (player).
     * @param {{x: number, y: number, z: number}} p Position.
     * @return {number} Squared distance in tiles.
     */
    function distanceSq(p) {
        const a = listener.attenuation || listener.position;
        return (p.x - a.x) ** 2 + (p.y - a.y) ** 2 + (p.z - a.z) ** 2;
    }

    //=========================================================================
    // Emitters
    //=========================================================================

    /**
     * @brief Parses one emitter tag.
     * @param {string} arg Tag arguments.
     * @return {Object|null} {path, volume, params, x, y, region, height}.
     */
    function parseEmitter(arg) {
        const a = E.parseArgs(arg);
        const path = a.positional[0];
        if (!path) {
            return null;
        }
        const n = a.named;
        return {
            path,
            volume: num(n.volume, 1),
            pitch: num(n.pitch, 1),
            params: E.parseParamList(n.params || n.param || ""),
            x: n.x !== undefined ? Number(n.x) : null,
            y: n.y !== undefined ? Number(n.y) : null,
            region: n.region !== undefined ? Number(n.region) : null,
            height: n.height !== undefined ? Number(n.height) : undefined,
        };
    }

    /**
     * @brief Emitter tags on an event's active page (comments) and note.
     * @param {Game_Event} ev Event.
     * @return {Array<string>} Tag arguments.
     */
    function eventEmitterTags(ev) {
        const page = ev.page();
        let text = "";
        if (page) {
            for (const cmd of page.list) {
                if (cmd.code === 108 || cmd.code === 408) {
                    text += cmd.parameters[0] + "\n";
                }
            }
        }
        const data = ev.event();
        return E.noteTags(text, "Emitter").concat(E.noteTags(data && data.note, "Emitter"));
    }

    /**
     * @brief One running (or culled) emitter.
     */
    class Emitter {
        /**
         * @param {string} key Unique key (re-used across frames).
         * @param {Object} spec From parseEmitter().
         * @param {Function} locate Returns the world position, or null for 2D.
         */
        constructor(key, spec, locate) {
            this.key = key;
            this.spec = spec;
            this.locate = locate;
            this.handle = null;
            this.seen = true;
        }

        /** @return {boolean} True if currently audible (not culled). */
        get running() {
            return !!(this.handle && this.handle.valid);
        }

        /** @brief Starts or culls depending on distance. */
        update() {
            const pos = this.locate ? this.locate() : null;
            const inRange =
                !pos || CONFIG.cullDistance <= 0 || distanceSq(pos) <= CONFIG.cullDistance * CONFIG.cullDistance;
            if (inRange && !this.running) {
                this.start(pos);
            } else if (!inRange && this.running) {
                this.stop();
            }
        }

        /**
         * @brief Creates the instance.
         * @param {Object|null} pos Initial position.
         */
        start(pos) {
            const opts = { volume: this.spec.volume, pitch: this.spec.pitch, params: this.spec.params, scope: "map" };
            if (pos) {
                opts.follow = () => {
                    const p = this.locate();
                    return p ? { position: p } : null;
                };
            }
            const h = FMOD.create(this.spec.path, opts);
            if (!h.valid) {
                this.failed = true;
                return;
            }
            h.owner = "emitter";
            h.emitterKey = this.key;
            this.handle = h.start();
        }

        /** @brief Stops the instance (FMOD's fade-out). */
        stop() {
            if (this.handle) {
                this.handle.stop();
                this.handle = null;
            }
        }
    }

    const emitters = new Map();
    let emitterMapId = 0;
    const regionTiles = new Map();

    /**
     * @brief Tiles of a region on the current map (cached per map).
     * @param {number} region Region ID.
     * @return {Array<Array<number>>} [x, y] pairs.
     */
    function tilesOfRegion(region) {
        if (!regionTiles.has(region)) {
            const list = [];
            for (let y = 0; y < $gameMap.height(); y++) {
                for (let x = 0; x < $gameMap.width(); x++) {
                    if ($gameMap.regionId(x, y) === region) {
                        list.push([x, y]);
                    }
                }
            }
            regionTiles.set(region, list);
        }
        return regionTiles.get(region);
    }

    /**
     * @brief Position of an area emitter: the region tile nearest the player.
     * @param {number} region Region ID.
     * @param {number} [height] Height.
     * @return {Object|null} Position or null when the region is empty.
     */
    function nearestRegionPoint(region, height) {
        const tiles = tilesOfRegion(region);
        if (!tiles.length) {
            return null;
        }
        const px = $gamePlayer._realX;
        const py = $gamePlayer._realY;
        let best = tiles[0];
        let bestD = Infinity;
        for (const t of tiles) {
            const d = (t[0] - px) ** 2 + (t[1] - py) ** 2;
            if (d < bestD) {
                bestD = d;
                best = t;
            }
        }
        // Clamp inside the tile towards the player for a smooth edge.
        const cx = Math.max(best[0] - 0.5, Math.min(best[0] + 0.5, px));
        const cy = Math.max(best[1] - 0.5, Math.min(best[1] + 0.5, py));
        return tilePosition(cx, cy, height);
    }

    /**
     * @brief Wanted emitters this frame: map ambience + active event pages.
     * @return {Map<string, Object>} key -> {spec, locate}.
     */
    function collectEmitters() {
        const wanted = new Map();
        E.noteTags($dataMap && $dataMap.note, "Ambient").forEach((arg, i) => {
            const spec = parseEmitter(arg);
            if (!spec) {
                return;
            }
            let locate = null;
            if (spec.region !== null) {
                locate = () => nearestRegionPoint(spec.region, spec.height);
            } else if (spec.x !== null && spec.y !== null) {
                const p = tilePosition(spec.x, spec.y, spec.height);
                locate = () => p;
            }
            wanted.set(`map:${i}:${arg}`, { spec, locate });
        });
        for (const ev of $gameMap.events()) {
            if (ev._erased) {
                continue;
            }
            eventEmitterTags(ev).forEach((arg, i) => {
                const spec = parseEmitter(arg);
                if (spec) {
                    wanted.set(`ev:${ev.eventId()}:${ev._pageIndex}:${i}:${arg}`, {
                        spec,
                        locate: () => characterPosition(ev, spec.height),
                    });
                }
            });
        }
        return wanted;
    }

    let refreshCounter = 0;

    /** @brief Syncs emitters with the map and event pages. */
    function updateEmitters() {
        if (!(SceneManager._scene instanceof Scene_Map) || !$gameMap || !$dataMap) {
            return;
        }
        if ($gameMap.mapId() !== emitterMapId) {
            clearEmitters();
            emitterMapId = $gameMap.mapId();
            regionTiles.clear();
            refreshCounter = 0;
        }
        // Page changes are cheap to detect but scanning every event each
        // frame is not: rescan every 10 frames.
        if (refreshCounter-- <= 0) {
            refreshCounter = 10;
            const wanted = collectEmitters();
            for (const [key, em] of emitters) {
                if (!wanted.has(key)) {
                    em.stop();
                    emitters.delete(key);
                }
            }
            for (const [key, w] of wanted) {
                if (!emitters.has(key)) {
                    emitters.set(key, new Emitter(key, w.spec, w.locate));
                }
            }
        }
        for (const em of emitters.values()) {
            if (!em.failed) {
                em.update();
            }
        }
    }

    /** @brief Stops every emitter (map change, title, load). */
    function clearEmitters() {
        for (const em of emitters.values()) {
            em.stop();
        }
        emitters.clear();
    }

    FMOD.on("mapChanged", () => {
        clearEmitters();
        emitterMapId = 0;
    });
    FMOD.on("banksChanged", () => {
        for (const em of emitters.values()) {
            em.failed = false; // a newly loaded bank may contain it
        }
    });

    FMOD.addHook({
        onPreUpdate(dt) {
            updateListener(dt);
            updateEmitters();
        },
    });

    // Leaving the map scene for the title or game over ends map ambience;
    // menus and battles keep it (FMOD pauses nothing on its own).
    const _gotoTitle = Scene_Title.prototype.start;
    Scene_Title.prototype.start = function() {
        clearEmitters();
        emitterMapId = 0;
        _gotoTitle.apply(this, arguments);
    };

    FMOD.spatial = {
        config: CONFIG,
        listener,
        emitters,
        follow,
        tilePosition,
        characterPosition,
        parseEmitter,
        clearEmitters,
    };
})();
