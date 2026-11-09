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
 * @arg species2
 * @text Second Species (double)
 * @desc Fill in for a wild double battle.
 * @type string
 * @default
 * @arg level2
 * @text Second Level
 * @type number
 * @default 0
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
 * @arg trainer2
 * @text Second Trainer ID
 * @desc Two trainers at once (double battle), or the second foe of a
 * partner battle.
 * @type string
 * @default
 * @arg partner
 * @text Partner Trainer ID
 * @desc A trainer who fights beside the player (multi battle).
 * @type string
 * @default
 * @arg coop
 * @text Player 2 Controls Partner
 * @desc auto = yes when a second local player has joined (PokeMZ_Input).
 * @type select
 * @option auto
 * @option on
 * @option off
 * @default auto
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
 *
 * Co-op: in a partner (multi) battle, a second local player who joined
 * through PokeMZ_Input controls the partner's Pokémon with their own
 * device (Fight and Pokémon; the bag and running stay with player 1).
 * startTrainer(ids, {partner, coop: "auto" | true | false}). If player 2's
 * controller is unplugged, player 1 makes the partner's choices.
 */

(() => {
    "use strict";

    //=========================================================================
    // Engine (pure: loaded by tests with @pkmn/sim)
    //=========================================================================

    const ACTION_MOVE = "pokemzaction";
    const FORMAT = "pokemzsingles";
    /** @brief Showdown format IDs by battle layout. */
    const FORMATS = { singles: "pokemzsingles", doubles: "pokemzdoubles", multi: "pokemzmulti" };
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
            Scripts: {
                inherit: "gen9",
                side: {
                    // Dynamax is gen 8 only in Showdown; PokéMZ turns it on
                    // per battle (battle.pmzDynamax).
                    canDynamaxNow() {
                        if (!this.battle.pmzDynamax) {
                            return false;
                        }
                        if (this.battle.gameType === "multi" && this.battle.turn % 2 !== [1, 1, 0, 0][this.n]) {
                            return false;
                        }
                        // dynamaxUsed starts true outside gen 8, so look for
                        // this side's own Dynamax in the log instead.
                        const tag = `|-start|${this.id}`;
                        return !this.battle.log.some(l => l.startsWith(tag) && l.includes("|Dynamax"));
                    },
                },
            },
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
            Formats: [
                { name: "PokeMZ Singles", mod: "pokemz", gameType: "singles", ruleset: [] },
                { name: "PokeMZ Doubles", mod: "pokemz", gameType: "doubles", ruleset: [] },
                { name: "PokeMZ Multi", mod: "pokemz", gameType: "multi", ruleset: [] },
            ],
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
     * @brief "p2b: W" -> {side: "p2", slot: 1, token: "W"}.
     * @param {string} ident Pokémon ident.
     * @return {{side: string, slot: number, token: string}} Parts (slot -1
     *         when the ident has no position letter).
     */
    function parseIdent(ident) {
        const m = /^(p\d)([a-z]?):\s*(.*)$/.exec(ident || "");
        return m ? { side: m[1], slot: m[2] ? m[2].charCodeAt(0) - 97 : -1, token: m[3] } : { side: "", slot: -1, token: "" };
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
            const ev = { type: cmd.replace(/^-/, ""), side: who.side, slot: who.slot, token: who.token, from: kw.from || "", of: kw.of ? parseIdent(kw.of) : null, kw, args };
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
                    ev.gmax = args[2] === "Gmax";
                    break;
                case "detailschange":
                case "-formechange":
                    ev.type = cmd === "detailschange" ? "detailschange" : "formechange";
                    ev.species = toID(String(args[1] || "").split(", ")[0]);
                    break;
                case "-mega":
                    ev.item = toID(args[2]);
                    break;
                case "-terastallize":
                    ev.teraType = toID(args[1]);
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
                case "switch": {
                    if (ev.side === "p1") {
                        return t("Msg.Go", "Go! {pokemon}!", { pokemon: p });
                    }
                    const sender = e.sender ? e.sender(ev.side, ev.token) : e.wild ? "" : e.trainer;
                    const name = e.memberName ? e.memberName(ev.side, ev.token) : e.speciesName(ev.species);
                    return sender ? t("Msg.SentOut", "{trainer} sent out {pokemon}!", { trainer: sender, pokemon: name }) : t("Msg.WildAppeared", "A wild {pokemon} appeared!", { pokemon: name });
                }
                case "mega":
                    return t("Msg.Mega", "{pokemon} has Mega Evolved!", { pokemon: p });
                case "primal":
                    return t("Msg.Primal", "{pokemon}'s Primal Reversion! It reverted to its primal form!", { pokemon: p });
                case "zpower":
                    return t("Msg.ZPower", "{pokemon} surrounds itself with its Z-Power!", { pokemon: p });
                case "terastallize":
                    return t("Msg.Terastallize", "{pokemon} has Terastallized into the {type} type!", { pokemon: p, type: e.typeName ? e.typeName(ev.teraType) : ev.teraType });
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
                    if (ev.effect === "dynamax") {
                        return ev.gmax ? t("Msg.Gigantamax", "{pokemon} Gigantamaxed!", { pokemon: p }) : t("Msg.Dynamax", "{pokemon} Dynamaxed!", { pokemon: p });
                    }
                    if (ev.effect === "confusion") {
                        return t("Msg.Confused", "{pokemon} became confused!", { pokemon: p });
                    }
                    if (ev.effect === "substitute") {
                        return t("Msg.Substitute", "{pokemon} put in a substitute!", { pokemon: p });
                    }
                    return null;
                case "end":
                    if (ev.effect === "dynamax") {
                        return t("Msg.DynamaxEnd", "{pokemon} returned to its normal size!", { pokemon: p });
                    }
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
     * @brief Picks a move for one active slot (random, or by damage
     *        estimate for skilled trainers).
     * @param {Object} slotReq request.active[i] of that slot.
     * @param {Object} c {skill, dex, self (sim Pokémon), foes (sim Pokémon)}.
     * @param {function(): number} [rng] Random.
     * @return {{index: number, target: Object|null}} Move index and target.
     */
    function aiPickMove(slotReq, c = {}, rng = Math.random) {
        const options = slotReq.moves.map((m, i) => ({ m, i })).filter(o => !o.m.disabled && o.m.id !== ACTION_MOVE && (o.m.pp === undefined || o.m.pp > 0));
        const foes = (c.foes || []).filter(f => f && !f.fainted);
        if (!options.length) {
            return { index: 0, target: foes[0] || null };
        }
        let best = null;
        for (const o of options) {
            const target = foes.length ? foes[Math.floor(rng() * foes.length)] : null;
            let score = 1;
            if (c.skill > 0 && c.dex && target) {
                const move = c.dex.moves.get(o.m.id);
                score = move.category === "Status" ? 20 : move.basePower || 40;
                const types = target.getTypes ? target.getTypes() : [];
                if (move.category !== "Status") {
                    if (c.dex.getImmunity && !c.dex.getImmunity(move.type, types)) {
                        score = 0;
                    } else if (c.dex.getEffectiveness) {
                        score *= Math.pow(2, c.dex.getEffectiveness(move.type, types));
                    }
                    if (c.self && c.self.getTypes && c.self.getTypes().includes(move.type)) {
                        score *= 1.5;
                    }
                }
            }
            score *= 0.85 + rng() * 0.3;
            if (!best || score > best.score) {
                best = { score, index: o.i, target };
            }
        }
        return best;
    }

    /**
     * @brief Old single-slot helper (kept for scripts): "move N".
     * @param {Object} request Showdown request.
     * @param {Object} [c] Context of aiPickMove.
     * @return {string} Choice.
     */
    function aiChoice(request, c = {}, rng = Math.random) {
        const active = request.active && request.active[0];
        return active ? `move ${aiPickMove(active, c, rng).index + 1}` : "default";
    }

    /**
     * @brief Lets a local player control a side (co-op: player 2 runs the
     *        partner in a multi battle) through the battle screen's menus.
     *        Fight and Pokémon only: the bag and running stay with player 1.
     */
    class HumanController {
        /**
         * @param {Object} [o] {player = 2, gimmicks: ["mega", ...] the side
         *        may use, fallback: controller used when no presenter can
         *        ask (tests, headless)}.
         */
        constructor(o = {}) {
            this.human = true;
            this.player = o.player || 2;
            this.gimmicks = new Set(o.gimmicks || []);
            this.fallback = o.fallback || new AIController({ gimmicks: o.gimmicks });
        }

        /**
         * @brief Synchronous fallback (used only when the bridge can't ask).
         * @param {string} sideId Side.
         * @param {BattleBridge} bridge Bridge.
         * @return {string} Choice.
         */
        choose(sideId, bridge) {
            return this.fallback.choose(sideId, bridge);
        }
    }

    /**
     * @brief Controls a side with the computer. Any object with the same
     *        choose(sideId, bridge) method can control a side (e.g. a
     *        future online player).
     */
    class AIController {
        /**
         * @param {Object} [o] {skill, gimmicks: ["mega", "zmove", "dynamax",
         *        "terastallize"], rng}.
         */
        constructor(o = {}) {
            this.skill = o.skill || 0;
            this.gimmicks = new Set(o.gimmicks || []);
            this.rng = o.rng || Math.random;
        }

        /**
         * @brief Makes the choice string for a side's request.
         * @param {string} sideId "p2" ...
         * @param {BattleBridge} bridge Bridge.
         * @return {string} Choice.
         */
        choose(sideId, bridge) {
            const side = bridge.battle[sideId];
            const req = side.activeRequest;
            if (req.forceSwitch) {
                const taken = new Set();
                return req.forceSwitch
                    .map((need, slot) => {
                        if (!need) {
                            return "pass";
                        }
                        const idx = bridge.benchFor(sideId, slot, taken);
                        if (idx < 0) {
                            return "pass";
                        }
                        taken.add(idx);
                        return `switch ${idx + 1}`;
                    })
                    .join(", ");
            }
            let gimmickUsed = false;
            return req.active
                .map((slotReq, slot) => {
                    const self = side.active[slot];
                    if (!self || self.fainted || slotReq.commanding) {
                        return "pass";
                    }
                    const foes = bridge.foesOf(sideId);
                    const pick = aiPickMove(slotReq, { skill: this.skill, dex: bridge.dex, self, foes }, this.rng);
                    let choice = `move ${pick.index + 1}`;
                    const target = bridge.targetLoc(self, pick.target, slotReq.moves[pick.index] && slotReq.moves[pick.index].target);
                    if (target !== null) {
                        choice += ` ${target}`;
                    }
                    if (!gimmickUsed) {
                        const g = this.gimmickFor(slotReq, pick.index);
                        if (g) {
                            choice += ` ${g}`;
                            gimmickUsed = true;
                        }
                    }
                    return choice;
                })
                .join(", ");
        }

        /** @return {string} A gimmick keyword this trainer may use now. */
        gimmickFor(slotReq, moveIndex) {
            if (this.gimmicks.has("mega") && slotReq.canMegaEvo) {
                return "mega";
            }
            if (this.gimmicks.has("zmove") && slotReq.canZMove && slotReq.canZMove[moveIndex]) {
                return "zmove";
            }
            if (this.gimmicks.has("dynamax") && slotReq.canDynamax) {
                return "dynamax";
            }
            if (this.gimmicks.has("terastallize") && slotReq.canTerastallize) {
                return "terastallize";
            }
            return "";
        }
    }

    /** @brief Move targets that need a chosen target with two or more foes. */
    const TARGETED = new Set(["normal", "any", "adjacentAlly", "adjacentAllyOrSelf", "adjacentFoe"]);

    /**
     * @brief Runs one battle in the Showdown simulator: singles, doubles
     *        (one or two trainers, or two wild Pokémon) or multi battles with
     *        a partner.
     *
     *        Sides: p1 is the player (asked through the presenter), p2 the
     *        opponent, and in multi battles p3 the partner and p4 the second
     *        opponent. Other sides are run by controllers (AIController now;
     *        anything with choose(sideId, bridge) works).
     *
     *        Game-side work goes through `adapter` so the bridge also runs in
     *        Node: {exp(foe, members, bridge), seen(foe), useItem(action,
     *        bridge)}.
     */
    class BattleBridge {
        /**
         * @param {Object} o {sim, dex, format ("singles" | "doubles" |
         *        "multi"), party, foes, sides ({p2: {team, name, owners,
         *        controller}, p3, p4}), wild, trainer, presenter, adapter,
         *        seed, gimmicks ({dynamax})}. party/foes are shortcuts for
         *        p1/p2 teams.
         */
        constructor(o) {
            Object.assign(this, o);
            this.format = o.format || "singles";
            this.sides = Object.assign({}, o.sides || {});
            this.sides.p1 = Object.assign({ team: o.party || [], name: "Player" }, this.sides.p1 || {});
            if (!this.sides.p2) {
                this.sides.p2 = { team: o.foes || [], name: o.wild ? "Wild" : (o.trainer && o.trainer.name) || "Foe" };
            }
            this.result = null;
            this.turn = 0;
            this.logIndex = 0;
            this.escapeAttempts = 0;
            this.participants = new Map();
            this.tokens = new Map();
            this.owners = new Map();
        }

        /** @return {Array<string>} Side IDs in this battle. */
        sideIds() {
            return this.format === "multi" ? ["p1", "p2", "p3", "p4"] : ["p1", "p2"];
        }

        /** @return {Array<string>} Opposing side IDs of a side. */
        opponentsOf(sideId) {
            const mine = sideId === "p1" || sideId === "p3";
            return this.sideIds().filter(id => (id === "p1" || id === "p3") !== mine);
        }

        /** @return {Array<Object>} Active, not fainted foe sim Pokémon. */
        foesOf(sideId) {
            const out = [];
            for (const id of this.opponentsOf(sideId)) {
                for (const p of this.battle[id].active) {
                    if (p && !p.fainted) {
                        out.push(p);
                    }
                }
            }
            return out;
        }

        /** @return {Object} Game Pokémon for a side and token. */
        member(side, token) {
            return this.tokens.get(`${side}:${token}`) || null;
        }

        /** @return {*} The owner (trainer) of a token. */
        ownerOf(side, token) {
            return this.owners.get(`${side}:${token}`);
        }

        /** @return {Object|null} The sim Pokémon of a game Pokémon. */
        simOf(pkmn) {
            for (const id of this.sideIds()) {
                const s = this.battle[id].pokemon.find(p => this.member(id, p.name) === pkmn);
                if (s) {
                    return s;
                }
            }
            return null;
        }

        /** @return {Object|null} An active sim Pokémon of a side. */
        active(side, slot = 0) {
            return (this.battle[side] && this.battle[side].active[slot]) || null;
        }

        /** @return {Array<Object>} The player's active sim Pokémon. */
        playerActives() {
            return this.battle.p1.active.filter(Boolean);
        }

        /**
         * @brief Bench index for a forced switch, keeping each slot to its
         *        owner's Pokémon (two trainers sharing a side).
         * @param {string} sideId Side.
         * @param {number} slot Active slot.
         * @param {Set<number>} taken Indexes already chosen this turn.
         * @return {number} Index in side.pokemon (-1 = none).
         */
        benchFor(sideId, slot, taken) {
            const side = this.battle[sideId];
            const free = side.pokemon.map((p, i) => ({ p, i })).filter(({ p, i }) => !p.fainted && !p.isActive && !taken.has(i));
            const owned = free.filter(({ p }) => this.ownerOf(sideId, p.name) === undefined || this.ownerOf(sideId, p.name) === slot);
            const pick = (this.sides[sideId].owners ? owned : free)[0] || free[0];
            return pick ? pick.i : -1;
        }

        /**
         * @brief Showdown target location of a target for a move.
         * @param {Object} source Sim Pokémon using the move.
         * @param {Object|null} target Sim Pokémon targeted.
         * @param {string} moveTarget Move target type.
         * @return {number|null} Location, or null when none is needed.
         */
        targetLoc(source, target, moveTarget) {
            if (this.format === "singles" || !TARGETED.has(moveTarget) || !target) {
                return null;
            }
            const loc = source.getLocOf ? source.getLocOf(target) : null;
            return typeof loc === "number" ? loc : null;
        }

        /**
         * @brief Targets the player may pick for a move.
         * @param {number} slot Player's active slot.
         * @param {string} moveTarget Move target type.
         * @return {Array<{loc: number, pokemon: Object, side: string}>|null}
         *         Choices, or null when no target is chosen.
         */
        targetsFor(slot, moveTarget, sideId = "p1") {
            if (this.format === "singles" || !TARGETED.has(moveTarget)) {
                return null;
            }
            const source = this.battle[sideId].active[slot];
            const out = [];
            for (const loc of [1, 2, -1, -2]) {
                if (!this.battle.validTargetLoc(loc, source, moveTarget)) {
                    continue;
                }
                const target = source.getAtLoc ? source.getAtLoc(loc) : null;
                if (target && !target.fainted) {
                    out.push({ loc, pokemon: target, side: target.side.id });
                }
            }
            return out.length > 1 ? out : null;
        }

        /** @brief Creates the simulator battle. */
        start() {
            const battle = new this.sim.Battle({ formatid: FORMATS[this.format] || FORMAT, seed: this.seed }, this.dex);
            battle.pmzDynamax = !!(this.gimmicks && this.gimmicks.dynamax);
            this.battle = battle;
            const prefix = { p1: "P", p2: "F", p3: "A", p4: "G" };
            const team = sideId => {
                const s = this.sides[sideId];
                const list = s.team.filter(p => !p.isEgg());
                const lead = list.findIndex(p => p.hp > 0);
                let order = list.slice();
                if (lead > 0) {
                    order.unshift(order.splice(lead, 1)[0]);
                }
                if (s.owners) {
                    // Two trainers share the side: each one's lead opens
                    // their own slot.
                    const firstOf = owner => order.find(p => s.owners.get(p) === owner && p.hp > 0);
                    const leads = [firstOf(0), firstOf(1)].filter(Boolean);
                    order = leads.concat(order.filter(p => !leads.includes(p)));
                }
                return order.map((p, i) => {
                    const token = `${prefix[sideId]}${i}`;
                    this.tokens.set(`${sideId}:${token}`, p);
                    if (s.owners) {
                        this.owners.set(`${sideId}:${token}`, s.owners.get(p));
                    }
                    return Object.assign(p.toShowdownSet(), { name: token });
                });
            };
            // Our side first, so HP/status/PP are set before the battle starts.
            const order = this.format === "multi" ? ["p1", "p3", "p2", "p4"] : ["p1", "p2"];
            for (const id of order) {
                battle.setPlayer(id, { name: this.sides[id].name || id, team: team(id) });
                if (battle[id]) {
                    for (const sp of battle[id].pokemon) {
                        this.applyToSim(this.member(id, sp.name), sp);
                        if (id === "p1") {
                            sp.moveSlots.push({ move: "PokeMZ Action", id: ACTION_MOVE, pp: 64, maxpp: 64, target: "self", disabled: false, used: false, virtual: true });
                        }
                    }
                }
            }
        }

        /** @brief Copies HP, status and PP from a game Pokémon to the sim. */
        applyToSim(gp, sp) {
            if (!gp || !sp || this.battle.started && sp.isActive) {
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

        /** @brief Copies HP, status and PP back to the player's Pokémon. */
        syncBack() {
            for (const sp of this.battle.p1.pokemon) {
                const gp = this.member("p1", sp.name);
                if (!gp) {
                    continue;
                }
                gp.setHp(Math.max(0, Math.min(gp.mhp, sp.fainted ? 0 : sp.hp)));
                gp.status = sp.fainted || sp.status === "fnt" ? "" : sp.status || "";
                gp.moves().forEach(m => {
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
                // The foes appear before the player sends out a Pokémon.
                this.introShown = true;
                const foe = e => e.type === "switch" && (e.side === "p2" || e.side === "p4");
                events = events.filter(foe).concat(events.filter(e => !foe(e)));
            }
            for (const ev of events) {
                this.track(ev);
                await this.presenter.show(ev, this);
                if (ev.type === "faint" && this.opponentsOf("p1").includes(ev.side)) {
                    await this.onFoeFainted(ev.side, ev.token);
                }
            }
        }

        /** @brief Tracks turns, participants and seen foes. */
        track(ev) {
            if (ev.type === "turn") {
                this.turn = ev.turn;
            }
            if (ev.type === "switch" && this.opponentsOf("p1").includes(ev.side) && this.adapter.seen) {
                this.adapter.seen(this.member(ev.side, ev.token));
            }
            if (ev.type === "terastallize" && ev.side === "p1" && this.adapter.usedGimmick) {
                this.adapter.usedGimmick("terastallize");
            }
            const mine = this.playerActives().filter(p => !p.fainted);
            for (const foe of this.foesOf("p1")) {
                const key = `${foe.side.id}:${foe.name}`;
                if (!this.participants.has(key)) {
                    this.participants.set(key, new Set());
                }
                for (const m of mine) {
                    this.participants.get(key).add(m.name);
                }
            }
        }

        /** @brief EXP and EVs for a fainted foe (adapter does the work). */
        async onFoeFainted(side, token) {
            const foe = this.member(side, token);
            const part = this.participants.get(`${side}:${token}`) || new Set();
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
            const diff = stats.hp - sp.baseMaxhp;
            if (!sp.volatiles.dynamax) {
                sp.maxhp = stats.hp;
            }
            sp.baseMaxhp = stats.hp;
            sp.hp = Math.min(sp.maxhp, sp.hp + Math.max(0, diff));
            sp.details = sp.getUpdatedDetails ? sp.getUpdatedDetails() : sp.details;
            const slots = gp.moves().map((m, i) => {
                const move = this.dex.moves.get(m.id);
                return { move: move.name, id: move.id, pp: m.pp, maxpp: gp.maxPp(i), target: move.target, disabled: false, used: false };
            });
            sp.baseMoveSlots = slots.map(s => Object.assign({}, s));
            if (!sp.transformed) {
                sp.moveSlots = slots.concat([{ move: "PokeMZ Action", id: ACTION_MOVE, pp: 64, maxpp: 64, target: "self", disabled: false, used: false, virtual: true }]);
            }
        }

        /** @return {boolean} True if a side needs a choice now. */
        needs(side) {
            const s = this.battle[side];
            const req = s && s.activeRequest;
            return !!req && !req.wait && !s.isChoiceDone();
        }

        /** @return {boolean} True if every foe Pokémon fainted. */
        foesDefeated() {
            return this.opponentsOf("p1").every(id => this.battle[id].pokemon.every(p => p.fainted));
        }

        /**
         * @brief Runs the battle to the end.
         * @return {Promise<string>} "win" | "lose" | "run" | "caught".
         */
        async run() {
            this.start();
            await this.flush();
            let guard = 0;
            while (!this.battle.ended && !this.result) {
                if (this.needs("p1")) {
                    await this.chooseForPlayer();
                    if (this.result) {
                        break;
                    }
                }
                for (const id of this.sideIds().slice(1)) {
                    if (this.needs(id)) {
                        const ctrl = this.sides[id].controller || this.ai || new AIController();
                        if (ctrl.human && this.presenter && this.presenter.chooseAction) {
                            await this.chooseForPlayer(id);
                            if (this.result) {
                                break;
                            }
                            continue;
                        }
                        const choice = ctrl.choose(id, this);
                        if (!this.battle.choose(id, choice)) {
                            this.battle.choose(id, "default");
                        }
                    }
                }
                await this.flush();
                if (++guard > 2000) {
                    break; // never hang on an unexpected request
                }
            }
            if (!this.result) {
                this.result = this.foesDefeated() ? "win" : "lose";
            }
            this.syncBack();
            return this.result;
        }

        /**
         * @brief Asks a local player for every active slot of a side (p1, or
         *        a side run by a HumanController) and sends the choice.
         *        Bag items and balls act at once; failed escapes and items use
         *        the slot's turn through the action move.
         * @param {string} [sideId="p1"] Side to choose for.
         */
        async chooseForPlayer(sideId = "p1") {
            const side = this.battle[sideId];
            const req = side.activeRequest;
            if (req.forceSwitch) {
                const parts = [];
                const taken = new Set();
                for (let slot = 0; slot < req.forceSwitch.length; slot++) {
                    if (!req.forceSwitch[slot] || this.benchFor(sideId, slot, taken) < 0) {
                        parts.push("pass");
                        continue;
                    }
                    const pkmn = await this.presenter.chooseSwitch(this, true, { slot, taken, side: sideId });
                    const idx = side.pokemon.findIndex(sp => this.member(sideId, sp.name) === pkmn);
                    taken.add(idx);
                    parts.push(`switch ${idx + 1}`);
                }
                if (!this.battle.choose(sideId, parts.join(", "))) {
                    this.battle.choose(sideId, "default");
                }
                return;
            }
            const actions = [];
            const ctx = { taken: new Set(), gimmickUsed: false };
            for (let slot = 0; slot < req.active.length; ) {
                const self = side.active[slot];
                if (!self || self.fainted || req.active[slot].commanding) {
                    actions[slot] = "pass";
                    slot++;
                    continue;
                }
                const a = await this.presenter.chooseAction(this, slot, ctx, sideId);
                if (a.type === "back") {
                    // Undo the previous slot's choice.
                    let prev = slot - 1;
                    while (prev >= 0 && actions[prev] === "pass") {
                        prev--;
                    }
                    if (prev >= 0) {
                        const undone = actions[prev];
                        if (undone && undone.gimmick) {
                            ctx.gimmickUsed = false;
                        }
                        if (undone && undone.switchIndex !== undefined) {
                            ctx.taken.delete(undone.switchIndex);
                        }
                        slot = prev;
                    }
                    continue;
                }
                const choice = await this.perform(a, slot, ctx, sideId);
                if (this.result) {
                    return;
                }
                if (choice === null) {
                    continue; // e.g. a cancelled item: ask this slot again
                }
                actions[slot] = choice;
                slot++;
                if (ctx.allPass) {
                    for (; slot < req.active.length; slot++) {
                        actions[slot] = side.active[slot] && !side.active[slot].fainted ? { text: `move ${ACTION_MOVE}` } : "pass";
                    }
                }
            }
            const text = actions.map(c => (typeof c === "string" ? c : c.text)).join(", ");
            if (!this.battle.choose(sideId, text)) {
                this.battle.choose(sideId, "default");
            }
        }

        /**
         * @brief Turns one player action into a choice (doing items now).
         * @param {Object} a {type: "move", slot, target, gimmick} |
         *        {type: "switch", pokemon} | {type: "item", item, target} |
         *        {type: "run"}.
         * @param {number} slot Active slot.
         * @param {Object} ctx Choice context of this turn.
         * @param {string} [sideId="p1"] Side choosing (only p1 may use the
         *        bag or run).
         * @return {Promise<Object|string|null>} Choice ({text, ...}), or null
         *         to ask again.
         */
        async perform(a, slot = 0, ctx = { taken: new Set() }, sideId = "p1") {
            if (sideId !== "p1" && (a.type === "run" || a.type === "item")) {
                return null;
            }
            const say = (key, fallback, args) => this.presenter.say(this.presenter.tr(`Battle.${key}`, fallback, args));
            const action = { text: `move ${ACTION_MOVE}` };
            switch (a.type) {
                case "move": {
                    let text = `move ${a.slot + 1}`;
                    if (a.target !== undefined && a.target !== null) {
                        text += ` ${a.target}`;
                    }
                    if (a.gimmick) {
                        text += ` ${a.gimmick}`;
                        ctx.gimmickUsed = true;
                    }
                    return { text, gimmick: a.gimmick || "" };
                }
                case "switch": {
                    const idx = this.battle[sideId].pokemon.findIndex(sp => this.member(sideId, sp.name) === a.pokemon);
                    if (idx < 0) {
                        return null;
                    }
                    ctx.taken.add(idx);
                    return { text: `switch ${idx + 1}`, switchIndex: idx };
                }
                case "run": {
                    if (!this.wild) {
                        await say("Msg.NoRunning", "No! There's no running from a Trainer battle!");
                        return null;
                    }
                    this.escapeAttempts++;
                    const mine = this.active("p1", slot);
                    const foes = this.foesOf("p1");
                    const fastest = foes.reduce((n, f) => Math.max(n, f.getStat("spe")), 0);
                    if (canEscape(mine.getStat("spe"), fastest, this.escapeAttempts)) {
                        await say("Msg.GotAway", "You got away safely!");
                        this.result = "run";
                        return action;
                    }
                    await say("Msg.CantEscape", "You couldn't get away!");
                    // A failed escape uses the whole side's turn.
                    ctx.allPass = true;
                    return action;
                }
                case "item": {
                    const r = await this.adapter.useItem(Object.assign({ slot }, a), this);
                    if (r === "caught") {
                        this.result = "caught";
                        return action;
                    }
                    return r === "cancel" ? null : action;
                }
                default:
                    return { text: "default" };
            }
        }
    }

    const Engine = {
        ACTION_MOVE,
        FORMAT,
        FORMATS,
        TARGETED,
        AIController,
        HumanController,
        aiPickMove,
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
                if (side === "p3") {
                    return tr("Battle.Name.Partner", "{trainer}'s {name}", { trainer: bridge.sides.p3.displayName || "", name });
                }
                return bridge.wild ? tr("Battle.Name.Wild", "the wild {name}", { name }) : tr("Battle.Name.Foe", "the opposing {name}", { name });
            },
            /** @return {string} Who sends a Pokémon out ("" = wild). */
            sender(side, token) {
                if (bridge.wild && side !== "p3") {
                    return "";
                }
                const owner = bridge.ownerOf(side, token);
                const s = bridge.sides[side] || {};
                if (owner !== undefined && s.trainers && s.trainers[owner]) {
                    return s.trainers[owner].displayName;
                }
                return s.displayName || (bridge.trainer ? bridge.trainer.displayName : "");
            },
            memberName(side, token) {
                const p = bridge.member(side, token);
                return p ? p.name() : token;
            },
            typeName: id => nameOf("types", id),
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

        /** @brief A gimmick was used (the Tera Orb needs recharging). */
        usedGimmick(kind) {
            if (kind === "terastallize") {
                $gamePokemon.teraCharged = false;
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
                const foes = bridge.foesOf("p1");
                if (foes.length > 1) {
                    await say(tr("Battle.Msg.CantAim", "You can't aim when there are two Pokémon!"));
                    return "cancel";
                }
                bag.lose(item.id, 1);
                await say(tr("Battle.Msg.ThrewBall", "{player} threw a {item}!", { player, item: item.name }));
                const foe = foes[0];
                const gp = bridge.member(foe.side.id, foe.name);
                const species = gp.species();
                const mine = bridge.active("p1", a.slot || 0);
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
            const target = a.target || bridge.member("p1", bridge.active("p1", a.slot || 0).name);
            if (item.effect === "xitem") {
                const sp = bridge.active("p1", a.slot || 0);
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
     * @brief Builds a trainer's side data from trainers.json.
     * @param {string} id Trainer ID.
     * @return {Object} {id, name, displayName, skill, loseText, money,
     *         gimmicks, battleType, bgm, team: [Game_Pokemon]}.
     */
    function trainerData(id) {
        const t = PBS.trainers.get(id);
        const type = PBS.trainerTypes.get(t.trainerType);
        const team = t.pokemon.map(m => {
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
                teraType: m.teraType,
                dynamaxLevel: m.dynamaxLevel,
                gmaxFactor: m.gigantamax,
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
        return {
            id,
            name: t.sourceText("name"),
            displayName: `${type.name} ${t.name}`,
            skill: type.skill,
            loseText: t.loseText,
            money: type.baseMoney * (last ? last.level : 1),
            gimmicks: t.gimmicks || [],
            battleType: t.battleType || "single",
            bgm: type.battleBGM,
            team,
        };
    }

    /** @return {Object} An AI controller for a trainer. */
    const controllerFor = t => new AIController({ skill: t ? t.skill : 0, gimmicks: t ? t.gimmicks : [] });

    /**
     * @brief The partner's controller: local player 2 (co-op) or the AI.
     * @param {Object} t Partner trainer data.
     * @param {*} coop "auto" / undefined, true / "on", false / "off".
     * @return {Object} Controller.
     */
    function partnerController(t, coop) {
        const input = window.PokeMZ.Input;
        const joined = !!(input && input.players && input.players.get(2));
        const human = coop === true || coop === "on" || ((coop === undefined || coop === "auto") && joined);
        return human ? new HumanController({ player: 2, gimmicks: t ? t.gimmicks : [], fallback: controllerFor(t) }) : controllerFor(t);
    }

    /**
     * @brief Starts a battle in the battle screen.
     * @param {Object} o {format ("singles" | "doubles" | "multi"), wild,
     *        sides ({p2, p3, p4}: {team, name, displayName, owners,
     *        trainers, controller}), trainers ([trainer data] beaten for
     *        money), canLose, encounterType, bgm, dynamax}. The old
     *        {foes, trainer} form still works.
     * @return {Promise<string>} Result.
     */
    function startBattle(o) {
        const UI = window.PokeMZ.UI;
        if (!UI || !UI.screens.has("battle")) {
            console.error("[PokeMZ.Battle] the battle screen needs PokeMZ_UI_Pokemon.");
            return Promise.resolve("win");
        }
        const meta = PBS.mapMetadataFor($gameMap.mapId());
        const input = window.PokeMZ.Input;
        if (input) {
            for (const h of input.players ? input.players.list() : [{ index: 1 }]) {
                input.rumble(o.wild ? 0.3 : 0.5, 0.6, o.wild ? 18 : 24, h.index);
            }
        }
        return new Promise(resolve => {
            const sides = Object.assign({}, o.sides || {});
            if (!sides.p2) {
                sides.p2 = {
                    team: o.foes,
                    name: o.wild ? "Wild" : o.trainer ? o.trainer.name : "Foe",
                    displayName: o.trainer ? o.trainer.displayName : "",
                    controller: controllerFor(o.trainer),
                };
            }
            const bridge = new BattleBridge({
                sim: window.PSSim,
                dex: battleDex(),
                format: o.format || "singles",
                party: $gameParty.pokemon(),
                sides,
                wild: !!o.wild,
                trainer: o.trainer || (o.trainers && o.trainers[0]) || null,
                adapter,
                encounterType: o.encounterType || "",
                gimmicks: { dynamax: o.dynamax !== undefined ? !!o.dynamax : !!(meta && (meta.dynamax || (meta.flags || []).includes("dynamax"))) },
                seed: [1, 2, 3, 4].map(() => Math.floor(Math.random() * 65536)),
            });
            bridge.textEnv = textEnv(bridge);
            bridge.text = new TextPresenter(bridge.textEnv);
            bridge.formatText = ev => sentence(bridge.text.format(ev));
            bridge.messageFrames = CONFIG.messageFrames;
            const trainers = o.trainers || (o.trainer ? [o.trainer] : []);
            const mapBgm = AudioManager.saveBgm();
            const mapBgs = AudioManager.saveBgs();
            const bgm = o.bgm || (o.wild ? CONFIG.wildBgm : CONFIG.trainerBgm);
            AudioManager.playBgm(bgm ? { name: bgm, volume: 90, pitch: 100, pan: 0 } : $gameSystem.battleBgm());
            AudioManager.stopBgs();
            SoundManager.playBattleStart();
            bridge.finish = async result => {
                if (result === "win" && !o.wild && trainers.length) {
                    for (const t of trainers) {
                        await bridge.presenter.say(tr("Battle.Msg.Defeated", "You defeated {trainer}!", { trainer: t.displayName }));
                        if (t.loseText) {
                            await bridge.presenter.say(t.loseText);
                        }
                        $gamePokemon.defeatedTrainers = $gamePokemon.defeatedTrainers || {};
                        $gamePokemon.defeatedTrainers[t.id] = true;
                    }
                    const money = trainers.reduce((n, t) => n + (t.money || 0), 0);
                    if (money) {
                        $gameParty.gainGold(money);
                        await bridge.presenter.say(tr("Battle.Msg.GotMoney", "You got {money} for winning!", { money: window.PokeMZ.L10n ? PokeMZ.L10n.formatCurrency(money) : money }));
                    }
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
     * @brief Starts a wild battle (one or two wild Pokémon).
     * @param {string} species Species ID.
     * @param {number} level Level.
     * @param {Object} [o] {shiny, encounterType, canLose, double, second:
     *        {species, level, shiny}}. With double and no second, the second
     *        Pokémon is rolled from the map's encounter table (or is the
     *        same species).
     * @return {Promise<string>} Result.
     */
    function startWild(species, level, o = {}) {
        const foes = [new Game_Pokemon(species, level, { shiny: o.shiny, otName: "", otId: -1 })];
        if (o.double || o.second) {
            let second = o.second;
            if (!second) {
                const table = PBS.encountersFor($gameMap.mapId());
                second = (table && o.encounterType && table.roll(o.encounterType)) || { species, level };
            }
            foes.push(new Game_Pokemon(second.species, second.level, { shiny: second.shiny, otName: "", otId: -1 }));
        }
        return startBattle(Object.assign({ wild: true, foes, format: foes.length > 1 ? "doubles" : "singles" }, o));
    }

    /**
     * @brief Starts a trainer battle from trainers.json.
     *
     *        - One trainer: singles, or doubles when its battleType is
     *          "double".
     *        - Two trainers: a double battle against both (each keeps to
     *          their own slot).
     *        - With o.partner: a multi battle; the partner fights beside the
     *          player against one or two trainers.
     *
     * @param {string|Array<string>} ids Trainer ID(s).
     * @param {Object} [o] {canLose, partner (trainer ID), dynamax, coop:
     *        "auto" (default: player 2 runs the partner when a second local
     *        player joined) | true | false}.
     * @return {Promise<string>} Result.
     */
    function startTrainer(ids, o = {}) {
        const list = [].concat(ids).map(trainerData);
        const [a, b] = list;
        if (o.partner) {
            const partner = trainerData(o.partner);
            // One opponent: their team is split over both foe sides.
            const foeB = b || Object.assign({}, a, { team: a.team.splice(Math.ceil(a.team.length / 2)) });
            return startBattle(
                Object.assign(
                    {
                        format: "multi",
                        trainers: b ? list : [a],
                        bgm: a.bgm,
                        sides: {
                            p2: { team: a.team, name: a.name, displayName: a.displayName, controller: controllerFor(a) },
                            p4: { team: foeB.team, name: foeB.name, displayName: foeB.displayName, controller: controllerFor(foeB) },
                            p3: { team: partner.team, name: partner.name, displayName: partner.displayName, controller: partnerController(partner, o.coop) },
                        },
                    },
                    o
                )
            );
        }
        if (b) {
            const owners = new Map();
            a.team.forEach(p => owners.set(p, 0));
            b.team.forEach(p => owners.set(p, 1));
            const merged = new AIController({ skill: Math.max(a.skill, b.skill), gimmicks: a.gimmicks.concat(b.gimmicks) });
            return startBattle(
                Object.assign(
                    {
                        format: "doubles",
                        trainers: list,
                        bgm: a.bgm,
                        sides: { p2: { team: a.team.concat(b.team), name: `${a.name} & ${b.name}`, owners, trainers: [a, b], controller: merged } },
                    },
                    o
                )
            );
        }
        return startBattle(
            Object.assign(
                {
                    format: a.battleType === "double" && a.team.length > 1 ? "doubles" : "singles",
                    trainers: [a],
                    trainer: a,
                    foes: a.team,
                    bgm: a.bgm,
                },
                o
            )
        );
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
        const o = { shiny: args.shiny === "true", canLose: args.canLose === "true" };
        if (args.species2) {
            o.second = { species: PBS.toID(args.species2), level: Number(args.level2 || args.level || 5) };
        }
        const p = startWild(PBS.toID(args.species), Number(args.level || 5), o);
        waitFor(this, p, Number(args.variable || 0), RESULTS);
    });

    PluginManager.registerCommand(PLUGIN_NAME, "trainerBattle", function(args) {
        const ids = [PBS.toID(args.trainer)];
        if (args.trainer2) {
            ids.push(PBS.toID(args.trainer2));
        }
        const o = { canLose: args.canLose === "true" };
        if (args.partner) {
            o.partner = PBS.toID(args.partner);
            o.coop = args.coop || "auto";
        }
        const p = startTrainer(ids, o);
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
        trainerData,
        /** @return {boolean} True if the trainer was beaten. */
        isDefeated: id => !!($gamePokemon.defeatedTrainers || {})[PBS.toID(id)],
        /** @brief Rebuilds the battle dex (after registerEffect at runtime). */
        rebuildDex: () => (dexCache = null),
    });
})();
