//=============================================================================
// PokéMZ - PBS_Core.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] PBS data layer: async loading, schemas, registries,
 * two-pass references, line-accurate errors and hot reload.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @orderAfter PokeMZ_Locale
 *
 * @param folder
 * @text PBS Folder
 * @desc Folder of the PBS JSON files.
 * @type string
 * @default data/pbs/
 *
 * @param showdownCheck
 * @text Check Showdown IDs
 * @desc When PS_Sim is enabled, warn about species, moves, abilities and
 * items whose ID Showdown doesn't know (unless the entry is "custom").
 * @type boolean
 * @default true
 *
 * @param warningsInRelease
 * @text Log Warnings In Release
 * @desc Print data warnings to the console outside of playtest too.
 * @type boolean
 * @default false
 *
 * @param hotReload
 * @text Hot Reload (playtest)
 * @desc Reload the PBS files when they change (NW.js) or when the UI
 * hot reload key (F6) is pressed.
 * @type boolean
 * @default true
 *
 * @help
 * ============================================================================
 * PokeMZ_PBS_Core
 * ============================================================================
 * Loads the Pokémon data in data/pbs/*.json while MZ loads its database,
 * validates it against schemas, and exposes it through registries:
 *
 *   PokeMZ.PBS.species.get("pikachu").name          (localized)
 *   PokeMZ.PBS.moves.get("thunderbolt").power
 *   PokeMZ.PBS.items.forDbItem(17)                  (MZ item -> PBS item)
 *   PokeMZ.PBS.encounters.forMap($gameMap.mapId())
 *
 * IDs follow Pokémon Showdown's convention: lower case letters and digits
 * only ("raichualola", "willowisp"). Each file is an object keyed by ID (or
 * by MZ map ID for map files). Keys starting with "#" are comments.
 *
 * Errors keep their position: "moves.json:120:14 /thunderbolt/type unknown
 * types \"electrik\" (did you mean \"electric\"?)". In playtest the boot stops
 * on errors and lists them; warnings go to the console.
 *
 * Extending (from another plugin, before the database loads):
 *   PokeMZ.PBS.extendSchema("pokemon", { myField: T.int().opt(0) })
 *   PokeMZ.PBS.registerFile({ name: "quests", file: "quests.json", ... })
 *   PokeMZ.PBS.enums.add("pockets", "ingredients")
 *
 * Playtest: PokeMZ.PBS.report(), PokeMZ.PBS.reload().
 */

(() => {
    "use strict";

    //=========================================================================
    // Engine (pure: no MZ or DOM; also loaded by tools/pbs.js and tests)
    //=========================================================================

    /**
     * @brief Showdown's ID convention: lower case, letters and digits only.
     * @param {*} text Any value.
     * @return {string} The ID ("Mr. Mime" -> "mrmime").
     */
    function toID(text) {
        if (text && typeof text === "object" && text.id) {
            return String(text.id);
        }
        return String(text === undefined || text === null ? "" : text)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "");
    }

    /** @brief "dexEntry" -> "DexEntry". */
    const capital = s => s.charAt(0).toUpperCase() + s.slice(1);

    /** @brief Escapes one JSON pointer segment (RFC 6901). */
    const escapePointer = key => String(key).replace(/~/g, "~0").replace(/\//g, "~1");

    /** @brief Deep copy of plain JSON values. */
    const clone = v => (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v);

    /** @brief True for plain objects (not arrays or null). */
    const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

    //-------------------------------------------------------------------------
    // Line-tracking JSON parser
    //-------------------------------------------------------------------------

    /**
     * @brief Error with a file position.
     */
    class PbsSyntaxError extends Error {
        /**
         * @param {string} message Message.
         * @param {string} file File name.
         * @param {number} line 1-based line.
         * @param {number} col 1-based column.
         */
        constructor(message, file, line, col) {
            super(`${file}:${line}:${col} ${message}`);
            this.name = "PbsSyntaxError";
            this.file = file;
            this.line = line;
            this.col = col;
            this.detail = message;
        }
    }

    /**
     * @brief Parses JSON and records where every value starts. JSON.parse
     *        loses positions, so error messages could not point at a line.
     * @param {string} text JSON text (a BOM is skipped; empty text is {}).
     * @param {string} [file] File name for errors.
     * @return {{value: *, locs: Map<string, {line: number, col: number}>}}
     *         The value and a JSON pointer -> position map.
     * @throws {PbsSyntaxError} On malformed JSON.
     */
    function parseJson(text, file = "<json>") {
        const src = String(text || "");
        const locs = new Map();
        let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
        let line = 1;
        let lineStart = 0;

        const pos = () => ({ line, col: i - lineStart + 1 });
        const fail = msg => {
            const p = pos();
            throw new PbsSyntaxError(msg, file, p.line, p.col);
        };
        const ws = () => {
            for (;;) {
                const c = src[i];
                if (c === "\n") {
                    line++;
                    lineStart = ++i;
                } else if (c === " " || c === "\t" || c === "\r") {
                    i++;
                } else {
                    return;
                }
            }
        };
        const expect = ch => {
            if (src[i] !== ch) {
                fail(src[i] === undefined ? `expected "${ch}" but the file ended` : `expected "${ch}" but found "${src[i]}"`);
            }
            i++;
        };

        const string = () => {
            expect('"');
            let out = "";
            for (;;) {
                const c = src[i];
                if (c === undefined || c === "\n") {
                    fail("unterminated string");
                }
                if (c === '"') {
                    i++;
                    return out;
                }
                if (c === "\\") {
                    const e = src[i + 1];
                    const map = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
                    if (e in map) {
                        out += map[e];
                        i += 2;
                    } else if (e === "u") {
                        const hex = src.slice(i + 2, i + 6);
                        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                            fail("bad \\u escape");
                        }
                        out += String.fromCharCode(parseInt(hex, 16));
                        i += 6;
                    } else {
                        fail(`bad escape "\\${e}"`);
                    }
                } else {
                    out += c;
                    i++;
                }
            }
        };

        const number = () => {
            const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 64));
            if (!m) {
                fail(`unexpected "${src[i]}"`);
            }
            i += m[0].length;
            return Number(m[0]);
        };

        const value = pointer => {
            ws();
            locs.set(pointer, pos());
            const c = src[i];
            if (c === "{") {
                i++;
                const obj = {};
                ws();
                if (src[i] === "}") {
                    i++;
                    return obj;
                }
                for (;;) {
                    ws();
                    if (src[i] !== '"') {
                        fail(src[i] === "}" ? "trailing comma before }" : "expected a quoted key");
                    }
                    const keyPos = pos();
                    const key = string();
                    const child = `${pointer}/${escapePointer(key)}`;
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        throw new PbsSyntaxError(`duplicate key "${key}"`, file, keyPos.line, keyPos.col);
                    }
                    ws();
                    expect(":");
                    obj[key] = value(child);
                    locs.set(`${child}#key`, keyPos);
                    ws();
                    if (src[i] === ",") {
                        i++;
                        continue;
                    }
                    expect("}");
                    return obj;
                }
            }
            if (c === "[") {
                i++;
                const arr = [];
                ws();
                if (src[i] === "]") {
                    i++;
                    return arr;
                }
                for (;;) {
                    ws();
                    if (src[i] === "]") {
                        fail("trailing comma before ]");
                    }
                    arr.push(value(`${pointer}/${arr.length}`));
                    ws();
                    if (src[i] === ",") {
                        i++;
                        continue;
                    }
                    expect("]");
                    return arr;
                }
            }
            if (c === '"') {
                return string();
            }
            if (src.startsWith("true", i)) {
                i += 4;
                return true;
            }
            if (src.startsWith("false", i)) {
                i += 5;
                return false;
            }
            if (src.startsWith("null", i)) {
                i += 4;
                return null;
            }
            if (c === undefined) {
                fail("unexpected end of file");
            }
            return number();
        };

        ws();
        if (i >= src.length) {
            return { value: {}, locs };
        }
        const result = value("");
        ws();
        if (i < src.length) {
            fail(`unexpected "${src[i]}" after the end of the data`);
        }
        return { value: result, locs };
    }

    //-------------------------------------------------------------------------
    // Report
    //-------------------------------------------------------------------------

    /**
     * @brief Collects errors and warnings without stopping at the first one.
     */
    class Report {
        constructor() {
            /** @brief {severity, file, line, col, pointer, message} entries. */
            this.entries = [];
        }

        /**
         * @brief Adds an entry.
         * @param {string} severity "error" or "warning".
         * @param {string} message Message.
         * @param {Object} [where] {file, line, col, pointer}.
         */
        add(severity, message, where = {}) {
            this.entries.push({
                severity,
                message,
                file: where.file || "",
                line: where.line || 0,
                col: where.col || 0,
                pointer: where.pointer || "",
            });
        }

        /** @brief Adds an error. */
        error(message, where) {
            this.add("error", message, where);
        }

        /** @brief Adds a warning. */
        warn(message, where) {
            this.add("warning", message, where);
        }

        /** @return {Array<Object>} Errors. */
        get errors() {
            return this.entries.filter(e => e.severity === "error");
        }

        /** @return {Array<Object>} Warnings. */
        get warnings() {
            return this.entries.filter(e => e.severity === "warning");
        }

        /** @return {boolean} True when there is at least one error. */
        hasErrors() {
            return this.entries.some(e => e.severity === "error");
        }

        /**
         * @brief Formats one entry: "file:line:col /pointer message".
         * @param {Object} e Entry.
         * @return {string} Text.
         */
        static format(e) {
            const at = e.file ? `${e.file}${e.line ? `:${e.line}:${e.col}` : ""}` : "";
            return [at, e.pointer, e.message].filter(Boolean).join("  ");
        }

        /**
         * @brief All entries as text, errors first.
         * @param {number} [limit] Maximum lines.
         * @return {string} Text.
         */
        toString(limit = Infinity) {
            const sorted = this.errors.concat(this.warnings);
            const lines = sorted.slice(0, limit).map(e => `${e.severity === "error" ? "error" : "warn "}  ${Report.format(e)}`);
            if (sorted.length > limit) {
                lines.push(`... ${sorted.length - limit} more`);
            }
            return lines.join("\n");
        }

        /** @return {string} "2 errors, 5 warnings". */
        summary() {
            const n = this.errors.length;
            const w = this.warnings.length;
            return `${n} error${n === 1 ? "" : "s"}, ${w} warning${w === 1 ? "" : "s"}`;
        }
    }

    //-------------------------------------------------------------------------
    // Suggestions
    //-------------------------------------------------------------------------

    /**
     * @brief Levenshtein distance, stopping early above a limit.
     * @param {string} a First string.
     * @param {string} b Second string.
     * @param {number} max Limit.
     * @return {number} Distance (max + 1 when above the limit).
     */
    function distance(a, b, max) {
        if (Math.abs(a.length - b.length) > max) {
            return max + 1;
        }
        let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
            const cur = [i];
            let best = i;
            for (let j = 1; j <= b.length; j++) {
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
                best = Math.min(best, cur[j]);
            }
            if (best > max) {
                return max + 1;
            }
            prev = cur;
        }
        return prev[b.length];
    }

    /**
     * @brief Finds the closest known ID.
     * @param {string} id Unknown ID.
     * @param {Iterable<string>} ids Known IDs.
     * @return {string|null} A suggestion.
     */
    function suggest(id, ids) {
        const want = toID(id);
        let best = null;
        let bestD = Math.max(1, Math.min(3, Math.floor(want.length / 3)));
        for (const known of ids) {
            if (known === want) {
                return known;
            }
            const d = distance(want, known, bestD);
            if (d <= bestD && (best === null || d < bestD)) {
                best = known;
                bestD = d;
            }
        }
        return best;
    }

    //-------------------------------------------------------------------------
    // Open enums
    //-------------------------------------------------------------------------

    /**
     * @brief Named sets of allowed words. They are open: plugins add values
     *        for fan-made content, and unknown values are only warnings.
     */
    const enums = {
        sets: new Map(),

        /**
         * @brief Adds values to an enum (creating it).
         * @param {string} name Enum name.
         * @param {...string} values Values.
         */
        add(name, ...values) {
            if (!this.sets.has(name)) {
                this.sets.set(name, new Set());
            }
            const set = this.sets.get(name);
            for (const v of values.flat()) {
                set.add(String(v));
            }
        },

        /** @return {boolean} True if the enum has the value. */
        has(name, value) {
            const set = this.sets.get(name);
            return !!set && set.has(String(value));
        },

        /** @return {Array<string>} The values. */
        values(name) {
            return [...(this.sets.get(name) || [])];
        },
    };

    const STATS = ["hp", "atk", "def", "spa", "spd", "spe"];
    enums.add("stats", STATS);
    enums.add("growthRates", "fast", "mediumfast", "mediumslow", "slow", "erratic", "fluctuating");
    enums.add("moveCategories", "physical", "special", "status");
    enums.add("moveTargets", [
        "normal", "self", "adjacentally", "adjacentallyorself", "adjacentfoe", "all", "alladjacent",
        "alladjacentfoes", "allies", "allyside", "allyteam", "any", "foeside", "randomnormal", "scripted",
    ]);
    enums.add("pockets", "items", "medicine", "balls", "tms", "berries", "battle", "treasures", "key", "other");
    enums.add("fieldUse", "none", "onpokemon", "direct", "tm", "tr", "hm");
    enums.add("battleUse", "none", "onpokemon", "onmove", "onbattler", "direct", "ball");
    enums.add("eggGroups", [
        "monster", "water1", "bug", "flying", "field", "fairy", "grass", "humanlike", "water3", "mineral",
        "amorphous", "water2", "ditto", "dragon", "undiscovered",
    ]);
    enums.add("colors", "red", "blue", "yellow", "green", "black", "brown", "purple", "gray", "white", "pink");
    enums.add("genders", "male", "female", "genderless", "mixed");
    enums.add("flavors", "", "spicy", "dry", "sweet", "bitter", "sour");
    enums.add("edges", "north", "south", "east", "west");
    enums.add("battleTypes", "single", "double");
    enums.add("encounterTypes", [
        "land", "landday", "landnight", "landmorning", "cave", "water", "oldrod", "goodrod", "superrod",
        "rocksmash", "headbutt", "bugcontest",
    ]);
    enums.add("evolutionMethods", [
        "level", "levelmale", "levelfemale", "levelday", "levelnight", "levelmorning", "levelevening",
        "levelhelditem", "levelmove", "levelmovetype", "levellocation", "levelparty", "levelstats",
        "levelweather", "levelfriendship", "friendship", "friendshipday", "friendshipnight",
        "affection", "item", "itemmale", "itemfemale", "trade", "tradeitem", "tradespecies", "shed",
        "levelextra", "other", "scripted",
    ]);

    //-------------------------------------------------------------------------
    // Schema / type system
    //-------------------------------------------------------------------------

    /**
     * @brief Validation context: where a value is (file + JSON pointer), the
     *        report, collected references and load options.
     */
    class Context {
        /**
         * @param {Object} shared {file, locs, report, refs, opts}.
         * @param {string} pointer JSON pointer of the value.
         */
        constructor(shared, pointer = "") {
            this.shared = shared;
            this.pointer = pointer;
        }

        /** @return {Context} The context of a child value. */
        at(key) {
            return new Context(this.shared, `${this.pointer}/${escapePointer(key)}`);
        }

        /** @return {Object} {file, line, col, pointer} of this value. */
        where() {
            const { locs, file } = this.shared;
            let p = this.pointer;
            let loc = locs && locs.get(p);
            while (!loc && p) {
                p = p.slice(0, p.lastIndexOf("/"));
                loc = locs && locs.get(p);
            }
            return { file, line: loc ? loc.line : 0, col: loc ? loc.col : 0, pointer: this.pointer };
        }

        /** @brief Reports an error here. */
        error(message) {
            this.shared.report.error(message, this.where());
        }

        /** @brief Reports a warning here. */
        warn(message) {
            this.shared.report.warn(message, this.where());
        }

        /** @return {Object} Load options. */
        get opts() {
            return this.shared.opts || {};
        }
    }

    /** @brief Marks "this value was invalid" (the field is then dropped). */
    const INVALID = Symbol("invalid");

    /**
     * @brief A schema type. check(value, ctx) returns the coerced value or
     *        INVALID after reporting.
     */
    class Type {
        /**
         * @param {string} kind Name shown in messages.
         * @param {function(*, Context): *} check Validator.
         * @param {Object} [extra] Extra properties (optional, def, localized...).
         */
        constructor(kind, check, extra = {}) {
            this.kind = kind;
            this._check = check;
            this.optional = false;
            this.def = undefined;
            Object.assign(this, extra);
        }

        /**
         * @brief Validates a value.
         * @param {*} value Value.
         * @param {Context} ctx Context.
         * @return {*} Coerced value or INVALID.
         */
        check(value, ctx) {
            if ((value === null || value === undefined) && this.nullable) {
                return null;
            }
            return this._check(value, ctx);
        }

        /**
         * @brief Makes the field optional.
         * @param {*} [def] Default value (copied for each entry).
         * @return {Type} A copy.
         */
        opt(def) {
            const t = Object.create(this);
            t.optional = true;
            t.def = def;
            return t;
        }

        /** @return {Type} A copy that also accepts null. */
        orNull() {
            const t = Object.create(this);
            t.nullable = true;
            return t;
        }
    }

    const describe = v => (Array.isArray(v) ? "a list" : v === null ? "null" : typeof v === "object" ? "an object" : JSON.stringify(v));

    /**
     * @brief Schema type constructors.
     */
    const T = {
        /** @brief Any JSON value. */
        any: () => new Type("any", v => clone(v)),

        /** @brief A string. {nonEmpty, pattern} */
        string: (o = {}) =>
            new Type("string", (v, ctx) => {
                if (typeof v === "number") {
                    v = String(v);
                }
                if (typeof v !== "string") {
                    ctx.error(`expected text, found ${describe(v)}`);
                    return INVALID;
                }
                if (o.nonEmpty && !v) {
                    ctx.error("must not be empty");
                    return INVALID;
                }
                if (o.pattern && !o.pattern.test(v)) {
                    ctx.error(`"${v}" does not match ${o.pattern}`);
                    return INVALID;
                }
                return v;
            }),

        /** @brief Translatable text: the source-language value. */
        localized: () => Object.assign(T.string(), { localized: true, kind: "text" }),

        /** @brief An integer. {min, max} */
        int: (o = {}) =>
            new Type("int", (v, ctx) => {
                if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
                    v = Number(v);
                }
                if (typeof v !== "number" || !Number.isInteger(v)) {
                    ctx.error(`expected a whole number, found ${describe(v)}`);
                    return INVALID;
                }
                if ((o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max)) {
                    ctx.error(`${v} is out of range (${o.min !== undefined ? o.min : "-∞"}..${o.max !== undefined ? o.max : "∞"})`);
                    return INVALID;
                }
                return v;
            }),

        /** @brief A number. {min, max} */
        float: (o = {}) =>
            new Type("number", (v, ctx) => {
                if (typeof v !== "number" || !isFinite(v)) {
                    ctx.error(`expected a number, found ${describe(v)}`);
                    return INVALID;
                }
                if ((o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max)) {
                    ctx.error(`${v} is out of range (${o.min}..${o.max})`);
                    return INVALID;
                }
                return v;
            }),

        /** @brief true / false. */
        bool: () =>
            new Type("bool", (v, ctx) => {
                if (typeof v !== "boolean") {
                    ctx.error(`expected true or false, found ${describe(v)}`);
                    return INVALID;
                }
                return v;
            }),

        /**
         * @brief A word from an open enum (see enums). Unknown words are kept
         *        with a warning so fan-made values don't break loading.
         * @param {string} name Enum name.
         */
        enum: name =>
            new Type(`enum ${name}`, (v, ctx) => {
                if (typeof v !== "string") {
                    ctx.error(`expected one of ${name}, found ${describe(v)}`);
                    return INVALID;
                }
                const id = toID(v);
                if (id !== "" && !enums.has(name, id)) {
                    const s = suggest(id, enums.values(name));
                    ctx.warn(`unknown ${name} "${v}"${s ? ` (did you mean "${s}"?)` : ""}; add it with PBS.enums.add("${name}", "${id}")`);
                }
                return id;
            }),

        /** @brief A list of words (lower-cased IDs). */
        flags: () =>
            new Type("flags", (v, ctx) => {
                if (!Array.isArray(v) || v.some(x => typeof x !== "string")) {
                    ctx.error(`expected a list of words, found ${describe(v)}`);
                    return INVALID;
                }
                return v.map(toID);
            }),

        /**
         * @brief A list. {min, max}
         * @param {Type} item Item type.
         */
        array: (item, o = {}) =>
            new Type(`list of ${item.kind}`, (v, ctx) => {
                if (!Array.isArray(v)) {
                    ctx.error(`expected a list, found ${describe(v)}`);
                    return INVALID;
                }
                if ((o.min !== undefined && v.length < o.min) || (o.max !== undefined && v.length > o.max)) {
                    ctx.error(`expected ${o.min === o.max ? o.min : `${o.min || 0}..${o.max !== undefined ? o.max : "∞"}`} items, found ${v.length}`);
                }
                const out = [];
                v.forEach((x, i) => {
                    const r = item.check(x, ctx.at(i));
                    if (r !== INVALID) {
                        out.push(r);
                    }
                });
                return out;
            }),

        /**
         * @brief A fixed-shape list, e.g. [level, move]. Trailing optional
         *        items may be left out.
         * @param {Array<Type>} items Item types.
         */
        tuple: items =>
            new Type(`[${items.map(t => t.kind).join(", ")}]`, (v, ctx) => {
                const required = items.filter(t => !t.optional).length;
                if (!Array.isArray(v) || v.length < required || v.length > items.length) {
                    ctx.error(`expected [${items.map(t => t.kind).join(", ")}], found ${describe(v)}`);
                    return INVALID;
                }
                const out = [];
                for (let i = 0; i < items.length; i++) {
                    if (i >= v.length) {
                        out.push(clone(items[i].def));
                        continue;
                    }
                    const r = items[i].check(v[i], ctx.at(i));
                    if (r === INVALID) {
                        return INVALID;
                    }
                    out.push(r);
                }
                return out;
            }),

        /**
         * @brief An object with known fields. Unknown fields are kept and
         *        warned about (use PBS.extendSchema to declare them).
         * @param {Object<string, Type>} fields Field types.
         * @param {Object} [o] {unknown: "warn" | "keep" | "error"}.
         */
        struct: (fields, o = {}) => {
            const t = new Type("object", (v, ctx) => {
                if (!isObject(v)) {
                    ctx.error(`expected an object, found ${describe(v)}`);
                    return INVALID;
                }
                const out = {};
                for (const [key, type] of Object.entries(t.fields)) {
                    if (!Object.prototype.hasOwnProperty.call(v, key) || v[key] === undefined) {
                        if (!type.optional) {
                            ctx.error(`missing "${key}" (${type.kind})`);
                        } else if (type.def !== undefined) {
                            out[key] = clone(type.def);
                        }
                        continue;
                    }
                    const r = type.check(v[key], ctx.at(key));
                    if (r !== INVALID) {
                        out[key] = r;
                    } else if (type.optional && type.def !== undefined) {
                        out[key] = clone(type.def);
                    }
                }
                for (const key of Object.keys(v)) {
                    if (key.startsWith("#") || Object.prototype.hasOwnProperty.call(t.fields, key)) {
                        continue;
                    }
                    const mode = t.unknown || "warn";
                    if (mode === "error") {
                        ctx.at(key).error(`unknown field "${key}"`);
                        continue;
                    }
                    if (mode === "warn") {
                        const s = suggest(key.toLowerCase(), Object.keys(t.fields).map(k => k.toLowerCase()));
                        ctx.at(key).warn(`unknown field "${key}"${s ? ` (did you mean "${Object.keys(t.fields).find(k => k.toLowerCase() === s)}"?)` : ""}`);
                    }
                    out[key] = clone(v[key]);
                }
                return out;
            });
            t.fields = Object.assign({}, fields);
            t.unknown = o.unknown;
            return t;
        },

        /**
         * @brief An object used as a map: {key: value}.
         * @param {Type} value Value type.
         * @param {Type} [key] Key type (validated as a string).
         */
        dict: (value, key) =>
            new Type(`map of ${value.kind}`, (v, ctx) => {
                if (!isObject(v)) {
                    ctx.error(`expected an object, found ${describe(v)}`);
                    return INVALID;
                }
                const out = {};
                for (const k of Object.keys(v)) {
                    if (k.startsWith("#")) {
                        continue;
                    }
                    let kk = k;
                    if (key) {
                        kk = key.check(k, ctx.at(k));
                        if (kk === INVALID) {
                            continue;
                        }
                    }
                    const r = value.check(v[k], ctx.at(k));
                    if (r !== INVALID) {
                        out[kk] = r;
                    }
                }
                return out;
            }),

        /**
         * @brief The first type that accepts the value.
         * @param {Array<Type>} types Candidates.
         */
        oneOf: types =>
            new Type(types.map(t => t.kind).join(" or "), (v, ctx) => {
                for (const type of types) {
                    const probe = new Report();
                    const r = type.check(v, new Context(Object.assign({}, ctx.shared, { report: probe, refs: [] }), ctx.pointer));
                    if (r !== INVALID && !probe.hasErrors()) {
                        return type.check(v, ctx);
                    }
                }
                ctx.error(`expected ${types.map(t => t.kind).join(" or ")}, found ${describe(v)}`);
                return INVALID;
            }),

        /**
         * @brief The ID of an entry in a registry. Checked in pass 2, so
         *        files can refer to each other in any order.
         * @param {string} registry Registry name (e.g. "moves").
         */
        ref: registry =>
            new Type(`${registry} ID`, (v, ctx) => {
                if (typeof v !== "string" || !v) {
                    ctx.error(`expected a ${registry} ID, found ${describe(v)}`);
                    return INVALID;
                }
                const id = toID(v);
                if (id !== v) {
                    ctx.warn(`"${v}" is not a Showdown-style ID; using "${id}"`);
                }
                if (ctx.shared.refs) {
                    ctx.shared.refs.push({ registry, id, where: ctx.where() });
                }
                return id;
            }),

        /** @brief An MZ map ID (MapInfos.json). */
        mapId: () =>
            new Type("map ID", (v, ctx) => {
                if (typeof v === "string" && /^\d+$/.test(v)) {
                    v = Number(v);
                }
                if (!Number.isInteger(v) || v < 1) {
                    ctx.error(`expected an MZ map ID, found ${describe(v)}`);
                    return INVALID;
                }
                const infos = ctx.opts.mapInfos;
                if (infos && !infos[v]) {
                    ctx.error(`map ${v} does not exist in MapInfos.json`);
                    return INVALID;
                }
                return v;
            }),

        /** @brief {hp, atk, def, spa, spd, spe} integers. */
        stats: (o = {}) =>
            T.struct(
                Object.fromEntries(STATS.map(s => [s, T.int({ min: 0, max: o.max }).opt(o.def !== undefined ? o.def : 0)])),
                { unknown: "error" }
            ),

        /** @brief [mapId, x, y]. */
        mapPoint: () => T.tuple([T.mapId(), T.int({ min: 0 }), T.int({ min: 0 })]),
    };

    //-------------------------------------------------------------------------
    // Registries and data classes
    //-------------------------------------------------------------------------

    /**
     * @brief Translates text. Replaced by the MZ glue with PokeMZ.L10n.
     * @type {function(string, string): string}
     */
    let translator = (key, fallback) => fallback;

    /**
     * @brief Base class of every data entry.
     */
    class PbsData {
        /**
         * @param {string} id Entry ID.
         * @param {Object} data Validated fields.
         * @param {Object} source {file, line, col}.
         */
        constructor(id, data, source) {
            Object.defineProperty(this, "_text", { value: {}, writable: true });
            Object.defineProperty(this, "source", { value: source, writable: true });
            this.id = id;
            const localized = this.constructor.localizedFields || [];
            for (const [k, v] of Object.entries(data)) {
                if (localized.includes(k)) {
                    this._text[k] = v;
                } else {
                    this[k] = v;
                }
            }
        }

        /** @return {string} Key prefix for localized fields ("Pokemon.pikachu"). */
        get textKey() {
            return `${this.constructor.kind}.${this.id}`;
        }

        /**
         * @brief A localized field.
         * @param {string} field Field name ("name").
         * @return {string} Translated text, or the source text.
         */
        text(field) {
            const src = this._text[field];
            return translator(`${this.textKey}.${capital(field)}`, src !== undefined ? src : "");
        }

        /**
         * @brief Source-language text of a localized field (untranslated).
         * @param {string} field Field name.
         * @return {string} Text.
         */
        sourceText(field) {
            return this._text[field] !== undefined ? this._text[field] : "";
        }

        /** @return {Object} Plain data (source text for localized fields). */
        toJSON() {
            return Object.assign({}, this, this._text);
        }

        /**
         * @brief Defines localized getters on a class.
         * @param {Function} cls Class.
         * @param {Array<string>} fields Field names.
         */
        static defineLocalized(cls, fields) {
            cls.localizedFields = Array.from(new Set((cls.localizedFields || []).concat(fields)));
            for (const field of fields) {
                if (!Object.getOwnPropertyDescriptor(cls.prototype, field)) {
                    Object.defineProperty(cls.prototype, field, {
                        get() {
                            return this.text(field);
                        },
                        configurable: true,
                    });
                }
            }
        }
    }
    PbsData.kind = "Data";

    /**
     * @brief A set of entries keyed by ID with a common API.
     */
    class Registry {
        /**
         * @param {string} name Registry name ("moves").
         */
        constructor(name) {
            this.name = name;
            this._map = new Map();
            this._indexes = new Map();
            this.frozen = false;
        }

        /**
         * @brief Adds an entry.
         * @param {PbsData} entry Entry with an id.
         */
        add(entry) {
            if (this.frozen) {
                throw new Error(`PBS registry "${this.name}" is frozen`);
            }
            this._map.set(String(entry.id), entry);
            this._indexes.clear();
        }

        /**
         * @brief Gets an entry; throws when the ID is unknown.
         * @param {string|number} id ID.
         * @return {PbsData} The entry.
         */
        get(id) {
            const e = this._map.get(String(id));
            if (!e) {
                const s = suggest(String(id), this._map.keys());
                throw new Error(`Unknown ${this.name} ID "${id}"${s ? ` (did you mean "${s}"?)` : ""}`);
            }
            return e;
        }

        /** @return {PbsData|null} The entry or null. */
        tryGet(id) {
            return id === undefined || id === null ? null : this._map.get(String(id)) || null;
        }

        /** @return {boolean} True if the ID exists. */
        has(id) {
            return this._map.has(String(id));
        }

        /** @return {Array<string>} IDs in file order. */
        ids() {
            return [...this._map.keys()];
        }

        /** @return {Array<PbsData>} Entries in file order. */
        all() {
            return [...this._map.values()];
        }

        /** @return {number} Entry count. */
        get size() {
            return this._map.size;
        }

        /** @return {Array<PbsData>} Entries passing fn. */
        filter(fn) {
            return this.all().filter(fn);
        }

        /** @return {PbsData|undefined} First entry passing fn. */
        find(fn) {
            return this.all().find(fn);
        }

        /** @return {Array<*>} Mapped entries. */
        map(fn) {
            return this.all().map(fn);
        }

        [Symbol.iterator]() {
            return this._map.values();
        }

        /**
         * @brief Looks entries up by a secondary key (built on first use).
         * @param {string} name Index name.
         * @param {function(PbsData): *} keyFn Key of an entry (undefined = skip).
         * @param {*} key Key to find.
         * @return {Array<PbsData>} Matching entries.
         */
        lookup(name, keyFn, key) {
            let index = this._indexes.get(name);
            if (!index) {
                index = new Map();
                for (const e of this._map.values()) {
                    const keys = [].concat(keyFn(e));
                    for (const k of keys) {
                        if (k === undefined || k === null) {
                            continue;
                        }
                        if (!index.has(k)) {
                            index.set(k, []);
                        }
                        index.get(k).push(e);
                    }
                }
                this._indexes.set(name, index);
            }
            return index.get(key) || [];
        }

        /** @brief Makes the registry read-only. */
        freeze() {
            this.frozen = true;
        }
    }

    //-------------------------------------------------------------------------
    // Data classes
    //-------------------------------------------------------------------------

    class TypeData extends PbsData {
        /**
         * @brief Damage multiplier of this attacking type against defenders.
         * @param {Array<string>|string} defender Defending type IDs.
         * @return {number} 0, 0.25 ... 4.
         */
        effectiveness(defender) {
            let m = 1;
            for (const id of [].concat(defender)) {
                const d = this._registry && this._registry.tryGet(id);
                if (!d) {
                    continue;
                }
                if (d.immunities.includes(this.id)) {
                    return 0;
                }
                if (d.weaknesses.includes(this.id)) {
                    m *= 2;
                }
                if (d.resistances.includes(this.id)) {
                    m /= 2;
                }
            }
            return m;
        }
    }
    TypeData.kind = "Type";

    class NatureData extends PbsData {
        /**
         * @brief Stat multiplier.
         * @param {string} stat "atk" ...
         * @return {number} 1.1, 0.9 or 1.
         */
        modifier(stat) {
            if (this.plus === this.minus) {
                return 1;
            }
            return stat === this.plus ? 1.1 : stat === this.minus ? 0.9 : 1;
        }
    }
    NatureData.kind = "Nature";

    class AbilityData extends PbsData {}
    AbilityData.kind = "Ability";

    class MoveData extends PbsData {}
    MoveData.kind = "Move";

    class ItemData extends PbsData {
        /** @return {Object|null} The linked MZ database item. */
        get dbItem() {
            return this.dbItemId && typeof $dataItems !== "undefined" && $dataItems ? $dataItems[this.dbItemId] || null : this._dbItem || null;
        }

        /** @return {number} Price (the MZ item's when linked). */
        get price() {
            const db = this.dbItem;
            return db ? db.price : this._price || 0;
        }

        set price(v) {
            this._price = v;
        }

        /** @return {number} Icon index (the MZ item's when linked). */
        get iconIndex() {
            const db = this.dbItem;
            return db ? db.iconIndex : this._iconIndex || 0;
        }

        set iconIndex(v) {
            this._iconIndex = v;
        }

        /** @return {boolean} True for key items. */
        get isKeyItem() {
            return this.pocket === "key" || (this.flags || []).includes("keyitem");
        }

        /** @return {boolean} True if the item has the flag. */
        hasFlag(flag) {
            return (this.flags || []).includes(toID(flag));
        }
    }
    ItemData.kind = "Item";

    class SpeciesData extends PbsData {
        /** @return {boolean} True for an alternate form. */
        get isForm() {
            return !!this.baseSpecies;
        }

        /** @return {string} Base species ID (itself for base species). */
        get baseId() {
            return this.baseSpecies || this.id;
        }

        /** @return {string} Showdown display name ("Raichu-Alola"). */
        get showdownName() {
            if (this.baseSpecies && this._registry) {
                const base = this._registry.tryGet(this.baseSpecies);
                return `${base ? base.sourceText("name") : this.baseSpecies}-${this.forme || ""}`;
            }
            return this.sourceText("name");
        }

        /**
         * @brief Localized fields fall back to the base species
         *        (Pokemon.raichualola.Genus -> Pokemon.raichu.Genus).
         */
        text(field) {
            const own = this._text[field];
            if (this.baseSpecies && own === undefined && this._registry) {
                const base = this._registry.tryGet(this.baseSpecies);
                if (base) {
                    return translator(`${this.textKey}.${capital(field)}`, base.text(field));
                }
            }
            return super.text(field);
        }

        /** @return {Array<SpeciesData>} Forms of this species. */
        get forms() {
            return this._registry ? this._registry.lookup("forms", s => s.baseSpecies, this.id) : [];
        }

        /** @return {boolean} True if genderless. */
        get genderless() {
            return this.gender === "genderless";
        }

        /** @return {number} Chance of a male (0..1), or -1 if genderless. */
        get maleRatio() {
            if (this.gender === "genderless") {
                return -1;
            }
            if (this.gender === "male") {
                return 1;
            }
            if (this.gender === "female") {
                return 0;
            }
            return this.genderRatio !== undefined ? this.genderRatio : 0.5;
        }

        /**
         * @brief Level-up moves at or below a level, in learn order.
         * @param {number} level Level.
         * @return {Array<string>} Move IDs (no duplicates).
         */
        movesUpTo(level) {
            const out = [];
            for (const [lv, move] of this.moves.level || []) {
                if (lv <= level && !out.includes(move)) {
                    out.push(move);
                }
            }
            return out;
        }

        /**
         * @brief Moves learned exactly at a level.
         * @param {number} level Level.
         * @return {Array<string>} Move IDs.
         */
        movesAt(level) {
            return (this.moves.level || []).filter(([lv]) => lv === level).map(([, m]) => m);
        }

        /**
         * @brief True if the species can learn the move by any means.
         * @param {string} move Move ID.
         * @return {boolean} True if learnable.
         */
        canLearn(move) {
            const m = this.moves || {};
            return (
                (m.level || []).some(([, id]) => id === move) ||
                (m.tm || []).includes(move) ||
                (m.tutor || []).includes(move) ||
                (m.egg || []).includes(move)
            );
        }
    }
    SpeciesData.kind = "Pokemon";

    class MetricsData extends PbsData {}
    MetricsData.kind = "Metrics";

    class MapMetadata extends PbsData {
        /** @return {number} The MZ map ID. */
        get mapId() {
            return Number(this.id);
        }
    }
    MapMetadata.kind = "Map";

    class MapConnection extends PbsData {}
    MapConnection.kind = "MapConnection";

    class EncounterTable extends PbsData {
        /** @return {number} The MZ map ID. */
        get mapId() {
            return Number(this.id);
        }

        /** @return {Array<string>} Encounter types on this map. */
        get typesAvailable() {
            return Object.keys(this.types || {});
        }

        /**
         * @brief Rolls a slot of an encounter type.
         * @param {string} type Encounter type.
         * @param {function(): number} [rng] Random source in [0, 1).
         * @return {{species: string, level: number}|null} The encounter.
         */
        roll(type, rng = Math.random) {
            const table = this.types && this.types[type];
            if (!table || !table.slots.length) {
                return null;
            }
            const total = table.slots.reduce((n, s) => n + s[0], 0);
            let r = rng() * total;
            for (const [chance, species, min, max] of table.slots) {
                r -= chance;
                if (r < 0) {
                    const hi = max || min;
                    return { species, level: min + Math.floor(rng() * (hi - min + 1)) };
                }
            }
            return null;
        }
    }
    EncounterTable.kind = "Encounters";

    class TrainerType extends PbsData {}
    TrainerType.kind = "TrainerType";

    class Trainer extends PbsData {}
    Trainer.kind = "Trainer";

    class RegionalDex extends PbsData {}
    RegionalDex.kind = "Dex";

    class Ribbon extends PbsData {}
    Ribbon.kind = "Ribbon";

    class BerryPlant extends PbsData {}
    BerryPlant.kind = "BerryPlant";

    class TownMap extends PbsData {
        /**
         * @brief Localized point name.
         * @param {number} i Point index.
         * @return {string} Name.
         */
        pointName(i) {
            const p = this.points[i];
            return p ? translator(`${this.textKey}.Point${i}`, p.name || "") : "";
        }
    }
    TownMap.kind = "TownMap";

    class PhoneContact extends PbsData {
        /**
         * @brief Localized message.
         * @param {string} category Message group ("greetings").
         * @param {number} i Index.
         * @return {string} Text.
         */
        message(category, i) {
            const list = (this.messages || {})[category] || [];
            return list[i] !== undefined ? translator(`${this.textKey}.${capital(category)}${i}`, list[i]) : "";
        }
    }
    PhoneContact.kind = "Phone";

    class BattleTowerSet extends PbsData {}
    BattleTowerSet.kind = "BattleTower";

    //-------------------------------------------------------------------------
    // File specs (schemas)
    //-------------------------------------------------------------------------

    const optRef = r => T.ref(r).opt();
    const refList = r => T.array(T.ref(r)).opt([]);

    /** @brief Species fields shared by pokemon.json and pokemon_forms.json. */
    function speciesFields(isForm) {
        const o = (t, def) => (isForm ? t.opt() : def === undefined ? t : t.opt(def));
        return {
            num: o(T.int({ min: 0 }), 0),
            name: o(T.localized()),
            formName: T.localized().opt(),
            genus: T.localized().opt(),
            dexEntry: T.localized().opt(),
            types: o(T.array(T.ref("types"), { min: 1, max: 2 })),
            baseStats: o(T.stats({ max: 255 })),
            abilities: o(T.dict(T.ref("abilities")), {}),
            gender: o(T.enum("genders"), "mixed"),
            genderRatio: o(T.float({ min: 0, max: 1 }), 0.5),
            growthRate: o(T.enum("growthRates"), "mediumfast"),
            baseExp: o(T.int({ min: 0 }), 64),
            evYield: o(T.stats({ max: 3 }), { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }),
            catchRate: o(T.int({ min: 0, max: 255 }), 45),
            baseFriendship: o(T.int({ min: 0, max: 255 }), 50),
            eggGroups: o(T.array(T.enum("eggGroups")), ["undiscovered"]),
            eggCycles: o(T.int({ min: 0 }), 20),
            height: o(T.int({ min: 0 }), 10),
            weight: o(T.int({ min: 0 }), 100),
            color: o(T.enum("colors"), "red"),
            shape: o(T.string(), ""),
            habitat: o(T.string(), ""),
            moves: o(
                T.struct({
                    level: T.array(T.tuple([T.int({ min: 0, max: 100 }), T.ref("moves")])).opt([]),
                    tm: refList("moves"),
                    tutor: refList("moves"),
                    egg: refList("moves"),
                }),
                { level: [], tm: [], tutor: [], egg: [] }
            ),
            evolutions: o(
                T.array(
                    T.struct({
                        species: T.ref("species"),
                        method: T.enum("evolutionMethods"),
                        param: T.any().opt(null),
                        condition: T.any().opt(null),
                    })
                ),
                []
            ),
            offspring: o(refList("species"), []),
            incense: optRef("items"),
            wildItems: o(T.struct({ common: optRef("items"), uncommon: optRef("items"), rare: optRef("items") }), {}),
            flags: o(T.flags(), []),
            custom: T.bool().opt(false),
        };
    }

    /**
     * @brief Built-in file specs. Each: {name (registry), file, kind, key
     *        ("id" | "mapId"), schema, cls, link(entry, api)}.
     */
    const SPECS = [];

    /**
     * @brief Registers a PBS file. Call before the database loads.
     * @param {Object} spec {name, file, cls, schema (T.struct), key = "id",
     *        registry (defaults to name), link(entry, api)}.
     */
    function registerFile(spec) {
        const s = Object.assign({ key: "id", registry: spec.name, cls: class extends PbsData {} }, spec);
        if (!s.cls.kind || s.cls.kind === "Data") {
            s.cls.kind = capital(s.name);
        }
        const existing = SPECS.findIndex(x => x.name === s.name);
        if (existing >= 0) {
            SPECS[existing] = s;
        } else {
            SPECS.push(s);
        }
        refreshLocalized(s);
        return s;
    }

    /** @brief Defines localized getters from a spec's schema. */
    function refreshLocalized(spec) {
        const fields = Object.entries(spec.schema.fields || {})
            .filter(([, t]) => t.localized)
            .map(([k]) => k);
        PbsData.defineLocalized(spec.cls, fields);
    }

    /**
     * @brief Adds or replaces fields in a file's schema.
     * @param {string} name Spec name ("pokemon").
     * @param {Object<string, Type>} fields Fields.
     */
    function extendSchema(name, fields) {
        const spec = SPECS.find(s => s.name === name);
        if (!spec) {
            throw new Error(`Unknown PBS file "${name}"`);
        }
        Object.assign(spec.schema.fields, fields);
        refreshLocalized(spec);
    }

    registerFile({
        name: "types",
        file: "types.json",
        cls: TypeData,
        schema: T.struct({
            num: T.int().opt(0),
            name: T.localized(),
            weaknesses: refList("types"),
            resistances: refList("types"),
            immunities: refList("types"),
            color: T.string().opt("#a8a878"),
            icon: T.int({ min: 0 }).opt(0),
            hidden: T.bool().opt(false),
            flags: T.flags().opt([]),
            custom: T.bool().opt(false),
        }),
    });

    registerFile({
        name: "natures",
        file: "natures.json",
        cls: NatureData,
        schema: T.struct({
            num: T.int().opt(0),
            name: T.localized(),
            plus: T.enum("stats").opt(""),
            minus: T.enum("stats").opt(""),
            likes: T.enum("flavors").opt(""),
            dislikes: T.enum("flavors").opt(""),
        }),
    });

    registerFile({
        name: "abilities",
        file: "abilities.json",
        cls: AbilityData,
        schema: T.struct({
            num: T.int().opt(0),
            name: T.localized(),
            description: T.localized().opt(""),
            flags: T.flags().opt([]),
            custom: T.bool().opt(false),
        }),
    });

    registerFile({
        name: "moves",
        file: "moves.json",
        cls: MoveData,
        schema: T.struct({
            num: T.int().opt(0),
            name: T.localized(),
            description: T.localized().opt(""),
            type: T.ref("types"),
            category: T.enum("moveCategories"),
            power: T.int({ min: 0 }).opt(0),
            accuracy: T.int({ min: 0, max: 101 }).opt(0),
            pp: T.int({ min: 1 }).opt(5),
            priority: T.int({ min: -7, max: 7 }).opt(0),
            target: T.enum("moveTargets").opt("normal"),
            effectChance: T.int({ min: 0, max: 100 }).opt(0),
            flags: T.flags().opt([]),
            fieldUse: T.string().opt(""),
            custom: T.bool().opt(false),
        }),
    });

    registerFile({
        name: "items",
        file: "items.json",
        cls: ItemData,
        schema: T.struct({
            num: T.int().opt(0),
            name: T.localized(),
            namePlural: T.localized().opt(),
            description: T.localized().opt(""),
            pocket: T.enum("pockets").opt("items"),
            sort: T.int().opt(0),
            price: T.int({ min: 0 }).opt(0),
            sellPrice: T.int({ min: 0 }).opt(),
            icon: T.int({ min: 0 }).opt(0),
            fieldUse: T.enum("fieldUse").opt("none"),
            battleUse: T.enum("battleUse").opt("none"),
            consumable: T.bool().opt(true),
            flags: T.flags().opt([]),
            move: optRef("moves"),
            effect: T.string().opt(""),
            params: T.any().opt({}),
            flingPower: T.int({ min: 0 }).opt(0),
            showdown: T.bool().opt(false),
            custom: T.bool().opt(false),
        }),
        link(entry) {
            // The MZ item (when linked) owns price and icon.
            entry.iconIndex = entry.icon;
            delete entry.icon;
        },
    });

    registerFile({ name: "species", file: "pokemon.json", cls: SpeciesData, schema: T.struct(speciesFields(false)) });

    registerFile({
        name: "forms",
        file: "pokemon_forms.json",
        registry: "species",
        cls: SpeciesData,
        schema: T.struct(
            Object.assign(speciesFields(true), {
                baseSpecies: T.ref("species"),
                forme: T.string({ nonEmpty: true }),
                folder: T.string().opt(""),
                battleOnly: T.bool().opt(false),
                cosmetic: T.bool().opt(false),
                requiredItem: optRef("items"),
            })
        ),
    });

    registerFile({
        name: "metrics",
        file: "pokemon_metrics.json",
        cls: MetricsData,
        schema: T.struct({
            frontY: T.int().opt(0),
            backY: T.int().opt(0),
            elevation: T.int().opt(0),
            shadowSize: T.int({ min: 0 }).opt(2),
            shadowX: T.int().opt(0),
        }),
    });

    registerFile({
        name: "mapMetadata",
        file: "map_metadata.json",
        key: "mapId",
        cls: MapMetadata,
        schema: T.struct({
            outdoor: T.bool().opt(false),
            showArea: T.bool().opt(true),
            bicycle: T.bool().opt(false),
            bicycleAlways: T.bool().opt(false),
            canEscape: T.bool().opt(true),
            healSpot: T.mapPoint().opt(),
            weather: T.tuple([T.string(), T.int({ min: 0, max: 100 })]).opt(),
            townMap: T.tuple([T.string(), T.int({ min: 0 }), T.int({ min: 0 })]).opt(),
            diveMap: T.mapId().opt(),
            dark: T.bool().opt(false),
            safari: T.bool().opt(false),
            battleBack: T.string().opt(""),
            wildBattleBGM: T.string().opt(""),
            trainerBattleBGM: T.string().opt(""),
            wildVictoryBGM: T.string().opt(""),
            trainerVictoryBGM: T.string().opt(""),
            wildCaptureME: T.string().opt(""),
            followers: T.bool().opt(true),
            followerItems: T.array(T.tuple([T.int({ min: 1 }), T.ref("items")])).opt(),
            dynamax: T.bool().opt(false),
            flags: T.flags().opt([]),
        }),
    });

    const edge = () => T.struct({ map: T.mapId(), edge: T.enum("edges"), offset: T.int().opt(0) });
    registerFile({
        name: "mapConnections",
        file: "map_connections.json",
        cls: MapConnection,
        schema: T.struct({ a: edge(), b: edge() }),
    });

    registerFile({
        name: "encounters",
        file: "encounters.json",
        key: "mapId",
        cls: EncounterTable,
        schema: T.struct({
            types: T.dict(
                T.struct({
                    density: T.int({ min: 0, max: 100 }).opt(10),
                    doubles: T.int({ min: 0, max: 100 }).opt(0),
                    slots: T.array(T.tuple([T.int({ min: 1 }), T.ref("species"), T.int({ min: 1, max: 100 }), T.int({ min: 1, max: 100 }).opt()])),
                }),
                T.enum("encounterTypes")
            ),
        }),
    });

    registerFile({
        name: "trainerTypes",
        file: "trainer_types.json",
        cls: TrainerType,
        schema: T.struct({
            name: T.localized(),
            gender: T.enum("genders").opt("genderless"),
            baseMoney: T.int({ min: 0 }).opt(30),
            skill: T.int({ min: 0 }).opt(0),
            graphic: T.string().opt(""),
            introBGM: T.string().opt(""),
            battleBGM: T.string().opt(""),
            victoryBGM: T.string().opt(""),
            flags: T.flags().opt([]),
        }),
    });

    const ivs = () => T.oneOf([T.int({ min: 0, max: 31 }), T.stats({ max: 31 })]);
    registerFile({
        name: "trainers",
        file: "trainers.json",
        cls: Trainer,
        schema: T.struct({
            trainerType: T.ref("trainerTypes"),
            name: T.localized(),
            version: T.int({ min: 0 }).opt(0),
            items: refList("items"),
            loseText: T.localized().opt(""),
            winText: T.localized().opt(""),
            ai: T.string().opt(""),
            battleType: T.enum("battleTypes").opt("single"),
            gimmicks: T.flags().opt([]),
            pokemon: T.array(
                T.struct({
                    species: T.ref("species"),
                    level: T.int({ min: 1, max: 100 }),
                    moves: refList("moves"),
                    ability: optRef("abilities"),
                    item: optRef("items"),
                    nature: optRef("natures"),
                    gender: T.enum("genders").opt(),
                    shiny: T.bool().opt(false),
                    nickname: T.string().opt(""),
                    ivs: ivs().opt(31),
                    evs: T.stats({ max: 252 }).opt(),
                    friendship: T.int({ min: 0, max: 255 }).opt(),
                    ball: optRef("items"),
                    teraType: optRef("types"),
                    dynamaxLevel: T.int({ min: 0, max: 10 }).opt(),
                    gigantamax: T.bool().opt(false),
                }),
                { min: 1, max: 6 }
            ),
        }),
    });

    registerFile({
        name: "regionalDexes",
        file: "regional_dexes.json",
        cls: RegionalDex,
        schema: T.struct({ name: T.localized(), species: T.array(T.ref("species")) }),
    });

    registerFile({
        name: "ribbons",
        file: "ribbons.json",
        cls: Ribbon,
        schema: T.struct({ name: T.localized(), description: T.localized().opt(""), icon: T.int({ min: 0 }).opt(0), flags: T.flags().opt([]) }),
    });

    registerFile({
        name: "berryPlants",
        file: "berry_plants.json",
        cls: BerryPlant,
        schema: T.struct({
            hoursPerStage: T.int({ min: 1 }).opt(3),
            dryingPerHour: T.int({ min: 0 }).opt(15),
            yield: T.tuple([T.int({ min: 1 }), T.int({ min: 1 })]).opt([2, 5]),
        }),
        link(entry, api) {
            if (!api.registries.items.has(entry.id)) {
                api.error(entry, `no item "${entry.id}" for this berry plant`);
            }
        },
    });

    registerFile({
        name: "townMap",
        file: "town_map.json",
        cls: TownMap,
        schema: T.struct({
            name: T.localized(),
            image: T.string().opt(""),
            pointSize: T.tuple([T.int({ min: 1 }), T.int({ min: 1 })]).opt([16, 16]),
            size: T.tuple([T.int({ min: 1 }), T.int({ min: 1 })]).opt([30, 20]),
            points: T.array(
                T.struct({
                    x: T.int({ min: 0 }),
                    y: T.int({ min: 0 }),
                    name: T.string().opt(""),
                    poi: T.string().opt(""),
                    flyTo: T.mapPoint().opt(),
                    switch: T.int({ min: 0 }).opt(0),
                })
            ).opt([]),
        }),
    });

    registerFile({
        name: "phone",
        file: "phone.json",
        cls: PhoneContact,
        schema: T.struct({ trainer: optRef("trainers"), messages: T.dict(T.array(T.string())).opt({}) }),
    });

    registerFile({
        name: "battleTower",
        file: "battle_tower.json",
        cls: BattleTowerSet,
        schema: T.struct({
            species: T.ref("species"),
            item: optRef("items"),
            nature: optRef("natures"),
            ability: optRef("abilities"),
            moves: T.array(T.ref("moves"), { min: 1, max: 4 }),
            evs: T.flags().opt([]),
        }),
    });

    class TradeData extends PbsData {}
    TradeData.kind = "Trade";

    registerFile({
        name: "trades",
        file: "trades.json",
        cls: TradeData,
        schema: T.struct({
            npcName: T.localized(),
            nickname: T.localized().opt(""),
            wants: T.oneOf([
                T.ref("species"),
                T.struct({ species: T.array(T.ref("species")).opt(), type: T.ref("types").opt(), minLevel: T.int({ min: 1, max: 100 }).opt() }, { unknown: "error" }),
            ]),
            gives: T.struct({
                species: T.ref("species"),
                level: T.int({ min: 1, max: 100 }),
                otName: T.string().opt(""),
                otId: T.int({ min: 0, max: 65535 }).opt(0),
                nature: optRef("natures"),
                gender: T.enum("genders").opt(),
                shiny: T.bool().opt(false),
                ivs: T.oneOf([T.int({ min: 0, max: 31 }), T.stats({ max: 31 })]).opt(),
                moves: T.array(T.ref("moves"), { max: 4 }).opt([]),
                item: optRef("items"),
                ball: optRef("items"),
                abilitySlot: T.string().opt(),
            }),
            once: T.bool().opt(true),
        }),
    });

    //-------------------------------------------------------------------------
    // Two-pass load
    //-------------------------------------------------------------------------

    /**
     * @brief Reads <PBS: id> tags from MZ database items.
     * @param {Array<Object>} dbItems $dataItems.
     * @return {Map<string, number>} PBS ID -> MZ item ID.
     */
    function itemTags(dbItems) {
        const out = new Map();
        for (const item of dbItems || []) {
            const m = item && /<PBS:\s*([^>\s]+)\s*>/i.exec(item.note || "");
            if (m) {
                out.set(toID(m[1]), item.id);
            }
        }
        return out;
    }

    /** @brief Showdown dex tables checked per registry. */
    const SHOWDOWN_TABLES = { species: "species", moves: "moves", abilities: "abilities", items: "items", natures: "natures", types: "types" };

    /**
     * @brief Loads every registered PBS file.
     *
     *        Pass 1 parses and validates each file and registers IDs. Pass 2
     *        resolves the references collected in pass 1 (so files may refer
     *        to each other in any order) and runs cross-file checks.
     *
     * @param {{readText: function(string): Promise<string>}} source Files.
     * @param {Object} [opts] {mapInfos ($dataMapInfos), dbItems ($dataItems),
     *        showdown (a Showdown Dex), specs (default: the registered ones)}.
     * @return {Promise<{registries: Object<string, Registry>, report: Report}>}
     *         Loaded registries and the report.
     */
    async function load(source, opts = {}) {
        const report = new Report();
        const specs = opts.specs || SPECS;
        const registries = {};
        for (const spec of specs) {
            if (!registries[spec.registry]) {
                registries[spec.registry] = new Registry(spec.registry);
            }
        }
        const refs = [];
        const created = [];

        // Async file access: all files are read in parallel.
        const texts = await Promise.all(
            specs.map(spec =>
                Promise.resolve()
                    .then(() => source.readText(spec.file))
                    .then(
                        text => ({ spec, text }),
                        error => ({ spec, error })
                    )
            )
        );

        // Pass 1: parse, validate, register.
        for (const { spec, text, error } of texts) {
            if (error) {
                if (error.code === "ENOENT" || error.status === 404) {
                    report.warn("file not found (treated as empty)", { file: spec.file });
                } else {
                    report.error(`could not read file: ${error.message || error}`, { file: spec.file });
                }
                continue;
            }
            if (!String(text || "").trim()) {
                continue;
            }
            let parsed;
            try {
                parsed = parseJson(text, spec.file);
            } catch (e) {
                if (e instanceof PbsSyntaxError) {
                    report.error(e.detail, { file: e.file, line: e.line, col: e.col });
                    continue;
                }
                throw e;
            }
            const shared = { file: spec.file, locs: parsed.locs, report, refs, opts };
            const root = new Context(shared, "");
            if (!isObject(parsed.value)) {
                root.error(`expected an object keyed by ${spec.key === "mapId" ? "map ID" : "ID"}`);
                continue;
            }
            const registry = registries[spec.registry];
            for (const [rawKey, raw] of Object.entries(parsed.value)) {
                if (rawKey.startsWith("#")) {
                    continue;
                }
                const ctx = root.at(rawKey);
                const keyCtx = new Context(shared, `${ctx.pointer}#key`);
                let id;
                if (spec.key === "mapId") {
                    const n = T.mapId().check(rawKey, keyCtx);
                    if (n === INVALID) {
                        continue;
                    }
                    id = String(n);
                    if (isObject(raw) && typeof raw["#map"] === "string" && opts.mapInfos && opts.mapInfos[n] && opts.mapInfos[n].name !== raw["#map"]) {
                        ctx.at("#map").warn(`map ${n} is now called "${opts.mapInfos[n].name}" in MZ, not "${raw["#map"]}"`);
                    }
                } else {
                    id = toID(rawKey);
                    if (!id) {
                        keyCtx.error(`"${rawKey}" is not a valid ID`);
                        continue;
                    }
                    if (id !== rawKey) {
                        keyCtx.warn(`ID "${rawKey}" is not in Showdown style; using "${id}"`);
                    }
                }
                if (registry.has(id)) {
                    const prev = registry.get(id).source;
                    keyCtx.error(`duplicate ${spec.registry} ID "${id}" (first defined at ${prev.file}:${prev.line})`);
                    continue;
                }
                const value = spec.schema.check(raw, ctx);
                if (value === INVALID) {
                    continue;
                }
                const where = keyCtx.where();
                const entry = new spec.cls(id, value, { file: spec.file, line: where.line, col: where.col, pointer: ctx.pointer });
                Object.defineProperty(entry, "_registry", { value: registry, writable: true });
                Object.defineProperty(entry, "_spec", { value: spec, writable: true });
                registry.add(entry);
                created.push(entry);
            }
        }

        // Pass 2: references.
        for (const ref of refs) {
            const registry = registries[ref.registry];
            if (!registry) {
                report.error(`unknown registry "${ref.registry}"`, ref.where);
                continue;
            }
            if (!registry.has(ref.id)) {
                const s = suggest(ref.id, registry.ids());
                report.error(`unknown ${ref.registry} "${ref.id}"${s ? ` (did you mean "${s}"?)` : ""}`, ref.where);
            }
        }

        // Cross-file links.
        const api = {
            registries,
            report,
            opts,
            error: (entry, msg) => report.error(msg, entry.source),
            warn: (entry, msg) => report.warn(msg, entry.source),
        };
        linkForms(api);
        linkItems(api);
        linkSpecies(api);
        for (const entry of created) {
            if (entry._spec.link) {
                entry._spec.link(entry, api);
            }
        }
        if (opts.showdown) {
            checkShowdown(api, opts.showdown);
        }
        for (const r of Object.values(registries)) {
            r.freeze();
        }
        return { registries, report };
    }

    /** @brief Fills form fields from their base species. */
    function linkForms(api) {
        const species = api.registries.species;
        if (!species) {
            return;
        }
        const inherited = Object.keys(speciesFields(false)).filter(k => !["name", "formName", "genus", "dexEntry", "num", "custom"].includes(k));
        for (const form of species) {
            if (!form.baseSpecies) {
                continue;
            }
            const base = species.tryGet(form.baseSpecies);
            if (!base) {
                continue;
            }
            if (base.baseSpecies) {
                api.error(form, `base species "${base.id}" is itself a form`);
                continue;
            }
            for (const key of inherited) {
                if (form[key] === undefined) {
                    form[key] = clone(base[key]);
                }
            }
            if (!form.num) {
                form.num = base.num;
            }
            if (!form.folder) {
                form.folder = toID(form.forme);
            }
        }
    }

    /** @brief Links PBS items with MZ database items (<PBS: id> tags). */
    function linkItems(api) {
        const items = api.registries.items;
        if (!items || !api.opts.dbItems) {
            return;
        }
        const tags = itemTags(api.opts.dbItems);
        for (const [id, dbId] of tags) {
            const item = items.tryGet(id);
            if (!item) {
                const s = suggest(id, items.ids());
                api.report.warn(`<PBS: ${id}> in MZ item ${dbId} does not match a PBS item${s ? ` (did you mean "${s}"?)` : ""}`, { file: "Items.json" });
                continue;
            }
            item.dbItemId = dbId;
        }
        let unlinked = 0;
        for (const item of items) {
            if (!item.dbItemId) {
                unlinked++;
            }
        }
        if (unlinked) {
            api.report.warn(`${unlinked} PBS item(s) have no MZ database entry; run "npm run pbs items" to create them`, { file: "items.json" });
        }
    }

    /** @brief Species cross checks and derived data (prevolutions). */
    function linkSpecies(api) {
        const species = api.registries.species;
        if (!species) {
            return;
        }
        for (const s of species) {
            for (const evo of s.evolutions || []) {
                const target = species.tryGet(evo.species);
                if (target && !target.prevo) {
                    target.prevo = s.id;
                }
            }
            if (!s.types || !s.types.length) {
                api.error(s, "a species needs at least one type");
            }
        }
        const types = api.registries.types;
        if (types) {
            for (const t of types) {
                t._registry = types;
            }
        }
    }

    /** @brief Warns about IDs that Showdown doesn't know. */
    function checkShowdown(api, dex) {
        for (const [name, table] of Object.entries(SHOWDOWN_TABLES)) {
            const registry = api.registries[name];
            if (!registry || !dex[table]) {
                continue;
            }
            for (const entry of registry) {
                if (entry.custom || (name === "items" && !entry.showdown)) {
                    continue;
                }
                const found = dex[table].get(entry.id);
                if (!found || !found.exists) {
                    api.warn(entry, `"${entry.id}" is not a Showdown ${name} ID; mark it "custom": true if it is new`);
                }
            }
        }
    }

    //-------------------------------------------------------------------------
    // File sources
    //-------------------------------------------------------------------------

    /**
     * @brief Reads files with Node's fs.promises (NW.js, tools, tests).
     */
    class NodeFileSource {
        /**
         * @param {string} dir Folder.
         */
        constructor(dir) {
            this.dir = dir;
        }

        /** @return {Promise<string>} File text. */
        readText(name) {
            const fs = require("fs");
            const path = require("path");
            return fs.promises.readFile(path.join(this.dir, name), "utf8");
        }
    }

    /**
     * @brief Reads files over XHR (browsers and NW.js).
     */
    class XhrFileSource {
        /**
         * @param {string} dir URL folder.
         */
        constructor(dir) {
            this.dir = dir.endsWith("/") ? dir : `${dir}/`;
        }

        /** @return {Promise<string>} File text. */
        readText(name) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open("GET", `${this.dir}${name}?_=${Date.now()}`);
                xhr.overrideMimeType("text/plain; charset=utf-8");
                xhr.onload = () => {
                    if (xhr.status < 400) {
                        resolve(xhr.responseText);
                    } else {
                        const err = new Error(`HTTP ${xhr.status}`);
                        err.status = xhr.status;
                        reject(err);
                    }
                };
                xhr.onerror = () => {
                    const err = new Error("not found");
                    err.status = 404;
                    reject(err);
                };
                xhr.send();
            });
        }
    }

    /**
     * @brief A source over an in-memory {file: text} object (tests, tools).
     */
    class MemoryFileSource {
        /** @param {Object<string, string>} files Files. */
        constructor(files) {
            this.files = files;
        }

        /** @return {Promise<string>} File text. */
        readText(name) {
            if (!(name in this.files)) {
                const err = new Error("not found");
                err.code = "ENOENT";
                return Promise.reject(err);
            }
            return Promise.resolve(this.files[name]);
        }
    }

    const Engine = {
        toID,
        parseJson,
        PbsSyntaxError,
        Report,
        suggest,
        enums,
        T,
        INVALID,
        Context,
        Type,
        PbsData,
        Registry,
        classes: {
            TypeData,
            NatureData,
            AbilityData,
            MoveData,
            ItemData,
            SpeciesData,
            MetricsData,
            MapMetadata,
            MapConnection,
            EncounterTable,
            TrainerType,
            Trainer,
            RegionalDex,
            Ribbon,
            BerryPlant,
            TownMap,
            PhoneContact,
            BattleTowerSet,
            TradeData,
        },
        STATS,
        specs: SPECS,
        registerFile,
        extendSchema,
        itemTags,
        load,
        NodeFileSource,
        XhrFileSource,
        MemoryFileSource,
        /** @brief Sets the translator used by localized fields. */
        setTranslator(fn) {
            translator = fn || ((key, fallback) => fallback);
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

    const PLUGIN_NAME = "PokeMZ_PBS_Core";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const CONFIG = {
        folder: String(params.folder || "data/pbs/"),
        showdownCheck: params.showdownCheck !== "false",
        warningsInRelease: params.warningsInRelease === "true",
        hotReload: params.hotReload !== "false",
    };

    const isTest = () => Utils.isOptionValid("test");

    /** @return {Object} A file source for this platform. */
    function makeSource() {
        if (Utils.isNwjs()) {
            const path = require("path");
            const base = path.dirname(process.mainModule.filename);
            return new NodeFileSource(path.join(base, CONFIG.folder));
        }
        return new XhrFileSource(CONFIG.folder);
    }

    // Localized fields go through PokeMZ_Locale when it is enabled.
    Engine.setTranslator((key, fallback) => {
        const L = window.PokeMZ && window.PokeMZ.L10n;
        if (L && L.has && L.has(key)) {
            return L.t(key, null, fallback);
        }
        return fallback;
    });

    const state = {
        phase: "idle", // idle -> loading -> ready | failed
        registries: {},
        report: new Report(),
        listeners: [],
        loadingPromise: null,
    };

    /**
     * @brief Runs the two-pass load with MZ's map infos and items.
     * @return {Promise<{registries, report}>} Result.
     */
    function loadNow() {
        return load(makeSource(), {
            mapInfos: window.$dataMapInfos,
            dbItems: window.$dataItems,
            showdown: CONFIG.showdownCheck && window.PSSim && window.PSSim.Dex ? window.PSSim.Dex : null,
        });
    }

    /** @brief Attaches PBS IDs to linked MZ items ($dataItems[n].pbs). */
    function attachDbItems(registries) {
        if (!window.$dataItems || !registries.items) {
            return;
        }
        for (const db of $dataItems) {
            if (db) {
                delete db.pbs;
            }
        }
        for (const item of registries.items) {
            if (item.dbItemId && $dataItems[item.dbItemId]) {
                $dataItems[item.dbItemId].pbs = item.id;
            }
        }
    }

    /** @brief Prints the report to the console (grouped). */
    function logReport(report, title) {
        if (!report.entries.length || (!isTest() && !CONFIG.warningsInRelease && !report.hasErrors())) {
            return;
        }
        const head = `[PokeMZ.PBS] ${title}: ${report.summary()}`;
        if (console.groupCollapsed) {
            console[report.hasErrors() ? "group" : "groupCollapsed"](head);
            for (const e of report.errors) {
                console.error(Report.format(e));
            }
            for (const e of report.warnings) {
                console.warn(Report.format(e));
            }
            console.groupEnd();
        } else {
            console.log(`${head}\n${report.toString()}`);
        }
    }

    /** @brief Shows a blocking error on boot. */
    function failBoot(report) {
        state.phase = "failed";
        const lines = report.errors.slice(0, isTest() ? 20 : 3).map(Report.format);
        const more = report.errors.length > lines.length ? `<br>... ${report.errors.length - lines.length} more (see console)` : "";
        const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        Graphics.printError("PBS data errors", lines.map(esc).join("<br>") + more);
        SceneManager.stop();
    }

    /** @brief Starts the boot load once MZ's database is in memory. */
    function startBootLoad() {
        state.phase = "loading";
        state.loadingPromise = loadNow().then(
            ({ registries, report }) => {
                state.report = report;
                logReport(report, "loaded");
                if (report.hasErrors()) {
                    failBoot(report);
                    return;
                }
                state.registries = registries;
                attachDbItems(registries);
                state.phase = "ready";
            },
            error => {
                console.error(error);
                state.report = new Report();
                state.report.error(`PBS load crashed: ${error.message}`);
                failBoot(state.report);
            }
        );
    }

    const _isDatabaseLoaded = DataManager.isDatabaseLoaded;
    DataManager.isDatabaseLoaded = function() {
        if (!_isDatabaseLoaded.apply(this, arguments)) {
            return false;
        }
        if (state.phase === "idle") {
            startBootLoad();
        }
        return state.phase === "ready";
    };

    /**
     * @brief Reloads every file (playtest). The new data replaces the old only
     *        if it has no errors.
     * @return {Promise<boolean>} True if the new data was applied.
     */
    async function reload() {
        const { registries, report } = await loadNow();
        logReport(report, "reloaded");
        state.report = report;
        if (report.hasErrors()) {
            const msg = `PBS reload failed: ${report.errors.length} error(s); keeping the old data`;
            console.warn(msg);
            if (window.PokeMZ.UI && window.PokeMZ.UI.toast) {
                window.PokeMZ.UI.toast(msg, 240);
            }
            return false;
        }
        state.registries = registries;
        attachDbItems(registries);
        for (const fn of state.listeners) {
            try {
                fn(registries);
            } catch (e) {
                console.error(e);
            }
        }
        if (window.PokeMZ.UI && window.PokeMZ.UI.toast) {
            window.PokeMZ.UI.toast(`PBS reloaded (${report.summary()})`, 120);
        }
        return true;
    }

    /** @brief Watches the PBS folder and hooks the UI hot reload key. */
    function setupHotReload() {
        if (!CONFIG.hotReload || !isTest()) {
            return;
        }
        let timer = null;
        const schedule = () => {
            clearTimeout(timer);
            timer = setTimeout(() => state.phase === "ready" && reload(), 300);
        };
        if (Utils.isNwjs()) {
            try {
                const fs = require("fs");
                const path = require("path");
                const dir = path.join(path.dirname(process.mainModule.filename), CONFIG.folder);
                fs.watch(dir, (event, file) => file && file.endsWith(".json") && schedule());
            } catch (e) {
                console.warn("[PokeMZ.PBS] hot reload watcher unavailable:", e);
            }
        }
        const UI = window.PokeMZ && window.PokeMZ.UI;
        if (UI && UI.dev && typeof UI.dev.reload === "function") {
            const orig = UI.dev.reload;
            UI.dev.reload = function() {
                const r = orig.apply(this, arguments);
                schedule();
                return r;
            };
        }
    }

    window.PokeMZ = window.PokeMZ || {};
    const PBS = Object.assign(Object.create(null), Engine, {
        config: CONFIG,
        /** @return {boolean} True once the data is loaded. */
        isReady: () => state.phase === "ready",
        /** @return {Report} The last load report. */
        report: () => {
            console.log(state.report.toString() || "No PBS errors or warnings.");
            return state.report;
        },
        reload,
        /** @brief Adds a hot reload listener: fn(registries). */
        onReload: fn => state.listeners.push(fn),
    });
    Object.defineProperty(PBS, "registries", { get: () => state.registries, enumerable: true });

    // Registry shortcuts (always the current data, also after a reload).
    for (const spec of SPECS) {
        if (!Object.getOwnPropertyDescriptor(PBS, spec.registry)) {
            Object.defineProperty(PBS, spec.registry, {
                get: () => state.registries[spec.registry] || new Registry(spec.registry),
                enumerable: true,
            });
        }
    }

    /**
     * @brief Registers a file after the shortcuts were made (other plugins).
     */
    PBS.registerFile = spec => {
        const s = registerFile(spec);
        if (!Object.getOwnPropertyDescriptor(PBS, s.registry)) {
            Object.defineProperty(PBS, s.registry, {
                get: () => state.registries[s.registry] || new Registry(s.registry),
                enumerable: true,
            });
        }
        return s;
    };

    // Convenience lookups.
    PBS.speciesByNum = n => (state.registries.species ? state.registries.species.lookup("num", s => (s.baseSpecies ? undefined : s.num), n)[0] || null : null);
    PBS.itemForDb = dbItem => {
        const id = dbItem && (typeof dbItem === "object" ? dbItem.pbs : $dataItems[dbItem] && $dataItems[dbItem].pbs);
        return id && state.registries.items ? state.registries.items.tryGet(id) : null;
    };
    PBS.mapMetadataFor = mapId => (state.registries.mapMetadata ? state.registries.mapMetadata.tryGet(mapId) : null);
    PBS.encountersFor = mapId => (state.registries.encounters ? state.registries.encounters.tryGet(mapId) : null);

    window.PokeMZ.PBS = PBS;
    setupHotReload();
})();
