//=============================================================================
// PokéMZ - PBS_Followers.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Following Pokémon (HGSS style): the first healthy
 * party Pokémon walks behind the player, reacts and can be talked to.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_PBS_Pokemon
 * @orderAfter PokeMZ_PBS_Battle
 *
 * @param switchId
 * @text Enable Switch
 * @desc While this switch is OFF the Pokémon stays in its ball
 * (0 = always on).
 * @type switch
 * @default 0
 *
 * @param waterTag
 * @text Shallow Water Terrain Tag
 * @desc Splash effect on tiles with this terrain tag (0 = off).
 * @type number
 * @min 0
 * @max 7
 * @default 0
 *
 * @param sandTag
 * @text Sand Terrain Tag
 * @desc Dust effect on tiles with this terrain tag (0 = off).
 * @type number
 * @min 0
 * @max 7
 * @default 0
 *
 * @param itemChance
 * @text Find Item Chance (%)
 * @desc Chance every 256 steps that the Pokémon finds an item.
 * @type number
 * @min 0
 * @max 100
 * @default 20
 *
 * @param items
 * @text Items It Can Find
 * @desc Weighted list "weight:itemId" (map_metadata followerItems
 * replaces it on a map).
 * @type string[]
 * @default ["30:oranberry","20:potion","15:pokeball","10:superpotion","10:repel","5:pechaberry","5:nugget","5:rarecandy"]
 *
 * @command toggle
 * @text Toggle Follower
 * @arg on
 * @type boolean
 * @default true
 *
 * @command emote
 * @text Follower Emote
 * @arg balloon
 * @text Balloon ID
 * @type number
 * @min 1
 * @max 15
 * @default 1
 *
 * @command talk
 * @text Talk To Follower
 *
 * @help
 * ============================================================================
 * PokeMZ_PBS_Followers
 * ============================================================================
 * The first party Pokémon that can battle (not an egg, not fainted) follows
 * the player, like in HeartGold and SoulSilver. It is a Game_Follower, so it
 * chases, gathers, hops ledges and appears on 3D maps like other followers.
 *
 * Graphics: img/pokemon/<species>/overworld.png, an MZ single-character
 * sheet (3 frames x 4 directions, any frame size). Shiny colors come from
 * the species' palettes. A species without this file stays in its ball.
 *
 * It goes back into its ball while Surfing (unless it is a Water or Flying
 * type), on the bicycle, in an airship, on maps whose map_metadata has
 * "followers": false, and while the Enable Switch is OFF.
 *
 * Face it and press OK to talk: it reacts to friendship, status, HP,
 * weather, time of day and the map, with a balloon and a line from
 * ui.csv (Follower.Msg.<Mood>.<n>). Walking together raises friendship, and
 * now and then it finds an item.
 *
 * Effects on 2D maps: rustling grass on bush tiles, splashes and dust on
 * the terrain tags set above.
 *
 *   PokeMZ.Followers.registerMood(pokemon => bool, { id, balloon, lines })
 *   PokeMZ.Followers.follower()   -> the Game_PokemonFollower
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_PBS_Followers";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const num = (v, d) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
    const parseList = text => {
        try {
            return JSON.parse(text || "[]")
                .map(s => String(s).split(":"))
                .map(([w, id]) => [Number(w) || 1, String(id || "").trim()])
                .filter(([, id]) => id);
        } catch (e) {
            return [];
        }
    };
    const CONFIG = {
        switchId: num(params.switchId, 0),
        waterTag: num(params.waterTag, 0),
        sandTag: num(params.sandTag, 0),
        itemChance: num(params.itemChance, 20),
        items: parseList(params.items),
    };

    const PBS = window.PokeMZ.PBS;
    const Pkmn = window.PokeMZ.Pokemon;
    const tr = (k, f, a) => Pkmn.tr(k, f, a);

    /** @brief MZ balloon IDs. */
    const BALLOON = { exclamation: 1, question: 2, music: 3, heart: 4, anger: 5, sweat: 6, frustration: 7, silence: 8, idea: 9, zzz: 10 };

    //=========================================================================
    // Moods
    //=========================================================================

    /**
     * @brief Moods checked in order; the first whose test passes is used.
     *        Each: {id, test(pkmn, ctx), balloon, lines (pool size)}.
     */
    const moods = [];

    /**
     * @brief Adds a mood (checked before the built-in ones).
     * @param {function(Game_Pokemon, Object): boolean} test Test; ctx is
     *        {weather, time, outdoor, flags, mapId}.
     * @param {Object} o {id, balloon, lines}.
     */
    function registerMood(test, o) {
        moods.unshift(Object.assign({ test, balloon: BALLOON.music, lines: 3 }, o));
    }

    const isType = (p, t) => p.types().includes(t);
    const builtIn = [
        { id: "Asleep", balloon: BALLOON.zzz, test: p => p.status === "slp" },
        { id: "Poisoned", balloon: BALLOON.sweat, test: p => p.status === "psn" || p.status === "tox" },
        { id: "Burned", balloon: BALLOON.sweat, test: p => p.status === "brn" },
        { id: "Paralyzed", balloon: BALLOON.frustration, test: p => p.status === "par" },
        { id: "Frozen", balloon: BALLOON.silence, test: p => p.status === "frz" },
        { id: "Tired", balloon: BALLOON.sweat, test: p => p.hp / Math.max(1, p.mhp) < 0.25 },
        { id: "RainHappy", balloon: BALLOON.music, test: (p, c) => /rain|storm/.test(c.weather) && isType(p, "water") },
        { id: "Rain", balloon: BALLOON.silence, test: (p, c) => /rain|storm/.test(c.weather) && isType(p, "fire") },
        { id: "SnowHappy", balloon: BALLOON.music, test: (p, c) => c.weather === "snow" && isType(p, "ice") },
        { id: "Cold", balloon: BALLOON.sweat, test: (p, c) => c.weather === "snow" && !isType(p, "ice") },
        { id: "Sleepy", balloon: BALLOON.zzz, test: (p, c) => c.time === "night" && Math.random() < 0.4 },
        { id: "Love", balloon: BALLOON.heart, test: p => p.friendship >= 220 },
        { id: "Happy", balloon: BALLOON.music, test: p => p.friendship >= 150 },
        { id: "Indoors", balloon: BALLOON.question, test: (p, c) => !c.outdoor && Math.random() < 0.5 },
        { id: "Content", balloon: BALLOON.idea, test: p => p.friendship >= 70 },
        { id: "Neutral", balloon: BALLOON.silence, test: () => true },
    ].map(m => Object.assign({ lines: 3 }, m));

    /** @return {Object} The mood for a Pokémon now. */
    function moodOf(p) {
        const meta = PBS.mapMetadataFor($gameMap.mapId());
        const ctx = {
            weather: $gameScreen.weatherType(),
            time: Pkmn.timeOfDay(),
            outdoor: !!(meta && meta.outdoor),
            flags: meta ? meta.flags || [] : [],
            mapId: $gameMap.mapId(),
        };
        return moods.concat(builtIn).find(m => m.test(p, ctx));
    }

    //=========================================================================
    // Game_PokemonFollower
    //=========================================================================

    /**
     * @brief The following Pokémon. Kept first in the follower chain, so it
     *        walks right behind the player.
     */
    class Game_PokemonFollower extends Game_Follower {
        initialize() {
            super.initialize(0);
            this._artFor = "";
            this._hasArt = false;
            this._shown = false;
        }

        /** @return {Game_Pokemon|null} The Pokémon that follows. */
        pokemon() {
            return window.$gameParty && $gameParty.pokemon ? $gameParty.ablePokemon()[0] || null : null;
        }

        /** @return {Game_Pokemon|null} Followers call it actor(). */
        actor() {
            return this.pokemon();
        }

        /** @return {boolean} True when the Pokémon may be out of its ball. */
        isAllowed() {
            const p = this.pokemon();
            if (!p || !window.$gamePokemon || $gamePokemon.followerOff) {
                return false;
            }
            if (CONFIG.switchId && !$gameSwitches.value(CONFIG.switchId)) {
                return false;
            }
            const meta = PBS.mapMetadataFor($gameMap.mapId());
            if (meta && meta.followers === false) {
                return false;
            }
            if ($gamePlayer.isInAirship() || $gamePokemon.onBicycle) {
                return false;
            }
            if (($gamePlayer.isInBoat() || $gamePlayer.isInShip()) && !p.types().some(t => t === "water" || t === "flying")) {
                return false;
            }
            return true;
        }

        /** @return {boolean} True when visible (allowed and has art). */
        isVisible() {
            this.checkArt();
            return this.isAllowed() && this._hasArt;
        }

        /** @brief Looks up (once per look) whether overworld art exists. */
        checkArt() {
            const p = this.pokemon();
            const key = p ? `${p.speciesId}|${p.shiny}|${p.gender}` : "";
            if (key === this._artFor) {
                return;
            }
            this._artFor = key;
            this._hasArt = false;
            if (p && window.PokeMZ.Graphics) {
                const look = window.PokeMZ.Graphics.optsOf(p, "overworld");
                // Shown only once the sheet is fully loaded, so 3D maps never
                // upload a half-made texture.
                window.PokeMZ.Graphics.load(p.speciesId, look).then(bitmap => {
                    const found = !!bitmap._pmzFound;
                    if (this._artFor === key) {
                        this._hasArt = found;
                        Object.defineProperty(this, "_artBitmap", { value: found ? bitmap : null, writable: true, configurable: true, enumerable: false });
                        if (!found && !Game_PokemonFollower.warned[p.speciesId]) {
                            Game_PokemonFollower.warned[p.speciesId] = true;
                            console.info(`[PokeMZ.Followers] no img/pokemon/${p.speciesId}/overworld.png; ${p.name()} stays in its ball`);
                        }
                        this.refresh();
                    }
                });
            }
        }

        /** @brief Sets the "image name" that the sprite uses as a look key. */
        refresh() {
            const visible = this.isVisible();
            const p = this.pokemon();
            const name = visible && p ? `pmz:${p.speciesId}:${p.shiny ? 1 : 0}:${p.gender}` : "";
            if (visible !== this._shown && $gameMap.mapId()) {
                Followers.ballFlash(this);
            }
            this._shown = visible;
            this.setImage(name, 0);
        }

        update() {
            super.update();
            if (Graphics.frameCount % 10 === 0) {
                this.refresh();
            }
            // Water and Flying types may follow over water while Surfing.
            this.setThrough(true);
        }
    }
    Game_PokemonFollower.warned = {};
    window.Game_PokemonFollower = Game_PokemonFollower;

    /** @return {Game_PokemonFollower|null} The follower of the party. */
    const followerOf = followers => (followers && followers._data ? followers._data.find(f => f instanceof Game_PokemonFollower) || null : null);

    const _setup = Game_Followers.prototype.setup;
    Game_Followers.prototype.setup = function() {
        _setup.apply(this, arguments);
        this._data.unshift(new Game_PokemonFollower());
    };

    // Saves made before this plugin was enabled get a follower too.
    const _playerRefresh = Game_Player.prototype.refresh;
    Game_Player.prototype.refresh = function() {
        if (this._followers && this._followers._data && !followerOf(this._followers)) {
            this._followers._data.unshift(new Game_PokemonFollower());
        }
        _playerRefresh.apply(this, arguments);
    };

    // The follower's own visibility (not MZ's "Show Player Followers").
    const _visibleFollowers = Game_Followers.prototype.visibleFollowers;
    Game_Followers.prototype.visibleFollowers = function() {
        const list = _visibleFollowers.apply(this, arguments).filter(f => !(f instanceof Game_PokemonFollower));
        const pf = followerOf(this);
        if (pf && pf.isVisible()) {
            list.unshift(pf);
        }
        return list;
    };

    //=========================================================================
    // Sprite: overworld sheet from img/pokemon/<species>/
    //=========================================================================

    const _setCharacterBitmap = Sprite_Character.prototype.setCharacterBitmap;
    Sprite_Character.prototype.setCharacterBitmap = function() {
        if (this._character instanceof Game_PokemonFollower && this._characterName.startsWith("pmz:")) {
            this.bitmap = this._character._artBitmap || new Bitmap(1, 1);
            this._isBigCharacter = true;
            return;
        }
        _setCharacterBitmap.apply(this, arguments);
    };

    //=========================================================================
    // Steps: friendship and found items
    //=========================================================================

    const _increaseSteps = Game_Player.prototype.increaseSteps;
    Game_Player.prototype.increaseSteps = function() {
        _increaseSteps.apply(this, arguments);
        const f = followerOf(this._followers);
        if (!f || !f.isVisible() || !window.$gamePokemon) {
            return;
        }
        const steps = $gamePokemon.stepCounter;
        const p = f.pokemon();
        if (steps % 64 === 0) {
            p.changeFriendship(1);
        }
        if (steps % 256 === 0 && !$gamePokemon.followerItem && Math.random() * 100 < CONFIG.itemChance) {
            $gamePokemon.followerItem = Followers.rollItem();
            if ($gamePokemon.followerItem) {
                $gameTemp.requestBalloon(f, BALLOON.exclamation);
            }
        }
    };

    //=========================================================================
    // Talking
    //=========================================================================

    const _checkEventTriggerThere = Game_Player.prototype.checkEventTriggerThere;
    Game_Player.prototype.checkEventTriggerThere = function(triggers) {
        if (triggers.includes(0) && this.canStartLocalEvents() && !$gameMap.isEventRunning() && !Followers.talking) {
            const f = followerOf(this._followers);
            const x2 = $gameMap.roundXWithDirection(this.x, this.direction());
            const y2 = $gameMap.roundYWithDirection(this.y, this.direction());
            const eventThere = $gameMap.eventsXy(x2, y2).some(e => e.isNormalPriority());
            if (f && f.isVisible() && f.x === x2 && f.y === y2 && !eventThere) {
                Followers.talk();
                return;
            }
        }
        _checkEventTriggerThere.apply(this, arguments);
    };

    // The map waits while a talk flow runs.
    const _isBusy = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function() {
        return !Followers.talking && _isBusy.apply(this, arguments);
    };

    //=========================================================================
    // Overworld effects (2D maps)
    //=========================================================================

    /**
     * @brief A small procedural effect sprite (grass, splash, dust, ball
     *        flash) that plays once on the tilemap.
     */
    class Sprite_FollowerEffect extends Sprite {
        /**
         * @param {string} kind "grass" | "splash" | "dust" | "flash".
         * @param {Game_Character} character Where it plays.
         */
        initialize(kind, character) {
            super.initialize(new Bitmap(48, 48));
            this._kind = kind;
            this._character = character;
            this._frame = 0;
            this._duration = kind === "flash" ? 24 : 18;
            this.anchor.x = 0.5;
            this.anchor.y = 1;
            this.z = 5;
            this.draw();
        }

        draw() {
            const b = this.bitmap;
            const t = this._frame / this._duration;
            b.clear();
            const ctx = b.context;
            ctx.save();
            if (this._kind === "grass") {
                ctx.fillStyle = "#3c9a3c";
                for (let i = 0; i < 5; i++) {
                    const x = 8 + i * 8;
                    const h = 10 + ((i * 7) % 6) - t * 6;
                    ctx.fillRect(x + Math.sin(t * 6 + i) * 3, 46 - h, 3, h);
                }
            } else if (this._kind === "splash") {
                ctx.fillStyle = "rgba(170, 220, 255, 0.9)";
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI;
                    ctx.fillRect(24 + Math.cos(a) * 16 * t, 42 - Math.sin(a) * 14 * t, 3, 3);
                }
            } else if (this._kind === "dust") {
                ctx.fillStyle = `rgba(220, 200, 150, ${0.8 - t * 0.8})`;
                ctx.beginPath();
                ctx.arc(14 - t * 6, 42, 4 + t * 4, 0, Math.PI * 2);
                ctx.arc(34 + t * 6, 42, 4 + t * 4, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = `rgba(255, 255, 255, ${1 - t})`;
                ctx.beginPath();
                ctx.arc(24, 28, 6 + t * 16, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            b.baseTexture.update();
        }

        update() {
            super.update();
            this.x = this._character.screenX();
            this.y = this._character.screenY() + (this._kind === "flash" ? -8 : 0);
            this._frame++;
            this.draw();
            if (this._frame >= this._duration && this.parent) {
                this.parent.removeChild(this);
            }
        }
    }
    window.Sprite_FollowerEffect = Sprite_FollowerEffect;

    /** @return {boolean} True on a 3D map (effects come from Three there). */
    const is3D = () => !!(window.PokeMZ.Three && window.PokeMZ.Three.isActive && window.PokeMZ.Three.isActive());

    /** @brief Plays an effect on the current map (2D maps only). */
    function playEffect(kind, character) {
        const scene = SceneManager._scene;
        const set = scene && scene._spriteset;
        if (!set || !set._tilemap || is3D()) {
            return;
        }
        set._tilemap.addChild(new Sprite_FollowerEffect(kind, character));
    }

    const _spritesetUpdate = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function() {
        _spritesetUpdate.apply(this, arguments);
        const f = $gamePlayer && followerOf($gamePlayer.followers());
        if (!f || !f.isVisible()) {
            return;
        }
        const key = `${f.x},${f.y}`;
        if (this._pmzFollowerTile !== key && !f.isMoving()) {
            const first = this._pmzFollowerTile === undefined;
            this._pmzFollowerTile = key;
            if (first) {
                return;
            }
            const tag = $gameMap.terrainTag(f.x, f.y);
            if ($gameMap.isBush(f.x, f.y)) {
                playEffect("grass", f);
            } else if (CONFIG.waterTag && tag === CONFIG.waterTag) {
                playEffect("splash", f);
            } else if (CONFIG.sandTag && tag === CONFIG.sandTag) {
                playEffect("dust", f);
            }
        }
    };

    //=========================================================================
    // API and commands
    //=========================================================================

    const Followers = {
        config: CONFIG,
        talking: false,
        BALLOON,
        registerMood,
        moodOf,
        follower: () => ($gamePlayer ? followerOf($gamePlayer.followers()) : null),

        /** @return {string} A found item ID from the map's or the default list. */
        rollItem() {
            const meta = PBS.mapMetadataFor($gameMap.mapId());
            const list = (meta && meta.followerItems) || CONFIG.items;
            const valid = list.filter(([, id]) => PBS.items.has(id));
            const total = valid.reduce((n, [w]) => n + w, 0);
            let r = Math.random() * total;
            for (const [w, id] of valid) {
                r -= w;
                if (r < 0) {
                    return id;
                }
            }
            return "";
        },

        /** @brief Plays the ball flash when the Pokémon comes out or goes back. */
        ballFlash(character) {
            playEffect("flash", character);
        },

        /** @brief Shows a balloon over the follower. */
        emote(balloon) {
            const f = this.follower();
            if (f && f.isVisible()) {
                $gameTemp.requestBalloon(f, balloon);
            }
        },

        /**
         * @brief Talks to the following Pokémon (mood, balloon, message,
         *        found item).
         * @return {Promise<void>} Done.
         */
        async talk() {
            const f = this.follower();
            const p = f && f.pokemon();
            if (!p || this.talking) {
                return;
            }
            this.talking = true;
            try {
                f.turnTowardCharacter($gamePlayer);
                const say = text => (window.PokeMZ.UI && PokeMZ.UI.message ? PokeMZ.UI.message(text) : Promise.resolve());
                const args = { name: p.name(), g: p.gender };
                const item = $gamePokemon.followerItem;
                if (item && PBS.items.has(item)) {
                    $gamePokemon.followerItem = "";
                    $gameTemp.requestBalloon(f, BALLOON.exclamation);
                    await say(tr("Follower.Msg.FoundItem", "{name} seems to be holding something!", args));
                    $gameParty.bag().gain(item, 1);
                    await say(tr("Follower.Msg.GotItem", "You received the {item} from {name}!", Object.assign({ item: PBS.items.get(item).name }, args)));
                    return;
                }
                const mood = moodOf(p);
                $gameTemp.requestBalloon(f, mood.balloon);
                const n = 1 + Math.floor(Math.random() * (mood.lines || 1));
                await say(tr(`Follower.Msg.${mood.id}.${n}`, FALLBACK[mood.id] ? FALLBACK[mood.id][n - 1] || FALLBACK[mood.id][0] : "{name} is looking at you.", args));
                if (mood.id === "Love" || mood.id === "Happy") {
                    p.changeFriendship(1);
                }
            } finally {
                this.talking = false;
            }
        },
    };

    /** @brief English source lines (ui.csv rows are generated from these). */
    const FALLBACK = {
        Asleep: ["{name} is fast asleep...", "{name} is snoozing peacefully.", "{name} is dozing off on its feet."],
        Poisoned: ["{name} is shivering with the effects of being poisoned.", "{name} looks pale from the poison.", "{name} is trying hard to bear the poison."],
        Burned: ["{name}'s burn looks painful!", "{name} winces from its burn.", "{name} is trying not to touch its burn."],
        Paralyzed: ["{name} is having a hard time moving.", "{name} twitches now and then.", "{name} looks numb."],
        Frozen: ["{name} seems frozen stiff!", "{name} is shivering.", "{name} can barely move in the cold."],
        Tired: ["{name} looks very tired.", "{name} is struggling to keep up.", "{name} could use some rest at a Pokémon Center."],
        RainHappy: ["{name} is splashing happily in the rain!", "{name} looks delighted by the rain.", "{name} is dancing in the puddles!"],
        Rain: ["{name} doesn't like the rain at all...", "{name} is trying to keep dry.", "{name} looks gloomy in the rain."],
        SnowHappy: ["{name} is playing in the snow!", "{name} loves the cold!", "{name} is catching snowflakes."],
        Cold: ["{name} is shivering in the cold.", "{name} huddles close to you.", "{name} is trying to stay warm."],
        Sleepy: ["{name} is yawning.", "{name} looks sleepy.", "{name}'s eyes are drooping."],
        Love: ["{name} is gazing at you lovingly!", "{name} snuggles up to you!", "{name} cheerfully hops beside you!"],
        Happy: ["{name} is humming happily.", "{name} is in a great mood!", "{name} is skipping along with you!"],
        Indoors: ["{name} is looking around curiously.", "{name} is sniffing at the floor.", "{name} seems interested in this place."],
        Content: ["{name} is walking along comfortably.", "{name} looks content.", "{name} is keeping pace with you."],
        Neutral: ["{name} is looking at you.", "{name} glances around.", "{name} is waiting for you."],
    };
    Followers.FALLBACK = FALLBACK;

    PluginManager.registerCommand(PLUGIN_NAME, "toggle", args => {
        $gamePokemon.followerOff = args.on === "false";
        const f = Followers.follower();
        if (f) {
            f.refresh();
        }
    });

    PluginManager.registerCommand(PLUGIN_NAME, "emote", args => Followers.emote(num(args.balloon, 1)));

    PluginManager.registerCommand(PLUGIN_NAME, "talk", function() {
        let done = false;
        Followers.talk().then(() => (done = true));
        this.setWaitMode("pbsFlow");
        this._pbsFlowDone = () => done;
    });

    window.PokeMZ.Followers = Followers;
})();
