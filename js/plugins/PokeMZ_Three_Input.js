//=============================================================================
// PokéMZ - Three_Input.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.2.0] Mouse and touch input for 3D maps.
 * @author MagickaHat
 * @base PokeMZ_Three_Core
 * @orderAfter PokeMZ_Three_Core
 *
 * @param pickCharacters
 * @text Click Characters
 * @desc Clicking a character's sprite targets the tile it stands on, even
 * where the sprite overlaps tiles behind it.
 * @type boolean
 * @default true
 *
 * @help PokeMZ_Three_Input.js
 *
 * MZ converts a click or tap into a map tile with Game_Map.canvasToMapX/Y,
 * which assumes a flat top-down view. On 3D maps this addon instead casts a
 * ray from the camera through the pointer and finds what it hits:
 *
 *   1. Character sprites (topmost first), then
 *   2. 3D models placed by PokeMZ_Three_Models, then
 *   3. The terrain, including cliff walls and water.
 *
 * Everything built on canvasToMapX/Y then works unchanged: click/tap to
 * move, holding to keep walking, and touching events.
 *
 * Script: PokeMZ.Three.pick(screenX, screenY) returns {x, y} or null.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_Three_Input";
    const Three = window.PokeMZ && window.PokeMZ.Three;
    if (!Three) {
        throw new Error(`${PLUGIN_NAME} requires PokeMZ_Three_Core above it in the plugin list.`);
    }
    const params = PluginManager.parameters(PLUGIN_NAME);
    const PICK_CHARACTERS = Three.parseBool(params.pickCharacters, true);

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const feet = new THREE.Vector3();
    const screen = new THREE.Vector3();
    const point = new THREE.Vector3();
    const normal = new THREE.Vector3();

    /**
     * @brief Finds the topmost visible character under a screen point.
     * @param {ThreeMapView} view The 3D view.
     * @param {number} sx Screen X.
     * @param {number} sy Screen Y.
     * @return {{x: number, y: number}|null} Its tile, or null.
     */
    function pickCharacter(view, sx, sy) {
        let best = null;
        let bestDepth = Infinity;
        for (const billboard of view.billboards.values()) {
            if (!billboard.object.visible) {
                continue;
            }
            feet.copy(billboard.feet);
            view.worldToScreen(feet, screen);
            const ppu = view.pixelsPerUnitAt(feet);
            const w = billboard.size.x * ppu;
            const h = billboard.size.y * ppu;
            if (sx >= screen.x - w / 2 && sx <= screen.x + w / 2 && sy >= screen.y - h && sy <= screen.y) {
                if (screen.z < bestDepth) {
                    bestDepth = screen.z;
                    best = billboard.character;
                }
            }
        }
        return best ? { x: best.x, y: best.y } : null;
    }

    /**
     * @brief Walks up an object's parents looking for userData.pickTile.
     * @param {THREE.Object3D} obj The hit object.
     * @return {{x: number, y: number}|null} The tile.
     */
    function pickTileOf(obj) {
        for (let o = obj; o; o = o.parent) {
            if (o.userData && o.userData.pickTile) {
                return o.userData.pickTile;
            }
        }
        return null;
    }

    /**
     * @brief Converts a screen point into the map tile it shows.
     * @param {number} sx Screen X (MZ canvas pixels).
     * @param {number} sy Screen Y.
     * @return {{x: number, y: number}|null} The tile, or null on a miss.
     */
    function pick(sx, sy) {
        const view = Three.view;
        if (!Three.isActive() || !view.terrain) {
            return null;
        }
        if (PICK_CHARACTERS) {
            const hit = pickCharacter(view, sx, sy);
            if (hit) {
                return hit;
            }
        }
        ndc.set((sx / Graphics.width) * 2 - 1, -(sy / Graphics.height) * 2 + 1);
        raycaster.setFromCamera(ndc, view.camera);

        const targets = view.pickables.slice();
        for (const chunk of view.terrain.chunks) {
            for (const child of chunk.group.children) {
                if (child.userData.pickable) {
                    targets.push(child);
                }
            }
        }
        const hits = raycaster.intersectObjects(targets, true);
        for (const hit of hits) {
            const tile = pickTileOf(hit.object);
            if (tile) {
                return { x: tile.x, y: tile.y };
            }
            if (!hit.face) {
                continue;
            }
            // Step slightly into the surface, so a click on a cliff wall picks
            // the tile on top of that cliff.
            normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
            if (normal.dot(raycaster.ray.direction) > 0) {
                normal.negate();
            }
            point.copy(hit.point).addScaledVector(normal, -0.01);
            const x = Math.floor(point.x);
            const y = Math.floor(point.z);
            if ($gameMap.isValid(x, y)) {
                return { x, y };
            }
        }
        return null;
    }

    Three.pick = pick;

    /** @brief Per-frame cache, so X and Y share one raycast. */
    let cache = { key: "", tile: null };

    /**
     * @brief Picks the tile under (sx, sy), cached for the current frame.
     * @return {{x: number, y: number}} The tile (player tile on a miss).
     */
    function cachedPick(sx, sy) {
        const key = `${Graphics.frameCount}:${sx}:${sy}`;
        if (cache.key !== key) {
            cache = { key, tile: pick(sx, sy) || { x: $gamePlayer.x, y: $gamePlayer.y } };
        }
        return cache.tile;
    }

    const _Game_Map_canvasToMapX = Game_Map.prototype.canvasToMapX;
    Game_Map.prototype.canvasToMapX = function(x) {
        if (Three.isActive()) {
            return cachedPick(x, TouchInput.y).x;
        }
        return _Game_Map_canvasToMapX.call(this, x);
    };

    const _Game_Map_canvasToMapY = Game_Map.prototype.canvasToMapY;
    Game_Map.prototype.canvasToMapY = function(y) {
        if (Three.isActive()) {
            return cachedPick(TouchInput.x, y).y;
        }
        return _Game_Map_canvasToMapY.call(this, y);
    };
})();
