//=============================================================================
// PokéMZ - Three_Movement.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.2.0] Height-aware passability and ledges.
 * @author MagickaHat
 * @base PokeMZ_Three_Core
 * @orderAfter PokeMZ_Three_Core
 *
 * @param maxStep
 * @text Max Step Height (tiles)
 * @desc On 3D maps, characters can't walk between tiles whose touching
 * edges differ by more than this. Ramps always connect smoothly.
 * @type number
 * @decimals 2
 * @default 0.3
 *
 * @param ledgeTag
 * @text Ledge Terrain Tag
 * @desc Tiles with this terrain tag are ledges the player hops over.
 * 0 = disabled. Mark ledge tiles impassable in the tileset.
 * @type number
 * @min 0
 * @max 7
 * @default 6
 *
 * @param ledgeDirection
 * @text Default Ledge Direction
 * @desc Hop direction on flat ground (2D maps, or 3D ledges without a
 * height drop).
 * @type select
 * @option down
 * @value 2
 * @option left
 * @value 4
 * @option right
 * @value 6
 * @option up
 * @value 8
 * @default 2
 *
 * @param ledgesIn2D
 * @text Ledges On 2D Maps
 * @desc Also allow ledge hops on maps without <3D>.
 * @type boolean
 * @default true
 *
 * @param ledgeSe
 * @text Ledge Sound
 * @type file
 * @dir audio/se
 * @default Jump1
 *
 * @help PokeMZ_Three_Movement.js
 *
 * Height-aware movement (3D maps only)
 *   Each tile's edges have a height (see PokeMZ_Three_Core). A move is
 *   blocked when the edge you leave and the edge you enter differ by more
 *   than "Max Step Height", so cliffs block walking while ramps don't.
 *   Vehicles and "Through" characters ignore heights.
 *
 * Ledges
 *   Give ledge tiles the "Ledge Terrain Tag" and make them impassable.
 *   Walking into a ledge hops the player (and followers) two tiles over it,
 *   if the landing tile is free. On 3D maps the player may only hop towards
 *   lower ground; on flat ground the "Default Ledge Direction" is used.
 *   Map note <3D LedgeDirection: 4> changes that direction for one map.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_Three_Movement";
    const Three = window.PokeMZ && window.PokeMZ.Three;
    if (!Three) {
        throw new Error(`${PLUGIN_NAME} requires PokeMZ_Three_Core above it in the plugin list.`);
    }
    const params = PluginManager.parameters(PLUGIN_NAME);

    /** @brief Plugin settings. */
    const CONFIG = {
        maxStep: Number(params.maxStep || 0.3),
        ledgeTag: Number(params.ledgeTag || 6),
        ledgeDirection: Number(params.ledgeDirection || 2),
        ledgesIn2D: Three.parseBool(params.ledgesIn2D, true),
        ledgeSe: params.ledgeSe === undefined ? "Jump1" : params.ledgeSe,
    };

    /**
     * @brief Whether moving from (x, y) in direction d is allowed by height.
     * @param {number} x Start tile X.
     * @param {number} y Start tile Y.
     * @param {number} d Direction.
     * @return {boolean} True if the step is small enough.
     */
    function heightAllows(x, y, d) {
        if (!Three.isMap3D()) {
            return true;
        }
        const hf = Three.heights();
        const x2 = $gameMap.roundXWithDirection(x, d);
        const y2 = $gameMap.roundYWithDirection(y, d);
        if (!hf || !$gameMap.isValid(x2, y2)) {
            return true;
        }
        const from = hf.edgeHeight(x, y, d);
        const to = hf.edgeHeight(x2, y2, 10 - d);
        return Math.abs(from - to) <= CONFIG.maxStep + 1e-4;
    }

    Three.heightAllows = heightAllows;

    const _Game_CharacterBase_isMapPassable = Game_CharacterBase.prototype.isMapPassable;
    Game_CharacterBase.prototype.isMapPassable = function(x, y, d) {
        return _Game_CharacterBase_isMapPassable.call(this, x, y, d) && heightAllows(x, y, d);
    };

    //-------------------------------------------------------------------------
    // Ledges
    //-------------------------------------------------------------------------

    /**
     * @brief The flat-ground hop direction for the current map.
     * @return {number} Direction.
     */
    function flatLedgeDirection() {
        const tag = Three.noteTag($dataMap && $dataMap.note, "LedgeDirection");
        return tag ? Number(tag._[0]) || CONFIG.ledgeDirection : CONFIG.ledgeDirection;
    }

    /**
     * @brief Whether the player can hop a ledge in direction d.
     * @param {Game_Player} player The player.
     * @param {number} d Direction.
     * @return {boolean} True if a hop should happen.
     */
    function canHopLedge(player, d) {
        if (CONFIG.ledgeTag <= 0 || player.isInVehicle() || player.isThrough()) {
            return false;
        }
        const is3D = Three.isMap3D();
        if (!is3D && !CONFIG.ledgesIn2D) {
            return false;
        }
        const x = player.x;
        const y = player.y;
        const x1 = $gameMap.roundXWithDirection(x, d);
        const y1 = $gameMap.roundYWithDirection(y, d);
        const x2 = $gameMap.roundXWithDirection(x1, d);
        const y2 = $gameMap.roundYWithDirection(y1, d);
        if (!$gameMap.isValid(x1, y1) || !$gameMap.isValid(x2, y2)) {
            return false;
        }
        if ($gameMap.terrainTag(x1, y1) !== CONFIG.ledgeTag || $gameMap.terrainTag(x2, y2) === CONFIG.ledgeTag) {
            return false;
        }
        const h0 = is3D ? Three.heightAt(x, y) : 0;
        const h2 = is3D ? Three.heightAt(x2, y2) : 0;
        if (h2 > h0 + 1e-4) {
            return false;
        }
        if (Math.abs(h2 - h0) <= 1e-4 && d !== flatLedgeDirection()) {
            return false;
        }
        const back = player.reverseDir(d);
        return $gameMap.isPassable(x2, y2, back) && !player.isCollidedWithCharacters(x2, y2);
    }

    Three.canHopLedge = canHopLedge;

    const _Game_Player_moveStraight = Game_Player.prototype.moveStraight;
    Game_Player.prototype.moveStraight = function(d) {
        if (canHopLedge(this, d)) {
            this.setDirection(d);
            const dx = d === 6 ? 2 : d === 4 ? -2 : 0;
            const dy = d === 2 ? 2 : d === 8 ? -2 : 0;
            if (CONFIG.ledgeSe) {
                AudioManager.playSe({ name: CONFIG.ledgeSe, volume: 90, pitch: 100, pan: 0 });
            }
            this.jump(dx, dy);
            this.increaseSteps();
            return;
        }
        _Game_Player_moveStraight.call(this, d);
    };
})();
