#!/usr/bin/env node
//=============================================================================
// PokéMZ - tools/l10n.js
//=============================================================================

/**
 * @file Localization command line tool (Node, no dependencies).
 *
 *   node tools/l10n.js extract [--dry-run]   Key event text and copy game text
 *                                            into data/locales/*.csv
 *   node tools/l10n.js check                 Validate the string tables
 *   node tools/l10n.js stats                 Translation coverage
 *
 * Options: --root <dir> (project folder, default: the repository).
 * Close the RPG Maker editor before running extract: it rewrites map files.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Engine = require("../js/plugins/PokeMZ_Locale.js");

const SPECIAL_FILES = new Set(["languages.csv", "keyboards.csv"]);

//=============================================================================
// Files
//=============================================================================

/**
 * @brief Serializes data the way the RPG Maker MZ editor does (one database
 *        entry or map event per line), so diffs stay small.
 * @param {string} file File name.
 * @param {*} data Parsed JSON.
 * @return {string} JSON text.
 */
function writeMzJson(file, data) {
    if (/^Map\d+\.json$/.test(file)) {
        const { data: tiles, events, ...rest } = data;
        const list = events.length ? `${events.map(e => JSON.stringify(e)).join(",\n")}\n` : "";
        return `{\n${JSON.stringify(rest).slice(1, -1)},\n"data":${JSON.stringify(tiles)},\n"events":[\n${list}]\n}`;
    }
    if (Array.isArray(data)) {
        return `[\n${data.map(e => JSON.stringify(e)).join(",\n")}\n]`;
    }
    return JSON.stringify(data);
}

/**
 * @brief An editable CSV string table that keeps column and row order.
 */
class Table {
    /**
     * @param {string} file Path.
     * @param {string} [text] CSV text (default: read the file, or a new table).
     * @param {Array<string>} [defaultHeader] Header for a new file.
     */
    constructor(file, text, defaultHeader) {
        this.file = file;
        const rows = Engine.parseCsv(text !== undefined ? text : fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
        this.header = rows.shift() || defaultHeader.slice();
        this.rows = rows;
        this.index = new Map();
        rows.forEach((r, i) => r[0] && this.index.set(r[0].trim(), i));
        this.changed = false;
    }

    /**
     * @brief Column index by name (case-insensitive), adding it if asked.
     * @param {string} name Column name.
     * @param {boolean} [add] Add when missing.
     * @return {number} Index, or -1.
     */
    col(name, add) {
        let i = this.header.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
        if (i < 0 && add) {
            this.header.push(name);
            i = this.header.length - 1;
            this.changed = true;
        }
        return i;
    }

    /** @return {Array<string>|undefined} The row for a key. */
    row(key) {
        const i = this.index.get(key);
        return i === undefined ? undefined : this.rows[i];
    }

    /**
     * @brief Sets the source text of a key. When it changes and the row has
     *        translations, the row is marked #Stale.
     * @param {string} key Stable ID.
     * @param {string} text Source text.
     * @param {string} source Source language column.
     * @param {Object} [notes] Note columns to set, e.g. {Context: "..."}.
     */
    setSource(key, text, source, notes = {}) {
        const srcCol = this.col(source, true);
        let row = this.row(key);
        if (!row) {
            row = [key];
            this.index.set(key, this.rows.length);
            this.rows.push(row);
            this.changed = true;
        }
        const old = row[srcCol] || "";
        if (old !== text) {
            const translated = this.header.some((h, i) => i > 0 && i !== srcCol && !h.startsWith("#") && row[i]);
            if (old && translated) {
                row[this.col("#Stale", true)] = "yes";
            }
            row[srcCol] = text;
            this.changed = true;
        }
        for (const [name, value] of Object.entries(notes)) {
            const c = this.col(`#${name}`, true);
            if ((row[c] || "") !== value) {
                row[c] = value;
                this.changed = true;
            }
        }
    }

    /** @return {string} CSV text with every row padded to the header. */
    toString() {
        const width = this.header.length;
        const pad = r => r.concat(new Array(Math.max(0, width - r.length)).fill("")).slice(0, Math.max(width, r.length));
        return Engine.writeCsv([this.header].concat(this.rows.map(pad)));
    }
}

/**
 * @brief Loads every string table into an engine.
 * @param {string} root Project folder.
 * @return {Object} Engine.
 */
function loadEngine(root) {
    const dir = path.join(root, "data/locales");
    const engine = Engine.createEngine();
    const read = f => fs.readFileSync(path.join(dir, f), "utf8");
    if (fs.existsSync(path.join(dir, "languages.csv"))) {
        engine.setLanguagesCsv(read("languages.csv"));
    }
    if (fs.existsSync(path.join(dir, "keyboards.csv"))) {
        engine.setKeyboardsCsv(read("keyboards.csv"));
    }
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith(".csv") && !SPECIAL_FILES.has(n)).sort()) {
        engine.addCsv(read(f), f);
    }
    return engine;
}

//=============================================================================
// extract
//=============================================================================

/**
 * @brief Finds the <L10n: id> comment right above list[index] (same logic as
 *        the runtime plugin).
 * @return {{id: string, at: number}|null} The ID and the comment's index.
 */
function findId(list, index) {
    const indent = list[index].indent;
    let i = index - 1;
    const lines = [];
    while (i >= 0 && list[i].code === 408 && list[i].indent === indent) {
        lines.unshift(list[i].parameters[0]);
        i--;
    }
    if (i < 0 || list[i].code !== 108 || list[i].indent !== indent) {
        return null;
    }
    lines.unshift(list[i].parameters[0]);
    const m = /<L10n:\s*([^>\s]+)\s*>/i.exec(lines.join("\n"));
    return m ? { id: m[1], at: i } : null;
}

/**
 * @brief Keys every Show Text, Show Choices and Scrolling Text in a command
 *        list and collects their text.
 * @param {Array} list Event commands (modified in place).
 * @param {string} context Location for translators, e.g. "Map003 EV002 p1".
 * @param {Object} st Shared state {ids: Map, taken: Set, rows: Array, newId()}.
 * @return {boolean} True when the list was changed.
 */
function extractList(list, context, st) {
    let changed = false;
    for (let i = 0; i < list.length; i++) {
        const cmd = list[i];
        const prev = list[i - 1];
        const standaloneChoices = cmd.code === 102 && !(prev && (prev.code === 401 || prev.code === 101) && prev.indent === cmd.indent);
        if (cmd.code !== 101 && cmd.code !== 105 && !standaloneChoices) {
            continue;
        }
        const entries = [];
        let j = i + 1;
        if (cmd.code === 101 || cmd.code === 105) {
            const lineCode = cmd.code === 101 ? 401 : 405;
            const lines = [];
            while (j < list.length && list[j].code === lineCode) {
                lines.push(list[j].parameters[0]);
                j++;
            }
            entries.push(["", lines.join("\n")]);
            if (cmd.code === 101 && cmd.parameters[4]) {
                entries.push([".Speaker", cmd.parameters[4]]);
            }
        }
        const choiceCmd = cmd.code === 102 ? cmd : cmd.code === 101 && list[j] && list[j].code === 102 && list[j].indent === cmd.indent ? list[j] : null;
        if (choiceCmd) {
            choiceCmd.parameters[0].forEach((c, k) => entries.push([`.Choice${k + 1}`, c]));
        }
        const signature = JSON.stringify(entries);
        let found = findId(list, i);
        // A copied event keeps its comment: give a different text a new ID.
        if (found && st.ids.has(found.id) && st.ids.get(found.id) !== signature) {
            const id = st.newId();
            list[found.at] = { code: 108, indent: cmd.indent, parameters: [`<L10n: ${id}>`] };
            const extra = i - found.at - 1; // continuation lines of the old comment
            list.splice(found.at + 1, extra);
            i -= extra;
            found = { id, at: found.at };
            changed = true;
        }
        if (!found) {
            const id = st.newId();
            list.splice(i, 0, { code: 108, indent: cmd.indent, parameters: [`<L10n: ${id}>`] });
            i++;
            found = { id, at: i - 1 };
            changed = true;
        }
        st.ids.set(found.id, signature);
        for (const [suffix, text] of entries) {
            st.rows.push([found.id + suffix, text, context]);
        }
    }
    return changed;
}

/**
 * @brief Database and system fields, using the same keys as the runtime.
 * @param {string} root Project folder.
 * @return {Array<[string, string, string]>} Rows [key, text, context].
 */
function databaseRows(root) {
    const rows = [];
    const read = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
    const capital = s => s[0].toUpperCase() + s.slice(1);
    const noteKey = note => {
        const m = /<L10n:\s*([^>\s]+)\s*>/i.exec(note || "");
        return m ? m[1] : null;
    };
    const DB = [
        ["Actors.json", "Actor", ["name", "nickname", "profile"]],
        ["Classes.json", "Class", ["name"]],
        ["Skills.json", "Skill", ["name", "description", "message1", "message2"]],
        ["Items.json", "Item", ["name", "description"]],
        ["Weapons.json", "Weapon", ["name", "description"]],
        ["Armors.json", "Armor", ["name", "description"]],
        ["Enemies.json", "Enemy", ["name"]],
        ["States.json", "State", ["name", "message1", "message2", "message3", "message4"]],
    ];
    for (const [file, type, fields] of DB) {
        if (!fs.existsSync(path.join(root, "data", file))) {
            continue;
        }
        for (const obj of read(file)) {
            if (!obj) {
                continue;
            }
            const base = noteKey(obj.note) || `Db.${type}.${obj.id}`;
            for (const f of fields) {
                if (typeof obj[f] === "string" && obj[f]) {
                    rows.push([`${base}.${capital(f)}`, obj[f], `${type} ${obj.id}`]);
                }
            }
        }
    }
    const sys = read("System.json");
    rows.push(["System.GameTitle", sys.gameTitle, "System"]);
    rows.push(["System.CurrencyUnit", sys.currencyUnit, "System"]);
    for (const f of ["elements", "skillTypes", "weaponTypes", "armorTypes", "equipTypes"]) {
        sys[f].forEach((v, i) => v && rows.push([`System.${capital(f)}.${i}`, v, "System"]));
    }
    for (const f of ["basic", "commands", "params"]) {
        sys.terms[f].forEach((v, i) => v && rows.push([`System.Terms.${capital(f)}.${i}`, v, "System"]));
    }
    for (const [k, v] of Object.entries(sys.terms.messages)) {
        if (v) {
            rows.push([`System.Terms.Messages.${k}`, v, "System"]);
        }
    }
    return rows;
}

/**
 * @brief Keys event text and updates dialogue.csv and database.csv.
 * @param {string} root Project folder.
 * @param {boolean} dryRun Report without writing.
 * @return {Object} Summary.
 */
function extract(root, dryRun) {
    const dataDir = path.join(root, "data");
    const locDir = path.join(dataDir, "locales");
    const engine = loadEngine(root);
    const source = engine.source;
    const header = ["Key"].concat(engine.languages().length ? engine.languages() : [source]);
    const taken = new Set(engine.entries.keys());
    const st = {
        ids: new Map(),
        rows: [],
        newId() {
            let id;
            do {
                id = `Dlg.${crypto.randomBytes(4).readUInt32BE(0).toString(36).padStart(6, "0").slice(-6)}`;
            } while (taken.has(id) || this.ids.has(id));
            taken.add(id);
            return id;
        },
    };

    const writes = [];
    const mapRows = [];
    const mapFiles = fs.readdirSync(dataDir).filter(f => /^Map\d+\.json$/.test(f)).sort();
    for (const file of mapFiles) {
        const map = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
        const mapId = Number(/\d+/.exec(file)[0]);
        const name = file.replace(".json", "");
        let changed = false;
        for (const ev of map.events) {
            if (!ev) {
                continue;
            }
            ev.pages.forEach((page, p) => {
                changed = extractList(page.list, `${name} EV${String(ev.id).padStart(3, "0")} ${ev.name} p${p + 1}`, st) || changed;
            });
        }
        if (map.displayName) {
            const m = /<L10n:\s*([^>\s]+)\s*>/i.exec(map.note || "");
            mapRows.push([`${m ? m[1] : `Map.${mapId}`}.DisplayName`, map.displayName, name]);
        }
        if (changed) {
            writes.push([file, map]);
        }
    }
    const common = JSON.parse(fs.readFileSync(path.join(dataDir, "CommonEvents.json"), "utf8"));
    let commonChanged = false;
    for (const ce of common) {
        if (ce) {
            commonChanged = extractList(ce.list, `CommonEvent ${ce.id} ${ce.name}`, st) || commonChanged;
        }
    }
    if (commonChanged) {
        writes.push(["CommonEvents.json", common]);
    }
    const troops = JSON.parse(fs.readFileSync(path.join(dataDir, "Troops.json"), "utf8"));
    let troopsChanged = false;
    for (const tr of troops) {
        if (tr) {
            tr.pages.forEach((page, p) => {
                troopsChanged = extractList(page.list, `Troop ${tr.id} ${tr.name} p${p + 1}`, st) || troopsChanged;
            });
        }
    }
    if (troopsChanged) {
        writes.push(["Troops.json", troops]);
    }

    const dialogue = new Table(path.join(locDir, "dialogue.csv"), undefined, header);
    const seen = new Set();
    for (const [key, text, context] of st.rows) {
        seen.add(key);
        dialogue.setSource(key, text, source, { Context: context });
    }
    // Keep translations of removed text, but say so.
    for (const row of dialogue.rows) {
        const key = (row[0] || "").trim();
        if (key.startsWith("Dlg.") && !seen.has(key)) {
            const c = dialogue.col("#Context", true);
            if (row[c] !== "(unused)") {
                row[c] = "(unused)";
                dialogue.changed = true;
            }
        }
    }

    const database = new Table(path.join(locDir, "database.csv"), undefined, header);
    for (const [key, text, context] of databaseRows(root).concat(mapRows)) {
        database.setSource(key, text, source, { Context: context });
    }

    const summary = {
        keyed: st.rows.length,
        files: writes.map(w => w[0]),
        dialogueChanged: dialogue.changed,
        databaseChanged: database.changed,
    };
    if (!dryRun) {
        for (const [file, data] of writes) {
            fs.writeFileSync(path.join(dataDir, file), writeMzJson(file, data));
        }
        for (const table of [dialogue, database]) {
            if (table.changed || !fs.existsSync(table.file)) {
                fs.writeFileSync(table.file, table.toString());
            }
        }
    }
    return summary;
}

//=============================================================================
// CLI
//=============================================================================

/**
 * @brief Runs the tool.
 * @param {Array<string>} argv Arguments after the script name.
 * @return {number} Exit code.
 */
function main(argv) {
    const args = argv.slice();
    let root = path.join(__dirname, "..");
    const r = args.indexOf("--root");
    if (r >= 0) {
        root = path.resolve(args[r + 1]);
        args.splice(r, 2);
    }
    const dryRun = args.includes("--dry-run");
    const cmd = args.find(a => !a.startsWith("--")) || "help";

    if (cmd === "extract") {
        const s = extract(root, dryRun);
        console.log(`${dryRun ? "[dry run] " : ""}${s.keyed} dialogue entries; event files changed: ${s.files.join(", ") || "none"}`);
        console.log(`dialogue.csv ${s.dialogueChanged ? "updated" : "unchanged"}, database.csv ${s.databaseChanged ? "updated" : "unchanged"}`);
        return 0;
    }
    if (cmd === "check") {
        const { errors, warnings } = loadEngine(root).check();
        warnings.forEach(w => console.warn(`warning: ${w}`));
        errors.forEach(e => console.error(`error: ${e}`));
        console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
        return errors.length ? 1 : 0;
    }
    if (cmd === "stats") {
        const engine = loadEngine(root);
        const stats = engine.stats();
        for (const [lang, { done, total }] of Object.entries(stats)) {
            const pct = total ? Math.floor((done / total) * 100) : 100;
            console.log(`${lang.padEnd(8)} ${String(pct).padStart(3)}%  ${done}/${total}`);
        }
        return 0;
    }
    console.log("usage: node tools/l10n.js <extract [--dry-run] | check | stats> [--root <dir>]");
    return cmd === "help" ? 0 : 1;
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { extract, extractList, findId, writeMzJson, Table, loadEngine, databaseRows, main };
