#!/usr/bin/env node
//=============================================================================
// PokéMZ - tools/pbs.js
//=============================================================================

/**
 * @file PBS data command line tool (Node).
 *
 *   node tools/pbs.js import [--only a,b] [--dry-run] [--offline]
 *        Fill data/pbs/*.json from Pokémon Showdown (@pkmn/sim) and the
 *        PokeAPI CSV dataset (growth rates, catch rates, EV yields, egg
 *        cycles, Pokédex text, field items), and merge names into
 *        data/locales/*.csv without overwriting translations.
 *   node tools/pbs.js check     Validate the PBS files (exit 1 on errors)
 *   node tools/pbs.js items [--dry-run]
 *        Give every PBS item an MZ database entry tagged <PBS: id>
 *        (close the RPG Maker editor first)
 *   node tools/pbs.js gfx       List species without graphics
 *
 * Options: --root <dir> (game folder, default: ../game).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const PBS = require("../game/js/plugins/PokeMZ_PBS_Core.js");
const L10n = require("../game/js/plugins/PokeMZ_Locale.js");

const POKEAPI = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/";
const CACHE = path.join(__dirname, ".cache", "pokeapi");

/** @brief PokeAPI language id -> locale column. */
const LANGS = { 9: "en", 7: "es-es", 14: "es-mx", 13: "pt-br", 5: "fr" };

const toID = PBS.toID;

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * @brief Downloads a file (following redirects).
 * @param {string} url URL.
 * @param {string} dest Destination file.
 * @return {Promise<void>} Done.
 */
function download(url, dest) {
    return new Promise((resolve, reject) => {
        https
            .get(url, res => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    download(res.headers.location, dest).then(resolve, reject);
                    return;
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`${url}: HTTP ${res.statusCode}`));
                    return;
                }
                const tmp = `${dest}.part`;
                const out = fs.createWriteStream(tmp);
                res.pipe(out);
                out.on("finish", () => out.close(() => (fs.renameSync(tmp, dest), resolve())));
                out.on("error", reject);
            })
            .on("error", reject);
    });
}

/**
 * @brief Reads a PokeAPI CSV (downloaded once into tools/.cache).
 * @param {string} name Table name.
 * @param {boolean} offline Don't download.
 * @return {Promise<Array<Object>>} Rows as objects.
 */
async function pokeapi(name, offline) {
    const file = path.join(CACHE, `${name}.csv`);
    if (!fs.existsSync(file)) {
        if (offline) {
            throw new Error(`${name}.csv is not cached and --offline was given`);
        }
        fs.mkdirSync(CACHE, { recursive: true });
        process.stdout.write(`Downloading ${name}.csv...\n`);
        await download(`${POKEAPI}${name}.csv`, file);
    }
    const rows = L10n.parseCsv(fs.readFileSync(file, "utf8"));
    const head = rows.shift();
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? "" : r[i]])));
}

/** @brief Groups rows by a key. */
function groupBy(rows, key) {
    const m = new Map();
    for (const r of rows) {
        const k = r[key];
        if (!m.has(k)) {
            m.set(k, []);
        }
        m.get(k).push(r);
    }
    return m;
}

/** @brief Cleans PokeAPI flavor text (line breaks, soft hyphens, form feeds). */
const cleanText = s =>
    String(s || "")
        .replace(/­\n/g, "")
        .replace(/[\f\n\r]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

/**
 * @brief Serializes PBS data: one entry per block, short values on one line.
 * @param {Object} data {id: entry}.
 * @return {string} JSON text.
 */
function stringifyPbs(data) {
    const inline = v => JSON.stringify(v);
    const fmt = (v, indent) => {
        const s = inline(v);
        if (s.length <= 90 || v === null || typeof v !== "object") {
            return s;
        }
        const pad = " ".repeat(indent + 2);
        if (Array.isArray(v)) {
            // Rows of short items: several per line.
            const items = v.map(x => fmt(x, indent + 2));
            const lines = [];
            let line = "";
            for (const it of items) {
                if (line && line.length + it.length + 2 > 96) {
                    lines.push(line);
                    line = "";
                }
                line += (line ? ", " : "") + it;
            }
            if (line) {
                lines.push(line);
            }
            return `[\n${lines.map(l => pad + l).join(",\n")}\n${" ".repeat(indent)}]`;
        }
        const body = Object.entries(v).map(([k, x]) => `${pad}${JSON.stringify(k)}: ${fmt(x, indent + 2)}`);
        return `{\n${body.join(",\n")}\n${" ".repeat(indent)}}`;
    };
    const out = Object.entries(data).map(([k, v]) => `  ${JSON.stringify(k)}: ${fmt(v, 2)}`);
    return `{\n${out.join(",\n")}\n}\n`;
}

/**
 * @brief Locale CSV tables being edited: merges rows without losing
 *        translations or columns.
 */
class LocaleTables {
    /** @param {string} dir data/locales folder. */
    constructor(dir) {
        this.dir = dir;
        this.tables = new Map();
    }

    /** @return {Object} {head, rows: Map<key, Array>}. */
    table(file) {
        if (!this.tables.has(file)) {
            const p = path.join(this.dir, file);
            const rows = fs.existsSync(p) ? L10n.parseCsv(fs.readFileSync(p, "utf8")) : [];
            const head = rows.length ? rows.shift() : ["Key", "en", "es-es", "es-mx", "pt-pt", "pt-br", "fr"];
            const map = new Map(rows.map(r => [r[0], r]));
            this.tables.set(file, { head, rows: map, changed: false });
        }
        return this.tables.get(file);
    }

    /**
     * @brief Sets texts of a key. "en" (the source) is updated; other
     *        languages are filled only when empty.
     * @param {string} file Table file.
     * @param {string} key String key.
     * @param {Object<string, string>} texts Language -> text.
     */
    set(file, key, texts) {
        const t = this.table(file);
        let row = t.rows.get(key);
        if (!row) {
            row = [key];
            t.rows.set(key, row);
            t.changed = true;
        }
        for (const [lang, text] of Object.entries(texts)) {
            if (text === undefined || text === null || text === "") {
                continue;
            }
            const col = t.head.indexOf(lang);
            if (col < 0) {
                continue;
            }
            const cur = row[col] || "";
            if (lang === "en" ? cur !== text : !cur) {
                row[col] = text;
                t.changed = true;
            }
        }
    }

    /** @brief Writes changed tables. */
    save(dryRun) {
        for (const [file, t] of this.tables) {
            if (!t.changed) {
                continue;
            }
            const rows = [t.head, ...[...t.rows.values()].map(r => t.head.map((_, i) => r[i] || ""))];
            if (dryRun) {
                console.log(`would write locales/${file} (${t.rows.size} keys)`);
            } else {
                fs.writeFileSync(path.join(this.dir, file), L10n.writeCsv(rows));
                console.log(`wrote locales/${file} (${t.rows.size} keys)`);
            }
        }
    }
}

//-----------------------------------------------------------------------------
// Import
//-----------------------------------------------------------------------------

/** @brief Canonical type colors (used by UI badges). */
const TYPE_COLORS = {
    normal: "#a8a878", fire: "#f08030", water: "#6890f0", electric: "#f8d030", grass: "#78c850", ice: "#98d8d8",
    fighting: "#c03028", poison: "#a040a0", ground: "#e0c068", flying: "#a890f0", psychic: "#f85888", bug: "#a8b820",
    rock: "#b8a038", ghost: "#705898", dragon: "#7038f8", dark: "#705848", steel: "#b8b8d0", fairy: "#ee99ac",
    stellar: "#40b5a5",
};

/** @brief PokeAPI item category -> pocket (unlisted categories are skipped). */
const ITEM_CATEGORIES = {
    "stat-boosts": "battle", flutes: "battle",
    "effort-drop": "berries", medicine: "berries", other: "berries", "in-a-pinch": "berries", "picky-healing": "berries",
    "type-protection": "berries",
    vitamins: "medicine", healing: "medicine", "pp-recovery": "medicine", revival: "medicine", "status-cures": "medicine",
    "nature-mints": "medicine",
    "special-balls": "balls", "standard-balls": "balls", "apricorn-balls": "balls",
    evolution: "items", spelunking: "items", "held-items": "items", choice: "items", "effort-training": "items",
    "bad-held-items": "items", training: "items", plates: "items", "species-specific": "items", "type-enhancement": "items",
    jewels: "items", "mega-stones": "items", memories: "items", scarves: "items",
    collectibles: "treasures", loot: "treasures",
    "z-crystals": "items", "tera-shard": "items", mulch: "items",
};

/** @brief Key items imported from PokeAPI's "gameplay" category. */
const KEY_ITEMS = [
    "bicycle", "oldrod", "goodrod", "superrod", "townmap", "megaring", "zring", "dynamaxband", "teraorb",
    "sprayduck", "wailmerpail", "squirtbottle",
];

/** @brief Items PokeAPI lacks, written as-is (English source text). */
const EXTRA_ITEMS = {
    maxsoup: {
        num: 30001,
        name: "Max Soup",
        description: "A soup made with Max Mushrooms. It gives a Pokémon that can Gigantamax the G-Max Factor, or takes it away.",
        pocket: "medicine",
        price: 0,
        effect: "maxsoup",
        fieldUse: "onpokemon",
    },
};

/**
 * @brief Field behaviour of canon items (Gen 9 values). Effects are the
 *        names of handlers in PokeMZ_PBS_Pokemon (ItemHandlers).
 */
const FIELD_ITEMS = {
    potion: ["heal", { hp: 20 }], superpotion: ["heal", { hp: 60 }], hyperpotion: ["heal", { hp: 120 }],
    maxpotion: ["heal", { hp: "full" }], fullrestore: ["heal", { hp: "full", status: "all" }],
    freshwater: ["heal", { hp: 30 }], sodapop: ["heal", { hp: 50 }], lemonade: ["heal", { hp: 70 }],
    moomoomilk: ["heal", { hp: 100 }], energypowder: ["heal", { hp: 60, friendship: -5 }],
    energyroot: ["heal", { hp: 120, friendship: -10 }], berryjuice: ["heal", { hp: 20 }],
    antidote: ["heal", { status: ["psn", "tox"] }], burnheal: ["heal", { status: ["brn"] }], iceheal: ["heal", { status: ["frz"] }],
    awakening: ["heal", { status: ["slp"] }], paralyzeheal: ["heal", { status: ["par"] }], fullheal: ["heal", { status: "all" }],
    healpowder: ["heal", { status: "all", friendship: -5 }], lavacookie: ["heal", { status: "all" }],
    oldgateau: ["heal", { status: "all" }], casteliacone: ["heal", { status: "all" }], lumiosegalette: ["heal", { status: "all" }],
    shaloursable: ["heal", { status: "all" }], bigmalasada: ["heal", { status: "all" }], pewtercrunchies: ["heal", { status: "all" }],
    ragecandybar: ["heal", { status: "all" }], jubilifemuffin: ["heal", { status: "all" }],
    revive: ["revive", { hp: 0.5 }], maxrevive: ["revive", { hp: 1 }], revivalherb: ["revive", { hp: 1, friendship: -15 }],
    ether: ["pp", { pp: 10 }], maxether: ["pp", { pp: "full" }], elixir: ["pp", { pp: 10, all: true }],
    maxelixir: ["pp", { pp: "full", all: true }], ppup: ["ppup", { ups: 1 }], ppmax: ["ppup", { ups: 3 }],
    hpup: ["ev", { stat: "hp", amount: 10 }], protein: ["ev", { stat: "atk", amount: 10 }], iron: ["ev", { stat: "def", amount: 10 }],
    calcium: ["ev", { stat: "spa", amount: 10 }], zinc: ["ev", { stat: "spd", amount: 10 }], carbos: ["ev", { stat: "spe", amount: 10 }],
    healthfeather: ["ev", { stat: "hp", amount: 1 }], musclefeather: ["ev", { stat: "atk", amount: 1 }],
    resistfeather: ["ev", { stat: "def", amount: 1 }], geniusfeather: ["ev", { stat: "spa", amount: 1 }],
    cleverfeather: ["ev", { stat: "spd", amount: 1 }], swiftfeather: ["ev", { stat: "spe", amount: 1 }],
    rarecandy: ["level", { levels: 1 }], expcandyxs: ["exp", { exp: 100 }], expcandys: ["exp", { exp: 800 }],
    expcandym: ["exp", { exp: 3000 }], expcandyl: ["exp", { exp: 10000 }], expcandyxl: ["exp", { exp: 30000 }],
    abilitycapsule: ["abilitycapsule", {}], abilitypatch: ["abilitypatch", {}],
    repel: ["repel", { steps: 100 }], superrepel: ["repel", { steps: 200 }], maxrepel: ["repel", { steps: 250 }],
    escaperope: ["escaperope", {}],
    oranberry: ["heal", { hp: 10 }], sitrusberry: ["heal", { hp: 0.25 }], cheriberry: ["heal", { status: ["par"] }],
    chestoberry: ["heal", { status: ["slp"] }], pechaberry: ["heal", { status: ["psn", "tox"] }],
    rawstberry: ["heal", { status: ["brn"] }], aspearberry: ["heal", { status: ["frz"] }], lumberry: ["heal", { status: "all" }],
    leppaberry: ["pp", { pp: 10 }],
    bicycle: ["bicycle", {}], oldrod: ["rod", { type: "oldrod" }], goodrod: ["rod", { type: "goodrod" }],
    superrod: ["rod", { type: "superrod" }], townmap: ["townmap", {}],
    dynamaxcandy: ["dynamaxcandy", {}],
    growthmulch: ["mulch", { growth: 0.75, drying: 1.5 }], dampmulch: ["mulch", { growth: 1.5, drying: 0.5 }],
    stablemulch: ["mulch", { stay: 1.5 }], gooeymulch: ["mulch", { regrow: 1.5 }],
    sprayduck: ["wateringcan", {}], wailmerpail: ["wateringcan", {}], squirtbottle: ["wateringcan", {}],
};

/** @brief Catch rate modifiers of balls (Gen 9); special balls use handlers. */
const BALLS = {
    pokeball: 1, greatball: 1.5, ultraball: 2, masterball: 255, safariball: 1.5, sportball: 1.5, premierball: 1,
    luxuryball: 1, healball: 1, friendball: 1, cherishball: 1, netball: "net", diveball: "dive", nestball: "nest",
    repeatball: "repeat", timerball: "timer", quickball: "quick", duskball: "dusk", levelball: "level", lureball: "lure",
    moonball: "moon", heavyball: "heavy", loveball: "love", fastball: "fast", dreamball: "dream", beastball: 0.1, parkball: 255,
};

/** @brief X items (Gen 7+: +2 stages). */
const X_ITEMS = { xattack: "atk", xdefense: "def", xspatk: "spa", xspdef: "spd", xspeed: "spe", xaccuracy: "accuracy" };

/** @brief Growth rate identifiers. */
const GROWTH = { slow: "slow", medium: "mediumfast", fast: "fast", "medium-slow": "mediumslow", "slow-then-very-fast": "erratic", "fast-then-very-slow": "fluctuating" };

/** @brief Contest/flavor ids of PokeAPI natures. */
const FLAVORS = { 1: "spicy", 2: "dry", 3: "sweet", 4: "bitter", 5: "sour" };
const STAT_IDS = { 1: "hp", 2: "atk", 3: "def", 4: "spa", 5: "spd", 6: "spe" };

/** @brief Showdown species that are not imported (Gmax formes are kept as
 *         battle-only forms). */
const skipSpecies = s => !s.exists || s.num <= 0 || ["CAP", "Custom", "LGPE", "Future"].includes(s.isNonstandard) || /Totem|Eternamax/.test(s.forme || "");

/**
 * @brief Picks the learnset of the newest generation the species has.
 * @param {Object} dex Showdown Dex.
 * @param {Object} s Species.
 * @return {Object} {level: [[lv, move]], tm, tutor, egg}.
 */
function learnsetOf(dex, s) {
    const data = dex.data.Learnsets[s.id] || (s.changesFrom ? dex.data.Learnsets[toID(s.changesFrom)] : null);
    const out = { level: [], tm: [], tutor: [], egg: [] };
    if (!data || !data.learnset) {
        return null;
    }
    let gen = 0;
    for (const sources of Object.values(data.learnset)) {
        for (const src of sources) {
            const g = Number(src[0]);
            if (/^\d[LM]/.test(src) && g > gen) {
                gen = g;
            }
        }
    }
    if (!gen) {
        return null;
    }
    for (const [move, sources] of Object.entries(data.learnset)) {
        const mv = dex.moves.get(move);
        if (!mv.exists || mv.isZ || mv.isMax) {
            continue;
        }
        for (const src of sources) {
            if (Number(src[0]) !== gen) {
                continue;
            }
            const kind = src[1];
            if (kind === "L") {
                out.level.push([Number(src.slice(2)), move]);
            } else if (kind === "M" && !out.tm.includes(move)) {
                out.tm.push(move);
            } else if (kind === "T" && !out.tutor.includes(move)) {
                out.tutor.push(move);
            } else if (kind === "E" && !out.egg.includes(move)) {
                out.egg.push(move);
            }
        }
    }
    out.level.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
    return out;
}

/**
 * @brief Converts a Showdown evolution target into PBS evolution data.
 * @param {Object} t Target species.
 * @return {Object} {species, method, param, condition}.
 */
function evolutionOf(t) {
    const cond = String(t.evoCondition || "").toLowerCase();
    const condition = {};
    if (/day/.test(cond)) {
        condition.time = "day";
    } else if (/night/.test(cond)) {
        condition.time = "night";
    } else if (/dusk|evening/.test(cond)) {
        condition.time = "evening";
    }
    if (t.evoRegion) {
        condition.region = toID(t.evoRegion);
    }
    if (t.evoType !== "levelExtra" && t.evoType !== "other" && cond && !Object.keys(condition).length) {
        condition.text = t.evoCondition;
    }
    const gender = t.gender === "M" ? "male" : t.gender === "F" ? "female" : "";
    let method = "level";
    let param = t.evoLevel || null;
    switch (t.evoType) {
        case undefined:
            method = gender ? `level${gender}` : "level";
            break;
        case "useItem":
            method = gender ? `item${gender}` : "item";
            param = toID(t.evoItem);
            break;
        case "trade":
            method = t.evoItem ? "tradeitem" : /with/.test(cond) ? "tradespecies" : "trade";
            param = t.evoItem ? toID(t.evoItem) : /with an? (.+)$/.test(cond) ? toID(/with an? (.+)$/.exec(cond)[1]) : null;
            delete condition.text;
            break;
        case "levelFriendship":
            method = "friendship";
            param = null;
            break;
        case "levelHold":
            method = "levelhelditem";
            param = toID(t.evoItem);
            break;
        case "levelMove":
            method = "levelmove";
            param = toID(t.evoMove);
            break;
        case "levelExtra":
            method = "levelextra";
            condition.text = t.evoCondition || "";
            break;
        default:
            method = "other";
            condition.text = t.evoCondition || t.evoType;
    }
    return { species: t.id, method, param, condition: Object.keys(condition).length ? condition : null };
}

/**
 * @brief Writes PBS JSON from Showdown and PokeAPI.
 * @param {string} root Game folder.
 * @param {Object} o {only: Set|null, dryRun, offline}.
 */
async function importData(root, o) {
    let sim;
    try {
        sim = require("@pkmn/sim");
    } catch (e) {
        throw new Error('@pkmn/sim is not installed: run "npm install" in tools/');
    }
    const dex = sim.Dex.forGen(9);
    const want = name => !o.only || o.only.has(name);
    const pbsDir = path.join(root, "data", "pbs");
    const locales = new LocaleTables(path.join(root, "data", "locales"));
    const out = {};
    const t0 = Date.now();

    const api = {};
    for (const n of [
        "pokemon_species", "pokemon", "pokemon_stats", "growth_rates", "pokemon_species_names", "pokemon_species_flavor_text",
        "pokemon_colors", "pokemon_shapes", "pokemon_habitats", "items", "item_names", "item_flavor_text", "item_categories",
        "versions", "version_groups", "natures", "nature_names", "moves", "move_names", "abilities", "ability_names",
        "types", "type_names", "pokemon_forms", "pokemon_form_names",
    ]) {
        api[n] = await pokeapi(n, o.offline);
    }
    const byId = (rows, key = "id") => new Map(rows.map(r => [r[key], r]));
    const vgOrder = byId(api.version_groups);
    const versionVg = new Map(api.versions.map(v => [v.id, Number((vgOrder.get(v.version_group_id) || {}).order || 0)]));
    /** @brief Names in the locale languages: Map<id, {lang: text}>. */
    const names = (rows, idKey, field = "name") => {
        const m = new Map();
        for (const r of rows) {
            const lang = LANGS[r.local_language_id];
            if (!lang || !r[field]) {
                continue;
            }
            if (!m.has(r[idKey])) {
                m.set(r[idKey], {});
            }
            m.get(r[idKey])[lang] = r[field];
        }
        return m;
    };
    /** @brief Newest flavor text per id and language. */
    const flavor = (rows, idKey, orderOf) => {
        const best = new Map();
        for (const r of rows) {
            const lang = LANGS[r.language_id];
            if (!lang) {
                continue;
            }
            const k = `${r[idKey]}|${lang}`;
            const ord = orderOf(r);
            const cur = best.get(k);
            if (!cur || ord >= cur.ord) {
                best.set(k, { ord, text: cleanText(r.flavor_text) });
            }
        }
        const m = new Map();
        for (const [k, v] of best) {
            const [id, lang] = k.split("|");
            if (!m.has(id)) {
                m.set(id, {});
            }
            m.get(id)[lang] = v.text;
        }
        return m;
    };
    const idsByIdentifier = rows => new Map(rows.map(r => [toID(r.identifier), r]));

    // Types
    if (want("types")) {
        const apiTypes = idsByIdentifier(api.types);
        const typeNames = names(api.type_names, "type_id");
        const types = {};
        for (const t of dex.types.all()) {
            if (!t.exists || t.isNonstandard) {
                continue;
            }
            const entry = { num: Number((apiTypes.get(t.id) || {}).id || 0), name: t.name, weaknesses: [], resistances: [], immunities: [] };
            for (const [atk, code] of Object.entries(t.damageTaken)) {
                const id = toID(atk);
                if (atk[0] !== atk[0].toUpperCase() || !dex.types.get(id).exists || dex.types.get(id).isNonstandard) {
                    continue;
                }
                if (code === 1) {
                    entry.weaknesses.push(id);
                } else if (code === 2) {
                    entry.resistances.push(id);
                } else if (code === 3) {
                    entry.immunities.push(id);
                }
            }
            entry.color = TYPE_COLORS[t.id] || "#a8a878";
            types[t.id] = entry;
            locales.set("types.csv", `Type.${t.id}.Name`, Object.assign({}, typeNames.get((apiTypes.get(t.id) || {}).id), { en: t.name }));
        }
        out["types.json"] = types;
    }

    // Natures
    if (want("natures")) {
        const apiNat = idsByIdentifier(api.natures);
        const natNames = names(api.nature_names, "nature_id");
        const natures = {};
        for (const n of dex.natures.all()) {
            const a = apiNat.get(n.id) || {};
            const neutral = !n.plus;
            natures[n.id] = {
                num: Number(a.game_index || 0),
                name: n.name,
                plus: n.plus || "",
                minus: n.minus || "",
                likes: neutral ? "" : FLAVORS[a.likes_flavor_id] || "",
                dislikes: neutral ? "" : FLAVORS[a.hates_flavor_id] || "",
            };
            locales.set("natures.csv", `Nature.${n.id}.Name`, Object.assign({}, natNames.get(a.id), { en: n.name }));
        }
        out["natures.json"] = Object.fromEntries(Object.entries(natures).sort((a, b) => a[1].num - b[1].num));
    }

    // Abilities
    if (want("abilities")) {
        const apiAb = idsByIdentifier(api.abilities);
        const abNames = names(api.ability_names, "ability_id");
        const abilities = {};
        for (const a of dex.abilities.all()) {
            if (!a.exists || a.num <= 0 || ["CAP", "Custom", "LGPE"].includes(a.isNonstandard)) {
                continue;
            }
            abilities[a.id] = { num: a.num, name: a.name, description: a.shortDesc || a.desc || "" };
            locales.set("abilities.csv", `Ability.${a.id}.Name`, Object.assign({}, abNames.get((apiAb.get(a.id) || {}).id), { en: a.name }));
            locales.set("abilities.csv", `Ability.${a.id}.Description`, { en: abilities[a.id].description });
        }
        out["abilities.json"] = abilities;
    }

    // Moves
    if (want("moves")) {
        const apiMv = idsByIdentifier(api.moves);
        const mvNames = names(api.move_names, "move_id");
        const moves = {};
        for (const m of dex.moves.all()) {
            if (!m.exists || m.num <= 0 || m.isZ || m.isMax || ["CAP", "Custom", "LGPE"].includes(m.isNonstandard)) {
                continue;
            }
            const chance = (m.secondary && m.secondary.chance) || (m.secondaries && m.secondaries[0] && m.secondaries[0].chance) || 0;
            moves[m.id] = {
                num: m.num,
                name: m.name,
                description: m.shortDesc || m.desc || "",
                type: toID(m.type),
                category: toID(m.category),
                power: m.basePower || 0,
                accuracy: m.accuracy === true ? 0 : m.accuracy,
                pp: m.pp || 1,
                priority: m.priority || 0,
                target: toID(m.target),
            };
            if (chance) {
                moves[m.id].effectChance = chance;
            }
            const flags = Object.keys(m.flags || {});
            if (flags.length) {
                moves[m.id].flags = flags;
            }
            locales.set("moves.csv", `Move.${m.id}.Name`, Object.assign({}, mvNames.get((apiMv.get(m.id) || {}).id), { en: m.name }));
            locales.set("moves.csv", `Move.${m.id}.Description`, { en: moves[m.id].description });
        }
        out["moves.json"] = moves;
    }

    // Items: Showdown battle items + PokeAPI field items.
    if (want("items")) {
        const cats = byId(api.item_categories);
        const apiItems = idsByIdentifier(api.items);
        const itNames = names(api.item_names, "item_id");
        const itText = flavor(api.item_flavor_text, "item_id", r => Number((vgOrder.get(r.version_group_id) || {}).order || 0));
        const items = {};
        const add = (id, entry, apiRow) => {
            items[id] = Object.assign(items[id] || {}, entry);
            const lang = apiRow ? itNames.get(apiRow.id) : null;
            const text = apiRow ? itText.get(apiRow.id) : null;
            locales.set("items.csv", `Item.${id}.Name`, Object.assign({}, lang, { en: items[id].name }));
            locales.set("items.csv", `Item.${id}.Description`, Object.assign({}, text, { en: items[id].description }));
        };
        for (const [id, row] of apiItems) {
            const cat = cats.get(row.category_id);
            const pocket = cat ? ITEM_CATEGORIES[cat.identifier] : null;
            if (!pocket && !KEY_ITEMS.includes(id)) {
                continue;
            }
            const en = (itNames.get(row.id) || {}).en || row.identifier;
            add(
                id,
                {
                    num: Number(row.id),
                    name: en,
                    description: ((itText.get(row.id) || {}).en || "").trim(),
                    pocket: KEY_ITEMS.includes(id) ? "key" : pocket,
                    price: Number(row.cost || 0),
                },
                row
            );
            if (row.fling_power) {
                items[id].flingPower = Number(row.fling_power);
            }
        }
        for (const it of dex.items.all()) {
            if (!it.exists || it.num <= 0 || ["CAP", "Custom", "LGPE"].includes(it.isNonstandard)) {
                continue;
            }
            const row = apiItems.get(it.id);
            const pocket = it.isPokeball ? "balls" : it.isBerry ? "berries" : (items[it.id] && items[it.id].pocket) || "items";
            add(
                it.id,
                {
                    num: items[it.id] ? items[it.id].num : it.num,
                    name: (items[it.id] && items[it.id].name) || it.name,
                    description: (items[it.id] && items[it.id].description) || it.shortDesc || it.desc || "",
                    pocket,
                    showdown: true,
                },
                row
            );
            if (it.fling && it.fling.basePower) {
                items[it.id].flingPower = it.fling.basePower;
            }
        }
        for (const [id, extra] of Object.entries(EXTRA_ITEMS)) {
            if (!items[id]) {
                add(id, Object.assign({}, extra), null);
            }
        }
        // Behaviour of canon items.
        for (const [id, item] of Object.entries(items)) {
            const shard = /^(\w+)terashard$/.exec(id);
            if (shard && shard[1] !== "stellar") {
                item.effect = "terashard";
                item.params = { type: shard[1], count: 50 };
                item.fieldUse = "onpokemon";
            }
            const field = FIELD_ITEMS[id];
            if (field) {
                item.effect = field[0];
                item.params = field[1];
                item.fieldUse = ["repel", "escaperope", "bicycle", "rod", "townmap", "wateringcan"].includes(field[0]) ? "direct" : field[0] === "mulch" ? "none" : "onpokemon";
                if (["heal", "revive", "pp"].includes(field[0])) {
                    item.battleUse = item.pocket === "berries" ? "none" : field[0] === "pp" ? "onmove" : "onpokemon";
                }
            }
            if (BALLS[id] !== undefined) {
                item.effect = "ball";
                item.params = typeof BALLS[id] === "number" ? { modifier: BALLS[id] } : { modifier: 1, special: BALLS[id] };
                item.battleUse = "ball";
                item.pocket = "balls";
            }
            if (X_ITEMS[id]) {
                item.effect = "xitem";
                item.params = { stat: X_ITEMS[id], stages: 2 };
                item.battleUse = "onbattler";
                item.pocket = "battle";
            }
            if (item.pocket === "key") {
                item.consumable = false;
                item.flags = ["keyitem"];
                if (item.effect === "wateringcan") {
                    item.flags.push("wateringcan");
                }
            }
            const db = dex.items.get(id);
            if (db.exists && (db.megaStone || db.zMove)) {
                item.consumable = false;
            }
            if (/stone$/.test(id) || ["linkingcord", "galaricacuff", "galaricawreath", "sweetapple", "tartapple", "metalalloy"].includes(id)) {
                const cat = cats.get((apiItems.get(id) || {}).category_id);
                if (cat && cat.identifier === "evolution") {
                    item.effect = "evolution";
                    item.fieldUse = "onpokemon";
                    item.flags = (item.flags || []).concat("evolution");
                }
            }
        }
        out["items.json"] = Object.fromEntries(Object.entries(items).sort((a, b) => a[1].num - b[1].num));
    }

    // Species and forms
    if (want("pokemon")) {
        const growth = byId(api.growth_rates);
        const colors = byId(api.pokemon_colors);
        const shapes = byId(api.pokemon_shapes);
        const habitats = byId(api.pokemon_habitats);
        const spRows = byId(api.pokemon_species);
        const spByIdent = idsByIdentifier(api.pokemon_species);
        const pkByIdent = idsByIdentifier(api.pokemon);
        const pkDefault = new Map(api.pokemon.filter(p => p.is_default === "1").map(p => [p.species_id, p]));
        const stats = groupBy(api.pokemon_stats, "pokemon_id");
        const spNames = names(api.pokemon_species_names, "pokemon_species_id");
        const genus = names(api.pokemon_species_names, "pokemon_species_id", "genus");
        const dexText = flavor(api.pokemon_species_flavor_text, "species_id", r => versionVg.get(r.version_id) || 0);
        const formByPokemon = new Map(api.pokemon_forms.filter(f => f.is_default === "1").map(f => [f.pokemon_id, f]));
        const formNames = names(api.pokemon_form_names, "pokemon_form_id", "form_name");
        const missing = [];

        const pokemonFields = (row, s) => {
            const f = {
                height: row ? Number(row.height) : Math.round(s.heightm * 10),
                weight: row ? Number(row.weight) : Math.round(s.weightkg * 10),
            };
            if (row && row.base_experience) {
                f.baseExp = Number(row.base_experience);
            }
            if (row && stats.has(row.id)) {
                const ev = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
                for (const st of stats.get(row.id)) {
                    ev[STAT_IDS[st.stat_id]] = Number(st.effort);
                }
                f.evYield = ev;
            }
            return f;
        };
        const genderOf = s => (s.gender === "N" ? "genderless" : s.gender === "M" ? "male" : s.gender === "F" ? "female" : "mixed");
        const abilitiesOf = s => Object.fromEntries(Object.entries(s.abilities).map(([k, v]) => [k, toID(v)]));

        const pokemon = {};
        const forms = {};
        const all = dex.species.all().filter(s => !skipSpecies(s));
        for (const s of all.filter(x => !x.forme || x.baseSpecies === x.name)) {
            const sp = spByIdent.get(s.id) || spRows.get(String(s.num));
            const row = sp ? pkDefault.get(sp.id) : null;
            if (!sp) {
                missing.push(s.id);
            }
            const en = (sp && (spNames.get(sp.id) || {}).en) || s.name;
            const learn = learnsetOf(dex, s) || { level: [], tm: [], tutor: [], egg: [] };
            const entry = {
                num: s.num,
                name: en,
                genus: sp ? (genus.get(sp.id) || {}).en || "" : "",
                dexEntry: sp ? (dexText.get(sp.id) || {}).en || "" : "",
                types: s.types.map(toID),
                baseStats: Object.assign({}, s.baseStats),
                abilities: abilitiesOf(s),
                gender: genderOf(s),
            };
            if (entry.gender === "mixed") {
                entry.genderRatio = s.genderRatio.M;
            }
            Object.assign(entry, {
                growthRate: sp ? GROWTH[(growth.get(sp.growth_rate_id) || {}).identifier] || "mediumfast" : "mediumfast",
                catchRate: sp ? Number(sp.capture_rate) : 45,
                baseFriendship: sp && sp.base_happiness !== "" ? Number(sp.base_happiness) : 50,
                eggGroups: s.eggGroups.map(toID),
                eggCycles: sp && sp.hatch_counter !== "" ? Number(sp.hatch_counter) : 20,
            });
            Object.assign(entry, pokemonFields(row, s));
            entry.color = toID(s.color);
            if (sp && shapes.get(sp.shape_id)) {
                entry.shape = shapes.get(sp.shape_id).identifier;
            }
            if (sp && habitats.get(sp.habitat_id)) {
                entry.habitat = habitats.get(sp.habitat_id).identifier;
            }
            entry.moves = learn;
            const evos = (s.evos || []).map(n => dex.species.get(n)).filter(t => t.exists && !skipSpecies(t));
            if (evos.length) {
                entry.evolutions = evos.map(evolutionOf);
            }
            if (sp && sp.is_baby === "1") {
                entry.flags = ["baby"];
            }
            pokemon[s.id] = entry;
            if (sp) {
                locales.set("pokemon.csv", `Pokemon.${s.id}.Name`, Object.assign({}, spNames.get(sp.id), { en: en }));
                const g = Object.fromEntries(Object.entries(genus.get(sp.id) || {}).map(([k, v]) => [k, v]));
                g.en = entry.genus;
                locales.set("pokemon.csv", `Pokemon.${s.id}.Genus`, g);
                locales.set("pokemon.csv", `Pokemon.${s.id}.DexEntry`, Object.assign({}, dexText.get(sp.id), { en: entry.dexEntry }));
            } else {
                locales.set("pokemon.csv", `Pokemon.${s.id}.Name`, { en: en });
            }
        }
        // Forms: store only what differs from the base species.
        for (const s of all.filter(x => x.forme && x.baseSpecies !== x.name)) {
            const baseId = toID(s.baseSpecies);
            const base = pokemon[baseId];
            if (!base) {
                continue;
            }
            const row = pkByIdent.get(s.id);
            const entry = { baseSpecies: baseId, forme: s.forme };
            const formRow = row ? formByPokemon.get(row.id) : null;
            const fn = formRow ? formNames.get(formRow.id) : null;
            entry.formName = (fn && fn.en) || s.forme;
            const cand = {
                types: s.types.map(toID),
                baseStats: Object.assign({}, s.baseStats),
                abilities: abilitiesOf(s),
                gender: genderOf(s),
                eggGroups: s.eggGroups.map(toID),
                color: toID(s.color),
            };
            Object.assign(cand, pokemonFields(row, s));
            if (!row) {
                delete cand.baseExp;
                delete cand.evYield;
            }
            const learn = s.id !== baseId && dex.data.Learnsets[s.id] ? learnsetOf(dex, s) : null;
            if (learn && learn.level.length) {
                cand.moves = learn;
            }
            const evos = (s.evos || []).map(n => dex.species.get(n)).filter(t => t.exists && !skipSpecies(t));
            if (evos.length) {
                cand.evolutions = evos.map(evolutionOf);
            }
            for (const [k, v] of Object.entries(cand)) {
                if (JSON.stringify(v) !== JSON.stringify(base[k])) {
                    entry[k] = v;
                }
            }
            if (s.battleOnly || /Gmax/.test(s.forme)) {
                entry.battleOnly = true;
            }
            if (/Gmax/.test(s.forme)) {
                entry.flags = ["gigantamax"];
            }
            if (s.requiredItem) {
                entry.requiredItem = toID(s.requiredItem);
            }
            forms[s.id] = entry;
            locales.set("pokemon.csv", `Pokemon.${s.id}.FormName`, Object.assign({}, fn, { en: entry.formName }));
        }
        out["pokemon.json"] = pokemon;
        out["pokemon_forms.json"] = forms;
        if (missing.length) {
            console.log(`PokeAPI has no species data for ${missing.length} species (defaults used): ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "..." : ""}`);
        }
    }

    // Berry plants (Gen 4 growth data) for every imported berry item.
    if (want("berries") || want("items")) {
        const berries = await pokeapi("berries", o.offline);
        const itemRows = byId(api.items);
        const itemIds = new Set(Object.keys(out["items.json"] || JSON.parse(fs.readFileSync(path.join(pbsDir, "items.json"), "utf8") || "{}")));
        const plants = {};
        for (const b of berries) {
            const row = itemRows.get(b.item_id);
            const id = row ? toID(row.identifier) : "";
            if (!id || !itemIds.has(id)) {
                continue;
            }
            plants[id] = {
                hoursPerStage: Math.max(1, Number(b.growth_time) || 3),
                dryingPerHour: Number(b.soil_dryness) || 15,
                yield: [Math.min(2, Number(b.max_harvest) || 2), Math.max(2, Number(b.max_harvest) || 5)],
            };
        }
        out["berry_plants.json"] = plants;
    }

    // Drop references to things that were not imported (e.g. Past items).
    const known = file => (out[file] ? new Set(Object.keys(out[file])) : null);
    const items = known("items.json");
    const species = new Set([...Object.keys(out["pokemon.json"] || {}), ...Object.keys(out["pokemon_forms.json"] || {})]);
    for (const file of ["pokemon.json", "pokemon_forms.json"]) {
        for (const e of Object.values(out[file] || {})) {
            if (e.evolutions) {
                e.evolutions = e.evolutions.filter(ev => species.has(ev.species) && (!items || typeof ev.param !== "string" || !/item/.test(ev.method) || items.has(ev.param)));
                if (!e.evolutions.length) {
                    delete e.evolutions;
                }
            }
            if (items && e.requiredItem && !items.has(e.requiredItem)) {
                delete e.requiredItem;
            }
        }
    }

    for (const [file, data] of Object.entries(out)) {
        const text = stringifyPbs(data);
        if (o.dryRun) {
            console.log(`would write pbs/${file} (${Object.keys(data).length} entries, ${(text.length / 1024).toFixed(0)} KB)`);
        } else {
            fs.writeFileSync(path.join(pbsDir, file), text);
            console.log(`wrote pbs/${file} (${Object.keys(data).length} entries, ${(text.length / 1024).toFixed(0)} KB)`);
        }
    }
    locales.save(o.dryRun);
    console.log(`Import done in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
}

//-----------------------------------------------------------------------------
// Check, items, gfx
//-----------------------------------------------------------------------------

/**
 * @brief Loads the PBS files the way the game does.
 * @param {string} root Game folder.
 * @return {Promise<{registries, report}>} Result.
 */
async function loadAll(root) {
    const read = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
    let showdown = null;
    try {
        showdown = require("@pkmn/sim").Dex;
    } catch (e) {
        // Optional.
    }
    return PBS.load(new PBS.NodeFileSource(path.join(root, "data", "pbs")), {
        mapInfos: read("MapInfos.json"),
        dbItems: read("Items.json"),
        showdown,
    });
}

/**
 * @brief Validates every file and prints the report.
 * @param {string} root Game folder.
 * @param {Object} o {quiet}.
 * @return {Promise<number>} Exit code.
 */
async function check(root, o = {}) {
    const { registries, report } = await loadAll(root);
    const text = report.toString(o.limit || 200);
    if (text) {
        console.log(text);
    }
    const counts = Object.entries(registries)
        .filter(([, r]) => r.size)
        .map(([k, r]) => `${k} ${r.size}`)
        .join(", ");
    console.log(`${report.summary()} (${counts || "no data"})`);
    return report.hasErrors() ? 1 : 0;
}

/**
 * @brief Gives every PBS item an MZ Items.json entry tagged <PBS: id> and
 *        <L10n: Item.id> (so MZ event commands and the database can use it).
 * @param {string} root Game folder.
 * @param {Object} o {dryRun}.
 */
async function linkItems(root, o) {
    const file = path.join(root, "data", "Items.json");
    const db = JSON.parse(fs.readFileSync(file, "utf8"));
    const { registries } = await loadAll(root);
    const tags = PBS.itemTags(db);
    let added = 0;
    for (const item of registries.items || []) {
        if (tags.has(item.id)) {
            continue;
        }
        const id = db.length;
        db.push({
            id,
            animationId: 0,
            consumable: item.consumable !== false,
            damage: { critical: false, elementId: 0, formula: "0", type: 0, variance: 20 },
            description: item.sourceText("description"),
            effects: [],
            hitType: 0,
            iconIndex: item._iconIndex || 0,
            itypeId: item.isKeyItem ? 2 : 1,
            name: item.sourceText("name"),
            note: `<PBS: ${item.id}>\n<L10n: Item.${item.id}>`,
            occasion: 3,
            price: item._price || 0,
            repeats: 1,
            scope: 0,
            speed: 0,
            successRate: 100,
            tpGain: 0,
        });
        added++;
    }
    if (!added) {
        console.log("Every PBS item already has an MZ entry.");
        return;
    }
    if (o.dryRun) {
        console.log(`would add ${added} items to Items.json`);
        return;
    }
    fs.writeFileSync(file, `[\n${db.map(x => JSON.stringify(x)).join(",\n")}\n]`);
    console.log(`added ${added} items to Items.json (tagged <PBS: id>)`);
}

/**
 * @brief Lists species and forms without graphics.
 * @param {string} root Game folder.
 */
async function gfx(root) {
    const { registries } = await loadAll(root);
    const dir = path.join(root, "img", "pokemon");
    const need = ["front.png", "back.png", "icon.png"];
    let missing = 0;
    for (const s of registries.species || []) {
        const folder = s.baseSpecies ? path.join(dir, s.baseSpecies, s.folder) : path.join(dir, s.id);
        const lack = need.filter(f => !fs.existsSync(path.join(folder, f)));
        if (lack.length === need.length && s.baseSpecies) {
            continue; // forms fall back to the base species
        }
        if (lack.length) {
            missing++;
            console.log(`${path.relative(root, folder)}: missing ${lack.join(", ")}`);
        }
    }
    console.log(missing ? `${missing} folder(s) incomplete` : "All graphics present.");
}

//-----------------------------------------------------------------------------
// CLI
//-----------------------------------------------------------------------------

async function main(argv) {
    const args = argv.slice(2);
    const cmd = args[0];
    let root = path.join(__dirname, "..", "game");
    const r = args.indexOf("--root");
    if (r >= 0 && args[r + 1]) {
        root = path.resolve(args[r + 1]);
    }
    const onlyIdx = args.indexOf("--only");
    const only = onlyIdx >= 0 && args[onlyIdx + 1] ? new Set(args[onlyIdx + 1].split(",").map(s => s.trim())) : null;
    const o = { dryRun: args.includes("--dry-run"), offline: args.includes("--offline"), only };
    switch (cmd) {
        case "import":
            await importData(root, o);
            return 0;
        case "check":
            return check(root, o);
        case "items":
            await linkItems(root, o);
            return 0;
        case "gfx":
            await gfx(root);
            return 0;
        default:
            console.log("Usage: node tools/pbs.js <import|check|items|gfx> [--root <game dir>] [--dry-run] [--only types,natures,abilities,moves,items,pokemon] [--offline]");
            return cmd ? 1 : 0;
    }
}

if (require.main === module) {
    main(process.argv).then(
        code => process.exit(code || 0),
        e => {
            console.error(e.message || e);
            process.exit(1);
        }
    );
}

module.exports = { importData, check, linkItems, gfx, loadAll, stringifyPbs, evolutionOf, learnsetOf, LocaleTables };
