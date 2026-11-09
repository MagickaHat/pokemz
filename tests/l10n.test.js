//=============================================================================
// PokéMZ - tests for the localization engine and tools (node --test)
//=============================================================================

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const E = require("../js/plugins/PokeMZ_Locale.js");
const tool = require("../tools/l10n.js");

/**
 * @brief Builds an engine with three languages and a few strings.
 * @return {Object} Engine.
 */
function makeEngine() {
    const e = E.createEngine();
    e.setLanguagesCsv(
        [
            "Key,en,fr,es-es,es-mx",
            "Name,English,Français,Español,Español (Latinoamérica)",
            "Intl,en-US,fr-FR,es-ES,es-MX",
            "Fallback,,,es-mx,es-es",
            "Keyboard,qwerty,azerty,qwerty,qwerty",
        ].join("\n")
    );
    e.addCsv(
        [
            "Key,en,fr,es-es,es-mx,#Note",
            'Bag.Count,"{n, plural, one {# item} other {# items}}","{n, plural, one {# objet} other {# objets}}",,"{n, plural, one {# objeto} other {# objetos}}",count',
            "Got,\\N[1] got {item}!,\\N[1] a obtenu {item} !,,",
            "Only.En,Hello,,,",
        ].join("\n"),
        "t.csv"
    );
    return e;
}

test("CSV: quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const rows = E.parseCsv('﻿Key,en\r\nA,"x, ""y""\nz"\r\n\r\nB,plain');
    assert.deepEqual(rows, [["Key", "en"], ["A", 'x, "y"\nz'], ["B", "plain"]]);
    assert.equal(E.writeCsv(rows), 'Key,en\nA,"x, ""y""\nz"\nB,plain\n');
});

test("lookup follows the fallback chain and reports misses", () => {
    const e = makeEngine();
    e.language = "es-es";
    assert.deepEqual(e.chain(), ["es-es", "es-mx", "en"]);
    assert.equal(e.t("Bag.Count", { n: 2 }), "2 objetos");
    assert.equal(e.t("Only.En"), "Hello");
    assert.equal(e.t("Nope"), "⟦Nope⟧");
    assert.equal(e.t("Nope", null, "Fallback {x}"), "Fallback {x}");
    assert.ok([...e.missing.keys()].some(k => k.endsWith("Nope")));
    assert.ok([...e.fallbackHits.keys()].some(k => k.endsWith("Only.En")));
});

test("language resolution: exact, base language, auto", () => {
    const e = makeEngine();
    assert.equal(e.resolve("FR"), "fr");
    assert.equal(e.resolve("auto", ["fr-CA", "en"]), "fr");
    assert.equal(e.resolve("es"), "es-es");
    assert.equal(e.resolve("de"), "en");
    assert.equal(e.resolve("qps-accent"), "qps-accent");
});

test("ICU: plural, selectordinal, select, number, exact matches, offset", () => {
    const e = makeEngine();
    assert.equal(e.t("Bag.Count", { n: 1 }), "1 item");
    assert.equal(e.t("Bag.Count", { n: 1234 }), "1,234 items");
    e.language = "fr";
    assert.equal(e.t("Bag.Count", { n: 1 }), "1 objet");
    assert.match(e.t("Bag.Count", { n: 1234 }), /^1\s234 objets$/);
    e.language = "en";
    const ord = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
    assert.deepEqual([1, 2, 3, 4, 11, 22].map(n => e.format(ord, { n })), ["1st", "2nd", "3rd", "4th", "11th", "22nd"]);
    assert.equal(e.format("{g, select, female {She} male {He} other {They}} won", { g: "female" }), "She won");
    assert.equal(e.format("{g, select, female {She} other {They}} won", { g: "x" }), "They won");
    assert.equal(e.format("{n, plural, =0 {none} one {one} other {#}}", { n: 0 }), "none");
    assert.equal(e.format("{n, plural, offset:1 =1 {you} one {you and # other} other {you and # others}}", { n: 3 }), "you and 2 others");
    assert.equal(e.format("{p, number, percent}", { p: 0.5 }), "50%");
    assert.equal(e.format("{x, number, .00}", { x: 2 }), "2.00");
});

test("ICU: apostrophes and malformed messages", () => {
    const e = makeEngine();
    assert.equal(e.format("l'objet de {who}", { who: "Red" }), "l'objet de Red");
    assert.equal(e.format("'{literal}' and it''s"), "{literal} and it's");
    assert.throws(() => E.parseMessage("{n, plural, one {x}}"), /other/);
    assert.throws(() => E.parseMessage("oops }"), SyntaxError);
});

test("legacy %1 arguments still work", () => {
    const e = makeEngine();
    assert.equal(e.format("%1 used %2!", ["Red", "Potion"]), "Red used Potion!");
});

test("escape codes are protected from message syntax and from arguments", () => {
    const e = makeEngine();
    // \{ and \} are MZ codes, not ICU braces.
    assert.equal(e.format("\\{BIG\\} {x}", { x: 1 }), "\\{BIG\\} 1");
    // Values can't inject codes: backslashes are doubled.
    e.language = "fr";
    assert.equal(e.t("Got", { item: "\\C[2]Evil" }), "\\N[1] a obtenu \\\\C[2]Evil !");
    assert.deepEqual(E.escapeCodes("\\n[1] \\\\ \\C[2] \\{ \\. \\PX[4]"), ["\\N[1]", "\\C[2]", "\\{", "\\.", "\\PX[4]"]);
});

test("check() catches code, placeholder and syntax problems", () => {
    const e = makeEngine();
    e.addCsv(
        [
            "Key,en,fr,#Stale",
            "Bad.Codes,\\N[1] hi,salut,",
            "Bad.Arg,Hi {name},Salut {nom},",
            "Bad.Syntax,ok,{oops,",
            "Dropped,{n} items,des objets,",
            "Old,new text,ancien,yes",
            "Bag.Count,dupe,,",
        ].join("\n"),
        "bad.csv"
    );
    const { errors, warnings } = e.check();
    const has = (list, re) => assert.ok(list.some(x => re.test(x)), `${re} in ${list.join("\n")}`);
    has(errors, /Bad\.Codes.*escape codes differ/);
    has(errors, /Bad\.Arg.*\{nom\}/);
    has(errors, /Bad\.Syntax/);
    has(errors, /duplicate key "Bag\.Count"/);
    has(warnings, /Dropped.*doesn't use \{n\}/);
    has(warnings, /Old.*source changed/);
});

test("pseudo-locales", () => {
    const e = makeEngine();
    e.language = "qps-accent";
    const out = e.t("Got", { item: "Potion" });
    assert.match(out, /^\[\\N\[1\] ĝöţ Þöţîöñ! ~+\]$/);
    e.language = "qps-keys";
    assert.equal(e.t("Got"), "⟦Got⟧");
});

test("locale-aware formatting and sorting", () => {
    const e = makeEngine();
    assert.equal(e.formatList(["A", "B", "C"]), "A, B, and C");
    e.language = "fr";
    assert.equal(e.formatList(["A", "B", "C"]), "A, B et C");
    assert.equal(e.formatPlayTime(3725), "1:02:05");
    assert.deepEqual(e.sortBy(["Zubat", "Élekid", "abra", "Eevee", "Item 10", "Item 9"], x => x), ["abra", "Eevee", "Élekid", "Item 9", "Item 10", "Zubat"]);
    e.language = "en";
    assert.equal(e.formatPercent(0.255, 1), "25.5%");
});

test("graphemes: combining marks, emoji sequences, flags, Hangul", () => {
    assert.deepEqual(E.graphemes("éa"), ["é", "a"]);
    assert.deepEqual(E.graphemes("👨‍👩‍👧🇫🇷x"), ["👨‍👩‍👧", "🇫🇷", "x"]);
    assert.deepEqual(E.graphemes("각"), ["각"]);
});

/** @brief Width = number of visible graphemes (codes are zero-width). */
const measure = s => E.graphemes(s.replace(/\x1b(?:[A-Z]+(?:\[[^\]]*\])?|[$.|^!><{}])/gi, "")).length;

test("wrap: spaces, long words, hyphens, NBSP, existing breaks, codes", () => {
    assert.equal(E.wrap("The quick brown fox jumps", 10, measure), "The quick\nbrown fox\njumps");
    assert.equal(E.wrap("Supercalifragilistic", 8, measure), "Supercal\nifragili\nstic");
    assert.equal(E.wrap("well-known thing", 6, measure), "well-\nknown\nthing");
    assert.equal(E.wrap("10 km away", 6, measure), "10 km\naway");
    assert.equal(E.wrap("a\n\nb", 5, measure), "a\n\nb");
    assert.equal(E.wrap("Hi \x1bC[2]Red\x1bC[0] and Blue", 6, measure), "Hi \x1bC[2]Red\x1bC[0]\nand\nBlue");
    assert.equal(E.wrap("soft­hyphen word", 6, measure), "soft-\nhyphen\nword");
    for (const text of ["The quick brown fox", "日本語のテキスト。"]) {
        for (const line of E.wrap(text, 5, measure).split("\n")) {
            assert.ok(measure(line) <= 5, line);
        }
    }
});

test("wrap: CJK breaks anywhere but respects kinsoku", () => {
    const out = E.wrap("今日は「いい天気」ですね。", 5, measure, "ja").split("\n");
    for (const line of out) {
        assert.ok(!/^[、。」]/.test(line), `line starts with closing punctuation: ${line}`);
        assert.ok(!/「$/.test(line), `line ends with opening bracket: ${line}`);
    }
    assert.equal(out.join(""), "今日は「いい天気」ですね。");
});

test("wrap: Thai (no spaces) breaks between words, never inside a cluster", () => {
    const text = "ภาษาไทยเป็นภาษาที่ไม่มีช่องว่าง";
    const out = E.wrap(text, 8, measure, "th");
    assert.equal(out.replace(/\n/g, ""), text);
    for (const line of out.split("\n")) {
        assert.ok(!/^\p{M}/u.test(line), `line starts with a combining mark: ${line}`);
    }
});

test("keyboards.csv: layouts, pages and rows", () => {
    const e = E.createEngine();
    e.setKeyboardsCsv(fs.readFileSync(path.join(__dirname, "../data/locales/keyboards.csv"), "utf8"));
    assert.deepEqual(Object.keys(e.layouts).sort(), ["abc", "azerty", "cyrillic", "greek", "pt", "qwerty", "qwertz", "es"].sort());
    assert.equal(e.layouts.azerty[0].rows[0], "AZERTYUIOP");
    assert.equal(e.layouts.abc.length, 4);
    for (const [id, pages] of Object.entries(e.layouts)) {
        for (const page of pages) {
            assert.ok(page.label, `${id} page label`);
            assert.ok(page.rows.length >= 1, `${id} rows`);
        }
    }
});

test("project tables pass check()", () => {
    const { errors } = tool.loadEngine(path.join(__dirname, "..")).check();
    assert.deepEqual(errors, []);
});

test("MZ JSON writer round-trips the project's files", () => {
    const dir = path.join(__dirname, "../data");
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith(".json"))) {
        const text = fs.readFileSync(path.join(dir, f), "utf8");
        assert.equal(tool.writeMzJson(f, JSON.parse(text)), text, f);
    }
});

/**
 * @brief Makes a scratch project with one map holding dialogue.
 * @return {string} Root folder.
 */
function fixtureProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pmz-l10n-"));
    const data = path.join(root, "data");
    fs.mkdirSync(path.join(data, "locales"), { recursive: true });
    for (const f of ["System.json", "Actors.json", "Items.json"]) {
        fs.copyFileSync(path.join(__dirname, "../data", f), path.join(data, f));
    }
    fs.copyFileSync(path.join(__dirname, "../data/locales/languages.csv"), path.join(data, "locales/languages.csv"));
    const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
    const page = list => ({ list: list.concat([cmd(0, [])]) });
    const map = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/Map001.json"), "utf8"));
    map.displayName = "Pallet Town";
    map.events = [
        null,
        {
            id: 1,
            name: "Oak",
            pages: [
                page([
                    cmd(101, ["", 0, 0, 2, "Oak"]),
                    cmd(401, ["Hello there!"]),
                    cmd(401, ["Welcome, \\N[1]."]),
                    cmd(102, [["Yes", "No"], 1, 0, 2, 0]),
                    cmd(402, [0, "Yes"]),
                    cmd(0, [], 1),
                    cmd(402, [1, "No"]),
                    cmd(0, [], 1),
                    cmd(404, []),
                    cmd(102, [["Red", "Blue"], -1, 0, 2, 0]),
                    cmd(105, [2, false]),
                    cmd(405, ["Credits"]),
                ]),
            ],
        },
        // A copy of event 1's first page (same comment once keyed) with new text.
        null,
    ];
    fs.writeFileSync(path.join(data, "Map001.json"), tool.writeMzJson("Map001.json", map));
    fs.writeFileSync(path.join(data, "CommonEvents.json"), tool.writeMzJson("CommonEvents.json", [null]));
    fs.writeFileSync(path.join(data, "Troops.json"), tool.writeMzJson("Troops.json", [null]));
    return root;
}

test("extract: keys dialogue, is idempotent, keeps IDs, flags stale text, splits copies", () => {
    const root = fixtureProject();
    const mapFile = path.join(root, "data/Map001.json");
    const csvFile = path.join(root, "data/locales/dialogue.csv");

    tool.extract(root, false);
    const map = JSON.parse(fs.readFileSync(mapFile, "utf8"));
    const list = map.events[1].pages[0].list;
    const comments = list.filter(c => c.code === 108).map(c => c.parameters[0]);
    assert.equal(comments.length, 3, "Show Text, standalone choices and scrolling text are keyed");
    assert.equal(list[0].code, 108);
    assert.equal(list[1].code, 101);
    const id = /<L10n: (Dlg\.\w+)>/.exec(comments[0])[1];

    const e = E.createEngine();
    e.addCsv(fs.readFileSync(csvFile, "utf8"), "dialogue.csv");
    assert.equal(e.entries.get(id).values.en, "Hello there!\nWelcome, \\N[1].");
    assert.equal(e.entries.get(`${id}.Speaker`).values.en, "Oak");
    assert.equal(e.entries.get(`${id}.Choice2`).values.en, "No");
    assert.match(e.entries.get(id).notes.context, /Map001 EV001 Oak p1/);
    const db = fs.readFileSync(path.join(root, "data/locales/database.csv"), "utf8");
    assert.match(db, /Map\.1\.DisplayName,Pallet Town/);

    // Second run: nothing changes.
    const mapText = fs.readFileSync(mapFile, "utf8");
    const csvText = fs.readFileSync(csvFile, "utf8");
    const again = tool.extract(root, false);
    assert.deepEqual(again.files, []);
    assert.equal(fs.readFileSync(mapFile, "utf8"), mapText);
    assert.equal(fs.readFileSync(csvFile, "utf8"), csvText);

    // Translate, then edit the source: the ID stays and the row turns stale.
    fs.writeFileSync(csvFile, csvText.replace(`${id},"Hello there!`, `${id},"Hello there!`).replace(/^(Dlg\.\w+\.Speaker,Oak,)/m, "$1Chen"));
    const translated = new tool.Table(csvFile);
    translated.row(id)[translated.col("es-es")] = "¡Hola!";
    fs.writeFileSync(csvFile, translated.toString());
    const edited = JSON.parse(fs.readFileSync(mapFile, "utf8"));
    edited.events[1].pages[0].list[2].parameters[0] = "Hi there!";
    // Copy the page into a new event: same comment, different text.
    const copy = JSON.parse(JSON.stringify(edited.events[1]));
    copy.id = 2;
    copy.pages[0].list[2].parameters[0] = "I'm a copy.";
    edited.events[2] = copy;
    fs.writeFileSync(mapFile, tool.writeMzJson("Map001.json", edited));
    tool.extract(root, false);

    const after = JSON.parse(fs.readFileSync(mapFile, "utf8"));
    assert.equal(after.events[1].pages[0].list[0].parameters[0], `<L10n: ${id}>`, "ID kept");
    const copyId = /<L10n: (Dlg\.\w+)>/.exec(after.events[2].pages[0].list[0].parameters[0])[1];
    assert.notEqual(copyId, id, "copied event got its own ID");
    const t2 = new tool.Table(csvFile);
    assert.equal(t2.row(id)[t2.col("en")], "Hi there!\nWelcome, \\N[1].");
    assert.equal(t2.row(id)[t2.col("#Stale")], "yes");
    assert.equal(t2.row(copyId)[t2.col("en")], "I'm a copy.\nWelcome, \\N[1].");
    fs.rmSync(root, { recursive: true, force: true });
});
