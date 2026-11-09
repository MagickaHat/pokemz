//=============================================================================
// PokéMZ - UI_Messages.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Preact message box, choices, number input, name entry.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_UI_Core
 * @orderAfter PokeMZ_UI_Core
 *
 * @param replaceEventMessages
 * @text Replace Show Text / Choices
 * @desc Event messages and choices use the Preact message box.
 * Select Item and Scroll Text still use MZ's windows.
 * @type boolean
 * @default true
 *
 * @param replaceNumberInput
 * @text Replace Input Number
 * @type boolean
 * @default true
 *
 * @param replaceNameInput
 * @text Replace Name Input
 * @desc The "Name Input Processing" event command opens the Preact name
 * entry screen instead of Scene_Name.
 * @type boolean
 * @default true
 *
 * @param charsPerFrame
 * @text Text Speed (chars per frame)
 * @type number
 * @decimals 1
 * @min 0.1
 * @default 1
 *
 * @param lines
 * @text Message Lines
 * @desc Visible lines in the message box.
 * @type number
 * @min 1
 * @max 6
 * @default 4
 *
 * @help
 * ============================================================================
 * PokeMZ_UI_Messages
 * ============================================================================
 * Requires PokeMZ_UI_Core above it.
 *
 * Event messages keep working as in MZ (\V \N \P \G \C \I \{ \} \. \| \! \>
 * \< \^ \$, faces, speaker names, positions, backgrounds), shown by Preact.
 * OK, cancel, a click or a tap anywhere advances; choices, number input and
 * the on-screen keyboard work with keys, gamepad, mouse and touch.
 *
 * Script API (all return promises):
 *   PokeMZ.UI.message(text, {face, faceIndex, name, position})
 *   PokeMZ.UI.choose(["Yes", "No"], {text, cancel: -1, default: 0})
 *   PokeMZ.UI.confirm(text)
 *   PokeMZ.UI.inputNumber(digits, initial, {text})
 *   PokeMZ.UI.enterName({actorId, initial, maxLength})
 *
 * Styling is CSS only (css/pokemz-ui.css); swap in graphics by overriding
 * the .pmz-message, .pmz-choices, .pmz-number and .pmz-keyboard classes.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_UI_Messages";
    const UI = window.PokeMZ && window.PokeMZ.UI;
    if (!UI) {
        throw new Error(`${PLUGIN_NAME} requires PokeMZ_UI_Core above it in the plugin list.`);
    }
    const { html, useState, useEffect, useRef, useMemo, useReducer, useFocus, useCursorList, usePress, useFrame, useText } = UI;
    const { Face, Icon, Button, BackButton, Transition } = UI.components;

    const params = PluginManager.parameters(PLUGIN_NAME);
    const CONFIG = {
        replaceEventMessages: UI.parseBool(params.replaceEventMessages, true),
        replaceNumberInput: UI.parseBool(params.replaceNumberInput, true),
        replaceNameInput: UI.parseBool(params.replaceNameInput, true),
        charsPerFrame: Number(params.charsPerFrame || 1),
        lines: Number(params.lines || 4),
    };

    /** @brief Focus priority of message UI (above screens). */
    const MESSAGE_PRIORITY = 10;

    //=========================================================================
    // Message box
    //=========================================================================

    /**
     * @brief Index of the page break at or after a token (or the end).
     * @param {Array<Object>} tokens Tokens.
     * @param {number} from Start index.
     * @return {number} End of the page.
     */
    function pageEnd(tokens, from) {
        for (let i = from; i < tokens.length; i++) {
            if (tokens[i].t === "page") {
                return i;
            }
        }
        return tokens.length;
    }

    /**
     * @brief A typewriter message box that understands MZ's text codes. The
     *        rest of the page is laid out invisibly, so the browser's line
     *        breaking (correct for every script, from the page's lang) never
     *        moves a word to the next line halfway through typing it.
     * @param {Object} props {text, face, faceIndex, name, position (0-2),
     *        background (0-2), keepOpen (true when choices/number follow),
     *        onDone(), children (shown when the text has finished)}.
     */
    function MessageBox(props) {
        const { face, faceIndex = 0, name, position = 2, background = 0, keepOpen, onDone, children } = props;
        const tokens = useMemo(() => UI.tokenize(UI.convertEscapes(props.text || "")), [props.text]);
        const st = useRef(null);
        if (!st.current || st.current.tokens !== tokens) {
            st.current = { tokens, pos: 0, pageStart: 0, wait: 0, fast: false, showFast: false, noPause: false, state: "typing", gold: false, acc: 0 };
        }
        const [, force] = useReducer(x => x + 1, 0);

        /** @brief Advances the typewriter for one frame. */
        const step = () => {
            const s = st.current;
            if (s.state !== "typing") {
                return;
            }
            if (s.wait > 0 && !s.showFast) {
                s.wait--;
                return;
            }
            s.acc += CONFIG.charsPerFrame;
            let changed = false;
            while (s.pos < s.tokens.length) {
                const tok = s.tokens[s.pos];
                if (tok.t === "page") {
                    s.state = "pause";
                    s.pageBreak = true;
                    break;
                }
                if (tok.t === "char" && !s.fast && !s.showFast) {
                    if (s.acc < 1) {
                        break;
                    }
                    s.acc--;
                }
                s.pos++;
                changed = true;
                if (tok.t === "wait" && !s.showFast) {
                    s.wait = tok.n;
                    break;
                } else if (tok.t === "pause") {
                    s.state = "pause";
                    s.showFast = false;
                    break;
                } else if (tok.t === "fast") {
                    s.fast = tok.on;
                } else if (tok.t === "noPause") {
                    s.noPause = true;
                } else if (tok.t === "gold") {
                    s.gold = true;
                }
            }
            s.acc = Math.min(s.acc, 1);
            if (s.pos >= s.tokens.length && s.state === "typing") {
                s.state = "end";
                if (s.noPause && !keepOpen) {
                    s.state = "done";
                    onDone();
                }
            }
            if (changed || s.state !== "typing") {
                force();
            }
        };

        /** @brief OK / tap: finish the page, continue, or close. */
        const advance = () => {
            const s = st.current;
            if (s.state === "typing") {
                s.showFast = true;
                step();
                return;
            }
            if (s.state === "pause") {
                if (s.pageBreak) {
                    s.pageBreak = false;
                    s.pos++;
                    s.pageStart = s.pos;
                }
                s.state = "typing";
                s.showFast = false;
                force();
                return;
            }
            if (s.state === "end" && !keepOpen) {
                s.state = "done";
                onDone();
            }
        };

        useFrame(step);
        const s = st.current;
        const waitingInput = s.state === "end" && keepOpen;
        useFocus({ ok: advance, cancel: advance }, { priority: MESSAGE_PRIORITY, enabled: !waitingInput && s.state !== "done" });
        const press = usePress(() => !waitingInput && advance());

        const nameText = name ? UI.stripCodes(UI.convertEscapes(name)) : "";
        const showArrow = s.state === "pause" || (s.state === "end" && !keepOpen);
        const posClass = ["top", "middle", "bottom"][position] || "bottom";
        const bgClass = ["window", "dim", "transparent"][background] || "window";
        return html`<div class=${`pmz-message-area is-${posClass}`} style=${{ "--pmz-message-lines": CONFIG.lines }} ...${press}>
            ${s.gold ? html`<${GoldBox} />` : null}
            ${waitingInput ? children : null}
            <div class=${`pmz-message is-${bgClass}`}>
                ${nameText ? html`<div class="pmz-message-name">${nameText}</div>` : null}
                ${face ? html`<${Face} name=${face} index=${faceIndex} class="pmz-message-face" />` : null}
                <div class="pmz-message-text">
                    ${UI.richNodes(s.tokens, s.pageStart, s.pos)}
                    <span class="pmz-unrevealed" aria-hidden="true">${UI.richNodes(s.tokens, s.pos, pageEnd(s.tokens, s.pos))}</span>
                </div>
                ${showArrow ? html`<div class="pmz-message-arrow" />` : null}
            </div>
        </div>`;
    }

    /** @brief The gold window opened by \$. */
    function GoldBox() {
        const gold = UI.useGold();
        return html`<div class="pmz-panel pmz-gold">${gold} ${TextManager.currencyUnit}</div>`;
    }

    //=========================================================================
    // Choices
    //=========================================================================

    /**
     * @brief A choice box.
     * @param {Object} props {choices: [string], defaultIndex, cancelType
     *        (-1 = no cancel; any other value is returned on cancel),
     *        position (0 left, 1 center, 2 right), onChoose(index)}.
     */
    function ChoiceList(props) {
        const { choices, cancelType = -1, position = 2, onChoose } = props;
        const canCancel = cancelType !== -1;
        const cursor = useCursorList(choices.length, {
            initial: Math.max(0, props.defaultIndex || 0),
            onOk: i => onChoose(i),
            onCancel: canCancel ? () => onChoose(cancelType) : undefined,
            priority: MESSAGE_PRIORITY + 1,
        });
        const posClass = ["left", "center", "right"][position] || "right";
        return html`<div class=${`pmz-panel pmz-choices is-${posClass}`} onPointerUp=${e => e.stopPropagation()}>
            <div class="pmz-list" ...${cursor.listProps}>
                ${choices.map((c, i) => html`<div key=${i} ...${cursor.itemProps(i)}><${UI.components.RichText} text=${c} /></div>`)}
            </div>
            ${canCancel
                ? html`<${BackButton}
                      class="pmz-choices-back"
                      onPress=${() => onChoose(cancelType)}
                  />`
                : null}
        </div>`;
    }

    //=========================================================================
    // Number input
    //=========================================================================

    /**
     * @brief Digit-by-digit number entry.
     * @param {Object} props {digits, value, onDone(number), onCancel?}.
     */
    function NumberInput(props) {
        const digits = Math.max(1, Math.min(8, props.digits || 1));
        const max = Math.pow(10, digits) - 1;
        const [value, setValue] = useState(Math.max(0, Math.min(max, props.value || 0)));
        const [col, setCol] = useState(digits - 1);
        const ok = useText("UI.Common.OK", "OK");
        const valueRef = useRef(value);
        valueRef.current = value;

        const digitAt = (v, c) => Math.floor(v / Math.pow(10, digits - 1 - c)) % 10;
        const change = (c, delta) => {
            const place = Math.pow(10, digits - 1 - c);
            const d = digitAt(valueRef.current, c);
            const nd = (d + delta + 10) % 10;
            setValue(valueRef.current + (nd - d) * place);
            SoundManager.playCursor();
        };
        const moveCol = d => {
            const next = (col + d + digits) % digits;
            if (next !== col) {
                SoundManager.playCursor();
                setCol(next);
            }
        };
        const confirm = () => {
            SoundManager.playOk();
            props.onDone(valueRef.current);
        };
        useFocus(
            {
                up: () => change(col, 1),
                down: () => change(col, -1),
                left: () => moveCol(-1),
                right: () => moveCol(1),
                ok: confirm,
                cancel: props.onCancel
                    ? () => {
                          SoundManager.playCancel();
                          props.onCancel();
                      }
                    : undefined,
            },
            { priority: MESSAGE_PRIORITY + 1 }
        );

        const cells = [];
        for (let c = 0; c < digits; c++) {
            cells.push(html`<div key=${c} class=${`pmz-number-cell${c === col ? " is-selected" : ""}`}>
                <${Button} class="pmz-number-up" sound="" onPress=${() => (setCol(c), change(c, 1))}>▲<//>
                <div class="pmz-number-digit" onPointerUp=${() => c !== col && (SoundManager.playCursor(), setCol(c))}>
                    ${digitAt(value, c)}
                </div>
                <${Button} class="pmz-number-down" sound="" onPress=${() => (setCol(c), change(c, -1))}>▼<//>
            </div>`);
        }
        return html`<div class="pmz-panel pmz-number" onPointerUp=${e => e.stopPropagation()}>
            <div class="pmz-number-cells">${cells}</div>
            <${Button} class="pmz-number-ok" sound="" onPress=${confirm}><${UI.components.ButtonHint} action="ok" />${ok}<//>
        </div>`;
    }

    //=========================================================================
    // Event message controller ($gameMessage -> Preact)
    //=========================================================================

    /**
     * @return {boolean} True if the current $gameMessage content is handled
     *         by this plugin (not by MZ's windows).
     */
    function handlesCurrent() {
        if (!CONFIG.replaceEventMessages || !$gameMessage) {
            return false;
        }
        if ($gameMessage.isItemChoice() || $gameMessage.scrollMode()) {
            return false;
        }
        if ($gameMessage.isNumberInput() && !CONFIG.replaceNumberInput) {
            return false;
        }
        return $gameMessage.isBusy();
    }

    let controllerActive = false;

    UI.patch(Window_Message.prototype, "canStart", PLUGIN_NAME, orig =>
        function() {
            return orig.apply(this, arguments) && !controllerActive && !handlesCurrent();
        }
    );
    UI.patch(Window_Message.prototype, "startInput", PLUGIN_NAME, orig =>
        function() {
            if (controllerActive || handlesCurrent()) {
                return false;
            }
            return orig.apply(this, arguments);
        }
    );

    /**
     * @brief Copies what the interpreter put into $gameMessage.
     * @return {Object} Message snapshot.
     */
    function snapshot() {
        return {
            id: Date.now() + Math.random(),
            text: $gameMessage.hasText() ? $gameMessage.allText() : "",
            face: $gameMessage.faceName(),
            faceIndex: $gameMessage.faceIndex(),
            name: $gameMessage.speakerName(),
            position: $gameMessage.positionType(),
            background: $gameMessage.background(),
            choices: $gameMessage.isChoice() ? $gameMessage.choices().slice() : null,
            choiceDefault: $gameMessage.choiceDefaultType(),
            choiceCancel: $gameMessage.choiceCancelType(),
            choicePosition: $gameMessage.choicePositionType(),
            numberVar: $gameMessage.isNumberInput() ? $gameMessage.numInputVariableId() : 0,
            numberDigits: $gameMessage.numInputMaxDigits(),
        };
    }

    /** @brief Shows $gameMessage content on Scene_Map and Scene_Battle. */
    function EventMessages() {
        const [msg, setMsg] = useState(null);
        const msgRef = useRef(null);
        useEffect(() => () => (controllerActive = false), []);

        useFrame(() => {
            if (msgRef.current || !handlesCurrent()) {
                return;
            }
            const m = snapshot();
            msgRef.current = m;
            controllerActive = true;
            setMsg(m);
        });

        const finish = apply => {
            if (apply) {
                apply();
            }
            $gameMessage.clear();
            msgRef.current = null;
            controllerActive = false;
            setMsg(null);
        };

        if (!msg) {
            return null;
        }
        const input = msg.choices
            ? html`<${ChoiceList}
                  choices=${msg.choices}
                  defaultIndex=${msg.choiceDefault}
                  cancelType=${msg.choiceCancel}
                  position=${msg.choicePosition}
                  onChoose=${i => finish(() => $gameMessage.onChoice(i))}
              />`
            : msg.numberVar
            ? html`<${NumberInput}
                  digits=${msg.numberDigits}
                  value=${$gameVariables.value(msg.numberVar)}
                  onDone=${n => finish(() => $gameVariables.setValue(msg.numberVar, n))}
              />`
            : null;
        if (!msg.text) {
            return html`<div key=${msg.id} class="pmz-message-area is-bottom is-input-only">${input}</div>`;
        }
        return html`<${MessageBox}
            key=${msg.id}
            text=${msg.text}
            face=${msg.face}
            faceIndex=${msg.faceIndex}
            name=${msg.name}
            position=${msg.position}
            background=${msg.background}
            keepOpen=${!!input}
            onDone=${() => finish()}
        >
            ${input}
        <//>`;
    }

    UI.attach(Scene_Message, "PokeMZ.EventMessages", EventMessages, { layer: "message" });

    //=========================================================================
    // Promise API
    //=========================================================================

    /**
     * @brief Mounts a component in the message layer until it calls done().
     * @param {function(Function): Object} build Receives done(result).
     * @return {Promise<*>} The result.
     */
    function runModal(build) {
        return new Promise(resolve => {
            let handle = null;
            const done = result => {
                if (handle) {
                    handle.unmount();
                    handle = null;
                }
                resolve(result);
            };
            handle = UI.mount("message", () => build(done));
        });
    }

    /**
     * @brief Shows a message and waits until it is dismissed.
     * @param {string} text Text (MZ codes allowed).
     * @param {Object} [opts] {face, faceIndex, name, position, background}.
     * @return {Promise<void>} Resolves when closed.
     */
    UI.message = (text, opts = {}) =>
        runModal(done => html`<${MessageBox} text=${text} ...${opts} onDone=${() => done()} />`);

    /**
     * @brief Shows choices (optionally with a message).
     * @param {Array<string>} choices Choice labels.
     * @param {Object} [opts] {text, cancel (-1 = none), default, position, ...message opts}.
     * @return {Promise<number>} The chosen index (or opts.cancel).
     */
    UI.choose = (choices, opts = {}) =>
        runModal(done => {
            const list = html`<${ChoiceList}
                choices=${choices}
                defaultIndex=${opts.default || 0}
                cancelType=${opts.cancel !== undefined ? opts.cancel : -1}
                position=${opts.choicePosition !== undefined ? opts.choicePosition : 2}
                onChoose=${done}
            />`;
            return opts.text
                ? html`<${MessageBox} text=${opts.text} ...${opts} keepOpen=${true} onDone=${() => 0}>${list}<//>`
                : html`<div class="pmz-message-area is-bottom is-input-only">${list}</div>`;
        });

    /**
     * @brief Yes/No question.
     * @param {string} text Question.
     * @return {Promise<boolean>} True for yes.
     */
    UI.confirm = (text, opts = {}) =>
        UI.choose([UI.t("UI.Common.Yes", "Yes"), UI.t("UI.Common.No", "No")], Object.assign({ text, cancel: 1 }, opts)).then(
            i => i === 0
        );

    /**
     * @brief Number entry.
     * @param {number} digits Digit count.
     * @param {number} [initial] Start value.
     * @param {Object} [opts] {text}.
     * @return {Promise<number>} The number.
     */
    UI.inputNumber = (digits, initial = 0, opts = {}) =>
        runModal(done => {
            const input = html`<${NumberInput} digits=${digits} value=${initial} onDone=${done} />`;
            return opts.text
                ? html`<${MessageBox} text=${opts.text} ...${opts} keepOpen=${true} onDone=${() => 0}>${input}<//>`
                : html`<div class="pmz-message-area is-bottom is-input-only">${input}</div>`;
        });

    //=========================================================================
    // On-screen keyboard
    //=========================================================================

    /**
     * @brief Splits text into user-perceived characters (PokeMZ_Locale's
     *        grapheme clusters when available, else code points).
     * @param {string} text Text.
     * @return {Array<string>} Characters.
     */
    const chars = text => (window.PokeMZ.L10n ? window.PokeMZ.L10n.graphemes(text) : [...text]);

    /**
     * @brief Keyboard pages. With PokeMZ_Locale they come from
     *        data/locales/keyboards.csv (the language's layout, mirroring the
     *        physical keyboard when detected); these are the fallback. Each
     *        page: {labelKey, fallback, rows: [string]}, or {label, rows:
     *        [[key]]}. Every character in a row string is one key.
     */
    const keyboard = {
        /** @return {Array<Object>} Pages for the current language. */
        currentPages() {
            const fromLocale = window.PokeMZ.L10n && window.PokeMZ.L10n.keyboardPages();
            return fromLocale && fromLocale.length ? fromLocale : this.pages;
        },
        pages: [
            { labelKey: "UI.Keyboard.Upper", fallback: "ABC", rows: ["ABCDEFGHIJ", "KLMNOPQRST", "UVWXYZ.,'-"] },
            { labelKey: "UI.Keyboard.Lower", fallback: "abc", rows: ["abcdefghij", "klmnopqrst", "uvwxyz.,'-"] },
            { labelKey: "UI.Keyboard.Symbols", fallback: "123", rows: ["0123456789", "!?♂♀/&()…:", "\"~*#%+=;@·"] },
            { labelKey: "UI.Keyboard.Accents", fallback: "ÀÉ", rows: ["ÀÁÂÃÄÇÈÉÊË", "ÌÍÎÏÑÒÓÔÕÖ", "ÙÚÛÜàáâãäç", "èéêëìíîïñò", "óôõöùúûü¿¡"] },
        ],
        /** @brief Control row: ids and their string keys. */
        controls: [
            { id: "page", labelKey: "UI.Keyboard.Page", fallback: "Page" },
            { id: "space", labelKey: "UI.Keyboard.Space", fallback: "Space" },
            { id: "back", labelKey: "UI.Keyboard.Delete", fallback: "Del" },
            { id: "ok", labelKey: "UI.Common.OK", fallback: "OK" },
        ],
    };

    /**
     * @brief Grid keyboard driven by keys, gamepad, mouse and touch; a
     *        physical keyboard can also type directly (desktop).
     * @param {Object} props {onChar(c), onBack(), onOk(), onCancel(),
     *        priority}.
     */
    function OnScreenKeyboard(props) {
        UI.useStrings();
        const [pageIndex, setPage] = useState(0);
        const [cur, setCur] = useState({ r: 0, c: 0 });
        const pages = keyboard.currentPages();
        const page = pages[pageIndex % pages.length];
        const pageLabel = page.label !== undefined ? page.label : UI.t(page.labelKey, page.fallback);
        const rows = page.rows.map(r => (Array.isArray(r) ? r : chars(r)).map(ch => ({ ch })));
        rows.push(keyboard.controls.map(k => ({ ctrl: k.id, label: UI.t(k.labelKey, k.fallback) })));
        const r = Math.min(cur.r, rows.length - 1);
        const c = Math.min(cur.c, rows[r].length - 1);
        const propsRef = useRef(props);
        propsRef.current = props;
        const inputRef = useRef(null);

        const press = key => {
            const p = propsRef.current;
            if (key.ch) {
                SoundManager.playOk();
                p.onChar(key.ch);
            } else if (key.ctrl === "page") {
                SoundManager.playCursor();
                setPage(i => (i + 1) % keyboard.currentPages().length);
            } else if (key.ctrl === "space") {
                SoundManager.playOk();
                p.onChar(" ");
            } else if (key.ctrl === "back") {
                SoundManager.playCancel();
                p.onBack();
            } else if (key.ctrl === "ok") {
                p.onOk();
            }
        };

        const move = (dr, dc) => {
            let nr = r;
            let nc = c;
            if (dr) {
                nr = (r + dr + rows.length) % rows.length;
                // Keep roughly the same horizontal position between rows.
                nc = Math.min(rows[nr].length - 1, Math.floor(((c + 0.5) * rows[nr].length) / rows[r].length));
            } else {
                nc = (c + dc + rows[r].length) % rows[r].length;
            }
            SoundManager.playCursor();
            setCur({ r: nr, c: nc });
        };

        const { isTop } = useFocus(
            {
                up: () => move(-1, 0),
                down: () => move(1, 0),
                left: () => move(0, -1),
                right: () => move(0, 1),
                ok: () => press(rows[r][c]),
                cancel: () => propsRef.current.onCancel(),
                shift: () => press({ ctrl: "page" }),
                pageup: () => press({ ctrl: "page" }),
                pagedown: () => press({ ctrl: "page" }),
            },
            { priority: props.priority || 0 }
        );

        // Typing on a physical keyboard (desktop only; mobile uses the grid).
        // While the field has focus PokeMZ_Input treats it as text entry, so
        // typed letters (Z, X, Space...) don't also act as game buttons.
        useEffect(() => {
            const el = inputRef.current;
            if (!el || Utils.isMobileDevice()) {
                return undefined;
            }
            el.focus({ preventScroll: true });
            const keydown = e => {
                if (e.isComposing) {
                    e.stopPropagation();
                    return;
                }
                if (e.key === "Backspace") {
                    e.preventDefault();
                    e.stopPropagation();
                    SoundManager.playCancel();
                    propsRef.current.onBack();
                } else if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    propsRef.current.onOk();
                }
            };
            const onInput = e => {
                if (e.isComposing) {
                    return;
                }
                for (const ch of chars(el.value)) {
                    propsRef.current.onChar(ch);
                }
                el.value = "";
            };
            const refocus = () => setTimeout(() => el.isConnected && el.focus({ preventScroll: true }), 0);
            el.addEventListener("keydown", keydown);
            el.addEventListener("input", onInput);
            el.addEventListener("compositionend", onInput);
            el.addEventListener("blur", refocus);
            return () => {
                el.removeEventListener("blur", refocus);
                el.blur();
            };
        }, []);

        return html`<div class="pmz-panel pmz-keyboard">
            <input ref=${inputRef} class="pmz-keyboard-capture" type="text" autocomplete="off" aria-hidden="true" />
            <div class="pmz-keyboard-page">${pageLabel}</div>
            ${rows.map(
                (row, ri) => html`<div key=${`${pageIndex}-${ri}`} class=${`pmz-keyboard-row${ri === rows.length - 1 ? " is-controls" : ""}`}>
                    ${row.map((key, ci) => {
                        const selected = ri === r && ci === c;
                        return html`<${KeyCap}
                            key=${ci}
                            label=${key.ch || key.label}
                            selected=${selected}
                            ctrl=${key.ctrl}
                            onHover=${() => isTop() && !selected && setCur({ r: ri, c: ci })}
                            onPress=${() => {
                                setCur({ r: ri, c: ci });
                                press(key);
                            }}
                        />`;
                    })}
                </div>`
            )}
        </div>`;
    }

    /** @brief One key of the on-screen keyboard. */
    function KeyCap({ label, selected, ctrl, onHover, onPress }) {
        const press = usePress(onPress);
        return html`<div
            class=${`pmz-key${selected ? " is-selected" : ""}${ctrl ? ` is-ctrl is-${ctrl}` : ""}`}
            onPointerEnter=${e => e.pointerType === "mouse" && onHover()}
            ...${press}
        >
            ${label}
        </div>`;
    }

    //=========================================================================
    // Name entry screen
    //=========================================================================

    /**
     * @brief Name entry. Props: {actorId, initial, maxLength, onDone(name)}.
     *        With actorId, confirming sets that actor's name.
     */
    function NameInputScreen(props) {
        const actor = props.actorId ? $gameActors.actor(props.actorId) : null;
        const maxLength = Math.max(1, props.maxLength || 8);
        const initial = props.initial !== undefined ? props.initial : actor ? actor.name() : "";
        const [name, setName] = useState(chars(initial).slice(0, maxLength).join(""));
        const nameRef = useRef(name);
        nameRef.current = name;
        const title = useText("UI.Name.Title", "Enter a name");
        const done = useRef(false);

        const finish = value => {
            if (done.current) {
                return;
            }
            done.current = true;
            if (actor && value !== null) {
                actor.setName(value);
            }
            if (props.onDone) {
                props.onDone(value);
            }
            props.close();
        };

        const onChar = ch =>
            setName(n => {
                // A combining accent typed after a letter joins it.
                const next = (n + ch).normalize("NFC");
                if (chars(next).length > maxLength) {
                    SoundManager.playBuzzer();
                    return n;
                }
                return next;
            });
        const onBack = () => setName(n => chars(n).slice(0, -1).join(""));
        const onOk = () => {
            const value = nameRef.current.trim();
            if (!value) {
                SoundManager.playBuzzer();
                return;
            }
            SoundManager.playOk();
            finish(value);
        };
        // Cancel deletes a character; on an empty name it leaves unchanged.
        const onCancel = () => {
            if (nameRef.current) {
                SoundManager.playCancel();
                onBack();
            } else {
                SoundManager.playCancel();
                finish(actor ? null : initial);
            }
        };

        const typed = chars(name);
        const slots = [];
        for (let i = 0; i < maxLength; i++) {
            slots.push(html`<span key=${i} class=${`pmz-name-slot${i === typed.length ? " is-cursor" : ""}`}>${typed[i] || ""}</span>`);
        }
        return html`<div class="pmz-name-screen">
            <div class="pmz-panel pmz-name-header">
                ${actor && actor.faceName() ? html`<${Face} name=${actor.faceName()} index=${actor.faceIndex()} scale=${0.5} />` : null}
                <div class="pmz-name-info">
                    <div class="pmz-name-title">${title}</div>
                    <div class="pmz-name-slots">${slots}</div>
                </div>
            </div>
            <${OnScreenKeyboard} onChar=${onChar} onBack=${onBack} onOk=${onOk} onCancel=${onCancel} />
            <${BackButton} onPress=${() => finish(actor ? null : initial)} />
        </div>`;
    }

    UI.registerScreen("nameInput", NameInputScreen, { transition: "slideUp" });

    /**
     * @brief Opens name entry.
     * @param {Object} [opts] {actorId, initial, maxLength}.
     * @return {Promise<string|null>} The name, or null if cancelled.
     */
    UI.enterName = (opts = {}) => new Promise(resolve => UI.openScreen("nameInput", Object.assign({}, opts, { onDone: resolve })));

    UI.patch(Game_Interpreter.prototype, "command303", PLUGIN_NAME, orig =>
        function(params) {
            if (!CONFIG.replaceNameInput || $gameParty.inBattle() || !$dataActors[params[0]]) {
                return orig.apply(this, arguments);
            }
            UI.openScreen("nameInput", { actorId: params[0], maxLength: params[1] });
            return true;
        }
    );

    Object.assign(UI.components, { MessageBox, ChoiceList, NumberInput, OnScreenKeyboard, NameInputScreen, GoldBox });
    UI.keyboard = keyboard;
    UI.messages = { config: CONFIG, handlesCurrent };
})();
