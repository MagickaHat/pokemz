//=============================================================================
// PokéMZ - PBS_Debug.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Battle Test menu for playtests: test party and
 * items, and every kind of battle on demand.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_UI_Pokemon
 * @orderAfter PokeMZ_UI_Pokemon
 *
 * @param key
 * @text Menu Key
 * @desc Shift + this key opens the Battle Test menu on the map.
 * @type select
 * @option F9
 * @option F10
 * @option F11
 * @default F9
 *
 * @help
 * ============================================================================
 * PokeMZ_PBS_Debug
 * ============================================================================
 * Only active while playtesting (it does nothing in a deployed game).
 *
 * Shift+F9 on the map opens the Battle Test menu:
 *   - give a test party (Bulbasaur, Sylveon, Charizard with Charizardite X,
 *     Pikachu with Electrium Z, Lapras with the G-Max Factor, Blastoise)
 *     and test items (Mega Ring, Z-Ring, Tera Orb, Dynamax Band, medicine,
 *     Poké Balls, X Attack, Rare Candy)
 *   - heal the party
 *   - start a wild single or double battle, any species at any level, or
 *     the sample trainers in trainers.json (single, double, two trainers,
 *     partner, and the Mega / Tera / Z-Move / Dynamax aces)
 *   - toggles: shiny wild Pokémon, fast battle messages
 *
 * The same from the console (F8):
 *   PokeMZ.Debug.giveParty(); PokeMZ.Debug.battle("double");
 *   battle kinds: wild, wilddouble, single, double, twotrainers, partner,
 *   mega, tera, zmove, dynamax
 */

(() => {
    "use strict";

    if (typeof Utils === "undefined" || !Utils.isOptionValid("test")) {
        return;
    }

    const PLUGIN_NAME = "PokeMZ_PBS_Debug";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const KEYS = { F9: 120, F10: 121, F11: 122 };
    const KEY = KEYS[params.key] || 120;

    const PBS = () => window.PokeMZ.PBS;
    const Pkmn = () => window.PokeMZ.Pokemon;
    const Battle = () => window.PokeMZ.Battle;
    const UI = () => window.PokeMZ.UI;
    const PUI = () => window.PokeMZ.PokemonUI;
    const tr = (k, f, a) => Pkmn().tr(k, f, a);

    const state = { shiny: false, fast: false, open: false, normalFrames: null };

    /** @brief The test party (species with art in the repo come first). */
    const PARTY = [
        ["bulbasaur", 50, { moves: ["gigadrain", "sludgebomb", "sleeppowder", "leechseed"] }],
        ["sylveon", 50, { moves: ["moonblast", "drainingkiss", "shadowball", "calmmind"] }],
        ["charizard", 50, { heldItem: "charizarditex", moves: ["flamethrower", "airslash", "dragonclaw", "earthquake"] }],
        ["pikachu", 50, { heldItem: "electriumz", teraType: "water", moves: ["thunderbolt", "quickattack", "irontail", "surf"] }],
        ["lapras", 50, { gmaxFactor: true, moves: ["surf", "icebeam", "bodyslam", "thunderbolt"] }],
        ["blastoise", 50, { moves: ["surf", "icebeam", "earthquake", "protect"] }],
    ];

    const ITEMS = [
        ["megaring", 1], ["zring", 1], ["teraorb", 1], ["dynamaxband", 1],
        ["potion", 10], ["superpotion", 5], ["fullrestore", 3], ["revive", 5],
        ["pokeball", 20], ["greatball", 10], ["masterball", 1], ["xattack", 5], ["rarecandy", 10], ["oranberry", 5],
    ];

    const Debug = {
        state,

        /** @brief Adds the test party (extra Pokémon go to the PC). */
        giveParty() {
            for (const [species, level, opts] of PARTY) {
                if (!PBS().species.has(species)) {
                    continue;
                }
                const valid = Object.assign({}, opts, { moves: (opts.moves || []).filter(m => PBS().moves.has(m)) });
                if (!valid.moves.length) {
                    delete valid.moves;
                }
                $gameParty.addPokemon(Pkmn().create(species, level, valid));
            }
        },

        /** @brief Adds the test items. */
        giveItems() {
            for (const [id, n] of ITEMS) {
                if (PBS().items.has(id)) {
                    $gameParty.bag().gain(id, n);
                }
            }
        },

        /** @brief Turns fast battle messages on or off. */
        setFast(on) {
            const cfg = Battle().config;
            if (state.normalFrames === null) {
                state.normalFrames = cfg.messageFrames;
            }
            state.fast = on;
            cfg.messageFrames = on ? 12 : state.normalFrames;
        },

        /**
         * @brief Starts a test battle.
         * @param {string} kind See the help.
         * @param {Object} [o] {species, level}.
         * @return {Promise<string>} Result.
         */
        battle(kind, o = {}) {
            if (!$gameParty.ablePokemon().length) {
                this.giveParty();
            }
            const B = Battle();
            const shiny = state.shiny;
            switch (kind) {
                case "wild":
                    return B.startWild(o.species || "pidgey", o.level || 5, { shiny });
                case "wilddouble":
                    return B.startWild("rattata", 5, { shiny, second: { species: "pidgey", level: 5 } });
                case "single":
                    return B.startTrainer("youngsterjoey", { canLose: true });
                case "double":
                    return B.startTrainer("twinsamyandmay", { canLose: true });
                case "twotrainers":
                    return B.startTrainer(["campertom", "picnickerkim"], { canLose: true });
                case "partner":
                    return B.startTrainer(["campertom", "picnickerkim"], { canLose: true, partner: "partnerbrendan" });
                case "mega":
                    return B.startTrainer("acemega", { canLose: true });
                case "tera":
                    return B.startTrainer("acetera", { canLose: true });
                case "zmove":
                    return B.startTrainer("acez", { canLose: true });
                case "dynamax":
                    return B.startTrainer("acemax", { canLose: true, dynamax: true });
                default:
                    throw new Error(`Unknown test battle "${kind}"`);
            }
        },

        /** @brief Opens the Battle Test menu. */
        async open() {
            if (state.open || !(SceneManager._scene instanceof Scene_Map) || $gameMap.isEventRunning()) {
                return;
            }
            state.open = true;
            try {
                await this.menu();
            } finally {
                state.open = false;
            }
        },

        async menu() {
            const pick = (items, title) => PUI().pickCommand(items.concat([{ label: tr("UI.Common.Cancel", "Cancel"), value: null }]), title);
            for (;;) {
                const cmd = await pick(
                    [
                        { label: tr("Debug.GiveParty", "Give test party"), value: "party" },
                        { label: tr("Debug.GiveItems", "Give test items"), value: "items" },
                        { label: tr("Debug.Heal", "Heal party"), value: "heal" },
                        { label: tr("Debug.Battles", "Start a battle..."), value: "battles" },
                        { label: tr("Debug.AnyWild", "Wild battle: any species..."), value: "any" },
                        { label: state.shiny ? tr("Debug.ShinyOn", "Shiny wild Pokémon: ON") : tr("Debug.ShinyOff", "Shiny wild Pokémon: OFF"), value: "shiny" },
                        { label: state.fast ? tr("Debug.FastOn", "Fast messages: ON") : tr("Debug.FastOff", "Fast messages: OFF"), value: "fast" },
                    ],
                    tr("Debug.Title", "Battle Test")
                );
                if (!cmd) {
                    return;
                }
                if (cmd === "party") {
                    this.giveParty();
                    UI().toast(tr("Debug.Done.Party", "Test party added."));
                } else if (cmd === "items") {
                    this.giveItems();
                    UI().toast(tr("Debug.Done.Items", "Test items added."));
                } else if (cmd === "heal") {
                    $gameParty.healPokemon();
                    UI().toast(tr("Debug.Done.Heal", "Party healed."));
                } else if (cmd === "shiny") {
                    state.shiny = !state.shiny;
                } else if (cmd === "fast") {
                    this.setFast(!state.fast);
                } else if (cmd === "any") {
                    const num = await UI().inputNumber(4, 25, { text: tr("Debug.AskNumber", "National Dex number?") });
                    const species = PBS().speciesByNum(num);
                    if (!species) {
                        UI().toast(tr("Debug.NoSpecies", "No species with that number."));
                        continue;
                    }
                    const level = Math.max(1, Math.min(100, await UI().inputNumber(3, 10, { text: tr("Debug.AskLevel", "Level of {species}?", { species: species.name }) })));
                    this.battle("wild", { species: species.id, level });
                    return;
                } else if (cmd === "battles") {
                    const kind = await pick(
                        [
                            { label: tr("Debug.Battle.wild", "Wild (single)"), value: "wild" },
                            { label: tr("Debug.Battle.wilddouble", "Wild (double)"), value: "wilddouble" },
                            { label: tr("Debug.Battle.single", "Trainer: single"), value: "single" },
                            { label: tr("Debug.Battle.double", "Trainer: double"), value: "double" },
                            { label: tr("Debug.Battle.twotrainers", "Two trainers at once"), value: "twotrainers" },
                            { label: tr("Debug.Battle.partner", "Partner battle (multi)"), value: "partner" },
                            { label: tr("Debug.Battle.mega", "Ace: Mega Evolution"), value: "mega" },
                            { label: tr("Debug.Battle.tera", "Ace: Terastallization"), value: "tera" },
                            { label: tr("Debug.Battle.zmove", "Ace: Z-Move"), value: "zmove" },
                            { label: tr("Debug.Battle.dynamax", "Leader: Dynamax"), value: "dynamax" },
                        ],
                        tr("Debug.Battles", "Start a battle...")
                    );
                    if (kind) {
                        this.battle(kind);
                        return;
                    }
                }
            }
        },
    };

    // MZ's own debug screen also uses F9: with Shift held it stays closed.
    const _isDebugCalled = Scene_Map.prototype.isDebugCalled;
    Scene_Map.prototype.isDebugCalled = function() {
        return _isDebugCalled.apply(this, arguments) && !(KEY === 120 && Input.isPressed("shift"));
    };

    document.addEventListener("keydown", e => {
        if (e.keyCode === KEY && e.shiftKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            Debug.open();
        }
    });

    window.PokeMZ = window.PokeMZ || {};
    window.PokeMZ.Debug = Debug;
})();
