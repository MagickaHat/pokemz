//=============================================================================
// PokéMZ - UI_Controls.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Key and gamepad remapping, UI animation option.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_UI_Core
 * @orderAfter PokeMZ_UI_Core
 *
 * @param showControls
 * @text Controls In Options
 * @desc Adds a "Controls" entry to the Options screen.
 * @type boolean
 * @default true
 *
 * @param showAnimations
 * @text UI Animations In Options
 * @desc Adds an on/off option for UI transitions (accessibility).
 * @type boolean
 * @default true
 *
 * @param captureSeconds
 * @text Capture Timeout (seconds)
 * @type number
 * @min 2
 * @default 5
 *
 * @help
 * ============================================================================
 * PokeMZ_UI_Controls
 * ============================================================================
 * Requires PokeMZ_UI_Core above it.
 *
 * Options > Controls lists each action with its keyboard key(s) and gamepad
 * button. Choose one (keys, gamepad, mouse or touch) and press the new key
 * or button. If it was used by another action the two swap, so nothing is
 * ever left unbound. "Reset to defaults" restores MZ's mapping.
 *
 * Mappings are saved in config.rmmzsave and change MZ's own Input mappers,
 * so they apply everywhere: map, MZ windows and Preact screens.
 *
 * Script: PokeMZ.UI.input.remap.reset(), .setKey(button, keyCode),
 *         .setPad(button, buttonIndex), .keysFor(button), .padFor(button)
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_UI_Controls";
    const UI = window.PokeMZ && window.PokeMZ.UI;
    if (!UI) {
        throw new Error(`${PLUGIN_NAME} requires PokeMZ_UI_Core above it in the plugin list.`);
    }
    const { html, useState, useEffect, useRef, useFocus, useCursorList, useFrame, useText } = UI;
    const { BackButton, Button } = UI.components;

    const params = PluginManager.parameters(PLUGIN_NAME);
    const CONFIG = {
        showControls: UI.parseBool(params.showControls, true),
        showAnimations: UI.parseBool(params.showAnimations, true),
        captureFrames: Number(params.captureSeconds || 5) * 60,
    };

    //=========================================================================
    // Remapping model
    //=========================================================================

    /** @brief Keys that can't be bound (function keys, Num Lock). */
    const RESERVED_KEYS = new Set([112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 144]);

    const remap = {
        /** @brief MZ's mappers as they were when the game booted (kept across hot reloads). */
        defaults: UI.input.remap ? UI.input.remap.defaults : remap0(),

        /**
         * @param {string} button MZ button name ("ok", "escape", ...).
         * @return {Array<number>} Key codes mapped to it.
         */
        keysFor: button =>
            Object.keys(Input.keyMapper)
                .filter(k => Input.keyMapper[k] === button)
                .map(Number),

        /**
         * @param {string} button MZ button name.
         * @return {Array<number>} Gamepad button indices mapped to it.
         */
        padFor: button =>
            Object.keys(Input.gamepadMapper)
                .filter(k => Input.gamepadMapper[k] === button)
                .map(Number),

        /**
         * @brief Binds a key to a button. The button's old keys are removed;
         *        if the key belonged to another button, that button gets the
         *        first old key (a swap).
         * @param {string} button MZ button name.
         * @param {number} keyCode Key code.
         */
        setKey(button, keyCode) {
            const map = Input.keyMapper;
            const previous = map[keyCode];
            const old = this.keysFor(button);
            for (const k of old) {
                delete map[k];
            }
            map[keyCode] = button;
            if (previous && previous !== button && this.keysFor(previous).length === 0) {
                const give = old.find(k => k !== keyCode);
                if (give !== undefined) {
                    map[give] = previous;
                }
            }
            this.save();
        },

        /**
         * @brief Binds a gamepad button, swapping with its previous owner.
         * @param {string} button MZ button name.
         * @param {number} index Gamepad button index.
         */
        setPad(button, index) {
            const map = Input.gamepadMapper;
            const previous = map[index];
            const old = this.padFor(button);
            for (const i of old) {
                delete map[i];
            }
            map[index] = button;
            const give = old.find(i => i !== index);
            if (previous && previous !== button && give !== undefined) {
                map[give] = previous;
            }
            this.save();
        },

        /** @brief Restores MZ's default mappings. */
        reset() {
            Input.keyMapper = Object.assign({}, this.defaults.keys);
            Input.gamepadMapper = Object.assign({}, this.defaults.pad);
            this.save();
        },

        /** @brief Writes config.rmmzsave. */
        save() {
            Input.clear();
            ConfigManager.save();
        },
    };

    /** @return {Object} A copy of the current mappers. */
    function remap0() {
        return { keys: Object.assign({}, Input.keyMapper), pad: Object.assign({}, Input.gamepadMapper) };
    }

    UI.input.remap = remap;

    //=========================================================================
    // Config persistence
    //=========================================================================

    ConfigManager.pokemzUiAnimations = true;

    UI.patch(ConfigManager, "makeData", PLUGIN_NAME, orig =>
        function() {
            const config = orig.apply(this, arguments);
            config.pokemzUiAnimations = this.pokemzUiAnimations;
            config.pokemzKeyMapper = Object.assign({}, Input.keyMapper);
            config.pokemzGamepadMapper = Object.assign({}, Input.gamepadMapper);
            return config;
        }
    );

    UI.patch(ConfigManager, "applyData", PLUGIN_NAME, orig =>
        function(config) {
            orig.apply(this, arguments);
            this.pokemzUiAnimations = this.readFlag(config, "pokemzUiAnimations", true);
            if (config.pokemzKeyMapper && typeof config.pokemzKeyMapper === "object") {
                Input.keyMapper = Object.assign({}, config.pokemzKeyMapper);
            }
            if (config.pokemzGamepadMapper && typeof config.pokemzGamepadMapper === "object") {
                Input.gamepadMapper = Object.assign({}, config.pokemzGamepadMapper);
            }
        }
    );

    //=========================================================================
    // Options window entries
    //=========================================================================

    const CONTROLS = "pokemzControls";
    const ANIMATIONS = "pokemzUiAnimations";

    UI.patch(Window_Options.prototype, "addGeneralOptions", PLUGIN_NAME, orig =>
        function() {
            orig.apply(this, arguments);
            if (CONFIG.showAnimations) {
                this.addCommand(UI.t("UI.Options.Animations", "UI Animations"), ANIMATIONS);
            }
            if (CONFIG.showControls) {
                this.addCommand(UI.t("UI.Options.Controls", "Controls"), CONTROLS);
            }
        }
    );

    UI.patch(Window_Options.prototype, "statusText", PLUGIN_NAME, orig =>
        function(index) {
            return this.commandSymbol(index) === CONTROLS ? "" : orig.apply(this, arguments);
        }
    );

    UI.patch(Window_Options.prototype, "processOk", PLUGIN_NAME, orig =>
        function() {
            if (this.commandSymbol(this.index()) === CONTROLS) {
                SoundManager.playOk();
                UI.openScreen("controls");
                return;
            }
            orig.apply(this, arguments);
        }
    );

    for (const name of ["cursorRight", "cursorLeft"]) {
        UI.patch(Window_Options.prototype, name, PLUGIN_NAME, orig =>
            function() {
                if (this.commandSymbol(this.index()) !== CONTROLS) {
                    orig.apply(this, arguments);
                }
            }
        );
    }

    UI.patch(Scene_Options.prototype, "maxCommands", PLUGIN_NAME, orig =>
        function() {
            return orig.apply(this, arguments) + (CONFIG.showControls ? 1 : 0) + (CONFIG.showAnimations ? 1 : 0);
        }
    );

    //=========================================================================
    // Names for keys and buttons
    //=========================================================================

    const KEY_WORDS = {
        8: "Backspace",
        9: "Tab",
        13: "Enter",
        16: "Shift",
        17: "Ctrl",
        18: "Alt",
        27: "Escape",
        32: "Space",
        33: "PageUp",
        34: "PageDown",
        35: "End",
        36: "Home",
        45: "Insert",
        46: "Delete",
    };
    const KEY_SYMBOLS = { 37: "←", 38: "↑", 39: "→", 40: "↓", 186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\", 221: "]", 222: "'" };
    const PAD_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "LS", "RS", "✚↑", "✚↓", "✚←", "✚→", "Home"];

    /**
     * @brief Display name of a key code (words come from ui.csv UI.Key.*).
     * @param {number} code Key code.
     * @return {string} Name.
     */
    function keyName(code) {
        if (KEY_WORDS[code]) {
            return UI.t(`UI.Key.${KEY_WORDS[code]}`, KEY_WORDS[code]);
        }
        if (KEY_SYMBOLS[code]) {
            return KEY_SYMBOLS[code];
        }
        if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90)) {
            return String.fromCharCode(code);
        }
        if (code >= 96 && code <= 105) {
            return `${UI.t("UI.Key.Numpad", "Num")} ${code - 96}`;
        }
        return `#${code}`;
    }

    /**
     * @param {number} index Gamepad button index.
     * @return {string} Name (standard gamepad layout).
     */
    const padName = index => PAD_NAMES[index] || `#${index}`;

    //=========================================================================
    // Controls screen
    //=========================================================================

    /**
     * @brief Rows of the controls screen: action label, keyboard button and
     *        gamepad button (MZ names). Keyboard Escape counts as both
     *        cancel and menu in MZ, so "menu" may show no own key.
     */
    const ROWS = [
        { id: "ok", key: "ok", pad: "ok" },
        { id: "cancel", key: "escape", pad: "cancel" },
        { id: "menu", key: "menu", pad: "menu" },
        { id: "shift", key: "shift", pad: "shift" },
        { id: "pageup", key: "pageup", pad: "pageup" },
        { id: "pagedown", key: "pagedown", pad: "pagedown" },
        { id: "up", key: "up", pad: "up" },
        { id: "down", key: "down", pad: "down" },
        { id: "left", key: "left", pad: "left" },
        { id: "right", key: "right", pad: "right" },
    ];
    const ROW_LABELS = {
        ok: "OK",
        cancel: "Cancel",
        menu: "Menu",
        shift: "Dash",
        pageup: "Page Up",
        pagedown: "Page Down",
        up: "Up",
        down: "Down",
        left: "Left",
        right: "Right",
    };

    /**
     * @brief Waits for the next key or gamepad button while mounted.
     * @param {Object} props {device: "key"|"pad", onCapture(code), onCancel()}.
     */
    function CaptureOverlay({ device, onCapture, onCancel }) {
        const prompt = useText(device === "pad" ? "UI.Controls.PressButton" : "UI.Controls.PressKey", "Press a button…");
        const [left, setLeft] = useState(CONFIG.captureFrames);
        const before = useRef(null);
        const done = useRef(false);
        const finish = fn => {
            if (!done.current) {
                done.current = true;
                fn();
            }
        };

        useEffect(() => {
            UI.input.suspended++;
            const onKey = e => {
                e.preventDefault();
                e.stopPropagation();
                if (e.keyCode === 27) {
                    finish(onCancel);
                } else if (device === "key" && !RESERVED_KEYS.has(e.keyCode)) {
                    finish(() => onCapture(e.keyCode));
                }
            };
            document.addEventListener("keydown", onKey, true);
            return () => {
                document.removeEventListener("keydown", onKey, true);
                Input.clear();
                UI.input.suspended--;
            };
        }, []);

        useFrame(() => {
            if (done.current) {
                return;
            }
            setLeft(n => n - 1);
            if (left <= 1) {
                finish(onCancel);
                return;
            }
            if (device !== "pad" || !navigator.getGamepads) {
                return;
            }
            const pads = [...navigator.getGamepads()].filter(p => p && p.connected);
            const pressed = new Set();
            for (const p of pads) {
                p.buttons.forEach((b, i) => b.pressed && pressed.add(i));
            }
            if (before.current) {
                for (const i of pressed) {
                    if (!before.current.has(i)) {
                        finish(() => onCapture(i));
                        return;
                    }
                }
            }
            before.current = pressed;
        });

        return html`<div class="pmz-capture" onPointerUp=${() => finish(onCancel)}>
            <div class="pmz-panel pmz-capture-box">
                <div>${prompt}</div>
                <div class="pmz-capture-timer">${Math.ceil(left / 60)}</div>
            </div>
        </div>`;
    }

    /** @brief Options > Controls. */
    function ControlsScreen({ close }) {
        UI.useStrings();
        const [version, setVersion] = useState(0);
        const [capture, setCapture] = useState(null);
        const title = useText("UI.Controls.Title", "Controls");
        const keyboardLabel = useText("UI.Controls.Keyboard", "Keyboard");
        const gamepadLabel = useText("UI.Controls.Gamepad", "Gamepad");
        const resetLabel = useText("UI.Controls.Reset", "Reset to defaults");
        const sameAsCancel = useText("UI.Controls.SameAsCancel", "(= Cancel)");

        // Items: each row has a key cell and a pad cell, plus Reset at the end.
        const count = ROWS.length * 2 + 1;
        const cursor = useCursorList(count, {
            columns: 2,
            silentOk: true,
            enabled: !capture,
            onCancel: close,
            onOk: i => {
                if (i === count - 1) {
                    SoundManager.playOk();
                    remap.reset();
                    setVersion(v => v + 1);
                    UI.toast("UI.Controls.ResetDone", 90);
                    return;
                }
                SoundManager.playOk();
                const row = ROWS[Math.floor(i / 2)];
                setCapture({ row, device: i % 2 === 0 ? "key" : "pad" });
            },
        });

        const onCapture = code => {
            const { row, device } = capture;
            if (device === "key") {
                remap.setKey(row.key, code);
            } else {
                remap.setPad(row.pad, code);
            }
            SoundManager.playOk();
            setCapture(null);
            setVersion(v => v + 1);
        };

        const keyText = row => {
            const keys = remap.keysFor(row.key);
            if (!keys.length) {
                return row.id === "menu" ? sameAsCancel : "—";
            }
            return keys.slice(0, 3).map(keyName).join(" / ");
        };
        const padText = row => {
            const pads = remap.padFor(row.pad);
            return pads.length ? pads.map(padName).join(" / ") : "—";
        };

        return html`<div class="pmz-controls" data-version=${version}>
            <div class="pmz-panel pmz-title-bar">${title}</div>
            <div class="pmz-panel pmz-controls-table">
                <div class="pmz-controls-head">
                    <span />
                    <span>${keyboardLabel}</span>
                    <span>${gamepadLabel}</span>
                </div>
                <div class="pmz-controls-grid" ...${cursor.listProps}>
                    ${ROWS.map(
                        (row, r) => html`<div key=${row.id} class="pmz-controls-row">
                            <span class="pmz-controls-label">${UI.t(`UI.Controls.Action.${row.id}`, ROW_LABELS[row.id])}</span>
                            <div ...${cursor.itemProps(r * 2)}>${keyText(row)}</div>
                            <div ...${cursor.itemProps(r * 2 + 1)}>${padText(row)}</div>
                        </div>`
                    )}
                    <div class="pmz-controls-row is-reset">
                        <div ...${cursor.itemProps(count - 1)}>${resetLabel}</div>
                    </div>
                </div>
            </div>
            <${BackButton} onPress=${close} />
            ${capture
                ? html`<${CaptureOverlay}
                      device=${capture.device}
                      onCapture=${onCapture}
                      onCancel=${() => {
                          SoundManager.playCancel();
                          setCapture(null);
                      }}
                  />`
                : null}
        </div>`;
    }

    UI.registerScreen("controls", ControlsScreen, { transition: "fade" });
    Object.assign(UI.components, { ControlsScreen, CaptureOverlay });
    UI.controls = { rows: ROWS, keyName, padName };
})();
