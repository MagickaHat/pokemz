//=============================================================================
// PokéMZ - PBS_Trade.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Trading: in-game NPC trades now, with a portable
 * Pokémon format and a transport-based protocol for online trades later.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_PBS_Pokemon
 * @orderAfter PokeMZ_PBS_Berries
 *
 * @command npcTrade
 * @text NPC Trade
 * @desc Offers the trade from trades.json and runs it.
 * @arg trade
 * @text Trade ID
 * @type string
 * @default
 * @arg variable
 * @text Result Variable
 * @desc 1 = traded, 2 = declined, 3 = no suitable Pokémon, 4 = already
 * traded.
 * @type variable
 * @default 0
 *
 * @help
 * ============================================================================
 * PokeMZ_PBS_Trade
 * ============================================================================
 * In-game trades live in data/pbs/trades.json:
 *
 *   "rattatafortrade": {
 *     "npcName": "Ken",
 *     "wants": "rattata",                     (or {"type": "water"},
 *                                              {"species": [...], "minLevel": 10})
 *     "gives": {"species": "machop", "level": 10, "nickname": "Bulky",
 *               "otName": "Ken", "otId": 12345, "item": "", "moves": []},
 *     "once": true
 *   }
 *
 * Run it with the NPC Trade plugin command. The player chooses a Pokémon
 * that fits; the received Pokémon keeps the NPC as its Original Trainer
 * (so it gets the traded EXP bonus) and trade evolutions happen at once.
 *
 * Built for online trading later:
 * - PokemonCodec turns a Pokémon into a versioned, ID-only object with a
 *   checksum, and checks incoming data against the PBS registries.
 * - TradeSession runs the trade protocol (hello -> offer -> accept ->
 *   confirm) over any transport {send(msg), onMessage(fn), close()}.
 *   LocalTransport.pair() connects two sessions in memory; NPC trades use
 *   it with NpcTradePartner on the other end. A WebSocket or WebRTC
 *   transport with the same three methods can connect two players without
 *   changing game code.
 *
 *   PokeMZ.Trade.tradeWith(transport, myPokemon) -> Promise<Game_Pokemon>
 */

(() => {
    "use strict";

    //=========================================================================
    // Engine (pure)
    //=========================================================================

    const FORMAT = "pmz-pokemon";
    const VERSION = 1;
    const STATS = ["hp", "atk", "def", "spa", "spd", "spe"];

    /**
     * @brief 32-bit FNV-1a hash of a string (hex).
     * @param {string} s Text.
     * @return {string} Hash.
     */
    function fnv1a(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(16).padStart(8, "0");
    }

    /** @brief JSON with sorted keys (stable for checksums). */
    function canonical(v) {
        if (Array.isArray(v)) {
            return `[${v.map(canonical).join(",")}]`;
        }
        if (v && typeof v === "object") {
            return `{${Object.keys(v)
                .sort()
                .map(k => `${JSON.stringify(k)}:${canonical(v[k])}`)
                .join(",")}}`;
        }
        return JSON.stringify(v === undefined ? null : v);
    }

    /** @brief Fields of the portable Pokémon format (checksum excluded). */
    const FIELDS = [
        "species", "level", "exp", "nature", "mint", "ivs", "evs", "abilitySlot", "gender", "shiny", "personality",
        "nickname", "heldItem", "ball", "friendship", "otName", "otId", "metMap", "metLevel", "moves", "moveBank",
        "ribbons", "teraType", "dynamaxLevel", "gmaxFactor", "isEgg", "eggSteps", "pokerus", "hpRatio", "status",
    ];

    /**
     * @brief Portable Pokémon data: IDs and numbers only, no actor IDs and
     *        no translated text (the nickname is the player's own text).
     */
    const PokemonCodec = {
        FORMAT,
        VERSION,

        /**
         * @brief Encodes plain Pokémon fields (see FIELDS).
         * @param {Object} fields Values.
         * @return {Object} {format, version, ...fields, checksum}.
         */
        seal(fields) {
            const out = { format: FORMAT, version: VERSION };
            for (const k of FIELDS) {
                if (fields[k] !== undefined) {
                    out[k] = JSON.parse(JSON.stringify(fields[k]));
                }
            }
            out.checksum = fnv1a(canonical(Object.assign({}, out, { checksum: undefined })));
            return out;
        },

        /**
         * @brief Encodes a Game_Pokemon (or anything with the same fields).
         * @param {Object} p Pokémon.
         * @return {Object} Portable data.
         */
        encode(p) {
            return this.seal({
                species: p._speciesId,
                level: p._level,
                exp: p.currentExp ? p.currentExp() : p._exp ? p._exp[0] : 0,
                nature: p._nature,
                mint: p._mint || "",
                ivs: p._ivs,
                evs: p._evs,
                abilitySlot: p._abilitySlot,
                gender: p._gender,
                shiny: !!p._shiny,
                personality: p._personality >>> 0,
                nickname: p._nickname || "",
                heldItem: p._heldItem || "",
                ball: p._ball || "pokeball",
                friendship: p._friendship,
                otName: p._otName || "",
                otId: p._otId || 0,
                metMap: p._metMap || 0,
                metLevel: p._metLevel || p._level,
                moves: (p._moves || []).map(m => ({ id: m.id, pp: m.pp, ppUps: m.ppUps || 0 })),
                moveBank: (p._moveBank || []).slice(),
                ribbons: (p._ribbons || []).slice(),
                teraType: p._teraType || "",
                dynamaxLevel: p._dynamaxLevel || 0,
                gmaxFactor: !!p._gmaxFactor,
                isEgg: !!p._isEgg,
                eggSteps: p._eggSteps || 0,
                pokerus: p._pokerus || 0,
                hpRatio: p.mhp ? Math.max(0, Math.min(1, p.hp / p.mhp)) : 1,
                status: p._status || "",
            });
        },

        /**
         * @brief Checks incoming data against the PBS registries.
         * @param {Object} data Portable data.
         * @param {Object} reg Registries (species, moves, items, natures,
         *        types, abilities).
         * @param {Object} [o] {maxLevel = 100, evPerStat = 252, evTotal = 510}.
         * @return {Array<string>} Problems (empty when valid).
         */
        validate(data, reg, o = {}) {
            const errors = [];
            const fail = msg => errors.push(msg);
            if (!data || typeof data !== "object") {
                return ["not an object"];
            }
            if (data.format !== FORMAT || data.version !== VERSION) {
                return [`unsupported format ${data.format}@${data.version}`];
            }
            if (data.checksum !== fnv1a(canonical(Object.assign({}, data, { checksum: undefined })))) {
                fail("checksum does not match");
            }
            const species = reg.species && reg.species.tryGet(data.species);
            if (!species) {
                fail(`unknown species "${data.species}"`);
                return errors;
            }
            const maxLevel = o.maxLevel || 100;
            if (!Number.isInteger(data.level) || data.level < 1 || data.level > maxLevel) {
                fail(`level ${data.level} out of range`);
            }
            const ivs = data.ivs || {};
            const evs = data.evs || {};
            let evSum = 0;
            for (const s of STATS) {
                if (!Number.isInteger(ivs[s]) || ivs[s] < 0 || ivs[s] > 31) {
                    fail(`IV ${s} out of range`);
                }
                if (!Number.isInteger(evs[s]) || evs[s] < 0 || evs[s] > (o.evPerStat || 252)) {
                    fail(`EV ${s} out of range`);
                }
                evSum += evs[s] || 0;
            }
            if (evSum > (o.evTotal || 510)) {
                fail("EV total over the limit");
            }
            if (!reg.natures || !reg.natures.has(data.nature)) {
                fail(`unknown nature "${data.nature}"`);
            }
            if (data.mint && !reg.natures.has(data.mint)) {
                fail(`unknown mint nature "${data.mint}"`);
            }
            if (!species.abilities[data.abilitySlot]) {
                fail(`ability slot "${data.abilitySlot}" not available`);
            }
            const genders = species.gender === "genderless" ? ["genderless"] : species.gender === "male" ? ["male"] : species.gender === "female" ? ["female"] : ["male", "female"];
            if (!genders.includes(data.gender)) {
                fail(`gender "${data.gender}" not possible`);
            }
            if (!Array.isArray(data.moves) || data.moves.length > 4 || (!data.isEgg && data.moves.length < 1)) {
                fail("needs 1 to 4 moves");
            } else {
                for (const m of data.moves) {
                    if (!reg.moves.has(m.id)) {
                        fail(`unknown move "${m.id}"`);
                    } else if (!Number.isInteger(m.ppUps) || m.ppUps < 0 || m.ppUps > 3 || m.pp < 0 || m.pp > Math.floor(reg.moves.get(m.id).pp * 1.6)) {
                        fail(`bad PP for "${m.id}"`);
                    }
                }
            }
            for (const id of data.moveBank || []) {
                if (!reg.moves.has(id)) {
                    fail(`unknown move "${id}" in the move bank`);
                }
            }
            for (const key of ["heldItem", "ball"]) {
                if (data[key] && !reg.items.has(data[key])) {
                    fail(`unknown item "${data[key]}"`);
                }
            }
            if (data.teraType && !reg.types.has(data.teraType)) {
                fail(`unknown type "${data.teraType}"`);
            }
            if (typeof data.nickname !== "string" || data.nickname.length > 24) {
                fail("bad nickname");
            }
            if (!Number.isInteger(data.friendship) || data.friendship < 0 || data.friendship > 255) {
                fail("friendship out of range");
            }
            if (data.species && species.isForm && species.battleOnly) {
                fail("battle-only forms cannot be traded");
            }
            return errors;
        },
    };

    //-------------------------------------------------------------------------
    // Transports and the session protocol
    //-------------------------------------------------------------------------

    /**
     * @brief Two connected in-memory ends. Messages are delivered
     *        asynchronously, like a network would.
     */
    class LocalTransport {
        constructor() {
            this.peer = null;
            this.handlers = [];
            this.closed = false;
        }

        /** @return {Array<LocalTransport>} A connected pair. */
        static pair() {
            const a = new LocalTransport();
            const b = new LocalTransport();
            a.peer = b;
            b.peer = a;
            return [a, b];
        }

        /** @brief Sends a message (a JSON copy) to the other end. */
        send(msg) {
            if (this.closed || !this.peer || this.peer.closed) {
                return;
            }
            const copy = JSON.parse(JSON.stringify(msg));
            Promise.resolve().then(() => this.peer.handlers.forEach(fn => fn(copy)));
        }

        /** @brief Adds a message handler. */
        onMessage(fn) {
            this.handlers.push(fn);
        }

        /** @brief Closes both ends. */
        close() {
            this.closed = true;
            if (this.peer && !this.peer.closed) {
                this.peer.close();
            }
        }
    }

    /**
     * @brief One side of a trade. Messages: {type: "hello", name, id} ->
     *        {type: "offer", pokemon} -> {type: "accept"} -> {type:
     *        "confirm"}; either side may send {type: "cancel", reason}.
     *
     *        States: idle -> greeted -> offered -> accepted -> done, or
     *        cancelled at any point.
     */
    class TradeSession {
        /**
         * @param {Object} transport {send, onMessage, close}.
         * @param {Object} [o] {name, id, validate(data) -> errors}.
         */
        constructor(transport, o = {}) {
            this.transport = transport;
            this.name = o.name || "";
            this.id = o.id || 0;
            this.validate = o.validate || (() => []);
            this.state = "idle";
            this.peer = { name: "", id: 0, offer: null, accepted: false, confirmed: false };
            this.mine = { offer: null, accepted: false, confirmed: false };
            this.waiters = [];
            this.reason = "";
            transport.onMessage(msg => this.receive(msg));
        }

        /** @brief Handles a message from the other side. */
        receive(msg) {
            if (!msg || this.state === "cancelled" || this.state === "done") {
                return;
            }
            switch (msg.type) {
                case "hello":
                    this.peer.name = String(msg.name || "");
                    this.peer.id = msg.id || 0;
                    break;
                case "offer": {
                    const errors = this.validate(msg.pokemon);
                    if (errors.length) {
                        this.cancel(`invalid offer: ${errors.join("; ")}`);
                        return;
                    }
                    this.peer.offer = msg.pokemon;
                    // A new offer means both sides must accept again.
                    this.peer.accepted = this.mine.accepted = false;
                    break;
                }
                case "accept":
                    this.peer.accepted = true;
                    break;
                case "confirm":
                    this.peer.confirmed = true;
                    break;
                case "cancel":
                    this.state = "cancelled";
                    this.reason = msg.reason || "cancelled";
                    break;
                default:
                    return;
            }
            this.update();
        }

        /** @brief Moves the state forward and wakes waiters. */
        update() {
            if (this.state !== "cancelled") {
                if (this.mine.confirmed && this.peer.confirmed) {
                    this.state = "done";
                } else if (this.mine.accepted && this.peer.accepted) {
                    this.state = "accepted";
                } else if (this.mine.offer && this.peer.offer) {
                    this.state = "offered";
                } else if (this.peer.name || this.state === "greeted") {
                    this.state = "greeted";
                }
            }
            const waiting = this.waiters.splice(0);
            for (const w of waiting) {
                if (!w.check()) {
                    this.waiters.push(w);
                }
            }
        }

        /**
         * @brief Waits until a condition holds (or the trade is cancelled).
         * @param {function(): boolean} test Condition.
         * @return {Promise<boolean>} True when it holds, false if cancelled.
         */
        waitFor(test) {
            return new Promise(resolve => {
                const w = {
                    check: () => {
                        if (this.state === "cancelled") {
                            resolve(false);
                            return true;
                        }
                        if (test()) {
                            resolve(true);
                            return true;
                        }
                        return false;
                    },
                };
                if (!w.check()) {
                    this.waiters.push(w);
                }
            });
        }

        /** @brief Says hello. */
        hello() {
            this.transport.send({ type: "hello", name: this.name, id: this.id });
        }

        /** @brief Offers a Pokémon (portable data). */
        offer(pokemon) {
            this.mine.offer = pokemon;
            this.mine.accepted = false;
            this.transport.send({ type: "offer", pokemon });
            this.update();
        }

        /** @brief Accepts the current offers. */
        accept() {
            this.mine.accepted = true;
            this.transport.send({ type: "accept" });
            this.update();
        }

        /** @brief Final confirmation. */
        confirm() {
            this.mine.confirmed = true;
            this.transport.send({ type: "confirm" });
            this.update();
        }

        /** @brief Cancels the trade. */
        cancel(reason = "cancelled") {
            if (this.state === "done" || this.state === "cancelled") {
                return;
            }
            this.transport.send({ type: "cancel", reason });
            this.state = "cancelled";
            this.reason = reason;
            this.update();
        }

        /**
         * @brief Runs a whole trade: hello, offer, wait for the other offer,
         *        decide, accept, confirm.
         * @param {Object} pokemon My portable Pokémon.
         * @param {function(Object): Promise<boolean>} [decide] Looks at the
         *        other offer; false cancels.
         * @return {Promise<Object|null>} The other side's Pokémon (null when
         *         cancelled).
         */
        async run(pokemon, decide) {
            this.hello();
            this.offer(pokemon);
            if (!(await this.waitFor(() => !!this.peer.offer))) {
                return null;
            }
            if (decide && !(await decide(this.peer.offer))) {
                this.cancel("declined");
                return null;
            }
            this.accept();
            if (!(await this.waitFor(() => this.peer.accepted))) {
                return null;
            }
            this.confirm();
            if (!(await this.waitFor(() => this.state === "done"))) {
                return null;
            }
            this.transport.close();
            return this.peer.offer;
        }
    }

    /**
     * @brief Does a matching test for a trade's "wants".
     * @param {string|Object} wants Species ID or {species: [..], type, minLevel}.
     * @param {Object} p {species (SpeciesData), level, isEgg}.
     * @return {boolean} True if the Pokémon fits.
     */
    function matchesWants(wants, p) {
        if (!p || p.isEgg) {
            return false;
        }
        if (typeof wants === "string") {
            return p.species.id === wants || p.species.baseId === wants;
        }
        const w = wants || {};
        if (w.species && ![].concat(w.species).some(id => p.species.id === id || p.species.baseId === id)) {
            return false;
        }
        if (w.type && !p.species.types.includes(w.type)) {
            return false;
        }
        if (w.minLevel && p.level < w.minLevel) {
            return false;
        }
        return true;
    }

    /**
     * @brief An NPC on the other end of a LocalTransport: accepts an offer
     *        that fits "wants" and sends its own Pokémon.
     */
    class NpcTradePartner {
        /**
         * @param {Object} transport Its end of the pair.
         * @param {Object} o {name, wants, gives (portable data),
         *        describe(data) -> {species, level, isEgg}}.
         */
        constructor(transport, o) {
            this.session = new TradeSession(transport, { name: o.name, id: -3 });
            this.o = o;
            this.session.waitFor(() => !!this.session.peer.offer).then(ok => {
                if (!ok) {
                    return;
                }
                const theirs = o.describe(this.session.peer.offer);
                if (!matchesWants(o.wants, theirs)) {
                    this.session.cancel("wrong pokemon");
                    return;
                }
                this.session.hello();
                this.session.offer(o.gives);
                this.session.accept();
                this.session.waitFor(() => this.session.peer.accepted).then(ok2 => ok2 && this.session.confirm());
            });
        }
    }

    const Engine = { FORMAT, VERSION, fnv1a, canonical, PokemonCodec, LocalTransport, TradeSession, NpcTradePartner, matchesWants };

    if (typeof window === "undefined" || typeof PluginManager === "undefined") {
        if (typeof module !== "undefined" && module.exports) {
            module.exports = Engine;
        }
        return;
    }

    //=========================================================================
    // MZ glue
    //=========================================================================

    const PLUGIN_NAME = "PokeMZ_PBS_Trade";
    const PBS = window.PokeMZ.PBS;
    const Pkmn = window.PokeMZ.Pokemon;
    const tr = (k, f, a) => Pkmn.tr(k, f, a);

    // trades.json is declared in PokeMZ_PBS_Core (so tools can check it).

    /** @return {Object} Registries for codec checks. */
    const registries = () => PBS.registries;

    /**
     * @brief Makes a Game_Pokemon from checked portable data (new actor ID).
     * @param {Object} d Portable data.
     * @return {Game_Pokemon} The Pokémon.
     */
    function decode(d) {
        const p = new Game_Pokemon(d.species, d.level, { nature: d.nature, gender: d.gender, shiny: d.shiny, abilitySlot: d.abilitySlot, ivs: d.ivs, evs: d.evs });
        Object.assign(p, {
            _mint: d.mint || "",
            _personality: d.personality >>> 0,
            _nickname: d.nickname || "",
            _heldItem: d.heldItem || "",
            _ball: d.ball || "pokeball",
            _friendship: d.friendship,
            _otName: d.otName || "",
            _otId: d.otId || 0,
            _metMap: d.metMap || 0,
            _metLevel: d.metLevel || d.level,
            _moves: d.moves.map(m => ({ id: m.id, pp: m.pp, ppUps: m.ppUps || 0 })),
            _moveBank: (d.moveBank || []).slice(),
            _ribbons: (d.ribbons || []).slice(),
            _teraType: d.teraType || "",
            _dynamaxLevel: d.dynamaxLevel || 0,
            _gmaxFactor: !!d.gmaxFactor,
            _isEgg: !!d.isEgg,
            _eggSteps: d.eggSteps || 0,
            _pokerus: d.pokerus || 0,
            _status: d.status || "",
        });
        const min = p.expForLevel(d.level);
        const max = p.expForLevel(d.level + 1) - 1;
        p._exp = { 0: Math.max(min, Math.min(max, d.exp || min)) };
        p.refresh();
        p.setHp(Math.max(d.hpRatio > 0 ? 1 : 0, Math.round(p.mhp * (d.hpRatio === undefined ? 1 : d.hpRatio))));
        $gameActors.addPokemon(p);
        return p;
    }

    /** @return {Object} {species, level, isEgg} of portable data. */
    const describe = d => ({ species: PBS.species.get(d.species), level: d.level, isEgg: !!d.isEgg });

    /**
     * @brief Builds the NPC's portable Pokémon for a trade.
     * @param {TradeData} t Trade.
     * @return {Object} Portable data.
     */
    function npcPokemon(t) {
        const g = t.gives;
        const p = new Game_Pokemon(g.species, g.level, {
            nature: g.nature,
            gender: g.gender,
            shiny: g.shiny,
            ivs: g.ivs,
            moves: g.moves && g.moves.length ? g.moves : undefined,
            heldItem: g.item || "",
            ball: g.ball || "pokeball",
            otName: g.otName || t.npcName,
            otId: g.otId || 0,
            nickname: t.nickname || "",
            abilitySlot: g.abilitySlot,
        });
        return PokemonCodec.encode(p);
    }

    /**
     * @brief Trades a Pokémon over a transport (any partner: an NPC now,
     *        another player later).
     * @param {Object} transport {send, onMessage, close}.
     * @param {Game_Pokemon} mine The Pokémon to send.
     * @param {Object} [o] {decide(data) -> Promise<boolean>}.
     * @return {Promise<{received: Object|null, reason: string}>} The
     *         other side's portable Pokémon (null when cancelled).
     */
    async function tradeWith(transport, mine, o = {}) {
        const session = new TradeSession(transport, {
            name: $gameParty.leader() ? $gameParty.leader().name() : "",
            id: $gamePokemon.trainerId,
            validate: d => PokemonCodec.validate(d, registries(), { maxLevel: Pkmn.rules.maxLevel, evPerStat: Pkmn.rules.evPerStat, evTotal: Pkmn.rules.evTotal }),
        });
        const received = await session.run(PokemonCodec.encode(mine), o.decide);
        return { received, reason: session.reason, partner: session.peer };
    }

    /**
     * @brief Swaps the Pokémon in the game: the sent one leaves (party or
     *        PC), the received one takes its place.
     * @param {Game_Pokemon} sent Pokémon sent.
     * @param {Object} data Portable data received.
     * @return {Game_Pokemon} The received Pokémon.
     */
    function completeTrade(sent, data) {
        const got = decode(data);
        const partyIndex = $gameParty.pokemon().indexOf(sent);
        if (partyIndex >= 0) {
            $gameParty.setPokemonAt(partyIndex, got);
        } else {
            const where = $gamePokemon.storage.search(p => p === sent)[0];
            if (where) {
                $gamePokemon.storage.put(where.box, where.slot, got);
            } else {
                $gameParty.addPokemon(got);
            }
        }
        $gameActors.deletePokemon(sent.actorId());
        $gamePokemon.pokedex.register(got, true);
        return got;
    }

    /**
     * @brief Runs an in-game trade from trades.json.
     * @param {string} id Trade ID.
     * @return {Promise<number>} 1 traded, 2 declined, 3 no suitable
     *         Pokémon, 4 already traded.
     */
    async function npcTrade(id) {
        const UI = window.PokeMZ.UI;
        const PUI = window.PokeMZ.PokemonUI;
        const t = PBS.trades.get(id);
        $gamePokemon.trades = $gamePokemon.trades || {};
        const args = { npc: t.npcName };
        if (t.once && $gamePokemon.trades[id]) {
            await UI.message(tr("Trade.Msg.Thanks", "{npc}: Thanks again for the trade!", args));
            return 4;
        }
        const wantName =
            typeof t.wants === "string"
                ? PBS.species.get(t.wants).name
                : t.wants.species && t.wants.species.length
                ? t.wants.species.map(s => PBS.species.get(s).name).join(" / ")
                : t.wants.type
                ? tr("Trade.AnyType", "a {type}-type Pokémon", { type: PBS.types.get(t.wants.type).name })
                : tr("Trade.AnyPokemon", "a Pokémon");
        const giveName = PBS.species.get(t.gives.species).name;
        Object.assign(args, { want: wantName, give: giveName });
        if (!(await UI.confirm(tr("Trade.Msg.Offer", "{npc}: I'm looking for {want}. Will you trade it for my {give}?", args)))) {
            await UI.message(tr("Trade.Msg.Declined", "{npc}: Oh... Never mind, then.", args));
            return 2;
        }
        const fits = p => matchesWants(t.wants, { species: p.species(), level: p.level, isEgg: p.isEgg() });
        if (!$gameParty.pokemon().some(fits)) {
            await UI.message(tr("Trade.Msg.NoneFits", "{npc}: You don't have {want}? Come back when you do!", args));
            return 3;
        }
        const mine = await PUI.pickPokemon({ help: tr("Trade.Choose", "Which Pokémon will you trade?"), filter: fits });
        if (!mine) {
            await UI.message(tr("Trade.Msg.Declined", "{npc}: Oh... Never mind, then.", args));
            return 2;
        }
        if ($gameParty.ablePokemon().filter(p => p !== mine).length === 0) {
            await UI.message(tr("Trade.Msg.LastPokemon", "You can't trade away your last Pokémon that can battle!"));
            return 2;
        }
        const [playerEnd, npcEnd] = LocalTransport.pair();
        // eslint-disable-next-line no-new
        new NpcTradePartner(npcEnd, { name: t.npcName, wants: t.wants, gives: npcPokemon(t), describe });
        const result = await tradeWith(playerEnd, mine);
        if (!result.received) {
            await UI.message(tr("Trade.Msg.Declined", "{npc}: Oh... Never mind, then.", args));
            return result.reason === "wrong pokemon" ? 3 : 2;
        }
        const sentName = mine.name();
        const got = completeTrade(mine, result.received);
        $gamePokemon.trades[id] = 1;
        await showTrade(mine, got, { npc: t.npcName, sent: sentName });
        await UI.message(tr("Trade.Msg.TakeCare", "{npc}: Take good care of {name}!", Object.assign({ name: got.name() }, args)));
        // Trade evolutions happen at once.
        const target = got.onTraded(mine);
        if (target) {
            await Pkmn.Flow.evolve(got, target);
        }
        return 1;
    }

    /**
     * @brief The trade animation overlay (if the UI plugin is present).
     * @return {Promise<void>} Done.
     */
    function showTrade(sent, got, o) {
        const PUI = window.PokeMZ.PokemonUI;
        const UI = window.PokeMZ.UI;
        if (!PUI || !PUI.showTrade) {
            return UI.message(tr("Trade.Msg.Traded", "{player} traded {sent} for {got}!", { player: $gameParty.leader().name(), sent: o.sent, got: got.name() }));
        }
        return PUI.showTrade(sent, got, o);
    }

    PluginManager.registerCommand(PLUGIN_NAME, "npcTrade", function(args) {
        let done = false;
        const variable = Number(args.variable || 0);
        npcTrade(PBS.toID(args.trade))
            .catch(e => {
                console.error(e);
                return 2;
            })
            .then(r => {
                if (variable) {
                    $gameVariables.setValue(variable, r);
                }
                done = true;
            });
        this.setWaitMode("pbsFlow");
        this._pbsFlowDone = () => done;
    });

    window.PokeMZ.Trade = Object.assign(Engine, { decode, completeTrade, tradeWith, npcTrade, npcPokemon });
})();
