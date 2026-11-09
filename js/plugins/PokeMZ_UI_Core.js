//=============================================================================
// PokéMZ - UI_Core.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Preact UI framework (DOM overlay over the MZ canvas).
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 *
 * @param zIndex
 * @text Overlay Z-Index
 * @desc CSS z-index of the UI overlay. The MZ canvas is 1 and the error
 * screen is 9, so keep this between them.
 * @type number
 * @min 2
 * @max 8
 * @default 5
 *
 * @param stylesheet
 * @text Stylesheet
 * @desc CSS file with the UI theme, relative to the game folder.
 * @type string
 * @default css/pokemz-ui.css
 *
 * @param uiFont
 * @text UI Font File
 * @desc Optional font in fonts/ used only by the UI. Empty = the game's
 * main font (rmmz-mainfont).
 * @type string
 * @default
 *
 * @param stringsFile
 * @text UI Strings File
 * @desc CSV string table in data/ with a Key column and one column per
 * language.
 * @type string
 * @default locales/ui.csv
 *
 * @param language
 * @text Language
 * @desc Column of the string table to use (e.g. en, es-es, fr).
 * "auto" picks the closest match to the system language.
 * @type string
 * @default en
 *
 * @param defaultTransition
 * @text Default Screen Transition
 * @type select
 * @option none
 * @option fade
 * @option slideLeft
 * @option slideRight
 * @option slideUp
 * @option slideDown
 * @option zoom
 * @option wipe
 * @default fade
 *
 * @param transitionFrames
 * @text Transition Length (frames)
 * @type number
 * @min 1
 * @default 12
 *
 * @param hotReload
 * @text Hot Reload (playtest)
 * @desc While playtesting, reload UI CSS, strings and UI plugins when the
 * files change (NW.js) or when F6 is pressed.
 * @type boolean
 * @default true
 *
 * @command openScreen
 * @text Open Screen
 * @desc Opens a registered Preact screen as its own scene.
 *
 * @arg id
 * @text Screen ID
 * @type string
 *
 * @command toast
 * @text Show Toast
 * @desc Shows a short notification. The text may be a ui.csv key.
 *
 * @arg text
 * @text Text or Key
 * @type string
 *
 * @arg frames
 * @text Duration (frames)
 * @type number
 * @default 120
 *
 * @help
 * ============================================================================
 * PokeMZ_UI_Core
 * ============================================================================
 * Lets screens be written as Preact components (no build step: templates use
 * htm tagged templates). Needs js/libs/preact-htm.js in js/main.js.
 *
 * The UI is a DOM layer kept exactly on top of the game canvas and scaled
 * with it, so components are laid out in game pixels (816 x 624 by default).
 *
 * Everything lives in window.PokeMZ.UI:
 *   html, h, Fragment, hooks          Preact + htm
 *   mount(layer, render)              Render into scene/overlay/message/system
 *   registerScreen(id, Component)     Make a screen; openScreen(id, props)
 *   attach(SceneClass, id, opts)      Overlay a component on an MZ scene
 *   useGame(selector)                 Re-render when game state changes
 *   useFocus / useAction / useCursorList   Input for keyboard, gamepad,
 *                                     mouse and touch alike
 *   t(key, fb, args) / useText(...)   Strings from data/locales (see
 *                                     PokeMZ_Locale for languages/ICU)
 *   assets, audio, sound, transitions, toast, wait, useFrame, useTween
 *
 * String keys use the pattern Area.Screen.Item, e.g. Start.Menu.Bag.
 * Text goes through MZ's escape codes, so \N[1], \V[n] and \G work.
 *
 * Plugins patching MZ through PokeMZ.UI.patch() can be hot reloaded while
 * playtesting (F6, or automatically on file change in NW.js).
 *
 * The overlay always draws above the canvas, including pictures and fades,
 * and is not part of SceneManager.snap().
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_UI_Core";
    if (!window.preact || !window.preactHooks || !window.htm) {
        throw new Error(`${PLUGIN_NAME} needs js/libs/preact-htm.js loaded from js/main.js.`);
    }

    const { h, render, Fragment, Component, createContext } = window.preact;
    const {
        useState,
        useEffect,
        useLayoutEffect,
        useRef,
        useMemo,
        useCallback,
        useReducer,
        useContext,
    } = window.preactHooks;
    const html = window.htm.bind(h);

    //=========================================================================
    // Parameters
    //=========================================================================

    const params = PluginManager.parameters(PLUGIN_NAME);

    /**
     * @brief Parses a boolean plugin parameter.
     * @param {string} value The raw value.
     * @param {boolean} fallback Value used when empty.
     * @return {boolean} The parsed value.
     */
    const parseBool = (value, fallback) => (value === undefined || value === "" ? fallback : value === "true");

    const CONFIG = {
        zIndex: Number(params.zIndex || 5),
        stylesheet: params.stylesheet || "css/pokemz-ui.css",
        uiFont: params.uiFont || "",
        stringsFile: params.stringsFile || "locales/ui.csv",
        language: params.language || "en",
        defaultTransition: params.defaultTransition || "fade",
        transitionFrames: Number(params.transitionFrames || 12),
        hotReload: parseBool(params.hotReload, true),
    };

    //=========================================================================
    // Utilities
    //=========================================================================

    const originals = new Map();

    /**
     * @brief Replaces a method, remembering the very first original so the
     *        patch can be applied again (hot reload) without stacking.
     * @param {Object} owner Object holding the method (often a prototype).
     * @param {string} name Method name.
     * @param {string} key Unique key for this patch (e.g. "MyPlugin.Scene_Map").
     * @param {function(Function): Function} wrap Receives the original and
     *        returns the replacement.
     */
    function patch(owner, name, key, wrap) {
        const id = `${key}::${name}`;
        if (!originals.has(id)) {
            originals.set(id, owner[name]);
        }
        owner[name] = wrap(originals.get(id));
    }

    /**
     * @brief Compares two values one level deep.
     * @param {*} a First value.
     * @param {*} b Second value.
     * @return {boolean} True when equal.
     */
    function shallowEqual(a, b) {
        if (Object.is(a, b)) {
            return true;
        }
        if (!a || !b || typeof a !== "object" || typeof b !== "object") {
            return false;
        }
        if (Array.isArray(a) !== Array.isArray(b)) {
            return false;
        }
        const ka = Object.keys(a);
        if (ka.length !== Object.keys(b).length) {
            return false;
        }
        return ka.every(k => Object.is(a[k], b[k]));
    }

    /**
     * @brief Converts MZ frames to milliseconds (MZ runs at 60 fps).
     * @param {number} frames Frame count.
     * @return {number} Milliseconds.
     */
    const framesToMs = frames => (frames * 1000) / 60;

    /**
     * @brief A tiny observable store for UI-local state.
     * @param {Object} initial Initial state.
     * @return {{get: Function, set: Function, subscribe: Function}} The store.
     */
    function createStore(initial) {
        let state = initial;
        const listeners = new Set();
        return {
            get: () => state,
            /**
             * @brief Merges a partial state (or the result of fn(state)).
             * @param {Object|Function} partial Partial state or updater.
             */
            set(partial) {
                const next = typeof partial === "function" ? partial(state) : partial;
                state = Object.assign({}, state, next);
                for (const l of [...listeners]) {
                    l(state);
                }
            },
            subscribe(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        };
    }

    /**
     * @brief Subscribes a component to part of a store.
     * @param {Object} store Store from createStore.
     * @param {Function} [selector] Picks the part to watch.
     * @return {*} The selected value.
     */
    function useStore(store, selector = s => s) {
        const selRef = useRef(selector);
        selRef.current = selector;
        const [value, setValue] = useState(() => selector(store.get()));
        useEffect(() => {
            let last = selRef.current(store.get());
            setValue(() => last);
            return store.subscribe(s => {
                const v = selRef.current(s);
                if (!shallowEqual(v, last)) {
                    last = v;
                    setValue(() => v);
                }
            });
        }, [store]);
        return value;
    }

    //=========================================================================
    // Mount host: a DOM layer locked to the canvas
    //=========================================================================

    const LAYERS = ["scene", "overlay", "message", "system"];

    const Host = {
        el: null,
        root: null,
        layers: {},
        link: null,
        opacity: 1,

        /** @brief Creates the overlay the first time it is needed. */
        ensure() {
            if (this.el) {
                return;
            }
            this.el = document.createElement("div");
            this.el.id = "pokemz-ui";
            this.root = document.createElement("div");
            this.root.className = "pmz-root";
            this.el.appendChild(this.root);
            for (const name of LAYERS) {
                const layer = document.createElement("div");
                layer.className = `pmz-layer pmz-layer-${name}`;
                this.root.appendChild(layer);
                this.layers[name] = layer;
            }
            document.body.appendChild(this.el);
            this.isolateEvents();
            this.loadStylesheet();
            this.sync();
            mountSystemLayer();
        },

        /** @brief Adds the theme stylesheet. */
        loadStylesheet() {
            this.link = document.createElement("link");
            this.link.rel = "stylesheet";
            this.link.href = CONFIG.stylesheet;
            document.head.appendChild(this.link);
        },

        /**
         * @brief Stops pointer events that hit the UI from reaching MZ's
         *        TouchInput (document listeners), so a tap on a button never
         *        also walks the player or counts as a map cancel.
         */
        isolateEvents() {
            const stop = e => e.stopPropagation();
            for (const type of ["mousedown", "mousemove", "mouseup", "wheel", "touchmove", "touchend", "touchcancel"]) {
                this.el.addEventListener(type, stop, { passive: true });
            }
            this.el.addEventListener(
                "touchstart",
                e => {
                    e.stopPropagation();
                    if (e.touches.length >= 2) {
                        input.emit("cancel");
                    }
                },
                { passive: true }
            );
            this.el.addEventListener("contextmenu", e => {
                e.preventDefault();
                e.stopPropagation();
                input.emit("cancel");
            });
        },

        /** @brief Matches the overlay to the canvas position and scale. */
        sync() {
            if (!this.el || !Graphics._canvas) {
                return;
            }
            const scale = Graphics._realScale || 1;
            const w = Graphics.width;
            const hh = Graphics.height;
            const s = this.el.style;
            s.position = "absolute";
            s.margin = "auto";
            s.left = s.top = s.right = s.bottom = "0";
            s.width = `${w * scale}px`;
            s.height = `${hh * scale}px`;
            s.zIndex = String(CONFIG.zIndex);
            const r = this.root.style;
            r.width = `${w}px`;
            r.height = `${hh}px`;
            r.transform = `scale(${scale})`;
            this.root.style.setProperty("--pmz-scale", String(scale));
        },

        /**
         * @brief Follows the current scene's fade so the UI fades with it.
         * @param {Scene_Base} scene The current scene.
         */
        syncFade(scene) {
            if (!this.root) {
                return;
            }
            const opacity = scene && scene._fadeOpacity ? 1 - scene._fadeOpacity / 255 : 1;
            if (opacity !== this.opacity) {
                this.opacity = opacity;
                this.root.style.opacity = String(opacity);
            }
        },
    };

    patch(Graphics, "_updateAllElements", PLUGIN_NAME, orig =>
        function() {
            orig.apply(this, arguments);
            Host.sync();
        }
    );

    const mounts = new Set();
    let mountGeneration = 0;

    /**
     * @brief Catches render errors so a broken component can't take the game
     *        down. The subtree is removed and props.onError is called.
     */
    class ErrorBoundary extends Component {
        componentDidCatch(error) {
            console.error("[PokeMZ.UI] component error:", error);
            this.setState({ error });
            toast(`UI error: ${error && error.message}`);
            if (this.props.onError) {
                this.props.onError(error);
            }
        }

        render() {
            return this.state.error ? null : this.props.children;
        }
    }

    /**
     * @brief Renders into one of the overlay layers.
     * @param {string} layer "scene", "overlay", "message" or "system".
     * @param {Function|Object} what A function returning a vnode (re-run on
     *        hot reload) or a vnode.
     * @param {Object} [opts] {onError(error)}.
     * @return {{refresh: Function, unmount: Function}} The mount handle.
     */
    function mount(layer, what, opts = {}) {
        Host.ensure();
        const container = document.createElement("div");
        container.className = "pmz-mount";
        (Host.layers[layer] || Host.layers.overlay).appendChild(container);
        const renderFn = typeof what === "function" ? what : () => what;
        const handle = {
            container,
            refresh() {
                render(h(ErrorBoundary, { key: mountGeneration, onError: opts.onError }, renderFn()), container);
            },
            unmount() {
                if (!mounts.has(handle)) {
                    return;
                }
                mounts.delete(handle);
                render(null, container);
                container.remove();
            },
        };
        mounts.add(handle);
        handle.refresh();
        return handle;
    }

    /** @brief Remounts every mounted tree (used after a hot reload). */
    function remountAll() {
        mountGeneration++;
        for (const m of mounts) {
            m.refresh();
        }
    }

    //=========================================================================
    // Frame loop, timing
    //=========================================================================

    const frameListeners = new Set();
    const waiters = [];
    const hooks = [];
    let frameCount = 0;

    /**
     * @brief Runs once per MZ frame after the scene has updated (so it pauses
     *        with the game when the window loses focus).
     */
    function onFrame() {
        frameCount++;
        const scene = SceneManager._scene;
        Host.syncFade(scene);
        bridge.tick();
        input.update();
        for (const fn of [...frameListeners]) {
            try {
                fn(frameCount);
            } catch (e) {
                console.error(e);
            }
        }
        for (let i = waiters.length - 1; i >= 0; i--) {
            if (--waiters[i].frames <= 0) {
                waiters.splice(i, 1)[0].resolve();
            }
        }
        callHooks("onFrame", scene);
    }

    patch(SceneManager, "updateScene", PLUGIN_NAME, orig =>
        function() {
            orig.apply(this, arguments);
            if (this._scene && this._scene.isStarted() && this.isGameActive()) {
                onFrame();
            }
        }
    );

    /**
     * @brief Calls a method on every registered hook.
     * @param {string} name Hook method name.
     * @param {...*} args Arguments.
     */
    function callHooks(name, ...args) {
        for (const hook of hooks) {
            if (hook[name]) {
                try {
                    hook[name](...args);
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }

    /**
     * @brief Waits a number of MZ frames.
     * @param {number} frames Frames to wait.
     * @return {Promise<void>} Resolves after that many frames.
     */
    const wait = frames => new Promise(resolve => waiters.push({ frames: Math.max(1, frames), resolve }));

    /**
     * @brief Calls fn every MZ frame while the component is mounted.
     * @param {function(number)} fn Receives the UI frame count.
     */
    function useFrame(fn) {
        const ref = useRef(fn);
        ref.current = fn;
        useEffect(() => {
            const listener = n => ref.current(n);
            frameListeners.add(listener);
            return () => frameListeners.delete(listener);
        }, []);
    }

    /** @return {number} A frame counter that re-renders every frame. */
    function useFrameCount() {
        const [n, setN] = useState(frameCount);
        useFrame(setN);
        return n;
    }

    const EASING = {
        linear: t => t,
        easeIn: t => t * t,
        easeOut: t => 1 - (1 - t) * (1 - t),
        easeInOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    };

    /**
     * @brief Animates towards a target number over MZ frames.
     * @param {number} target Value to reach.
     * @param {number} frames Duration in frames.
     * @param {string} [easing] Key of EASING.
     * @return {number} The current value.
     */
    function useTween(target, frames, easing = "easeOut") {
        const [value, setValue] = useState(target);
        const anim = useRef(null);
        useEffect(() => {
            anim.current = { from: value, to: target, t: 0 };
        }, [target]);
        useFrame(() => {
            const a = anim.current;
            if (!a || a.t >= frames) {
                return;
            }
            a.t++;
            const k = (EASING[easing] || EASING.linear)(Math.min(1, a.t / frames));
            setValue(a.from + (a.to - a.from) * k);
        });
        return value;
    }

    //=========================================================================
    // Game state bridge
    //=========================================================================

    const bridge = {
        subs: new Set(),

        /** @brief Re-runs selectors and notifies the ones that changed. */
        tick() {
            for (const sub of this.subs) {
                const value = safeSelect(sub.select);
                if (!shallowEqual(value, sub.value)) {
                    sub.value = value;
                    sub.notify(value);
                }
            }
        },
    };

    /**
     * @brief Runs a selector, returning undefined if game objects are missing.
     * @param {Function} fn Selector.
     * @return {*} The value.
     */
    function safeSelect(fn) {
        try {
            return fn();
        } catch (e) {
            return undefined;
        }
    }

    /**
     * @brief Reads game state and re-renders when it changes (checked once per
     *        frame, compared one level deep).
     * @param {Function} selector e.g. () => $gameParty.gold().
     * @return {*} The selected value.
     */
    function useGame(selector) {
        const selRef = useRef(selector);
        selRef.current = selector;
        const [value, setValue] = useState(() => safeSelect(selector));
        useEffect(() => {
            const sub = {
                select: () => selRef.current(),
                value: safeSelect(selRef.current),
                notify: v => setValue(() => v),
            };
            setValue(() => sub.value);
            bridge.subs.add(sub);
            return () => bridge.subs.delete(sub);
        }, []);
        return value;
    }

    const useSwitch = id => useGame(() => $gameSwitches.value(id));
    const useVariable = id => useGame(() => $gameVariables.value(id));
    const useGold = () => useGame(() => $gameParty.gold());
    const usePlayTime = () => useGame(() => $gameSystem.playtimeText());
    const useActors = () => useGame(() => $gameParty.members());

    //=========================================================================
    // Input: actions, focus stack, pointer parity
    //=========================================================================

    let focusSeq = 0;

    const input = {
        /** @brief Action -> MZ Input button names. Replace to rebind sources. */
        bindings: {
            up: ["up"],
            down: ["down"],
            left: ["left"],
            right: ["right"],
            ok: ["ok"],
            cancel: ["cancel"],
            menu: ["menu"],
            shift: ["shift"],
            pageup: ["pageup"],
            pagedown: ["pagedown"],
        },
        /** @brief Actions that auto-repeat while held. */
        repeatable: new Set(["up", "down", "left", "right", "pageup", "pagedown"]),
        stack: [],
        queue: [],
        /** @brief Set by tools (e.g. key capture) to pause action dispatch. */
        suspended: 0,

        /**
         * @brief Queues an action from any source (pointer, future input
         *        system, scripts). It is dispatched on the next frame.
         * @param {string} action Action name.
         */
        emit(action) {
            this.queue.push({ action, frames: 15 });
        },

        /** @return {Object|null} The focus entry that receives actions. */
        top() {
            let best = null;
            for (const e of this.stack) {
                if (!best || e.priority > best.priority || (e.priority === best.priority && e.seq > best.seq)) {
                    best = e;
                }
            }
            return best;
        },

        /** @return {boolean} True if any UI holds focus. */
        hasFocus() {
            return this.stack.length > 0;
        },

        /** @return {boolean} True if a focus owner wants the map frozen. */
        blocksMap() {
            return this.stack.some(e => e.blockMap);
        },

        add(entry) {
            entry.seq = ++focusSeq;
            this.stack.push(entry);
            this.notify();
        },

        remove(entry) {
            const i = this.stack.indexOf(entry);
            if (i >= 0) {
                this.stack.splice(i, 1);
                this.notify();
            }
        },

        notify() {
            for (const e of this.stack) {
                e.notify();
            }
        },

        /** @brief Reads MZ Input and dispatches actions to the top focus. */
        update() {
            const fired = [];
            if (this.stack.length && !this.suspended && !SceneManager.isSceneChanging()) {
                for (const action of Object.keys(this.bindings)) {
                    const rep = this.repeatable.has(action);
                    const hit = this.bindings[action].some(n => (rep ? Input.isRepeated(n) : Input.isTriggered(n)));
                    if (hit) {
                        fired.push(action);
                    }
                }
            }
            // Queued actions wait (up to 15 frames) for a focus owner, so a
            // tap made while a screen is still mounting isn't lost.
            if (!this.suspended && this.stack.length) {
                fired.push(...this.queue.splice(0).map(q => q.action));
            } else {
                this.queue = this.queue.filter(q => --q.frames > 0);
            }
            // Keyboard Escape counts as both cancel and menu in MZ; send one.
            if (fired.includes("cancel") && fired.includes("menu")) {
                fired.splice(fired.indexOf("menu"), 1);
            }
            for (const action of fired) {
                this.dispatch(action);
            }
        },

        /**
         * @brief Sends an action to the top focus owner now.
         * @param {string} action Action name.
         * @return {boolean} True if it was handled.
         */
        dispatch(action) {
            const top = this.top();
            const fn = top && top.handlers.current[action];
            if (fn) {
                fn();
                return true;
            }
            return false;
        },
    };

    // Freeze the map while a UI holds focus.
    patch(Scene_Map.prototype, "isMenuEnabled", PLUGIN_NAME, orig =>
        function() {
            return orig.apply(this, arguments) && !input.blocksMap();
        }
    );
    patch(Game_Player.prototype, "canMove", PLUGIN_NAME, orig =>
        function() {
            return orig.apply(this, arguments) && !input.blocksMap();
        }
    );

    /**
     * @brief Claims input focus while mounted. The newest owner with the
     *        highest priority receives actions.
     * @param {Object} handlers {ok, cancel, up, ...} action handlers.
     * @param {Object} [opts] {enabled = true, priority = 0, blockMap = true}.
     * @return {{focused: boolean, isTop: function(): boolean}} Focus state.
     */
    function useFocus(handlers, opts = {}) {
        const enabled = opts.enabled !== false;
        const priority = opts.priority || 0;
        const blockMap = opts.blockMap !== false;
        const ref = useRef(handlers);
        ref.current = handlers;
        const entryRef = useRef(null);
        const [, force] = useReducer(x => x + 1, 0);
        useEffect(() => {
            if (!enabled) {
                return undefined;
            }
            const entry = { handlers: ref, priority, blockMap, notify: force };
            entryRef.current = entry;
            input.add(entry);
            return () => {
                input.remove(entry);
                entryRef.current = null;
            };
        }, [enabled, priority, blockMap]);
        const isTop = useCallback(() => !!entryRef.current && input.top() === entryRef.current, []);
        return { focused: isTop(), isTop };
    }

    /**
     * @brief Handles a single action while mounted.
     * @param {string} action Action name.
     * @param {Function} handler Called when it fires.
     * @param {Object} [opts] Same as useFocus.
     */
    const useAction = (action, handler, opts) => useFocus({ [action]: handler }, opts);

    /**
     * @brief Props that make an element pressable by mouse, touch and pen
     *        (fires on release over the element that was pressed).
     * @param {Function} fn Called on press.
     * @param {function(): boolean} [canPress] Gate (e.g. focus check).
     * @return {Object} Props to spread on the element.
     */
    function usePress(fn, canPress) {
        const down = useRef(false);
        return {
            onPointerDown: e => {
                if (e.button === 0 && (!canPress || canPress())) {
                    down.current = true;
                }
            },
            onPointerUp: e => {
                if (down.current && e.button === 0) {
                    down.current = false;
                    fn(e);
                }
            },
            onPointerLeave: () => (down.current = false),
            onPointerCancel: () => (down.current = false),
        };
    }

    /**
     * @brief Cursor navigation for a list or grid, shared by every input
     *        source: keys/gamepad move it, the mouse hovers it, a tap or
     *        click selects and confirms, the wheel scrolls it.
     * @param {number} count Number of items.
     * @param {Object} [opts] {columns, wrap, initial, onOk(i), onCancel(),
     *        onChange(i), isEnabled(i), silentOk, enabled, priority,
     *        handlers (extra action handlers)}.
     * @return {{index: number, setIndex: Function, focused: boolean,
     *          itemProps: function(number, string=): Object, listProps: Object}}
     *         Cursor state. itemProps(i, extraClass) goes on each item.
     */
    function useCursorList(count, opts = {}) {
        const columns = Math.max(1, opts.columns || 1);
        const wrap = opts.wrap !== false;
        const [index, setIndexState] = useState(() => Math.max(0, Math.min(count - 1, opts.initial || 0)));
        const idxRef = useRef(index);
        idxRef.current = Math.max(0, Math.min(count - 1, index));
        const optsRef = useRef(opts);
        optsRef.current = opts;
        const listRef = useRef(null);
        const pressed = useRef(-1);

        const select = (i, sound) => {
            if (i === idxRef.current || i < 0 || i >= count) {
                return;
            }
            if (sound) {
                SoundManager.playCursor();
            }
            idxRef.current = i;
            setIndexState(i);
            if (optsRef.current.onChange) {
                optsRef.current.onChange(i);
            }
        };

        const move = delta => {
            if (count <= 0) {
                return;
            }
            let i = idxRef.current + delta;
            if (i < 0 || i >= count) {
                if (!wrap || Math.abs(delta) > columns) {
                    i = Math.max(0, Math.min(count - 1, i));
                } else {
                    i = (i + count) % count;
                }
            }
            select(i, true);
        };

        const activate = i => {
            const o = optsRef.current;
            if (o.isEnabled && !o.isEnabled(i)) {
                SoundManager.playBuzzer();
                return;
            }
            if (!o.silentOk) {
                SoundManager.playOk();
            }
            if (o.onOk) {
                o.onOk(i);
            }
        };

        const page = Math.max(columns, (opts.pageRows || 6) * columns);
        const { focused, isTop } = useFocus(
            Object.assign(
                {
                    up: () => move(-columns),
                    down: () => move(columns),
                    left: columns > 1 ? () => move(-1) : undefined,
                    right: columns > 1 ? () => move(1) : undefined,
                    pageup: () => move(-page),
                    pagedown: () => move(page),
                    ok: () => count > 0 && activate(idxRef.current),
                    cancel: opts.onCancel
                        ? () => {
                              SoundManager.playCancel();
                              optsRef.current.onCancel();
                          }
                        : undefined,
                },
                opts.handlers || {}
            ),
            { enabled: opts.enabled !== false, priority: opts.priority, blockMap: opts.blockMap }
        );

        useEffect(() => {
            const el = listRef.current && listRef.current.querySelector(`[data-index="${idxRef.current}"]`);
            if (el && el.scrollIntoView) {
                el.scrollIntoView({ block: "nearest" });
            }
        }, [index]);

        const itemProps = (i, extraClass) => {
            const disabled = opts.isEnabled ? !opts.isEnabled(i) : false;
            return {
                "data-index": i,
                class: `pmz-item${extraClass ? ` ${extraClass}` : ""}${i === idxRef.current ? " is-selected" : ""}${disabled ? " is-disabled" : ""}${
                    i === idxRef.current && focused ? " is-focused" : ""
                }`,
                onPointerEnter: e => {
                    if (e.pointerType === "mouse" && isTop()) {
                        select(i, true);
                    }
                },
                onPointerDown: e => {
                    if (e.button !== 0 || !isTop()) {
                        return;
                    }
                    pressed.current = i;
                    select(i, e.pointerType !== "mouse");
                },
                onPointerUp: e => {
                    if (pressed.current === i && e.button === 0 && isTop()) {
                        activate(i);
                    }
                    pressed.current = -1;
                },
                onPointerCancel: () => (pressed.current = -1),
            };
        };

        const listProps = {
            ref: listRef,
            onWheel: e => {
                if (isTop() && e.deltaY) {
                    move(e.deltaY > 0 ? columns : -columns);
                }
            },
        };

        return { index: idxRef.current, setIndex: i => select(i, false), focused, isTop, itemProps, listProps };
    }

    //=========================================================================
    // Assets (through MZ's ImageManager: cache, decryption, isReady)
    //=========================================================================

    const assets = {
        /**
         * @brief Loads an image the MZ way.
         * @param {string} folder e.g. "faces" or "img/faces/".
         * @param {string} name File name without extension.
         * @return {Bitmap|null} The (possibly still loading) bitmap.
         */
        bitmap(folder, name) {
            if (!name) {
                return null;
            }
            let dir = folder.startsWith("img/") ? folder : `img/${folder}`;
            if (!dir.endsWith("/")) {
                dir += "/";
            }
            return ImageManager.loadBitmap(dir, name);
        },

        /**
         * @brief Starts loading a list of images; scenes wait for them.
         * @param {Array<Array<string>>} list [[folder, name], ...].
         */
        preload(list) {
            for (const [folder, name] of list) {
                this.bitmap(folder, name);
            }
        },

        /** @return {boolean} True when every requested image has loaded. */
        isReady() {
            return ImageManager.isReady();
        },
    };

    /**
     * @brief Loads a bitmap and re-renders when it is ready.
     * @param {string} folder Image folder.
     * @param {string} name File name.
     * @return {Bitmap|null} The bitmap once ready, else null.
     */
    function useBitmap(folder, name) {
        const [ready, setReady] = useState(null);
        useEffect(() => {
            const bitmap = assets.bitmap(folder, name);
            if (!bitmap) {
                setReady(null);
                return undefined;
            }
            let alive = true;
            bitmap.addLoadListener(() => alive && setReady(bitmap));
            return () => (alive = false);
        }, [folder, name]);
        return ready;
    }

    /**
     * @brief Draws an MZ bitmap (or part of it) into a pixelated canvas.
     *        A canvas is used because MZ revokes decrypted image URLs.
     */
    function MzImage(props) {
        const { folder, name, rect, scale = 1, class: cls, style } = props;
        const bitmap = useBitmap(folder, name);
        const ref = useRef(null);
        const r = rect || (bitmap ? [0, 0, bitmap.width, bitmap.height] : [0, 0, 1, 1]);
        useLayoutEffect(() => {
            const canvas = ref.current;
            if (!canvas || !bitmap) {
                return;
            }
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(bitmap.canvas, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
        }, [bitmap, r[0], r[1], r[2], r[3]]);
        return html`<canvas
            ref=${ref}
            class=${`pmz-image ${cls || ""}`}
            width=${r[2]}
            height=${r[3]}
            style=${Object.assign({ width: `${r[2] * scale}px`, height: `${r[3] * scale}px` }, style || {})}
        />`;
    }

    /** @brief An icon from img/system/IconSet. */
    function Icon({ index, scale = 1, class: cls }) {
        const w = ImageManager.iconWidth;
        const hh = ImageManager.iconHeight;
        const rect = [(index % 16) * w, Math.floor(index / 16) * hh, w, hh];
        return html`<${MzImage} folder="system" name="IconSet" rect=${rect} scale=${scale} class=${`pmz-icon ${cls || ""}`} />`;
    }

    /** @brief A face from img/faces. */
    function Face({ name, index = 0, scale = 1, class: cls }) {
        const w = ImageManager.faceWidth;
        const hh = ImageManager.faceHeight;
        const rect = [(index % 4) * w, Math.floor(index / 4) * hh, w, hh];
        return html`<${MzImage} folder="faces" name=${name} rect=${rect} scale=${scale} class=${`pmz-face ${cls || ""}`} />`;
    }

    /** @brief One frame of a character sheet from img/characters. */
    function CharacterFrame({ name, index = 0, direction = 2, pattern = 1, scale = 1, class: cls }) {
        const bitmap = useBitmap("characters", name);
        if (!bitmap) {
            return null;
        }
        const big = ImageManager.isBigCharacter(name);
        const pw = bitmap.width / (big ? 3 : 12);
        const ph = bitmap.height / (big ? 4 : 8);
        const bx = big ? 0 : (index % 4) * 3;
        const by = big ? 0 : Math.floor(index / 4) * 4;
        const rect = [(bx + pattern) * pw, (by + (direction - 2) / 2) * ph, pw, ph];
        return html`<${MzImage} folder="characters" name=${name} rect=${rect} scale=${scale} class=${`pmz-character ${cls || ""}`} />`;
    }

    // Optional UI-only font.
    patch(Scene_Boot.prototype, "loadGameFonts", PLUGIN_NAME, orig =>
        function() {
            orig.apply(this, arguments);
            if (CONFIG.uiFont) {
                FontManager.load("pokemz-ui-font", CONFIG.uiFont);
            }
        }
    );

    //=========================================================================
    // Audio
    //=========================================================================

    /**
     * @brief Normalizes "Name" or {name, volume, pitch, pan} to an MZ sound.
     * @param {string|Object} s Sound.
     * @return {Object} MZ audio object.
     */
    const toSound = s => Object.assign({ volume: 90, pitch: 100, pan: 0 }, typeof s === "string" ? { name: s } : s);

    const audio = {
        /**
         * @brief Where sounds go. Replace (e.g. with an FMOD backend) to reroute
         *        every UI sound without touching screens.
         */
        backend: {
            playSe: s => AudioManager.playSe(s),
            playBgm: s => AudioManager.playBgm(s),
            playBgs: s => AudioManager.playBgs(s),
            playMe: s => AudioManager.playMe(s),
            stopBgm: () => AudioManager.stopBgm(),
            stopBgs: () => AudioManager.stopBgs(),
            preloadSe: s => AudioManager.loadStaticSe(s),
        },
        se: s => audio.backend.playSe(toSound(s)),
        bgm: s => audio.backend.playBgm(toSound(s)),
        bgs: s => audio.backend.playBgs(toSound(s)),
        me: s => audio.backend.playMe(toSound(s)),
        stopBgm: () => audio.backend.stopBgm(),
        stopBgs: () => audio.backend.stopBgs(),
    };

    /** @brief The system sounds from the database. */
    const sound = {
        cursor: () => SoundManager.playCursor(),
        ok: () => SoundManager.playOk(),
        cancel: () => SoundManager.playCancel(),
        buzzer: () => SoundManager.playBuzzer(),
        equip: () => SoundManager.playEquip(),
        save: () => SoundManager.playSave(),
        load: () => SoundManager.playLoad(),
        shop: () => SoundManager.playShop(),
    };

    /**
     * @brief Preloads a sound effect and returns a function playing it.
     * @param {string|Object} s Sound.
     * @return {Function} Plays the sound.
     */
    function useSe(s) {
        const key = typeof s === "string" ? s : JSON.stringify(s);
        useEffect(() => {
            if (audio.backend.preloadSe) {
                audio.backend.preloadSe(toSound(s));
            }
        }, [key]);
        return useCallback(() => audio.se(s), [key]);
    }

    //=========================================================================
    // Strings (data/locales/ui.csv), replaceable by a localization system
    //=========================================================================

    /**
     * @brief Parses RFC 4180 CSV (quotes, "" escapes, CRLF, BOM, no final
     *        newline).
     * @param {string} text CSV text.
     * @return {Array<Array<string>>} Rows of fields.
     */
    function parseCsv(text) {
        const rows = [];
        let row = [];
        let field = "";
        let quoted = false;
        let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
        for (; i < text.length; i++) {
            const c = text[i];
            if (quoted) {
                if (c === '"') {
                    if (text[i + 1] === '"') {
                        field += '"';
                        i++;
                    } else {
                        quoted = false;
                    }
                } else {
                    field += c;
                }
            } else if (c === '"') {
                quoted = true;
            } else if (c === ",") {
                row.push(field);
                field = "";
            } else if (c === "\n" || c === "\r") {
                if (c === "\r" && text[i + 1] === "\n") {
                    i++;
                }
                row.push(field);
                rows.push(row);
                row = [];
                field = "";
            } else {
                field += c;
            }
        }
        if (field !== "" || row.length) {
            row.push(field);
            rows.push(row);
        }
        return rows.filter(r => r.length > 1 || r[0] !== "");
    }

    const stringsStore = createStore({ version: 0 });

    const strings = {
        table: new Map(),
        languages: [],
        language: "en",
        loaded: false,
        failed: false,
        provider: null,
        warned: new Set(),

        /**
         * @brief Loads the CSV string table (or asks the provider to).
         * @param {function()} [done] Called when finished.
         */
        load(done) {
            if (this.provider && this.provider.load) {
                this.provider.load(() => {
                    this.bump();
                    if (done) {
                        done();
                    }
                });
                return;
            }
            const xhr = new XMLHttpRequest();
            xhr.open("GET", `data/${CONFIG.stringsFile}${this.loaded ? `?v=${Date.now()}` : ""}`);
            xhr.overrideMimeType("text/plain; charset=utf-8");
            xhr.onload = () => {
                if (xhr.status < 400) {
                    this.parse(xhr.responseText);
                } else {
                    this.fail();
                }
                if (done) {
                    done();
                }
            };
            xhr.onerror = () => {
                this.fail();
                if (done) {
                    done();
                }
            };
            xhr.send();
        },

        fail() {
            console.warn(`[PokeMZ.UI] could not load data/${CONFIG.stringsFile}; keys will be shown.`);
            this.failed = true;
        },

        /**
         * @brief Builds the table from CSV text.
         * @param {string} text CSV text.
         */
        parse(text) {
            const rows = parseCsv(text);
            const header = (rows.shift() || []).map(s => s.trim().toLowerCase());
            this.languages = header.slice(1);
            this.table = new Map();
            for (const row of rows) {
                const key = (row[0] || "").trim();
                if (!key) {
                    continue;
                }
                const entry = {};
                header.forEach((lang, i) => {
                    if (i > 0 && row[i] !== undefined && row[i] !== "") {
                        entry[lang] = row[i];
                    }
                });
                this.table.set(key, entry);
            }
            this.loaded = true;
            this.language = this.resolveLanguage(CONFIG.language);
            this.bump();
        },

        /**
         * @brief Picks a column for a language code ("auto" = system).
         * @param {string} lang Requested language.
         * @return {string} Column name.
         */
        resolveLanguage(lang) {
            let want = String(lang || "en").toLowerCase();
            if (want === "auto") {
                want = (navigator.language || "en").toLowerCase();
            }
            if (this.languages.includes(want)) {
                return want;
            }
            const base = want.split("-")[0];
            return this.languages.find(l => l.split("-")[0] === base) || "en";
        },

        /** @return {boolean} True once loaded (or failed). */
        isReady() {
            if (this.provider && this.provider.isReady) {
                return this.provider.isReady();
            }
            return this.loaded || this.failed;
        },

        /**
         * @brief Raw string for a key, before escape codes.
         * @param {string} key String key.
         * @return {string|undefined} The text.
         */
        get(key) {
            if (this.provider) {
                return this.provider.get(key);
            }
            const entry = this.table.get(key);
            if (!entry) {
                return undefined;
            }
            return entry[this.language] !== undefined ? entry[this.language] : entry.en;
        },

        /**
         * @brief Switches language and re-renders mounted UI.
         * @param {string} lang Language column.
         */
        setLanguage(lang) {
            if (this.provider && this.provider.setLanguage) {
                this.provider.setLanguage(lang);
                this.language = this.provider.language || lang;
            } else {
                this.language = this.resolveLanguage(lang);
            }
            this.bump();
        },

        /**
         * @brief Formats a looked-up string with arguments. The provider's
         *        format (ICU MessageFormat in PokeMZ_Locale) is used when
         *        available; otherwise "%1", "%2"... are replaced.
         * @param {string} text Raw string.
         * @param {Array} args Arguments (a single plain object = named).
         * @return {string} Formatted text.
         */
        format(text, args) {
            if (this.provider && this.provider.format) {
                const named = args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0]);
                return this.provider.format(text, named ? args[0] : args);
            }
            return args.length ? text.format(...args) : text;
        },

        /**
         * @brief Hands string lookup to another system (PokeMZ_Locale):
         *        {get(key), has?(key), format?(text, args), setLanguage?(lang),
         *        load?(done), isReady?(), expand?(text)}.
         * @param {Object|null} provider The provider, or null for the CSV.
         */
        setProvider(provider) {
            this.provider = provider;
            this.bump();
        },

        /** @brief Tells subscribed components that strings changed. */
        bump() {
            stringsStore.set(s => ({ version: s.version + 1 }));
        },
    };

    patch(Scene_Boot.prototype, "create", PLUGIN_NAME, orig =>
        function() {
            orig.apply(this, arguments);
            strings.load();
        }
    );
    patch(Scene_Boot.prototype, "isReady", PLUGIN_NAME, orig =>
        function() {
            return orig.apply(this, arguments) && strings.isReady();
        }
    );

    const escapeWindow = Object.create(Window_Base.prototype);

    /**
     * @brief Applies MZ's escape conversion (\V \N \P \G) to text. Other codes
     *        stay as "\x1b"-prefixed codes for rich text.
     * @param {string} text Raw text.
     * @return {string} Converted text.
     */
    function convertEscapes(text) {
        if (strings.provider && strings.provider.expand) {
            text = strings.provider.expand(String(text));
        }
        try {
            return Window_Base.prototype.convertEscapeCharacters.call(escapeWindow, String(text));
        } catch (e) {
            // Game objects don't exist yet (e.g. on the title screen).
            return String(text).replace(/\\/g, "\x1b").replace(/\x1b\x1b/g, "\\");
        }
    }

    /**
     * @brief Removes the remaining escape codes from converted text.
     * @param {string} text Converted text.
     * @return {string} Plain text.
     */
    const stripCodes = text => text.replace(/\x1b([$.|^!><{}\\]|[A-Z]+(\[\d+\])?)/gi, "");

    /**
     * @brief Looks up a UI string. Order: current language (and its
     *        fallbacks), en, fallback, key. Arguments fill "%1", "%2"... or,
     *        with PokeMZ_Locale, ICU placeholders ({name}, plurals...); pass
     *        one object for named arguments. Escape codes are applied.
     * @param {string} key String key, e.g. "Start.Menu.Bag".
     * @param {string} [fallback] Text used when the key is missing.
     * @param {...*} args Format arguments.
     * @return {string} The text (plain).
     */
    function t(key, fallback, ...args) {
        let text = strings.get(key);
        if (text === undefined) {
            if (!strings.provider && strings.isReady() && !strings.warned.has(key)) {
                strings.warned.add(key);
                console.warn(`[PokeMZ.UI] missing string "${key}" in data/${CONFIG.stringsFile}`);
            }
            text = fallback !== undefined ? fallback : key;
        }
        text = strings.format(text, args);
        return stripCodes(convertEscapes(text));
    }

    /**
     * @brief Like t() but re-renders when strings, language or game state
     *        used by escape codes (e.g. \N[1]) change.
     * @param {string} key String key.
     * @param {string} [fallback] Fallback text.
     * @return {string} The text.
     */
    function useText(key, fallback, ...args) {
        useStore(stringsStore, s => s.version);
        // useGame re-renders when game state used by codes (\N[1]) changes;
        // the text itself is read fresh so a language change shows at once.
        useGame(() => t(key, fallback, ...args));
        return t(key, fallback, ...args);
    }

    /** @brief Subscribes a component to string table changes. */
    const useStrings = () => useStore(stringsStore, s => s.version);

    //=========================================================================
    // Rich text (MZ escape codes as spans)
    //=========================================================================

    /**
     * @brief Splits converted text into tokens: characters and MZ codes.
     * @param {string} text Text already passed through convertEscapes.
     * @return {Array<Object>} Tokens {t, c|n}.
     */
    function tokenize(text) {
        const out = [];
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === "\x1b") {
                const rest = text.slice(i + 1);
                const m = /^([$.|^!><{}\\]|[A-Z]+)(\[(\d+)\])?/i.exec(rest);
                if (!m) {
                    continue;
                }
                i += m[0].length;
                const code = m[1].toUpperCase();
                const n = m[3] !== undefined ? Number(m[3]) : 0;
                switch (code) {
                    case "C":
                        out.push({ t: "color", n });
                        break;
                    case "I":
                        out.push({ t: "icon", n });
                        break;
                    case "FS":
                        out.push({ t: "size", n });
                        break;
                    case "{":
                        out.push({ t: "bigger" });
                        break;
                    case "}":
                        out.push({ t: "smaller" });
                        break;
                    case ".":
                        out.push({ t: "wait", n: 15 });
                        break;
                    case "|":
                        out.push({ t: "wait", n: 60 });
                        break;
                    case "!":
                        out.push({ t: "pause" });
                        break;
                    case ">":
                        out.push({ t: "fast", on: true });
                        break;
                    case "<":
                        out.push({ t: "fast", on: false });
                        break;
                    case "^":
                        out.push({ t: "noPause" });
                        break;
                    case "$":
                        out.push({ t: "gold" });
                        break;
                    default:
                        break; // PX, PY and unknown plugin codes
                }
            } else if (c === "\f") {
                out.push({ t: "page" });
            } else {
                out.push({ t: "char", c });
            }
        }
        return out;
    }

    /**
     * @brief Builds vnodes for tokens[from, to).
     * @param {Array<Object>} tokens Tokens from tokenize().
     * @param {number} [from] First token.
     * @param {number} [to] End token (exclusive).
     * @return {Array} Vnodes.
     */
    function richNodes(tokens, from = 0, to = tokens.length) {
        const nodes = [];
        let color = 0;
        let size = 0;
        let run = "";
        const flush = () => {
            if (run) {
                const style = {};
                if (color) {
                    style.color = ColorManager.textColor(color);
                }
                if (size) {
                    style.fontSize = `${size}px`;
                }
                nodes.push(color || size ? html`<span style=${style}>${run}</span>` : run);
                run = "";
            }
        };
        // Styles set before `from` still apply on later pages.
        for (let i = 0; i < to; i++) {
            const tok = tokens[i];
            if (tok.t === "color") {
                flush();
                color = tok.n;
            } else if (tok.t === "size") {
                flush();
                size = tok.n;
            } else if (tok.t === "bigger") {
                flush();
                size = Math.min(96, (size || 28) + 12);
            } else if (tok.t === "smaller") {
                flush();
                size = Math.max(12, (size || 28) - 12);
            } else if (i >= from) {
                if (tok.t === "char") {
                    run += tok.c;
                } else if (tok.t === "icon") {
                    flush();
                    nodes.push(html`<${Icon} index=${tok.n} class="pmz-inline-icon" />`);
                }
            }
        }
        flush();
        return nodes;
    }

    /** @brief Renders text with MZ escape codes (\C, \I, \{, \}, \FS). */
    function RichText({ text, class: cls }) {
        useStrings();
        const converted = useGame(() => convertEscapes(text || "")) || "";
        const tokens = useMemo(() => tokenize(converted).filter(tk => tk.t !== "page"), [converted]);
        return html`<span class=${`pmz-rich ${cls || ""}`}>${richNodes(tokens)}</span>`;
    }

    //=========================================================================
    // Transitions
    //=========================================================================

    const slide = (x, y) => ({
        enter: [
            { opacity: 0, transform: `translate(${x}px, ${y}px)` },
            { opacity: 1, transform: "none" },
        ],
        exit: [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: `translate(${x}px, ${y}px)` },
        ],
    });

    const transitionRegistry = new Map([
        ["none", { enter: null, exit: null }],
        ["fade", { enter: [{ opacity: 0 }, { opacity: 1 }], exit: [{ opacity: 1 }, { opacity: 0 }] }],
        ["slideLeft", slide(-48, 0)],
        ["slideRight", slide(48, 0)],
        ["slideUp", slide(0, -48)],
        ["slideDown", slide(0, 48)],
        [
            "zoom",
            {
                enter: [
                    { opacity: 0, transform: "scale(0.9)" },
                    { opacity: 1, transform: "none" },
                ],
                exit: [
                    { opacity: 1, transform: "none" },
                    { opacity: 0, transform: "scale(0.9)" },
                ],
            },
        ],
        [
            "wipe",
            {
                enter: [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
                exit: [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }],
            },
        ],
    ]);

    const transitions = {
        /**
         * @brief Adds or replaces a transition.
         * @param {string} name Name.
         * @param {Object} def {enter: keyframes|null, exit: keyframes|null,
         *        frames?, easing?}.
         */
        register: (name, def) => transitionRegistry.set(name, def),
        get: name => transitionRegistry.get(name) || transitionRegistry.get("fade"),
        names: () => [...transitionRegistry.keys()],
        /** @return {boolean} False when the player turned animations off. */
        enabled() {
            if (ConfigManager.pokemzUiAnimations === false) {
                return false;
            }
            return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
        },
    };

    /**
     * @brief Plays a transition when mounted and another when `show` turns
     *        false, then calls onExited.
     */
    function Transition({ name, frames, show = true, onExited, class: cls, style, children }) {
        const ref = useRef(null);
        const def = transitions.get(name || CONFIG.defaultTransition);
        const duration = framesToMs(frames || def.frames || CONFIG.transitionFrames);
        const exitedRef = useRef(onExited);
        exitedRef.current = onExited;
        useLayoutEffect(() => {
            if (!ref.current || !def.enter || !transitions.enabled() || !ref.current.animate) {
                return undefined;
            }
            const anim = ref.current.animate(def.enter, { duration, easing: def.easing || "ease-out", fill: "backwards" });
            return () => anim.cancel();
        }, []);
        useLayoutEffect(() => {
            if (show) {
                return;
            }
            const done = () => exitedRef.current && exitedRef.current();
            if (!ref.current || !def.exit || !transitions.enabled() || !ref.current.animate) {
                done();
                return;
            }
            const anim = ref.current.animate(def.exit, { duration, easing: "ease-in", fill: "forwards" });
            anim.onfinish = done;
            anim.oncancel = done;
        }, [show]);
        return html`<div ref=${ref} class=${`pmz-transition ${cls || ""}`} style=${style}>${children}</div>`;
    }

    //=========================================================================
    // Building blocks
    //=========================================================================

    /** @brief A themed box; optional title. */
    function Panel({ title, class: cls, style, children }) {
        return html`<div class=${`pmz-panel ${cls || ""}`} style=${style}>
            ${title ? html`<div class="pmz-panel-title">${title}</div>` : null} ${children}
        </div>`;
    }

    /**
     * @brief A pressable button (mouse, touch, pen). Keyboard and gamepad
     *        reach it through the screen's own focus handlers.
     */
    function Button({ onPress, disabled, sound: snd = "ok", class: cls, style, children }) {
        const press = usePress(() => {
            if (disabled) {
                SoundManager.playBuzzer();
                return;
            }
            if (snd && sound[snd]) {
                sound[snd]();
            }
            if (onPress) {
                onPress();
            }
        });
        return html`<div role="button" class=${`pmz-button ${cls || ""}${disabled ? " is-disabled" : ""}`} style=${style} ...${press}>
            ${children}
        </div>`;
    }

    /** @brief The on-screen Back button every screen should show. */
    function BackButton({ onPress, class: cls }) {
        const label = useText("UI.Common.Back", "Back");
        return html`<${Button} class=${`pmz-back ${cls || ""}`} sound="cancel" onPress=${onPress}>${label}<//>`;
    }

    /**
     * @brief A vertical list whose items follow a cursor (see useCursorList).
     * @param {Object} props {items: [{label, disabled?}], onOk(i), onCancel(),
     *        initial, columns, class, renderItem(item, i)}.
     */
    function List(props) {
        const { items, class: cls, renderItem, columns = 1 } = props;
        const cursor = useCursorList(items.length, {
            columns,
            initial: props.initial,
            onOk: props.onOk,
            onCancel: props.onCancel,
            onChange: props.onChange,
            isEnabled: i => !items[i].disabled,
            priority: props.priority,
            enabled: props.enabled,
        });
        return html`<div class=${`pmz-list ${cls || ""}`} style=${{ "--pmz-columns": columns }} ...${cursor.listProps}>
            ${items.map(
                (item, i) =>
                    html`<div key=${item.id || i} ...${cursor.itemProps(i)}>${renderItem ? renderItem(item, i) : item.label}</div>`
            )}
        </div>`;
    }

    //=========================================================================
    // Toasts (system layer)
    //=========================================================================

    const toastStore = createStore({ items: [] });
    let toastId = 0;

    /**
     * @brief Shows a short notification on top of everything.
     * @param {string} text Text (a ui.csv key also works).
     * @param {number} [frames] How long it stays.
     */
    function toast(text, frames = 120) {
        if (!Host.el) {
            console.info("[PokeMZ.UI]", text);
            return;
        }
        const id = ++toastId;
        const isKey = strings.provider && strings.provider.has ? strings.provider.has(text) : strings.get(text) !== undefined;
        const shown = isKey ? t(text) : String(text);
        toastStore.set(s => ({ items: [...s.items, { id, text: shown }] }));
        setTimeout(() => toastStore.set(s => ({ items: s.items.filter(i => i.id !== id) })), framesToMs(frames));
    }

    /** @brief Renders the toast stack. */
    function Toasts() {
        const items = useStore(toastStore, s => s.items);
        return html`<div class="pmz-toasts">
            ${items.map(i => html`<${Transition} key=${i.id} name="slideDown" class="pmz-toast">${i.text}<//>`)}
        </div>`;
    }

    /** @brief Mounts the system layer content once the host exists. */
    function mountSystemLayer() {
        mount("system", () => html`<${Toasts} />`);
    }

    //=========================================================================
    // Scenes and screens
    //=========================================================================

    const screens = new Map();
    const SceneContext = createContext(null);

    /**
     * @brief Registers (or replaces) a screen.
     * @param {string} id Screen id.
     * @param {Function} component Preact component. Receives the props given
     *        to openScreen plus close().
     * @param {Object} [opts] {transition, frames, blur = true,
     *        backgroundOpacity = 192, sceneClass}.
     */
    function registerScreen(id, component, opts = {}) {
        screens.set(id, { component, opts });
    }

    /**
     * @brief Opens a registered screen as a new scene.
     * @param {string} id Screen id.
     * @param {Object} [props] Props for the component.
     */
    function openScreen(id, props = {}) {
        const entry = screens.get(id);
        if (!entry) {
            console.warn(`[PokeMZ.UI] unknown screen "${id}"`);
            SoundManager.playBuzzer();
            return;
        }
        SceneManager.push(entry.opts.sceneClass || Scene_PreactScreen);
        SceneManager.prepareNextScene(id, props);
    }

    /** @return {Object} {scene, close, leaving} of the screen being rendered. */
    const useScene = () => useContext(SceneContext);

    /** @brief Hosts a screen inside a Scene_PreactBase. */
    function ScreenHost({ scene }) {
        const leaving = useStore(scene._uiStore, s => s.leaving);
        const ctx = useMemo(() => ({ scene, close: () => scene.closeUi(), props: scene._screenProps }), [scene]);
        const entry = screens.get(scene._screenId);
        if (!entry) {
            return null;
        }
        const Comp = entry.component;
        return html`<${SceneContext.Provider} value=${Object.assign({}, ctx, { leaving })}>
            <${Transition}
                name=${entry.opts.transition}
                frames=${entry.opts.frames}
                show=${!leaving}
                onExited=${() => scene.onUiExited()}
                class=${`pmz-screen pmz-screen-${scene._screenId}`}
            >
                <${Comp} ...${scene._screenProps} close=${ctx.close} leaving=${leaving} />
            <//>
        <//>`;
    }

    /**
     * @brief Base scene for Preact screens. Shows the previous scene's
     *        snapshot behind the UI, waits for UI assets and strings, and plays
     *        the exit transition before the scene changes.
     */
    class Scene_PreactBase extends Scene_MenuBase {
        initialize() {
            super.initialize();
            this._screenId = "";
            this._screenProps = {};
            this._uiStore = createStore({ leaving: false });
            this._uiPhase = "none";
            this._uiLeaveFrames = 0;
            this._uiMount = null;
        }

        /**
         * @brief Receives SceneManager.prepareNextScene arguments.
         * @param {string} id Screen id.
         * @param {Object} [props] Component props.
         */
        prepare(id, props) {
            this._screenId = id;
            this._screenProps = props || {};
        }

        /** @return {Object} Registration options of this screen. */
        screenOptions() {
            const entry = screens.get(this._screenId);
            return (entry && entry.opts) || {};
        }

        create() {
            super.create();
            this.createUi();
        }

        createBackground() {
            const opts = this.screenOptions();
            this._backgroundSprite = new Sprite();
            this._backgroundSprite.bitmap = SceneManager.backgroundBitmap();
            if (opts.blur !== false) {
                this._backgroundFilter = new PIXI.filters.BlurFilter();
                this._backgroundSprite.filters = [this._backgroundFilter];
            }
            this.addChild(this._backgroundSprite);
            this.setBackgroundOpacity(opts.backgroundOpacity !== undefined ? opts.backgroundOpacity : 192);
        }

        needsCancelButton() {
            return false;
        }

        /** @brief Mounts the screen's component. */
        createUi() {
            this._uiMount = mount("scene", () => html`<${ScreenHost} scene=${this} />`, {
                onError: () => this.closeUi(),
            });
            this._uiPhase = "shown";
        }

        isReady() {
            return super.isReady() && assets.isReady() && strings.isReady();
        }

        /** @brief Leaves the scene (exit transition first). */
        closeUi() {
            if (SceneManager._scene === this && !SceneManager.isSceneChanging()) {
                this.popScene();
            }
        }

        isBusy() {
            if (SceneManager.isSceneChanging() && this._uiPhase === "shown") {
                this._uiPhase = "leaving";
                this._uiStore.set({ leaving: true });
            }
            if (this._uiPhase === "leaving" && ++this._uiLeaveFrames > 120) {
                this._uiPhase = "gone"; // never hang on a missing animation
            }
            return super.isBusy() || this._uiPhase === "leaving";
        }

        /** @brief Called by the exit transition. */
        onUiExited() {
            this._uiPhase = "gone";
        }

        terminate() {
            super.terminate();
            if (this._uiMount) {
                this._uiMount.unmount();
                this._uiMount = null;
            }
        }
    }

    /** @brief Generic scene that shows any registered screen. */
    class Scene_PreactScreen extends Scene_PreactBase {}

    window.Scene_PreactBase = Scene_PreactBase;
    window.Scene_PreactScreen = Scene_PreactScreen;

    //=========================================================================
    // Overlays attached to MZ scenes
    //=========================================================================

    const attachments = new Map();

    /**
     * @brief Mounts a component on every scene of a class while it runs
     *        (e.g. a HUD on Scene_Map). Re-attaching the same id replaces it.
     * @param {Function} sceneClass e.g. Scene_Map.
     * @param {string} id Attachment id.
     * @param {Function} component Component (gets {scene}).
     * @param {Object} [opts] {layer = "overlay", when(scene)}.
     */
    function attach(sceneClass, id, component, opts = {}) {
        attachments.set(id, { sceneClass, component, layer: opts.layer || "overlay", when: opts.when });
    }

    /** @param {string} id Attachment id to remove. */
    const detach = id => attachments.delete(id);

    patch(Scene_Base.prototype, "start", PLUGIN_NAME, orig =>
        function() {
            orig.apply(this, arguments);
            this._pmzAttached = [];
            for (const [id, a] of attachments) {
                if (this instanceof a.sceneClass && (!a.when || a.when(this))) {
                    const scene = this;
                    this._pmzAttached.push(
                        mount(a.layer, () => {
                            const current = attachments.get(id);
                            return current ? h(current.component, { scene }) : null;
                        })
                    );
                }
            }
        }
    );

    patch(Scene_Base.prototype, "terminate", PLUGIN_NAME, orig =>
        function() {
            orig.apply(this, arguments);
            for (const m of this._pmzAttached || []) {
                m.unmount();
            }
            this._pmzAttached = [];
        }
    );

    //=========================================================================
    // Hot reload (playtest only)
    //=========================================================================

    const dev = {
        enabled: false,
        timers: new Map(),

        /** @brief Reloads the stylesheet without re-rendering. */
        reloadCss() {
            if (Host.link) {
                Host.link.href = `${CONFIG.stylesheet}?v=${Date.now()}`;
            }
        },

        /** @brief Reloads the string table. */
        reloadStrings() {
            strings.load(() => remountAll());
        },

        /**
         * @brief Re-runs a UI plugin file. Its registerScreen/attach/patch
         *        calls replace the old ones.
         * @param {string} src Script path.
         * @return {Promise<void>} Resolves when loaded.
         */
        reloadScript(src) {
            return new Promise(resolve => {
                const script = document.createElement("script");
                script.src = `${src}?v=${Date.now()}`;
                script.onload = () => {
                    script.remove();
                    resolve();
                };
                script.onerror = () => {
                    script.remove();
                    toast(`Reload failed: ${src}`);
                    resolve();
                };
                document.body.appendChild(script);
            });
        },

        /** @return {Array<string>} Enabled UI plugin files except the core. */
        uiPlugins() {
            return $plugins
                .filter(p => p.status && p.name.startsWith("PokeMZ_UI_") && p.name !== PLUGIN_NAME)
                .map(p => `js/plugins/${p.name}.js`);
        },

        /** @brief Reloads CSS, strings and UI plugins, then remounts. */
        async reload() {
            this.reloadCss();
            for (const src of this.uiPlugins()) {
                await this.reloadScript(src);
            }
            strings.load(() => {
                remountAll();
                toast("UI reloaded", 60);
            });
        },

        /**
         * @brief Debounces a change notification.
         * @param {string} key Group key.
         * @param {Function} fn Action.
         */
        debounce(key, fn) {
            clearTimeout(this.timers.get(key));
            this.timers.set(key, setTimeout(fn, 150));
        },

        /** @brief Watches UI files with fs.watch when running in NW.js. */
        watch() {
            if (!Utils.isNwjs()) {
                return;
            }
            try {
                const fs = require("fs");
                const path = require("path");
                let base = decodeURIComponent(path.dirname(location.pathname));
                if (/^\/[A-Za-z]:/.test(base)) {
                    base = base.slice(1);
                }
                const watchDir = (dir, onFile) => {
                    const full = path.join(base, dir);
                    if (fs.existsSync(full)) {
                        fs.watch(full, (event, file) => file && onFile(String(file)));
                    }
                };
                const cssName = path.basename(CONFIG.stylesheet);
                watchDir(path.dirname(CONFIG.stylesheet), f => f === cssName && this.debounce("css", () => this.reloadCss()));
                watchDir("data/locales", f => f.endsWith(".csv") && this.debounce("csv", () => this.reloadStrings()));
                watchDir(
                    "js/plugins",
                    f =>
                        f.startsWith("PokeMZ_UI_") &&
                        f !== `${PLUGIN_NAME}.js` &&
                        this.debounce(`js:${f}`, async () => {
                            await this.reloadScript(`js/plugins/${f}`);
                            remountAll();
                            toast(`Reloaded ${f}`, 60);
                        })
                );
                watchDir("js/ui", f => f.endsWith(".js") && this.debounce(`ui:${f}`, () => this.reloadScript(`js/ui/${f}`).then(remountAll)));
            } catch (e) {
                console.warn("[PokeMZ.UI] hot reload watcher unavailable:", e);
            }
        },

        /** @brief Turns hot reload on for playtests. */
        init() {
            this.enabled = CONFIG.hotReload && Utils.isOptionValid("test");
            if (!this.enabled) {
                return;
            }
            document.addEventListener("keydown", e => {
                if (e.keyCode === 117 && !e.ctrlKey && !e.altKey) {
                    e.preventDefault();
                    this.reload();
                }
            });
            this.watch();
        },
    };

    dev.init();

    //=========================================================================
    // Plugin commands
    //=========================================================================

    PluginManager.registerCommand(PLUGIN_NAME, "openScreen", args => openScreen(String(args.id || "")));
    PluginManager.registerCommand(PLUGIN_NAME, "toast", args => toast(String(args.text || ""), Number(args.frames || 120)));

    //=========================================================================
    // Public API
    //=========================================================================

    /**
     * @brief The PokeMZ.UI namespace used by UI plugins and screens.
     */
    const UI = {
        version: "0.1.0",
        config: CONFIG,
        // Preact
        h,
        html,
        render,
        Fragment,
        Component,
        createContext,
        useState,
        useEffect,
        useLayoutEffect,
        useRef,
        useMemo,
        useCallback,
        useReducer,
        useContext,
        // Host and lifecycle
        host: Host,
        mount,
        remountAll,
        patch,
        addHook: hook => hooks.push(hook),
        registerScreen,
        openScreen,
        screens,
        useScene,
        attach,
        detach,
        Scene_PreactBase,
        Scene_PreactScreen,
        // State
        bridge,
        createStore,
        useStore,
        useGame,
        useSwitch,
        useVariable,
        useGold,
        usePlayTime,
        useActors,
        // Input
        input,
        useFocus,
        useAction,
        useCursorList,
        usePress,
        // Assets, timing, audio
        assets,
        useBitmap,
        wait,
        useFrame,
        useFrameCount,
        useTween,
        EASING,
        framesToMs,
        audio,
        sound,
        useSe,
        // Strings and text
        strings,
        parseCsv,
        t,
        useText,
        useStrings,
        convertEscapes,
        stripCodes,
        tokenize,
        richNodes,
        // Transitions
        transitions,
        Transition,
        // Components (extended by other UI plugins)
        components: {
            ErrorBoundary,
            Panel,
            Button,
            BackButton,
            List,
            RichText,
            MzImage,
            Icon,
            Face,
            CharacterFrame,
            Transition,
            Toasts,
        },
        toast,
        dev,
        parseBool,
        shallowEqual,
    };

    window.PokeMZ = window.PokeMZ || {};
    window.PokeMZ.UI = UI;
})();
