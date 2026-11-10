//=============================================================================
// PokéMZ - Three_Effects.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.2.0] Re-attaches balloons, animations and the destination
 * marker to characters on 3D maps.
 * @author MagickaHat
 * @base PokeMZ_Three_Core
 * @orderAfter PokeMZ_Three_Core
 *
 * @param scaleBalloons
 * @text Scale Balloons With Distance
 * @desc Balloon icons grow and shrink with the 3D view like the character.
 * @type boolean
 * @default true
 *
 * @param destinationColor
 * @text Destination Marker Color
 * @type string
 * @default #ffffff
 *
 * @help PokeMZ_Three_Effects.js
 *
 * On 3D maps the 2D character sprites are hidden but kept alive. This addon
 * moves each hidden sprite to where its 3D billboard appears on screen, and
 * scales it to the billboard's on-screen size (always 1 with the core's
 * Pixel-Perfect Billboards, so overlays stay on the pixel grid). Everything MZ (or another
 * plugin) attaches to a character sprite therefore lines up again:
 *
 *   - Balloon icons
 *   - Animations (Effekseer and MV-style)
 *   - Name labels, damage popups etc. from other plugins that follow the
 *     character sprite's x / y
 *
 * The touch destination marker is redrawn as a pulsing square on the 3D
 * ground.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_Three_Effects";
    const Three = window.PokeMZ && window.PokeMZ.Three;
    if (!Three) {
        throw new Error(`${PLUGIN_NAME} requires PokeMZ_Three_Core above it in the plugin list.`);
    }
    const params = PluginManager.parameters(PLUGIN_NAME);
    const SCALE_BALLOONS = Three.parseBool(params.scaleBalloons, true);
    const DEST_COLOR = Three.parseColor(params.destinationColor || "#ffffff");

    const _world = new THREE.Vector3();
    const _screen = new THREE.Vector3();

    /**
     * @brief Whether a character sprite belongs to the spriteset the 3D view
     *        is currently drawing.
     * @param {Sprite_Character} sprite The sprite.
     * @return {boolean} True if it should be projected.
     */
    function isProjected(sprite) {
        const view = Three.view;
        return !!(Three.isActive() && view.spriteset && sprite.parent === view.spriteset._tilemap);
    }

    /**
     * @brief Feet position of a character in world space.
     * @param {Game_CharacterBase} c The character.
     * @param {THREE.Vector3} out Receives the point.
     * @return {THREE.Vector3} `out`.
     */
    function characterFeet(c, out) {
        const tpu = Three.config.texelsPerUnit;
        const x = c._realX + 0.5;
        const z = c._realY + 0.5;
        let y = Three.heightAtWorld(x, z) + c.jumpHeight() / tpu;
        if (c instanceof Game_Vehicle) {
            y += c._altitude / tpu;
        }
        return out.set(x, y, z);
    }

    //-------------------------------------------------------------------------
    // Sprite_Character: follow the billboard on screen
    //-------------------------------------------------------------------------

    const _Sprite_Character_updatePosition = Sprite_Character.prototype.updatePosition;
    Sprite_Character.prototype.updatePosition = function() {
        _Sprite_Character_updatePosition.call(this);
        if (isProjected(this)) {
            const view = Three.view;
            characterFeet(this._character, _world);
            view.worldToScreen(_world, _screen);
            this.x = Math.round(_screen.x);
            this.y = Math.round(_screen.y);
            // Pixel-perfect billboards are always one texel per game pixel,
            // so their 2D overlays (balloons) stay unscaled too.
            const k = Three.config.billboardPixelScale ? 1 : view.pixelsPerUnitAt(_world) / Three.config.texelsPerUnit;
            this.scale.set(k, k);
            this._threeProjected = true;
        } else if (this._threeProjected) {
            this.scale.set(1, 1);
            this._threeProjected = false;
        }
    };

    //-------------------------------------------------------------------------
    // Sprite_Balloon: scale with the character
    //-------------------------------------------------------------------------

    const _Sprite_Balloon_updatePosition = Sprite_Balloon.prototype.updatePosition;
    Sprite_Balloon.prototype.updatePosition = function() {
        _Sprite_Balloon_updatePosition.call(this);
        if (SCALE_BALLOONS && this._target && this._target._threeProjected) {
            this.scale.set(this._target.scale.x, this._target.scale.y);
        } else if (this.scale.x !== 1) {
            this.scale.set(1, 1);
        }
    };

    //-------------------------------------------------------------------------
    // Destination marker in 3D
    //-------------------------------------------------------------------------

    /**
     * @brief Pulsing square on the ground at the touch destination, matching
     *        Sprite_Destination's look.
     */
    class DestinationMarker {
        constructor() {
            const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
            this.material = new THREE.MeshBasicMaterial({
                color: DEST_COLOR,
                transparent: true,
                opacity: 0.5,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                polygonOffset: true,
                polygonOffsetFactor: -4,
                polygonOffsetUnits: -4,
            });
            this.mesh = new THREE.Mesh(geo, this.material);
            this.mesh.renderOrder = 1;
            this.mesh.visible = false;
            this.frameCount = 0;
        }

        /** @brief Follows $gameTemp's destination and animates. */
        update() {
            if (!$gameTemp.isDestinationValid()) {
                this.mesh.visible = false;
                this.frameCount = 0;
                return;
            }
            const x = $gameTemp.destinationX();
            const y = $gameTemp.destinationY();
            Three.tileToWorld(x, y, this.mesh.position);
            this.mesh.position.y = Three.heightAtWorld(x + 0.5, y + 0.5) + 0.02;
            this.frameCount = (this.frameCount + 1) % 20;
            const s = 1 + this.frameCount / 20;
            this.mesh.scale.set(s, 1, s);
            this.material.opacity = (0.5 * (20 - this.frameCount)) / 20;
            this.mesh.visible = true;
        }

        /** @brief Frees GPU resources. */
        dispose() {
            this.mesh.geometry.dispose();
            this.material.dispose();
        }
    }

    let marker = null;

    Three.addHook({
        onAttach(view) {
            if (!marker) {
                marker = new DestinationMarker();
                view.scene.add(marker.mesh);
            }
        },
        onUpdate() {
            if (marker) {
                marker.update();
            }
        },
    });
})();
