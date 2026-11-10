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
 * Hills
 *   Slope faces with PokeMZ_Three_Core's "Hill Terrain Tag" (default 3) are
 *   walkable on 3D maps, even if the tileset marks them impassable. You walk
 *   up and down a hill along its slope; its sides are too steep to step off.
 *
 * Ledges
 *   Give ledge tiles the "Ledge Terrain Tag" and make them impassable.
 *   Walking into a ledge hops the player (and followers) two tiles over it,
 *   if the landing tile is free. On 3D maps the player may only hop towards
 *   lower ground; on flat ground the "Default Ledge Direction" is used.
 *   Map note <3D LedgeDirection: 4> changes that direction for one map.
 *
 *   Events hop too when their active page has the comment <3D Ledges> (or
 *   the event note has it). They hop during Set Movement Route and
 *   Approach / Away movement; random movement never walks into ledges, so
 *   wandering NPCs can't get stuck below one.
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

    //-------------------------------------------------------------------------
    // Hills: walkable slope faces
    //-------------------------------------------------------------------------

    /**
     * @brief Whether a tile is a hill (a slope face with the core's Hill
     *        Terrain Tag) on the current 3D map.
     * @param {number} x Tile X.
     * @param {number} y Tile Y.
     * @return {boolean} True for hills.
     */
    function isHill(x, y) {
        if (!Three.isMap3D()) {
            return false;
        }
        const hf = Three.heights();
        return !!(hf && hf.isHill(x, y));
    }

    Three.isHill = isHill;

    // Hills are passable whatever their tileset passage says, so the same
    // painted tiles can block in 2D and be climbed in 3D. Stepping off a
    // hill's sides is still blocked by heightAllows (its edges are sloped).
    const _Game_Map_isPassable = Game_Map.prototype.isPassable;
    Game_Map.prototype.isPassable = function(x, y, d) {
        return isHill(x, y) || _Game_Map_isPassable.call(this, x, y, d);
    };

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
     * @brief Whether a character is allowed to hop ledges at all: the player
     *        when on foot, and events whose active page (or note) has
     *        <3D Ledges>. Followers hop together with the player.
     * @param {Game_CharacterBase} character The character.
     * @return {boolean} True if it may hop.
     */
    function mayHop(character) {
        if (character.isThrough()) {
            return false;
        }
        if (character instanceof Game_Player) {
            return !character.isInVehicle();
        }
        if (character instanceof Game_Event) {
            return !character._erased && /<3D\s+Ledges>/i.test(Three.eventText(character));
        }
        return false;
    }

    /**
     * @brief Whether a character can hop a ledge in direction d.
     * @param {Game_CharacterBase} character The player or an event.
     * @param {number} d Direction.
     * @return {boolean} True if a hop should happen.
     */
    function canHopLedge(character, d) {
        if (CONFIG.ledgeTag <= 0 || !mayHop(character)) {
            return false;
        }
        const is3D = Three.isMap3D();
        if (!is3D && !CONFIG.ledgesIn2D) {
            return false;
        }
        const x = character.x;
        const y = character.y;
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
        const back = character.reverseDir(d);
        return $gameMap.isPassable(x2, y2, back) && !character.isCollidedWithCharacters(x2, y2);
    }

    Three.canHopLedge = canHopLedge;

    /**
     * @brief Hops a character two tiles over a ledge.
     * @param {Game_Character} character The player or an event.
     * @param {number} d Direction.
     */
    function hopLedge(character, d) {
        character.setDirection(d);
        const dx = d === 6 ? 2 : d === 4 ? -2 : 0;
        const dy = d === 2 ? 2 : d === 8 ? -2 : 0;
        if (CONFIG.ledgeSe) {
            AudioManager.playSe({ name: CONFIG.ledgeSe, volume: 90, pitch: 100, pan: 0 });
        }
        character.jump(dx, dy); // the player's jump also hops followers
        character.setMovementSuccess(true);
    }

    const _Game_Player_moveStraight = Game_Player.prototype.moveStraight;
    Game_Player.prototype.moveStraight = function(d) {
        if (canHopLedge(this, d)) {
            hopLedge(this, d);
            this.increaseSteps();
            return;
        }
        _Game_Player_moveStraight.call(this, d);
    };

    // Events (move routes, Approach / Away movement). Random movement only
    // steps onto passable tiles, so wandering NPCs never hop by accident.
    const _Game_CharacterBase_moveStraight = Game_CharacterBase.prototype.moveStraight;
    Game_CharacterBase.prototype.moveStraight = function(d) {
        if (this instanceof Game_Event && canHopLedge(this, d)) {
            hopLedge(this, d);
            return;
        }
        _Game_CharacterBase_moveStraight.call(this, d);
    };
})();
