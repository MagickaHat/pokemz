//=============================================================================
// PokéMZ - tests for the PBS data layer and tool (node --test)
//=============================================================================

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const P = require("../game/js/plugins/PokeMZ_PBS_Core.js");

const ROOT = path.join(__dirname, "..", "game");

/**
 * @brief Loads in-memory PBS files.
 * @param {Object<string, string|Object>} files File name -> text or data.
 * @param {Object} [opts] Load options.
 * @return {Promise<{registries, report}>} Result.
 */
function loadFiles(files, opts) {
    const texts = {};
    for (const [k, v] of Object.entries(files)) {
        texts[k] = typeof v === "string" ? v : JSON.stringify(v, null, 2);
    }
    return P.load(new P.MemoryFileSource(texts), opts);
}

const TYPES = { fire: { name: "Fire", weaknesses: ["water"] }, water: { name: "Water", resistances: ["fire"] } };
const errorsOf = report => report.errors.map(e => P.Report.format(e));

test("parser: locations of values and keys", () => {
    const { value, locs } = P.parseJson('{\n  "a": {\n    "b": [1, "x"]\n  }\n}', "t.json");
    assert.deepEqual(value, { a: { b: [1, "x"] } });
    assert.deepEqual(locs.get("/a/b/1"), { line: 3, col: 14 });
    assert.deepEqual(locs.get("/a#key"), { line: 2, col: 3 });
});

test("parser: syntax errors have positions", () => {
    assert.throws(() => P.parseJson('{\n "a": [1, 2,]\n}', "x.json"), /x\.json:2:13 trailing comma/);
    assert.throws(() => P.parseJson('{"a": 1, "a": 2}', "x.json"), /duplicate key "a"/);
    assert.throws(() => P.parseJson('{"a": "unterminated\n"}', "x.json"), /x\.json:1:20 unterminated string/);
    assert.deepEqual(P.parseJson("", "x.json").value, {});
});

test("schema errors point at the right line", async () => {
    const { report } = await loadFiles({
        "types.json": TYPES,
        "moves.json": '{\n  "ember": {"name": "Ember", "type": "fire", "category": "special", "power": "lots"}\n}',
    });
    const [err] = errorsOf(report);
    assert.match(err, /^moves\.json:2:78  \/ember\/power  expected a whole number/);
});

test("two-pass load: forward references, unknown refs and suggestions", async () => {
    const { registries, report } = await loadFiles({
        "pokemon.json": {
            charmander: { name: "Charmander", types: ["fire"], baseStats: { hp: 39 }, evolutions: [{ species: "charmeleon", method: "level", param: 16 }], moves: { level: [[1, "ember"]] } },
            charmeleon: { name: "Charmeleon", types: ["fire"], baseStats: { hp: 58 } },
            squirtle: { name: "Squirtle", types: ["watr"], baseStats: { hp: 44 } },
        },
        "types.json": TYPES,
        "moves.json": { ember: { name: "Ember", type: "fire", category: "special", power: 40 } },
    });
    assert.equal(registries.species.get("charmeleon").prevo, "charmander");
    assert.deepEqual(registries.species.get("charmander").movesUpTo(5), ["ember"]);
    const errors = errorsOf(report);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /pokemon\.json:\d+:\d+  \/squirtle\/types\/0  unknown types "watr" \(did you mean "water"\?\)/);
});

test("duplicate IDs across pokemon.json and pokemon_forms.json", async () => {
    const { report } = await loadFiles({
        "types.json": TYPES,
        "pokemon.json": { a: { name: "A", types: ["fire"] }, ab: { name: "AB", types: ["fire"] } },
        "pokemon_forms.json": { ab: { baseSpecies: "a", forme: "B" } },
    });
    assert.ok(errorsOf(report).some(e => /duplicate species ID "ab"/.test(e)));
});

test("forms inherit from their base species", async () => {
    const { registries, report } = await loadFiles({
        "types.json": TYPES,
        "pokemon.json": { raichu: { num: 26, name: "Raichu", types: ["fire"], baseStats: { hp: 60 }, genus: "Mouse" } },
        "pokemon_forms.json": { raichualola: { baseSpecies: "raichu", forme: "Alola", types: ["fire", "water"] } },
    });
    assert.deepEqual(errorsOf(report), []);
    const f = registries.species.get("raichualola");
    assert.equal(f.num, 26);
    assert.equal(f.baseStats.hp, 60);
    assert.deepEqual(f.types, ["fire", "water"]);
    assert.equal(f.showdownName, "Raichu-Alola");
    assert.equal(f.folder, "alola");
    assert.equal(f.genus, "Mouse");
    assert.deepEqual(registries.species.get("raichu").forms.map(x => x.id), ["raichualola"]);
});

test("registry API", async () => {
    const { registries } = await loadFiles({ "types.json": TYPES });
    const r = registries.types;
    assert.equal(r.size, 2);
    assert.deepEqual(r.ids(), ["fire", "water"]);
    assert.equal(r.tryGet("nope"), null);
    assert.throws(() => r.get("fyre"), /did you mean "fire"/);
    assert.equal(r.find(t => t.name === "Water").id, "water");
    assert.equal([...r].length, 2);
    assert.equal(r.get("fire").effectiveness(["water"]), 0.5);
    assert.equal(r.get("water").effectiveness(["fire"]), 2);
    assert.throws(() => r.add({ id: "x" }), /frozen/);
});

test("MZ map alignment: unknown maps and renamed maps", async () => {
    const mapInfos = [null, { id: 1, name: "Pallet Town" }];
    const { registries, report } = await loadFiles(
        { "map_metadata.json": '{\n  "1": {"#map": "Palette Town", "outdoor": true},\n  "9": {}\n}' },
        { mapInfos }
    );
    assert.equal(registries.mapMetadata.get(1).outdoor, true);
    assert.match(errorsOf(report)[0], /map_metadata\.json:3:3 .*map 9 does not exist/);
    assert.ok(report.warnings.some(w => /now called "Pallet Town"/.test(w.message)));
});

test("items link to MZ database items through <PBS: id>", async () => {
    const dbItems = [null, { id: 1, note: "<PBS: potion>", price: 300, iconIndex: 176 }, { id: 2, note: "<PBS: potoin>" }];
    const { registries, report } = await loadFiles({ "items.json": { potion: { name: "Potion", price: 200, pocket: "medicine" } } }, { dbItems });
    const potion = registries.items.get("potion");
    assert.equal(potion.dbItemId, 1);
    assert.ok(report.warnings.some(w => /<PBS: potoin>.*did you mean "potion"/.test(w.message)));
});

test("extension: new fields, new files, open enums", async () => {
    P.extendSchema("abilities", { power: P.T.int().opt(0) });
    P.enums.add("pockets", "ingredients");
    class Quest extends P.PbsData {}
    P.registerFile({ name: "quests", file: "quests.json", cls: Quest, schema: P.T.struct({ name: P.T.localized(), giver: P.T.ref("species").opt() }) });
    try {
        const { registries, report } = await loadFiles({
            "abilities.json": { blaze: { name: "Blaze", power: 3 } },
            "items.json": { onion: { name: "Onion", pocket: "ingredients" }, gem: { name: "Gem", pocket: "gems" } },
            "quests.json": { q1: { name: "Find it", giver: "nobody" } },
        });
        assert.equal(registries.abilities.get("blaze").power, 3);
        assert.equal(registries.quests.get("q1").name, "Find it");
        assert.ok(errorsOf(report).some(e => /quests\.json.*unknown species "nobody"/.test(e)));
        assert.ok(report.warnings.some(w => /unknown pockets "gems"/.test(w.message)));
        assert.ok(!report.warnings.some(w => /ingredients/.test(w.message)));
    } finally {
        P.specs.splice(P.specs.findIndex(s => s.name === "quests"), 1);
        delete P.specs.find(s => s.name === "abilities").schema.fields.power;
    }
});

test("localized fields use the translator and fall back to the source", async () => {
    const { registries } = await loadFiles({ "types.json": TYPES });
    P.setTranslator((key, fallback) => (key === "Type.fire.Name" ? "Feu" : fallback));
    try {
        assert.equal(registries.types.get("fire").name, "Feu");
        assert.equal(registries.types.get("water").name, "Water");
        assert.equal(registries.types.get("fire").sourceText("name"), "Fire");
    } finally {
        P.setTranslator(null);
    }
});

test("Showdown-style IDs", () => {
    assert.equal(P.toID("Mr. Mime"), "mrmime");
    assert.equal(P.toID("Farfetch’d"), "farfetchd");
    assert.equal(P.toID("Raichu-Alola"), "raichualola");
});

test("the shipped PBS data loads without errors", async () => {
    const fs = require("fs");
    const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
    const { registries, report } = await P.load(new P.NodeFileSource(path.join(ROOT, "data", "pbs")), {
        mapInfos: read("MapInfos.json"),
        dbItems: read("Items.json"),
    });
    assert.deepEqual(errorsOf(report), []);
    assert.ok(registries.species.has("pikachu"));
    assert.ok(registries.species.has("raichualola"));
    assert.ok(registries.moves.has("thunderbolt"));
    assert.ok(registries.items.get("potion").dbItemId > 0);
    assert.equal(registries.natures.get("adamant").modifier("atk"), 1.1);
});
