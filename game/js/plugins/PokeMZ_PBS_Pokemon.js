//=============================================================================
// PokéMZ - PBS_Pokemon.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Pokémon as instanced actors, party, bag, item
 * handlers, Pokédex, PC storage, day care, evolution and encounters.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_PBS_Core
 * @orderAfter PokeMZ_PBS_Core
 *
 * @param uidBase
 * @text First Pokémon Actor ID
 * @desc Pokémon instances get actor IDs from here up. They never use
 * Actors.json slots, so MZ's 1000-actor limit doesn't apply.
 * @type number
 * @min 2000
 * @default 100000
 *
 * @param templateActor
 * @text Template Actor
 * @desc Database actor whose traits and note every Pokémon copies
 * (0 = none).
 * @type actor
 * @default 0
 *
 * @param templateClass
 * @text Template Class
 * @desc Database class whose traits every Pokémon copies (0 = none).
 * @type class
 * @default 0
 *
 * @param partySize
 * @text Party Size
 * @type number
 * @min 1
 * @default 6
 *
 * @param boxCount
 * @text PC Boxes
 * @type number
 * @min 1
 * @default 32
 *
 * @param boxSize
 * @text Box Size
 * @type number
 * @min 1
 * @default 30
 *
 * @param maxLevel
 * @text Max Level
 * @type number
 * @min 1
 * @default 100
 *
 * @param shinyOdds
 * @text Shiny Odds (1 in N)
 * @type number
 * @min 1
 * @default 4096
 *
 * @param expShareAll
 * @text Party-wide EXP Share
 * @desc Gen 9: Pokémon that didn't battle get half EXP.
 * @type boolean
 * @default true
 *
 * @param grassTerrainTag
 * @text Grass Terrain Tag
 * @desc Land encounters happen on tiles with this terrain tag (0 = any
 * tile). Bush tiles always count.
 * @type number
 * @min 0
 * @max 7
 * @default 0
 *
 * @param encounterDivisor
 * @text Encounter Divisor
 * @desc Chance of an encounter per step = density / this.
 * @type number
 * @min 1
 * @default 180
 *
 * @command givePokemon
 * @text Give Pokémon
 * @arg species
 * @text Species ID
 * @type string
 * @default pikachu
 * @arg level
 * @type number
 * @min 1
 * @default 5
 * @arg shiny
 * @type boolean
 * @default false
 * @arg nickname
 * @type string
 * @default
 * @arg item
 * @text Held Item ID
 * @type string
 * @default
 * @arg variable
 * @text Store Actor ID In
 * @type variable
 * @default 0
 *
 * @command giveEgg
 * @text Give Egg
 * @arg species
 * @type string
 * @default togepi
 *
 * @command healParty
 * @text Heal Party
 *
 * @command openPC
 * @text Open PC
 *
 * @command openDayCare
 * @text Open Day Care
 *
 * @command moveReminder
 * @text Move Reminder
 *
 * @command checkEvolution
 * @text Check Evolution
 * @desc Re-checks evolution conditions (e.g. after an event changed the
 * time or map) and tells the player who can evolve.
 *
 * @command giveItem
 * @text Give Item
 * @arg item
 * @text Item ID
 * @type string
 * @default potion
 * @arg amount
 * @type number
 * @min 1
 * @default 1
 * @arg message
 * @text Show Message
 * @type boolean
 * @default true
 *
 * @command hasSpecies
 * @text Party Has Species
 * @arg species
 * @type string
 * @default pikachu
 * @arg switch
 * @type switch
 * @default 0
 *
 * @help
 * ============================================================================
 * PokeMZ_PBS_Pokemon
 * ============================================================================
 * Pokémon are Game_Pokemon objects (a Game_Actor subclass) created from PBS
 * species at runtime. They live in $gameActors under their own actor IDs
 * (First Pokémon Actor ID and up), so they need no database slot and there
 * is no limit on how many exist. MZ's party keeps the trainer; the Pokémon
 * party is $gameParty.pokemon().
 *
 *   const p = PokeMZ.Pokemon.create("pikachu", 5, { shiny: true });
 *   $gameParty.addPokemon(p);       // the PC when the party is full
 *   p.gainExp(500);                 // level-ups, new moves (async flow)
 *   p.evolutionOptions();           // targets it can evolve into now
 *   $gameParty.bag().gain("potion", 3);
 *   $gamePokemon.pokedex.isCaught("pikachu");
 *
 * Evolution works like Pokémon Legends: Arceus: a Pokémon that meets its
 * conditions becomes "ready to evolve" and the player evolves it from the
 * party menu whenever they like. Trade evolutions still happen at once.
 *
 * Extending:
 *   PokeMZ.Pokemon.ItemHandlers.register("myeffect", { canUse, use })
 *   PokeMZ.Pokemon.EvolutionMethods.register("mymethod", (pkmn, evo, ctx) => bool)
 *   PokeMZ.Pokemon.FormHandlers.register("species", pkmn => formId)
 *   PokeMZ.Pokemon.FieldMoves.register("cut", { canUse, use })
 *   PokeMZ.Pokemon.EncounterTypes.register("swamp", () => bool)
 *   PokeMZ.Pokemon.rules.shinyOdds = 8192      (any rule, see Engine.rules)
 */

(() => {
    "use strict";

    //=========================================================================
    // Engine (pure: no MZ; also loaded by tests)
    //=========================================================================

    const STATS = ["hp", "atk", "def", "spa", "spd", "spe"];

    /**
     * @brief Mechanics rules (Gen 9 defaults). Every rule can be changed.
     */
    const rules = {
        maxLevel: 100,
        shinyOdds: 4096,
        shinyRolls: 1,
        masudaRolls: 6,
        evPerStat: 252,
        evTotal: 510,
        expShareAll: true,
        expShareRatio: 0.5,
        trainerExpBonus: 1,
        luckyEggBonus: 1.5,
        tradedBonus: 1.5,
        inheritIvs: 3,
        destinyKnotIvs: 5,
        hiddenAbilityInherit: 0.6,
        abilitySlotInherit: 0.8,
        eggStepsPerCycle: 257,
        dayCareExpPerStep: 1,
        friendshipStepInterval: 128,
        moveSlots: 4,
    };

    /**
     * @brief A stat value (Gen 3+ formula).
     * @param {string} stat "hp" ... "spe".
     * @param {number} base Base stat.
     * @param {number} iv IV (0-31).
     * @param {number} ev EV (0-252).
     * @param {number} level Level.
     * @param {number} [nature] Nature multiplier (1.1, 1, 0.9).
     * @return {number} The stat.
     */
    function calcStat(stat, base, iv, ev, level, nature = 1) {
        const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
        if (stat === "hp") {
            return base === 1 ? 1 : core + level + 10;
        }
        return Math.floor((core + 5) * nature);
    }

    /**
     * @brief Total EXP needed to reach a level.
     * @param {string} rate Growth rate ID.
     * @param {number} n Level.
     * @return {number} EXP.
     */
    function expForLevel(rate, n) {
        if (n <= 1) {
            return 0;
        }
        const n3 = n * n * n;
        switch (rate) {
            case "fast":
                return Math.floor((4 * n3) / 5);
            case "slow":
                return Math.floor((5 * n3) / 4);
            case "mediumslow":
                return Math.max(0, Math.floor((6 * n3) / 5 - 15 * n * n + 100 * n - 140));
            case "erratic":
                if (n <= 50) {
                    return Math.floor((n3 * (100 - n)) / 50);
                }
                if (n <= 68) {
                    return Math.floor((n3 * (150 - n)) / 100);
                }
                if (n <= 98) {
                    return Math.floor((n3 * Math.floor((1911 - 10 * n) / 3)) / 500);
                }
                return Math.floor((n3 * (160 - n)) / 100);
            case "fluctuating":
                if (n <= 15) {
                    return Math.floor((n3 * (Math.floor((n + 1) / 3) + 24)) / 50);
                }
                if (n <= 36) {
                    return Math.floor((n3 * (n + 14)) / 50);
                }
                return Math.floor((n3 * (Math.floor(n / 2) + 32)) / 50);
            default:
                return n3;
        }
    }

    /**
     * @brief EXP for defeating a Pokémon (Gen 5+ scaled formula).
     * @param {Object} o {baseExp, level (fainted), victorLevel, trainer,
     *        participated, luckyEgg, traded, share}.
     * @return {number} EXP.
     */
    function expGain(o) {
        const L = o.level;
        const Lp = o.victorLevel;
        let exp = Math.floor(((o.baseExp * L) / 5) * Math.pow((2 * L + 10) / (L + Lp + 10), 2.5)) + 1;
        if (o.trainer) {
            exp = Math.floor(exp * rules.trainerExpBonus);
        }
        if (!o.participated) {
            exp = Math.floor(exp * rules.expShareRatio);
        }
        if (o.luckyEgg) {
            exp = Math.floor(exp * rules.luckyEggBonus);
        }
        if (o.traded) {
            exp = Math.floor(exp * rules.tradedBonus);
        }
        return Math.max(1, exp);
    }

    /**
     * @brief Capture check (Gen 8/9 formula, no critical captures).
     * @param {Object} o {maxHp, hp, catchRate, ball (multiplier), status
     *        (Showdown status id), levelBonus}.
     * @param {function(): number} [rng] Random in [0, 1).
     * @return {{caught: boolean, shakes: number, chance: number}} Result.
     */
    function captureCheck(o, rng = Math.random) {
        if (o.ball >= 255) {
            return { caught: true, shakes: 3, chance: 1 };
        }
        const status = o.status === "slp" || o.status === "frz" ? 2.5 : o.status ? 1.5 : 1;
        const a = (((3 * o.maxHp - 2 * o.hp) * o.catchRate * o.ball) / (3 * o.maxHp)) * status * (o.levelBonus || 1);
        if (a >= 255) {
            return { caught: true, shakes: 3, chance: 1 };
        }
        const b = 65536 / Math.pow(255 / Math.max(a, 0.01), 3 / 16);
        let shakes = 0;
        for (let i = 0; i < 4; i++) {
            if (Math.floor(rng() * 65536) >= b) {
                break;
            }
            shakes++;
        }
        return { caught: shakes === 4, shakes: Math.min(3, shakes), chance: Math.pow(b / 65536, 4) };
    }

    /**
     * @brief Day care compatibility (eggs per check, out of 100).
     * @param {Object} a {species: SpeciesData, gender, otId}.
     * @param {Object} b Same.
     * @return {number} 0, 20, 50 or 70.
     */
    function compatibility(a, b) {
        const ga = a.species.eggGroups || [];
        const gb = b.species.eggGroups || [];
        if (ga.includes("undiscovered") || gb.includes("undiscovered")) {
            return 0;
        }
        const dittoA = ga.includes("ditto");
        const dittoB = gb.includes("ditto");
        if (dittoA && dittoB) {
            return 0;
        }
        const sameOt = a.otId === b.otId;
        if (dittoA || dittoB) {
            return sameOt ? 20 : 50;
        }
        if (a.gender === "genderless" || b.gender === "genderless" || a.gender === b.gender) {
            return 0;
        }
        if (!ga.some(g => gb.includes(g))) {
            return 0;
        }
        const sameSpecies = a.species.baseId === b.species.baseId;
        if (sameSpecies) {
            return sameOt ? 50 : 70;
        }
        return sameOt ? 20 : 50;
    }

    /**
     * @brief Picks n distinct items.
     * @param {Array} list Items.
     * @param {number} n Count.
     * @param {function(): number} rng Random.
     * @return {Array} Picked items.
     */
    function pick(list, n, rng) {
        const pool = list.slice();
        const out = [];
        while (out.length < n && pool.length) {
            out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        }
        return out;
    }

    /**
     * @brief Works out what hatches from two parents (Gen 9 rules).
     * @param {Object} mother {species, gender, ivs, nature, abilitySlot,
     *        ball, moves: [ids], heldItem, otId, form}.
     * @param {Object} father Same.
     * @param {Object} registries PBS registries (species, items).
     * @param {function(): number} [rng] Random.
     * @return {Object|null} {species, ivs, nature, abilitySlot, ball, moves}.
     */
    function breed(mother, father, registries, rng = Math.random) {
        const isDitto = p => (p.species.eggGroups || []).includes("ditto");
        let main = mother;
        let other = father;
        if (isDitto(main) || (main.gender === "male" && !isDitto(other))) {
            [main, other] = [other, main];
        }
        const species = registries.species;
        // Lowest stage of the main parent.
        let base = species.get(main.species.baseId);
        const seen = new Set();
        while (base.prevo && species.has(base.prevo) && !seen.has(base.id)) {
            seen.add(base.id);
            base = species.get(base.prevo);
        }
        // Incense babies need the incense to be held.
        if (base.incense && ![main.heldItem, other.heldItem].includes(base.incense) && base.evolutions && base.evolutions.length) {
            base = species.get(base.evolutions[0].species);
        }
        // Species with gendered offspring lines (Nidoran, Volbeat/Illumise).
        let id = base.id;
        if (base.offspring && base.offspring.length) {
            id = base.offspring[Math.floor(rng() * base.offspring.length)];
        }
        // Regional forms follow the main parent's form.
        if (main.species.isForm && !main.species.battleOnly && !main.species.cosmetic) {
            const formId = `${id}${main.species.folder || ""}`;
            if (species.has(formId)) {
                id = formId;
            }
        }
        const child = species.get(id);
        // IVs.
        const ivs = {};
        for (const s of STATS) {
            ivs[s] = Math.floor(rng() * 32);
        }
        const knot = [main.heldItem, other.heldItem].includes("destinyknot");
        for (const s of pick(STATS, knot ? rules.destinyKnotIvs : rules.inheritIvs, rng)) {
            ivs[s] = (rng() < 0.5 ? main : other).ivs[s];
        }
        // Nature.
        let nature = null;
        const stones = [main, other].filter(p => p.heldItem === "everstone");
        if (stones.length) {
            nature = stones[Math.floor(rng() * stones.length)].nature;
        }
        // Ability slot: the main parent's (hidden: 60%).
        let abilitySlot = rng() < 0.5 ? "0" : "1";
        if (main.abilitySlot === "H" && child.abilities.H && rng() < rules.hiddenAbilityInherit) {
            abilitySlot = "H";
        } else if (main.abilitySlot !== "H" && rng() < rules.abilitySlotInherit) {
            abilitySlot = main.abilitySlot;
        }
        if (!child.abilities[abilitySlot]) {
            abilitySlot = "0";
        }
        // Ball.
        let ball = main.ball || "pokeball";
        if (["masterball", "cherishball"].includes(ball)) {
            ball = "pokeball";
        }
        // Moves: level-1 moves, then egg moves either parent knows.
        const moves = child.movesUpTo(1);
        for (const m of (mother.moves || []).concat(father.moves || [])) {
            if ((child.moves.egg || []).includes(m) && !moves.includes(m)) {
                moves.push(m);
            }
        }
        return { species: child.id, ivs, nature, abilitySlot, ball, moves: moves.slice(-rules.moveSlots) };
    }

    /**
     * @brief Evolution methods: name -> test(pkmn, evo, ctx) -> boolean.
     *        ctx = {trigger: "level"|"item"|"trade"|"check", item, partner,
     *        timeOfDay, mapFlags, weather, party}.
     */
    const EvolutionMethods = {
        map: new Map(),

        /**
         * @brief Registers a method.
         * @param {string} name Method ID (PBS "method").
         * @param {Function} test (pkmn, evo, ctx) => boolean.
         * @param {Object} [o] {trigger: "level" | "item" | "trade" | "any"}.
         */
        register(name, test, o = {}) {
            this.map.set(name, { test, trigger: o.trigger || "level" });
            if (typeof PBS_ENGINE !== "undefined" && PBS_ENGINE) {
                PBS_ENGINE.enums.add("evolutionMethods", name);
            }
        },

        /** @return {Object|null} {test, trigger}. */
        get(name) {
            return this.map.get(name) || null;
        },
    };

    let PBS_ENGINE = null;
    const L = (pk, evo) => pk.level >= (Number(evo.param) || 1);
    const cond = (pk, evo, ctx) => {
        const c = evo.condition || {};
        if (c.time && ctx.timeOfDay && c.time !== ctx.timeOfDay && !(c.time === "day" && ctx.timeOfDay === "morning")) {
            return false;
        }
        if (c.region && !(ctx.mapFlags || []).includes(`region${c.region}`)) {
            return false;
        }
        if (c.gender && pk.gender !== c.gender) {
            return false;
        }
        if (c.text) {
            return false; // needs a custom or scripted method
        }
        return true;
    };
    const reg = (name, test, trigger) => EvolutionMethods.register(name, (pk, evo, ctx) => test(pk, evo, ctx) && cond(pk, evo, ctx), { trigger });
    reg("level", L);
    reg("levelmale", (pk, evo) => L(pk, evo) && pk.gender === "male");
    reg("levelfemale", (pk, evo) => L(pk, evo) && pk.gender === "female");
    reg("levelday", (pk, evo, ctx) => L(pk, evo) && ctx.timeOfDay !== "night");
    reg("levelnight", (pk, evo, ctx) => L(pk, evo) && ctx.timeOfDay === "night");
    reg("levelmorning", (pk, evo, ctx) => L(pk, evo) && ctx.timeOfDay === "morning");
    reg("levelevening", (pk, evo, ctx) => L(pk, evo) && ctx.timeOfDay === "evening");
    reg("levelhelditem", (pk, evo) => pk.heldItem === evo.param);
    reg("levelmove", (pk, evo) => pk.knowsMove(evo.param));
    reg("levelmovetype", (pk, evo, ctx) => pk.moveIds().some(m => ctx.moveType && ctx.moveType(m) === evo.param));
    reg("levellocation", (pk, evo, ctx) => (ctx.mapFlags || []).includes(String(evo.param)) || ctx.mapId === Number(evo.param));
    reg("levelparty", (pk, evo, ctx) => (ctx.party || []).some(p => p !== pk && p.speciesId === evo.param));
    reg("levelstats", (pk, evo) => {
        const d = pk.stat("atk") - pk.stat("def");
        return evo.param === "atkgreater" ? d > 0 : evo.param === "defgreater" ? d < 0 : d === 0;
    });
    reg("levelweather", (pk, evo, ctx) => !!ctx.weather && (!evo.param || ctx.weather === evo.param));
    reg("friendship", pk => pk.friendship >= 160);
    reg("levelfriendship", pk => pk.friendship >= 160);
    reg("friendshipday", (pk, evo, ctx) => pk.friendship >= 160 && ctx.timeOfDay !== "night");
    reg("friendshipnight", (pk, evo, ctx) => pk.friendship >= 160 && ctx.timeOfDay === "night");
    reg("affection", pk => pk.friendship >= 220);
    reg("item", (pk, evo, ctx) => ctx.item === evo.param, "item");
    reg("itemmale", (pk, evo, ctx) => ctx.item === evo.param && pk.gender === "male", "item");
    reg("itemfemale", (pk, evo, ctx) => ctx.item === evo.param && pk.gender === "female", "item");
    reg("trade", () => true, "trade");
    EvolutionMethods.register("tradeitem", (pk, evo) => pk.heldItem === evo.param, { trigger: "trade" });
    reg("tradespecies", (pk, evo, ctx) => !!ctx.partner && ctx.partner.speciesId === evo.param, "trade");
    EvolutionMethods.register("shed", () => false, { trigger: "level" });
    EvolutionMethods.register("levelextra", () => false, { trigger: "level" });
    EvolutionMethods.register("other", () => false, { trigger: "level" });
    EvolutionMethods.register("scripted", () => false, { trigger: "level" });

    const Engine = {
        STATS,
        rules,
        calcStat,
        expForLevel,
        expGain,
        captureCheck,
        compatibility,
        breed,
        EvolutionMethods,
        /** @brief Gives the engine the PBS core (for enums). */
        useCore(core) {
            PBS_ENGINE = core;
            for (const name of EvolutionMethods.map.keys()) {
                core.enums.add("evolutionMethods", name);
            }
        },
    };

    if (typeof window === "undefined" || typeof PluginManager === "undefined") {
        if (typeof module !== "undefined" && module.exports) {
            module.exports = Engine;
        }
        return;
    }

    //=========================================================================
    // MZ glue
    //=========================================================================

    const PLUGIN_NAME = "PokeMZ_PBS_Pokemon";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const num = (v, d) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
    const CONFIG = {
        uidBase: num(params.uidBase, 100000),
        templateActor: num(params.templateActor, 0),
        templateClass: num(params.templateClass, 0),
        partySize: num(params.partySize, 6),
        boxCount: num(params.boxCount, 32),
        boxSize: num(params.boxSize, 30),
        grassTerrainTag: num(params.grassTerrainTag, 0),
        encounterDivisor: num(params.encounterDivisor, 180),
    };
    rules.maxLevel = num(params.maxLevel, 100);
    rules.shinyOdds = num(params.shinyOdds, 4096);
    rules.expShareAll = params.expShareAll !== "false";

    const PBS = window.PokeMZ && window.PokeMZ.PBS;
    if (!PBS) {
        throw new Error("PokeMZ_PBS_Pokemon needs PokeMZ_PBS_Core above it.");
    }
    Engine.useCore(PBS);

    /**
     * @brief Translated text (PokeMZ_Locale), with {name} placeholders.
     * @param {string} key String key.
     * @param {string} fallback Source text.
     * @param {Object} [args] Values.
     * @return {string} Text.
     */
    function tr(key, fallback, args) {
        const L10n = window.PokeMZ.L10n;
        if (L10n && L10n.t) {
            return L10n.t(key, args || null, fallback);
        }
        return String(fallback).replace(/\{(\w+)\}/g, (m, k) => (args && k in args ? args[k] : m));
    }

    const randInt = n => Math.floor(Math.random() * n);

    /** @return {string} "morning" | "day" | "evening" | "night". */
    let timeOfDay = () => {
        const three = window.PokeMZ.Three && window.PokeMZ.Three.Lighting;
        if (three && typeof three.timeOfDay === "function") {
            return three.timeOfDay();
        }
        const h = new Date().getHours();
        return h >= 6 && h < 10 ? "morning" : h >= 10 && h < 17 ? "day" : h >= 17 && h < 20 ? "evening" : "night";
    };

    /** @return {Array<string>} Flags of the current map (map_metadata). */
    const mapFlags = () => {
        const meta = window.$gameMap && PBS.mapMetadataFor($gameMap.mapId());
        return meta ? meta.flags || [] : [];
    };

    /** @return {Object} Context for evolution checks. */
    function evolutionContext(extra = {}) {
        const w = window.$gameScreen ? $gameScreen.weatherType() : "none";
        return Object.assign(
            {
                trigger: "check",
                timeOfDay: timeOfDay(),
                mapFlags: mapFlags(),
                mapId: window.$gameMap ? $gameMap.mapId() : 0,
                weather: w === "none" ? "" : w,
                party: window.$gameParty ? $gameParty.pokemon() : [],
                moveType: id => (PBS.moves.tryGet(id) || {}).type,
            },
            extra
        );
    }

    //-------------------------------------------------------------------------
    // Game_Pokemon
    //-------------------------------------------------------------------------

    /**
     * @brief A Pokémon: an MZ actor built from PBS species data. The actor
     *        and class data are synthetic and never saved; saves hold IDs.
     */
    class Game_Pokemon extends Game_Actor {
        /**
         * @param {string} speciesId Species (or form) ID.
         * @param {number} level Level.
         * @param {Object} [opts] {shiny, gender, nature, abilitySlot, ivs,
         *        evs, moves, nickname, heldItem, ball, friendship, otName,
         *        otId, egg}.
         */
        initialize(speciesId, level, opts = {}) {
            Game_Battler.prototype.initialize.call(this);
            this.setupPokemon(speciesId, level, opts);
        }

        /** @brief Fills a new Pokémon. */
        setupPokemon(speciesId, level, opts) {
            const species = PBS.species.get(speciesId);
            this._actorId = $gameActors.nextPokemonUid();
            this._speciesId = species.id;
            this._level = Math.max(1, Math.min(rules.maxLevel, level || 1));
            this._personality = randInt(0x100000000);
            this._nature = opts.nature || PBS.natures.ids()[randInt(PBS.natures.size)] || "";
            this._mint = "";
            this._gender = opts.gender || this.rollGender(species);
            this._abilitySlot = opts.abilitySlot || this.rollAbilitySlot(species);
            this._shiny = opts.shiny !== undefined ? !!opts.shiny : this.rollShiny();
            this._ivs = {};
            this._evs = {};
            for (const s of STATS) {
                this._ivs[s] = opts.ivs && opts.ivs[s] !== undefined ? opts.ivs[s] : typeof opts.ivs === "number" ? opts.ivs : randInt(32);
                this._evs[s] = (opts.evs && opts.evs[s]) || 0;
            }
            this._nickname = opts.nickname || "";
            this._heldItem = opts.heldItem || "";
            this._ball = opts.ball || "pokeball";
            this._friendship = opts.friendship !== undefined ? opts.friendship : species.baseFriendship;
            this._otName = opts.otName !== undefined ? opts.otName : window.$gameParty && $gameParty.leader() ? $gameParty.leader().name() : "";
            this._otId = opts.otId !== undefined ? opts.otId : window.$gamePokemon ? $gamePokemon.trainerId : 0;
            this._metMap = window.$gameMap ? $gameMap.mapId() : 0;
            this._metLevel = this._level;
            this._status = "";
            this._statusTurns = 0;
            this._ribbons = [];
            this._pokerus = 0;
            this._teraType = opts.teraType && PBS.types.has(opts.teraType) ? opts.teraType : species.types[0];
            this._dynamaxLevel = Math.max(0, Math.min(10, opts.dynamaxLevel || 0));
            this._gmaxFactor = !!opts.gmaxFactor;
            this._isEgg = !!opts.egg;
            this._eggSteps = this._isEgg ? species.eggCycles * rules.eggStepsPerCycle : 0;
            this._moves = [];
            this._moveBank = [];
            this._evolutionReady = [];
            this._classId = 0;
            this._exp = { 0: expForLevel(species.growthRate, this._level) };
            for (const id of opts.moves || species.movesUpTo(this._level).slice(-rules.moveSlots)) {
                this.learnMove(id);
            }
            this.recoverAll();
        }

        //---------------------------------------------------------------------
        // Rolls
        //---------------------------------------------------------------------

        /** @return {string} Random gender for a species. */
        rollGender(species) {
            const r = species.maleRatio;
            return r < 0 ? "genderless" : Math.random() < r ? "male" : "female";
        }

        /** @return {string} "0" or "1" (hidden abilities only on request). */
        rollAbilitySlot(species) {
            return species.abilities["1"] && Math.random() < 0.5 ? "1" : "0";
        }

        /** @return {boolean} A shiny roll with the charm/Masuda rolls. */
        rollShiny() {
            let rolls = rules.shinyRolls;
            if (window.$gameParty && $gameParty.bag && $gameParty.bag().count("shinycharm") > 0) {
                rolls += 2;
            }
            return Math.random() < rolls / rules.shinyOdds;
        }

        //---------------------------------------------------------------------
        // Data
        //---------------------------------------------------------------------

        /** @return {SpeciesData} Species (or form) data. */
        species() {
            return PBS.species.get(this._speciesId);
        }

        /** @return {string} Species (or form) ID. */
        get speciesId() {
            return this._speciesId;
        }

        /** @return {string} Base species ID. */
        get baseSpeciesId() {
            return this.species().baseId;
        }

        /** @return {number} Level. */
        get level() {
            return this._level;
        }

        /** @return {string} "male" | "female" | "genderless". */
        get gender() {
            return this._gender;
        }

        /** @return {boolean} Shiny. */
        get shiny() {
            return this._shiny;
        }

        /** @return {string} Held item ID ("" for none). */
        get heldItem() {
            return this._heldItem;
        }

        set heldItem(id) {
            this._heldItem = id || "";
            this.checkForm();
        }

        /** @return {number} Friendship (0-255). */
        get friendship() {
            return this._friendship;
        }

        /** @return {string} Nature ID. */
        get nature() {
            return this._nature;
        }

        /** @return {string} The nature used for stats (a mint's, if used). */
        statNature() {
            return this._mint || this._nature;
        }

        /** @return {string} Ability ID. */
        ability() {
            const a = this.species().abilities;
            return a[this._abilitySlot] || a["0"] || "";
        }

        /** @return {string} Ability slot ("0", "1", "H"). */
        get abilitySlot() {
            return this._abilitySlot;
        }

        /** @return {string} Tera Type ID. */
        get teraType() {
            return this._teraType || this.species().types[0];
        }

        set teraType(id) {
            this._teraType = id;
        }

        /** @return {number} Dynamax Level (0-10). */
        get dynamaxLevel() {
            return this._dynamaxLevel || 0;
        }

        set dynamaxLevel(n) {
            this._dynamaxLevel = Math.max(0, Math.min(10, n));
        }

        /** @return {boolean} True if it has the G-Max Factor. */
        get gmaxFactor() {
            return !!this._gmaxFactor;
        }

        set gmaxFactor(v) {
            this._gmaxFactor = !!v;
        }

        /** @return {Array<string>} Type IDs. */
        types() {
            return this.species().types.slice();
        }

        /** @return {boolean} True while an egg. */
        isEgg() {
            return this._isEgg;
        }

        /** @return {Object} IVs. */
        get ivs() {
            return Object.assign({}, this._ivs);
        }

        /** @return {Object} EVs. */
        get evs() {
            return Object.assign({}, this._evs);
        }

        /** @return {string} Non-volatile status (Showdown id: brn, par...). */
        get status() {
            return this._status;
        }

        set status(s) {
            this._status = s || "";
        }

        //---------------------------------------------------------------------
        // MZ actor bridge
        //---------------------------------------------------------------------

        /** @return {Object} Synthetic actor data (transient). */
        actor() {
            if (!this._actorCache || this._actorCache.species !== this._speciesId || this._actorCache.version !== Game_Pokemon.dataVersion) {
                const template = CONFIG.templateActor ? $dataActors[CONFIG.templateActor] : null;
                const data = {
                    id: this._actorId,
                    name: this.name(),
                    nickname: "",
                    profile: "",
                    classId: 0,
                    initialLevel: 1,
                    maxLevel: rules.maxLevel,
                    characterName: template ? template.characterName : "",
                    characterIndex: template ? template.characterIndex : 0,
                    faceName: "",
                    faceIndex: 0,
                    battlerName: "",
                    equips: [],
                    traits: template ? template.traits.slice() : [],
                    note: template ? template.note : "",
                    meta: template ? Object.assign({}, template.meta) : {},
                };
                Object.defineProperty(this, "_actorCache", {
                    value: { species: this._speciesId, version: Game_Pokemon.dataVersion, data },
                    writable: true,
                    configurable: true,
                    enumerable: false,
                });
            }
            return this._actorCache.data;
        }

        /** @return {Object} Synthetic class data. */
        currentClass() {
            const template = CONFIG.templateClass ? $dataClasses[CONFIG.templateClass] : null;
            if (!this._classCache || this._classCache.version !== Game_Pokemon.dataVersion) {
                Object.defineProperty(this, "_classCache", {
                    value: {
                        version: Game_Pokemon.dataVersion,
                        data: {
                            id: 0,
                            name: "",
                            expParams: [30, 20, 30, 30],
                            traits: template ? template.traits.slice() : [],
                            learnings: [],
                            params: [],
                            note: template ? template.note : "",
                            meta: template ? Object.assign({}, template.meta) : {},
                        },
                    },
                    writable: true,
                    configurable: true,
                    enumerable: false,
                });
            }
            return this._classCache.data;
        }

        /** @return {string} Nickname or the (localized) species name. */
        name() {
            if (this._isEgg) {
                return tr("Pkmn.Egg", "Egg");
            }
            return this._nickname || this.species().name;
        }

        /** @brief Sets the nickname ("" = species name). */
        setName(name) {
            this._nickname = name === this.species().name ? "" : String(name || "");
        }

        /** @return {string} The nickname ("" if none). */
        nickname() {
            return this._nickname;
        }

        setNickname(name) {
            this.setName(name);
        }

        /** @return {string} Pokédex text (localized). */
        profile() {
            return this.species().dexEntry || "";
        }

        /**
         * @brief Stat value.
         * @param {string} stat "hp" ... "spe".
         * @return {number} Value.
         */
        stat(stat) {
            const species = this.species();
            const nature = PBS.natures.tryGet(this.statNature());
            return calcStat(stat, species.baseStats[stat], this._ivs[stat], this._evs[stat], this._level, nature ? nature.modifier(stat) : 1);
        }

        /** @brief MZ params: 0 mhp, 2 atk, 3 def, 4 mat (SpA), 5 mdf (SpD), 6 agi. */
        paramBase(paramId) {
            const stat = ["hp", null, "atk", "def", "spa", "spd", "spe", null][paramId];
            return stat ? this.stat(stat) : 0;
        }

        /** @return {number} Highest MZ param value. */
        paramMax(paramId) {
            return paramId === 0 ? 99999 : 9999;
        }

        /** @brief EXP to reach a level (species growth rate). */
        expForLevel(level) {
            return expForLevel(this.species().growthRate, level);
        }

        /** @return {number} Max level. */
        maxLevel() {
            return rules.maxLevel;
        }

        /** @return {Array} No MZ skills (moves are separate). */
        skills() {
            return [];
        }

        /** @return {Array} No MZ equipment. */
        equipSlots() {
            return [];
        }

        initEquips() {
            this._equips = [];
        }

        /** @return {string} Character sheet used on the map (followers). */
        characterName() {
            return this.actor().characterName;
        }

        /** @return {number} Character index. */
        characterIndex() {
            return this.actor().characterIndex;
        }

        faceName() {
            return "";
        }

        battlerName() {
            return "";
        }

        /**
         * @brief Sets EXP; tracks new levels, HP and moves learned on the way.
         * @param {number} exp New EXP total.
         * @param {boolean} [show] Ignored (the flow shows messages).
         */
        changeExp(exp, show) {
            const lastLevel = this._level;
            const lastMhp = this.mhp;
            const max = this.expForLevel(rules.maxLevel);
            Game_Actor.prototype.changeExp.call(this, Math.min(exp, max), false);
            if (this._level !== lastLevel) {
                this._hp = Math.max(this.isDead() ? 0 : 1, Math.min(this.mhp, this._hp + (this.mhp - lastMhp)));
                if (this._level > lastLevel) {
                    this._pendingLevelUps = (this._pendingLevelUps || []).concat([{ from: lastLevel, to: this._level }]);
                    this.updateEvolutionReadiness({ trigger: "level" });
                }
            }
        }

        levelUp() {
            this._level++;
            const gain = this._friendship < 100 ? 5 : this._friendship < 200 ? 3 : 2;
            this.changeFriendship(gain);
        }

        /** @brief Adds EXP. */
        gainExp(exp) {
            this.changeExp(this.currentExp() + Math.round(exp), false);
        }

        /** @return {number} EXP total. */
        currentExp() {
            return this._exp[0] || 0;
        }

        /**
         * @brief Takes the level-ups since the last call.
         * @return {Array<{from, to}>} Level ranges.
         */
        takeLevelUps() {
            const list = this._pendingLevelUps || [];
            this._pendingLevelUps = [];
            return list;
        }

        /**
         * @brief Moves learned between two levels (from exclusive).
         * @param {number} from Old level.
         * @param {number} to New level.
         * @return {Array<string>} Move IDs.
         */
        newMovesBetween(from, to) {
            const out = [];
            for (const [lv, m] of this.species().moves.level || []) {
                if (lv > from && lv <= to && !out.includes(m) && !this.knowsMove(m)) {
                    out.push(m);
                }
            }
            return out;
        }

        //---------------------------------------------------------------------
        // Moves and the move bank
        //---------------------------------------------------------------------

        /** @return {Array<{id, pp, ppUps}>} Known moves. */
        moves() {
            return this._moves;
        }

        /** @return {Array<string>} Known move IDs. */
        moveIds() {
            return this._moves.map(m => m.id);
        }

        /** @return {boolean} True if the move is known. */
        knowsMove(id) {
            return this._moves.some(m => m.id === id);
        }

        /** @return {number} Max PP of a known move. */
        maxPp(slot) {
            const m = this._moves[slot];
            const data = m && PBS.moves.tryGet(m.id);
            return data ? Math.floor(data.pp * (1 + 0.2 * (m.ppUps || 0))) : 0;
        }

        /**
         * @brief Learns a move if there is a free slot (and banks it).
         * @param {string} id Move ID.
         * @return {boolean} True if learned now.
         */
        learnMove(id) {
            if (!PBS.moves.has(id) || this.knowsMove(id)) {
                return false;
            }
            this.bankMove(id);
            if (this._moves.length >= rules.moveSlots) {
                return false;
            }
            this._moves.push({ id, pp: PBS.moves.get(id).pp, ppUps: 0 });
            return true;
        }

        /**
         * @brief Replaces the move in a slot.
         * @param {number} slot Slot.
         * @param {string} id New move ID.
         */
        replaceMove(slot, id) {
            this.bankMove(id);
            this._moves[slot] = { id, pp: PBS.moves.get(id).pp, ppUps: 0 };
        }

        /** @brief Forgets a move (it stays in the move bank). */
        forgetMove(slot) {
            if (this._moves.length > 1) {
                this._moves.splice(slot, 1);
            }
        }

        /** @brief Swaps two move slots. */
        swapMoves(a, b) {
            const m = this._moves;
            [m[a], m[b]] = [m[b], m[a]];
        }

        /** @brief Remembers a move in the move bank. */
        bankMove(id) {
            if (!this._moveBank.includes(id)) {
                this._moveBank.push(id);
            }
        }

        /** @return {Array<string>} Every move this Pokémon has ever known. */
        moveBank() {
            return this._moveBank.slice();
        }

        /**
         * @brief Moves a move reminder can teach: level-up moves up to the
         *        current level plus the move bank, minus known moves.
         * @return {Array<string>} Move IDs.
         */
        rememberableMoves() {
            const out = [];
            for (const id of this.species().movesUpTo(this._level).concat(this._moveBank)) {
                if (!this.knowsMove(id) && !out.includes(id) && PBS.moves.has(id)) {
                    out.push(id);
                }
            }
            return out;
        }

        //---------------------------------------------------------------------
        // Health
        //---------------------------------------------------------------------

        /** @brief Full heal: HP, PP and status. */
        healAll() {
            this.recoverAll();
            this._status = "";
            this._statusTurns = 0;
            this._moves.forEach((m, i) => (m.pp = this.maxPp(i)));
        }

        /** @return {boolean} True if it can battle. */
        isAble() {
            return !this._isEgg && this.hp > 0;
        }

        //---------------------------------------------------------------------
        // Friendship, EVs, nature
        //---------------------------------------------------------------------

        /** @brief Changes friendship (0-255). */
        changeFriendship(n) {
            let d = n;
            if (d > 0 && this._ball === "luxuryball") {
                d += 1;
            }
            if (d > 0 && this._heldItem === "soothebell") {
                d = Math.floor(d * 1.5);
            }
            this._friendship = Math.max(0, Math.min(255, this._friendship + d));
        }

        /**
         * @brief Adds EVs within the caps.
         * @param {string} stat Stat.
         * @param {number} amount Amount (negative to lower).
         * @return {number} Change actually made.
         */
        gainEv(stat, amount) {
            const total = STATS.reduce((n, s) => n + this._evs[s], 0);
            let d = amount;
            if (d > 0) {
                d = Math.min(d, rules.evPerStat - this._evs[stat], rules.evTotal - total);
            } else {
                d = Math.max(d, -this._evs[stat]);
            }
            this._evs[stat] += d;
            this.refresh();
            return d;
        }

        /** @brief Sets the stat nature (mints). */
        setMint(nature) {
            this._mint = nature === this._nature ? "" : nature;
            this.refresh();
        }

        //---------------------------------------------------------------------
        // Evolution (Legends: Arceus style)
        //---------------------------------------------------------------------

        /**
         * @brief Evolution targets whose method passes now.
         * @param {Object} [extra] Context (trigger, item, partner...).
         * @return {Array<string>} Species IDs.
         */
        evolutionOptions(extra = {}) {
            if (this._isEgg) {
                return [];
            }
            const ctx = evolutionContext(extra);
            const out = [];
            for (const evo of this.species().evolutions || []) {
                const method = EvolutionMethods.get(evo.method);
                if (!method || !PBS.species.has(evo.species)) {
                    continue;
                }
                const trig = ctx.trigger;
                if (method.trigger === "item" && trig !== "item") {
                    continue;
                }
                if (method.trigger === "trade" && trig !== "trade") {
                    continue;
                }
                if (method.trigger === "level" && (trig === "item" || trig === "trade")) {
                    continue;
                }
                if (method.test(this, evo, ctx) && !out.includes(evo.species)) {
                    out.push(evo.species);
                }
            }
            return out;
        }

        /**
         * @brief Marks targets reached by level, friendship and similar
         *        methods. They stay ready until the player evolves.
         * @return {Array<string>} All ready targets.
         */
        updateEvolutionReadiness(extra = {}) {
            for (const id of this.evolutionOptions(extra)) {
                if (!this._evolutionReady.includes(id)) {
                    this._evolutionReady.push(id);
                }
            }
            return this.readyEvolutions();
        }

        /** @return {Array<string>} Targets the player can evolve into now. */
        readyEvolutions() {
            const valid = new Set((this.species().evolutions || []).map(e => e.species));
            this._evolutionReady = this._evolutionReady.filter(id => valid.has(id) && PBS.species.has(id));
            return this._evolutionReady.slice();
        }

        /** @return {boolean} True if the player can evolve it now. */
        canEvolve() {
            return this.readyEvolutions().length > 0;
        }

        /**
         * @brief Evolves now (no checks; the flow checks first).
         * @param {string} target Species ID.
         * @return {Array<string>} Moves to learn on evolution (level 0 and
         *         the current level) that did not fit.
         */
        evolve(target) {
            const from = this.species();
            const nicknamed = !!this._nickname;
            const lastMhp = this.mhp;
            this._speciesId = PBS.species.get(target).id;
            this._evolutionReady = [];
            if (!nicknamed) {
                this._nickname = "";
            }
            this._actorCache = null;
            this.refresh();
            this._hp = Math.max(this.isDead() ? 0 : 1, Math.min(this.mhp, this._hp + (this.mhp - lastMhp)));
            if (window.$gamePokemon) {
                $gamePokemon.pokedex.register(this, true);
            }
            const pending = [];
            for (const [lv, m] of this.species().moves.level || []) {
                if ((lv === 0 || lv === this._level) && !this.knowsMove(m) && !pending.includes(m)) {
                    pending.push(m);
                }
            }
            // Shedinja-style: a second Pokémon appears.
            for (const evo of from.evolutions || []) {
                if (evo.method === "shed" && window.$gameParty && $gameParty.pokemon().length < CONFIG.partySize && $gameParty.bag().count("pokeball") > 0) {
                    $gameParty.bag().lose("pokeball", 1);
                    const shed = PokeMZ.Pokemon.create(evo.species, this._level, { ivs: this.ivs, nature: this._nature });
                    $gameParty.addPokemon(shed);
                }
            }
            this.updateEvolutionReadiness();
            return pending.filter(m => !this.learnMove(m));
        }

        /** @brief Called when traded; trade evolutions happen now. */
        onTraded(partner) {
            const options = this.evolutionOptions({ trigger: "trade", partner });
            return options[0] || null;
        }

        //---------------------------------------------------------------------
        // Forms
        //---------------------------------------------------------------------

        /** @brief Applies form handlers (held items, time, map...). */
        checkForm() {
            const handler = FormHandlers.get(this.baseSpeciesId);
            if (!handler) {
                return;
            }
            const target = handler(this);
            if (target && target !== this._speciesId && PBS.species.has(target)) {
                const lastMhp = this.mhp;
                this._speciesId = target;
                this._actorCache = null;
                this.refresh();
                this._hp = Math.max(0, Math.min(this.mhp, this._hp + (this.mhp - lastMhp)));
            }
        }

        //---------------------------------------------------------------------
        // Showdown
        //---------------------------------------------------------------------

        /**
         * @brief Showdown team set for the battle simulator.
         * @return {Object} PokemonSet.
         */
        toShowdownSet() {
            const species = this.species();
            const nameOf = (reg, id) => {
                const e = id && PBS[reg].tryGet(id);
                return e ? e.sourceText("name") : "";
            };
            const item = this._heldItem && PBS.items.tryGet(this._heldItem);
            const nature = PBS.natures.tryGet(this.statNature());
            return {
                name: this.name(),
                species: species.showdownName,
                item: item && (item.showdown || item.custom) ? item.sourceText("name") : "",
                ability: nameOf("abilities", this.ability()),
                moves: this._moves.map(m => nameOf("moves", m.id)),
                nature: nature ? nature.sourceText("name") : "",
                gender: this._gender === "male" ? "M" : this._gender === "female" ? "F" : "N",
                evs: Object.assign({}, this._evs),
                ivs: Object.assign({}, this._ivs),
                level: this._level,
                shiny: this._shiny,
                happiness: this._friendship,
                pokeball: nameOf("items", this._ball),
                teraType: nameOf("types", this.teraType),
                dynamaxLevel: this.dynamaxLevel,
                gigantamax: this.gmaxFactor,
            };
        }
    }
    Game_Pokemon.dataVersion = 0;
    window.Game_Pokemon = Game_Pokemon;

    // Synthetic data follows hot reloads.
    PBS.onReload(() => {
        Game_Pokemon.dataVersion++;
        if (window.$gameActors) {
            for (const p of $gameActors.allPokemon()) {
                p.refresh();
            }
        }
    });

    //-------------------------------------------------------------------------
    // Game_Actors: Pokémon instances outside the database
    //-------------------------------------------------------------------------

    const _Game_Actors_initialize = Game_Actors.prototype.initialize;
    Game_Actors.prototype.initialize = function() {
        _Game_Actors_initialize.apply(this, arguments);
        this._pokemon = {};
        this._nextUid = CONFIG.uidBase;
    };

    const _Game_Actors_actor = Game_Actors.prototype.actor;
    Game_Actors.prototype.actor = function(actorId) {
        if (actorId >= CONFIG.uidBase) {
            return (this._pokemon && this._pokemon[actorId]) || null;
        }
        return _Game_Actors_actor.apply(this, arguments);
    };

    /** @return {number} A new Pokémon actor ID. */
    Game_Actors.prototype.nextPokemonUid = function() {
        if (!this._pokemon) {
            this._pokemon = {};
        }
        if (!this._nextUid || this._nextUid < CONFIG.uidBase) {
            this._nextUid = CONFIG.uidBase;
        }
        return this._nextUid++;
    };

    /** @brief Stores a Pokémon instance. */
    Game_Actors.prototype.addPokemon = function(pkmn) {
        this._pokemon[pkmn.actorId()] = pkmn;
    };

    /** @brief Deletes a Pokémon instance (released). */
    Game_Actors.prototype.deletePokemon = function(uid) {
        delete this._pokemon[uid];
    };

    /** @return {Array<Game_Pokemon>} Every Pokémon instance. */
    Game_Actors.prototype.allPokemon = function() {
        return Object.values(this._pokemon || {});
    };

    //-------------------------------------------------------------------------
    // Bag
    //-------------------------------------------------------------------------

    /**
     * @brief The bag: PBS item ID -> quantity, sorted into pockets.
     */
    class Game_Bag {
        constructor() {
            this._items = {};
            this._registered = [];
            this._lastPocket = "items";
        }

        /** @return {number} Stack cap of an item. */
        maxStack(id) {
            const item = PBS.items.tryGet(id);
            return item && item.isKeyItem ? 1 : 999;
        }

        /** @return {number} Quantity. */
        count(id) {
            return this._items[id] || 0;
        }

        /**
         * @brief Adds items.
         * @param {string} id Item ID.
         * @param {number} [n] Amount.
         * @return {number} Amount actually added.
         */
        gain(id, n = 1) {
            if (!PBS.items.has(id)) {
                console.warn(`[PokeMZ.Pokemon] unknown item "${id}"`);
                return 0;
            }
            const cur = this.count(id);
            const next = Math.max(0, Math.min(this.maxStack(id), cur + n));
            if (next) {
                this._items[id] = next;
            } else {
                delete this._items[id];
                this._registered = this._registered.filter(x => x !== id);
            }
            if (window.$gameMap) {
                $gameMap.requestRefresh();
            }
            return next - cur;
        }

        /** @brief Removes items. */
        lose(id, n = 1) {
            return -this.gain(id, -n);
        }

        /** @return {Array<string>} Pocket IDs. */
        pockets() {
            return PBS.enums.values("pockets");
        }

        /**
         * @brief Items of a pocket, sorted.
         * @param {string} pocket Pocket ID.
         * @return {Array<{item: ItemData, count: number}>} Entries.
         */
        pocketItems(pocket) {
            return Object.keys(this._items)
                .map(id => PBS.items.tryGet(id))
                .filter(item => item && item.pocket === pocket)
                .sort((a, b) => a.sort - b.sort || a.num - b.num)
                .map(item => ({ item, count: this._items[item.id] }));
        }

        /** @return {Array<string>} Registered key items. */
        registered() {
            return this._registered.slice();
        }

        /** @brief Registers or unregisters a key item. */
        toggleRegistered(id) {
            const i = this._registered.indexOf(id);
            if (i >= 0) {
                this._registered.splice(i, 1);
            } else {
                this._registered.push(id);
            }
        }
    }
    window.Game_Bag = Game_Bag;

    //-------------------------------------------------------------------------
    // Pokédex
    //-------------------------------------------------------------------------

    /**
     * @brief Seen/caught state. Entries (genus, text, size) unlock only
     *        when caught; seen species show their name and sprite only.
     */
    class Game_Pokedex {
        constructor() {
            this._seen = {};
            this._caught = {};
            this._forms = {};
            this._shiny = {};
            this._genders = {};
        }

        /**
         * @brief Records a Pokémon.
         * @param {Game_Pokemon|string} pkmn Pokémon or species ID.
         * @param {boolean} caught Also mark it caught (owned).
         */
        register(pkmn, caught) {
            const speciesId = typeof pkmn === "string" ? pkmn : pkmn.speciesId;
            const species = PBS.species.tryGet(speciesId);
            if (!species || (typeof pkmn !== "string" && pkmn.isEgg())) {
                return;
            }
            const base = species.baseId;
            this._seen[base] = 1;
            if (caught) {
                this._caught[base] = 1;
            }
            const forms = this._forms[base] || (this._forms[base] = []);
            if (!forms.includes(species.id)) {
                forms.push(species.id);
            }
            if (typeof pkmn !== "string") {
                if (pkmn.shiny) {
                    this._shiny[species.id] = 1;
                }
                const g = this._genders[base] || (this._genders[base] = []);
                if (!g.includes(pkmn.gender)) {
                    g.push(pkmn.gender);
                }
            }
        }

        /** @return {boolean} True if seen. */
        isSeen(id) {
            return !!this._seen[PBS.species.tryGet(id) ? PBS.species.get(id).baseId : id];
        }

        /** @return {boolean} True if caught. */
        isCaught(id) {
            return !!this._caught[PBS.species.tryGet(id) ? PBS.species.get(id).baseId : id];
        }

        /** @return {boolean} True if the full entry may be shown (caught). */
        canViewEntry(id) {
            return this.isCaught(id);
        }

        /** @return {Array<string>} Forms seen. */
        formsSeen(id) {
            return (this._forms[id] || []).slice();
        }

        /** @return {number} Seen count (optionally within a list). */
        seenCount(list) {
            return list ? list.filter(id => this.isSeen(id)).length : Object.keys(this._seen).length;
        }

        /** @return {number} Caught count (optionally within a list). */
        caughtCount(list) {
            return list ? list.filter(id => this.isCaught(id)).length : Object.keys(this._caught).length;
        }

        /**
         * @brief Species of a dex in order.
         * @param {string} [dex] Regional dex ID ("" = national).
         * @return {Array<string>} Species IDs.
         */
        list(dex) {
            if (dex && PBS.regionalDexes.has(dex)) {
                return PBS.regionalDexes.get(dex).species.slice();
            }
            return PBS.species
                .filter(s => !s.isForm && s.num > 0)
                .sort((a, b) => a.num - b.num)
                .map(s => s.id);
        }
    }
    window.Game_Pokedex = Game_Pokedex;

    //-------------------------------------------------------------------------
    // PC storage
    //-------------------------------------------------------------------------

    /**
     * @brief PC boxes holding Pokémon actor IDs (0 = empty slot).
     */
    class Game_PokemonStorage {
        constructor() {
            this._boxes = [];
            for (let i = 0; i < CONFIG.boxCount; i++) {
                this._boxes.push({ name: "", wallpaper: i % 16, slots: new Array(CONFIG.boxSize).fill(0) });
            }
            this._current = 0;
        }

        /** @return {number} Box count. */
        boxCount() {
            return this._boxes.length;
        }

        /** @return {number} Slots per box. */
        boxSize() {
            return CONFIG.boxSize;
        }

        /** @return {string} Box name (localized default). */
        boxName(b) {
            const box = this._boxes[b];
            return box && box.name ? box.name : tr("PC.BoxName", "Box {n}", { n: b + 1 });
        }

        /** @brief Renames a box ("" = default name). */
        setBoxName(b, name) {
            this._boxes[b].name = String(name || "");
        }

        /** @return {number} Wallpaper index. */
        wallpaper(b) {
            return this._boxes[b].wallpaper;
        }

        setWallpaper(b, w) {
            this._boxes[b].wallpaper = w;
        }

        /** @return {Game_Pokemon|null} Pokémon in a slot. */
        get(b, s) {
            const uid = this._boxes[b] && this._boxes[b].slots[s];
            return uid ? $gameActors.actor(uid) : null;
        }

        /** @return {Array<Game_Pokemon|null>} A box's slots. */
        box(b) {
            return this._boxes[b].slots.map(uid => (uid ? $gameActors.actor(uid) : null));
        }

        /**
         * @brief Stores a Pokémon in the first free slot (current box first).
         * @param {Game_Pokemon} pkmn Pokémon.
         * @return {{box: number, slot: number}|null} Where, or null if full.
         */
        deposit(pkmn) {
            for (let i = 0; i < this._boxes.length; i++) {
                const b = (this._current + i) % this._boxes.length;
                const s = this._boxes[b].slots.indexOf(0);
                if (s >= 0) {
                    this._boxes[b].slots[s] = pkmn.actorId();
                    $gameActors.addPokemon(pkmn);
                    return { box: b, slot: s };
                }
            }
            return null;
        }

        /** @brief Empties a slot and returns its Pokémon. */
        take(b, s) {
            const p = this.get(b, s);
            this._boxes[b].slots[s] = 0;
            return p;
        }

        /** @brief Puts a Pokémon (or nothing) in a slot; returns the old one. */
        put(b, s, pkmn) {
            const old = this.get(b, s);
            this._boxes[b].slots[s] = pkmn ? pkmn.actorId() : 0;
            if (pkmn) {
                $gameActors.addPokemon(pkmn);
            }
            return old;
        }

        /** @brief Releases a Pokémon (deleted for good). */
        release(b, s) {
            const p = this.take(b, s);
            if (p) {
                $gameActors.deletePokemon(p.actorId());
            }
            return p;
        }

        /** @return {boolean} True when every box is full. */
        isFull() {
            return this._boxes.every(b => !b.slots.includes(0));
        }

        /** @return {number} Current box. */
        get current() {
            return this._current;
        }

        set current(b) {
            this._current = (b + this._boxes.length) % this._boxes.length;
        }

        /**
         * @brief Finds Pokémon by a test.
         * @param {function(Game_Pokemon): boolean} fn Test.
         * @return {Array<{box, slot, pokemon}>} Matches.
         */
        search(fn) {
            const out = [];
            this._boxes.forEach((box, b) =>
                box.slots.forEach((uid, s) => {
                    const p = uid && $gameActors.actor(uid);
                    if (p && fn(p)) {
                        out.push({ box: b, slot: s, pokemon: p });
                    }
                })
            );
            return out;
        }
    }
    window.Game_PokemonStorage = Game_PokemonStorage;

    //-------------------------------------------------------------------------
    // Day care
    //-------------------------------------------------------------------------

    /**
     * @brief Two-slot day care: step EXP, egg generation, compatibility.
     */
    class Game_DayCare {
        constructor() {
            this._slots = [0, 0];
            this._steps = 0;
            this._egg = false;
        }

        /** @return {Array<Game_Pokemon|null>} Deposited Pokémon. */
        pokemon() {
            return this._slots.map(uid => (uid ? $gameActors.actor(uid) : null));
        }

        /** @return {number} Deposited count. */
        count() {
            return this._slots.filter(Boolean).length;
        }

        /** @brief Deposits a Pokémon (from the party). */
        deposit(pkmn) {
            const i = this._slots.indexOf(0);
            if (i < 0) {
                return false;
            }
            this._slots[i] = pkmn.actorId();
            $gameActors.addPokemon(pkmn);
            return true;
        }

        /** @brief Withdraws slot i. */
        withdraw(i) {
            const p = this.pokemon()[i];
            this._slots[i] = 0;
            this._egg = false;
            return p;
        }

        /** @return {number} Compatibility 0/20/50/70 (0 if not two). */
        compatibility() {
            const [a, b] = this.pokemon();
            if (!a || !b) {
                return 0;
            }
            const info = p => ({ species: p.species(), gender: p.gender, otId: p._otId });
            let c = compatibility(info(a), info(b));
            if (c && $gameParty.bag().count("ovalcharm")) {
                c = { 20: 40, 50: 80, 70: 88 }[c] || c;
            }
            return c;
        }

        /** @return {boolean} True if an egg is waiting. */
        hasEgg() {
            return this._egg;
        }

        /** @brief One player step. */
        onStep() {
            for (const p of this.pokemon()) {
                if (p && !p.isMaxLevel()) {
                    p.gainExp(rules.dayCareExpPerStep);
                    p.takeLevelUps().forEach(r => p.newMovesBetween(r.from, r.to).forEach(m => p.learnMove(m) || null));
                }
            }
            if (++this._steps >= 256) {
                this._steps = 0;
                if (!this._egg && Math.random() * 100 < this.compatibility()) {
                    this._egg = true;
                }
            }
        }

        /**
         * @brief Collects the egg.
         * @return {Game_Pokemon|null} The egg.
         */
        collectEgg() {
            if (!this._egg) {
                return null;
            }
            const [a, b] = this.pokemon();
            this._egg = false;
            const info = p => ({
                species: p.species(),
                gender: p.gender,
                ivs: p.ivs,
                nature: p.nature,
                abilitySlot: p.abilitySlot,
                ball: p._ball,
                moves: p.moveIds(),
                heldItem: p.heldItem,
                otId: p._otId,
            });
            const child = breed(info(a), info(b), PBS.registries);
            if (!child) {
                return null;
            }
            const sameOt = a._otId !== b._otId; // Masuda: different trainers
            const opts = { egg: true, ivs: child.ivs, abilitySlot: child.abilitySlot, ball: child.ball, moves: child.moves };
            if (child.nature) {
                opts.nature = child.nature;
            }
            const egg = PokeMZ.Pokemon.create(child.species, 1, opts);
            if (sameOt && Math.random() < (rules.shinyRolls + rules.masudaRolls) / rules.shinyOdds) {
                egg._shiny = true;
            }
            return egg;
        }
    }
    window.Game_DayCare = Game_DayCare;

    //-------------------------------------------------------------------------
    // $gamePokemon: storage, Pokédex, day care, field state (saved)
    //-------------------------------------------------------------------------

    /**
     * @brief Pokémon game state that is not on the party: PC storage,
     *        Pokédex, day care, repel steps, trainer ID.
     */
    class Game_PokemonState {
        constructor() {
            this.storage = new Game_PokemonStorage();
            this.pokedex = new Game_Pokedex();
            this.dayCare = new Game_DayCare();
            this.repelSteps = 0;
            this.lastRepel = "";
            this.trainerId = randInt(65536);
            this.secretId = randInt(65536);
            this.stepCounter = 0;
            this.lastHealSpot = null;
            this.teraCharged = true;
            this.visitedMaps = {};
            this.berries = {};
            this.trades = {};
        }
    }
    window.Game_PokemonState = Game_PokemonState;
    window.$gamePokemon = null;

    const _createGameObjects = DataManager.createGameObjects;
    DataManager.createGameObjects = function() {
        _createGameObjects.apply(this, arguments);
        window.$gamePokemon = new Game_PokemonState();
    };

    const _makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function() {
        const contents = _makeSaveContents.apply(this, arguments);
        contents.pokemon = window.$gamePokemon;
        return contents;
    };

    const _extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function(contents) {
        _extractSaveContents.apply(this, arguments);
        window.$gamePokemon = contents.pokemon || new Game_PokemonState();
        // Drop Pokémon whose species was removed from the PBS data.
        for (const p of $gameActors.allPokemon()) {
            if (!PBS.species.has(p.speciesId)) {
                console.warn(`[PokeMZ.Pokemon] species "${p.speciesId}" no longer exists; Pokémon ${p.actorId()} kept as-is`);
            }
        }
    };

    //-------------------------------------------------------------------------
    // Game_Party: the Pokémon party and the bag
    //-------------------------------------------------------------------------

    const _Game_Party_initialize = Game_Party.prototype.initialize;
    Game_Party.prototype.initialize = function() {
        _Game_Party_initialize.apply(this, arguments);
        this._pokemonParty = [];
        this._bag = new Game_Bag();
    };

    /** @return {Array<Game_Pokemon>} Party Pokémon (eggs included). */
    Game_Party.prototype.pokemon = function() {
        return (this._pokemonParty || []).map(uid => $gameActors.actor(uid)).filter(Boolean);
    };

    /** @return {Array<Game_Pokemon>} Pokémon that can battle. */
    Game_Party.prototype.ablePokemon = function() {
        return this.pokemon().filter(p => p.isAble());
    };

    /** @return {Game_Bag} The bag. */
    Game_Party.prototype.bag = function() {
        if (!this._bag) {
            this._bag = new Game_Bag();
        }
        return this._bag;
    };

    /** @return {number} Party size limit. */
    Game_Party.prototype.maxPokemon = function() {
        return CONFIG.partySize;
    };

    /**
     * @brief Adds a Pokémon to the party, or the PC when the party is full.
     * @param {Game_Pokemon} pkmn Pokémon.
     * @return {{party: boolean, box?: number, slot?: number}|null} Where it
     *         went (null when the PC is full too).
     */
    Game_Party.prototype.addPokemon = function(pkmn) {
        if (!this._pokemonParty) {
            this._pokemonParty = [];
        }
        $gameActors.addPokemon(pkmn);
        $gamePokemon.pokedex.register(pkmn, true);
        if (this._pokemonParty.length < CONFIG.partySize) {
            this._pokemonParty.push(pkmn.actorId());
            $gameMap.requestRefresh();
            return { party: true };
        }
        const where = $gamePokemon.storage.deposit(pkmn);
        return where ? Object.assign({ party: false }, where) : null;
    };

    /** @brief Removes a Pokémon from the party (it still exists). */
    Game_Party.prototype.removePokemon = function(pkmn) {
        const uid = typeof pkmn === "number" ? pkmn : pkmn.actorId();
        this._pokemonParty = this._pokemonParty.filter(x => x !== uid);
        $gameMap.requestRefresh();
    };

    /** @brief Swaps two party slots. */
    Game_Party.prototype.swapPokemon = function(a, b) {
        const p = this._pokemonParty;
        [p[a], p[b]] = [p[b], p[a]];
    };

    /** @brief Sets a party slot (PC moves). */
    Game_Party.prototype.setPokemonAt = function(i, pkmn) {
        if (pkmn) {
            $gameActors.addPokemon(pkmn);
            this._pokemonParty[i] = pkmn.actorId();
        } else {
            this._pokemonParty.splice(i, 1);
        }
    };

    /** @brief Fully heals the party. */
    Game_Party.prototype.healPokemon = function() {
        for (const p of this.pokemon()) {
            p.healAll();
        }
        if (window.$gamePokemon) {
            $gamePokemon.teraCharged = true;
        }
    };

    // Linked MZ items go through the bag, so event commands keep working.
    const pbsId = item => (item && DataManager.isItem(item) && item.pbs) || null;

    const _gainItem = Game_Party.prototype.gainItem;
    Game_Party.prototype.gainItem = function(item, amount, includeEquip) {
        const id = pbsId(item);
        if (id) {
            this.bag().gain(id, amount);
            return;
        }
        _gainItem.apply(this, arguments);
    };

    const _numItems = Game_Party.prototype.numItems;
    Game_Party.prototype.numItems = function(item) {
        const id = pbsId(item);
        return id ? this.bag().count(id) : _numItems.apply(this, arguments);
    };

    const _maxItems = Game_Party.prototype.maxItems;
    Game_Party.prototype.maxItems = function(item) {
        const id = pbsId(item);
        return id ? this.bag().maxStack(id) : _maxItems.apply(this, arguments);
    };

    const _items = Game_Party.prototype.items;
    Game_Party.prototype.items = function() {
        const list = _items.apply(this, arguments);
        for (const id of Object.keys(this.bag()._items)) {
            const item = PBS.items.tryGet(id);
            const db = item && item.dbItem;
            if (db && !list.includes(db)) {
                list.push(db);
            }
        }
        return list;
    };

    //-------------------------------------------------------------------------
    // Steps: repel, day care, eggs, friendship, encounters
    //-------------------------------------------------------------------------

    const _increaseSteps = Game_Player.prototype.increaseSteps;
    Game_Player.prototype.increaseSteps = function() {
        _increaseSteps.apply(this, arguments);
        if (!this.isNormal() || !window.$gamePokemon) {
            return;
        }
        const st = $gamePokemon;
        st.stepCounter++;
        if (st.repelSteps > 0 && --st.repelSteps === 0) {
            Flow.repelWoreOff();
        }
        st.dayCare.onStep();
        const party = $gameParty.pokemon();
        const fast = party.some(p => !p.isEgg() && ["flamebody", "magmaarmor", "steamengine"].includes(p.ability()));
        for (const p of party) {
            if (p.isEgg()) {
                p._eggSteps -= fast ? 2 : 1;
                if (p._eggSteps <= 0) {
                    Flow.hatch(p);
                }
            } else if (st.stepCounter % rules.friendshipStepInterval === 0) {
                p.changeFriendship(1);
            }
        }
    };

    /**
     * @brief Encounter types: name -> test() -> boolean (is the player on
     *        this kind of ground now). The first passing type with a table
     *        on the map is used.
     */
    const EncounterTypes = {
        list: [],

        /**
         * @brief Registers a type test (checked before built-ins).
         * @param {string} name Encounter type.
         * @param {function(): boolean} test Test.
         */
        register(name, test) {
            this.list = this.list.filter(t => t.name !== name);
            this.list.unshift({ name, test });
            PBS.enums.add("encounterTypes", name);
        },

        /** @return {string|null} Encounter type for the player's tile. */
        current(table) {
            for (const t of this.list) {
                if (table.types[t.name] && t.test(table)) {
                    return t.name;
                }
            }
            return null;
        },
    };
    const onWater = () => $gamePlayer.isInBoat() || $gamePlayer.isInShip();
    const onGrass = () => {
        const x = $gamePlayer.x;
        const y = $gamePlayer.y;
        return $gameMap.isBush(x, y) || (CONFIG.grassTerrainTag ? $gameMap.terrainTag(x, y) === CONFIG.grassTerrainTag : true);
    };
    EncounterTypes.list.push(
        { name: "water", test: onWater },
        { name: "landnight", test: () => !onWater() && onGrass() && timeOfDay() === "night" },
        { name: "landmorning", test: () => !onWater() && onGrass() && timeOfDay() === "morning" },
        { name: "landday", test: () => !onWater() && onGrass() && timeOfDay() !== "night" },
        { name: "cave", test: () => !onWater() },
        { name: "land", test: () => !onWater() && onGrass() }
    );

    /**
     * @brief Rolls a wild encounter for this step.
     * @return {{species, level, type}|null} The encounter.
     */
    function rollEncounter() {
        const table = PBS.encountersFor($gameMap.mapId());
        if (!table) {
            return null;
        }
        const type = EncounterTypes.current(table);
        if (!type) {
            return null;
        }
        const density = table.types[type].density;
        if (Math.random() * CONFIG.encounterDivisor >= density) {
            return null;
        }
        const enc = table.roll(type);
        if (!enc) {
            return null;
        }
        const lead = $gameParty.ablePokemon()[0];
        if ($gamePokemon.repelSteps > 0 && lead && enc.level < lead.level) {
            return null;
        }
        const doubles = table.types[type].doubles || 0;
        if (doubles && Math.random() * 100 < doubles && $gameParty.ablePokemon().length > 1) {
            const second = table.roll(type);
            if (second) {
                enc.second = second;
            }
        }
        return Object.assign(enc, { type });
    }

    const _executeEncounter = Game_Player.prototype.executeEncounter;
    Game_Player.prototype.executeEncounter = function() {
        if (PBS.encountersFor($gameMap.mapId())) {
            if ($gameMap.isEventRunning() || !this.canEncounter() || !$gameParty.ablePokemon().length || this._pbsStepChecked === $gamePokemon.stepCounter) {
                return false;
            }
            this._pbsStepChecked = $gamePokemon.stepCounter;
            const enc = rollEncounter();
            if (enc && PokeMZ.Battle && PokeMZ.Battle.startWild) {
                // The battle screen is pushed by startWild; returning false
                // keeps Scene_Map from pushing MZ's Scene_Battle.
                PokeMZ.Battle.startWild(enc.species, enc.level, { encounterType: enc.type, second: enc.second });
            }
            return false;
        }
        return _executeEncounter.apply(this, arguments);
    };

    /** @brief Rolls a fishing (or other item) encounter of a type. */
    function rollTypedEncounter(type) {
        const table = PBS.encountersFor($gameMap.mapId());
        return table && table.types[type] ? Object.assign(table.roll(type) || {}, { type }) : null;
    }

    //-------------------------------------------------------------------------
    // Form handlers and field moves
    //-------------------------------------------------------------------------

    /** @brief Base species ID -> (pkmn) => form species ID. */
    const FormHandlers = {
        map: new Map(),
        register(species, fn) {
            this.map.set(species, fn);
        },
        get(species) {
            return this.map.get(species) || null;
        },
    };

    /** @brief Move ID -> {canUse(pkmn), use(pkmn) => Promise}. */
    const FieldMoves = {
        map: new Map(),
        register(move, handler) {
            this.map.set(move, handler);
        },
        /** @return {Array<string>} Field moves a Pokémon can use now. */
        usable(pkmn) {
            return pkmn.moveIds().filter(id => {
                const h = this.map.get(id);
                return h && (!h.canUse || h.canUse(pkmn));
            });
        },
        get(move) {
            return this.map.get(move) || null;
        },
    };

    //-------------------------------------------------------------------------
    // Item handlers
    //-------------------------------------------------------------------------

    /**
     * @brief Item behaviour, keyed by effect name (items.json "effect") or
     *        item ID. Handlers: {target: "pokemon" | "none" | "move",
     *        canUse(pkmn, item, params), use(pkmn, item, params, ctx) =>
     *        Promise<boolean> (true = used, the item is consumed)}.
     */
    const ItemHandlers = {
        map: new Map(),

        /** @brief Registers a handler. */
        register(name, handler) {
            this.map.set(name, Object.assign({ target: "pokemon" }, handler));
        },

        /**
         * @brief Finds the handler of an item.
         * @param {ItemData} item Item.
         * @return {Object|null} Handler.
         */
        of(item) {
            if (!item) {
                return null;
            }
            if (this.map.has(item.id)) {
                return this.map.get(item.id);
            }
            if (item.effect && this.map.has(item.effect)) {
                return this.map.get(item.effect);
            }
            if (item.move && (item.fieldUse === "tm" || item.fieldUse === "tr" || item.fieldUse === "hm" || item.pocket === "tms")) {
                return this.map.get("tm");
            }
            if (/mint$/.test(item.id) && PBS.natures.has(item.id.replace(/mint$/, ""))) {
                return this.map.get("mint");
            }
            if (item.hasFlag("evolution")) {
                return this.map.get("evolution");
            }
            return null;
        },

        /** @return {boolean} True if the item can be used in the field. */
        usableInField(item) {
            const h = this.of(item);
            return !!h && h.target !== "battle";
        },
    };

    const say = text => Flow.message(text);
    const P = (item, key) => (item.params && item.params[key] !== undefined ? item.params[key] : undefined);

    ItemHandlers.register("heal", {
        canUse(pk, item) {
            const hp = P(item, "hp");
            const st = P(item, "status");
            if (pk.isEgg() || pk.hp <= 0) {
                return false;
            }
            const needHp = hp !== undefined && pk.hp < pk.mhp;
            const needStatus = st !== undefined && pk.status && (st === "all" || [].concat(st).includes(pk.status));
            return needHp || needStatus;
        },
        async use(pk, item) {
            const hp = P(item, "hp");
            const st = P(item, "status");
            const before = pk.hp;
            if (hp !== undefined) {
                const amount = hp === "full" ? pk.mhp : hp < 1 ? Math.floor(pk.mhp * hp) : hp;
                pk.setHp(Math.min(pk.mhp, pk.hp + amount));
            }
            const cured = st !== undefined && pk.status && (st === "all" || [].concat(st).includes(pk.status));
            if (cured) {
                pk.status = "";
            }
            if (P(item, "friendship")) {
                pk.changeFriendship(P(item, "friendship"));
            }
            if (pk.hp > before) {
                await say(tr("Item.Msg.HpRestored", "{name}'s HP was restored by {n} point(s).", { name: pk.name(), n: pk.hp - before }));
            } else if (cured) {
                await say(tr("Item.Msg.StatusCured", "{name} was cured of its status condition.", { name: pk.name() }));
            }
            return true;
        },
    });

    ItemHandlers.register("revive", {
        canUse: pk => !pk.isEgg() && pk.hp <= 0,
        async use(pk, item) {
            pk.setHp(Math.max(1, Math.floor(pk.mhp * (P(item, "hp") || 0.5))));
            pk.status = "";
            if (P(item, "friendship")) {
                pk.changeFriendship(P(item, "friendship"));
            }
            await say(tr("Item.Msg.Revived", "{name} was revived!", { name: pk.name() }));
            return true;
        },
    });

    ItemHandlers.register("pp", {
        canUse: pk => !pk.isEgg() && pk.moves().some((m, i) => m.pp < pk.maxPp(i)),
        async use(pk, item, params, ctx) {
            const amount = P(item, "pp");
            const restore = i => {
                const m = pk.moves()[i];
                const before = m.pp;
                m.pp = amount === "full" ? pk.maxPp(i) : Math.min(pk.maxPp(i), m.pp + amount);
                return m.pp - before;
            };
            if (P(item, "all")) {
                pk.moves().forEach((m, i) => restore(i));
            } else {
                const slot = await ctx.chooseMove(pk, tr("Item.Msg.RestoreWhichMove", "Restore which move?"));
                if (slot < 0 || !restore(slot)) {
                    return false;
                }
            }
            await say(tr("Item.Msg.PpRestored", "PP was restored.", { name: pk.name() }));
            return true;
        },
    });

    ItemHandlers.register("ppup", {
        canUse: pk => !pk.isEgg() && pk.moves().some(m => (m.ppUps || 0) < 3),
        async use(pk, item, params, ctx) {
            const slot = await ctx.chooseMove(pk, tr("Item.Msg.BoostWhichMove", "Boost PP of which move?"));
            const m = pk.moves()[slot];
            if (!m || (m.ppUps || 0) >= 3) {
                return false;
            }
            const before = pk.maxPp(slot);
            m.ppUps = Math.min(3, (m.ppUps || 0) + (P(item, "ups") || 1));
            m.pp += pk.maxPp(slot) - before;
            await say(tr("Item.Msg.PpIncreased", "{move}'s PP increased.", { move: PBS.moves.get(m.id).name }));
            return true;
        },
    });

    ItemHandlers.register("ev", {
        canUse: (pk, item) => !pk.isEgg() && pk.evs[P(item, "stat")] < rules.evPerStat,
        async use(pk, item) {
            const stat = P(item, "stat");
            const d = pk.gainEv(stat, P(item, "amount") || 10);
            if (!d) {
                await say(tr("Item.Msg.NoEffect", "It won't have any effect."));
                return false;
            }
            pk.changeFriendship(pk.friendship < 100 ? 5 : pk.friendship < 200 ? 3 : 2);
            await say(tr("Item.Msg.StatRose", "{name}'s {stat} rose.", { name: pk.name(), stat: tr(`Stat.${stat}`, stat) }));
            return true;
        },
    });

    ItemHandlers.register("level", {
        canUse: pk => !pk.isEgg() && !pk.isMaxLevel(),
        async use(pk, item) {
            const levels = P(item, "levels") || 1;
            pk.changeExp(pk.expForLevel(Math.min(rules.maxLevel, pk.level + levels)), false);
            if (pk.hp <= 0) {
                pk.setHp(1);
            }
            await Flow.afterExp(pk);
            return true;
        },
    });

    ItemHandlers.register("exp", {
        canUse: pk => !pk.isEgg() && !pk.isMaxLevel(),
        async use(pk, item) {
            const exp = P(item, "exp") || 100;
            await say(tr("Item.Msg.GainedExp", "{name} gained {n} Exp. Points!", { name: pk.name(), n: exp }));
            pk.gainExp(exp);
            await Flow.afterExp(pk);
            return true;
        },
    });

    ItemHandlers.register("mint", {
        canUse: (pk, item) => !pk.isEgg() && pk.statNature() !== item.id.replace(/mint$/, ""),
        async use(pk, item) {
            pk.setMint(item.id.replace(/mint$/, ""));
            await say(tr("Item.Msg.Mint", "{name}'s stats may have changed due to the effects of the mint!", { name: pk.name() }));
            return true;
        },
    });

    ItemHandlers.register("abilitycapsule", {
        canUse: pk => !pk.isEgg() && pk.abilitySlot !== "H" && !!pk.species().abilities["1"],
        async use(pk) {
            const to = pk.abilitySlot === "0" ? "1" : "0";
            const name = (PBS.abilities.tryGet(pk.species().abilities[to]) || {}).name || "";
            if (!(await Flow.confirm(tr("Item.Msg.ChangeAbility", "Change {name}'s Ability to {ability}?", { name: pk.name(), ability: name })))) {
                return false;
            }
            pk._abilitySlot = to;
            await say(tr("Item.Msg.AbilityChanged", "{name}'s Ability changed to {ability}!", { name: pk.name(), ability: name }));
            return true;
        },
    });

    ItemHandlers.register("abilitypatch", {
        canUse: pk => !pk.isEgg() && !!pk.species().abilities.H && pk.abilitySlot !== "H",
        async use(pk) {
            const name = (PBS.abilities.tryGet(pk.species().abilities.H) || {}).name || "";
            if (!(await Flow.confirm(tr("Item.Msg.ChangeAbility", "Change {name}'s Ability to {ability}?", { name: pk.name(), ability: name })))) {
                return false;
            }
            pk._abilitySlot = "H";
            await say(tr("Item.Msg.AbilityChanged", "{name}'s Ability changed to {ability}!", { name: pk.name(), ability: name }));
            return true;
        },
    });

    ItemHandlers.register("evolution", {
        canUse: (pk, item) => pk.evolutionOptions({ trigger: "item", item: item.id }).length > 0,
        async use(pk, item) {
            const options = pk.evolutionOptions({ trigger: "item", item: item.id });
            const target = options.length > 1 ? await Flow.chooseEvolution(pk, options) : options[0];
            return target ? Flow.evolve(pk, target) : false;
        },
    });

    ItemHandlers.register("tm", {
        canUse: (pk, item) => !pk.isEgg() && !!item.move && pk.species().canLearn(item.move) && !pk.knowsMove(item.move),
        async use(pk, item) {
            const learned = await Flow.teachMove(pk, item.move);
            return learned && item.fieldUse !== "tm" ? true : learned ? "keep" : false;
        },
    });

    ItemHandlers.register("repel", {
        target: "none",
        canUse: () => true,
        async use(_, item) {
            if ($gamePokemon.repelSteps > 0) {
                await say(tr("Item.Msg.RepelActive", "The effects of the previous repellent are still active."));
                return false;
            }
            $gamePokemon.repelSteps = P(item, "steps") || 100;
            $gamePokemon.lastRepel = item.id;
            await say(tr("Item.Msg.RepelUsed", "You used the {item}.", { item: item.name }));
            return true;
        },
    });

    ItemHandlers.register("escaperope", {
        target: "none",
        canUse: () => {
            const meta = PBS.mapMetadataFor($gameMap.mapId());
            return !!$gamePokemon.lastHealSpot && !!meta && !meta.outdoor && meta.canEscape !== false;
        },
        async use() {
            const [mapId, x, y] = $gamePokemon.lastHealSpot;
            $gamePlayer.reserveTransfer(mapId, x, y, 2, 0);
            return true;
        },
    });

    ItemHandlers.register("bicycle", {
        target: "none",
        canUse: () => {
            const meta = PBS.mapMetadataFor($gameMap.mapId());
            return !!meta && (meta.bicycle || meta.outdoor);
        },
        async use() {
            $gamePokemon.onBicycle = !$gamePokemon.onBicycle;
            return "keep";
        },
    });

    ItemHandlers.register("rod", {
        target: "none",
        canUse: () => {
            const d = $gamePlayer.direction();
            const x = $gameMap.roundXWithDirection($gamePlayer.x, d);
            const y = $gameMap.roundYWithDirection($gamePlayer.y, d);
            return $gameMap.isBoatPassable(x, y);
        },
        async use(_, item) {
            const enc = rollTypedEncounter(P(item, "type"));
            if (enc && enc.species && Math.random() < 0.75 && PokeMZ.Battle && PokeMZ.Battle.startWild) {
                await say(tr("Item.Msg.Bite", "Oh! A bite!"));
                PokeMZ.Battle.startWild(enc.species, enc.level, { encounterType: enc.type });
            } else {
                await say(tr("Item.Msg.NoBite", "Not even a nibble..."));
            }
            return "keep";
        },
    });

    ItemHandlers.register("townmap", {
        target: "none",
        canUse: () => true,
        async use() {
            if (window.PokeMZ.UI && PokeMZ.UI.screens.has("townMap")) {
                PokeMZ.UI.openScreen("townMap");
            }
            return "keep";
        },
    });

    ItemHandlers.register("terashard", {
        canUse: (pk, item) => !pk.isEgg() && $gameParty.bag().count(item.id) >= (P(item, "count") || 50) && pk.teraType !== P(item, "type"),
        async use(pk, item) {
            const type = P(item, "type");
            const n = P(item, "count") || 50;
            if (!(await Flow.confirm(tr("Item.Msg.TeraConfirm", "Use {n} {item} to change {name}'s Tera Type to {type}?", { n, item: item.name, name: pk.name(), type: PBS.types.get(type).name })))) {
                return false;
            }
            $gameParty.bag().lose(item.id, n - 1);
            pk.teraType = type;
            await say(tr("Item.Msg.TeraChanged", "{name}'s Tera Type is now {type}!", { name: pk.name(), type: PBS.types.get(type).name }));
            return true;
        },
    });

    ItemHandlers.register("dynamaxcandy", {
        canUse: pk => !pk.isEgg() && pk.dynamaxLevel < 10,
        async use(pk) {
            pk.dynamaxLevel += 1;
            await say(tr("Item.Msg.DynamaxLevel", "{name}'s Dynamax Level rose to {n}!", { name: pk.name(), n: pk.dynamaxLevel }));
            return true;
        },
    });

    ItemHandlers.register("maxsoup", {
        canUse: pk => !pk.isEgg() && PBS.species.has(`${pk.baseSpeciesId}gmax`),
        async use(pk) {
            pk.gmaxFactor = !pk.gmaxFactor;
            await say(
                pk.gmaxFactor
                    ? tr("Item.Msg.GmaxOn", "{name} can now Gigantamax!", { name: pk.name() })
                    : tr("Item.Msg.GmaxOff", "{name} can no longer Gigantamax.", { name: pk.name() })
            );
            return true;
        },
    });

    // Battle-only effects (used through PokeMZ_PBS_Battle).
    ItemHandlers.register("ball", { target: "battle", canUse: () => false, use: async () => false });
    ItemHandlers.register("xitem", { target: "battle", canUse: () => false, use: async () => false });

    /**
     * @brief Uses an item from the bag in the field.
     * @param {string} id Item ID.
     * @param {Game_Pokemon|null} pkmn Target (for Pokémon items).
     * @param {Object} [ctx] {chooseMove(pkmn, prompt) => Promise<slot>}.
     * @return {Promise<boolean>} True if used.
     */
    async function useItem(id, pkmn, ctx = {}) {
        const item = PBS.items.get(id);
        const h = ItemHandlers.of(item);
        const bag = $gameParty.bag();
        if (!h || bag.count(id) <= 0) {
            SoundManager.playBuzzer();
            return false;
        }
        const c = Object.assign({ chooseMove: Flow.chooseMove }, ctx);
        if (!h.canUse || !h.canUse(pkmn, item, item.params || {})) {
            await say(tr("Item.Msg.NoEffect", "It won't have any effect."));
            return false;
        }
        const result = await h.use(pkmn, item, item.params || {}, c);
        if (result === true && item.consumable !== false && !item.isKeyItem) {
            bag.lose(id, 1);
        }
        return !!result;
    }

    //-------------------------------------------------------------------------
    // Flow: messages and choices for level-ups, moves, evolution, hatching
    //-------------------------------------------------------------------------

    /**
     * @brief Async game flows. The UI plugin replaces chooseMoveToForget,
     *        evolutionScene, chooseMove and chooseEvolution with screens.
     */
    const Flow = {
        /** @brief Shows a message (Preact UI, else console). */
        message(text) {
            const UI = window.PokeMZ.UI;
            if (UI && UI.message) {
                return UI.message(text);
            }
            console.info(text);
            return Promise.resolve();
        },

        /** @return {Promise<boolean>} Yes/no. */
        confirm(text) {
            const UI = window.PokeMZ.UI;
            return UI && UI.confirm ? UI.confirm(text) : Promise.resolve(true);
        },

        /**
         * @brief Asks which move to forget for a new one.
         * @return {Promise<number>} Slot, or -1 to give up the new move.
         */
        chooseMoveToForget(/* pkmn, newMove */) {
            return Promise.resolve(-1);
        },

        /** @return {Promise<number>} A move slot (-1 = cancel). */
        chooseMove(pkmn, prompt) {
            const UI = window.PokeMZ.UI;
            if (UI && UI.choose) {
                const names = pkmn.moves().map((m, i) => `${PBS.moves.get(m.id).name}  ${m.pp}/${pkmn.maxPp(i)}`);
                return UI.choose(names, { text: prompt, cancel: -1 });
            }
            return Promise.resolve(0);
        },

        /** @return {Promise<string|null>} An evolution target. */
        chooseEvolution(pkmn, options) {
            const UI = window.PokeMZ.UI;
            if (UI && UI.choose) {
                return UI.choose(
                    options.map(id => PBS.species.get(id).name),
                    { text: tr("Evolution.Choose", "Evolve {name} into which Pokémon?", { name: pkmn.name() }), cancel: -1 }
                ).then(i => (i >= 0 ? options[i] : null));
            }
            return Promise.resolve(options[0] || null);
        },

        /**
         * @brief Plays the evolution scene.
         * @return {Promise<boolean>} False if the player cancelled.
         */
        evolutionScene(/* pkmn, target */) {
            return Promise.resolve(true);
        },

        /**
         * @brief Teaches a move, asking which move to forget if needed.
         * @param {Game_Pokemon} pkmn Pokémon.
         * @param {string} move Move ID.
         * @return {Promise<boolean>} True if learned.
         */
        async teachMove(pkmn, move) {
            const name = PBS.moves.get(move).name;
            if (pkmn.learnMove(move)) {
                await this.message(tr("Move.Msg.Learned", "{name} learned {move}!", { name: pkmn.name(), move: name }));
                return true;
            }
            if (pkmn.knowsMove(move)) {
                return false;
            }
            for (;;) {
                const want = await this.confirm(
                    tr("Move.Msg.WantsToLearn", "{name} wants to learn {move}, but it already knows four moves. Forget a move to make room?", {
                        name: pkmn.name(),
                        move: name,
                    })
                );
                if (want) {
                    const slot = await this.chooseMoveToForget(pkmn, move);
                    if (slot >= 0) {
                        const old = PBS.moves.get(pkmn.moves()[slot].id).name;
                        pkmn.replaceMove(slot, move);
                        await this.message(
                            tr("Move.Msg.Forgot", "{name} forgot {old}... and learned {move}!", { name: pkmn.name(), old, move: name })
                        );
                        return true;
                    }
                }
                if (await this.confirm(tr("Move.Msg.GiveUp", "Stop trying to teach {move}?", { move: name }))) {
                    await this.message(tr("Move.Msg.DidNotLearn", "{name} did not learn {move}.", { name: pkmn.name(), move: name }));
                    return false;
                }
            }
        },

        /**
         * @brief After EXP changes: level-up messages, new moves and the
         *        "can evolve" notice (no automatic evolution).
         * @param {Game_Pokemon} pkmn Pokémon.
         */
        async afterExp(pkmn) {
            const wasReady = pkmn.canEvolve();
            for (const { from, to } of pkmn.takeLevelUps()) {
                await this.message(tr("Pkmn.Msg.GrewToLevel", "{name} grew to Lv. {level}!", { name: pkmn.name(), level: to }));
                for (const move of pkmn.newMovesBetween(from, to)) {
                    await this.teachMove(pkmn, move);
                }
            }
            if (pkmn.canEvolve() && !wasReady) {
                await this.message(tr("Evolution.Ready", "{name} can now evolve! Evolve it from the party menu.", { name: pkmn.name() }));
            }
        },

        /**
         * @brief Evolves a Pokémon with the evolution scene.
         * @return {Promise<boolean>} True if it evolved.
         */
        async evolve(pkmn, target) {
            const oldName = pkmn.name();
            const ok = await this.evolutionScene(pkmn, target);
            if (!ok) {
                await this.message(tr("Evolution.Stopped", "Huh? {name} stopped evolving!", { name: oldName }));
                return false;
            }
            const pending = pkmn.evolve(target);
            await this.message(
                tr("Evolution.Done", "Congratulations! Your {old} evolved into {species}!", { old: oldName, species: PBS.species.get(target).name })
            );
            for (const m of pending) {
                await this.teachMove(pkmn, m);
            }
            return true;
        },

        /** @brief Evolves into a ready target (asks if several). */
        async evolveReady(pkmn) {
            const options = pkmn.readyEvolutions();
            if (!options.length) {
                return false;
            }
            const target = options.length > 1 ? await this.chooseEvolution(pkmn, options) : options[0];
            return target ? this.evolve(pkmn, target) : false;
        },

        /** @brief Plays the egg hatch sequence. */
        async hatch(pkmn) {
            if (pkmn._hatching) {
                return;
            }
            pkmn._hatching = true;
            await this.message(tr("Egg.Msg.Oh", "Oh?"));
            pkmn._isEgg = false;
            pkmn._eggSteps = 0;
            pkmn._metLevel = 1;
            pkmn._metMap = $gameMap.mapId();
            pkmn._actorCache = null;
            pkmn.refresh();
            pkmn.recoverAll();
            pkmn._friendship = 120;
            $gamePokemon.pokedex.register(pkmn, true);
            delete pkmn._hatching;
            await this.message(tr("Egg.Msg.Hatched", "{species} hatched from the Egg!", { species: pkmn.species().name }));
            const UI = window.PokeMZ.UI;
            if (UI && UI.confirm && UI.enterName && (await UI.confirm(tr("Pkmn.Msg.Nickname", "Give a nickname to {species}?", { species: pkmn.species().name })))) {
                const name = await UI.enterName({ initial: pkmn.species().name, maxLength: 12 });
                if (name) {
                    pkmn.setName(name);
                }
            }
        },

        /** @brief Repel wore off (asks to use another). */
        async repelWoreOff() {
            const last = $gamePokemon.lastRepel;
            if (last && $gameParty.bag().count(last) > 0) {
                const item = PBS.items.get(last);
                if (await this.confirm(tr("Item.Msg.RepelAnother", "The repellent's effect wore off! Use another {item}?", { item: item.name }))) {
                    await useItem(last, null);
                }
            } else {
                await this.message(tr("Item.Msg.RepelWoreOff", "The repellent's effect wore off!"));
            }
        },
    };

    // Remember the last heal spot (map metadata healSpot) on map entry.
    const _onMapLoaded = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function() {
        _onMapLoaded.apply(this, arguments);
        const meta = PBS.mapMetadataFor($gameMap.mapId());
        if (meta && meta.healSpot && window.$gamePokemon) {
            $gamePokemon.lastHealSpot = meta.healSpot.slice();
        }
        if (window.$gamePokemon) {
            $gamePokemon.visitedMaps = $gamePokemon.visitedMaps || {};
            $gamePokemon.visitedMaps[$gameMap.mapId()] = 1;
        }
        if (window.$gameParty) {
            for (const p of $gameParty.pokemon()) {
                p.checkForm();
            }
        }
    };

    //-------------------------------------------------------------------------
    // Plugin commands
    //-------------------------------------------------------------------------

    /**
     * @brief Runs an async flow from an event, which waits until it ends.
     * @param {Game_Interpreter} interpreter The running interpreter.
     * @param {function(): Promise} fn Flow.
     */
    function runFlow(interpreter, fn) {
        let done = false;
        const p = Promise.resolve()
            .then(fn)
            .catch(e => console.error(e))
            .then(() => (done = true));
        if (interpreter) {
            interpreter.setWaitMode("pbsFlow");
            interpreter._pbsFlowDone = () => done;
        }
        return p;
    }

    const _updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
    Game_Interpreter.prototype.updateWaitMode = function() {
        if (this._waitMode === "pbsFlow") {
            if (this._pbsFlowDone && !this._pbsFlowDone()) {
                return true;
            }
            this._waitMode = "";
            this._pbsFlowDone = null;
            return false;
        }
        return _updateWaitMode.apply(this, arguments);
    };

    PluginManager.registerCommand(PLUGIN_NAME, "givePokemon", function(args) {
        const pk = PokeMZ.Pokemon.create(PBS.toID(args.species), num(args.level, 5), {
            shiny: args.shiny === "true" ? true : undefined,
            nickname: args.nickname || "",
            heldItem: PBS.toID(args.item || ""),
        });
        runFlow(this, async () => {
            const where = $gameParty.addPokemon(pk);
            if (num(args.variable, 0)) {
                $gameVariables.setValue(num(args.variable, 0), pk.actorId());
            }
            await Flow.message(tr("Pkmn.Msg.Received", "{player} received {species}!", { player: $gameParty.leader() ? $gameParty.leader().name() : "", species: pk.species().name }));
            if (where && !where.party) {
                await Flow.message(tr("PC.Msg.SentToBox", "{name} was sent to {box}.", { name: pk.name(), box: $gamePokemon.storage.boxName(where.box) }));
            }
        });
    });

    PluginManager.registerCommand(PLUGIN_NAME, "giveEgg", function(args) {
        const egg = PokeMZ.Pokemon.create(PBS.toID(args.species), 1, { egg: true });
        runFlow(this, async () => {
            $gameParty.addPokemon(egg);
            await Flow.message(tr("Egg.Msg.Received", "{player} received an Egg!", { player: $gameParty.leader() ? $gameParty.leader().name() : "" }));
        });
    });

    PluginManager.registerCommand(PLUGIN_NAME, "healParty", () => $gameParty.healPokemon());

    const open = id => window.PokeMZ.UI && PokeMZ.UI.openScreen(id);
    PluginManager.registerCommand(PLUGIN_NAME, "openPC", () => open("pc"));
    PluginManager.registerCommand(PLUGIN_NAME, "openDayCare", () => open("dayCare"));
    PluginManager.registerCommand(PLUGIN_NAME, "moveReminder", () => open("moveReminder"));

    PluginManager.registerCommand(PLUGIN_NAME, "checkEvolution", function() {
        runFlow(this, async () => {
            for (const p of $gameParty.pokemon()) {
                const was = p.canEvolve();
                if (p.updateEvolutionReadiness().length && !was) {
                    await Flow.message(tr("Evolution.Ready", "{name} can now evolve! Evolve it from the party menu.", { name: p.name() }));
                }
            }
        });
    });

    PluginManager.registerCommand(PLUGIN_NAME, "giveItem", function(args) {
        const id = PBS.toID(args.item);
        const n = num(args.amount, 1);
        runFlow(this, async () => {
            $gameParty.bag().gain(id, n);
            if (args.message !== "false") {
                const item = PBS.items.get(id);
                await Flow.message(
                    tr("Item.Msg.Obtained", "{player} obtained {n, plural, one {the {item}} other {# × {item}}}!", {
                        player: $gameParty.leader() ? $gameParty.leader().name() : "",
                        item: item.name,
                        n,
                    })
                );
                await Flow.message(tr("Item.Msg.PutAway", "{player} put the {item} in the {pocket} Pocket.", {
                    player: $gameParty.leader() ? $gameParty.leader().name() : "",
                    item: item.name,
                    pocket: tr(`Bag.Pocket.${item.pocket}`, item.pocket),
                }));
            }
        });
    });

    PluginManager.registerCommand(PLUGIN_NAME, "hasSpecies", args => {
        const id = PBS.toID(args.species);
        $gameSwitches.setValue(num(args.switch, 0), $gameParty.pokemon().some(p => !p.isEgg() && (p.speciesId === id || p.baseSpeciesId === id)));
    });

    //-------------------------------------------------------------------------
    // API
    //-------------------------------------------------------------------------

    window.PokeMZ.Pokemon = Object.assign(Engine, {
        config: CONFIG,
        tr,
        /**
         * @brief Creates a Pokémon (not yet in the party).
         * @param {string} species Species ID.
         * @param {number} level Level.
         * @param {Object} [opts] See Game_Pokemon.initialize.
         * @return {Game_Pokemon} The Pokémon.
         */
        create(species, level, opts) {
            const p = new Game_Pokemon(species, level, opts);
            $gameActors.addPokemon(p);
            return p;
        },
        useItem,
        ItemHandlers,
        FormHandlers,
        FieldMoves,
        EncounterTypes,
        Flow,
        evolutionContext,
        rollEncounter,
        /** @brief Replaces the time-of-day source: fn() => "morning" | ... */
        setTimeOfDay(fn) {
            timeOfDay = fn;
        },
        timeOfDay: () => timeOfDay(),
        classes: { Game_Pokemon, Game_Bag, Game_Pokedex, Game_PokemonStorage, Game_DayCare, Game_PokemonState },
    });
})();
