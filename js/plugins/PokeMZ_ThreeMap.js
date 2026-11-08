//=============================================================================
// PokéMZ - ThreeMap.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Three.js 3D map renderer.
 * @author MagickaHat
 * 
 * @param pitch
 * @text Camera Pitch (degrees)
 * @desc Angle of the camera above the ground. 90 = straight down.
 * @type number
 * @min 10
 * @max 89
 * @default 55
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
 * @param regionHeight
 * @text Height per Region ID (tiles)
 * @desc A tile with region ID n is raised n * this value.
 * @type number
 * @deciamsl 2
 * @default 0.5
 * 
 * @help PokeMZ_ThreeMap.js
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_ThreeMap";

    const params = PluginManager.parameters(PLUGIN_NAME);

    /** @brief Plugin settings parsed from the plugin parameters. */
    const CONFIG = {
        pitch: THREE.MathUtils.degToRad(Number(params.pitch || 55)),
        distance: Number(params.distance || 14),
        fov: Number(params.fov || 30),
        regionHeight: Number(params.regionHeight || 0.5),
    };

    /**
     * @brief Whether the current map should be rendered in 3D.
     * @return {boolean} True if the map has the <3D> note tag.
     */
    function is3DMap() {
        return !!($dataMap && $dataMap.meta && $dataMap.meta["3D"]);
    }

    /**
     * @brief Ground height of a tile, in tile units.
     * @param {number} x Tile X (clamped to the map).
     * @param {number} y Tile Y (clamped to the map).
     * @return {number} Height derived from the tile's region ID.
     */
    function heightAt(x, y) {
        const cx = x.clamp(0, $gameMap.width() - 1);
        const cy = y.clamp(0, $gameMap.height() - 1);
    }

    /**
     * @brief Draws the whole map once with MZ's Tilemap and returns it.
     * 
     * Using MZ's renderer means autotiles come out correct without
     * reimplementing autotile shape logic.
     * 
     * @param {Tilemap} sourceTilemap The spriteset's tilemap (for its bitmaps).
     */
    function bakeMapToCanvas(sourceTilemap) {
        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        const pw = $gameMap.width() * tw;
        const ph = $gameMap.height() * th;
 
        const tilemap = new Tilemap();
        tilemap.tileWidth = tw;
        tilemap.tileHeight = th;
        tilemap.width = pw;
        tilemap.height = ph;
        tilemap.setData($gameMap.width(), $gameMap.height(), $gameMap.data());
        tilemap.setBitmaps(sourceTilemap._bitmaps);
        tilemap.flags = $gameMap.tilesetFlags();
 
        const renderer = Graphics.app.renderer;
        const rt = PIXI.RenderTexture.create({ width: pw, height: ph });
        renderer.render(tilemap, rt);
        const canvas = renderer.extract.canvas(rt);
 
        rt.destroy(true);
        tilemap.destroy();
        return canvas;
    }

    /**
     * @brief Builds the ground mesh: one top quad per tile, plus cliff walls
     *        where a neighboring tile is lower.
     * 
     * World space: X = tile x, Z = tile y, Y = up. One tile = one unit.
     * 
     * @param {HTMLCanvasElement} canvas Baked map image from bakeMapToCanvas().
     * @return {THREE.Mesh} The ground mesh.
     */
    function buildGroundMesh(canvas) {
        const W = $gameMap.width();
        const H = $gameMap.height();
        const positions = [];
        const uvs = [];
        const indices = [];
 
        // a b
        // d c  (as seen in the tile image); UVs map tile (x, y) of the bake.
        const quad = (a, b, c, d, x, y) => {
            const u0 = x / W;
            const u1 = (x + 1) / W;
            const vTop = 1 - y / H;
            const vBot = 1 - (y + 1) / H;
            const i = positions.length / 3;
            positions.push(...a, ...b, ...c, ...d);
            uvs.push(u0, vTop, u1, vTop, u1, vBot, u0, vBot);
            indices.push(i, i + 3, i + 1, i + 1, i + 3, i + 2);
        };
 
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const h = heightAt(x, y);
                quad([x, h, y], [x + 1, h, y], [x + 1, h, y + 1], [x, h, y + 1], x, y);
 
                // Walls reuse the tile's own image, stretched. Good enough
                // until dedicated wall textures exist. North walls are skipped
                // because the camera never sees them.
                const hs = heightAt(x, y + 1);
                if (hs < h) {
                    quad([x, h, y + 1], [x + 1, h, y + 1], [x + 1, hs, y + 1], [x, hs, y + 1], x, y);
                }
                const he = heightAt(x + 1, y);
                if (he < h) {
                    quad([x + 1, h, y + 1], [x + 1, h, y], [x + 1, he, y], [x + 1, he, y + 1], x, y);
                }
                const hw = heightAt(x - 1, y);
                if (hw < h) {
                    quad([x, h, y], [x, h, y + 1], [x, hw, y + 1], [x, hw, y], x, y);
                }
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.colorSpace = THREE.SRGBColorSpace;
 
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
 
        const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        return new THREE.Mesh(geometry, material);
    }

    /**
     * @brief A camera-facing 3D sprite that mirrors one Sprite_Character.
     * 
     * MZ keeps updating the 2D sprite (frame, visibility, opacity); this class only
     * copies that state into 3D every frame.
     */
    class CharacterBillboard {
        /**
         * @param {Sprite_Character} mzSprite The 2D sprite to mirror.
         */
        constructor(mzSprite) {
            this.mzSprite = mzSprite;
            this.material = new THREE.SpriteMaterial({ alphaTest: 0.5 });
            this.object = new THREE.Sprite(this.material);
            this.object.center.set(0.5, 0); // anchor at the feet
            this._bitmap = null;
        }
 
        /** @brief Syncs texture frame, position and visibility from MZ. */
        update() {
            const s = this.mzSprite;
            const c = s._character;
            const bitmap = s.bitmap;
            const frame = s._frame;
            const ready = bitmap && bitmap.isReady() && frame.width > 0 && c.tileId() === 0;
 
            this.object.visible = !!(ready && s.visible && s.opacity > 0);
            if (!this.object.visible) {
                return;
            }
            if (bitmap !== this._bitmap) {
                this._setBitmap(bitmap);
            }
 
            const iw = bitmap.width;
            const ih = bitmap.height;
            const tex = this.material.map;
            tex.repeat.set(frame.width / iw, frame.height / ih);
            tex.offset.set(frame.x / iw, 1 - (frame.y + frame.height) / ih);
 
            const tw = $gameMap.tileWidth();
            const th = $gameMap.tileHeight();
            this.object.scale.set(frame.width / tw, frame.height / th, 1);
 
            const ground = heightAt(Math.round(c._realX), Math.round(c._realY));
            this.object.position.set(
                c._realX + 0.5,
                ground + c.jumpHeight() / th,
                c._realY + 0.5
            );
            this.material.opacity = s.opacity / 255;
        }
 
        /**
         * @brief Creates a Three.js texture for a character sheet.
         * @note Each billboard uploads its own texture. Caching per Bitmap is
         *       an easy later optimization.
         * @param {Bitmap} bitmap The character sheet.
         */
        _setBitmap(bitmap) {
            if (this.material.map) {
                this.material.map.dispose();
            }
            const tex = new THREE.Texture(bitmap._canvas || bitmap._image);
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
            tex.generateMipmaps = false;
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            this.material.map = tex;
            this.material.needsUpdate = true;
            this._bitmap = bitmap;
        }
 
        /** @brief Frees GPU resources. */
        dispose() {
            if (this.material.map) {
                this.material.map.dispose();
            }
            this.material.dispose();
        }
    }
 
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
                alpha: true,                 // lets MZ's parallax show as the sky
                antialias: false,
                preserveDrawingBuffer: true, // canvas is read by PIXI after rendering
            });
            this.renderer.setPixelRatio(1);
            this.renderer.setClearColor(0x000000, 0);
 
            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(CONFIG.fov, 1, 0.1, 500);
 
            this.pixiTexture = PIXI.Texture.from(this.canvas);
            this.pixiSprite = new PIXI.Sprite(this.pixiTexture);
 
            this.spriteset = null;
            this.ground = null;
            this.groundMapId = 0;
            this.billboards = [];
            this._camY = 0;
            this.resize(Graphics.width, Graphics.height);
        }
 
        /**
         * @brief Matches the render size to MZ's screen.
         * @param {number} width Screen width in pixels.
         * @param {number} height Screen height in pixels.
         */
        resize(width, height) {
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
 
        /**
         * @brief Inserts the 3D view into a Spriteset_Map, just above the
         *        tilemap, so MZ's tone, weather and fades still apply.
         * @param {Spriteset_Map} spriteset The map's spriteset.
         */
        attach(spriteset) {
            this.detach();
            this.spriteset = spriteset;
 
            const base = spriteset._baseSprite;
            base.addChildAt(this.pixiSprite, base.getChildIndex(spriteset._tilemap) + 1);
            spriteset._tilemap.visible = false; // hides 2D tiles and 2D characters
 
            for (const sprite of spriteset._characterSprites) {
                const billboard = new CharacterBillboard(sprite);
                this.billboards.push(billboard);
                this.scene.add(billboard.object);
            }
            this._camY = heightAt($gamePlayer.x, $gamePlayer.y);
        }
 
        /**
         * @brief Removes the view from its spriteset. Must run before MZ
         *        destroys the scene, or PIXI would destroy our shared texture.
         */
        detach() {
            if (this.pixiSprite.parent) {
                this.pixiSprite.parent.removeChild(this.pixiSprite);
            }
            for (const billboard of this.billboards) {
                this.scene.remove(billboard.object);
                billboard.dispose();
            }
            this.billboards = [];
            this.spriteset = null;
        }
 
        /**
         * @brief Builds the ground for the current map once its tilesets load.
         * @return {boolean} True if the ground is ready to draw.
         */
        ensureGround() {
            const mapId = $gameMap.mapId();
            if (this.ground && this.groundMapId === mapId) {
                return true;
            }
            const tilemap = this.spriteset._tilemap;
            if (!tilemap._bitmaps.every(b => !b || b.isReady())) {
                return false;
            }
            if (this.ground) {
                this.scene.remove(this.ground);
                this.ground.geometry.dispose();
                this.ground.material.map.dispose();
                this.ground.material.dispose();
            }
            this.ground = buildGroundMesh(bakeMapToCanvas(tilemap));
            this.scene.add(this.ground);
            this.groundMapId = mapId;
            return true;
        }
 
        /** @brief Called once per frame after MZ updates its sprites. */
        update() {
            if (!this.spriteset || !this.ensureGround()) {
                this.pixiSprite.visible = false;
                return;
            }
            this.pixiSprite.visible = true;
 
            if (this.canvas.width !== Graphics.width || this.canvas.height !== Graphics.height) {
                this.resize(Graphics.width, Graphics.height);
            }
            for (const billboard of this.billboards) {
                billboard.update();
            }
            this.updateCamera();
 
            this.renderer.render(this.scene, this.camera);
            this.pixiTexture.update(); // re-upload the canvas to PIXI
        }
 
        /** @brief Follows the player at a fixed pitch and distance. */
        updateCamera() {
            const p = $gamePlayer;
            const tx = p._realX + 0.5;
            const tz = p._realY + 0.5;
            const ty = heightAt(Math.round(p._realX), Math.round(p._realY));
            this._camY += (ty - this._camY) * 0.15; // ease over height changes
 
            this.camera.position.set(
                tx,
                this._camY + Math.sin(CONFIG.pitch) * CONFIG.distance,
                tz + Math.cos(CONFIG.pitch) * CONFIG.distance
            );
            this.camera.lookAt(tx, this._camY, tz);
        }
    }
 
    /** @brief The single shared view, created on first use. */
    let view = null;
 
    /** @return {ThreeMapView} The shared view. */
    function getView() {
        if (!view) {
            view = new ThreeMapView();
        }
        return view;
    }
 
    //-------------------------------------------------------------------------
    // Spriteset_Map hooks
    //-------------------------------------------------------------------------
 
    const _Spriteset_Map_createLowerLayer = Spriteset_Map.prototype.createLowerLayer;
    Spriteset_Map.prototype.createLowerLayer = function() {
        _Spriteset_Map_createLowerLayer.call(this);
        if (is3DMap()) {
            getView().attach(this);
        }
    };
 
    const _Spriteset_Map_update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function() {
        _Spriteset_Map_update.call(this);
        if (view && view.spriteset === this) {
            view.update();
        }
    };
 
    const _Spriteset_Map_destroy = Spriteset_Map.prototype.destroy;
    Spriteset_Map.prototype.destroy = function(options) {
        if (view && view.spriteset === this) {
            view.detach();
        }
        _Spriteset_Map_destroy.call(this, options);
    };
})();
