//=============================================================================
// PokéMZ - Three_Core.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.2.0] Three.js 3D map renderer (core).
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 *
 * @param renderScale
 * @text Pixel Scale
 * @desc The 3D view renders at (screen size / this) and is scaled up with
 * nearest-neighbour filtering. 1 = native, 2 = chunky pixel art.
 * @type number
 * @min 1
 * @max 6
 * @default 2
 *
 * @param snapToTexel
 * @text Snap Camera To Texels
 * @desc Rounds the camera target to the tile pixel grid, which stops
 * pixel art from shimmering while scrolling.
 * @type boolean
 * @default true
 *
 * @param pitch
 * @text Camera Pitch (degrees)
 * @desc Angle of the camera above the ground. 90 = straight down.
 * @type number
 * @min 10
 * @max 89
 * @default 55
 *
 * @param yaw
 * @text Camera Yaw (degrees)
 * @desc Rotation around the target. 0 = looking north.
 * @type number
 * @min -180
 * @max 180
 * @default 0
 *
 * @param distance
 * @text Camera Distance (tiles)
 * @type number
 * @decimals 1
 * @default 14
 *
 * @param fov
 * @text Field of View (degrees)
 * @type number
 * @default 30
 *
 * @param clampCamera
 * @text Clamp Camera To Map
 * @desc Keeps the follow camera from showing too far past the map edges.
 * @type boolean
 * @default true
 *
 * @param regionHeight
 * @text Height per Region ID (tiles)
 * @desc A tile whose region ID is in the height range is raised
 * (region ID * this value).
 * @type number
 * @decimals 2
 * @default 0.5
 *
 * @param heightRegions
 * @text Height Regions
 * @desc Region IDs that mean "height". Ranges and lists, e.g. 1-20,30.
 * Leave other regions free for encounter zones etc.
 * @type string
 * @default 1-20
 *
 * @param rampRegions
 * @text Ramp Regions
 * @desc Region IDs that mark ramps/stairs. A ramp slopes smoothly between
 * the nearest non-ramp tiles on either side of it.
 * @type string
 * @default 21
 *
 * @param smooth
 * @text Smooth Terrain Threshold
 * @desc Height steps up to this size are blended into gentle slopes.
 * 0 = off. Overridable per map with <3D Smooth: n>.
 * @type number
 * @decimals 2
 * @default 0
 *
 * @param chunkSize
 * @text Chunk Size (tiles)
 * @desc Terrain is built and textured in square chunks of this many tiles.
 * @type number
 * @min 4
 * @max 64
 * @default 16
 *
 * @param uprightTag
 * @text Upright Terrain Tag
 * @desc B-E tiles with this terrain tag stand up as cards (trees, signs,
 * fences). 0 = disabled.
 * @type number
 * @min 0
 * @max 7
 * @default 7
 *
 * @param waterDepth
 * @text Water Depth (tiles)
 * @desc How far A1 water surfaces sit below the surrounding ground.
 * @type number
 * @decimals 2
 * @default 0.2
 *
 * @param waterOpacity
 * @text Water Opacity
 * @desc 0-1. Below 1 a darker bed is drawn underneath the water.
 * @type number
 * @decimals 2
 * @default 0.85
 *
 * @param waterBedColor
 * @text Water Bed Color
 * @type string
 * @default #1c3550
 *
 * @param blobShadows
 * @text Character Shadows
 * @desc Draw a soft round shadow under characters.
 * @type boolean
 * @default true
 *
 * @param shadowSize
 * @text Shadow Size (tiles)
 * @type number
 * @decimals 2
 * @default 0.7
 *
 * @param depthBias
 * @text Billboard Depth Bias
 * @desc Pulls character sprites towards the camera so they never sink
 * into the ground they stand on.
 * @type number
 * @decimals 2
 * @default 0.3
 *
 * @command cameraFollow
 * @text Camera: Follow
 * @desc Smoothly moves the camera to follow the player or an event.
 *
 * @arg target
 * @text Target
 * @desc 0 = player, -1 = this event, n = event ID.
 * @type number
 * @min -1
 * @default 0
 *
 * @arg duration
 * @text Duration (frames)
 * @type number
 * @default 30
 *
 * @arg easing
 * @text Easing
 * @type select
 * @option linear
 * @option easeIn
 * @option easeOut
 * @option easeInOut
 * @default easeInOut
 *
 * @arg wait
 * @text Wait For Completion
 * @type boolean
 * @default true
 *
 * @command cameraPanTo
 * @text Camera: Pan To Tile
 * @desc Moves the camera to look at a fixed tile.
 *
 * @arg x
 * @text Tile X
 * @type number
 * @default 0
 *
 * @arg y
 * @text Tile Y
 * @type number
 * @default 0
 *
 * @arg duration
 * @text Duration (frames)
 * @type number
 * @default 60
 *
 * @arg easing
 * @text Easing
 * @type select
 * @option linear
 * @option easeIn
 * @option easeOut
 * @option easeInOut
 * @default easeInOut
 *
 * @arg wait
 * @text Wait For Completion
 * @type boolean
 * @default true
 *
 * @command cameraAngle
 * @text Camera: Set Angle
 * @desc Changes pitch, yaw, distance and FOV. Leave a value empty to
 * keep it.
 *
 * @arg pitch
 * @text Pitch (degrees)
 * @type string
 *
 * @arg yaw
 * @text Yaw (degrees)
 * @type string
 *
 * @arg distance
 * @text Distance (tiles)
 * @type string
 *
 * @arg fov
 * @text FOV (degrees)
 * @type string
 *
 * @arg duration
 * @text Duration (frames)
 * @type number
 * @default 60
 *
 * @arg easing
 * @text Easing
 * @type select
 * @option linear
 * @option easeIn
 * @option easeOut
 * @option easeInOut
 * @default easeInOut
 *
 * @arg wait
 * @text Wait For Completion
 * @type boolean
 * @default true
 *
 * @command cameraOffset
 * @text Camera: Offset
 * @desc Shifts the look-at point relative to the target (in tiles).
 *
 * @arg x
 * @type number
 * @decimals 2
 * @min -999
 * @default 0
 *
 * @arg y
 * @text y (up)
 * @type number
 * @decimals 2
 * @min -999
 * @default 0
 *
 * @arg z
 * @text z (south)
 * @type number
 * @decimals 2
 * @min -999
 * @default 0
 *
 * @arg duration
 * @text Duration (frames)
 * @type number
 * @default 30
 *
 * @arg easing
 * @text Easing
 * @type select
 * @option linear
 * @option easeIn
 * @option easeOut
 * @option easeInOut
 * @default easeInOut
 *
 * @arg wait
 * @text Wait For Completion
 * @type boolean
 * @default false
 *
 * @command cameraShake
 * @text Camera: Shake
 * @desc Shakes the 3D camera (independent of MZ's screen shake).
 *
 * @arg power
 * @text Power (tiles)
 * @type number
 * @decimals 2
 * @default 0.2
 *
 * @arg duration
 * @text Duration (frames)
 * @type number
 * @default 30
 *
 * @arg wait
 * @text Wait For Completion
 * @type boolean
 * @default false
 *
 * @command cameraReset
 * @text Camera: Reset
 * @desc Returns to following the player with the map's default angle.
 *
 * @arg duration
 * @text Duration (frames)
 * @type number
 * @default 30
 *
 * @arg wait
 * @text Wait For Completion
 * @type boolean
 * @default true
 *
 * @command refreshTerrain
 * @text Rebuild Terrain
 * @desc Rebuilds the 3D terrain after tiles or regions were changed by
 * script.
 *
 * @help PokeMZ_Three_Core.js
 *
 * Renders opted-in maps in 3D with Three.js, while MZ keeps running all game
 * logic, windows, pictures, weather, tone and fades on top.
 *
 * ---------------------------------------------------------------------------
 * Map note tags
 * ---------------------------------------------------------------------------
 *   <3D>                                  Render this map in 3D (required).
 *   <3D Camera: pitch=55 yaw=0 distance=14 fov=30>
 *   <3D Smooth: 0.5>                      Blend steps up to 0.5 into slopes.
 *   <3D Water: depth=0.2 opacity=0.85 bed=#1c3550>
 *   <3D Fog: #b8d0e8 near=20 far=45>
 *   <3D Clamp: off>                       Let the camera see past map edges.
 *
 * ---------------------------------------------------------------------------
 * Heights
 * ---------------------------------------------------------------------------
 * Paint region IDs from the "Height Regions" range: a tile's height is
 * (region ID * Height per Region ID). Paint "Ramp Regions" on stairs or ramps
 * and they slope between the tiles at both ends. Cliff walls are generated
 * automatically wherever neighbouring tiles differ in height.
 *
 * Pokémon-style games also use regions for encounter zones, so keep the
 * height range separate from your encounter regions.
 *
 * ---------------------------------------------------------------------------
 * Tiles
 * ---------------------------------------------------------------------------
 * - A1 water and waterfalls animate exactly like the 2D tilemap. Water sits
 *   slightly below the ground and can be translucent.
 * - B-E tiles with the "Upright Terrain Tag" (default 7) stand up as cards.
 *   Vertically stacked upright tiles join into one tall card standing on the
 *   bottom-most tile, so a 1x2 tree becomes one card.
 *
 * ---------------------------------------------------------------------------
 * Event comments / notes (on the active page)
 * ---------------------------------------------------------------------------
 *   <3D Flat>          A tile-graphic event lies flat on the ground.
 *   <3D Shadow: off>   No blob shadow under this event.
 *
 * ---------------------------------------------------------------------------
 * Addons
 * ---------------------------------------------------------------------------
 *   PokeMZ_Three_Effects   balloons, animations and destination marker
 *   PokeMZ_Three_Input     mouse / touch picking
 *   PokeMZ_Three_Movement  height-aware passability and ledges
 *   PokeMZ_Three_Models    glTF buildings and props
 *   PokeMZ_Three_Lighting  ambient, sun and point lights
 *
 * Addons talk to the core through window.PokeMZ.Three (see source).
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_Three_Core";
    const params = PluginManager.parameters(PLUGIN_NAME);

    //=========================================================================
    // Helpers
    //=========================================================================

    /**
     * @brief Parses "1-5,8,10-12" into a Set of integers.
     * @param {string} text The range list.
     * @return {Set<number>} The IDs.
     */
    function parseRangeList(text) {
        const set = new Set();
        for (const part of String(text || "").split(",")) {
            const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
            if (m) {
                const a = Number(m[1]);
                const b = m[2] ? Number(m[2]) : a;
                for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
                    set.add(i);
                }
            }
        }
        return set;
    }

    /**
     * @brief Parses a plugin boolean parameter.
     * @param {string} value Raw value.
     * @param {boolean} fallback Value when empty.
     * @return {boolean} The boolean.
     */
    function parseBool(value, fallback) {
        if (value === undefined || value === "") {
            return fallback;
        }
        return value === true || value === "true" || value === "on";
    }

    /**
     * @brief Parses "key=value key2=value2 positional" note tag arguments.
     *
     * Tokens are separated by whitespace. Tokens without "=" are collected in
     * the `_` array in order, and also set as `token: true`.
     *
     * @param {string} text The argument text.
     * @return {Object} Parsed arguments.
     */
    function parseArgs(text) {
        const out = { _: [] };
        for (const token of String(text || "").trim().split(/\s+/)) {
            if (!token) {
                continue;
            }
            const eq = token.indexOf("=");
            if (eq > 0) {
                out[token.slice(0, eq).toLowerCase()] = token.slice(eq + 1);
            } else {
                out._.push(token);
                out[token.toLowerCase()] = true;
            }
        }
        return out;
    }

    /**
     * @brief Parses a number argument.
     * @param {*} value Raw value.
     * @param {number} fallback Value when missing or not a number.
     * @return {number} The number.
     */
    function num(value, fallback) {
        const n = Number(value);
        return value === undefined || value === "" || value === true || isNaN(n) ? fallback : n;
    }

    /**
     * @brief Parses "#rgb", "#rrggbb" or "r,g,b" (0-255) into a THREE.Color.
     * @param {string} text Color text.
     * @param {THREE.Color|string|number} fallback Used when parsing fails.
     * @return {THREE.Color} The color (sRGB values, not converted).
     */
    function parseColor(text, fallback) {
        const color = new THREE.Color();
        const t = String(text || "").trim();
        if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(t)) {
            let hex = t.replace("#", "");
            if (hex.length === 3) {
                hex = hex.split("").map(c => c + c).join("");
            }
            color.setHex(parseInt(hex, 16), THREE.LinearSRGBColorSpace);
            return color;
        }
        const parts = t.split(",").map(Number);
        if (parts.length === 3 && parts.every(n => !isNaN(n))) {
            color.setRGB(parts[0] / 255, parts[1] / 255, parts[2] / 255, THREE.LinearSRGBColorSpace);
            return color;
        }
        if (fallback !== undefined) {
            return fallback instanceof THREE.Color ? fallback.clone() : parseColor(String(fallback));
        }
        return color.setRGB(1, 1, 1, THREE.LinearSRGBColorSpace);
    }

    /**
     * @brief Finds every `<3D Name: args>` tag in a note or comment text.
     * @param {string} text The note text.
     * @param {string} name Tag name after "3D " (case-insensitive).
     * @return {Object[]} Parsed args of each occurrence, in order.
     */
    function noteTags(text, name) {
        const out = [];
        const re = /<3D\s+([A-Za-z]+)\s*(?::([^>]*))?>/g;
        const want = name.toLowerCase();
        let m;
        while ((m = re.exec(String(text || "")))) {
            if (m[1].toLowerCase() === want) {
                const args = parseArgs(m[2] || "");
                args.raw = (m[2] || "").trim();
                out.push(args);
            }
        }
        return out;
    }

    /**
     * @brief The first `<3D Name: args>` tag in a text, or null.
     * @param {string} text The note text.
     * @param {string} name Tag name.
     * @return {Object|null} Parsed args.
     */
    function noteTag(text, name) {
        return noteTags(text, name)[0] || null;
    }

    /**
     * @brief Returns the note + active page comments of an event, cached per
     *        page so it can be called every frame.
     * @param {Game_Event} event The event.
     * @return {string} Concatenated text.
     */
    function eventText(event) {
        if (!event || !(event instanceof Game_Event)) {
            return "";
        }
        const pageIndex = event._pageIndex;
        if (event._threeTextPage === pageIndex && event._threeText !== undefined) {
            return event._threeText;
        }
        let text = (event.event() && event.event().note) || "";
        const page = event.page();
        if (page) {
            for (const command of page.list) {
                if (command.code === 108 || command.code === 408) {
                    text += "\n" + command.parameters[0];
                }
            }
        }
        event._threeTextPage = pageIndex;
        event._threeText = text;
        return text;
    }

    /** @brief Easing functions, t in [0, 1]. */
    const EASING = {
        linear: t => t,
        easeIn: t => t * t,
        easeOut: t => t * (2 - t),
        easeInOut: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    };

    //=========================================================================
    // Configuration
    //=========================================================================

    /** @brief Plugin settings parsed from the plugin parameters. */
    const CONFIG = {
        renderScale: Math.max(1, num(params.renderScale, 2)),
        snapToTexel: parseBool(params.snapToTexel, true),
        pitch: num(params.pitch, 55),
        yaw: num(params.yaw, 0),
        distance: num(params.distance, 14),
        fov: num(params.fov, 30),
        clampCamera: parseBool(params.clampCamera, true),
        regionHeight: num(params.regionHeight, 0.5),
        heightRegions: parseRangeList(params.heightRegions || "1-20"),
        rampRegions: parseRangeList(params.rampRegions || "21"),
        smooth: num(params.smooth, 0),
        chunkSize: Math.max(4, num(params.chunkSize, 16)),
        uprightTag: num(params.uprightTag, 7),
        waterDepth: num(params.waterDepth, 0.2),
        waterOpacity: num(params.waterOpacity, 0.85),
        waterBedColor: params.waterBedColor || "#1c3550",
        blobShadows: parseBool(params.blobShadows, true),
        shadowSize: num(params.shadowSize, 0.7),
        depthBias: num(params.depthBias, 0.3),
    };

    /**
     * @brief Settings for the current map: plugin parameters overridden by
     *        the map's note tags. Cached per $dataMap.
     * @return {Object} The merged settings.
     */
    function mapConfig() {
        if ($dataMap && $dataMap._threeConfig) {
            return $dataMap._threeConfig;
        }
        const note = ($dataMap && $dataMap.note) || "";
        const cam = noteTag(note, "Camera") || {};
        const water = noteTag(note, "Water") || {};
        const fog = noteTag(note, "Fog");
        const smooth = noteTag(note, "Smooth");
        const clamp = noteTag(note, "Clamp");
        const cfg = {
            pitch: num(cam.pitch, CONFIG.pitch),
            yaw: num(cam.yaw, CONFIG.yaw),
            distance: num(cam.distance, CONFIG.distance),
            fov: num(cam.fov, CONFIG.fov),
            smooth: smooth ? num(smooth._[0], CONFIG.smooth) : CONFIG.smooth,
            clampCamera: clamp ? !(clamp.off || clamp.false) : CONFIG.clampCamera,
            waterDepth: num(water.depth, CONFIG.waterDepth),
            waterOpacity: num(water.opacity, CONFIG.waterOpacity),
            waterBedColor: water.bed || CONFIG.waterBedColor,
            fog: fog
                ? { color: fog._[0] || "#ffffff", near: num(fog.near, 20), far: num(fog.far, 50) }
                : null,
        };
        if ($dataMap) {
            $dataMap._threeConfig = cfg;
        }
        return cfg;
    }

    /**
     * @brief Whether the current map opts in to 3D rendering.
     * @return {boolean} True if the map has the <3D> note tag.
     */
    function isMap3D() {
        return !!($dataMap && $dataMap.meta && $dataMap.meta["3D"]);
    }

    //=========================================================================
    // HeightField: per-tile corner heights shared by rendering and gameplay
    //=========================================================================

    /**
     * @brief Terrain heights of one map.
     *
     * Every tile stores four corner heights [nw, ne, se, sw] in tile units.
     * Flat tiles have equal corners, ramps slope between their neighbours,
     * and smoothing merges nearby corners into hills.
     */
    class HeightField {
        /**
         * @param {Game_Map} gameMap The map to read regions and tiles from.
         * @param {Object} cfg Result of mapConfig().
         */
        constructor(gameMap, cfg) {
            const W = gameMap.width();
            const H = gameMap.height();
            this.width = W;
            this.height = H;
            this.base = new Float32Array(W * H);
            this.corners = new Float32Array(W * H * 4);
            this.ramp = new Uint8Array(W * H);
            this.water = new Uint8Array(W * H);
            this.waterDepth = cfg.waterDepth;

            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const i = y * W + x;
                    const region = gameMap.regionId(x, y);
                    if (CONFIG.rampRegions.has(region)) {
                        this.ramp[i] = 1;
                    } else if (CONFIG.heightRegions.has(region)) {
                        this.base[i] = region * CONFIG.regionHeight;
                    }
                    if (Tilemap.isWaterTile(gameMap.tileId(x, y, 0))) {
                        this.water[i] = 1;
                    }
                }
            }
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    this._initCorners(x, y);
                }
            }
            if (cfg.smooth > 0) {
                this._smooth(cfg.smooth);
            }
        }

        /** @brief Index of a tile, or -1 when outside the map. */
        index(x, y) {
            return x >= 0 && y >= 0 && x < this.width && y < this.height ? y * this.width + x : -1;
        }

        /** @brief Whether tile (x, y) is a ramp. */
        isRamp(x, y) {
            const i = this.index(x, y);
            return i >= 0 && this.ramp[i] === 1;
        }

        /** @brief Whether tile (x, y) is a lowered water tile. */
        isWater(x, y) {
            const i = this.index(x, y);
            return i >= 0 && this.water[i] === 1;
        }

        /**
         * @brief Scans from a ramp tile until a non-ramp tile.
         * @return {{n: number, h: number}|null} Steps taken and height found.
         */
        _scan(x, y, dx, dy) {
            let n = 0;
            for (;;) {
                x += dx;
                y += dy;
                n++;
                const i = this.index(x, y);
                if (i < 0) {
                    return null;
                }
                if (!this.ramp[i]) {
                    return { n, h: this.base[i] };
                }
            }
        }

        /** @brief Computes the unsmoothed corners of one tile. */
        _initCorners(x, y) {
            const i = this.index(x, y);
            const c = i * 4;
            let nw, ne, se, sw;
            if (this.ramp[i]) {
                // Slope along whichever axis has the bigger height change.
                const n = this._scan(x, y, 0, -1);
                const s = this._scan(x, y, 0, 1);
                const w = this._scan(x, y, -1, 0);
                const e = this._scan(x, y, 1, 0);
                const dv = n && s ? Math.abs(n.h - s.h) : -1;
                const dh = w && e ? Math.abs(w.h - e.h) : -1;
                if (dv < 0 && dh < 0) {
                    const any = n || s || w || e;
                    nw = ne = se = sw = any ? any.h : 0;
                } else if (dv >= dh) {
                    const len = n.n + s.n - 1;
                    const top = n.h + ((s.h - n.h) * (n.n - 1)) / len;
                    const bottom = n.h + ((s.h - n.h) * n.n) / len;
                    nw = ne = top;
                    sw = se = bottom;
                } else {
                    const len = w.n + e.n - 1;
                    const left = w.h + ((e.h - w.h) * (w.n - 1)) / len;
                    const right = w.h + ((e.h - w.h) * w.n) / len;
                    nw = sw = left;
                    ne = se = right;
                }
                this.base[i] = (nw + ne + se + sw) / 4;
            } else {
                nw = ne = se = sw = this.base[i] - (this.water[i] ? this.waterDepth : 0);
            }
            this.corners[c] = nw;
            this.corners[c + 1] = ne;
            this.corners[c + 2] = se;
            this.corners[c + 3] = sw;
        }

        /**
         * @brief Averages corners that meet at a grid vertex when their heights
         *        differ by no more than `threshold`; bigger steps stay cliffs.
         * @param {number} threshold Max difference to blend.
         */
        _smooth(threshold) {
            const W = this.width;
            const H = this.height;
            const result = this.corners.slice();
            // For each grid vertex, the 4 tiles around it and which corner of
            // each touches the vertex: NW tile's SE, NE tile's SW, ...
            const around = [
                [-1, -1, 2],
                [0, -1, 3],
                [0, 0, 0],
                [-1, 0, 1],
            ];
            for (let vy = 0; vy <= H; vy++) {
                for (let vx = 0; vx <= W; vx++) {
                    const slots = [];
                    for (const [ox, oy, corner] of around) {
                        const i = this.index(vx + ox, vy + oy);
                        if (i >= 0 && !this.water[i]) {
                            slots.push(i * 4 + corner);
                        }
                    }
                    for (const a of slots) {
                        let sum = 0;
                        let count = 0;
                        for (const b of slots) {
                            if (Math.abs(this.corners[a] - this.corners[b]) <= threshold) {
                                sum += this.corners[b];
                                count++;
                            }
                        }
                        result[a] = sum / count;
                    }
                }
            }
            this.corners = result;
        }

        /**
         * @brief Corner heights of a tile (clamped to the map).
         * @return {number[]} [nw, ne, se, sw].
         */
        cornersAt(x, y) {
            const cx = Math.max(0, Math.min(this.width - 1, x));
            const cy = Math.max(0, Math.min(this.height - 1, y));
            const c = (cy * this.width + cx) * 4;
            const k = this.corners;
            return [k[c], k[c + 1], k[c + 2], k[c + 3]];
        }

        /** @brief Average height of a tile surface. */
        tileHeight(x, y) {
            const c = this.cornersAt(x, y);
            return (c[0] + c[1] + c[2] + c[3]) / 4;
        }

        /**
         * @brief Height of the edge of tile (x, y) facing direction d.
         * @param {number} d MZ direction (2, 4, 6, 8).
         * @return {number} Average height of the two corners on that edge.
         */
        edgeHeight(x, y, d) {
            const c = this.cornersAt(x, y);
            switch (d) {
                case 2:
                    return (c[2] + c[3]) / 2;
                case 4:
                    return (c[0] + c[3]) / 2;
                case 6:
                    return (c[1] + c[2]) / 2;
                default:
                    return (c[0] + c[1]) / 2;
            }
        }

        /**
         * @brief Bilinear ground height at a world position.
         * @param {number} fx World X (tile units).
         * @param {number} fz World Z (tile units).
         * @return {number} Height.
         */
        heightAtWorld(fx, fz) {
            const x = Math.floor(fx);
            const y = Math.floor(fz);
            const u = Math.max(0, Math.min(1, fx - x));
            const v = Math.max(0, Math.min(1, fz - y));
            const c = this.cornersAt(x, y);
            const top = c[0] + (c[1] - c[0]) * u;
            const bottom = c[3] + (c[2] - c[3]) * u;
            return top + (bottom - top) * v;
        }
    }

    /** @brief HeightField cache for the current map. */
    let heightCache = null;

    /**
     * @brief The HeightField of the current map, built on first use.
     * @return {HeightField|null} Null when no map is loaded.
     */
    function heights() {
        if (!$dataMap || !$gameMap || !$gameMap.width()) {
            return null;
        }
        if (!heightCache || heightCache.dataMap !== $dataMap) {
            heightCache = new HeightField($gameMap, mapConfig());
            heightCache.dataMap = $dataMap;
        }
        return heightCache;
    }

    /**
     * @brief Ground height of a tile, in tile units.
     * @param {number} x Tile X (clamped to the map).
     * @param {number} y Tile Y (clamped to the map).
     * @return {number} Height, 0 when no map is loaded.
     */
    function heightAt(x, y) {
        const hf = heights();
        return hf ? hf.tileHeight(x, y) : 0;
    }

    //=========================================================================
    // Map baking: MZ's own Tilemap draws each chunk into a canvas, so every
    // autotile shape, shadow and table edge matches the 2D game exactly.
    //=========================================================================

    /**
     * @brief Bakes chunks of a map layer to canvases using MZ's Tilemap.
     */
    class ChunkBaker {
        /**
         * @param {Bitmap[]} bitmaps Tileset bitmaps (from the spriteset).
         * @param {number[]} data Map data to draw (may be filtered).
         */
        constructor(bitmaps, data) {
            const tw = $gameMap.tileWidth();
            const th = $gameMap.tileHeight();
            const cs = CONFIG.chunkSize;
            this.tilemap = new Tilemap();
            this.tilemap.tileWidth = tw;
            this.tilemap.tileHeight = th;
            this.tilemap.width = cs * tw;
            this.tilemap.height = cs * th;
            this.tilemap.setData($gameMap.width(), $gameMap.height(), data);
            this.tilemap.setBitmaps(bitmaps);
            this.tilemap.flags = $gameMap.tilesetFlags();
            this.rt = PIXI.RenderTexture.create({ width: cs * tw, height: cs * th });
        }

        /**
         * @brief Draws one chunk.
         * @param {number} cx Chunk X.
         * @param {number} cy Chunk Y.
         * @param {number} frame Autotile animation frame.
         * @return {HTMLCanvasElement} The chunk image.
         */
        bake(cx, cy, frame) {
            const cs = CONFIG.chunkSize;
            const tilemap = this.tilemap;
            tilemap.origin.x = cx * cs * tilemap.tileWidth;
            tilemap.origin.y = cy * cs * tilemap.tileHeight;
            tilemap.animationFrame = frame;
            tilemap.refresh();
            const renderer = Graphics.app.renderer;
            renderer.render(tilemap, this.rt, true);
            return renderer.extract.canvas(this.rt);
        }

        /** @brief Frees the temporary tilemap and render texture. */
        destroy() {
            this.rt.destroy(true);
            this.tilemap.destroy();
        }
    }

    //=========================================================================
    // Materials
    //=========================================================================

    /**
     * @brief Creates a pixel-art texture from an image or canvas.
     * @param {HTMLCanvasElement|HTMLImageElement} image Source.
     * @param {boolean} srgb Mark as sRGB (for built-in materials).
     * @return {THREE.Texture} The texture.
     */
    function pixelTexture(image, srgb) {
        const tex = image instanceof HTMLCanvasElement ? new THREE.CanvasTexture(image) : new THREE.Texture(image);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.needsUpdate = true;
        return tex;
    }

    /**
     * @brief Creates a material for terrain and models. Unlit unless the
     *        Lighting addon is active.
     * @param {Object} options THREE material options.
     * @return {THREE.Material} The material.
     */
    function createSurfaceMaterial(options) {
        if (Three.lit && Three.lightingEnabled()) {
            return new THREE.MeshLambertMaterial(options);
        }
        return new THREE.MeshBasicMaterial(options);
    }

    /**
     * @brief Uniforms shared by every billboard material. The Lighting addon
     *        writes into these; the core leaves them at "fully lit".
     */
    const MAX_BILLBOARD_LIGHTS = 8;
    const billboardUniforms = {
        uAmbient: { value: new THREE.Color(1, 1, 1) },
        uLightCount: { value: 0 },
        uLightPos: { value: Array.from({ length: MAX_BILLBOARD_LIGHTS }, () => new THREE.Vector3()) },
        uLightColor: { value: Array.from({ length: MAX_BILLBOARD_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
        uLightRange: { value: new Array(MAX_BILLBOARD_LIGHTS).fill(1) },
        uDepthBias: { value: CONFIG.depthBias },
    };

    const BILLBOARD_VERTEX = `
        #define MAX_LIGHTS ${MAX_BILLBOARD_LIGHTS}
        attribute vec3 anchor;
        uniform vec2 uScale;
        uniform vec4 uUvRect;
        uniform float uFlat;
        uniform float uDepthBias;
        uniform vec3 uAmbient;
        uniform int uLightCount;
        uniform vec3 uLightPos[MAX_LIGHTS];
        uniform vec3 uLightColor[MAX_LIGHTS];
        uniform float uLightRange[MAX_LIGHTS];
        varying vec2 vUv;
        varying float vLocalY;
        varying vec3 vLight;
        #include <fog_pars_vertex>
        void main() {
            vec3 a = (modelMatrix * vec4(anchor, 1.0)).xyz;
            vec2 off = position.xy * uScale;
            vec4 mvPosition;
            if (uFlat > 0.5) {
                mvPosition = viewMatrix * vec4(a + vec3(off.x, 0.02, 0.5 * uScale.y - off.y), 1.0);
                gl_Position = projectionMatrix * mvPosition;
            } else {
                // Face the camera, so pixel art keeps its exact proportions...
                mvPosition = viewMatrix * vec4(a, 1.0);
                mvPosition.xy += off;
                gl_Position = projectionMatrix * mvPosition;
                // ...but take depth from an upright card at the anchor, so
                // sprites never lean into walls or slopes behind them.
                float upY = max(viewMatrix[1][1], 0.2);
                vec3 dp = a + vec3(0.0, off.y / upY, 0.0);
                dp += normalize(cameraPosition - a) * uDepthBias;
                vec4 dc = projectionMatrix * viewMatrix * vec4(dp, 1.0);
                gl_Position.z = dc.z / dc.w * gl_Position.w;
            }
            vUv = uUvRect.xy + uv * uUvRect.zw;
            vLocalY = position.y;
            vec3 light = uAmbient;
            vec3 lp = a + vec3(0.0, 0.5, 0.0);
            for (int i = 0; i < MAX_LIGHTS; i++) {
                if (i >= uLightCount) break;
                float k = clamp(1.0 - distance(lp, uLightPos[i]) / uLightRange[i], 0.0, 1.0);
                light += uLightColor[i] * k * k;
            }
            vLight = light;
            #include <fog_vertex>
        }
    `;

    const BILLBOARD_FRAGMENT = `
        uniform sampler2D map;
        uniform float uOpacity;
        uniform float uBush;
        uniform vec4 uBlend;
        uniform vec3 uTint;
        varying vec2 vUv;
        varying float vLocalY;
        varying vec3 vLight;
        #include <fog_pars_fragment>
        void main() {
            vec4 c = texture2D(map, vUv);
            if (c.a < 0.5) discard;
            c.rgb = mix(c.rgb, uBlend.rgb, uBlend.a);
            c.rgb = min(c.rgb * uTint * vLight, vec3(1.0));
            float a = c.a * uOpacity;
            if (vLocalY < uBush) a *= 0.5;
            gl_FragColor = vec4(c.rgb, a);
            #include <fog_fragment>
        }
    `;

    /**
     * @brief Creates a billboard material (camera-facing, pixel-exact).
     * @param {THREE.Texture} map Texture (NoColorSpace).
     * @param {boolean} transparent Whether to alpha-blend (characters) or
     *        only alpha-test (static cards).
     * @return {THREE.ShaderMaterial} The material.
     */
    function createBillboardMaterial(map, transparent) {
        const uniforms = Object.assign(
            THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
            billboardUniforms,
            {
                map: { value: map },
                uScale: { value: new THREE.Vector2(1, 1) },
                uUvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
                uFlat: { value: 0 },
                uOpacity: { value: 1 },
                uBush: { value: 0 },
                uBlend: { value: new THREE.Vector4(0, 0, 0, 0) },
                uTint: { value: new THREE.Color(1, 1, 1) },
            }
        );
        return new THREE.ShaderMaterial({
            uniforms,
            vertexShader: BILLBOARD_VERTEX,
            fragmentShader: BILLBOARD_FRAGMENT,
            transparent,
            depthWrite: true,
            side: THREE.DoubleSide,
            fog: true,
        });
    }

    /**
     * @brief Shared textures for MZ bitmaps (character sheets, tilesets).
     *        Kept across scenes so menus don't cause re-uploads.
     */
    const bitmapTextures = new Map();

    /**
     * @brief Returns the texture for an MZ Bitmap, creating it once.
     * @param {Bitmap} bitmap A loaded bitmap.
     * @return {THREE.Texture} The texture.
     */
    function textureFromBitmap(bitmap) {
        let tex = bitmapTextures.get(bitmap);
        const source = bitmap._canvas || bitmap._image;
        if (!tex || tex.image !== source) {
            if (tex) {
                tex.dispose();
            }
            tex = pixelTexture(source, false);
            bitmapTextures.set(bitmap, tex);
        }
        return tex;
    }

    /** @brief Frees textures of bitmaps not used by the given set. */
    function pruneBitmapTextures(keep) {
        for (const [bitmap, tex] of bitmapTextures) {
            if (!keep.has(bitmap)) {
                tex.dispose();
                bitmapTextures.delete(bitmap);
            }
        }
    }

    //=========================================================================
    // Terrain geometry
    //=========================================================================

    /**
     * @brief Accumulates indexed quads with flat normals.
     */
    class QuadBuilder {
        constructor() {
            this.positions = [];
            this.normals = [];
            this.uvs = [];
            this.colors = [];
            this.indices = [];
        }

        /**
         * @brief Fake sun shading baked into vertex colors, so cliffs and
         *        slopes read clearly even without the Lighting addon.
         * @param {number} nx Normal X.
         * @param {number} ny Normal Y.
         * @param {number} nz Normal Z.
         * @return {number} Brightness 0-1.
         */
        static shade(nx, ny, nz) {
            if (Three.lit && Three.lightingEnabled()) {
                return 1;
            }
            return Math.max(0.45, Math.min(1, 0.62 + 0.38 * ny + 0.12 * nz - 0.06 * nx));
        }

        /**
         * @brief Adds a quad. Corners are given as seen from the front:
         *        a = top-left, b = top-right, c = bottom-right, d = bottom-left.
         * @param {number[]} a Corner [x, y, z].
         * @param {number[]} b Corner.
         * @param {number[]} c Corner.
         * @param {number[]} d Corner.
         * @param {number[]} uv [u0, vTop, u1, vBottom].
         */
        quad(a, b, c, d, uv) {
            const i = this.positions.length / 3;
            this.positions.push(...a, ...b, ...c, ...d);
            const e1x = d[0] - a[0], e1y = d[1] - a[1], e1z = d[2] - a[2];
            const e2x = b[0] - a[0], e2y = b[1] - a[1], e2z = b[2] - a[2];
            let nx = e1y * e2z - e1z * e2y;
            let ny = e1z * e2x - e1x * e2z;
            let nz = e1x * e2y - e1y * e2x;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            const k = QuadBuilder.shade(nx, ny, nz);
            for (let n = 0; n < 4; n++) {
                this.normals.push(nx, ny, nz);
                this.colors.push(k, k, k);
            }
            this.uvs.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
            this.indices.push(i, i + 3, i + 1, i + 1, i + 3, i + 2);
        }

        /** @return {THREE.BufferGeometry|null} Geometry, or null if empty. */
        build() {
            if (this.indices.length === 0) {
                return null;
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
            g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
            g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
            g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
            g.setIndex(this.indices);
            g.computeBoundingSphere();
            return g;
        }
    }

    /**
     * @brief Accumulates billboard quads for upright tiles: each vertex has a
     *        corner offset (position) and a shared anchor on the ground.
     */
    class CardBuilder {
        constructor() {
            this.positions = [];
            this.anchors = [];
            this.uvs = [];
            this.indices = [];
            this.min = new THREE.Vector3(Infinity, Infinity, Infinity);
            this.max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        }

        /**
         * @brief Adds one tile-sized card row.
         * @param {number[]} anchor Ground point the card stands on.
         * @param {number} row Rows above the bottom tile.
         * @param {number[]} uv [u0, vTop, u1, vBottom].
         */
        card(anchor, row, uv) {
            const i = this.positions.length / 3;
            this.positions.push(-0.5, row + 1, 0, 0.5, row + 1, 0, 0.5, row, 0, -0.5, row, 0);
            for (let k = 0; k < 4; k++) {
                this.anchors.push(anchor[0], anchor[1], anchor[2]);
            }
            this.uvs.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
            this.indices.push(i, i + 3, i + 1, i + 1, i + 3, i + 2);
            this.min.min(new THREE.Vector3(anchor[0] - 1, anchor[1], anchor[2] - row - 2));
            this.max.max(new THREE.Vector3(anchor[0] + 1, anchor[1] + row + 2, anchor[2] + 1));
        }

        /** @return {THREE.BufferGeometry|null} Geometry, or null if empty. */
        build() {
            if (this.indices.length === 0) {
                return null;
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
            g.setAttribute("anchor", new THREE.Float32BufferAttribute(this.anchors, 3));
            g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
            g.setIndex(this.indices);
            // Shader moves vertices; give culling a generous box.
            g.boundingBox = new THREE.Box3(this.min, this.max);
            g.boundingSphere = new THREE.Sphere();
            g.boundingBox.getBoundingSphere(g.boundingSphere);
            return g;
        }
    }

    /**
     * @brief Splits map data into a ground layer and an upright layer.
     * @return {{ground: number[], upright: number[], mask: Uint8Array,
     *          animated: Uint8Array}} Filtered copies plus per-tile flags.
     */
    function splitMapData() {
        const W = $gameMap.width();
        const H = $gameMap.height();
        const data = $gameMap.data();
        const flags = $gameMap.tilesetFlags();
        const ground = data.slice();
        const upright = new Array(data.length).fill(0);
        const mask = new Uint8Array(W * H);
        const animated = new Uint8Array(W * H);
        const tag = CONFIG.uprightTag;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                for (let z = 0; z < 4; z++) {
                    const i = (z * H + y) * W + x;
                    const tileId = data[i] || 0;
                    if (Tilemap.isTileA1(tileId)) {
                        animated[y * W + x] = 1;
                    }
                    if (tag > 0 && tileId > 0 && tileId < Tilemap.TILE_ID_A5 && flags[tileId] >> 12 === tag) {
                        upright[i] = tileId;
                        ground[i] = 0;
                        mask[y * W + x] = 1;
                    }
                }
            }
        }
        return { ground, upright, mask, animated };
    }

    /**
     * @brief Animation frames to bake for chunks with A1 tiles. MZ water uses
     *        frame%4 -> [0,1,2,1] and waterfalls frame%3, so 4 frames cover
     *        water exactly and waterfalls closely.
     */
    const ANIMATION_FRAMES = 4;

    /**
     * @brief One square piece of terrain with its own baked textures.
     */
    class TerrainChunk {
        constructor() {
            this.group = new THREE.Group();
            this.textures = [];
            this.uprightTexture = null;
            this.materials = [];
        }

        /** @brief Shows autotile animation frame `frame`. */
        setFrame(frame) {
            if (this.textures.length > 1) {
                const tex = this.textures[frame % this.textures.length];
                for (const m of this.materials) {
                    if (m.map !== tex) {
                        m.map = tex;
                    }
                }
            }
        }

        /** @brief Frees all GPU resources. */
        dispose() {
            this.group.traverse(obj => {
                if (obj.geometry) {
                    obj.geometry.dispose();
                }
                if (obj.material) {
                    obj.material.dispose();
                }
            });
            for (const t of this.textures) {
                t.dispose();
            }
            if (this.uprightTexture) {
                this.uprightTexture.dispose();
            }
        }
    }

    /**
     * @brief Builds every chunk of the current map.
     * @param {Bitmap[]} bitmaps Tileset bitmaps.
     * @return {{group: THREE.Group, chunks: TerrainChunk[]}} The terrain.
     */
    function buildTerrain(bitmaps) {
        const W = $gameMap.width();
        const H = $gameMap.height();
        const cs = CONFIG.chunkSize;
        const cfg = mapConfig();
        const hf = heights();
        const split = splitMapData();
        const groundBaker = new ChunkBaker(bitmaps, split.ground);
        const uprightBaker = split.mask.some(v => v) ? new ChunkBaker(bitmaps, split.upright) : null;
        const translucent = cfg.waterOpacity < 1;
        const bedColor = parseColor(cfg.waterBedColor, "#1c3550");
        const group = new THREE.Group();
        const chunks = [];

        for (let cy = 0; cy * cs < H; cy++) {
            for (let cx = 0; cx * cs < W; cx++) {
                const x0 = cx * cs;
                const y0 = cy * cs;
                const x1 = Math.min(W, x0 + cs);
                const y1 = Math.min(H, y0 + cs);
                const chunk = new TerrainChunk();
                const ground = new QuadBuilder();
                const water = new QuadBuilder();
                const bed = new QuadBuilder();
                const cards = new CardBuilder();
                let isAnimated = false;
                let hasUpright = false;

                const tileUv = (x, y, fraction) => {
                    const u0 = (x - x0) / cs;
                    const vTop = 1 - (y - y0) / cs;
                    return [u0, vTop, u0 + 1 / cs, vTop - (fraction === undefined ? 1 : fraction) / cs];
                };

                for (let y = y0; y < y1; y++) {
                    for (let x = x0; x < x1; x++) {
                        const i = y * W + x;
                        isAnimated = isAnimated || split.animated[i] === 1;
                        const [nw, ne, se, sw] = hf.cornersAt(x, y);
                        const isWater = hf.water[i] === 1;
                        const top = isWater ? water : ground;
                        top.quad([x, nw, y], [x + 1, ne, y], [x + 1, se, y + 1], [x, sw, y + 1], tileUv(x, y));
                        const bedY = Math.min(nw, ne, se, sw) - 0.35;
                        if (isWater && translucent) {
                            bed.quad([x, bedY, y], [x + 1, bedY, y], [x + 1, bedY, y + 1], [x, bedY, y + 1], [0, 1, 1, 0]);
                        }
                        addWalls(ground, hf, x, y, translucent, tileUv);
                        if (split.mask[i]) {
                            hasUpright = true;
                            let yb = y;
                            while (yb + 1 < H && split.mask[(yb + 1) * W + x]) {
                                yb++;
                            }
                            const anchor = [x + 0.5, hf.tileHeight(x, yb), yb + 0.5];
                            cards.card(anchor, yb - y, tileUv(x, y));
                        }
                    }
                }

                const frames = isAnimated ? ANIMATION_FRAMES : 1;
                for (let f = 0; f < frames; f++) {
                    chunk.textures.push(pixelTexture(groundBaker.bake(cx, cy, f), true));
                }
                const tex = chunk.textures[0];

                const groundGeo = ground.build();
                if (groundGeo) {
                    const m = createSurfaceMaterial({ map: tex, side: THREE.DoubleSide, vertexColors: true });
                    chunk.materials.push(m);
                    const mesh = new THREE.Mesh(groundGeo, m);
                    mesh.receiveShadow = true;
                    mesh.userData.pickable = true;
                    chunk.group.add(mesh);
                }
                const waterGeo = water.build();
                if (waterGeo) {
                    const m = createSurfaceMaterial({
                        map: tex,
                        vertexColors: true,
                        transparent: translucent,
                        opacity: cfg.waterOpacity,
                        depthWrite: !translucent,
                        side: THREE.DoubleSide,
                    });
                    chunk.materials.push(m);
                    const mesh = new THREE.Mesh(waterGeo, m);
                    mesh.receiveShadow = true;
                    mesh.userData.pickable = true;
                    mesh.userData.water = true;
                    chunk.group.add(mesh);
                }
                const bedGeo = bed.build();
                if (bedGeo) {
                    const m = createSurfaceMaterial({ color: bedColor });
                    chunk.group.add(new THREE.Mesh(bedGeo, m));
                }
                if (hasUpright && uprightBaker) {
                    chunk.uprightTexture = pixelTexture(uprightBaker.bake(cx, cy, 0), false);
                    const cardGeo = cards.build();
                    const m = createBillboardMaterial(chunk.uprightTexture, false);
                    const mesh = new THREE.Mesh(cardGeo, m);
                    mesh.userData.cards = true;
                    chunk.group.add(mesh);
                }
                group.add(chunk.group);
                chunks.push(chunk);
            }
        }
        groundBaker.destroy();
        if (uprightBaker) {
            uprightBaker.destroy();
        }
        return { group, chunks };
    }

    /**
     * @brief Adds cliff walls on every edge of tile (x, y) where it is higher
     *        than its neighbour. Walls repeat the tile's texture once per
     *        tile of height instead of stretching it.
     */
    function addWalls(builder, hf, x, y, translucent, tileUv) {
        const [nw, ne, se, sw] = hf.cornersAt(x, y);
        // [dx, dy, my corners (left, right as seen from outside),
        //  neighbour corner indices matching them, quad corner builder]
        const sides = [
            [0, 1, sw, se, 0, 1, (l, r, bl, br) => [[x, l, y + 1], [x + 1, r, y + 1], [x + 1, br, y + 1], [x, bl, y + 1]]],
            [1, 0, se, ne, 3, 0, (l, r, bl, br) => [[x + 1, l, y + 1], [x + 1, r, y], [x + 1, br, y], [x + 1, bl, y + 1]]],
            [0, -1, ne, nw, 2, 3, (l, r, bl, br) => [[x + 1, l, y], [x, r, y], [x, br, y], [x + 1, bl, y]]],
            [-1, 0, nw, sw, 1, 2, (l, r, bl, br) => [[x, l, y], [x, r, y + 1], [x, br, y + 1], [x, bl, y]]],
        ];
        for (const [dx, dy, l, r, il, ir, make] of sides) {
            const nx = x + dx;
            const ny = y + dy;
            let bl, br;
            if (hf.index(nx, ny) < 0) {
                bl = br = Math.min(0, l, r);
            } else {
                const nc = hf.cornersAt(nx, ny);
                bl = nc[il];
                br = nc[ir];
                if (translucent && hf.isWater(nx, ny) && !hf.isWater(x, y)) {
                    bl = br = Math.min(...nc) - 0.35;
                }
            }
            const hl = l - bl;
            const hr = r - br;
            if (hl <= 0.001 && hr <= 0.001) {
                continue;
            }
            const tall = Math.max(hl, hr);
            const segments = Math.max(1, Math.ceil(tall - 0.001));
            for (let s = 0; s < segments; s++) {
                const t0 = s / segments;
                const t1 = (s + 1) / segments;
                const topL = l - (l - bl) * t0;
                const topR = r - (r - br) * t0;
                const botL = l - (l - bl) * t1;
                const botR = r - (r - br) * t1;
                const [a, b, c, d] = make(topL, topR, botL, botR);
                builder.quad(a, b, c, d, tileUv(x, y, Math.min(1, tall / segments)));
            }
        }
    }

    //=========================================================================
    // Billboards
    //=========================================================================

    /** @brief Unit quad used by every character billboard. */
    const billboardGeometry = (() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 1, 0, 0.5, 1, 0, 0.5, 0, 0, -0.5, 0, 0], 3));
        g.setAttribute("anchor", new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
        g.setIndex([0, 3, 1, 1, 3, 2]);
        return g;
    })();

    /**
     * @brief A camera-facing 3D sprite that mirrors one Sprite_Character.
     *
     * MZ keeps updating the 2D sprite (frame, visibility, opacity, bush);
     * this class only copies that state into 3D every frame.
     */
    class CharacterBillboard {
        /**
         * @param {Sprite_Character} mzSprite The 2D sprite to mirror.
         */
        constructor(mzSprite) {
            this.mzSprite = mzSprite;
            this.material = createBillboardMaterial(null, true);
            this.object = new THREE.Mesh(billboardGeometry, this.material);
            this.object.frustumCulled = false;
            this.object.renderOrder = 2;
            this.object.userData.billboard = this;
            this.feet = new THREE.Vector3();
            this.size = new THREE.Vector2();
            this.castsShadow = false;
        }

        /** @return {Game_CharacterBase} The mirrored character. */
        get character() {
            return this.mzSprite._character;
        }

        /**
         * @brief Syncs texture frame, position and visibility from MZ.
         * @param {HeightField} hf Heights of the current map.
         */
        update(hf) {
            const s = this.mzSprite;
            const c = s._character;
            const bitmap = s.bitmap;
            const frame = s._frame;
            const fw = frame.width || (s._bushDepth > 0 ? s.patternWidth() : 0);
            const fh = frame.height;
            const ready = bitmap && bitmap.isReady() && fw > 0 && fh > 0;
            const visible = !!(ready && s.visible && s.opacity > 0 && !c._threeHideSprite);
            this.object.visible = visible;
            this.castsShadow = false;
            if (!visible) {
                return;
            }

            const u = this.material.uniforms;
            const tex = textureFromBitmap(bitmap);
            if (u.map.value !== tex) {
                u.map.value = tex;
            }
            const iw = bitmap.width;
            const ih = bitmap.height;
            u.uUvRect.value.set(frame.x / iw, 1 - (frame.y + fh) / ih, fw / iw, fh / ih);

            const tw = $gameMap.tileWidth();
            const th = $gameMap.tileHeight();
            this.size.set(fw / tw, fh / th);
            u.uScale.value.copy(this.size);
            u.uOpacity.value = s.opacity / 255;
            u.uBush.value = s._bushDepth > 0 ? s._bushDepth / fh : 0;
            const blend = s.getBlendColor();
            u.uBlend.value.set(blend[0] / 255, blend[1] / 255, blend[2] / 255, blend[3] / 255);

            const tags = eventText(c);
            u.uFlat.value = s.isTile() && /<3D\s+Flat>/i.test(tags) ? 1 : 0;

            const x = c._realX + 0.5;
            const z = c._realY + 0.5;
            let y = hf.heightAtWorld(x, z);
            this.groundY = y;
            y += c.jumpHeight() / th;
            if (c instanceof Game_Vehicle) {
                y += c._altitude / th;
            }
            this.feet.set(x, y, z);
            this.object.position.copy(this.feet);
            this.castsShadow =
                CONFIG.blobShadows &&
                !s.isTile() &&
                !s.isObjectCharacter() &&
                !/<3D\s+Shadow\s*:\s*off>/i.test(tags);
        }

        /** @brief Frees GPU resources (shared textures are kept). */
        dispose() {
            this.material.dispose();
        }
    }

    //=========================================================================
    // Blob shadows
    //=========================================================================

    /**
     * @brief Soft round shadows under characters, drawn as one instanced mesh.
     */
    class BlobShadows {
        constructor(max) {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 32;
            const ctx = canvas.getContext("2d");
            const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
            grad.addColorStop(0, "rgba(0,0,0,0.55)");
            grad.addColorStop(0.6, "rgba(0,0,0,0.35)");
            grad.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 32, 32);
            this.texture = pixelTexture(canvas, true);
            this.texture.magFilter = THREE.LinearFilter;
            const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
            const mat = new THREE.MeshBasicMaterial({
                map: this.texture,
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
            });
            this.mesh = new THREE.InstancedMesh(geo, mat, max);
            this.mesh.frustumCulled = false;
            this.mesh.renderOrder = 1;
            this.mesh.count = 0;
            this.max = max;
            this._m = new THREE.Matrix4();
            this._p = new THREE.Vector3();
            this._q = new THREE.Quaternion();
            this._s = new THREE.Vector3();
        }

        /**
         * @brief Places one shadow per billboard that casts one.
         * @param {CharacterBillboard[]} billboards All billboards.
         */
        update(billboards) {
            let n = 0;
            const th = $gameMap.tileHeight();
            for (const b of billboards) {
                if (!b.castsShadow || n >= this.max) {
                    continue;
                }
                const jump = b.character.jumpHeight() / th;
                const k = Math.max(0.4, 1 - jump * 0.4) * CONFIG.shadowSize * Math.min(1.5, b.size.x);
                this._p.set(b.feet.x, b.groundY + 0.01, b.feet.z);
                this._s.set(k, 1, k * 0.6);
                this._m.compose(this._p, this._q, this._s);
                this.mesh.setMatrixAt(n++, this._m);
            }
            this.mesh.count = n;
            this.mesh.instanceMatrix.needsUpdate = true;
        }

        /** @brief Frees GPU resources. */
        dispose() {
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.texture.dispose();
            this.mesh.dispose();
        }
    }

    //=========================================================================
    // Camera
    //=========================================================================

    /**
     * @brief Follow camera with scriptable, eased transitions.
     *
     * Its persistent state lives in $gameMap._threeCamera so it survives
     * menus and save files; tweens are runtime only and snap to their end
     * when a save is loaded.
     */
    class CameraController {
        constructor() {
            this.tweens = [];
            this.blend = null;
            this.shake = null;
            this.look = new THREE.Vector3();
            this.smoothY = null;
            this._target = new THREE.Vector3();
        }

        /**
         * @brief The saved state, created from the map's defaults on demand.
         * @return {Object} The state.
         */
        get state() {
            if (!$gameMap._threeCamera) {
                $gameMap._threeCamera = this.defaultState();
            }
            return $gameMap._threeCamera;
        }

        /** @brief The map's default camera state. */
        defaultState() {
            const cfg = mapConfig();
            return {
                follow: { type: "player" },
                pitch: cfg.pitch,
                yaw: cfg.yaw,
                distance: cfg.distance,
                fov: cfg.fov,
                ox: 0,
                oy: 0,
                oz: 0,
            };
        }

        /** @brief Drops runtime state (new map or new scene). */
        resetRuntime() {
            this.tweens = [];
            this.blend = null;
            this.shake = null;
            this.smoothY = null;
        }

        /** @return {boolean} True while a scripted move is in progress. */
        isBusy() {
            return this.tweens.length > 0 || !!this.blend || !!this.shake;
        }

        /**
         * @brief Tweens numeric state values.
         * @param {Object} values Map of state key to target value.
         * @param {number} duration Frames.
         * @param {string} easing Easing name.
         */
        tweenTo(values, duration, easing) {
            const state = this.state;
            for (const key of Object.keys(values)) {
                const to = values[key];
                if (to === undefined || to === null || isNaN(to)) {
                    continue;
                }
                this.tweens = this.tweens.filter(t => t.key !== key);
                if (duration <= 0) {
                    state[key] = to;
                } else {
                    this.tweens.push({ key, from: state[key], to, t: 0, duration, ease: EASING[easing] || EASING.easeInOut });
                }
            }
        }

        /**
         * @brief Changes what the camera looks at, blending from the current
         *        look-at point.
         * @param {Object} follow {type: "player"} | {type: "event", id} |
         *        {type: "point", x, y}.
         * @param {number} duration Frames.
         * @param {string} easing Easing name.
         */
        setFollow(follow, duration, easing) {
            this.state.follow = follow;
            if (duration > 0) {
                this.blend = { from: this.look.clone(), t: 0, duration, ease: EASING[easing] || EASING.easeInOut };
            } else {
                this.blend = null;
            }
        }

        /**
         * @brief Starts a camera shake.
         * @param {number} power Amplitude in tiles.
         * @param {number} duration Frames.
         */
        startShake(power, duration) {
            this.shake = { power, duration, t: 0 };
        }

        /** @brief Resolves the live follow target into `out`. */
        _resolveTarget(out) {
            const f = this.state.follow || { type: "player" };
            let x, y;
            if (f.type === "point") {
                x = f.x;
                y = f.y;
            } else {
                const ch = f.type === "event" ? $gameMap.event(f.id) : $gamePlayer;
                const c = ch || $gamePlayer;
                x = c._realX;
                y = c._realY;
            }
            const hf = heights();
            const ground = hf ? hf.heightAtWorld(x + 0.5, y + 0.5) : 0;
            return out.set(x + 0.5, ground, y + 0.5);
        }

        /**
         * @brief Advances tweens and positions the THREE camera.
         * @param {THREE.PerspectiveCamera} camera The camera.
         */
        update(camera) {
            const state = this.state;
            for (const tw of this.tweens) {
                tw.t++;
                state[tw.key] = tw.from + (tw.to - tw.from) * tw.ease(Math.min(1, tw.t / tw.duration));
            }
            this.tweens = this.tweens.filter(tw => tw.t < tw.duration);

            const target = this._resolveTarget(this._target);
            if (this.smoothY === null) {
                this.smoothY = target.y;
            }
            this.smoothY += (target.y - this.smoothY) * 0.15;
            target.y = this.smoothY;

            if (this.blend) {
                this.blend.t++;
                const k = this.blend.ease(Math.min(1, this.blend.t / this.blend.duration));
                target.lerpVectors(this.blend.from, target, k);
                if (this.blend.t >= this.blend.duration) {
                    this.blend = null;
                }
            }

            const pitch = THREE.MathUtils.degToRad(state.pitch);
            const yaw = THREE.MathUtils.degToRad(state.yaw);
            const fovRad = THREE.MathUtils.degToRad(state.fov);
            if (mapConfig().clampCamera && !this.blend && state.follow.type !== "point") {
                this._clamp(target, state.distance, fovRad, camera.aspect, pitch);
            }
            target.x += state.ox;
            target.y += state.oy;
            target.z += state.oz;
            if (CONFIG.snapToTexel) {
                const tw = $gameMap.tileWidth();
                target.x = Math.round(target.x * tw) / tw;
                target.z = Math.round(target.z * tw) / tw;
            }
            this.look.copy(target);

            const look = target.clone();
            if (this.shake) {
                this.shake.t++;
                const fade = 1 - this.shake.t / this.shake.duration;
                look.x += Math.sin(this.shake.t * 1.7) * this.shake.power * fade;
                look.z += Math.cos(this.shake.t * 2.3) * this.shake.power * fade * 0.5;
                if (this.shake.t >= this.shake.duration) {
                    this.shake = null;
                }
            }

            const d = state.distance;
            camera.position.set(
                look.x + Math.sin(yaw) * Math.cos(pitch) * d,
                look.y + Math.sin(pitch) * d,
                look.z + Math.cos(yaw) * Math.cos(pitch) * d
            );
            if (camera.fov !== state.fov) {
                camera.fov = state.fov;
                camera.updateProjectionMatrix();
            }
            camera.lookAt(look);
            camera.updateMatrixWorld();
        }

        /** @brief Keeps the target far enough from the map edge (yaw 0 only). */
        _clamp(target, distance, fov, aspect, pitch) {
            if (Math.abs(this.state.yaw) > 1) {
                return;
            }
            const W = $gameMap.width();
            const H = $gameMap.height();
            const halfH = distance * Math.tan(fov / 2);
            const halfW = halfH * aspect;
            const halfD = halfH / Math.max(0.3, Math.sin(pitch));
            target.x = W > halfW * 2 ? Math.max(halfW, Math.min(W - halfW, target.x)) : W / 2;
            target.z = H > halfD * 2 ? Math.max(halfD, Math.min(H - halfD, target.z)) : H / 2;
        }
    }

    //=========================================================================
    // View: owns the THREE renderer and shows its output inside MZ
    //=========================================================================

    /**
     * @brief Owns the Three.js renderer and shows its output inside MZ.
     *
     * One instance lives for the whole game. Scene_Map is recreated every
     * time the menu opens, and creating a WebGL context each time would
     * quickly exhaust the browser's context limit.
     */
    class ThreeMapView {
        constructor() {
            this.canvas = document.createElement("canvas");
            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                alpha: true, // lets MZ's parallax show as the sky
                antialias: false,
                preserveDrawingBuffer: true, // canvas is read by PIXI after rendering
            });
            this.renderer.setPixelRatio(1);
            this.renderer.setClearColor(0x000000, 0);
            this.renderer.shadowMap.type = THREE.PCFShadowMap;

            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(CONFIG.fov, 1, 0.1, 500);
            this.cameraController = new CameraController();

            const texture = PIXI.Texture.from(this.canvas, { scaleMode: PIXI.SCALE_MODES.NEAREST });
            this.pixiTexture = texture;
            this.pixiSprite = new PIXI.Sprite(texture);

            this.spriteset = null;
            this.terrain = null;
            this.terrainKey = null;
            this.billboards = new Map();
            /** @brief Extra objects the Input addon can click (models). */
            this.pickables = [];
            this.shadows = new BlobShadows(256);
            this.scene.add(this.shadows.mesh);
            this.lost = false;
            this.ready = false;
            this._v = new THREE.Vector3();

            this.canvas.addEventListener("webglcontextlost", event => {
                event.preventDefault();
                this.onContextLost();
            });
            this.resize();
        }

        /** @brief Matches the internal render size to MZ's screen. */
        resize() {
            const scale = CONFIG.renderScale;
            const w = Math.ceil(Graphics.width / scale);
            const h = Math.ceil(Graphics.height / scale);
            this.renderer.setSize(w, h, false);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.pixiSprite.scale.set(Graphics.width / w, Graphics.height / h);
            this._size = [Graphics.width, Graphics.height];
        }

        /**
         * @brief Inserts the 3D view into a Spriteset_Map, below the tilemap
         *        container so MZ effects (balloons, animations) still draw on
         *        top and tone, weather and fades still apply.
         * @param {Spriteset_Map} spriteset The map's spriteset.
         */
        attach(spriteset) {
            this.detach();
            this.spriteset = spriteset;
            this.ready = false;
            const base = spriteset._baseSprite;
            base.addChildAt(this.pixiSprite, base.getChildIndex(spriteset._tilemap));

            // Hide the 2D tiles and characters but keep their transforms alive:
            // effects and other plugins still read the sprites' positions.
            const tilemap = spriteset._tilemap;
            tilemap._lowerLayer.visible = false;
            tilemap._upperLayer.visible = false;
            for (const sprite of spriteset._characterSprites) {
                sprite.renderable = false;
            }
            if (spriteset._shadowSprite) {
                spriteset._shadowSprite.renderable = false;
            }
            if (spriteset._destinationSprite) {
                spriteset._destinationSprite.renderable = false;
            }
            this.cameraController.resetRuntime();
            this.callHooks("onAttach", spriteset);
        }

        /**
         * @brief Removes the view from its spriteset. Must run before MZ
         *        destroys the scene, or PIXI would destroy our shared texture.
         */
        detach() {
            if (this.spriteset) {
                this.callHooks("onDetach", this.spriteset);
            }
            if (this.pixiSprite.parent) {
                this.pixiSprite.parent.removeChild(this.pixiSprite);
            }
            for (const billboard of this.billboards.values()) {
                this.scene.remove(billboard.object);
                billboard.dispose();
            }
            this.billboards.clear();
            this.spriteset = null;
            this.ready = false;
        }

        /** @brief Restores the 2D map after a lost WebGL context. */
        onContextLost() {
            console.warn("PokeMZ_Three_Core: WebGL context lost, falling back to 2D.");
            this.lost = true;
            const spriteset = this.spriteset;
            this.detach();
            if (spriteset) {
                restore2D(spriteset);
            }
        }

        /** @brief Disposes the current map's terrain. */
        disposeTerrain() {
            if (this.terrain) {
                this.callHooks("onMapDispose");
                this.scene.remove(this.terrain.group);
                for (const chunk of this.terrain.chunks) {
                    chunk.dispose();
                }
                this.terrain = null;
                this.terrainKey = null;
            }
        }

        /**
         * @brief Builds the terrain for the current map once its tilesets load.
         * @return {boolean} True if the terrain is ready to draw.
         */
        ensureTerrain() {
            if (this.terrain && this.terrainKey === $dataMap) {
                return true;
            }
            const tilemap = this.spriteset._tilemap;
            if (!tilemap.isReady()) {
                return false;
            }
            this.disposeTerrain();
            this.terrain = buildTerrain(tilemap._bitmaps);
            this.terrainKey = $dataMap;
            this.scene.add(this.terrain.group);

            const fog = mapConfig().fog;
            this.scene.fog = fog ? new THREE.Fog(parseColor(fog.color).getHex(), fog.near, fog.far) : null;
            this.callHooks("onMapBuilt");
            return true;
        }

        /** @brief Forces the terrain to rebuild (after tile/region changes). */
        refreshTerrain() {
            heightCache = null;
            if ($dataMap) {
                delete $dataMap._threeConfig;
            }
            this.disposeTerrain();
        }

        /** @brief Creates and removes billboards to match the spriteset. */
        syncBillboards() {
            const sprites = this.spriteset._characterSprites;
            if (this.billboards.size === sprites.length && sprites.every(s => this.billboards.has(s))) {
                return;
            }
            const alive = new Set(sprites);
            for (const [sprite, billboard] of this.billboards) {
                if (!alive.has(sprite)) {
                    this.scene.remove(billboard.object);
                    billboard.dispose();
                    this.billboards.delete(sprite);
                }
            }
            for (const sprite of sprites) {
                if (!this.billboards.has(sprite)) {
                    sprite.renderable = false;
                    const billboard = new CharacterBillboard(sprite);
                    this.billboards.set(sprite, billboard);
                    this.scene.add(billboard.object);
                }
            }
        }

        /**
         * @brief Runs before MZ updates its sprites: builds terrain and moves
         *        the camera, so projections used by sprites are current.
         */
        preUpdate() {
            this.ready = !this.lost && this.ensureTerrain();
            if (!this.ready) {
                return;
            }
            if (this._size[0] !== Graphics.width || this._size[1] !== Graphics.height) {
                this.resize();
            }
            this.cameraController.update(this.camera);
            this.callHooks("onPreUpdate");
        }

        /** @brief Runs after MZ updates its sprites: mirrors them and renders. */
        update() {
            if (!this.ready) {
                this.pixiSprite.visible = false;
                return;
            }
            this.pixiSprite.visible = true;
            const hf = heights();
            this.syncBillboards();
            for (const billboard of this.billboards.values()) {
                billboard.update(hf);
            }
            this.shadows.update(this.billboards.values());

            const frame = this.spriteset._tilemap.animationFrame || 0;
            for (const chunk of this.terrain.chunks) {
                chunk.setFrame(frame);
            }
            this.callHooks("onUpdate");

            this.renderer.render(this.scene, this.camera);
            this.pixiTexture.update(); // re-upload the canvas to PIXI
        }

        /**
         * @brief Projects a world point to MZ screen coordinates.
         * @param {THREE.Vector3} world World point.
         * @param {THREE.Vector3} out Receives (screenX, screenY, ndcZ).
         * @return {THREE.Vector3} `out`.
         */
        worldToScreen(world, out) {
            out.copy(world).project(this.camera);
            out.x = ((out.x + 1) / 2) * Graphics.width;
            out.y = ((1 - out.y) / 2) * Graphics.height;
            return out;
        }

        /**
         * @brief Screen pixels per world unit at a world point (for scaling
         *        2D overlays to match the 3D view).
         * @param {THREE.Vector3} world World point.
         * @return {number} Pixels per tile.
         */
        pixelsPerUnitAt(world) {
            this._v.copy(world).applyMatrix4(this.camera.matrixWorldInverse);
            const depth = Math.max(0.01, -this._v.z);
            const fov = THREE.MathUtils.degToRad(this.camera.fov);
            return Graphics.height / (2 * Math.tan(fov / 2) * depth);
        }

        /** @brief Calls `name` on every registered addon hook. */
        callHooks(name, ...args) {
            for (const hook of hooks) {
                if (typeof hook[name] === "function") {
                    try {
                        hook[name](this, ...args);
                    } catch (e) {
                        console.error(`PokeMZ Three hook ${name} failed:`, e);
                    }
                }
            }
        }
    }

    /** @brief Shows a spriteset's 2D tiles and characters again. */
    function restore2D(spriteset) {
        const tilemap = spriteset._tilemap;
        tilemap._lowerLayer.visible = true;
        tilemap._upperLayer.visible = true;
        for (const sprite of spriteset._characterSprites) {
            sprite.renderable = true;
        }
        if (spriteset._shadowSprite) {
            spriteset._shadowSprite.renderable = true;
        }
        if (spriteset._destinationSprite) {
            spriteset._destinationSprite.renderable = true;
        }
    }

    /** @brief The single shared view, created on first use. */
    let view = null;
    /** @brief Registered addon hooks. */
    const hooks = [];

    /** @return {ThreeMapView|null} The shared view, or null if WebGL failed. */
    function getView() {
        if (!view) {
            try {
                view = new ThreeMapView();
            } catch (e) {
                console.error("PokeMZ_Three_Core: could not create WebGL renderer, using 2D.", e);
                view = { lost: true, failed: true };
            }
        }
        return view.failed ? null : view;
    }

    //=========================================================================
    // Public API for addons
    //=========================================================================

    /**
     * @brief The PokeMZ.Three namespace used by the addon plugins.
     */
    const Three = {
        version: "0.2.0",
        config: CONFIG,
        /** @brief Set to true by the Lighting addon. */
        lit: false,
        /** @brief Overridden by the Lighting addon (per-map lighting). */
        lightingEnabled: () => false,
        mapConfig,
        isMap3D,
        /** @return {boolean} True while a 3D map is being drawn. */
        isActive: () => !!(view && !view.failed && view.spriteset && view.ready),
        /** @return {ThreeMapView|null} The shared view (null until used). */
        get view() {
            return view && !view.failed ? view : null;
        },
        /** @return {CameraController|null} The camera controller. */
        get camera() {
            const v = getView();
            return v ? v.cameraController : null;
        },
        heights,
        heightAt,
        heightAtWorld: (fx, fz) => {
            const hf = heights();
            return hf ? hf.heightAtWorld(fx, fz) : 0;
        },
        /**
         * @brief Center of a tile on the ground.
         * @param {number} x Tile X.
         * @param {number} y Tile Y.
         * @param {THREE.Vector3} [out] Receives the point.
         * @return {THREE.Vector3} World position.
         */
        tileToWorld: (x, y, out) => (out || new THREE.Vector3()).set(x + 0.5, heightAt(x, y), y + 0.5),
        /**
         * @brief Registers an addon. Hook methods (all optional) receive the
         *        view first: onAttach(view, spriteset), onMapBuilt(view),
         *        onPreUpdate(view), onUpdate(view), onDetach(view, spriteset),
         *        onMapDispose(view).
         * @param {Object} hook The hook object.
         */
        addHook: hook => hooks.push(hook),
        parseArgs,
        parseColor,
        parseBool,
        noteTags,
        noteTag,
        eventText,
        EASING,
        pixelTexture,
        textureFromBitmap,
        createSurfaceMaterial,
        createBillboardMaterial,
        billboardUniforms,
        MAX_BILLBOARD_LIGHTS,
        /** @brief Rebuilds terrain after tiles or regions changed by script. */
        refreshTerrain: () => {
            heightCache = null;
            if (view && !view.failed) {
                view.refreshTerrain();
            }
        },
    };

    window.PokeMZ = window.PokeMZ || {};
    window.PokeMZ.Three = Three;

    //=========================================================================
    // Spriteset_Map hooks
    //=========================================================================

    const _Spriteset_Map_createLowerLayer = Spriteset_Map.prototype.createLowerLayer;
    Spriteset_Map.prototype.createLowerLayer = function() {
        _Spriteset_Map_createLowerLayer.call(this);
        if (isMap3D()) {
            const v = getView();
            if (v && !v.lost) {
                v.attach(this);
            }
        }
    };

    const _Spriteset_Map_update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function() {
        const active = view && !view.failed && view.spriteset === this;
        if (active) {
            view.preUpdate();
        }
        _Spriteset_Map_update.call(this);
        if (active && view.spriteset === this) {
            view.update();
        }
    };

    const _Spriteset_Map_destroy = Spriteset_Map.prototype.destroy;
    Spriteset_Map.prototype.destroy = function(options) {
        if (view && !view.failed && view.spriteset === this) {
            view.detach();
        }
        _Spriteset_Map_destroy.call(this, options);
    };

    //=========================================================================
    // Game_Map: reset per-map state
    //=========================================================================

    const _Game_Map_setup = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function(mapId) {
        _Game_Map_setup.call(this, mapId);
        this._threeCamera = null;
        heightCache = null;
        if (view && !view.failed) {
            view.cameraController.resetRuntime();
            if (!isMap3D()) {
                view.disposeTerrain();
                pruneBitmapTextures(new Set());
            }
        }
    };

    //=========================================================================
    // Plugin commands
    //=========================================================================

    /**
     * @brief Makes an interpreter wait until the camera finishes moving.
     * @param {Game_Interpreter} interpreter The running interpreter.
     * @param {*} wait The "wait" argument.
     */
    function maybeWait(interpreter, wait) {
        if (parseBool(wait, false)) {
            interpreter.setWaitMode("threeCamera");
        }
    }

    const _Game_Interpreter_updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
    Game_Interpreter.prototype.updateWaitMode = function() {
        if (this._waitMode === "threeCamera") {
            const cam = Three.isActive() ? Three.camera : null;
            if (cam && cam.isBusy()) {
                return true;
            }
            this._waitMode = "";
            return false;
        }
        return _Game_Interpreter_updateWaitMode.call(this);
    };

    PluginManager.registerCommand(PLUGIN_NAME, "cameraFollow", function(args) {
        const cam = Three.camera;
        if (!cam) {
            return;
        }
        const target = num(args.target, 0);
        let follow = { type: "player" };
        if (target === -1 && this._eventId > 0) {
            follow = { type: "event", id: this._eventId };
        } else if (target > 0) {
            follow = { type: "event", id: target };
        }
        cam.setFollow(follow, num(args.duration, 30), args.easing);
        maybeWait(this, args.wait);
    });

    PluginManager.registerCommand(PLUGIN_NAME, "cameraPanTo", function(args) {
        const cam = Three.camera;
        if (!cam) {
            return;
        }
        cam.setFollow({ type: "point", x: num(args.x, 0), y: num(args.y, 0) }, num(args.duration, 60), args.easing);
        maybeWait(this, args.wait);
    });

    PluginManager.registerCommand(PLUGIN_NAME, "cameraAngle", function(args) {
        const cam = Three.camera;
        if (!cam) {
            return;
        }
        cam.tweenTo(
            {
                pitch: num(args.pitch, null),
                yaw: num(args.yaw, null),
                distance: num(args.distance, null),
                fov: num(args.fov, null),
            },
            num(args.duration, 60),
            args.easing
        );
        maybeWait(this, args.wait);
    });

    PluginManager.registerCommand(PLUGIN_NAME, "cameraOffset", function(args) {
        const cam = Three.camera;
        if (!cam) {
            return;
        }
        cam.tweenTo({ ox: num(args.x, 0), oy: num(args.y, 0), oz: num(args.z, 0) }, num(args.duration, 30), args.easing);
        maybeWait(this, args.wait);
    });

    PluginManager.registerCommand(PLUGIN_NAME, "cameraShake", function(args) {
        const cam = Three.camera;
        if (!cam) {
            return;
        }
        cam.startShake(num(args.power, 0.2), Math.max(1, num(args.duration, 30)));
        maybeWait(this, args.wait);
    });

    PluginManager.registerCommand(PLUGIN_NAME, "cameraReset", function(args) {
        const cam = Three.camera;
        if (!cam) {
            return;
        }
        const d = cam.defaultState();
        const duration = num(args.duration, 30);
        cam.setFollow({ type: "player" }, duration, "easeInOut");
        cam.tweenTo({ pitch: d.pitch, yaw: d.yaw, distance: d.distance, fov: d.fov, ox: 0, oy: 0, oz: 0 }, duration, "easeInOut");
        maybeWait(this, args.wait);
    });

    PluginManager.registerCommand(PLUGIN_NAME, "refreshTerrain", () => {
        Three.refreshTerrain();
    });
})();
