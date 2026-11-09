//=============================================================================
// PokéMZ - UI_Controls.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.2.0] Controls screen (rebinding, accessibility), on-screen
 * touch controls, UI animation option.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_UI_Core
 * @base PokeMZ_Input
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
 * Requires PokeMZ_Input and PokeMZ_UI_Core above it.
 *
 * Options > Controls lists every action of PokeMZ_Input (movement, actions,
 * camera) with its keyboard key and gamepad button. Choose one and press
 * the new key or button. If it was used by another action the two swap, so
 * nothing is ever left unbound. The last rows reset the keyboard or the
 * gamepad, and open the accessibility options:
 *   Toggle run, tap to turn, Nintendo button layout (swap OK/Cancel),
 *   repeat delay and speed, long-press time, stick deadzone, input buffer,
 *   invert camera, button prompts style, rumble and its strength,
 *   touch controls (auto/on/off), their size and opacity.
 *
 * Everything is saved in config.rmmzsave by PokeMZ_Input.
 *
 * Player 2: the "Player 2: Join…" row (or the PokeMZ_Input command "Join
 * Local Player") waits for a second player to press OK/Start on their own
 * controller or the keyboard. Choose the row again to remove player 2.
 *
 * Touch controls: an on-screen D-pad with A, B, Menu and Run buttons. In
 * "auto" mode they show while the last input came from a touch screen.
 *
 * Script (compatibility with v0.1): PokeMZ.UI.input.remap.reset(),
 * .setKey(button, keyCode), .setPad(button, buttonIndex), .keysFor(button),
 * .padFor(button)
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_UI_Controls";
    const UI = window.PokeMZ && window.PokeMZ.UI;
    const P = window.PokeMZ && window.PokeMZ.Input;
    if (!UI || !P) {
        throw new Error(`${PLUGIN_NAME} requires PokeMZ_Input and PokeMZ_UI_Core above it in the plugin list.`);
    }
    const { html, useState, useEffect, useRef, useCursorList, useFrame, useText, useInputDevice } = UI;
    const { BackButton } = UI.components;

    const params = PluginManager.parameters(PLUGIN_NAME);
    const CONFIG = {
        showControls: UI.parseBool(params.showControls, true),
        showAnimations: UI.parseBool(params.showAnimations, true),
        captureFrames: Number(params.captureSeconds || 5) * 60,
    };

    //=========================================================================
    // Compatibility: MZ-style remapping API (v0.1)
    //=========================================================================

    const remap = {
        /**
         * @param {string} button MZ button name ("ok", "escape", ...).
         * @return {Array<number>} Key codes mapped to it.
         */
        keysFor: button =>
            Object.keys(Input.keyMapper)
                .filter(k => P.actionFor(Input.keyMapper[k]) === P.actionFor(button))
                .map(Number),

        /**
         * @param {string} button MZ button name.
         * @return {Array<number>} Gamepad button indices mapped to it.
         */
        padFor: button =>
            Object.keys(Input.gamepadMapper)
                .filter(k => P.actionFor(Input.gamepadMapper[k]) === P.actionFor(button))
                .map(Number),

        /**
         * @brief Binds a key as the button's primary key (swaps on conflict).
         * @param {string} button MZ button name.
         * @param {number} keyCode Key code.
         */
        setKey(button, keyCode) {
            P.bind(button, "keyboard", P.engine.sourceForKeyCode(keyCode), 0);
        },

        /**
         * @brief Binds a gamepad button as the primary one (swaps).
         * @param {string} button MZ button name.
         * @param {number} index Gamepad button index.
         */
        setPad(button, index) {
            P.bind(button, "gamepad", `pad:${index}`, 0);
        },

        /** @brief Restores the default bindings. */
        reset() {
            P.resetBindings();
        },

        /** @brief Writes config.rmmzsave. */
        save() {
            P.save();
        },
    };

    UI.input.remap = remap;

    //=========================================================================
    // Config persistence (UI animations; input is saved by PokeMZ_Input)
    //=========================================================================

    ConfigManager.pokemzUiAnimations = true;

    UI.patch(ConfigManager, "makeData", PLUGIN_NAME, orig =>
        function() {
            const config = orig.apply(this, arguments);
            config.pokemzUiAnimations = this.pokemzUiAnimations;
            return config;
        }
    );

    UI.patch(ConfigManager, "applyData", PLUGIN_NAME, orig =>
        function(config) {
            orig.apply(this, arguments);
            this.pokemzUiAnimations = this.readFlag(config, "pokemzUiAnimations", true);
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

    /**
     * @brief Display name of a key code.
     * @param {number} code Key code.
     * @return {string} Name.
     */
    const keyName = code => P.sourceName(P.engine.sourceForKeyCode(code), "keyboard");

    /**
     * @param {number} index Gamepad button index.
     * @return {string} Name (active gamepad family).
     */
    const padName = index => P.sourceName(`pad:${index}`);

    //=========================================================================
    // Controls screen
    //=========================================================================

    const SECTIONS = ["movement", "actions", "camera"];
    const SECTION_LABELS = { movement: "Movement", actions: "Actions", camera: "Camera" };

    /** @return {Array<Object>} Rebindable actions, grouped by section. */
    function rows() {
        const list = P.actions().filter(a => !a.hidden);
        const order = s => (SECTIONS.includes(s) ? SECTIONS.indexOf(s) : SECTIONS.length);
        return list.map((a, i) => ({ a, i })).sort((x, y) => order(x.a.section) - order(y.a.section) || x.i - y.i).map(x => x.a);
    }

    /**
     * @brief Label of an action (ui.csv key, then its own label).
     * @param {Object} a Action definition.
     * @return {string} Label.
     */
    const actionLabel = a => (a.labelKey ? UI.t(a.labelKey, a.label || a.id) : a.label || a.id);

    /**
     * @brief Waits for the next key or gamepad button while mounted.
     * @param {Object} props {device: "keyboard"|"gamepad", onCapture(source),
     *        onCancel()}.
     */
    function CaptureOverlay({ device, onCapture, onCancel }) {
        const prompt = useText(device === "gamepad" ? "UI.Controls.PressButton" : "UI.Controls.PressKey", "Press a button…");
        const [left, setLeft] = useState(CONFIG.captureFrames);
        const done = useRef(false);

        useEffect(() => {
            UI.input.suspended++;
            P.captureNext(device, { frames: CONFIG.captureFrames }).then(source => {
                if (done.current) {
                    return;
                }
                done.current = true;
                if (source) {
                    onCapture(source);
                } else {
                    onCancel();
                }
            });
            return () => {
                done.current = true;
                P.cancelCapture();
                UI.input.suspended--;
            };
        }, []);

        useFrame(() => setLeft(P.captureFramesLeft()));

        return html`<div class="pmz-capture" onPointerUp=${() => P.cancelCapture()}>
            <div class="pmz-panel pmz-capture-box">
                <div>${prompt}</div>
                <div class="pmz-capture-timer">${Math.ceil(left / 60)}</div>
            </div>
        </div>`;
    }

    /**
     * @brief Text of an action's bindings on a device (up to two).
     * @param {Object} a Action definition.
     * @param {string} device Device.
     * @param {string} family Gamepad family for names.
     * @return {string} Text.
     */
    function bindingText(a, device, family) {
        const list = P.bindings(a.id, device);
        if (!list.length) {
            if (a.fallback) {
                const fb = P.actions().find(x => x.id === a.fallback);
                return UI.t("UI.Controls.SameAs", "(= {action})").replace("{action}", fb ? actionLabel(fb) : a.fallback);
            }
            return "—";
        }
        const names = list.slice(0, 2).map(s => P.sourceName(s, device === "keyboard" ? "keyboard" : family));
        return names.join(" / ") + (list.length > 2 ? " …" : "");
    }

    /** @brief Options > Controls. */
    function ControlsScreen({ close }) {
        UI.useStrings();
        const dev = useInputDevice();
        const [capture, setCapture] = useState(null);
        const title = useText("UI.Controls.Title", "Controls");
        const keyboardLabel = useText("UI.Controls.Keyboard", "Keyboard");
        const gamepadLabel = useText("UI.Controls.Gamepad", "Gamepad");
        const resetKeys = useText("UI.Controls.ResetKeyboard", "Reset keyboard");
        const resetPad = useText("UI.Controls.ResetGamepad", "Reset gamepad");
        const accessLabel = useText("UI.Controls.Accessibility", "Accessibility…");
        const p2 = P.players.get(2);
        const playerLabel = !p2
            ? UI.t("UI.Controls.Player2Join", "Player 2: Join…")
            : p2.connected
            ? UI.t("UI.Controls.Player2Leave", "Player 2: Leave ({device})", { device: P.players.deviceName(p2.deviceId) })
            : UI.t("UI.Controls.Player2Lost", "Player 2: no controller (Join…)");

        const list = rows();
        // Items: each row has a key cell and a pad cell, then wide rows.
        const extra = ["resetKeyboard", "resetGamepad", "accessibility", "player2"];
        const count = list.length * 2 + extra.length;
        const cursor = useCursorList(count, {
            columns: 2,
            silentOk: true,
            enabled: !capture,
            onCancel: close,
            onOk: i => {
                SoundManager.playOk();
                if (i >= list.length * 2) {
                    const what = extra[i - list.length * 2];
                    if (what === "accessibility") {
                        UI.openScreen("inputOptions");
                    } else if (what === "player2") {
                        const cur = P.players.get(2);
                        if (cur && cur.connected) {
                            P.players.leave(2);
                            UI.toast(UI.t("UI.Players.Left", "Player {n} left.", { n: 2 }), 90);
                        } else {
                            UI.openScreen("joinPlayer", { player: 2 });
                        }
                    } else {
                        P.resetBindings(what === "resetKeyboard" ? "keyboard" : "gamepad");
                        UI.toast("UI.Controls.ResetDone", 90);
                    }
                    return;
                }
                setCapture({ action: list[Math.floor(i / 2)], device: i % 2 === 0 ? "keyboard" : "gamepad" });
            },
        });

        const onCapture = source => {
            const { action, device } = capture;
            P.bind(action.id, device, source, 0);
            SoundManager.playOk();
            setCapture(null);
        };

        let section = null;
        const body = [];
        list.forEach((a, r) => {
            if (a.section !== section) {
                section = a.section;
                body.push(
                    html`<div key=${`s-${section}`} class="pmz-controls-section">${UI.t(`UI.Controls.Section.${section}`, SECTION_LABELS[section] || section)}</div>`
                );
            }
            body.push(html`<div key=${a.id} class="pmz-controls-row">
                <span class="pmz-controls-label">${actionLabel(a)}</span>
                <div ...${cursor.itemProps(r * 2)}>${bindingText(a, "keyboard", dev.family)}</div>
                <div ...${cursor.itemProps(r * 2 + 1)}>${bindingText(a, "gamepad", dev.family)}</div>
            </div>`);
        });
        const base = list.length * 2;

        return html`<div class="pmz-controls" data-version=${dev.version}>
            <div class="pmz-panel pmz-title-bar">${title}</div>
            <div class="pmz-panel pmz-controls-table">
                <div class="pmz-controls-head">
                    <span />
                    <span>${keyboardLabel}</span>
                    <span>${gamepadLabel}</span>
                </div>
                <div class="pmz-controls-grid" ...${cursor.listProps}>
                    ${body}
                    <div class="pmz-controls-row is-reset">
                        <div ...${cursor.itemProps(base)}>${resetKeys}</div>
                        <div ...${cursor.itemProps(base + 1)}>${resetPad}</div>
                    </div>
                    <div class="pmz-controls-row is-wide">
                        <div ...${cursor.itemProps(base + 2)}>${accessLabel}</div>
                    </div>
                    <div class="pmz-controls-row is-wide">
                        <div ...${cursor.itemProps(base + 3)}>${playerLabel}</div>
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

    //=========================================================================
    // Joining a local player
    //=========================================================================

    /**
     * @brief Waits for a local player to press OK/Start on their own device.
     * @param {Object} props {player = 2, onDone(result|null), close}.
     */
    function JoinScreen({ player = 2, onDone, close }) {
        UI.useStrings();
        const [left, setLeft] = useState(600);
        const finished = useRef(false);
        const finish = result => {
            if (finished.current) {
                return;
            }
            finished.current = true;
            if (result) {
                SoundManager.playOk();
                UI.toast(UI.t("UI.Players.Joined", "Player {n} joined ({device}).", { n: result.index, device: P.players.deviceName(result.deviceId) }), 120);
                P.rumble(0.5, 0.5, 12, result.index);
            } else {
                SoundManager.playCancel();
            }
            if (onDone) {
                onDone(result);
            }
            close();
        };
        useEffect(() => {
            P.players.join(player).then(finish);
            return () => P.players.cancelJoin();
        }, []);
        useFrame(() => setLeft(P.players.joinFramesLeft()));
        // Player 1 can cancel with their own Cancel.
        UI.useFocus({ cancel: () => P.players.cancelJoin() }, { priority: 10 });
        return html`<div class="pmz-join">
            <div class="pmz-panel pmz-join-box">
                <div class="pmz-join-title">${UI.t("UI.Players.JoinTitle", "Player {n}", { n: player })}</div>
                <div>${UI.t("UI.Players.JoinPrompt", "Player {n}, press OK or Start on your own controller.", { n: player })}</div>
                <div class="pmz-join-timer">${Math.ceil(left / 60)}</div>
            </div>
            <${BackButton} onPress=${() => P.players.cancelJoin()} />
        </div>`;
    }

    // Tell everyone when player 2's controller goes away.
    if (!UI.controls || !UI.controls.lostHooked) {
        P.on("playerlost", index => UI.toast(UI.t("UI.Players.Lost", "Player {n}'s controller was disconnected.", { n: index }), 150));
    }

    //=========================================================================
    // Accessibility options screen
    //=========================================================================

    const MULT = [0.5, 0.75, 1, 1.5, 2, 3];

    /**
     * @brief Option rows: bool, or a list of values cycled with left/right.
     *        format(v) gives the value text.
     */
    const OPTION_ROWS = [
        { id: "toggleRun", label: "Toggle run" },
        { id: "tapToTurn", label: "Tap to turn" },
        { id: "swapConfirmBack", label: "Nintendo layout (swap OK/Cancel)" },
        { id: "repeatDelay", label: "Repeat delay", values: MULT, format: v => `×${v}` },
        { id: "repeatRate", label: "Repeat interval", values: MULT, format: v => `×${v}` },
        { id: "holdTime", label: "Long-press time", values: MULT, format: v => `×${v}` },
        { id: "deadzone", label: "Stick deadzone", values: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5], format: v => `${Math.round(v * 100)}%` },
        { id: "bufferFrames", label: "Input buffer", values: [0, 4, 8, 12, 16, 24], format: v => `${v}f` },
        { id: "invertCameraX", label: "Invert camera X" },
        { id: "invertCameraY", label: "Invert camera Y" },
        { id: "glyphStyle", label: "Button prompts", values: ["auto", "keyboard", "xbox", "playstation", "switch", "generic"], format: v => UI.t(`UI.Input.Style.${v}`, v) },
        { id: "rumble", label: "Rumble" },
        { id: "rumbleStrength", label: "Rumble strength", values: [0.25, 0.5, 0.75, 1], format: v => `${Math.round(v * 100)}%` },
        { id: "touchControls", label: "Touch controls", values: ["auto", "on", "off"], format: v => UI.t(`UI.Input.Touch.${v}`, v) },
        { id: "touchSize", label: "Touch controls size", values: [0.75, 1, 1.25, 1.5], format: v => `×${v}` },
        { id: "touchOpacity", label: "Touch controls opacity", values: [0.3, 0.45, 0.6, 0.8, 1], format: v => `${Math.round(v * 100)}%` },
    ];

    /**
     * @brief Moves an option one step.
     * @param {Object} row Option row.
     * @param {number} delta -1, 0 (toggle / next) or +1.
     */
    function stepOption(row, delta) {
        const v = P.option(row.id);
        if (!row.values) {
            P.setOption(row.id, !v);
            if (row.id === "rumble" && !v) {
                P.rumble(0.5, 0.5, 12);
            }
            return;
        }
        let i = row.values.indexOf(v);
        if (i < 0) {
            // Nearest value (options may hold any number from a save).
            i = row.values.reduce((best, x, j) => (typeof x === "number" && Math.abs(x - v) < Math.abs(row.values[best] - v) ? j : best), 0);
        }
        const n = row.values.length;
        const next = delta === 0 ? (i + 1) % n : Math.max(0, Math.min(n - 1, i + delta));
        P.setOption(row.id, row.values[next]);
        if (row.id === "rumbleStrength") {
            P.rumble(0.6, 0.6, 12);
        }
    }

    /** @brief Options > Controls > Accessibility. */
    function InputOptionsScreen({ close }) {
        UI.useStrings();
        const dev = useInputDevice();
        const title = useText("UI.Controls.Accessibility.Title", "Accessibility");
        const resetLabel = useText("UI.Controls.ResetOptions", "Reset options");
        const on = useText("UI.Common.On", "On");
        const off = useText("UI.Common.Off", "Off");
        const count = OPTION_ROWS.length + 1;
        const idx = useRef(0);
        const cursor = useCursorList(count, {
            silentOk: true,
            onCancel: close,
            onChange: i => (idx.current = i),
            onOk: i => {
                SoundManager.playCursor();
                if (i === OPTION_ROWS.length) {
                    P.resetOptions();
                    UI.toast("UI.Controls.ResetDone", 90);
                    return;
                }
                stepOption(OPTION_ROWS[i], 0);
            },
            handlers: {
                left: () => {
                    if (idx.current < OPTION_ROWS.length) {
                        SoundManager.playCursor();
                        stepOption(OPTION_ROWS[idx.current], -1);
                    }
                },
                right: () => {
                    if (idx.current < OPTION_ROWS.length) {
                        SoundManager.playCursor();
                        stepOption(OPTION_ROWS[idx.current], 1);
                    }
                },
            },
        });

        return html`<div class="pmz-controls pmz-input-options" data-version=${dev.version}>
            <div class="pmz-panel pmz-title-bar">${title}</div>
            <div class="pmz-panel pmz-controls-table">
                <div class="pmz-controls-grid" ...${cursor.listProps}>
                    ${OPTION_ROWS.map((row, i) => {
                        const v = P.option(row.id);
                        const text = row.values ? (row.format ? row.format(v) : String(v)) : v ? on : off;
                        return html`<div key=${row.id} ...${cursor.itemProps(i, "pmz-option-row")}>
                            <span class="pmz-option-label">${UI.t(`UI.Controls.Option.${row.id}`, row.label)}</span>
                            <span class="pmz-option-value">${text}</span>
                        </div>`;
                    })}
                    <div ...${cursor.itemProps(OPTION_ROWS.length)}>${resetLabel}</div>
                </div>
            </div>
            <${BackButton} onPress=${close} />
        </div>`;
    }

    //=========================================================================
    // Touch controls (system layer)
    //=========================================================================

    /**
     * @brief Hold-to-press props for a touch button.
     * @param {string} action Input action.
     * @return {Object} Pointer props.
     */
    function holdProps(action) {
        const up = e => {
            e.stopPropagation();
            P.setVirtual(action, false);
        };
        return {
            onPointerDown: e => {
                e.stopPropagation();
                if (e.currentTarget.setPointerCapture) {
                    e.currentTarget.setPointerCapture(e.pointerId);
                }
                P.setVirtual(action, true, e.pointerType === "mouse" ? "mouse" : "touch");
            },
            onPointerUp: up,
            onPointerCancel: up,
            onLostPointerCapture: up,
        };
    }

    /** @brief On-screen D-pad: slide between directions without lifting. */
    function TouchDpad() {
        const held = useRef("");
        const set = dir => {
            if (held.current === dir) {
                return;
            }
            if (held.current) {
                P.setVirtual(held.current, false);
            }
            held.current = dir;
            if (dir) {
                P.setVirtual(dir, true, "touch");
            }
        };
        const aim = e => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - (r.left + r.width / 2);
            const y = e.clientY - (r.top + r.height / 2);
            if (Math.hypot(x, y) < r.width * 0.12) {
                set("");
                return;
            }
            set(Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up");
        };
        useEffect(() => () => set(""), []);
        return html`<div
            class="pmz-touch-dpad"
            onPointerDown=${e => {
                e.stopPropagation();
                if (e.currentTarget.setPointerCapture) {
                    e.currentTarget.setPointerCapture(e.pointerId);
                }
                aim(e);
            }}
            onPointerMove=${e => held.current && aim(e)}
            onPointerUp=${e => {
                e.stopPropagation();
                set("");
            }}
            onPointerCancel=${() => set("")}
            onLostPointerCapture=${() => set("")}
        >
            <span class="pmz-touch-arrow is-up">▲</span>
            <span class="pmz-touch-arrow is-down">▼</span>
            <span class="pmz-touch-arrow is-left">◀</span>
            <span class="pmz-touch-arrow is-right">▶</span>
        </div>`;
    }

    /** @brief The touch controls overlay, shown per the touchControls option. */
    function TouchControls() {
        const dev = useInputDevice();
        const [, setTick] = useState(0);
        useEffect(() => P.on("contextchange", () => setTick(n => n + 1)), []);
        const mode = P.option("touchControls");
        const show = mode === "on" || (mode === "auto" && dev.device === "touch");
        if (!show || P.textEntry) {
            return null;
        }
        const style = { "--pmz-touch-scale": P.option("touchSize"), opacity: P.option("touchOpacity") };
        return html`<div class="pmz-touch" style=${style} data-version=${dev.version}>
            <${TouchDpad} />
            <div class="pmz-touch-buttons">
                <div class="pmz-touch-button is-confirm" ...${holdProps("confirm")}>A</div>
                <div class="pmz-touch-button is-back" ...${holdProps("back")}>B</div>
                <div class="pmz-touch-button is-small is-menu" ...${holdProps("menu")}>${UI.t("UI.Input.TouchMenu", "Menu")}</div>
                <div class="pmz-touch-button is-small is-run" ...${holdProps("run")}>${UI.t("UI.Input.TouchRun", "Run")}</div>
            </div>
        </div>`;
    }

    // Mount once the overlay host exists; replace the old mount on hot reload.
    if (UI.controls && UI.controls.touchMount) {
        UI.controls.touchMount.unmount();
    }
    const touch = { mount: null };
    UI.addHook({
        onFrame() {
            if (!touch.mount) {
                touch.mount = UI.mount("system", () => html`<${TouchControls} />`);
                UI.controls.touchMount = touch.mount;
            }
        },
    });

    UI.registerScreen("controls", ControlsScreen, { transition: "fade" });
    UI.registerScreen("inputOptions", InputOptionsScreen, { transition: "fade" });
    UI.registerScreen("joinPlayer", JoinScreen, { transition: "fade" });
    Object.assign(UI.components, { ControlsScreen, InputOptionsScreen, JoinScreen, CaptureOverlay, TouchControls });

    /** @brief Legacy rows (MZ names), kept for scripts written against v0.1. */
    const LEGACY_ROWS = [
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
    UI.controls = Object.assign(UI.controls || {}, { rows: LEGACY_ROWS, actionRows: rows, optionRows: OPTION_ROWS, keyName, padName, touchMount: touch.mount, lostHooked: true });
})();
