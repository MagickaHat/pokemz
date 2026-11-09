//=============================================================================
// PokéMZ - tests for Pokémon rules, graphics helpers and battles (node --test)
//=============================================================================

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Core = require("../game/js/plugins/PokeMZ_PBS_Core.js");
const E = require("../game/js/plugins/PokeMZ_PBS_Pokemon.js");
const G = require("../game/js/plugins/PokeMZ_PBS_Graphics.js");
const B = require("../game/js/plugins/PokeMZ_PBS_Battle.js");

const PBS_DIR = path.join(__dirname, "..", "game", "data", "pbs");
let sim = null;
try {
    sim = require("../tools/node_modules/@pkmn/sim");
} catch (e) {
    // Battle tests are skipped without "npm install" in tools/.
}

/** @brief Deterministic random numbers. */
function rng(seed = 1) {
    let s = seed;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

test("stats: Bulbapedia's Garchomp example", () => {
    // Lv. 78 Adamant Garchomp, IVs 24/12/30/16/23/5, EVs 74/190/91/48/84/23.
    assert.equal(E.calcStat("hp", 108, 24, 74, 78), 289);
    assert.equal(E.calcStat("atk", 130, 12, 190, 78, 1.1), 278);
    assert.equal(E.calcStat("def", 95, 30, 91, 78), 193);
    assert.equal(E.calcStat("spa", 80, 16, 48, 78, 0.9), 135);
    assert.equal(E.calcStat("spd", 85, 23, 84, 78), 171);
    assert.equal(E.calcStat("spe", 102, 5, 23, 78), 171);
    assert.equal(E.calcStat("hp", 1, 31, 252, 100), 1); // Shedinja
});

test("growth rates", () => {
    const at100 = ["fast", "mediumfast", "mediumslow", "slow", "erratic", "fluctuating"].map(r => E.expForLevel(r, 100));
    assert.deepEqual(at100, [800000, 1000000, 1059860, 1250000, 600000, 1640000]);
    assert.equal(E.expForLevel("mediumslow", 2), 9);
    assert.equal(E.expForLevel("erratic", 50), 125000);
    assert.equal(E.expForLevel("fluctuating", 15), 6 * 3375 * 0 + Math.floor((3375 * (Math.floor(16 / 3) + 24)) / 50));
    for (const r of ["fast", "mediumfast", "mediumslow", "slow", "erratic", "fluctuating"]) {
        for (let n = 2; n <= 100; n++) {
            assert.ok(E.expForLevel(r, n) > E.expForLevel(r, n - 1), `${r} grows at ${n}`);
        }
    }
});

test("EXP: scaled formula and EXP Share", () => {
    const full = E.expGain({ baseExp: 64, level: 5, victorLevel: 5, participated: true });
    const half = E.expGain({ baseExp: 64, level: 5, victorLevel: 5, participated: false });
    assert.equal(full, 65);
    assert.equal(half, 32);
    assert.ok(E.expGain({ baseExp: 64, level: 5, victorLevel: 50, participated: true }) < full);
});

test("capture: Master Ball, chances and shakes", () => {
    assert.equal(E.captureCheck({ maxHp: 100, hp: 100, catchRate: 3, ball: 255 }).caught, true);
    const easy = E.captureCheck({ maxHp: 100, hp: 1, catchRate: 255, ball: 1, status: "slp" }, rng(3));
    assert.equal(easy.caught, true);
    const hard = E.captureCheck({ maxHp: 100, hp: 100, catchRate: 3, ball: 1 }, rng(3));
    assert.ok(hard.chance < 0.05);
    assert.ok(hard.shakes <= 3);
});

test("breeding: compatibility and inheritance", async () => {
    const { registries } = await Core.load(new Core.NodeFileSource(PBS_DIR));
    const sp = id => registries.species.get(id);
    const parent = (id, o = {}) =>
        Object.assign({ species: sp(id), gender: "female", ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: "adamant", abilitySlot: "0", ball: "ultraball", moves: [], heldItem: "", otId: 1 }, o);
    assert.equal(E.compatibility(parent("pikachu"), parent("pikachu", { gender: "male", otId: 2 })), 70);
    assert.equal(E.compatibility(parent("pikachu"), parent("pikachu", { gender: "female" })), 0);
    assert.equal(E.compatibility(parent("pikachu"), parent("ditto", { gender: "genderless", otId: 1 })), 20);
    assert.equal(E.compatibility(parent("pikachu"), parent("charmander", { gender: "male" })), 0);
    const mom = parent("raichu", { heldItem: "everstone", moves: ["wish", "thunderbolt"] });
    const dad = parent("ditto", { gender: "genderless", heldItem: "destinyknot", ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } });
    const child = E.breed(mom, dad, registries, rng(7));
    assert.equal(child.species, "pichu");
    assert.equal(child.nature, "adamant");
    assert.equal(child.ball, "ultraball");
    const inherited = Object.values(child.ivs).filter(v => v === 31 || v === 0).length;
    assert.ok(inherited >= 5, "Destiny Knot passes 5 IVs");
    assert.ok(child.moves.includes("wish"), "egg moves from a parent");
});

test("evolution methods are registered for every imported method", async () => {
    const { registries } = await Core.load(new Core.NodeFileSource(PBS_DIR));
    for (const s of registries.species) {
        for (const evo of s.evolutions || []) {
            assert.ok(E.EvolutionMethods.get(evo.method), `${s.id}: ${evo.method}`);
        }
    }
    const pk = { level: 16, gender: "male", friendship: 200, heldItem: "", knowsMove: () => false, moveIds: () => [], stat: () => 10 };
    const level = E.EvolutionMethods.get("level");
    assert.equal(level.test(pk, { param: 16 }, {}), true);
    assert.equal(level.test(pk, { param: 17 }, {}), false);
    const friendNight = E.EvolutionMethods.get("friendship");
    assert.equal(friendNight.test(pk, { condition: { time: "night" } }, { timeOfDay: "day" }), false);
    assert.equal(friendNight.test(pk, { condition: { time: "night" } }, { timeOfDay: "night" }), true);
    assert.equal(E.EvolutionMethods.get("item").trigger, "item");
    assert.equal(E.EvolutionMethods.get("trade").trigger, "trade");
    // Regional evolutions need the region flag on the map.
    assert.equal(E.EvolutionMethods.get("item").test(pk, { param: "thunderstone", condition: { region: "alola" } }, { item: "thunderstone", mapFlags: [] }), false);
    assert.equal(E.EvolutionMethods.get("item").test(pk, { param: "thunderstone", condition: { region: "alola" } }, { item: "thunderstone", mapFlags: ["regionalola"] }), true);
});

test("graphics: JASC palettes, shiny swap and transparency", () => {
    const pal = G.parseJascPal("JASC-PAL\r\n0100\r\n3\r\n255 0 255\r\n10 20 30\r\n200 100 50\r\n");
    assert.deepEqual(pal, [[255, 0, 255], [10, 20, 30], [200, 100, 50]]);
    const shiny = [[255, 0, 255], [1, 2, 3], [250, 250, 0]];
    const px = new Uint8ClampedArray([255, 0, 255, 255, 10, 20, 30, 255, 202, 101, 52, 255, 9, 9, 9, 255]);
    G.remapPalette(px, pal, shiny);
    assert.deepEqual([...px], [255, 0, 255, 0, 1, 2, 3, 255, 250, 250, 0, 255, 9, 9, 9, 255]);
    assert.deepEqual(G.folders({ id: "raichualola", baseSpecies: "raichu", folder: "alola" }), ["raichu/alola", "raichu", "question_mark"]);
    assert.deepEqual(G.files("front", true), ["frontf", "front"]);
});

test("battle protocol: split lines, conditions and idents", () => {
    const ev = B.toEvents(["|split|p1", "|-damage|p1a: P0|17/30 par", "|-damage|p1a: P0|57/100 par", "|split|p2", "|-damage|p2a: F0|3/15", "|-damage|p2a: F0|20/100", "|move|p1a: P0|PokeMZ Action|p1a: P0", "|-boost|p1a: P0|atk|2"]);
    assert.equal(ev.length, 3);
    assert.deepEqual([ev[0].hp, ev[0].maxhp, ev[0].status], [17, 30, "par"]);
    assert.deepEqual([ev[1].hp, ev[1].maxhp, ev[1].side], [20, 100, "p2"]);
    assert.deepEqual([ev[2].type, ev[2].stat, ev[2].amount], ["boost", "atk", 2]);
});

test("battle text presenter", () => {
    const env = {
        tr: (k, f, a) => f.replace(/\{(\w+)[^}]*\}/g, (m, x) => (a && x in a ? a[x] : m)),
        wild: true,
        pokemon: (side, t) => (side === "p1" ? "Pikachu" : "the wild Pidgey"),
        speciesName: x => x,
        move: () => "Thunderbolt",
        stat: () => "Attack",
        item: x => x,
        ability: x => x,
        statusName: x => x,
        weatherName: x => x,
    };
    const t = new B.TextPresenter(env);
    assert.equal(t.format({ type: "move", side: "p1", token: "P0", move: "thunderbolt" }), "Pikachu used Thunderbolt!");
    assert.equal(t.format({ type: "boost", side: "p1", token: "P0", stat: "atk", amount: 2 }), "Pikachu's Attack rose sharply!");
    assert.equal(t.format({ type: "turn", turn: 2 }), null);
});

test("ball modifiers and escape", () => {
    assert.equal(B.ballModifier({ modifier: 1, special: "quick" }, { turn: 1 }), 5);
    assert.equal(B.ballModifier({ modifier: 1, special: "quick" }, { turn: 3 }), 1);
    assert.equal(B.ballModifier({ modifier: 1, special: "nest" }, { wildLevel: 11 }), 3);
    assert.equal(B.ballModifier({ modifier: 1.5 }, {}), 1.5);
    assert.equal(B.canEscape(100, 50, 1), true);
    assert.equal(B.canEscape(1, 255, 9, () => 0.99), true);
});

test("battle bridge: a wild battle in the Showdown simulator", { skip: !sim && "run npm install in tools/" }, async () => {
    const { registries } = await Core.load(new Core.NodeFileSource(PBS_DIR));
    const dex = B.makeDex(sim, registries);
    const fake = (species, level, moves) => {
        const m = moves.map(id => ({ id, pp: dex.moves.get(id).pp, ppUps: 0 }));
        return {
            _hp: 999,
            _status: "",
            level,
            name: () => species,
            isEgg: () => false,
            moves: () => m,
            maxPp: i => dex.moves.get(m[i].id).pp,
            get hp() {
                return this._hp;
            },
            mhp: 999,
            setHp(h) {
                this._hp = h;
            },
            get status() {
                return this._status;
            },
            set status(s) {
                this._status = s;
            },
            toShowdownSet: () => ({ species: dex.species.get(species).name, level, moves: moves.map(x => dex.moves.get(x).name), ability: Object.values(dex.species.get(species).abilities)[0], nature: "Hardy", evs: {}, ivs: {}, item: "" }),
        };
    };
    const party = [fake("charmander", 30, ["flamethrower"])];
    const foes = [fake("rattata", 3, ["tackle"])];
    const seen = [];
    let expFor = null;
    const presenter = { tr: (k, f) => f, show: async ev => seen.push(ev.type), say: async () => {}, chooseAction: async () => ({ type: "move", slot: 0 }), chooseSwitch: async () => null, refresh() {}, ballShakes: async () => {} };
    const bridge = new B.BattleBridge({ sim, dex, party, foes, wild: true, presenter, adapter: { exp: async foe => (expFor = foe), seen() {} }, seed: [1, 2, 3, 4] });
    assert.equal(await bridge.run(), "win");
    assert.equal(seen[0], "switch");
    assert.equal(expFor, foes[0]);
    assert.ok(party[0].hp > 0 && party[0].hp <= 999);
    assert.equal(party[0].moves()[0].pp, dex.moves.get("flamethrower").pp - 1);
});

test("battle bridge: custom moves and species run as a Showdown mod", { skip: !sim && "run npm install in tools/" }, async () => {
    const { registries } = await Core.load(
        new Core.MemoryFileSource({
            "types.json": JSON.stringify({ electric: { name: "Electric" }, normal: { name: "Normal" } }),
            "moves.json": JSON.stringify({ zapzap: { name: "Zap Zap", type: "electric", category: "special", power: 250, accuracy: 0, pp: 5, custom: true } }),
            "abilities.json": JSON.stringify({ static: { name: "Static" } }),
            "pokemon.json": JSON.stringify({ sparkmon: { num: 9001, name: "Sparkmon", types: ["electric"], baseStats: { hp: 80, atk: 80, def: 80, spa: 120, spd: 80, spe: 100 }, abilities: { 0: "static" }, custom: true } }),
        })
    );
    const dex = B.makeDex(sim, registries);
    assert.ok(dex.moves.get("zapzap").exists);
    assert.equal(dex.moves.get("zapzap").accuracy, true);
    assert.ok(dex.species.get("sparkmon").exists);
});
