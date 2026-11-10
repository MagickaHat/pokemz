//=============================================================================
// PokéMZ - UI_StartMenu.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Pokémon-style start menu built with Preact.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_UI_Core
 * @orderAfter PokeMZ_UI_Core
 *
 * @param replaceMenu
 * @text Replace Map Menu
 * @desc Opening the menu on the map shows this menu instead of MZ's
 * Scene_Menu (still reachable by script).
 * @type boolean
 * @default true
 *
 * @param pokedexSwitch
 * @text Pokédex Switch
 * @desc The Pokédex entry shows only while this switch is ON.
 * 0 = always shown.
 * @type switch
 * @default 0
 *
 * @param pokegearSwitch
 * @text Pokégear Switch
 * @desc The Pokégear entry shows only while this switch is ON.
 * 0 = always shown.
 * @type switch
 * @default 0
 *
 * @param transition
 * @text Menu Transition
 * @type select
 * @option none
 * @option fade
 * @option slideLeft
 * @option slideRight
 * @option slideUp
 * @option slideDown
 * @option zoom
 * @option wipe
 * @default slideRight
 *
 * @help
 * ============================================================================
 * PokeMZ_UI_StartMenu
 * ============================================================================
 * Requires PokeMZ_UI_Core above it.
 *
 * Entries: Pokédex, Party, Trainer, Pokégear, Bag, Save, Options, Exit.
 * Labels come from data/locales/ui.csv (Start.Menu.*). Keys, gamepad, mouse
 * and touch all work; tapping outside the menu closes it.
 *
 * Pokédex, Party, Trainer, Pokégear and Bag open placeholder screens with
 * the ids pokedex, party, trainer, pokegear and bag. Replace one by
 * registering a screen with the same id from another plugin:
 *   PokeMZ.UI.registerScreen("bag", MyBagScreen);
 *
 * Add or change entries:
 *   PokeMZ.UI.menu.addCommand({ id: "map", labelKey: "Start.Menu.Map",
 *       order: 45, visible: () => true, enabled: () => true,
 *       onSelect: () => PokeMZ.UI.openScreen("townMap") });
 *   PokeMZ.UI.menu.removeCommand("pokegear");
 * The menu stays open under whatever onSelect opens; return "close" to
 * close it (the Exit entry does).
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_UI_StartMenu";
    const UI = window.PokeMZ && window.PokeMZ.UI;
    if (!UI) {
        throw new Error(`${PLUGIN_NAME} requires PokeMZ_UI_Core above it in the plugin list.`);
    }
    const { html, useCursorList, useText, useGame } = UI;
    const { Panel, BackButton } = UI.components;

    const params = PluginManager.parameters(PLUGIN_NAME);
    const CONFIG = {
        replaceMenu: UI.parseBool(params.replaceMenu, true),
        pokedexSwitch: Number(params.pokedexSwitch || 0),
        pokegearSwitch: Number(params.pokegearSwitch || 0),
        transition: params.transition || "slideRight",
    };

    /**
     * @param {number} id Switch id (0 = no condition).
     * @return {boolean} True if visible.
     */
    const switchOn = id => !id || $gameSwitches.value(id);

    //=========================================================================
    // Command registry
    //=========================================================================

    const commands = new Map();

    const menu = {
        /**
         * @brief Adds or replaces a menu entry.
         * @param {Object} cmd {id, labelKey, fallback?, order, visible?(),
         *        enabled?(), onSelect()}. onSelect returns "close" to close the menu.
         */
        addCommand(cmd) {
            commands.set(cmd.id, Object.assign({ order: 100, visible: () => true, enabled: () => true }, cmd));
        },

        /** @param {string} id Entry to remove. */
        removeCommand(id) {
            commands.delete(id);
        },

        /** @return {Array<Object>} Visible entries, sorted by order. */
        visibleCommands() {
            return [...commands.values()].filter(c => c.visible()).sort((a, b) => a.order - b.order);
        },

        commands,
    };

    menu.addCommand({
        id: "pokedex",
        labelKey: "Start.Menu.Pokedex",
        order: 10,
        visible: () => switchOn(CONFIG.pokedexSwitch),
        onSelect: () => UI.openScreen("pokedex"),
    });
    menu.addCommand({ id: "party", labelKey: "Start.Menu.Party", order: 20, onSelect: () => UI.openScreen("party") });
    menu.addCommand({ id: "trainer", labelKey: "Start.Menu.Trainer", order: 30, onSelect: () => UI.openScreen("trainer") });
    menu.addCommand({
        id: "pokegear",
        labelKey: "Start.Menu.Pokegear",
        order: 40,
        visible: () => switchOn(CONFIG.pokegearSwitch),
        onSelect: () => UI.openScreen("pokegear"),
    });
    menu.addCommand({ id: "bag", labelKey: "Start.Menu.Bag", order: 50, onSelect: () => UI.openScreen("bag") });
    menu.addCommand({
        id: "save",
        labelKey: "Start.Menu.Save",
        order: 60,
        enabled: () => $gameSystem.isSaveEnabled(),
        onSelect: () => SceneManager.push(Scene_Save),
    });
    menu.addCommand({ id: "options", labelKey: "Start.Menu.Options", order: 70, onSelect: () => SceneManager.push(Scene_Options) });
    menu.addCommand({ id: "exit", labelKey: "Start.Menu.Exit", order: 80, onSelect: () => "close" });

    //=========================================================================
    // Start menu screen
    //=========================================================================

    /** @brief One label, re-rendered when strings or \N[] names change. */
    function CommandLabel({ cmd }) {
        return useText(cmd.labelKey, cmd.fallback);
    }

    /** @brief The menu panel on the right of the map. */
    function StartMenu({ close }) {
        const list = useGame(() => menu.visibleCommands());
        const enabled = useGame(() => list.map(c => !!c.enabled()));
        const remembered = $gameTemp._pokemzMenuId;
        const initial = Math.max(
            0,
            list.findIndex(c => c.id === remembered)
        );
        const cursor = useCursorList(list.length, {
            initial,
            silentOk: true,
            isEnabled: i => enabled[i],
            onChange: i => ($gameTemp._pokemzMenuId = list[i].id),
            onCancel: close,
            handlers: {
                menu: () => {
                    SoundManager.playCancel();
                    close();
                },
            },
            onOk: i => {
                const cmd = list[i];
                $gameTemp._pokemzMenuId = cmd.id;
                if (cmd.id === "exit") {
                    SoundManager.playCancel();
                } else {
                    SoundManager.playOk();
                }
                const result = cmd.onSelect();
                if (result === "close") {
                    close();
                }
            },
        });
        // Tapping the dimmed map area closes the menu.
        const onBackdrop = e => {
            if (e.target === e.currentTarget && cursor.isTop()) {
                SoundManager.playCancel();
                close();
            }
        };
        return html`<div class="pmz-start" onPointerUp=${onBackdrop}>
            <${Panel} class="pmz-start-menu">
                <div class="pmz-list" ...${cursor.listProps}>
                    ${list.map(
                        (cmd, i) => html`<div key=${cmd.id} ...${cursor.itemProps(i, "pmz-start-item")}>
                            <${CommandLabel} cmd=${cmd} />
                        </div>`
                    )}
                </div>
            <//>
        </div>`;
    }

    UI.registerScreen("startMenu", StartMenu, { transition: CONFIG.transition, blur: false, backgroundOpacity: 255 });

    /** @brief The scene pushed by the map menu call. */
    class Scene_PokeMenu extends UI.Scene_PreactBase {
        prepare() {
            super.prepare("startMenu", {});
        }

        initialize() {
            super.initialize();
            this.prepare();
        }
    }
    window.Scene_PokeMenu = Scene_PokeMenu;

    UI.patch(Scene_Map.prototype, "callMenu", PLUGIN_NAME, orig =>
        function() {
            if (!CONFIG.replaceMenu) {
                orig.apply(this, arguments);
                return;
            }
            SoundManager.playOk();
            SceneManager.push(Scene_PokeMenu);
            $gameTemp.clearDestination();
            this._mapNameWindow.hide();
            this._waitCount = 2;
        }
    );

    //=========================================================================
    // Placeholder screens
    //=========================================================================

    /**
     * @brief Builds a placeholder screen with a title from ui.csv.
     * @param {string} titleKey String key of the title.
     * @return {Function} The component.
     */
    function placeholder(titleKey) {
        return function PlaceholderScreen({ close }) {
            const title = useText(titleKey);
            const body = useText("UI.Placeholder.ComingSoon", "Coming soon!");
            UI.useFocus({
                ok: () => (SoundManager.playCancel(), close()),
                cancel: () => (SoundManager.playCancel(), close()),
            });
            return html`<div class="pmz-placeholder">
                <div class="pmz-panel pmz-title-bar">${title}</div>
                <${Panel} class="pmz-placeholder-body">${body}<//>
                <${BackButton} onPress=${close} />
            </div>`;
        };
    }

    for (const [id, key] of [
        ["pokedex", "Start.Menu.Pokedex"],
        ["party", "Start.Menu.Party"],
        ["trainer", "Start.Menu.Trainer"],
        ["pokegear", "Start.Menu.Pokegear"],
        ["bag", "Start.Menu.Bag"],
    ]) {
        // Don't overwrite a real screen registered by another plugin.
        const existing = UI.screens.get(id);
        if (!existing || existing.opts.placeholder) {
            UI.registerScreen(id, placeholder(key), { transition: "fade", placeholder: true });
        }
    }

    UI.menu = menu;
})();
