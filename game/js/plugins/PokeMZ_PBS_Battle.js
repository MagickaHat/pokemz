//=============================================================================
// PokéMZ - PBS_Battle.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Battle bridge to the Pokémon Showdown simulator:
 * teams from PBS data, custom content as a Showdown mod, localized text.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_PBS_Pokemon
 * @orderAfter PokeMZ_PBS_Graphics
 *
 * @param wildBgm
 * @text Wild Battle BGM
 * @desc Used when the map metadata has none ("" = System's battle BGM).
 * @type file
 * @dir audio/bgm/
 * @default
 *
 * @param trainerBgm
 * @text Trainer Battle BGM
 * @type file
 * @dir audio/bgm/
 * @default
 *
 * @param messageFrames
 * @text Message Frames
 * @desc Frames a battle message stays before it moves on by itself (OK
 * skips it sooner).
 * @type number
 * @min 1
 * @default 70
 *
 * @command wildBattle
 * @text Wild Battle
 * @arg species
 * @type string
 * @default pikachu
 * @arg level
 * @type number
 * @min 1
 * @default 5
 * @arg shiny
 * @type boolean
 * @default false
 * @arg canLose
 * @text Can Lose
 * @desc Losing doesn't send the player back to a Pokémon Center.
 * @type boolean
 * @default false
 * @arg variable
 * @text Result Variable
 * @desc 1 = won, 2 = lost, 3 = escaped, 4 = caught.
 * @type variable
 * @default 0
 *
 * @command trainerBattle
 * @text Trainer Battle
 * @arg trainer
 * @text Trainer ID
 * @desc ID of an entry in trainers.json.
 * @type string
 * @default
 * @arg canLose
 * @text Can Lose
 * @type boolean
 * @default false
 * @arg variable
 * @text Result Variable
 * @desc 1 = won, 2 = lost.
 * @type variable
 * @default 0
 *
 * @help
 * ============================================================================
 * PokeMZ_PBS_Battle
 * ============================================================================
 * Battles run in the Pokémon Showdown simulator (PS_Sim plugin). Teams are
 * made from Game_Pokemon and trainers.json; species, moves, abilities and
 * items marked "custom" in the PBS files are loaded into the simulator as
 * a Showdown mod, together with any effects plugins register:
 *
 *   PokeMZ.Battle.registerEffect("abilities", "myability", {
 *       name: "My Ability", onModifyAtk(atk) { return this.chainModify(1.5); },
 *   });
 *
 * The bridge turns the simulator's log into typed events. A presenter shows
 * them: the Preact battle screen of PokeMZ_UI_Pokemon (FRLG style) uses the
 * text presenter for localized messages (data/locales/battle.csv).
 *
 *   PokeMZ.Battle.startWild("pikachu", 5)          -> Promise<result>
 *   PokeMZ.Battle.startTrainer("youngsterjoey")    -> Promise<result>
 *   result: "win" | "lose" | "run" | "caught"
 *
 * Bag items, Poké Balls and failed escapes use the turn through an
 * invisible "PokeMZ Action" move.
 */

(() => {
    "use strict";

    //=========================================================================
    // Engine (pure: loaded by tests with @pkmn/sim)
    //=========================================================================

    const ACTION_MOVE = "pokemzaction";
    const FORMAT = "pokemzsingles";
    const toID = s =>
        String(s || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "");

    /** @brief Showdown move targets by ID (PBS stores IDs). */
    const TARGETS = [
        "normal", "self", "adjacentAlly", "adjacentAllyOrSelf", "adjacentFoe", "all", "allAdjacent",
        "allAdjacentFoes", "allies", "allySide", "allyTeam", "any", "foeSide", "randomNormal", "scripted",
    ];
    const TARGET_BY_ID = Object.fromEntries(TARGETS.map(t => [toID(t), t]));

    /** @brief Effects registered by plugins: kind -> id -> data. */
    const effects = { Abilities: {}, Moves: {}, Items: {}, Conditions: {}, Species: {} };

    /**
     * @brief Adds or overrides Showdown data (with callbacks).
     * @param {string} kind "abilities" | "moves" | "items" | "conditions" |
     *        "species".
     * @param {string} id ID.
     * @param {Object} data Showdown data (name, callbacks...).
     */
    function registerEffect(kind, id, data) {
        const map = { abilities: "Abilities", moves: "Moves", items: "Items", conditions: "Conditions", species: "Species" };
        const table = effects[map[kind] || kind];
        if (!table) {
            throw new Error(`Unknown effect kind "${kind}"`);
        }
        table[toID(id)] = Object.assign(table[toID(id)] || {}, data);
    }

    /**
     * @brief Builds Showdown mod data from custom PBS entries and effects.
     * @param {Object} registries PBS registries.
     * @param {Object} parent Parent Showdown dex (to tell new entries from
     *        overrides).
     * @return {Object} Mod data for Dex.mod().
     */
    function buildModData(registries, parent) {
        const nameOf = (reg, id) => {
            const e = registries[reg] && registries[reg].tryGet(id);
            return e ? e.sourceText("name") : id;
        };
        const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
        const data = {
            Scripts: { inherit: "gen9" },
            Moves: {
                [ACTION_MOVE]: {
                    num: -9000,
                    name: "PokeMZ Action",
                    type: "Normal",
                    category: "Status",
                    basePower: 0,
                    accuracy: true,
                    pp: 64,
                    noPPBoosts: true,
                    priority: 6,
                    flags: {},
                    target: "self",
                    onTryMove() {
                        return null;
                    },
                },
            },
            Pokedex: {},
            Learnsets: {},
            Abilities: {},
            Items: {},
            Conditions: {},
            Formats: [{ name: "PokeMZ Singles", mod: "pokemz", gameType: "singles", ruleset: [] }],
        };
        for (const m of registries.moves || []) {
            if (!m.custom) {
                continue;
            }
            data.Moves[m.id] = {
                num: m.num || 10000,
                name: m.sourceText("name"),
                type: nameOf("types", m.type),
                category: cap(m.category),
                basePower: m.power,
                accuracy: m.accuracy === 0 ? true : m.accuracy,
                pp: m.pp,
                priority: m.priority,
                target: TARGET_BY_ID[m.target] || "normal",
                flags: Object.fromEntries((m.flags || []).map(f => [f, 1])),
                secondary: null,
            };
        }
        for (const a of registries.abilities || []) {
            if (a.custom) {
                data.Abilities[a.id] = { num: a.num || 10000, name: a.sourceText("name"), rating: 0 };
            }
        }
        for (const i of registries.items || []) {
            if (i.custom && i.showdown) {
                data.Items[i.id] = { num: i.num || 10000, name: i.sourceText("name"), gen: 9 };
            }
        }
        for (const t of registries.types || []) {
            if (t.custom) {
                const damageTaken = {};
                for (const a of registries.types) {
                    const name = a.sourceText("name");
                    damageTaken[name] = t.immunities.includes(a.id) ? 3 : t.weaknesses.includes(a.id) ? 1 : t.resistances.includes(a.id) ? 2 : 0;
                }
                data.TypeChart = data.TypeChart || {};
                data.TypeChart[t.id] = { damageTaken };
            }
        }
        for (const s of registries.species || []) {
            if (!s.custom) {
                continue;
            }
            const entry = {
                num: s.num || 10000,
                name: s.showdownName,
                types: s.types.map(t => nameOf("types", t)),
                baseStats: Object.assign({}, s.baseStats),
                abilities: Object.fromEntries(Object.entries(s.abilities).map(([k, v]) => [k, nameOf("abilities", v)])),
                heightm: s.height / 10,
                weightkg: s.weight / 10,
                eggGroups: ["Undiscovered"],
            };
            if (s.gender === "genderless") {
                entry.gender = "N";
            } else if (s.gender === "male") {
                entry.gender = "M";
            } else if (s.gender === "female") {
                entry.gender = "F";
            } else {
                entry.genderRatio = { M: s.genderRatio, F: 1 - s.genderRatio };
            }
            if (s.baseSpecies) {
                entry.baseSpecies = nameOf("species", s.baseSpecies);
                entry.forme = s.forme;
            }
            data.Pokedex[s.id] = entry;
            data.Learnsets[s.id] = { learnset: {} };
        }
        // Plugin effects: new entries or overrides of existing ones.
        const parentTable = { Abilities: "abilities", Moves: "moves", Items: "items", Conditions: "conditions", Species: "species" };
        for (const [kind, table] of Object.entries(effects)) {
            for (const [id, fx] of Object.entries(table)) {
                const target = kind === "Species" ? "Pokedex" : kind;
                const exists = parent && parent[parentTable[kind]] && parent[parentTable[kind]].get(id).exists;
                data[target][id] = Object.assign({}, data[target][id] || {}, exists ? { inherit: true } : {}, fx);
            }
        }
        return data;
    }

    /**
     * @brief Makes the battle dex (a Showdown mod of Gen 9).
     * @param {Object} sim {Dex}.
     * @param {Object} registries PBS registries.
     * @return {Object} Modded dex.
     */
    function makeDex(sim, registries) {
        const parent = sim.Dex.forGen(9);
        return sim.Dex.mod("pokemz", buildModData(registries, parent));
    }

    //-------------------------------------------------------------------------
    // Protocol
    //-------------------------------------------------------------------------

    /**
     * @brief Splits a protocol line.
     * @param {string} line "|move|p1a: X|Tackle|p2a: Y".
     * @return {{cmd: string, args: Array<string>, kw: Object}} Parts;
     *         "[from] item: Leftovers" style arguments go to kw.
     */
    function parseLine(line) {
        const parts = line.split("|").slice(1);
        const cmd = parts.shift() || "";
        const args = [];
        const kw = {};
        for (const p of parts) {
            const m = /^\[(\w+)\]\s*(.*)$/.exec(p);
            if (m) {
                kw[m[1]] = m[2];
            } else {
                args.push(p);
            }
        }
        return { cmd, args, kw };
    }

    /**
     * @brief Parses "45/100 par" or "0 fnt".
     * @param {string} s Condition.
     * @return {{hp: number, maxhp: number, status: string, fainted: boolean}}
     *         Values.
     */
    function parseCondition(s) {
        const [hpPart, status] = String(s || "").split(" ");
        const [hp, maxhp] = hpPart.split("/").map(Number);
        return { hp: hp || 0, maxhp: maxhp || 0, status: status === "fnt" ? "" : status || "", fainted: status === "fnt" || hp === 0 };
    }

    /**
     * @brief "p2a: W" -> {side: "p2", token: "W"}.
     * @param {string} ident Pokémon ident.
     * @return {{side: string, token: string}} Parts.
     */
    function parseIdent(ident) {
        const m = /^(p\d)[a-z]?:\s*(.*)$/.exec(ident || "");
        return m ? { side: m[1], token: m[2] } : { side: "", token: "" };
    }

    /**
     * @brief Turns log lines into typed events. For split lines, our side
     *        (p1) gets the exact (secret) line and the foe the public one.
     * @param {Array<string>} lines Log lines.
     * @return {Array<Object>} Events: {type, side, token, ...}.
     */
    function toEvents(lines) {
        const out = [];
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (line.startsWith("|split|")) {
                const side = line.slice(7);
                line = side === "p1" ? lines[i + 1] : lines[i + 2];
                i += 2;
            }
            const { cmd, args, kw } = parseLine(line);
            const who = parseIdent(args[0]);
            const ev = { type: cmd.replace(/^-/, ""), side: who.side, token: who.token, from: kw.from || "", of: kw.of ? parseIdent(kw.of) : null, kw, args };
            switch (cmd) {
                case "switch":
                case "drag":
                case "replace": {
                    const details = String(args[1] || "").split(", ");
                    Object.assign(ev, parseCondition(args[2]), {
                        type: "switch",
                        species: toID(details[0]),
                        level: Number((details.find(d => /^L\d+/.test(d)) || "L100").slice(1)),
                        gender: details.includes("M") ? "male" : details.includes("F") ? "female" : "genderless",
                        shiny: details.includes("shiny"),
                    });
                    break;
                }
                case "move":
                    ev.move = toID(args[1]);
                    ev.target = parseIdent(args[2]);
                    if (ev.move === ACTION_MOVE) {
                        continue;
                    }
                    break;
                case "-damage":
                case "-heal":
                case "-sethp":
                    Object.assign(ev, parseCondition(args[1]));
                    break;
                case "faint":
                    break;
                case "-status":
                    ev.status = args[1];
                    break;
                case "-curestatus":
                    ev.status = args[1];
                    break;
                case "-boost":
                case "-unboost":
                    ev.stat = args[1];
                    ev.amount = Number(args[2]) || 0;
                    break;
                case "-weather":
                    ev.weather = toID(args[0]);
                    ev.side = "";
                    ev.upkeep = "upkeep" in kw;
                    break;
                case "-ability":
                    ev.ability = toID(args[1]);
                    break;
                case "-item":
                case "-enditem":
                    ev.item = toID(args[1]);
                    ev.eat = "eat" in kw;
                    break;
                case "cant":
                    ev.reason = toID(args[1]);
                    break;
                case "-start":
                case "-end":
                case "-activate":
                    ev.effect = toID(String(args[1] || "").replace(/^(move|ability|item):\s*/, ""));
                    break;
                case "-hitcount":
                    ev.count = Number(args[1]) || 0;
                    break;
                case "turn":
                    ev.turn = Number(args[0]);
                    ev.side = "";
                    break;
                case "win":
                    ev.winner = args[0];
                    ev.side = "";
                    break;
                case "-sidestart":
                case "-sideend":
                    ev.side = (/^(p\d)/.exec(args[0]) || [])[1] || "";
                    ev.effect = toID(String(args[1] || "").replace(/^move:\s*/, ""));
                    break;
                case "":
                case "t:":
                case "gametype":
                case "player":
                case "gen":
                case "tier":
                case "teamsize":
                case "start":
                case "upkeep":
                case "rule":
                case "debug":
                case "-message":
                    if (cmd !== "-message") {
                        continue;
                    }
                    ev.text = args[0];
                    break;
                default:
                    break;
            }
            out.push(ev);
        }
        return out;
    }

    //-------------------------------------------------------------------------
    // Text presenter
    //-------------------------------------------------------------------------

    const STATUS_KEYS = { brn: "Burned", par: "Paralyzed", slp: "Asleep", psn: "Poisoned", tox: "BadlyPoisoned", frz: "Frozen" };

    /**
     * @brief Turns events into localized battle messages.
     * @param {Object} env {tr(key, fallback, args), pokemon(side, token) ->
     *        name phrase, move(id), ability(id), item(id), stat(id),
     *        player, trainer, wild}.
     */
    class TextPresenter {
        constructor(env) {
            this.env = env;
        }

        /**
         * @brief Message for an event.
         * @param {Object} ev Event.
         * @return {string|null} Text (null = nothing to say).
         */
        format(ev) {
            const e = this.env;
            const t = (key, fallback, args) => e.tr(`Battle.${key}`, fallback, args);
            const p = ev.side && ev.token ? e.pokemon(ev.side, ev.token) : "";
            const custom = TextPresenter.handlers.get(ev.type);
            if (custom) {
                return custom.call(this, ev, { t, p, env: e });
            }
            const from = String(ev.from || "");
            switch (ev.type) {
                case "switch":
                    if (ev.side === "p1") {
                        return t("Msg.Go", "Go! {pokemon}!", { pokemon: p });
                    }
                    return e.wild ? t("Msg.WildAppeared", "A wild {pokemon} appeared!", { pokemon: e.speciesName(ev.species) }) : t("Msg.SentOut", "{trainer} sent out {pokemon}!", { trainer: e.trainer, pokemon: e.speciesName(ev.species) });
                case "move":
                    return t("Msg.UsedMove", "{pokemon} used {move}!", { pokemon: p, move: e.move(ev.move) });
                case "damage":
                    if (!from) {
                        return null;
                    }
                    if (STATUS_KEYS[toID(from)]) {
                        return t(`Msg.HurtBy.${toID(from)}`, "{pokemon} was hurt by its {status}!", { pokemon: p, status: e.statusName(toID(from)) });
                    }
                    if (/^item:/.test(from)) {
                        return t("Msg.HurtByItem", "{pokemon} was hurt by its {item}!", { pokemon: p, item: e.item(toID(from.slice(5))) });
                    }
                    if (toID(from) === "recoil") {
                        return t("Msg.Recoil", "{pokemon} was damaged by the recoil!", { pokemon: p });
                    }
                    if (["sandstorm", "hail"].includes(toID(from))) {
                        return t(`Msg.Buffeted.${toID(from)}`, "{pokemon} is buffeted by the {weather}!", { pokemon: p, weather: e.weatherName(toID(from)) });
                    }
                    return null;
                case "heal":
                    if (/^item:/.test(from)) {
                        return t("Msg.HealItem", "{pokemon} restored a little HP using its {item}!", { pokemon: p, item: e.item(toID(from.slice(5))) });
                    }
                    if (toID(from) === "drain") {
                        return t("Msg.Drained", "{pokemon} had its energy drained!", { pokemon: ev.of ? e.pokemon(ev.of.side, ev.of.token) : p });
                    }
                    return t("Msg.HpRestored", "{pokemon}'s HP was restored.", { pokemon: p });
                case "supereffective":
                    return t("Msg.SuperEffective", "It's super effective!");
                case "resisted":
                    return t("Msg.NotVeryEffective", "It's not very effective...");
                case "immune":
                    return t("Msg.NoEffect", "It doesn't affect {pokemon}...", { pokemon: p });
                case "crit":
                    return t("Msg.Crit", "A critical hit!");
                case "miss":
                    return t("Msg.Missed", "{pokemon} avoided the attack!", { pokemon: ev.args[1] ? e.pokemon(parseIdent(ev.args[1]).side, parseIdent(ev.args[1]).token) : p });
                case "fail":
                    return t("Msg.Failed", "But it failed!");
                case "ohko":
                    return t("Msg.Ohko", "It's a one-hit KO!");
                case "hitcount":
                    return t("Msg.HitCount", "The Pokémon was hit {n, plural, one {# time} other {# times}}!", { n: ev.count });
                case "faint":
                    return t("Msg.Fainted", "{pokemon} fainted!", { pokemon: p });
                case "status":
                    return t(`Msg.Status.${ev.status}`, "{pokemon} is now {status}!", { pokemon: p, status: e.statusName(ev.status) });
                case "curestatus":
                    return ev.status === "slp"
                        ? t("Msg.WokeUp", "{pokemon} woke up!", { pokemon: p })
                        : ev.status === "frz"
                        ? t("Msg.Thawed", "{pokemon} thawed out!", { pokemon: p })
                        : t("Msg.Cured", "{pokemon} was cured of its {status}.", { pokemon: p, status: e.statusName(ev.status) });
                case "cant":
                    return t(`Msg.Cant.${ev.reason}`, "{pokemon} can't move!", { pokemon: p });
                case "boost":
                case "unboost": {
                    const n = Math.min(3, ev.amount);
                    const dir = ev.type === "boost" ? "Rose" : "Fell";
                    if (n === 0) {
                        return t(`Msg.Stat${dir}Max`, ev.type === "boost" ? "{pokemon}'s {stat} won't go any higher!" : "{pokemon}'s {stat} won't go any lower!", { pokemon: p, stat: e.stat(ev.stat) });
                    }
                    const fallback = {
                        Rose: ["", "{pokemon}'s {stat} rose!", "{pokemon}'s {stat} rose sharply!", "{pokemon}'s {stat} rose drastically!"],
                        Fell: ["", "{pokemon}'s {stat} fell!", "{pokemon}'s {stat} harshly fell!", "{pokemon}'s {stat} severely fell!"],
                    }[dir][n];
                    return t(`Msg.Stat${dir}${n}`, fallback, { pokemon: p, stat: e.stat(ev.stat) });
                }
                case "weather":
                    if (ev.weather === "none") {
                        return t("Msg.WeatherEnd", "The weather cleared up.");
                    }
                    return ev.upkeep ? t(`Msg.WeatherContinues.${ev.weather}`, "The {weather} continues.", { weather: e.weatherName(ev.weather) }) : t(`Msg.WeatherStart.${ev.weather}`, "The {weather} started!", { weather: e.weatherName(ev.weather) });
                case "ability":
                    return t("Msg.Ability", "[{pokemon}'s {ability}]", { pokemon: p, ability: e.ability(ev.ability) });
                case "enditem":
                    return ev.eat ? t("Msg.AteItem", "{pokemon} ate its {item}!", { pokemon: p, item: e.item(ev.item) }) : null;
                case "item":
                    return null;
                case "start":
                    if (ev.effect === "confusion") {
                        return t("Msg.Confused", "{pokemon} became confused!", { pokemon: p });
                    }
                    if (ev.effect === "substitute") {
                        return t("Msg.Substitute", "{pokemon} put in a substitute!", { pokemon: p });
                    }
                    return null;
                case "end":
                    return ev.effect === "confusion" ? t("Msg.ConfusionEnd", "{pokemon} snapped out of its confusion!", { pokemon: p }) : null;
                case "activate":
                    return ev.effect === "confusion" ? t("Msg.IsConfused", "{pokemon} is confused!", { pokemon: p }) : null;
                case "sidestart":
                    return t("Msg.SideStart", "{move} raised your team's defenses!", { move: e.move(ev.effect) });
                case "sideend":
                    return t("Msg.SideEnd", "{move} wore off!", { move: e.move(ev.effect) });
                case "message":
                    return ev.text || null;
                default:
                    return null;
            }
        }
    }
    /** @brief Custom formatters: type -> fn(ev, {t, p, env}) -> text. */
    TextPresenter.handlers = new Map();

    //-------------------------------------------------------------------------
    // Rules: balls, escape, AI
    //-------------------------------------------------------------------------

    /**
     * @brief Ball multiplier (Gen 9).
     * @param {Object} params Ball params {modifier, special}.
     * @param {Object} c {turn, wildLevel, playerLevel, wildTypes, water,
     *        night, cave, caught, fishing, weight, speed, wildGender,
     *        playerGender, wildSpecies, ultraBeast}.
     * @return {number} Multiplier.
     */
    function ballModifier(params, c) {
        const base = params.modifier || 1;
        switch (params.special) {
            case "quick":
                return c.turn <= 1 ? 5 : 1;
            case "dusk":
                return c.night || c.cave ? 3 : 1;
            case "net":
                return (c.wildTypes || []).some(t => t === "water" || t === "bug") ? 3.5 : 1;
            case "dive":
                return c.water || c.fishing ? 3.5 : 1;
            case "nest":
                return Math.max(1, (41 - c.wildLevel) / 10);
            case "repeat":
                return c.caught ? 3.5 : 1;
            case "timer":
                return Math.min(4, 1 + (c.turn * 1229) / 4096);
            case "level":
                return c.playerLevel >= c.wildLevel * 4 ? 8 : c.playerLevel >= c.wildLevel * 2 ? 4 : c.playerLevel > c.wildLevel ? 2 : 1;
            case "lure":
                return c.fishing ? 4 : 1;
            case "moon":
                return c.moonStone ? 4 : 1;
            case "heavy":
                return 1;
            case "love":
                return c.sameSpecies && c.wildGender !== c.playerGender && c.wildGender !== "genderless" ? 8 : 1;
            case "fast":
                return c.speed >= 100 ? 4 : 1;
            case "dream":
                return c.asleep ? 4 : 1;
            default:
                return c.ultraBeast && base !== 255 ? (params.special === "beast" ? 5 : 0.1) : base;
        }
    }

    /**
     * @brief Escape check (Gen 3+ formula).
     * @param {number} speed Player's active speed.
     * @param {number} foeSpeed Wild speed.
     * @param {number} attempts Attempts so far (including this one).
     * @param {function(): number} [rng] Random.
     * @return {boolean} True if escaped.
     */
    function canEscape(speed, foeSpeed, attempts, rng = Math.random) {
        if (speed >= foeSpeed) {
            return true;
        }
        const f = Math.floor((speed * 128) / Math.max(1, foeSpeed)) + 30 * attempts;
        return f > 255 || Math.floor(rng() * 256) < f % 256;
    }

    /**
     * @brief Picks a move for an AI side.
     * @param {Object} request Showdown request of that side.
     * @param {Object} c {skill, dex, self (sim Pokémon), foe (sim Pokémon)}.
     * @param {function(): number} [rng] Random.
     * @return {string} Choice ("move N").
     */
    function aiChoice(request, c = {}, rng = Math.random) {
        const active = request.active && request.active[0];
        if (!active) {
            return "default";
        }
        const options = active.moves.map((m, i) => ({ m, i })).filter(o => !o.m.disabled && o.m.id !== ACTION_MOVE && (o.m.pp === undefined || o.m.pp > 0));
        if (!options.length) {
            return "move 1";
        }
        if (c.skill > 0 && c.dex && c.foe) {
            let best = null;
            for (const o of options) {
                const move = c.dex.moves.get(o.m.id);
                let score = move.category === "Status" ? 20 : move.basePower || 40;
                if (move.category !== "Status") {
                    score *= c.dex.getEffectiveness ? Math.pow(2, c.dex.getEffectiveness(move.type, c.foe.getTypes ? c.foe.getTypes() : [])) : 1;
                    if (c.dex.getImmunity && !c.dex.getImmunity(move.type, c.foe.getTypes ? c.foe.getTypes() : [])) {
                        score = 0;
                    }
                    if (c.self && c.self.getTypes && c.self.getTypes().includes(move.type)) {
                        score *= 1.5;
                    }
                }
                score *= 0.85 + rng() * 0.3;
                if (!best || score > best.score) {
                    best = { score, i: o.i };
                }
            }
            return `move ${best.i + 1}`;
        }
        return `move ${options[Math.floor(rng() * options.length)].i + 1}`;
    }

    //-------------------------------------------------------------------------
    // Bridge
    //-------------------------------------------------------------------------

    /**
     * @brief Runs one battle between the player's party and a wild Pokémon
     *        or a trainer in the Showdown simulator.
     *
     *        Game-side work goes through `adapter` so the bridge also runs
     *        in Node: {exp(winner, fainted, participated) => Promise,
     *        caught(foe) => Promise, seen(foe), useItem(...)}.
     */
    class BattleBridge {
        /**
         * @param {Object} o {sim, dex, party: [pokemon-like], foes: [pokemon-like],
         *        wild: boolean, trainer: {name, skill}, presenter, adapter,
         *        seed}.
         */
        constructor(o) {
            Object.assign(this, o);
            this.result = null;
            this.turn = 0;
            this.logIndex = 0;
            this.escapeAttempts = 0;
            this.participants = new Map();
            this.tokens = new Map();
        }

        /** @return {Object} Game Pokémon for a side and token. */
        member(side, token) {
            return this.tokens.get(`${side}:${token}`) || null;
        }

        /** @return {Object|null} The sim Pokémon of a game Pokémon. */
        simOf(pkmn) {
            for (const side of [this.battle.p1, this.battle.p2]) {
                const s = side.pokemon.find(p => this.member(side.id, p.name) === pkmn);
                if (s) {
                    return s;
                }
            }
            return null;
        }

        /** @return {Object|null} Active sim Pokémon of a side. */
        active(side) {
            return this.battle[side].active[0] || null;
        }

        /** @brief Creates the simulator battle. */
        start() {
            const battle = new this.sim.Battle({ formatid: FORMAT, seed: this.seed }, this.dex);
            this.battle = battle;
            const team = (list, side) => {
                // The first Pokémon able to battle leads.
                const order = list.slice();
                const lead = order.findIndex(p => p.hp > 0 && !p.isEgg());
                if (lead > 0) {
                    order.unshift(order.splice(lead, 1)[0]);
                }
                return order
                    .filter(p => !p.isEgg())
                    .map((p, i) => {
                        const token = `${side === "p1" ? "P" : "F"}${i}`;
                        this.tokens.set(`${side}:${token}`, p);
                        return Object.assign(p.toShowdownSet(), { name: token });
                    });
            };
            const p1 = team(this.party, "p1");
            battle.setPlayer("p1", { name: "Player", team: p1 });
            // Current HP, status and PP of the party.
            for (const sp of battle.p1.pokemon) {
                const gp = this.member("p1", sp.name);
                this.applyToSim(gp, sp);
                sp.moveSlots.push({ move: "PokeMZ Action", id: ACTION_MOVE, pp: 64, maxpp: 64, target: "self", disabled: false, used: false, virtual: true });
            }
            const p2 = team(this.foes, "p2");
            battle.setPlayer("p2", { name: this.wild ? "Wild" : this.trainer.name, team: p2 });
            for (const sp of battle.p2.pokemon) {
                this.applyToSim(this.member("p2", sp.name), sp);
            }
        }

        /** @brief Copies HP, status and PP from a game Pokémon to the sim. */
        applyToSim(gp, sp) {
            if (!gp || !sp) {
                return;
            }
            if (gp.hp < sp.maxhp) {
                sp.hp = Math.max(0, gp.hp);
                if (sp.hp === 0) {
                    sp.fainted = true;
                    sp.status = "fnt";
                }
            }
            if (gp.status && sp.hp > 0) {
                sp.status = gp.status;
                sp.statusState = { id: gp.status, target: sp, startTime: gp.status === "slp" ? 3 : 0, time: gp.status === "slp" ? 3 : 0 };
            }
            gp.moves().forEach((m, i) => {
                if (sp.moveSlots[i] && sp.moveSlots[i].id === m.id) {
                    sp.moveSlots[i].pp = m.pp;
                    sp.moveSlots[i].maxpp = gp.maxPp(i);
                }
            });
        }

        /** @brief Copies HP, status and PP back to the game Pokémon. */
        syncBack() {
            for (const sp of this.battle.p1.pokemon) {
                const gp = this.member("p1", sp.name);
                if (!gp) {
                    continue;
                }
                gp.setHp(Math.max(0, Math.min(gp.mhp, sp.fainted ? 0 : sp.hp)));
                gp.status = sp.fainted || sp.status === "fnt" ? "" : sp.status || "";
                gp.moves().forEach((m, i) => {
                    const slot = sp.baseMoveSlots && sp.baseMoveSlots.find(s => s.id === m.id);
                    if (slot) {
                        m.pp = slot.pp;
                    }
                });
            }
        }

        /**
         * @brief Gives the presenter the new log as events.
         * @return {Promise<void>} Done when shown.
         */
        async flush() {
            const lines = this.battle.log.slice(this.logIndex);
            this.logIndex = this.battle.log.length;
            let events = toEvents(lines);
            if (!this.introShown) {
                // The foe appears before the player sends out a Pokémon.
                this.introShown = true;
                events = events.filter(e => e.type === "switch" && e.side === "p2").concat(events.filter(e => !(e.type === "switch" && e.side === "p2")));
            }
            for (const ev of events) {
                this.track(ev);
                await this.presenter.show(ev, this);
                if (ev.type === "faint" && ev.side === "p2") {
                    await this.onFoeFainted(ev.token);
                }
            }
        }

        /** @brief Tracks turns, participants and seen foes. */
        track(ev) {
            if (ev.type === "turn") {
                this.turn = ev.turn;
            }
            if (ev.type === "switch" && ev.side === "p2" && this.adapter.seen) {
                this.adapter.seen(this.member("p2", ev.token));
            }
            const foe = this.active("p2");
            const mine = this.active("p1");
            if (foe && mine && !mine.fainted) {
                if (!this.participants.has(foe.name)) {
                    this.participants.set(foe.name, new Set());
                }
                this.participants.get(foe.name).add(mine.name);
            }
        }

        /** @brief EXP and EVs for a fainted foe (adapter does the work). */
        async onFoeFainted(token) {
            const foe = this.member("p2", token);
            const part = this.participants.get(token) || new Set();
            if (this.adapter.exp && foe) {
                await this.adapter.exp(
                    foe,
                    this.battle.p1.pokemon.map(sp => ({ pokemon: this.member("p1", sp.name), sim: sp, participated: part.has(sp.name) && !sp.fainted })).filter(x => x.pokemon && !x.sim.fainted),
                    this
                );
            }
        }

        /**
         * @brief Updates a sim Pokémon after a level-up (stats, HP, moves).
         * @param {Object} gp Game Pokémon.
         */
        refreshSim(gp) {
            const sp = this.simOf(gp);
            if (!sp || sp.fainted) {
                return;
            }
            sp.level = sp.set.level = gp.level;
            const stats = this.battle.spreadModify(sp.species.baseStats, sp.set);
            sp.baseStoredStats = stats;
            for (const s of ["atk", "def", "spa", "spd", "spe"]) {
                sp.storedStats[s] = stats[s];
            }
            const diff = stats.hp - sp.maxhp;
            sp.maxhp = sp.baseMaxhp = stats.hp;
            sp.hp = Math.min(sp.maxhp, sp.hp + Math.max(0, diff));
            sp.details = sp.getUpdatedDetails ? sp.getUpdatedDetails() : sp.details;
            const slots = gp.moves().map((m, i) => {
                const move = this.dex.moves.get(m.id);
                return { move: move.name, id: move.id, pp: m.pp, maxpp: gp.maxPp(i), target: move.target, disabled: false, used: false };
            });
            sp.baseMoveSlots = slots.map(s => Object.assign({}, s));
            sp.moveSlots = slots.concat([{ move: "PokeMZ Action", id: ACTION_MOVE, pp: 64, maxpp: 64, target: "self", disabled: false, used: false, virtual: true }]);
        }

        /** @return {boolean} True if a side needs a choice now. */
        needs(side) {
            const req = this.battle[side].activeRequest;
            return !!req && !req.wait && !this.battle[side].isChoiceDone();
        }

        /**
         * @brief Runs the battle to the end.
         * @return {Promise<string>} "win" | "lose" | "run" | "caught".
         */
        async run() {
            this.start();
            await this.flush();
            while (!this.battle.ended && !this.result) {
                if (this.needs("p1")) {
                    const req = this.battle.p1.activeRequest;
                    if (req.forceSwitch) {
                        const pkmn = await this.presenter.chooseSwitch(this, true);
                        this.chooseSwitch(pkmn);
                    } else {
                        const action = await this.presenter.chooseAction(this);
                        await this.perform(action);
                        if (this.result) {
                            break;
                        }
                    }
                }
                if (this.needs("p2")) {
                    const req = this.battle.p2.activeRequest;
                    if (req.forceSwitch) {
                        const idx = this.battle.p2.pokemon.findIndex(p => !p.fainted && !p.isActive);
                        this.battle.choose("p2", idx >= 0 ? `switch ${idx + 1}` : "pass");
                    } else {
                        const ai = this.ai || aiChoice;
                        this.battle.choose("p2", ai(req, { skill: this.wild ? 0 : (this.trainer && this.trainer.skill) || 0, dex: this.dex, self: this.active("p2"), foe: this.active("p1") }));
                    }
                }
                await this.flush();
            }
            if (!this.result) {
                this.result = this.battle.winner === "Player" ? "win" : this.battle.winner ? "lose" : "lose";
            }
            this.syncBack();
            return this.result;
        }

        /** @brief Chooses a switch to a game Pokémon. */
        chooseSwitch(pkmn) {
            const idx = this.battle.p1.pokemon.findIndex(sp => this.member("p1", sp.name) === pkmn);
            if (idx < 0 || !this.battle.choose("p1", `switch ${idx + 1}`)) {
                this.battle.choose("p1", "default");
            }
        }

        /** @brief Uses the turn without doing anything (items, balls). */
        passTurn() {
            if (!this.battle.choose("p1", `move ${ACTION_MOVE}`)) {
                this.battle.choose("p1", "default");
            }
        }

        /**
         * @brief Carries out a player action.
         * @param {Object} a {type: "move", slot} | {type: "switch", pokemon} |
         *        {type: "item", item, target, slot} | {type: "run"}.
         */
        async perform(a) {
            const say = (key, fallback, args) => this.presenter.say(this.presenter.tr(`Battle.${key}`, fallback, args));
            switch (a.type) {
                case "move":
                    if (!this.battle.choose("p1", `move ${a.slot + 1}`)) {
                        this.battle.choose("p1", "default");
                    }
                    return;
                case "switch":
                    this.chooseSwitch(a.pokemon);
                    return;
                case "run": {
                    if (!this.wild) {
                        await say("Msg.NoRunning", "No! There's no running from a Trainer battle!");
                        return this.perform(await this.presenter.chooseAction(this));
                    }
                    this.escapeAttempts++;
                    const mine = this.active("p1");
                    const foe = this.active("p2");
                    if (canEscape(mine.getStat("spe"), foe.getStat("spe"), this.escapeAttempts)) {
                        await say("Msg.GotAway", "You got away safely!");
                        this.result = "run";
                        return;
                    }
                    await say("Msg.CantEscape", "You couldn't get away!");
                    this.passTurn();
                    return;
                }
                case "item": {
                    const r = await this.adapter.useItem(a, this);
                    if (r === "caught") {
                        this.result = "caught";
                        return;
                    }
                    if (r === "cancel") {
                        return this.perform(await this.presenter.chooseAction(this));
                    }
                    this.passTurn();
                    return;
                }
                default:
                    this.battle.choose("p1", "default");
            }
        }
    }

    const Engine = {
        ACTION_MOVE,
        FORMAT,
        TARGET_BY_ID,
        effects,
        registerEffect,
        buildModData,
        makeDex,
        parseLine,
        parseCondition,
        parseIdent,
        toEvents,
        TextPresenter,
        ballModifier,
        canEscape,
        aiChoice,
        BattleBridge,
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

    const PLUGIN_NAME = "PokeMZ_PBS_Battle";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const CONFIG = {
        wildBgm: String(params.wildBgm || ""),
        trainerBgm: String(params.trainerBgm || ""),
        messageFrames: Number(params.messageFrames || 70),
    };
    const PBS = window.PokeMZ.PBS;
    const Pkmn = () => window.PokeMZ.Pokemon;
    const tr = (key, fallback, args) => Pkmn().tr(key, fallback, args);

    let dexCache = null;
    PBS.onReload(() => (dexCache = null));

    /** @return {Object} The battle dex (built once per data load). */
    function battleDex() {
        if (!window.PSSim) {
            throw new Error("PokeMZ_PBS_Battle needs the PS_Sim plugin (enable it in the Plugin Manager).");
        }
        if (!dexCache) {
            dexCache = makeDex(window.PSSim, PBS.registries);
        }
        return dexCache;
    }

    /**
     * @brief Text environment for the presenter (localized names).
     * @param {BattleBridge} bridge Bridge.
     * @return {Object} env for TextPresenter.
     */
    function textEnv(bridge) {
        const nameOf = (reg, id) => {
            const e = PBS[reg].tryGet(id);
            return e ? e.name : id;
        };
        return {
            tr,
            wild: bridge.wild,
            trainer: bridge.trainer ? bridge.trainer.displayName : "",
            pokemon(side, token) {
                const p = bridge.member(side, token);
                const name = p ? p.name() : token;
                if (side === "p1") {
                    return name;
                }
                return bridge.wild ? tr("Battle.Name.Wild", "the wild {name}", { name }) : tr("Battle.Name.Foe", "the opposing {name}", { name });
            },
            speciesName: id => nameOf("species", id),
            move: id => nameOf("moves", id),
            ability: id => nameOf("abilities", id),
            item: id => nameOf("items", id),
            stat: id => tr(`Stat.${id}`, { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasiveness" }[id] || id),
            statusName: id => tr(`Status.${id}`, { brn: "burn", par: "paralysis", slp: "sleep", psn: "poison", tox: "poison", frz: "freeze" }[id] || id),
            weatherName: id => tr(`Weather.${id}`, { raindance: "rain", sunnyday: "harsh sunlight", sandstorm: "sandstorm", hail: "hail", snow: "snow" }[id] || id),
        };
    }

    /** @brief Capitalizes the first letter (sentence start). */
    const sentence = s => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

    /**
     * @brief Game-side work for the bridge: EXP, items, catching, Pokédex.
     */
    const adapter = {
        seen(foe) {
            if (foe) {
                $gamePokemon.pokedex.register(foe.speciesId, false);
            }
        },

        /** @brief EXP and EVs for everyone who earned them. */
        async exp(foe, members, bridge) {
            const species = foe.species();
            const R = Pkmn().rules;
            for (const m of members) {
                const p = m.pokemon;
                if (!m.participated && !R.expShareAll) {
                    continue;
                }
                if (p.isMaxLevel()) {
                    continue;
                }
                const exp = Pkmn().expGain({
                    baseExp: species.baseExp,
                    level: foe.level,
                    victorLevel: p.level,
                    trainer: !bridge.wild,
                    participated: m.participated,
                    luckyEgg: p.heldItem === "luckyegg",
                    traded: p._otId !== $gamePokemon.trainerId,
                });
                for (const s of Pkmn().STATS) {
                    let ev = species.evYield[s] || 0;
                    if (p.heldItem === "machobrace") {
                        ev *= 2;
                    }
                    if (ev) {
                        p.gainEv(s, ev);
                    }
                }
                await bridge.presenter.say(tr("Battle.Msg.GainedExp", "{pokemon} gained {n} Exp. Points!", { pokemon: p.name(), n: exp }));
                const lastLevel = p.level;
                p.gainExp(exp);
                bridge.presenter.refresh(bridge);
                if (p.level !== lastLevel) {
                    bridge.refreshSim(p);
                    await Pkmn().Flow.afterExp(p);
                    bridge.refreshSim(p);
                    bridge.presenter.refresh(bridge);
                }
            }
        },

        /**
         * @brief Uses a bag item in battle (healing, X items, balls).
         * @return {Promise<string>} "used" | "caught" | "cancel".
         */
        async useItem(a, bridge) {
            const item = PBS.items.get(a.item);
            const bag = $gameParty.bag();
            const say = text => bridge.presenter.say(text);
            const player = $gameParty.leader() ? $gameParty.leader().name() : "";
            if (item.effect === "ball") {
                if (!bridge.wild) {
                    await say(tr("Battle.Msg.BallBlocked", "The Trainer blocked your Poké Ball!"));
                    await say(tr("Battle.Msg.DontBeAThief", "Don't be a thief!"));
                    bag.lose(item.id, 1);
                    return "used";
                }
                bag.lose(item.id, 1);
                await say(tr("Battle.Msg.ThrewBall", "{player} threw a {item}!", { player, item: item.name }));
                const foe = bridge.active("p2");
                const gp = bridge.member("p2", foe.name);
                const species = gp.species();
                const mine = bridge.active("p1");
                const meta = PBS.mapMetadataFor($gameMap.mapId());
                const mult = ballModifier(item.params || {}, {
                    turn: bridge.turn,
                    wildLevel: gp.level,
                    playerLevel: mine ? mine.level : 1,
                    wildTypes: species.types,
                    water: bridge.encounterType === "water",
                    fishing: /rod$/.test(bridge.encounterType || ""),
                    night: Pkmn().timeOfDay() === "night",
                    cave: !!meta && !meta.outdoor,
                    caught: $gamePokemon.pokedex.isCaught(species.id),
                    speed: species.baseStats.spe,
                    asleep: foe.status === "slp",
                    ultraBeast: (species.flags || []).includes("ultrabeast"),
                    sameSpecies: !!mine && bridge.member("p1", mine.name).baseSpeciesId === species.baseId,
                    wildGender: gp.gender,
                    playerGender: mine ? bridge.member("p1", mine.name).gender : "",
                    moonStone: (species.evolutions || []).some(e => e.param === "moonstone"),
                });
                const levelBonus = gp.level < 13 ? Math.max(1, (36 - 2 * gp.level) / 10) : 1;
                const r = Pkmn().captureCheck({ maxHp: foe.maxhp, hp: foe.hp, catchRate: species.catchRate, ball: mult, status: foe.status, levelBonus });
                await bridge.presenter.ballShakes(r.shakes, r.caught);
                if (!r.caught) {
                    const misses = [tr("Battle.Msg.BrokeFree0", "Oh, no! The Pokémon broke free!"), tr("Battle.Msg.BrokeFree1", "Aww! It appeared to be caught!"), tr("Battle.Msg.BrokeFree2", "Aargh! Almost had it!"), tr("Battle.Msg.BrokeFree3", "Gah! It was so close, too!")];
                    await say(misses[r.shakes] || misses[0]);
                    return "used";
                }
                await say(tr("Battle.Msg.Caught", "Gotcha! {pokemon} was caught!", { pokemon: gp.name() }));
                gp.setHp(foe.hp);
                gp.status = foe.status || "";
                gp._ball = item.id;
                if (item.id === "friendball") {
                    gp._friendship = 150;
                }
                if (item.id === "healball") {
                    gp.healAll();
                }
                gp._otName = player;
                gp._otId = $gamePokemon.trainerId;
                gp._metMap = $gameMap.mapId();
                gp._metLevel = gp.level;
                const isNew = !$gamePokemon.pokedex.isCaught(species.id);
                if (isNew) {
                    await say(tr("Battle.Msg.DexRegistered", "{pokemon}'s data was added to the Pokédex.", { pokemon: species.name }));
                }
                bridge.caught = gp;
                return "caught";
            }
            const target = a.target || bridge.member("p1", bridge.active("p1").name);
            if (item.effect === "xitem") {
                const sp = bridge.active("p1");
                const stat = item.params.stat;
                bag.lose(item.id, 1);
                await say(tr("Battle.Msg.UsedItem", "{player} used the {item}.", { player, item: item.name }));
                sp.boostBy({ [stat]: item.params.stages || 2 });
                await say(
                    tr(`Battle.Msg.StatRose${Math.min(3, item.params.stages || 2)}`, "{pokemon}'s {stat} rose sharply!", {
                        pokemon: target.name(),
                        stat: textEnv(bridge).stat(stat),
                    })
                );
                return "used";
            }
            // Pokémon items (healing, revives, PP): use the field handler on
            // the game Pokémon, then copy the result into the sim.
            bridge.syncBack();
            await say(tr("Battle.Msg.UsedItem", "{player} used the {item}.", { player, item: item.name }));
            const used = await Pkmn().useItem(item.id, target, { chooseMove: (p, prompt) => bridge.presenter.chooseMoveSlot(p, prompt) });
            if (!used) {
                return "cancel";
            }
            const sp = bridge.simOf(target);
            if (sp) {
                sp.hp = target.hp;
                sp.fainted = target.hp <= 0;
                if (sp.hp > 0 && sp.status === "fnt") {
                    sp.status = "";
                }
                if (!target.status && sp.status && sp.status !== "fnt") {
                    sp.cureStatus(true);
                }
                target.moves().forEach((m, i) => {
                    const slot = sp.moveSlots.find(s => s.id === m.id);
                    if (slot) {
                        slot.pp = m.pp;
                    }
                    const base = sp.baseMoveSlots.find(s => s.id === m.id);
                    if (base) {
                        base.pp = m.pp;
                    }
                });
            }
            bridge.presenter.refresh(bridge);
            return "used";
        },
    };

    /**
     * @brief Starts a battle in the battle screen.
     * @param {Object} o {wild, foes, trainer, canLose, encounterType, bgm}.
     * @return {Promise<string>} Result.
     */
    function startBattle(o) {
        const UI = window.PokeMZ.UI;
        if (!UI || !UI.screens.has("battle")) {
            console.error("[PokeMZ.Battle] the battle screen needs PokeMZ_UI_Pokemon.");
            return Promise.resolve("win");
        }
        return new Promise(resolve => {
            const bridge = new BattleBridge({
                sim: window.PSSim,
                dex: battleDex(),
                party: $gameParty.pokemon(),
                foes: o.foes,
                wild: !!o.wild,
                trainer: o.trainer,
                adapter,
                encounterType: o.encounterType || "",
                seed: [1, 2, 3, 4].map(() => Math.floor(Math.random() * 65536)),
            });
            bridge.textEnv = textEnv(bridge);
            bridge.text = new TextPresenter(bridge.textEnv);
            bridge.format = ev => sentence(bridge.text.format(ev));
            bridge.messageFrames = CONFIG.messageFrames;
            const mapBgm = AudioManager.saveBgm();
            const mapBgs = AudioManager.saveBgs();
            const bgm = o.bgm || (o.wild ? CONFIG.wildBgm : CONFIG.trainerBgm);
            AudioManager.playBgm(bgm ? { name: bgm, volume: 90, pitch: 100, pan: 0 } : $gameSystem.battleBgm());
            AudioManager.stopBgs();
            SoundManager.playBattleStart();
            bridge.finish = async result => {
                if (result === "win" && !o.wild && o.trainer) {
                    await bridge.presenter.say(tr("Battle.Msg.Defeated", "You defeated {trainer}!", { trainer: o.trainer.displayName }));
                    if (o.trainer.loseText) {
                        await bridge.presenter.say(o.trainer.loseText);
                    }
                    const money = o.trainer.money || 0;
                    if (money) {
                        $gameParty.gainGold(money);
                        await bridge.presenter.say(tr("Battle.Msg.GotMoney", "You got {money} for winning!", { money: window.PokeMZ.L10n ? PokeMZ.L10n.formatCurrency(money) : money }));
                    }
                    $gamePokemon.defeatedTrainers = $gamePokemon.defeatedTrainers || {};
                    $gamePokemon.defeatedTrainers[o.trainer.id] = true;
                }
                if (result === "lose") {
                    await bridge.presenter.say(tr("Battle.Msg.OutOfPokemon", "You have no more Pokémon that can fight!"));
                    if (!o.canLose) {
                        const lost = Math.floor($gameParty.gold() / 2);
                        $gameParty.loseGold(lost);
                        await bridge.presenter.say(tr("Battle.Msg.WhitedOut", "You blacked out!"));
                    }
                }
                for (const p of $gameParty.pokemon()) {
                    p.updateEvolutionReadiness();
                }
            };
            bridge.onClosed = async result => {
                AudioManager.replayBgm(mapBgm);
                AudioManager.replayBgs(mapBgs);
                if (result === "caught" && bridge.caught) {
                    // After the battle screen closed: the name entry is a scene.
                    await UI.wait(2);
                    const gp = bridge.caught;
                    if (UI.enterName && (await UI.confirm(tr("Pkmn.Msg.Nickname", "Give a nickname to {species}?", { species: gp.species().name })))) {
                        const name = await UI.enterName({ initial: gp.species().name, maxLength: 12 });
                        if (name) {
                            gp.setName(name);
                        }
                    }
                    const where = $gameParty.addPokemon(gp);
                    if (where && !where.party) {
                        await UI.message(tr("PC.Msg.SentToBox", "{name} was sent to {box}.", { name: gp.name(), box: $gamePokemon.storage.boxName(where.box) }));
                    }
                }
                if (result === "lose" && !o.canLose) {
                    $gameParty.healPokemon();
                    const spot = $gamePokemon.lastHealSpot;
                    if (spot) {
                        $gamePlayer.reserveTransfer(spot[0], spot[1], spot[2], 2, 0);
                    } else {
                        SceneManager.goto(Scene_Gameover);
                    }
                }
                resolve(result);
            };
            UI.openScreen("battle", { bridge });
        });
    }

    /**
     * @brief Starts a wild battle.
     * @param {string} species Species ID.
     * @param {number} level Level.
     * @param {Object} [o] {shiny, encounterType, canLose}.
     * @return {Promise<string>} Result.
     */
    function startWild(species, level, o = {}) {
        const foe = new Game_Pokemon(species, level, { shiny: o.shiny, otName: "", otId: -1 });
        return startBattle(Object.assign({ wild: true, foes: [foe] }, o));
    }

    /**
     * @brief Starts a trainer battle from trainers.json.
     * @param {string} id Trainer ID.
     * @param {Object} [o] {canLose}.
     * @return {Promise<string>} Result.
     */
    function startTrainer(id, o = {}) {
        const t = PBS.trainers.get(id);
        const type = PBS.trainerTypes.get(t.trainerType);
        const foes = t.pokemon.map(m => {
            const p = new Game_Pokemon(m.species, m.level, {
                moves: m.moves && m.moves.length ? m.moves : undefined,
                nature: m.nature,
                gender: m.gender,
                shiny: m.shiny,
                nickname: m.nickname,
                heldItem: m.item || "",
                ivs: m.ivs,
                evs: m.evs,
                friendship: m.friendship,
                ball: m.ball || "pokeball",
                otName: t.name,
                otId: -2,
            });
            if (m.ability) {
                const slot = Object.keys(p.species().abilities).find(k => p.species().abilities[k] === m.ability);
                if (slot) {
                    p._abilitySlot = slot;
                }
            }
            return p;
        });
        const last = t.pokemon[t.pokemon.length - 1];
        const trainer = {
            id,
            name: t.sourceText("name"),
            displayName: `${type.name} ${t.name}`,
            skill: type.skill,
            loseText: t.loseText,
            money: type.baseMoney * (last ? last.level : 1),
        };
        return startBattle(Object.assign({ wild: false, foes, trainer, bgm: type.battleBGM }, o));
    }

    // Plugin commands wait for the battle to end.
    const waitFor = (interpreter, promise, variable, map) => {
        let done = false;
        promise.then(r => {
            done = true;
            if (variable) {
                $gameVariables.setValue(variable, map[r] || 0);
            }
        });
        interpreter.setWaitMode("pbsFlow");
        interpreter._pbsFlowDone = () => done;
    };
    const RESULTS = { win: 1, lose: 2, run: 3, caught: 4 };

    PluginManager.registerCommand(PLUGIN_NAME, "wildBattle", function(args) {
        const p = startWild(PBS.toID(args.species), Number(args.level || 5), { shiny: args.shiny === "true", canLose: args.canLose === "true" });
        waitFor(this, p, Number(args.variable || 0), RESULTS);
    });

    PluginManager.registerCommand(PLUGIN_NAME, "trainerBattle", function(args) {
        const p = startTrainer(PBS.toID(args.trainer), { canLose: args.canLose === "true" });
        waitFor(this, p, Number(args.variable || 0), RESULTS);
    });

    window.PokeMZ.Battle = Object.assign(Engine, {
        config: CONFIG,
        adapter,
        battleDex,
        textEnv,
        startBattle,
        startWild,
        startTrainer,
        /** @return {boolean} True if the trainer was beaten. */
        isDefeated: id => !!($gamePokemon.defeatedTrainers || {})[PBS.toID(id)],
        /** @brief Rebuilds the battle dex (after registerEffect at runtime). */
        rebuildDex: () => (dexCache = null),
    });
})();
