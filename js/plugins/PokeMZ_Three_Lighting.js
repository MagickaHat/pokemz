//=============================================================================
// PokéMZ - Three_Lighting.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.2.0] Ambient, sun and point lights for 3D maps.
 * @author MagickaHat
 * @base PokeMZ_Three_Core
 * @orderAfter PokeMZ_Three_Core
 *
 * @param ambientColor
 * @text Ambient Color
 * @type string
 * @default #ffffff
 *
 * @param ambientIntensity
 * @text Ambient Intensity
 * @type number
 * @decimals 2
 * @default 0.7
 *
 * @param sunColor
 * @text Sun Color
 * @type string
 * @default #fff8ec
 *
 * @param sunIntensity
 * @text Sun Intensity
 * @type number
 * @decimals 2
 * @default 0.45
 *
 * @param sunDirection
 * @text Sun Direction
 * @desc Direction towards the sun as x,y,z (y = up, z = south).
 * @type string
 * @default -1,2,1.5
 *
 * @param sunShadows
 * @text Sun Shadows
 * @desc Real-time shadows cast by models (characters keep blob shadows).
 * Costs performance; can also be enabled per map.
 * @type boolean
 * @default false
 *
 * @param maxLights
 * @text Max Point Lights
 * @desc Nearest point lights to the camera that are lit at once.
 * @type number
 * @min 0
 * @max 8
 * @default 8
 *
 * @command setTimeOfDay
 * @text Set Time Of Day
 * @desc Tints ambient and sun light on 3D maps (maps with
 * <3D TimeOfDay: off> ignore it).
 *
 * @arg preset
 * @text Preset
 * @type select
 * @option day
 * @option dawn
 * @option dusk
 * @option night
 * @default day
 *
 * @arg duration
 * @text Duration (frames)
 * @type number
 * @default 60
 *
 * @help PokeMZ_Three_Lighting.js
 *
 * Switches 3D maps to lit materials and adds an ambient light, a sun and up
 * to "Max Point Lights" point lights. Characters and upright tiles are lit by
 * the ambient light, the sun and nearby point lights too.
 *
 * ---------------------------------------------------------------------------
 * Map note tags
 * ---------------------------------------------------------------------------
 *   <3D Lighting: off>                     Unlit, like without this plugin.
 *   <3D Ambient: #ffffff 0.7>              Color and intensity.
 *   <3D Sun: #fff8ec 0.45 dir=-1,2,1.5 shadows>
 *   <3D Light: #ffaa55 x=5 y=3 radius=4 intensity=1 height=1 flicker>
 *                                          Static point light (any number).
 *   <3D TimeOfDay: off>                    Ignore Set Time Of Day (indoors).
 *
 * ---------------------------------------------------------------------------
 * Event comment / note (on the active page)
 * ---------------------------------------------------------------------------
 *   <3D Light: #ffaa55 radius=4 intensity=1 height=1 flicker>
 *       A point light that follows the event (lamps, fires, torches).
 *
 * Intensity 1 = full brightness. Note that MZ's own "Tint Screen" still
 * works on top of all of this and is often the easiest day/night tool.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_Three_Lighting";
    const Three = window.PokeMZ && window.PokeMZ.Three;
    if (!Three) {
        throw new Error(`${PLUGIN_NAME} requires PokeMZ_Three_Core above it in the plugin list.`);
    }
    const params = PluginManager.parameters(PLUGIN_NAME);

    /**
     * @brief Parses "x,y,z" into a normalized vector.
     * @param {string} text Vector text.
     * @param {string} fallback Used when parsing fails.
     * @return {THREE.Vector3} Unit vector.
     */
    function parseDir(text, fallback) {
        const p = String(text || fallback).split(",").map(Number);
        if (p.length !== 3 || p.some(isNaN)) {
            return parseDir(fallback, "-1,2,1.5");
        }
        return new THREE.Vector3(p[0], p[1], p[2]).normalize();
    }

    /** @brief Plugin settings. */
    const CONFIG = {
        ambientColor: params.ambientColor || "#ffffff",
        ambientIntensity: Number(params.ambientIntensity || 0.7),
        sunColor: params.sunColor || "#fff8ec",
        sunIntensity: Number(params.sunIntensity || 0.45),
        sunDirection: params.sunDirection || "-1,2,1.5",
        sunShadows: Three.parseBool(params.sunShadows, false),
        maxLights: Math.min(Three.MAX_BILLBOARD_LIGHTS, Number(params.maxLights || 8)),
    };

    /** @brief Ambient / sun multipliers for each time of day. */
    const TIME_PRESETS = {
        day: { ambient: [1, 1, 1], sun: [1, 1, 1] },
        dawn: { ambient: [0.85, 0.75, 0.8], sun: [1.0, 0.7, 0.55] },
        dusk: { ambient: [0.8, 0.6, 0.6], sun: [1.0, 0.55, 0.35] },
        night: { ambient: [0.35, 0.4, 0.65], sun: [0.08, 0.1, 0.22] },
    };

    /**
     * @brief Lighting settings of the current map, cached per $dataMap.
     * @return {Object} Settings.
     */
    function mapLighting() {
        if ($dataMap && $dataMap._threeLighting) {
            return $dataMap._threeLighting;
        }
        const note = ($dataMap && $dataMap.note) || "";
        const off = Three.noteTag(note, "Lighting");
        const amb = Three.noteTag(note, "Ambient");
        const sun = Three.noteTag(note, "Sun");
        const tod = Three.noteTag(note, "TimeOfDay");
        const result = {
            enabled: !(off && (off.off || off.false)),
            ambientColor: Three.parseColor(amb && amb._[0], CONFIG.ambientColor),
            ambientIntensity: amb && amb._[1] !== undefined ? Number(amb._[1]) : CONFIG.ambientIntensity,
            sunColor: Three.parseColor(sun && sun._[0], CONFIG.sunColor),
            sunIntensity: sun && sun._[1] !== undefined ? Number(sun._[1]) : CONFIG.sunIntensity,
            sunDirection: parseDir(sun && sun.dir, CONFIG.sunDirection),
            shadows: sun ? !!sun.shadows : CONFIG.sunShadows,
            timeOfDay: !(tod && (tod.off || tod.false)),
            lights: Three.noteTags(note, "Light").map(args => ({
                args,
                x: Number(args.x) || 0,
                y: Number(args.y) || 0,
            })),
        };
        if ($dataMap) {
            $dataMap._threeLighting = result;
        }
        return result;
    }

    Three.lit = true;
    Three.lightingEnabled = () => Three.isMap3D() && mapLighting().enabled;

    //-------------------------------------------------------------------------
    // Time of day (saved with the game)
    //-------------------------------------------------------------------------

    /**
     * @brief The time-of-day tint state on $gameSystem.
     * @return {{ambient: number[], sun: number[]}} Current multipliers.
     */
    function timeOfDay() {
        if (!$gameSystem._threeTimeOfDay) {
            $gameSystem._threeTimeOfDay = { ambient: [1, 1, 1], sun: [1, 1, 1] };
        }
        return $gameSystem._threeTimeOfDay;
    }

    let timeTween = null;

    PluginManager.registerCommand(PLUGIN_NAME, "setTimeOfDay", args => {
        const preset = TIME_PRESETS[args.preset] || TIME_PRESETS.day;
        const duration = Math.max(0, Number(args.duration || 0));
        const state = timeOfDay();
        if (duration === 0) {
            state.ambient = preset.ambient.slice();
            state.sun = preset.sun.slice();
            timeTween = null;
        } else {
            timeTween = {
                from: { ambient: state.ambient.slice(), sun: state.sun.slice() },
                to: preset,
                t: 0,
                duration,
            };
        }
    });

    /** @brief Advances the time-of-day tween. */
    function updateTimeTween() {
        if (!timeTween) {
            return;
        }
        timeTween.t++;
        const k = Three.EASING.easeInOut(Math.min(1, timeTween.t / timeTween.duration));
        const state = timeOfDay();
        for (const key of ["ambient", "sun"]) {
            for (let i = 0; i < 3; i++) {
                state[key][i] = timeTween.from[key][i] + (timeTween.to[key][i] - timeTween.from[key][i]) * k;
            }
        }
        if (timeTween.t >= timeTween.duration) {
            timeTween = null;
        }
    }

    //-------------------------------------------------------------------------
    // Lights in the scene
    //-------------------------------------------------------------------------

    /**
     * @brief Owns the ambient light, sun and point light pool. The pool size
     *        never changes, so shaders never recompile while playing.
     */
    class LightRig {
        constructor(scene) {
            this.ambient = new THREE.AmbientLight(0xffffff, 0);
            this.sun = new THREE.DirectionalLight(0xffffff, 0);
            this.sun.shadow.mapSize.set(2048, 2048);
            this.sun.shadow.bias = -0.0005;
            this.points = [];
            for (let i = 0; i < CONFIG.maxLights; i++) {
                const light = new THREE.PointLight(0xffffff, 0, 1, 0);
                this.points.push(light);
                scene.add(light);
            }
            scene.add(this.ambient, this.sun, this.sun.target);
            this._color = new THREE.Color();
            this._v = new THREE.Vector3();
            this.frame = 0;
        }

        /**
         * @brief Configures the sun shadow camera to cover the whole map.
         * @param {ThreeMapView} view The 3D view.
         */
        setupMap(view) {
            const cfg = mapLighting();
            const W = $gameMap.width();
            const H = $gameMap.height();
            const center = new THREE.Vector3(W / 2, 0, H / 2);
            const radius = Math.hypot(W, H) / 2 + 2;
            this.sun.target.position.copy(center);
            this.sun.position.copy(center).addScaledVector(cfg.sunDirection, radius + 20);
            const cam = this.sun.shadow.camera;
            cam.left = cam.bottom = -radius;
            cam.right = cam.top = radius;
            cam.near = 1;
            cam.far = radius * 2 + 40;
            cam.updateProjectionMatrix();
            const shadows = cfg.enabled && cfg.shadows;
            this.sun.castShadow = shadows;
            if (view.renderer.shadowMap.enabled !== shadows) {
                view.renderer.shadowMap.enabled = shadows;
                view.renderer.shadowMap.needsUpdate = true;
            }
        }

        /**
         * @brief Collects the point lights on the map this frame.
         * @return {Object[]} {pos, color, intensity, radius, flicker}.
         */
        collectSources() {
            const sources = [];
            const cfg = mapLighting();
            const push = (args, x, z, baseHeight) => {
                sources.push({
                    pos: new THREE.Vector3(x, baseHeight + (Number(args.height) || 1), z),
                    color: Three.parseColor(args._[0], "#ffffff"),
                    intensity: args.intensity === undefined ? 1 : Number(args.intensity),
                    radius: Math.max(0.5, Number(args.radius) || 4),
                    flicker: !!args.flicker,
                });
            };
            for (const light of cfg.lights) {
                push(light.args, light.x + 0.5, light.y + 0.5, Three.heightAt(light.x, light.y));
            }
            for (const event of $gameMap.events()) {
                if (event._erased) {
                    continue;
                }
                const tag = Three.noteTag(Three.eventText(event), "Light");
                if (tag) {
                    const x = event._realX + 0.5;
                    const z = event._realY + 0.5;
                    push(tag, x, z, Three.heightAtWorld(x, z));
                }
            }
            return sources;
        }

        /**
         * @brief Updates every light and the billboard lighting uniforms.
         * @param {ThreeMapView} view The 3D view.
         */
        update(view) {
            this.frame++;
            const cfg = mapLighting();
            const u = Three.billboardUniforms;
            if (!cfg.enabled) {
                this.ambient.intensity = 0;
                this.sun.intensity = 0;
                for (const p of this.points) {
                    p.intensity = 0;
                }
                u.uAmbient.value.setRGB(1, 1, 1);
                u.uLightCount.value = 0;
                return;
            }
            const tod = cfg.timeOfDay ? timeOfDay() : { ambient: [1, 1, 1], sun: [1, 1, 1] };
            const ambient = cfg.ambientColor.clone();
            ambient.r *= tod.ambient[0];
            ambient.g *= tod.ambient[1];
            ambient.b *= tod.ambient[2];
            const sun = cfg.sunColor.clone();
            sun.r *= tod.sun[0];
            sun.g *= tod.sun[1];
            sun.b *= tod.sun[2];

            // three.js lights are physically based: intensity PI = albedo.
            this.ambient.color.copy(ambient);
            this.ambient.intensity = cfg.ambientIntensity * Math.PI;
            this.sun.color.copy(sun);
            this.sun.intensity = cfg.sunIntensity * Math.PI;

            // Billboards face the camera, so they get ambient plus the sun's
            // contribution on a flat, upward-tilted surface.
            const sunUp = Math.max(0, cfg.sunDirection.y);
            u.uAmbient.value.setRGB(
                ambient.r * cfg.ambientIntensity + sun.r * cfg.sunIntensity * sunUp,
                ambient.g * cfg.ambientIntensity + sun.g * cfg.sunIntensity * sunUp,
                ambient.b * cfg.ambientIntensity + sun.b * cfg.sunIntensity * sunUp
            );

            const look = Three.camera.look;
            const sources = this.collectSources();
            sources.sort((a, b) => a.pos.distanceToSquared(look) - b.pos.distanceToSquared(look));
            const count = Math.min(sources.length, this.points.length);
            for (let i = 0; i < this.points.length; i++) {
                const p = this.points[i];
                if (i >= count) {
                    p.intensity = 0;
                    continue;
                }
                const s = sources[i];
                let intensity = s.intensity;
                if (s.flicker) {
                    const t = this.frame;
                    intensity *= 0.85 + 0.15 * Math.sin(t * 0.31 + i * 1.7) * Math.sin(t * 0.13 + i);
                }
                p.position.copy(s.pos);
                p.color.copy(s.color);
                p.distance = s.radius;
                p.intensity = intensity * Math.PI;
                u.uLightPos.value[i].copy(s.pos);
                u.uLightColor.value[i].copy(s.color).multiplyScalar(intensity);
                u.uLightRange.value[i] = s.radius;
            }
            u.uLightCount.value = count;
        }
    }

    // Time of day advances on every map, 2D or 3D.
    const _Game_Map_update = Game_Map.prototype.update;
    Game_Map.prototype.update = function(sceneActive) {
        _Game_Map_update.call(this, sceneActive);
        updateTimeTween();
    };

    let rig = null;

    Three.addHook({
        onAttach(view) {
            if (!rig) {
                rig = new LightRig(view.scene);
            }
        },
        onMapBuilt(view) {
            if (rig) {
                rig.setupMap(view);
            }
        },
        onUpdate(view) {
            if (rig) {
                rig.update(view);
            }
        },
    });

    // Re-read lighting tags when the terrain is rebuilt by script.
    const _refreshTerrain = Three.refreshTerrain;
    Three.refreshTerrain = function() {
        if ($dataMap) {
            delete $dataMap._threeLighting;
        }
        _refreshTerrain.call(this);
    };
})();
