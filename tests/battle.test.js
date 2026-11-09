//=============================================================================
// PokéMZ - tests for double/multi battles, gimmicks, trading and berries
//=============================================================================

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Core = require("../game/js/plugins/PokeMZ_PBS_Core.js");
const B = require("../game/js/plugins/PokeMZ_PBS_Battle.js");
const Trade = require("../game/js/plugins/PokeMZ_PBS_Trade.js");
const Berries = require("../game/js/plugins/PokeMZ_PBS_Berries.js");

const PBS_DIR = path.join(__dirname, "..", "game", "data", "pbs");
let sim = null;
try {
    sim = require("../tools/node_modules/@pkmn/sim");
} catch (e) {
    // Battle tests are skipped without "npm install" in tools/.
}
const needsSim = { skip: !sim && "run npm install in tools/" };

let cache = null;
/** @return {Promise<Object>} Registries of the shipped data (loaded once). */
async function registries() {
    if (!cache) {
        cache = (await Core.load(new Core.NodeFileSource(PBS_DIR))).registries;
    }
    return cache;
}

/**
 * @brief A minimal stand-in for Game_Pokemon.
 * @param {Object} dex Battle dex.
 * @param {string} species Species ID.
 * @param {number} level Level.
 * @param {Array<string>} moves Move IDs.
 * @param {Object} [extra] Showdown set fields (item, teraType...).
 * @return {Object} Pokémon-like object.
 */
function fake(dex, species, level, moves, extra = {}) {
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
        toShowdownSet: () =>
            Object.assign(
                { species: dex.species.get(species).name, level, moves: moves.map(x => dex.moves.get(x).name), ability: Object.values(dex.species.get(species).abilities)[0], nature: "Hardy", evs: {}, ivs: {}, item: "" },
                extra
            ),
    };
}

/**
 * @brief Runs a battle where the player always uses the first move (with
 *        a target in doubles and an optional gimmick).
 * @param {Object} o Bridge options.
 * @param {string} [gimmick] Gimmick to use when offered.
 * @return {Promise<{result, events, bridge}>} Outcome.
 */
async function battle(o, gimmick) {
    const events = [];
    const presenter = {
        tr: (k, f) => f,
        show: async ev => events.push(ev),
        say: async () => {},
        chooseAction: async (b, slot, ctx) => {
            const req = b.battle.p1.activeRequest.active[slot];
            const targets = b.targetsFor(slot, req.moves[0].target);
            const flag = { mega: "canMegaEvo", zmove: "canZMove", dynamax: "canDynamax", terastallize: "canTerastallize" }[gimmick];
            return { type: "move", slot: 0, target: targets ? targets[0].loc : null, gimmick: gimmick && req[flag] && !ctx.gimmickUsed ? gimmick : "" };
        },
        chooseSwitch: async (b, forced, x) => b.member("p1", b.battle.p1.pokemon[b.benchFor("p1", x.slot, x.taken)].name),
        refresh() {},
        ballShakes: async () => {},
    };
    const bridge = new B.BattleBridge(
        Object.assign({ sim, presenter, adapter: { exp: async () => {}, seen() {}, useItem: async () => "used" }, seed: [1, 2, 3, 4] }, o)
    );
    const result = await bridge.run();
    return { result, events, bridge };
}

test("double battle against one trainer", needsSim, async () => {
    const dex = B.makeDex(sim, await registries());
    const party = [fake(dex, "charizard", 50, ["flamethrower"]), fake(dex, "blastoise", 50, ["surf"]), fake(dex, "pikachu", 50, ["thunderbolt"])];
    const foes = [fake(dex, "rattata", 15, ["tackle"]), fake(dex, "pidgey", 15, ["tackle"]), fake(dex, "zubat", 15, ["bite"])];
    const { result, events } = await battle({ dex, format: "doubles", party, foes });
    assert.equal(result, "win");
    const foeSwitches = events.filter(e => e.type === "switch" && e.side === "p2");
    assert.ok(foeSwitches.some(e => e.slot === 1), "two foes on the field");
});

test("two trainers at once keep to their own slots", needsSim, async () => {
    const dex = B.makeDex(sim, await registries());
    const a = [fake(dex, "geodude", 20, ["tackle"]), fake(dex, "onix", 20, ["tackle"])];
    const b = [fake(dex, "oddish", 20, ["absorb"]), fake(dex, "bellsprout", 20, ["vinewhip"])];
    const owners = new Map();
    a.forEach(p => owners.set(p, 0));
    b.forEach(p => owners.set(p, 1));
    const party = [fake(dex, "charizard", 60, ["flamethrower"]), fake(dex, "blastoise", 60, ["surf"])];
    const { result, events, bridge } = await battle({ dex, format: "doubles", party, sides: { p2: { team: a.concat(b), name: "A & B", owners } } });
    assert.equal(result, "win");
    for (const ev of events.filter(e => e.type === "switch" && e.side === "p2")) {
        assert.equal(bridge.ownerOf("p2", ev.token), ev.slot, `${ev.token} came out in its trainer's slot`);
    }
});

test("partner (multi) battle and wild doubles", needsSim, async () => {
    const dex = B.makeDex(sim, await registries());
    const multi = await battle({
        dex,
        format: "multi",
        party: [fake(dex, "charizard", 50, ["flamethrower"])],
        sides: {
            p3: { team: [fake(dex, "machamp", 50, ["crosschop"])], name: "Partner" },
            p2: { team: [fake(dex, "rattata", 10, ["tackle"])], name: "A" },
            p4: { team: [fake(dex, "spearow", 10, ["peck"])], name: "B" },
        },
    });
    assert.equal(multi.result, "win");
    assert.ok(multi.events.some(e => e.type === "switch" && e.side === "p3"));
    const wild = await battle({ dex, format: "doubles", wild: true, party: [fake(dex, "charizard", 50, ["heatwave"]), fake(dex, "pikachu", 50, ["discharge"])], foes: [fake(dex, "rattata", 3, ["tackle"]), fake(dex, "pidgey", 3, ["tackle"])] });
    assert.equal(wild.result, "win");
});

test("gimmicks: Mega, Z-Move, Tera and Dynamax", needsSim, async () => {
    const dex = B.makeDex(sim, await registries());
    const foe = () => [fake(dex, "snorlax", 70, ["tackle"])];
    const mega = await battle({ dex, party: [fake(dex, "charizard", 60, ["flamethrower"], { item: "Charizardite X" })], foes: foe() }, "mega");
    assert.ok(mega.events.some(e => e.type === "mega"));
    assert.ok(mega.events.some(e => e.type === "detailschange" && e.species === "charizardmegax"));
    const z = await battle({ dex, party: [fake(dex, "pikachu", 60, ["thunderbolt"], { item: "Electrium Z" })], foes: foe() }, "zmove");
    assert.ok(z.events.some(e => e.type === "zpower"));
    const tera = await battle({ dex, party: [fake(dex, "pikachu", 60, ["thunderbolt"], { teraType: "Water" })], foes: foe() }, "terastallize");
    assert.ok(tera.events.some(e => e.type === "terastallize" && e.teraType === "water"));
    const off = await battle({ dex, party: [fake(dex, "charizard", 60, ["flamethrower"])], foes: foe() }, "dynamax");
    assert.ok(!off.events.some(e => e.type === "start" && e.effect === "dynamax"), "no Dynamax without the battle flag");
    const dmax = await battle({ dex, gimmicks: { dynamax: true }, party: [fake(dex, "charizard", 60, ["flamethrower"], { gigantamax: true })], foes: foe() }, "dynamax");
    const starts = dmax.events.filter(e => e.type === "start" && e.effect === "dynamax" && e.side === "p1");
    assert.equal(starts.length, 1, "Dynamax once per battle");
    assert.ok(starts[0].gmax, "Gigantamax with the G-Max Factor");
});

test("AI trainers use their gimmicks", needsSim, async () => {
    const dex = B.makeDex(sim, await registries());
    const { events } = await battle({
        dex,
        party: [fake(dex, "snorlax", 80, ["tackle"])],
        sides: { p2: { team: [fake(dex, "charizard", 50, ["flamethrower"], { item: "Charizardite Y" })], name: "Ace", controller: new B.AIController({ skill: 1, gimmicks: ["mega"] }) } },
    });
    assert.ok(events.some(e => e.type === "mega" && e.side === "p2"));
});

test("trade codec: round trip, checksum and validation", async () => {
    const reg = await registries();
    const fields = {
        species: "pikachu",
        level: 20,
        exp: 8000,
        nature: "timid",
        ivs: { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 },
        evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
        abilitySlot: "0",
        gender: "female",
        shiny: false,
        personality: 12345,
        nickname: "Sparky",
        heldItem: "lightball",
        ball: "pokeball",
        friendship: 120,
        moves: [{ id: "thunderbolt", pp: 15, ppUps: 0 }],
        moveBank: ["thunderbolt", "growl"],
        teraType: "electric",
    };
    const data = Trade.PokemonCodec.seal(fields);
    assert.deepEqual(Trade.PokemonCodec.validate(data, reg), []);
    const copy = JSON.parse(JSON.stringify(data));
    assert.deepEqual(Trade.PokemonCodec.validate(copy, reg), [], "survives JSON transport");
    const bad = Object.assign({}, data, { level: 101 });
    assert.ok(Trade.PokemonCodec.validate(bad, reg).some(e => /checksum/.test(e)));
    const forged = Trade.PokemonCodec.seal(Object.assign({}, fields, { evs: { hp: 252, atk: 252, def: 252, spa: 0, spd: 0, spe: 0 }, moves: [{ id: "notamove", pp: 5, ppUps: 0 }] }));
    const errors = Trade.PokemonCodec.validate(forged, reg);
    assert.ok(errors.some(e => /EV total/.test(e)));
    assert.ok(errors.some(e => /unknown move/.test(e)));
    assert.ok(Trade.PokemonCodec.validate(Object.assign({}, data, { format: "other" }), reg).length);
});

test("trade protocol over LocalTransport with an NPC", async () => {
    const reg = await registries();
    const describe = d => ({ species: reg.species.get(d.species), level: d.level, isEgg: !!d.isEgg });
    const mon = (species, level) =>
        Trade.PokemonCodec.seal({
            species,
            level,
            exp: 0,
            nature: "hardy",
            ivs: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            abilitySlot: "0",
            gender: reg.species.get(species).gender === "genderless" ? "genderless" : "male",
            nickname: "",
            friendship: 70,
            moves: [{ id: "tackle", pp: 35, ppUps: 0 }],
        });
    const run = async (offer, wants) => {
        const [mine, theirs] = Trade.LocalTransport.pair();
        // eslint-disable-next-line no-new
        new Trade.NpcTradePartner(theirs, { name: "Ken", wants, gives: mon("machop", 10), describe });
        const session = new Trade.TradeSession(mine, { name: "Player", validate: d => Trade.PokemonCodec.validate(d, reg) });
        const got = await session.run(offer);
        return { got, session };
    };
    const ok = await run(mon("rattata", 5), "rattata");
    assert.equal(ok.got.species, "machop");
    assert.equal(ok.session.state, "done");
    const wrong = await run(mon("pidgey", 5), "rattata");
    assert.equal(wrong.got, null);
    assert.equal(wrong.session.reason, "wrong pokemon");
    assert.equal(Trade.matchesWants({ type: "flying", minLevel: 5 }, describe(mon("pidgey", 5))), true);
    assert.equal(Trade.matchesWants({ type: "flying", minLevel: 6 }, describe(mon("pidgey", 5))), false);
});

test("berries: growth stages, drying, yield and regrowth", () => {
    const H = Berries.HOUR;
    const data = { hoursPerStage: 3, dryingPerHour: 15, yield: [2, 5] };
    const st = Berries.newPlant("oranberry", 0);
    assert.equal(Berries.plantState(st, data, 2 * H).name, "planted");
    assert.equal(Berries.plantState(st, data, 3 * H).name, "sprouted");
    const ripe = Berries.plantState(st, data, 12 * H);
    assert.equal(ripe.ripe, true);
    assert.ok(ripe.yield < 5, "dry soil lowers the yield");
    assert.equal(Berries.plantState(st, data, 20 * H).yield, ripe.yield, "the yield stays once ripe");
    const watered = Berries.newPlant("oranberry", 0);
    for (let h = 1; h <= 12; h++) {
        Berries.plantState(watered, data, h * H);
        watered.moisture = 100;
    }
    assert.equal(Berries.plantState(watered, data, 12 * H).yield, 5, "well watered: full yield");
    const growth = Berries.newPlant("oranberry", 0);
    assert.equal(Berries.plantState(growth, data, 9 * H, { mulch: { growth: 0.75 } }).ripe, true, "Growth Mulch speeds it up");
    const old = Berries.newPlant("oranberry", 0);
    assert.equal(Berries.plantState(old, data, 30 * H).name !== "berries" || old.replants > 0, true);
    assert.equal(Berries.plantState(Berries.newPlant("x", 0), data, 1000 * H, { maxReplants: 2 }).withered, true);
});
