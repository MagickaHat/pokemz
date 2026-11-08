//=============================================================================
// PokéMZ - Three_Models.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.2.0] glTF buildings and props on 3D maps.
 * @author MagickaHat
 * @base PokeMZ_Three_Core
 * @orderAfter PokeMZ_Three_Core
 *
 * @param folder
 * @text Model Folder
 * @desc Folder (relative to the game) that model paths start from.
 * @type string
 * @default models/
 *
 * @param castShadows
 * @text Models Cast Shadows
 * @desc Used when PokeMZ_Three_Lighting has sun shadows enabled.
 * @type boolean
 * @default true
 *
 * @param pixelTextures
 * @text Pixel Art Textures
 * @desc Force nearest-neighbour filtering on model textures.
 * @type boolean
 * @default true
 *
 * @help PokeMZ_Three_Models.js
 *
 * Place .glb / .gltf files in the model folder (default: models/).
 * One world unit = one tile; the model's origin is placed on the ground at
 * the centre of its tile, and +Z faces south (towards the default camera).
 *
 * ---------------------------------------------------------------------------
 * Map note (static buildings and props, as many lines as you like)
 * ---------------------------------------------------------------------------
 *   <3D Model: house.glb x=5 y=8 rot=90 scale=1 block=4x3>
 *
 *   x, y        Tile the model stands on (required).
 *   rot         Rotation around the vertical axis, in degrees.
 *   scale       Uniform scale, or sx,sy,sz.
 *   ox oy oz    Offset in tiles (oy = up).
 *   block=WxH   Makes a W x H footprint impassable, anchored at its
 *               bottom-centre tile (x, y).
 *   door        Leaves tile (x, y) itself walkable, e.g. a house door:
 *                 <3D Model: house.glb x=5 y=8 block=4x3 door>
 *   anim=name   Animation clip to loop (default: the first one, if any).
 *   noanim      Don't play any animation.
 *
 * ---------------------------------------------------------------------------
 * Event comment / note (on the active page)
 * ---------------------------------------------------------------------------
 *   <3D Model: pokeball.glb scale=0.5 turn>
 *
 *   The model follows the event (including jumps) and replaces its sprite.
 *   turn        Rotate with the event's facing direction.
 *   keepSprite  Draw the event's sprite as well.
 *   rot, scale, ox, oy, oz, anim, noanim as above.
 *
 * Switching pages swaps or removes the model automatically.
 *
 * Deployment: RPG Maker's "Exclude unused files" can't see model files, so
 * make sure the model folder is copied with your game.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_Three_Models";
    const Three = window.PokeMZ && window.PokeMZ.Three;
    if (!Three) {
        throw new Error(`${PLUGIN_NAME} requires PokeMZ_Three_Core above it in the plugin list.`);
    }
    if (!THREE.GLTFLoader) {
        throw new Error(`${PLUGIN_NAME} requires js/libs/three-addons.js (loaded by main.js).`);
    }
    const params = PluginManager.parameters(PLUGIN_NAME);

    /** @brief Plugin settings. */
    const CONFIG = {
        folder: (params.folder || "models/").replace(/\/?$/, "/"),
        castShadows: Three.parseBool(params.castShadows, true),
        pixelTextures: Three.parseBool(params.pixelTextures, true),
    };

    const loader = new THREE.GLTFLoader();
    /** @brief path -> Promise<gltf>, for models without skinning. */
    const cache = new Map();

    /**
     * @brief Loads a glTF file (cached).
     * @param {string} path Path relative to the model folder.
     * @param {boolean} fresh Skip the cache (needed for skinned models).
     * @return {Promise<Object>} The parsed glTF.
     */
    function loadGltf(path, fresh) {
        const url = CONFIG.folder + path;
        if (fresh) {
            return loader.loadAsync(url);
        }
        if (!cache.has(url)) {
            cache.set(url, loader.loadAsync(url));
        }
        return cache.get(url);
    }

    /** @brief Source material -> converted material, per lighting mode. */
    let materialCache = new Map();

    /**
     * @brief Converts a glTF material to a pixel-art friendly one that
     *        matches the terrain (unlit, or Lambert with the Lighting addon).
     * @param {THREE.Material} source The glTF material.
     * @return {THREE.Material} The replacement.
     */
    function convertMaterial(source) {
        let out = materialCache.get(source);
        if (out) {
            return out;
        }
        if (source.map && CONFIG.pixelTextures) {
            source.map.magFilter = THREE.NearestFilter;
            source.map.minFilter = THREE.NearestFilter;
            source.map.generateMipmaps = false;
            source.map.needsUpdate = true;
        }
        out = Three.createSurfaceMaterial({
            map: source.map || null,
            color: source.color ? source.color.clone() : new THREE.Color(1, 1, 1),
            transparent: source.transparent,
            opacity: source.opacity,
            alphaTest: source.alphaTest || (source.map ? 0.5 : 0),
            side: source.side,
            vertexColors: source.vertexColors,
        });
        out.name = source.name;
        materialCache.set(source, out);
        return out;
    }

    /**
     * @brief Parses "1" or "1,2,1" into a scale vector.
     * @param {*} value The argument.
     * @return {THREE.Vector3} The scale.
     */
    function parseScale(value) {
        const parts = String(value === undefined || value === true ? "1" : value).split(",").map(Number);
        if (parts.length === 3 && parts.every(n => !isNaN(n))) {
            return new THREE.Vector3(parts[0], parts[1], parts[2]);
        }
        const s = isNaN(parts[0]) ? 1 : parts[0];
        return new THREE.Vector3(s, s, s);
    }

    /**
     * @brief One placed model: an outer group positioned by us, containing
     *        the glTF scene (rotated/scaled/offset by the tag arguments).
     */
    class ModelInstance {
        /**
         * @param {Object} args Parsed note tag arguments.
         */
        constructor(args) {
            this.args = args;
            this.path = args._[0];
            this.group = new THREE.Group();
            this.inner = new THREE.Group();
            this.inner.rotation.y = THREE.MathUtils.degToRad(Number(args.rot) || 0);
            this.inner.scale.copy(parseScale(args.scale));
            this.inner.position.set(Number(args.ox) || 0, Number(args.oy) || 0, Number(args.oz) || 0);
            this.group.add(this.inner);
            this.mixer = null;
            this.disposed = false;
            this.ready = this._load();
        }

        /** @brief Loads and attaches the model. */
        async _load() {
            if (!this.path) {
                return;
            }
            let gltf;
            try {
                gltf = await loadGltf(this.path, false);
                const skinned = [];
                gltf.scene.traverse(o => o.isSkinnedMesh && skinned.push(o));
                if (skinned.length > 0) {
                    gltf = await loadGltf(this.path, true);
                }
            } catch (e) {
                console.error(`${PLUGIN_NAME}: could not load ${CONFIG.folder + this.path}`, e);
                return;
            }
            if (this.disposed) {
                return;
            }
            const scene = gltf.scene.clone(true);
            scene.traverse(o => {
                if (o.isMesh) {
                    o.material = Array.isArray(o.material) ? o.material.map(convertMaterial) : convertMaterial(o.material);
                    o.castShadow = CONFIG.castShadows;
                    o.receiveShadow = true;
                }
            });
            this.inner.add(scene);
            if (gltf.animations.length > 0 && !this.args.noanim) {
                const clip = this.args.anim
                    ? THREE.AnimationClip.findByName(gltf.animations, this.args.anim)
                    : gltf.animations[0];
                if (clip) {
                    this.mixer = new THREE.AnimationMixer(scene);
                    this.mixer.clipAction(clip).play();
                }
            }
        }

        /** @brief Advances the animation one frame. */
        update() {
            if (this.mixer) {
                this.mixer.update(1 / 60);
            }
        }

        /** @brief Removes the model (cached geometry is kept). */
        dispose() {
            this.disposed = true;
            if (this.group.parent) {
                this.group.parent.remove(this.group);
            }
            if (this.mixer) {
                this.mixer.stopAllAction();
            }
        }
    }

    //-------------------------------------------------------------------------
    // Footprints (gameplay; works even before anything is drawn)
    //-------------------------------------------------------------------------

    /**
     * @brief The `<3D Model>` tags of the current map note.
     * @return {Object[]} Parsed tags.
     */
    function mapModelTags() {
        if (!$dataMap) {
            return [];
        }
        if (!$dataMap._threeModels) {
            $dataMap._threeModels = Three.noteTags($dataMap.note, "Model");
        }
        return $dataMap._threeModels;
    }

    /**
     * @brief Tiles blocked by model footprints on the current map.
     * @return {Set<number>} Tile indices (y * width + x).
     */
    function blockedTiles() {
        if (!$dataMap) {
            return new Set();
        }
        if ($dataMap._threeBlocked) {
            return $dataMap._threeBlocked;
        }
        const set = new Set();
        const W = $gameMap.width();
        for (const args of mapModelTags()) {
            const m = String(args.block || "").match(/^(\d+)x(\d+)$/i);
            if (!m) {
                continue;
            }
            const w = Number(m[1]);
            const h = Number(m[2]);
            const x = Number(args.x) || 0;
            const y = Number(args.y) || 0;
            const left = x - Math.floor((w - 1) / 2);
            for (let ty = y - h + 1; ty <= y; ty++) {
                for (let tx = left; tx < left + w; tx++) {
                    if (args.door && tx === x && ty === y) {
                        continue;
                    }
                    if ($gameMap.isValid(tx, ty)) {
                        set.add(ty * W + tx);
                    }
                }
            }
        }
        $dataMap._threeBlocked = set;
        return set;
    }

    const _Game_Map_checkPassage = Game_Map.prototype.checkPassage;
    Game_Map.prototype.checkPassage = function(x, y, bit) {
        if (Three.isMap3D() && blockedTiles().has(y * this.width() + x)) {
            return false;
        }
        return _Game_Map_checkPassage.call(this, x, y, bit);
    };

    //-------------------------------------------------------------------------
    // Scene management
    //-------------------------------------------------------------------------

    /** @brief Facing direction to rotation (+Z = facing down/south). */
    const DIRECTION_ANGLE = { 2: 0, 4: -Math.PI / 2, 6: Math.PI / 2, 8: Math.PI };

    /** @brief Models manager, shared by all maps. */
    const models = {
        group: new THREE.Group(),
        statics: [],
        /** @brief Game_Event -> {key, instance}. */
        events: new Map(),

        /** @brief Places the current map's note models. */
        buildStatics(view) {
            this.clear(view);
            materialCache = new Map();
            for (const args of mapModelTags()) {
                const instance = new ModelInstance(args);
                const x = Number(args.x) || 0;
                const y = Number(args.y) || 0;
                Three.tileToWorld(x, y, instance.group.position);
                instance.group.userData.pickTile = { x, y };
                this.group.add(instance.group);
                this.statics.push(instance);
            }
            view.pickables.push(this.group);
        },

        /** @brief Removes every model. */
        clear(view) {
            for (const instance of this.statics) {
                instance.dispose();
            }
            this.statics = [];
            for (const [event, entry] of this.events) {
                entry.instance.dispose();
                event._threeHideSprite = false;
            }
            this.events.clear();
            if (view) {
                view.pickables = view.pickables.filter(o => o !== this.group);
            }
        },

        /** @brief Adds, swaps and moves event models. */
        updateEvents() {
            const seen = new Set();
            const th = $gameMap.tileHeight();
            for (const event of $gameMap.events()) {
                const tag = event._erased ? null : Three.noteTag(Three.eventText(event), "Model");
                const key = tag ? tag.raw : "";
                let entry = this.events.get(event);
                if (entry && entry.key !== key) {
                    entry.instance.dispose();
                    event._threeHideSprite = false;
                    this.events.delete(event);
                    entry = null;
                }
                if (!tag) {
                    continue;
                }
                seen.add(event);
                if (!entry) {
                    entry = { key, instance: new ModelInstance(tag) };
                    this.events.set(event, entry);
                    this.group.add(entry.instance.group);
                }
                const g = entry.instance.group;
                const x = event._realX + 0.5;
                const z = event._realY + 0.5;
                g.position.set(x, Three.heightAtWorld(x, z) + event.jumpHeight() / th, z);
                g.rotation.y = tag.turn ? DIRECTION_ANGLE[event.direction()] || 0 : 0;
                g.userData.pickTile = { x: event.x, y: event.y };
                event._threeHideSprite = !tag.keepsprite;
            }
            for (const [event, entry] of this.events) {
                if (!seen.has(event)) {
                    entry.instance.dispose();
                    event._threeHideSprite = false;
                    this.events.delete(event);
                }
            }
        },
    };

    Three.models = models;

    Three.addHook({
        onAttach(view) {
            if (!models.group.parent) {
                view.scene.add(models.group);
            }
        },
        onMapBuilt(view) {
            models.buildStatics(view);
        },
        onMapDispose(view) {
            models.clear(view);
        },
        onUpdate() {
            models.updateEvents();
            for (const instance of models.statics) {
                instance.update();
            }
            for (const entry of models.events.values()) {
                entry.instance.update();
            }
        },
    });
})();
