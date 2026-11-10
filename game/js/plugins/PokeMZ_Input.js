//=============================================================================
// PokéMZ - Input.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Input layer: semantic actions, unified devices,
 * contexts, rebinding, glyphs, buffering and accessibility.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 *
 * @param tapToTurn
 * @text Tap To Turn
 * @desc Default for the option: a short tap turns the player in place;
 * holding the direction walks (Gen 3 style).
 * @type boolean
 * @default true
 *
 * @param turnFrames
 * @text Turn Frames
 * @desc How long a direction must be held before a standing player
 * starts walking instead of only turning.
 * @type number
 * @min 1
 * @default 6
 *
 * @param bufferFrames
 * @text Buffer Frames
 * @desc A confirm press made this many frames before the player stops
 * walking still talks to / checks what is in front.
 * @type number
 * @min 0
 * @default 8
 *
 * @param cameraRelative
 * @text Camera-Relative Movement
 * @desc On 3D maps whose camera is rotated, Up means "away from the
 * camera" (snapped to the nearest 90 degrees).
 * @type boolean
 * @default true
 *
 * @param deadzone
 * @text Stick Deadzone
 * @desc Default inner deadzone of the analog sticks (0 - 0.9).
 * @type number
 * @decimals 2
 * @min 0
 * @max 0.9
 * @default 0.20
 *
 * @param glyphFolder
 * @text Glyph Folder
 * @desc Folder of the button glyph sheets (InputGlyphs_<family>.png).
 * @default img/system/
 *
 * @param glyphCell
 * @text Glyph Cell Size
 * @desc Size in pixels of one square cell in a glyph sheet. Glyphs are
 * drawn 16px tall, so 16 keeps them on the pixel grid.
 * @type number
 * @min 8
 * @default 16
 *
 * @param glyphColumns
 * @text Glyph Columns
 * @desc Cells per row in a glyph sheet.
 * @type number
 * @min 1
 * @default 8
 *
 * @param glyphMap
 * @text Glyph Cell Overrides
 * @desc JSON: {"xbox": {"pad:0": 3}, "keyboard": {"key:Enter": 1}} maps a
 * control to a cell index of that family's sheet.
 * @type note
 * @default ""
 *
 * @param touchControls
 * @text Touch Controls
 * @desc Default for the on-screen D-pad and buttons (needs
 * PokeMZ_UI_Controls). Auto shows them after a touch.
 * @type select
 * @option auto
 * @option on
 * @option off
 * @default auto
 *
 * @param overlayKey
 * @text Debug Overlay Key
 * @desc Key (KeyboardEvent.key) that toggles the input debug overlay
 * while playtesting.
 * @default F10
 *
 * @param recordFolder
 * @text Recording Folder
 * @desc Where input recordings are saved (NW.js playtests).
 * @default input-recordings
 *
 * @command rumble
 * @text Rumble
 * @desc Vibrates connected gamepads (if the player allows rumble).
 *
 * @arg strong
 * @text Strong Motor (0-1)
 * @type number
 * @decimals 2
 * @min 0
 * @max 1
 * @default 0.6
 *
 * @arg weak
 * @text Weak Motor (0-1)
 * @type number
 * @decimals 2
 * @min 0
 * @max 1
 * @default 0.6
 *
 * @arg frames
 * @text Duration (frames)
 * @type number
 * @min 1
 * @default 15
 *
 * @command pushContext
 * @text Push Input Context
 * @desc Blocks every action except the listed ones until the context is
 * popped (e.g. during a cutscene).
 *
 * @arg id
 * @text Context ID
 * @type string
 * @default cutscene
 *
 * @arg allow
 * @text Allowed Actions
 * @desc Comma-separated action ids that still work, e.g. confirm,back
 * @type string
 * @default
 *
 * @command popContext
 * @text Pop Input Context
 *
 * @arg id
 * @text Context ID
 * @type string
 * @default cutscene
 *
 * @command joinPlayer
 * @text Join Local Player
 * @desc Waits for player 2 to press A/Start (or Enter) on their own
 * controller or keyboard (opens a prompt with PokeMZ_UI_Controls).
 *
 * @arg player
 * @text Player
 * @type number
 * @min 2
 * @max 2
 * @default 2
 *
 * @arg switchId
 * @text Result Switch
 * @desc Set ON if the player joined, OFF if not (0 = none).
 * @type switch
 * @default 0
 *
 * @command leavePlayer
 * @text Remove Local Player
 *
 * @arg player
 * @text Player
 * @type number
 * @min 2
 * @max 2
 * @default 2
 *
 * @help
 * ============================================================================
 * PokeMZ_Input
 * ============================================================================
 * Put this plugin near the top of the list (right after PS_Sim), above
 * every other PokeMZ plugin.
 *
 * Every input device goes through one layer, exposed as PokeMZ.Input.
 * MZ's own Input object is rewired onto it, so MZ windows, events and other
 * plugins keep working and follow rebinding automatically.
 *
 * ---------------------------------------------------------------------------
 * Actions
 * ---------------------------------------------------------------------------
 * Code reads semantic actions instead of keys:
 *   confirm back menu run pageUp pageDown up down left right
 *   cameraLeft cameraRight cameraUp cameraDown zoomIn zoomOut
 * MZ's button names still work: ok = confirm, cancel/escape = back,
 * shift = run, pageup/pagedown, and the directions.
 *
 * Each frame the layer takes one snapshot. Every read in that frame sees
 * the same state:
 *   PokeMZ.Input.isPressed(a) / isTriggered(a) / isRepeated(a)
 *   isReleased(a) / isLongPressed(a) / value(a) / heldFrames(a)
 *   dir4 / dir8 / moveDirection() / moveVector() / camera()
 *
 * Plugins can add actions:
 *   PokeMZ.Input.registerAction("register", { group: "main",
 *       labelKey: "UI.Controls.Action.register",
 *       defaults: { keyboard: ["key:KeyA"], gamepad: ["pad:8"] } });
 *
 * Sources are written device:control. key:KeyZ uses KeyboardEvent.code,
 * so bindings follow key position, not layout. Others: pad:0 (standard
 * gamepad button), axis:1- / axis:1+ (stick direction), virtual:<action>.
 *
 * ---------------------------------------------------------------------------
 * Contexts and consumption
 * ---------------------------------------------------------------------------
 *   const ctx = PokeMZ.Input.pushContext("cutscene",
 *                                        { block: true, allow: ["confirm"] });
 *   ...
 *   ctx.pop();
 * A blocking context hides every action not in its allow list from code
 * reading below it (MZ code reads at the bottom). Reads made with the
 * context's own handle (ctx.isTriggered(a)) see everything.
 * PokeMZ.Input.consume(a) hides an action's trigger for the rest of the
 * frame, so two systems can't both react to one press.
 *
 * While a text field has focus, typing keys don't reach the game.
 *
 * ---------------------------------------------------------------------------
 * Buffering
 * ---------------------------------------------------------------------------
 * isBuffered(a, frames) / consumeBuffered(a, frames) accept a press made in
 * the last few frames. The player uses it to talk to events with a confirm
 * press made during the last part of a step.
 *
 * ---------------------------------------------------------------------------
 * Focus loss
 * ---------------------------------------------------------------------------
 * When the window loses focus, is hidden or a gamepad disconnects, every
 * action is released. Keys and buttons still held on return must be
 * pressed again, so nothing sticks and nothing fires by itself.
 *
 * ---------------------------------------------------------------------------
 * Rebinding and options
 * ---------------------------------------------------------------------------
 * bind(action, device, source, slot) swaps with whichever action had the
 * source. captureNext(device) resolves with the next key or button.
 * Bindings and options are saved in config.rmmzsave. Old saves from
 * PokeMZ_UI_Controls (key/gamepad mappers) are migrated.
 *
 * Options (setOption(id, value)): toggleRun, tapToTurn, repeatDelay,
 * repeatRate, holdTime, deadzone, swapConfirmBack, invertCameraX,
 * invertCameraY, glyphStyle, rumble, rumbleStrength, touchControls,
 * touchSize, touchOpacity. PokeMZ_UI_Controls shows them in
 * Options > Controls.
 *
 * ---------------------------------------------------------------------------
 * Active device and glyphs
 * ---------------------------------------------------------------------------
 * PokeMZ.Input.device is "keyboard", "gamepad", "touch" or "mouse": the
 * last device used. PokeMZ.Input.family is the gamepad family: "xbox",
 * "playstation", "switch" or "generic". The "devicechange" event fires
 * when either changes.
 *
 * glyph(action) describes the control to show for an action on the
 * active device: {text, source, device, family, image}. image is set only
 * when a sheet for the family exists:
 *   img/system/InputGlyphs_keyboard.png
 *   img/system/InputGlyphs_xbox.png
 *   img/system/InputGlyphs_playstation.png
 *   img/system/InputGlyphs_switch.png
 *   img/system/InputGlyphs_generic.png
 * Sheets are grids of square cells (Glyph Cell Size, Glyph Columns).
 * Gamepad sheets: cell N is standard button N (0 = bottom face button,
 * 1 = right, 2 = left, 3 = top, 4/5 = bumpers, 6/7 = triggers, 8 = select,
 * 9 = start, 10/11 = stick clicks, 12-15 = D-pad up/down/left/right,
 * 16 = home). Cells 17-24 are stick directions: left stick left, right,
 * up, down, then right stick left, right, up, down.
 * Keyboard sheet: cell 0 is a blank keycap drawn behind the key name.
 * Glyph Cell Overrides can point any control at any cell. A missing sheet
 * falls back to a text badge. Glyph sheets are loaded as plain images:
 * don't encrypt them, and keep them when deploying with "Exclude unused
 * files".
 * Draw one in an MZ window with PokeMZ.Input.drawGlyph(bitmap, action,
 * x, y, size). Preact screens use UI.components.Glyph (PokeMZ_UI_Core).
 *
 * ---------------------------------------------------------------------------
 * Local players
 * ---------------------------------------------------------------------------
 * A second local player can join with their own device: each gamepad is
 * one device and the keyboard is one device. Player 1 uses every device
 * nobody else claimed (so alone, player 1 uses everything).
 *   PokeMZ.Input.players.join(2) -> Promise<{index, deviceId} | null>
 *     waits for Confirm or Start on a device other than player 1's current
 *     one (plugin command "Join Local Player" shows a prompt).
 *   PokeMZ.Input.players.get(2) -> isTriggered(a), dir4, glyph(a), ...
 *   PokeMZ.Input.players.leave(2)
 * Players share bindings and options. If player 2's gamepad is unplugged
 * the "playerlost" event fires and player 2 keeps their slot without a
 * device until they join again. Recordings capture player 1 only.
 * Preact screens take input from a player with useFocus(..., {player: 2})
 * and useCursorList(..., {player: 2}). Co-op battles (PokeMZ_PBS_Battle)
 * let player 2 control the partner in multi battles.
 *
 * ---------------------------------------------------------------------------
 * Rumble, recording, debugging
 * ---------------------------------------------------------------------------
 * rumble(strong, weak, frames) vibrates gamepads (plugin command too).
 * recorder.start() / recorder.stop() -> JSON; recorder.play(json) replays
 * the raw input through the whole pipeline (useful for bug reports and
 * tests). While playtesting:
 *   F10           input debug overlay (device, contexts, actions, sticks)
 *   Shift+F10     start/stop recording (saved in Recording Folder)
 *   Ctrl+F10      replay the last recording
 * registerHotkey({key: "F6", shift: false}, fn) is how the PokeMZ debug
 * tools add their keys; all hotkeys show in the overlay.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PokeMZ_Input";
    const VERSION = 1;

    //=========================================================================
    // Constants
    //=========================================================================

    /** @brief Devices that own sources. */
    const DEVICES = ["keyboard", "gamepad"];

    /** @brief Most local players at once. */
    const MAX_PLAYERS = 2;

    /** @brief Recognized gamepad families (glyph sets). */
    const FAMILIES = ["xbox", "playstation", "switch", "generic"];

    /** @brief Option defaults (overridden by plugin parameters and saves). */
    const DEFAULT_OPTIONS = {
        toggleRun: false,
        tapToTurn: true,
        turnFrames: 6,
        bufferFrames: 8,
        repeatDelay: 1,
        repeatRate: 1,
        holdTime: 1,
        deadzone: 0.2,
        outerDeadzone: 0.95,
        swapConfirmBack: false,
        invertCameraX: false,
        invertCameraY: false,
        glyphStyle: "auto",
        rumble: true,
        rumbleStrength: 1,
        touchControls: "auto",
        touchSize: 1,
        touchOpacity: 0.6,
    };

    /** @brief Allowed values / ranges of each option (validation). */
    const OPTION_RULES = {
        toggleRun: "bool",
        tapToTurn: "bool",
        turnFrames: [1, 30],
        bufferFrames: [0, 30],
        repeatDelay: [0.25, 4],
        repeatRate: [0.25, 4],
        holdTime: [0.25, 4],
        deadzone: [0, 0.9],
        outerDeadzone: [0.5, 1],
        swapConfirmBack: "bool",
        invertCameraX: "bool",
        invertCameraY: "bool",
        glyphStyle: ["auto", "keyboard", "xbox", "playstation", "switch", "generic"],
        rumble: "bool",
        rumbleStrength: [0, 1],
        touchControls: ["auto", "on", "off"],
        touchSize: [0.5, 2],
        touchOpacity: [0.1, 1],
    };

    /** @brief Digital thresholds for analog sources (hysteresis). */
    const PRESS_AT = 0.5;
    const RELEASE_AT = 0.35;

    /** @brief MZ button name -> action id. */
    const LEGACY = {
        ok: "confirm",
        cancel: "back",
        escape: "back",
        menu: "menu",
        shift: "run",
        pageup: "pageUp",
        pagedown: "pageDown",
        up: "up",
        down: "down",
        left: "left",
        right: "right",
        control: "control",
        tab: "tab",
        debug: "debug",
    };

    /** @brief Action id -> MZ name used when writing MZ-style mappers. */
    const LEGACY_NAME = { confirm: "ok", back: "escape", menu: "menu", run: "shift", pageUp: "pageup", pageDown: "pagedown" };
    const LEGACY_PAD_NAME = { back: "cancel" };

    /** @brief Directions in clockwise order (numpad notation). */
    const CLOCKWISE = [8, 6, 2, 4];
    const DIR_ACTIONS = { up: 8, right: 6, down: 2, left: 4 };

    /** @brief keyCode -> KeyboardEvent.code (for MZ-style mappers). */
    const KEYCODE_TO_CODE = (() => {
        const t = {
            8: "Backspace",
            9: "Tab",
            13: "Enter",
            16: "ShiftLeft",
            17: "ControlLeft",
            18: "AltLeft",
            19: "Pause",
            20: "CapsLock",
            27: "Escape",
            32: "Space",
            33: "PageUp",
            34: "PageDown",
            35: "End",
            36: "Home",
            37: "ArrowLeft",
            38: "ArrowUp",
            39: "ArrowRight",
            40: "ArrowDown",
            45: "Insert",
            46: "Delete",
            106: "NumpadMultiply",
            107: "NumpadAdd",
            109: "NumpadSubtract",
            110: "NumpadDecimal",
            111: "NumpadDivide",
            144: "NumLock",
            186: "Semicolon",
            187: "Equal",
            188: "Comma",
            189: "Minus",
            190: "Period",
            191: "Slash",
            192: "Backquote",
            219: "BracketLeft",
            220: "Backslash",
            221: "BracketRight",
            222: "Quote",
        };
        for (let i = 0; i <= 9; i++) {
            t[48 + i] = `Digit${i}`;
            t[96 + i] = `Numpad${i}`;
        }
        for (let i = 0; i < 26; i++) {
            t[65 + i] = `Key${String.fromCharCode(65 + i)}`;
        }
        for (let i = 1; i <= 12; i++) {
            t[111 + i] = `F${i}`;
        }
        return t;
    })();

    /** @brief KeyboardEvent.code -> keyCode (both sides of modifiers). */
    const CODE_TO_KEYCODE = (() => {
        const t = {};
        for (const [k, c] of Object.entries(KEYCODE_TO_CODE)) {
            t[c] = Number(k);
        }
        Object.assign(t, { ShiftRight: 16, ControlRight: 17, AltRight: 18, NumpadEnter: 13, MetaLeft: 91, MetaRight: 92 });
        return t;
    })();

    /** @brief Keys that can't be bound by capture. */
    const RESERVED_CODES = new Set(["Escape", "NumLock", "MetaLeft", "MetaRight", "ContextMenu", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"]);

    /** @brief Display names of keys (words are translated: UI.Key.<word>). */
    const KEY_WORDS = {
        Backspace: "Backspace",
        Tab: "Tab",
        Enter: "Enter",
        NumpadEnter: "Enter",
        ShiftLeft: "Shift",
        ShiftRight: "Shift",
        ControlLeft: "Ctrl",
        ControlRight: "Ctrl",
        AltLeft: "Alt",
        AltRight: "Alt",
        Escape: "Escape",
        Space: "Space",
        PageUp: "PageUp",
        PageDown: "PageDown",
        End: "End",
        Home: "Home",
        Insert: "Insert",
        Delete: "Delete",
    };
    const KEY_SYMBOLS = {
        ArrowLeft: "←",
        ArrowUp: "↑",
        ArrowRight: "→",
        ArrowDown: "↓",
        Semicolon: ";",
        Equal: "=",
        Comma: ",",
        Minus: "-",
        Period: ".",
        Slash: "/",
        Backquote: "`",
        BracketLeft: "[",
        Backslash: "\\",
        BracketRight: "]",
        Quote: "'",
    };

    /** @brief Gamepad button names per family (standard mapping order). */
    const PAD_NAMES = {
        xbox: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "✚↑", "✚↓", "✚←", "✚→", "Guide"],
        playstation: ["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Create", "Options", "L3", "R3", "✚↑", "✚↓", "✚←", "✚→", "PS"],
        switch: ["B", "A", "Y", "X", "L", "R", "ZL", "ZR", "−", "+", "LS", "RS", "✚↑", "✚↓", "✚←", "✚→", "Home"],
        generic: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "LS", "RS", "✚↑", "✚↓", "✚←", "✚→", "Home"],
    };
    const STICK_NAMES = { 0: "LS", 1: "LS", 2: "RS", 3: "RS" };
    const AXIS_ARROWS = { 0: ["←", "→"], 1: ["↑", "↓"], 2: ["←", "→"], 3: ["↑", "↓"] };

    //=========================================================================
    // Helpers
    //=========================================================================

    /**
     * @brief Clamps a number.
     * @param {number} v Value.
     * @param {number} lo Minimum.
     * @param {number} hi Maximum.
     * @return {number} Clamped value.
     */
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    /**
     * @brief Parses a boolean plugin parameter.
     * @param {*} v Raw value.
     * @param {boolean} fb Fallback.
     * @return {boolean} Value.
     */
    const parseBool = (v, fb) => (v === undefined || v === "" ? fb : String(v) === "true");

    /**
     * @brief Parses a numeric plugin parameter.
     * @param {*} v Raw value.
     * @param {number} fb Fallback.
     * @return {number} Value.
     */
    const parseNum = (v, fb) => (v === undefined || v === "" || isNaN(Number(v)) ? fb : Number(v));

    /**
     * @brief Device that owns a source.
     * @param {string} source e.g. "key:KeyZ".
     * @return {string} "keyboard", "gamepad", "touch", "mouse" or "virtual".
     */
    function deviceOf(source) {
        const kind = source.slice(0, source.indexOf(":"));
        switch (kind) {
            case "key":
                return "keyboard";
            case "pad":
            case "axis":
                return "gamepad";
            case "touch":
                return "touch";
            case "mouse":
            case "wheel":
                return "mouse";
            default:
                return "virtual";
        }
    }

    /**
     * @brief Checks a source string.
     * @param {*} s Candidate.
     * @return {boolean} True if it is a well-formed source.
     */
    const isSource = s => typeof s === "string" && /^(key|pad|axis|mouse|wheel|touch|virtual):[\w#+\-.]+$/.test(s);

    /**
     * @brief Gamepad family from a Gamepad.id string.
     * @param {string} id Gamepad id.
     * @return {string} "xbox", "playstation", "switch" or "generic".
     */
    function familyOf(id) {
        const s = String(id || "").toLowerCase();
        if (/xbox|xinput|045e|microsoft|x-box/.test(s)) {
            return "xbox";
        }
        if (/playstation|dualshock|dualsense|054c|sony|ps[345]\b/.test(s)) {
            return "playstation";
        }
        if (/nintendo|switch|joy-?con|057e|pro controller/.test(s)) {
            return "switch";
        }
        return "generic";
    }

    /**
     * @brief Applies a radial deadzone and response curve to a stick.
     * @param {number} x Raw X (-1..1).
     * @param {number} y Raw Y (-1..1).
     * @param {number} inner Inner deadzone.
     * @param {number} outer Outer deadzone (full deflection from here).
     * @return {{x: number, y: number}} Scaled vector (magnitude 0..1).
     */
    function radialDeadzone(x, y, inner, outer) {
        const m = Math.hypot(x, y);
        if (m <= inner || m === 0) {
            return { x: 0, y: 0 };
        }
        const scaled = clamp((m - inner) / Math.max(0.01, outer - inner), 0, 1);
        return { x: (x / m) * scaled, y: (y / m) * scaled };
    }

    /**
     * @brief Numpad direction from axis signs.
     * @param {number} x -1, 0 or 1.
     * @param {number} y -1 (up), 0 or 1 (down).
     * @return {number} 0 or a numpad direction.
     */
    const numpad = (x, y) => (x === 0 && y === 0 ? 0 : 5 - y * 3 + x);

    /**
     * @brief Rotates a 4/8-way direction by quarter turns clockwise.
     * @param {number} dir Numpad direction.
     * @param {number} quarters Quarter turns (any integer).
     * @return {number} Rotated direction.
     */
    function rotateDir(dir, quarters) {
        if (!dir || dir === 5) {
            return dir;
        }
        const q = ((quarters % 4) + 4) % 4;
        if (!q) {
            return dir;
        }
        let x = ((dir - 1) % 3) - 1;
        let y = 1 - Math.floor((dir - 1) / 3);
        for (let i = 0; i < q; i++) {
            [x, y] = [-y, x];
        }
        return numpad(x, y);
    }

    /**
     * @brief Quarter turns that map screen directions onto the map for a
     *        camera at the given yaw (degrees; 0 = looking north).
     * @param {number} yaw Camera yaw in degrees.
     * @return {number} Quarter turns (0-3).
     */
    const quartersForYaw = yaw => ((-Math.round((Number(yaw) || 0) / 90) % 4) + 4) % 4;

    //=========================================================================
    // Built-in actions
    //=========================================================================

    /**
     * @brief Default actions. keyboard/gamepad list sources; the first
     *        entry is the primary binding.
     */
    const BUILTIN_ACTIONS = [
        { id: "confirm", group: "main", labelKey: "UI.Controls.Action.ok", label: "OK", section: "actions", defaults: { keyboard: ["key:KeyZ", "key:Enter", "key:Space", "key:NumpadEnter"], gamepad: ["pad:0"] } },
        { id: "back", group: "main", labelKey: "UI.Controls.Action.cancel", label: "Cancel", section: "actions", defaults: { keyboard: ["key:KeyX", "key:Escape", "key:Insert", "key:Numpad0"], gamepad: ["pad:1"] } },
        { id: "menu", group: "main", labelKey: "UI.Controls.Action.menu", label: "Menu", section: "actions", fallback: "back", defaults: { keyboard: [], gamepad: ["pad:3"] } },
        { id: "run", group: "main", labelKey: "UI.Controls.Action.shift", label: "Run", section: "actions", defaults: { keyboard: ["key:ShiftLeft", "key:ShiftRight"], gamepad: ["pad:2"] } },
        { id: "pageUp", group: "main", labelKey: "UI.Controls.Action.pageup", label: "Page Up", section: "actions", repeat: true, defaults: { keyboard: ["key:KeyQ", "key:PageUp"], gamepad: ["pad:4"] } },
        { id: "pageDown", group: "main", labelKey: "UI.Controls.Action.pagedown", label: "Page Down", section: "actions", repeat: true, defaults: { keyboard: ["key:KeyW", "key:PageDown"], gamepad: ["pad:5"] } },
        { id: "up", group: "main", labelKey: "UI.Controls.Action.up", label: "Up", section: "movement", repeat: true, defaults: { keyboard: ["key:ArrowUp", "key:Numpad8"], gamepad: ["pad:12", "axis:1-"] } },
        { id: "down", group: "main", labelKey: "UI.Controls.Action.down", label: "Down", section: "movement", repeat: true, defaults: { keyboard: ["key:ArrowDown", "key:Numpad2"], gamepad: ["pad:13", "axis:1+"] } },
        { id: "left", group: "main", labelKey: "UI.Controls.Action.left", label: "Left", section: "movement", repeat: true, defaults: { keyboard: ["key:ArrowLeft", "key:Numpad4"], gamepad: ["pad:14", "axis:0-"] } },
        { id: "right", group: "main", labelKey: "UI.Controls.Action.right", label: "Right", section: "movement", repeat: true, defaults: { keyboard: ["key:ArrowRight", "key:Numpad6"], gamepad: ["pad:15", "axis:0+"] } },
        { id: "cameraLeft", group: "main", labelKey: "UI.Controls.Action.cameraLeft", label: "Camera Left", section: "camera", defaults: { keyboard: [], gamepad: ["axis:2-"] } },
        { id: "cameraRight", group: "main", labelKey: "UI.Controls.Action.cameraRight", label: "Camera Right", section: "camera", defaults: { keyboard: [], gamepad: ["axis:2+"] } },
        { id: "cameraUp", group: "main", labelKey: "UI.Controls.Action.cameraUp", label: "Camera Up", section: "camera", defaults: { keyboard: [], gamepad: ["axis:3-"] } },
        { id: "cameraDown", group: "main", labelKey: "UI.Controls.Action.cameraDown", label: "Camera Down", section: "camera", defaults: { keyboard: [], gamepad: ["axis:3+"] } },
        { id: "zoomIn", group: "main", labelKey: "UI.Controls.Action.zoomIn", label: "Zoom In", section: "camera", defaults: { keyboard: [], gamepad: ["pad:7"] } },
        { id: "zoomOut", group: "main", labelKey: "UI.Controls.Action.zoomOut", label: "Zoom Out", section: "camera", defaults: { keyboard: [], gamepad: ["pad:6"] } },
        // MZ system buttons: kept for MZ code, not shown or rebindable.
        { id: "control", group: "system", hidden: true, defaults: { keyboard: ["key:ControlLeft", "key:ControlRight", "key:AltLeft", "key:AltRight"], gamepad: [] } },
        { id: "tab", group: "system", hidden: true, defaults: { keyboard: ["key:Tab"], gamepad: [] } },
        { id: "debug", group: "system", hidden: true, defaults: { keyboard: ["key:F9"], gamepad: [] } },
    ];

    //=========================================================================
    // Engine
    //=========================================================================

    /**
     * @brief A fresh per-action state.
     * @return {Object} State.
     */
    const newState = () => ({
        pressed: false,
        triggered: false,
        released: false,
        repeated: false,
        held: 0,
        value: 0,
        analog: 0,
        digital: false,
        consumed: false,
        viaFallback: false,
        device: "",
    });

    /**
     * @brief Records raw input frames and plays them back (deltas only).
     */
    class Recorder {
        /** @param {Engine} engine Owner. */
        constructor(engine) {
            this.engine = engine;
            this.recording = false;
            this.playing = false;
            this.frames = [];
            this._prev = new Map();
            this._cur = new Map();
            this._index = 0;
            this.last = null;
        }

        /** @brief Starts recording (drops any previous take). */
        start() {
            this.recording = true;
            this.frames = [];
            this._prev = new Map();
            this.engine.emit("recorder", "start");
        }

        /**
         * @brief Stops recording.
         * @return {Object} {version, frames} (JSON-serializable).
         */
        stop() {
            this.recording = false;
            this.last = { version: VERSION, frames: this.frames };
            this.engine.emit("recorder", "stop");
            return this.last;
        }

        /**
         * @brief Stores one frame of source values as a delta.
         * @param {Map<string, number>} values Source values.
         */
        push(values) {
            const delta = {};
            let changed = false;
            for (const [s, v] of values) {
                if (this._prev.get(s) !== v) {
                    delta[s] = v;
                    changed = true;
                }
            }
            for (const s of this._prev.keys()) {
                if (!values.has(s)) {
                    delta[s] = 0;
                    changed = true;
                }
            }
            this.frames.push(changed ? delta : 0);
            this._prev = new Map(values);
        }

        /**
         * @brief Replays a recording. Live input is ignored meanwhile.
         * @param {Object|string} data A recording (or its JSON).
         */
        play(data) {
            const rec = typeof data === "string" ? JSON.parse(data) : data;
            if (!rec || !Array.isArray(rec.frames)) {
                throw new Error("Not an input recording.");
            }
            this.recording = false;
            this.playing = true;
            this._play = rec.frames;
            this._index = 0;
            this._cur = new Map();
            this.engine.release();
            this.engine.locked.clear();
            this.engine.digital.clear();
            this.engine.emit("recorder", "play");
        }

        /** @brief Stops a replay early. */
        cancel() {
            if (this.playing) {
                this.playing = false;
                this.engine.release();
                this.engine.emit("recorder", "end");
            }
        }

        /**
         * @brief Source values of the next replayed frame.
         * @return {Map<string, number>} Values.
         */
        next() {
            const delta = this._play[this._index++];
            if (delta) {
                for (const [s, v] of Object.entries(delta)) {
                    if (v) {
                        this._cur.set(s, v);
                    } else {
                        this._cur.delete(s);
                    }
                }
            }
            if (this._index >= this._play.length) {
                this.playing = false;
                this.engine.emit("recorder", "end");
            }
            return new Map(this._cur);
        }
    }

    /**
     * @brief The input layer. Pure logic: devices write raw source values,
     *        update() turns them into a per-frame action snapshot.
     */
    class Engine {
        /**
         * @param {Object} [opts] {root, index}: extra local players are
         *        engines that share the root's actions, bindings and options
         *        and read only the devices they claimed.
         */
        constructor(opts = {}) {
            /** @brief Player 1's engine (this one for player 1). */
            this.root = opts.root || this;
            /** @brief Local player number (1 = player 1). */
            this.index = opts.index || 1;
            const root = opts.root;
            /** @brief Action definitions by id, in registration order. */
            this.actions = root ? root.actions : new Map();
            /** @brief action -> {keyboard: [...], gamepad: [...]}. */
            this.bindings = root ? root.bindings : {};
            this.options = root ? root.options : Object.assign({}, DEFAULT_OPTIONS);
            /** @brief Defaults for options (after plugin parameters). */
            this.optionDefaults = root ? root.optionDefaults : Object.assign({}, DEFAULT_OPTIONS);
            /** @brief Base repeat timing (MZ Input.keyRepeatWait/Interval). */
            this.repeatWait = 24;
            this.repeatInterval = 6;
            this.frame = 0;
            /** @brief Raw values of keyboard/pointer/virtual sources. */
            this.raw = new Map();
            /** @brief Sources pressed since the last frame was read. */
            this._fresh = new Set();
            /** @brief Presses released before any frame saw them (kept one frame). */
            this._pulses = new Set();
            /** @brief Virtual one-frame taps: action -> frames left. */
            this.taps = new Map();
            /** @brief Returns Gamepad-like objects (set by the MZ layer). */
            this.pollPads = null;
            /** @brief Source values used by the last update. */
            this.values = new Map();
            /** @brief Digital state of each source (with hysteresis). */
            this.digital = new Map();
            /** @brief Sources ignored until released (after focus loss). */
            this.locked = new Set();
            this.states = {};
            this.latest = null;
            this.contexts = [];
            this.marks = new Map();
            this.device = "keyboard";
            this.family = "generic";
            this.padFamilies = [];
            this.lastPressDate = 0;
            this.rotation = 0;
            this.dirStack = [];
            this.dir4 = 0;
            this.dir8 = 0;
            this.dirHeld = 0;
            this._stickDir4 = 0;
            this._stickDir8 = 0;
            this.runToggled = false;
            this.textEntry = false;
            this._textCtx = null;
            this.cameraDelta = { x: 0, y: 0, wheel: 0 };
            this._cameraFrame = { x: 0, y: 0, wheel: 0 };
            this.capture = null;
            this.listeners = {};
            this.recorder = new Recorder(this);
            /** @brief Device id of the last press ("keyboard", "pad#0"...). */
            this.lastDeviceId = "keyboard";
            /** @brief Source -> device id it came from this frame. */
            this._srcDevice = new Map();
            /** @brief Device claimed by this player (players 2+). */
            this.deviceId = null;
            // Player 1 only: the players and who claimed which device.
            /** @brief Local players, player 1 first. */
            this.players = [this];
            /** @brief Device id -> the player (2+) that claimed it. */
            this.claims = new Map();
            /** @brief Device id -> gamepad family. */
            this.padFamilyOf = new Map();
            this.joining = null;
            if (root) {
                for (const id of this.actions.keys()) {
                    this.states[id] = newState();
                }
                return;
            }
            for (const def of BUILTIN_ACTIONS) {
                this.registerAction(def.id, def);
            }
        }

        //---------------------------------------------------------------------
        // Events
        //---------------------------------------------------------------------

        /**
         * @brief Subscribes to an event: devicechange, focuschange,
         *        bindingschange, optionschange, padchange, contextchange,
         *        recorder.
         * @param {string} name Event name.
         * @param {Function} fn Listener.
         * @return {Function} Unsubscribe.
         */
        on(name, fn) {
            (this.listeners[name] = this.listeners[name] || new Set()).add(fn);
            return () => this.off(name, fn);
        }

        /**
         * @brief Removes a listener.
         * @param {string} name Event name.
         * @param {Function} fn Listener.
         */
        off(name, fn) {
            if (this.listeners[name]) {
                this.listeners[name].delete(fn);
            }
        }

        /**
         * @brief Calls an event's listeners.
         * @param {string} name Event name.
         * @param {...*} args Arguments.
         */
        emit(name, ...args) {
            for (const fn of [...(this.listeners[name] || [])]) {
                try {
                    fn(...args);
                } catch (e) {
                    console.error(e);
                }
            }
        }

        //---------------------------------------------------------------------
        // Actions and bindings
        //---------------------------------------------------------------------

        /**
         * @brief Adds (or redefines) an action.
         * @param {string} id Action id.
         * @param {Object} [def] {group = "main", hidden, repeat, fallback,
         *        labelKey, label, section, defaults: {keyboard, gamepad}}.
         * @return {Object} The definition.
         */
        registerAction(id, def = {}) {
            const d = Object.assign({ group: "main", hidden: false, repeat: false, section: "actions", label: id, labelKey: "" }, def, { id });
            d.defaults = {
                keyboard: ((def.defaults && def.defaults.keyboard) || []).filter(isSource),
                gamepad: ((def.defaults && def.defaults.gamepad) || []).filter(isSource),
            };
            this.actions.set(id, d);
            if (!this.bindings[id]) {
                this.bindings[id] = { keyboard: d.defaults.keyboard.slice(), gamepad: d.defaults.gamepad.slice() };
            }
            if (!this.states[id]) {
                this.states[id] = newState();
            }
            return d;
        }

        /**
         * @param {string} name Action id or MZ button name.
         * @return {string} The action id.
         */
        actionFor(name) {
            return this.actions.has(name) ? name : LEGACY[name] || name;
        }

        /**
         * @brief Sources bound to an action on a device, after options such
         *        as swapConfirmBack.
         * @param {string} action Action id.
         * @param {string} device "keyboard" or "gamepad".
         * @return {Array<string>} Sources (primary first).
         */
        sourcesOf(action, device) {
            let id = action;
            if (device === "gamepad" && this.options.swapConfirmBack) {
                id = action === "confirm" ? "back" : action === "back" ? "confirm" : action;
            }
            const b = this.bindings[id];
            return b ? b[device] || [] : [];
        }

        /**
         * @brief Sources that drive an action, with the keyboard fallback
         *        (menu uses Cancel's keys when it has none of its own).
         * @param {string} action Action id.
         * @return {Array<{source: string, fallback: boolean}>} Sources.
         */
        effectiveSources(action) {
            const out = [];
            const def = this.actions.get(action);
            for (const device of DEVICES) {
                let list = this.sourcesOf(action, device);
                let fallback = false;
                if (!list.length && def && def.fallback && device === "keyboard") {
                    list = this.sourcesOf(def.fallback, device);
                    fallback = true;
                }
                for (const source of list) {
                    out.push({ source, fallback });
                }
            }
            out.push({ source: `virtual:${action}`, fallback: false });
            return out;
        }

        /**
         * @brief Binds a source to an action, swapping with its owner.
         * @param {string} action Action id.
         * @param {string} device "keyboard" or "gamepad".
         * @param {string} source Source to bind.
         * @param {number} [slot=0] 0 = primary, 1 = secondary...
         */
        bind(action, device, source, slot = 0) {
            const def = this.actions.get(action);
            if (!def || !isSource(source) || !DEVICES.includes(device)) {
                return;
            }
            const list = this.bindings[action][device];
            const old = list[slot];
            const own = list.indexOf(source);
            if (own >= 0) {
                if (own !== slot && slot < list.length) {
                    list[own] = old;
                    list[slot] = source;
                }
            } else {
                for (const [id, other] of this.actions) {
                    if (id === action) {
                        continue;
                    }
                    const ol = this.bindings[id][device];
                    const j = ol.indexOf(source);
                    if (j < 0) {
                        continue;
                    }
                    if (other.group === def.group && old !== undefined && !ol.includes(old)) {
                        ol[j] = old;
                    } else {
                        ol.splice(j, 1);
                    }
                }
                if (slot < list.length) {
                    list[slot] = source;
                } else {
                    list.push(source);
                }
            }
            this.emit("bindingschange", action, device);
        }

        /**
         * @brief Removes a source from an action.
         * @param {string} action Action id.
         * @param {string} device Device.
         * @param {string} source Source.
         */
        unbind(action, device, source) {
            const list = this.bindings[action] && this.bindings[action][device];
            const i = list ? list.indexOf(source) : -1;
            if (i >= 0) {
                list.splice(i, 1);
                this.emit("bindingschange", action, device);
            }
        }

        /**
         * @brief Restores default bindings.
         * @param {string} [device] Only this device (default: both).
         */
        resetBindings(device) {
            for (const [id, def] of this.actions) {
                for (const d of device ? [device] : DEVICES) {
                    this.bindings[id][d] = def.defaults[d].slice();
                }
            }
            this.emit("bindingschange", null, device || null);
        }

        //---------------------------------------------------------------------
        // Options
        //---------------------------------------------------------------------

        /**
         * @brief Sets an option (validated and clamped).
         * @param {string} id Option id.
         * @param {*} value Value.
         */
        setOption(id, value) {
            const rule = OPTION_RULES[id];
            if (!rule) {
                return;
            }
            let v = value;
            if (rule === "bool") {
                v = !!value;
            } else if (typeof rule[0] === "number") {
                v = clamp(Number(value), rule[0], rule[1]);
                if (isNaN(v)) {
                    return;
                }
            } else if (!rule.includes(value)) {
                return;
            }
            if (this.options[id] !== v) {
                this.options[id] = v;
                if (id === "toggleRun") {
                    this.runToggled = false;
                }
                this.emit("optionschange", id, v);
                if (id === "glyphStyle" || id === "swapConfirmBack") {
                    this.emit("devicechange", this.device, this.family);
                }
            }
        }

        /** @brief Restores every option to its default. */
        resetOptions() {
            for (const id of Object.keys(OPTION_RULES)) {
                this.setOption(id, this.optionDefaults[id]);
            }
        }

        //---------------------------------------------------------------------
        // Persistence
        //---------------------------------------------------------------------

        /**
         * @brief Saveable state (bindings of visible actions and options).
         * @return {Object} {version, bindings, options}.
         */
        serialize() {
            const bindings = {};
            for (const [id, def] of this.actions) {
                if (!def.hidden) {
                    bindings[id] = { keyboard: this.bindings[id].keyboard.slice(), gamepad: this.bindings[id].gamepad.slice() };
                }
            }
            return { version: VERSION, bindings, options: Object.assign({}, this.options) };
        }

        /**
         * @brief Loads serialize() output. Unknown actions are kept for
         *        when their plugin registers them; bad data is ignored.
         * @param {Object} data Saved state.
         */
        load(data) {
            if (!data || typeof data !== "object") {
                return;
            }
            if (data.bindings && typeof data.bindings === "object") {
                for (const [id, b] of Object.entries(data.bindings)) {
                    if (!b || typeof b !== "object") {
                        continue;
                    }
                    if (!this.bindings[id]) {
                        this.bindings[id] = { keyboard: [], gamepad: [] };
                    }
                    for (const d of DEVICES) {
                        if (Array.isArray(b[d])) {
                            this.bindings[id][d] = b[d].filter(isSource);
                        }
                    }
                }
            }
            if (data.options && typeof data.options === "object") {
                for (const [id, v] of Object.entries(data.options)) {
                    this.setOption(id, v);
                }
            }
            this.emit("bindingschange", null, null);
        }

        /**
         * @brief Imports MZ-style mappers (keyCode/button index -> MZ button
         *        name), as saved by PokeMZ_UI_Controls v0.1.
         * @param {Object} [keyMapper] keyCode -> name.
         * @param {Object} [padMapper] button index -> name.
         */
        importLegacy(keyMapper, padMapper) {
            if (keyMapper && typeof keyMapper === "object") {
                this.setDeviceMap("keyboard", keyMapper);
            }
            if (padMapper && typeof padMapper === "object") {
                this.setDeviceMap("gamepad", padMapper);
            }
        }

        /**
         * @brief Replaces a device's bindings from an MZ-style mapper.
         *        Gamepad stick directions are kept on the direction actions.
         * @param {string} device "keyboard" or "gamepad".
         * @param {Object} mapper keyCode / button index -> MZ name.
         */
        setDeviceMap(device, mapper) {
            const kept = {};
            for (const id of this.actions.keys()) {
                kept[id] = device === "gamepad" ? this.bindings[id].gamepad.filter(s => s.startsWith("axis:")) : [];
            }
            for (const id of Object.keys(this.bindings)) {
                this.bindings[id][device] = kept[id] || [];
            }
            for (const [k, name] of Object.entries(mapper)) {
                const source = device === "keyboard" ? this.sourceForKeyCode(Number(k)) : `pad:${Number(k)}`;
                if (!source || !name) {
                    continue;
                }
                const id = this.ensureLegacyAction(String(name));
                const list = this.bindings[id][device];
                if (!list.includes(source)) {
                    list.push(source);
                }
            }
            this.emit("bindingschange", null, device);
        }

        /**
         * @brief Action for an MZ button name, registering a hidden one for
         *        names other plugins invent (keyMapper[65] = "a").
         * @param {string} name MZ button name.
         * @return {string} Action id.
         */
        ensureLegacyAction(name) {
            const id = this.actionFor(name);
            if (!this.actions.has(id)) {
                this.registerAction(id, { group: "custom", hidden: true });
            }
            return id;
        }

        /**
         * @param {number} keyCode keyCode.
         * @return {string} Its source ("key:KeyZ", or "key:#123").
         */
        sourceForKeyCode(keyCode) {
            const code = KEYCODE_TO_CODE[keyCode];
            return code ? `key:${code}` : `key:#${keyCode}`;
        }

        /**
         * @brief An MZ-style mapper view of a device's bindings.
         * @param {string} device "keyboard" or "gamepad".
         * @return {Object} keyCode / button index -> MZ name.
         */
        deviceMap(device) {
            const out = {};
            for (const id of this.actions.keys()) {
                const name = (device === "gamepad" && LEGACY_PAD_NAME[id]) || LEGACY_NAME[id] || id;
                for (const s of this.bindings[id][device]) {
                    if (device === "keyboard") {
                        const code = s.slice(4);
                        const kc = code[0] === "#" ? Number(code.slice(1)) : CODE_TO_KEYCODE[code];
                        if (kc !== undefined && out[kc] === undefined) {
                            out[kc] = name;
                        }
                    } else if (s.startsWith("pad:")) {
                        out[Number(s.slice(4))] = name;
                    }
                }
            }
            return out;
        }

        //---------------------------------------------------------------------
        // Raw input (written by device adapters)
        //---------------------------------------------------------------------

        /**
         * @brief Sets a raw keyboard/pointer source.
         * @param {string} source Source.
         * @param {number} value 0..1 (0 releases).
         */
        setRaw(source, value) {
            if (value) {
                if (!this.raw.has(source)) {
                    this._fresh.add(source);
                }
                this.raw.set(source, value);
            } else {
                // Pressed and released between two frames: keep the press
                // for one frame so quick taps aren't lost.
                if (this._fresh.has(source)) {
                    this._pulses.add(source);
                }
                this.raw.delete(source);
            }
        }

        /**
         * @brief Holds or releases an action from a virtual device (touch
         *        controls, scripts).
         * @param {string} action Action id or MZ name.
         * @param {boolean} down Held.
         * @param {string} [device="touch"] Device to report as active.
         */
        setVirtual(action, down, device = "touch") {
            this.setRaw(`virtual:${this.actionFor(action)}`, down ? 1 : 0);
            if (down) {
                this.noteDevice(device);
            }
        }

        /**
         * @brief Presses an action for exactly one frame.
         * @param {string} action Action id or MZ name.
         */
        tap(action) {
            this.taps.set(this.actionFor(action), 1);
        }

        /**
         * @brief Adds camera movement from the mouse (pixels / wheel steps).
         * @param {number} dx Horizontal movement.
         * @param {number} dy Vertical movement.
         * @param {number} [wheel=0] Wheel steps (+ = zoom out).
         */
        addCameraDelta(dx, dy, wheel = 0) {
            this.cameraDelta.x += dx;
            this.cameraDelta.y += dy;
            this.cameraDelta.wheel += wheel;
        }

        /**
         * @brief Marks a device as the active one.
         * @param {string} device Device.
         * @param {string} [family] Gamepad family.
         */
        noteDevice(device, family) {
            if (device === "virtual") {
                return;
            }
            const fam = family || this.family;
            if (device !== this.device || fam !== this.family) {
                this.device = device;
                this.family = fam;
                this.emit("devicechange", device, fam);
            }
        }

        /**
         * @brief Text entry on/off: typing keys stop reaching the game and a
         *        "textEntry" context is shown.
         * @param {boolean} on Whether a text field has focus.
         */
        setTextEntry(on) {
            if (on === this.textEntry) {
                return;
            }
            this.textEntry = on;
            if (on) {
                this._textCtx = this.pushContext("textEntry", { block: false });
            } else if (this._textCtx) {
                this._textCtx.pop();
                this._textCtx = null;
            }
        }

        //---------------------------------------------------------------------
        // Focus loss
        //---------------------------------------------------------------------

        /**
         * @brief Releases everything; held keys/buttons must be pressed
         *        again before they count.
         */
        release() {
            for (const [s, on] of this.digital) {
                if (on) {
                    this.locked.add(s);
                }
            }
            for (const [s, v] of this.values) {
                if (v) {
                    this.locked.add(s);
                }
            }
            this.raw.clear();
            this._fresh.clear();
            this._pulses.clear();
            this.taps.clear();
            this.marks.clear();
            this.dirStack = [];
            this.dir4 = 0;
            this.dir8 = 0;
            this.dirHeld = 0;
            this.latest = null;
            this.cameraDelta = { x: 0, y: 0, wheel: 0 };
            for (const id of Object.keys(this.states)) {
                this.states[id] = newState();
            }
        }

        /**
         * @brief The window lost focus or was hidden.
         * @param {string} [reason] "blur", "hidden", "pad".
         */
        blur(reason = "blur") {
            this.release();
            if (this.root === this) {
                for (const p of this.players.slice(1)) {
                    p.release();
                }
            }
            this.emit("focuschange", false, reason);
        }

        //---------------------------------------------------------------------
        // Local players
        //---------------------------------------------------------------------

        /**
         * @param {number} index Player number.
         * @return {Engine|null} That player's engine.
         */
        player(index) {
            return this.root.players.find(p => p.index === index) || null;
        }

        /**
         * @brief Adds a local player (no device yet).
         * @param {number} [index] Player number (default: the next free one).
         * @return {Engine|null} Its engine, or null when full.
         */
        addPlayer(index) {
            const root = this.root;
            let n = index;
            if (!n) {
                n = 2;
                while (root.player(n)) {
                    n++;
                }
            }
            if (root.player(n)) {
                return root.player(n);
            }
            if (n < 2 || n > MAX_PLAYERS) {
                return null;
            }
            const p = new Engine({ root, index: n });
            p.repeatWait = root.repeatWait;
            p.repeatInterval = root.repeatInterval;
            root.players.push(p);
            root.players.sort((a, b) => a.index - b.index);
            root.emit("playerchange", n, "added");
            return p;
        }

        /**
         * @brief Removes a local player; its device returns to player 1.
         * @param {number} index Player number (2+).
         */
        removePlayer(index) {
            const root = this.root;
            const p = root.player(index);
            if (!p || p === root) {
                return;
            }
            if (p.deviceId) {
                root.claims.delete(p.deviceId);
            }
            root.players.splice(root.players.indexOf(p), 1);
            root.emit("playerchange", index, "removed");
        }

        /**
         * @brief Gives a device to a player (2+). Player 1 keeps every device
         *        nobody claimed. Sources held on it must be pressed again.
         * @param {string} deviceId "keyboard" or "pad#<index>".
         * @param {number} index Player number.
         */
        claim(deviceId, index) {
            const root = this.root;
            const p = root.player(index);
            if (!p || p === root || deviceId === "virtual") {
                return;
            }
            if (p.deviceId) {
                root.claims.delete(p.deviceId);
            }
            const prev = root.claims.get(deviceId);
            if (prev && prev !== p) {
                prev.deviceId = null;
            }
            root.claims.set(deviceId, p);
            p.deviceId = deviceId;
            p.release();
            const pad = deviceId.startsWith("pad#");
            p.noteDevice(pad ? "gamepad" : "keyboard", pad ? root.padFamilyOf.get(deviceId) || "generic" : p.family);
            root.emit("playerchange", index, "device", deviceId);
        }

        /**
         * @brief Waits for a player to join: the first device (not
         *        excluded, not claimed) to press Confirm or Start.
         * @param {Object} [opts] {index (default: next free), exclude (device
         *        id, usually player 1's), frames = 600}.
         * @return {Promise<{index: number, deviceId: string}|null>} Who
         *         joined, or null (timeout, cancelJoin(), or no free slot).
         */
        joinNext(opts = {}) {
            const root = this.root;
            root.cancelJoin();
            let index = opts.index;
            if (!index) {
                index = 2;
                while (index <= MAX_PLAYERS && root.player(index) && root.player(index).deviceId) {
                    index++;
                }
            }
            if (index < 2 || index > MAX_PLAYERS) {
                return Promise.resolve(null);
            }
            return new Promise(resolve => {
                root.joining = { index, exclude: opts.exclude || null, frames: opts.frames || 600, resolve, prev: null };
            });
        }

        /** @brief Stops waiting for a player to join (resolves null). */
        cancelJoin() {
            const j = this.root.joining;
            if (j) {
                this.root.joining = null;
                j.resolve(null);
            }
        }

        /**
         * @return {number} Frames left of a pending join (0 = none).
         */
        joinFramesLeft() {
            return this.root.joining ? this.root.joining.frames : 0;
        }

        //---------------------------------------------------------------------
        // Contexts and consumption
        //---------------------------------------------------------------------

        /**
         * @brief Pushes an input context.
         * @param {string} id Context id (for debugging).
         * @param {Object} [opts] {block = true, allow: [actions]}.
         * @return {Object} Handle: {id, pop(), isTriggered(a), ...}.
         */
        pushContext(id, opts = {}) {
            const engine = this;
            const ctx = {
                id,
                block: opts.block !== false,
                allow: new Set((opts.allow || []).map(a => this.actionFor(a))),
                pop() {
                    const i = engine.contexts.indexOf(ctx);
                    if (i >= 0) {
                        engine.contexts.splice(i, 1);
                        engine.emit("contextchange");
                    }
                },
                isPressed: a => engine.isPressed(a, ctx),
                isTriggered: a => engine.isTriggered(a, ctx),
                isRepeated: a => engine.isRepeated(a, ctx),
                isReleased: a => engine.isReleased(a, ctx),
                readable: a => engine.readable(engine.actionFor(a), ctx),
            };
            this.contexts.push(ctx);
            this.emit("contextchange");
            return ctx;
        }

        /**
         * @brief Pops the topmost context with an id.
         * @param {string} id Context id.
         */
        popContext(id) {
            for (let i = this.contexts.length - 1; i >= 0; i--) {
                if (this.contexts[i].id === id) {
                    this.contexts[i].pop();
                    return;
                }
            }
        }

        /**
         * @brief Whether an action is visible to a reader.
         * @param {string} action Action id.
         * @param {Object} [ctx] The reader's context (none = bottom, MZ).
         * @return {boolean} True if no blocking context above hides it.
         */
        readable(action, ctx) {
            const from = ctx ? this.contexts.indexOf(ctx) + 1 : 0;
            for (let i = from; i < this.contexts.length; i++) {
                const c = this.contexts[i];
                if (c.block && !c.allow.has(action)) {
                    return false;
                }
            }
            return true;
        }

        /**
         * @brief Hides an action's trigger/repeat for the rest of the frame.
         * @param {string} action Action id or MZ name.
         */
        consume(action) {
            const st = this.states[this.actionFor(action)];
            if (st) {
                st.consumed = true;
            }
        }

        //---------------------------------------------------------------------
        // Buffering
        //---------------------------------------------------------------------

        /**
         * @brief Records a tagged press now (e.g. "player.confirm").
         * @param {string} tag Tag (action ids are marked automatically).
         */
        mark(tag) {
            this.marks.set(tag, this.frame);
        }

        /**
         * @param {string} tag Action id or tag.
         * @param {number} [frames] Window (default: bufferFrames option).
         * @return {boolean} True if pressed within the window.
         */
        isBuffered(tag, frames) {
            const f = this.marks.get(this.actionFor(tag));
            const win = frames === undefined ? this.options.bufferFrames : frames;
            return f !== undefined && this.frame - f <= win;
        }

        /**
         * @brief Like isBuffered, but uses the press up.
         * @param {string} tag Action id or tag.
         * @param {number} [frames] Window.
         * @return {boolean} True if a buffered press was used.
         */
        consumeBuffered(tag, frames) {
            if (this.isBuffered(tag, frames)) {
                this.marks.delete(this.actionFor(tag));
                return true;
            }
            return false;
        }

        //---------------------------------------------------------------------
        // Rebinding capture
        //---------------------------------------------------------------------

        /**
         * @brief Resolves with the next newly pressed key/button.
         * @param {string} device "keyboard" or "gamepad".
         * @param {Object} [opts] {frames = 300}.
         * @return {Promise<string|null>} Source, or null if cancelled
         *         (Escape, timeout or cancelCapture()).
         */
        captureNext(device, opts = {}) {
            this.cancelCapture();
            return new Promise(resolve => {
                this.capture = { device, resolve, frames: opts.frames || 300 };
                this.release();
            });
        }

        /** @brief Cancels a pending capture (resolves null). */
        cancelCapture() {
            if (this.capture) {
                const c = this.capture;
                this.capture = null;
                c.resolve(null);
            }
        }

        /**
         * @return {number} Frames left before a capture times out.
         */
        captureFramesLeft() {
            return this.capture ? this.capture.frames : 0;
        }

        //---------------------------------------------------------------------
        // Frame update
        //---------------------------------------------------------------------

        /**
         * @brief Reads every device and builds this frame's snapshot.
         */
        update() {
            this.frame++;
            const subs = this.players.slice(1);
            for (const p of subs) {
                p.frame = this.frame;
                p.repeatWait = this.repeatWait;
                p.repeatInterval = this.repeatInterval;
            }
            if (this.recorder.playing) {
                this._srcDevice = new Map();
                this.evaluate(this.recorder.next());
                for (const p of subs) {
                    p.evaluate(new Map());
                }
                return;
            }
            const devices = this.readDevices();
            this._checkClaims(devices);
            this._updateJoin(devices);
            const values = this.valuesFor(this, devices);
            if (this.recorder.recording) {
                this.recorder.push(values);
            }
            this.evaluate(values);
            for (const p of subs) {
                p.evaluate(this.valuesFor(p, devices));
            }
        }

        /**
         * @brief Merges the source values of the devices a player owns.
         *        Player 1 owns every device nobody claimed.
         * @param {Engine} player Player engine.
         * @param {Map<string, Map<string, number>>} devices Per-device values.
         * @return {Map<string, number>} Source -> value.
         */
        valuesFor(player, devices) {
            const values = new Map();
            const from = new Map();
            for (const [id, m] of devices) {
                if ((this.claims.get(id) || this) !== player) {
                    continue;
                }
                for (const [s, v] of m) {
                    if (v > (values.get(s) || 0)) {
                        values.set(s, v);
                        from.set(s, id);
                    }
                }
            }
            player._srcDevice = from;
            return values;
        }

        /**
         * @brief A claimed gamepad that disappeared frees its player.
         * @param {Map<string, Map>} devices This frame's devices.
         */
        _checkClaims(devices) {
            for (const [id, p] of [...this.claims]) {
                if (!devices.has(id)) {
                    this.claims.delete(id);
                    p.deviceId = null;
                    p.release();
                    this.emit("playerlost", p.index, id);
                    this.emit("playerchange", p.index, "lost", id);
                }
            }
        }

        /**
         * @brief Joins the first free device that presses Confirm or Start
         *        while a join is pending (edges only: held buttons don't).
         * @param {Map<string, Map>} devices This frame's devices.
         */
        _updateJoin(devices) {
            const j = this.joining;
            if (!j) {
                return;
            }
            if (--j.frames <= 0) {
                this.cancelJoin();
                return;
            }
            const now = new Map();
            for (const [id, m] of devices) {
                if (id === "virtual" || id === j.exclude || this.claims.has(id)) {
                    continue;
                }
                const type = id === "keyboard" ? "keyboard" : "gamepad";
                const sources = this.bindings.confirm[type].concat(type === "gamepad" ? ["pad:9"] : []);
                now.set(id, sources.some(s => (m.get(s) || 0) >= PRESS_AT));
            }
            const prev = j.prev;
            j.prev = now;
            if (!prev) {
                return; // first frame: only learn what is already held
            }
            for (const [id, down] of now) {
                if (down && prev.get(id) === false) {
                    this.joining = null;
                    const p = this.addPlayer(j.index);
                    if (!p) {
                        j.resolve(null);
                        return;
                    }
                    this.claim(id, j.index);
                    for (const [s, v] of devices.get(id)) {
                        if (v > 0) {
                            p.locked.add(s);
                        }
                    }
                    j.resolve({ index: j.index, deviceId: id });
                    return;
                }
            }
        }

        /**
         * @brief Reads every device once (player 1's engine only).
         * @return {Map<string, Map<string, number>>} Device id ("keyboard",
         *         "virtual", "pad#<index>") -> source -> value.
         */
        readDevices() {
            const devices = new Map();
            const keyboard = new Map();
            const virtual = new Map();
            const put0 = (s, v) => (s.startsWith("key:") ? keyboard : virtual).set(s, v);
            for (const [s, v] of this.raw) {
                put0(s, v);
            }
            for (const s of this._pulses) {
                put0(s, 1);
            }
            this._pulses.clear();
            this._fresh.clear();
            for (const [id, n] of this.taps) {
                virtual.set(`virtual:${id}`, 1);
                if (n <= 1) {
                    this.taps.delete(id);
                } else {
                    this.taps.set(id, n - 1);
                }
            }
            devices.set("keyboard", keyboard);
            devices.set("virtual", virtual);
            const pads = this.pollPads ? this.pollPads() : [];
            this.padFamilies = [];
            pads.forEach((pad, n) => {
                if (!pad || pad.connected === false) {
                    return;
                }
                const family = familyOf(pad.id);
                const deviceId = `pad#${pad.index !== undefined ? pad.index : n}`;
                this.padFamilies.push(family);
                this.padFamilyOf.set(deviceId, family);
                const values = new Map();
                devices.set(deviceId, values);
                const put = (s, v) => {
                    if (v > 0 && v > (values.get(s) || 0)) {
                        values.set(s, v);
                    }
                };
                (pad.buttons || []).forEach((b, i) => {
                    const v = typeof b === "number" ? b : b.pressed ? Math.max(b.value || 0, 1) : b.value || 0;
                    put(`pad:${i}`, v > 0.05 ? v : 0);
                });
                const axes = pad.axes || [];
                for (let a = 0; a + 1 < axes.length && a < 4; a += 2) {
                    const v = radialDeadzone(axes[a] || 0, axes[a + 1] || 0, this.options.deadzone, this.options.outerDeadzone);
                    put(`axis:${a}-`, Math.max(0, -v.x));
                    put(`axis:${a}+`, Math.max(0, v.x));
                    put(`axis:${a + 1}-`, Math.max(0, -v.y));
                    put(`axis:${a + 1}+`, Math.max(0, v.y));
                }
                for (let a = 4; a < axes.length; a++) {
                    const raw = axes[a] || 0;
                    const m = Math.abs(raw) <= this.options.deadzone ? 0 : (Math.abs(raw) - this.options.deadzone) / (1 - this.options.deadzone);
                    put(`axis:${a}${raw < 0 ? "-" : "+"}`, m);
                }
            });
            this._cameraFrame = this.cameraDelta;
            this.cameraDelta = { x: 0, y: 0, wheel: 0 };
            return devices;
        }

        /**
         * @brief Turns source values into the action snapshot.
         * @param {Map<string, number>} values Source values.
         */
        evaluate(values) {
            this.values = values;
            // Locked sources unlock once released.
            for (const s of [...this.locked]) {
                if (!(values.get(s) > 0)) {
                    this.locked.delete(s);
                    this.digital.set(s, false);
                }
            }
            // Digital state with hysteresis; newly pressed sources.
            const pressedNow = [];
            const seen = new Set([...values.keys(), ...this.digital.keys()]);
            for (const s of seen) {
                const v = values.get(s) || 0;
                const was = !!this.digital.get(s);
                const on = !this.locked.has(s) && (was ? v >= RELEASE_AT : v >= PRESS_AT);
                if (on) {
                    this.digital.set(s, true);
                    if (!was) {
                        pressedNow.push(s);
                    }
                } else if (was || this.digital.has(s)) {
                    this.digital.delete(s);
                }
            }
            // Active device: whoever pressed something new.
            for (const s of pressedNow) {
                const dev = deviceOf(s);
                if (dev !== "virtual") {
                    const id = this._srcDevice.get(s);
                    if (id) {
                        this.lastDeviceId = id;
                    }
                    this.noteDevice(dev, dev === "gamepad" ? (id && this.root.padFamilyOf.get(id)) || this.family : this.family);
                    this.lastPressDate = Date.now();
                }
            }

            // Rebinding capture swallows everything.
            if (this.capture) {
                this._updateCapture(pressedNow);
                for (const id of Object.keys(this.states)) {
                    this.states[id] = newState();
                }
                this.dir4 = this.dir8 = 0;
                return;
            }

            // Actions.
            const wait = Math.max(1, Math.round(this.repeatWait * this.options.repeatDelay));
            const interval = Math.max(1, Math.round(this.repeatInterval * this.options.repeatRate));
            for (const id of this.actions.keys()) {
                const st = this.states[id] || (this.states[id] = newState());
                let pressed = false;
                let digital = false;
                let value = 0;
                let analog = 0;
                let viaOwn = false;
                let device = "";
                for (const { source, fallback } of this.effectiveSources(id)) {
                    const on = !!this.digital.get(source);
                    const v = this.locked.has(source) ? 0 : values.get(source) || 0;
                    if (on) {
                        pressed = true;
                        device = device || deviceOf(source);
                        if (!fallback) {
                            viaOwn = true;
                        }
                        if (!source.startsWith("axis:")) {
                            digital = true;
                        }
                    }
                    if (v > value) {
                        value = v;
                    }
                    if (source.startsWith("axis:") && v > analog) {
                        analog = v;
                    }
                }
                const was = st.pressed;
                st.pressed = pressed;
                st.triggered = pressed && !was;
                st.released = !pressed && was;
                st.held = pressed ? (was ? st.held + 1 : 0) : 0;
                st.value = pressed ? Math.max(value, 1e-3) : value;
                st.analog = analog;
                st.digital = digital;
                st.consumed = false;
                st.viaFallback = pressed && !viaOwn;
                st.device = device;
                if (st.triggered) {
                    this.latest = id;
                    this.marks.set(id, this.frame);
                    if (id === "run" && this.options.toggleRun) {
                        this.runToggled = !this.runToggled;
                    }
                }
            }
            if (this.latest && !this.states[this.latest].pressed) {
                this.latest = null;
            }
            for (const id of this.actions.keys()) {
                const st = this.states[id];
                st.repeated = st.triggered || (st.pressed && this.latest === id && st.held >= wait && (st.held - wait) % interval === 0);
            }
            this._updateDirections();
        }

        /**
         * @brief Feeds newly pressed sources to a pending capture.
         * @param {Array<string>} pressedNow Sources pressed this frame.
         */
        _updateCapture(pressedNow) {
            const c = this.capture;
            if (--c.frames <= 0) {
                this.cancelCapture();
                return;
            }
            for (const s of pressedNow) {
                if (s === "key:Escape") {
                    this.locked.add(s);
                    this.cancelCapture();
                    return;
                }
                if (deviceOf(s) !== c.device || (s.startsWith("key:") && RESERVED_CODES.has(s.slice(4)))) {
                    continue;
                }
                this.locked.add(s);
                this.capture = null;
                c.resolve(s);
                return;
            }
        }

        /**
         * @brief Resolves dir4/dir8: last pressed key wins; sticks use
         *        angle sectors with hysteresis.
         */
        _updateDirections() {
            for (const [id, dir] of Object.entries(DIR_ACTIONS)) {
                const st = this.states[id];
                const inStack = this.dirStack.indexOf(dir);
                if (st.digital && inStack < 0) {
                    this.dirStack.unshift(dir);
                } else if (!st.digital && inStack >= 0) {
                    this.dirStack.splice(inStack, 1);
                }
            }
            const s = this.states;
            let dir4 = 0;
            let dir8 = 0;
            if (this.dirStack.length) {
                dir4 = this.dirStack[0];
                const x = (s.right.digital ? 1 : 0) - (s.left.digital ? 1 : 0);
                const y = (s.down.digital ? 1 : 0) - (s.up.digital ? 1 : 0);
                dir8 = numpad(x, y) || dir4;
                this._stickDir4 = this._stickDir8 = 0;
            } else {
                const x = s.right.analog - s.left.analog;
                const y = s.down.analog - s.up.analog;
                const m = Math.hypot(x, y);
                const active = this._stickDir4 ? m >= RELEASE_AT : m >= PRESS_AT;
                if (active) {
                    const angle = Math.atan2(y, x);
                    this._stickDir4 = this._sector(angle, 4, this._stickDir4);
                    this._stickDir8 = this._sector(angle, 8, this._stickDir8);
                } else {
                    this._stickDir4 = this._stickDir8 = 0;
                }
                dir4 = this._stickDir4;
                dir8 = this._stickDir8;
            }
            this.dirHeld = dir4 && dir4 === this.dir4 ? this.dirHeld + 1 : 0;
            this.dir4 = dir4;
            this.dir8 = dir8;
        }

        /**
         * @brief Picks the stick sector for an angle, keeping the current
         *        one until the stick is clearly past its edge.
         * @param {number} angle Radians (0 = right, y down).
         * @param {number} n 4 or 8 sectors.
         * @param {number} current Current numpad direction (0 = none).
         * @return {number} Numpad direction.
         */
        _sector(angle, n, current) {
            const step = (Math.PI * 2) / n;
            const toDir = k => {
                const a = k * step;
                return numpad(Math.round(Math.cos(a)), Math.round(Math.sin(a)));
            };
            if (current) {
                for (let k = 0; k < n; k++) {
                    if (toDir(k) === current) {
                        let d = Math.abs(angle - k * step) % (Math.PI * 2);
                        d = Math.min(d, Math.PI * 2 - d);
                        if (d <= step / 2 + (Math.PI / 180) * 10) {
                            return current;
                        }
                    }
                }
            }
            const k = ((Math.round(angle / step) % n) + n) % n;
            return toDir(k);
        }

        //---------------------------------------------------------------------
        // Queries
        //---------------------------------------------------------------------

        /**
         * @param {string} a Action id or MZ name.
         * @return {Object} The action's state (shared; don't mutate).
         */
        state(a) {
            return this.states[this.actionFor(a)] || newState();
        }

        /**
         * @param {string} a Action id or MZ name.
         * @param {Object} [ctx] Reader context.
         * @return {boolean} True while held.
         */
        isPressed(a, ctx) {
            const id = this.actionFor(a);
            return this.state(id).pressed && this.readable(id, ctx);
        }

        /**
         * @param {string} a Action id or MZ name.
         * @param {Object} [ctx] Reader context.
         * @return {boolean} True on the frame it was pressed.
         */
        isTriggered(a, ctx) {
            const id = this.actionFor(a);
            const st = this.state(id);
            return st.triggered && !st.consumed && this.readable(id, ctx);
        }

        /**
         * @param {string} a Action id or MZ name.
         * @param {Object} [ctx] Reader context.
         * @return {boolean} True on press and then at the repeat rate.
         */
        isRepeated(a, ctx) {
            const id = this.actionFor(a);
            const st = this.state(id);
            return st.repeated && !st.consumed && this.readable(id, ctx);
        }

        /**
         * @param {string} a Action id or MZ name.
         * @param {Object} [ctx] Reader context.
         * @return {boolean} True on the frame it was released.
         */
        isReleased(a, ctx) {
            const id = this.actionFor(a);
            return this.state(id).released && this.readable(id, ctx);
        }

        /**
         * @param {string} a Action id or MZ name.
         * @return {boolean} True once held for the long-press time.
         */
        isLongPressed(a) {
            const id = this.actionFor(a);
            const st = this.state(id);
            return st.pressed && this.latest === id && st.held >= Math.round(this.repeatWait * this.options.holdTime) && this.readable(id);
        }

        /**
         * @param {string} a Action id or MZ name.
         * @return {number} Analog value 0..1.
         */
        value(a) {
            const id = this.actionFor(a);
            return this.readable(id) ? this.state(id).value : 0;
        }

        /**
         * @param {string} a Action id or MZ name.
         * @return {number} Frames held (0 on the press frame, -1 if up).
         */
        heldFrames(a) {
            const st = this.state(a);
            return st.pressed ? st.held : -1;
        }

        /**
         * @return {number} dir4 rotated for the camera (grid movement).
         */
        moveDirection() {
            if (!this.readable("up")) {
                return 0;
            }
            return rotateDir(this.dir4, this.rotation);
        }

        /**
         * @return {{x: number, y: number}} Movement vector (-1..1, y down).
         */
        moveVector() {
            const s = this.states;
            return { x: clamp(s.right.value - s.left.value, -1, 1), y: clamp(s.down.value - s.up.value, -1, 1) };
        }

        /**
         * @brief Camera input this frame (sticks/buttons plus mouse drag and
         *        wheel), with the invert options applied.
         * @return {{yaw: number, pitch: number, zoom: number}} Values.
         */
        camera() {
            const s = this.states;
            const ix = this.options.invertCameraX ? -1 : 1;
            const iy = this.options.invertCameraY ? -1 : 1;
            const m = this._cameraFrame;
            return {
                yaw: ((s.cameraRight.value - s.cameraLeft.value) + m.x / 100) * ix,
                pitch: ((s.cameraDown.value - s.cameraUp.value) + m.y / 100) * iy,
                zoom: s.zoomOut.value - s.zoomIn.value + m.wheel,
            };
        }

        /**
         * @return {boolean} True if the player should run (toggle-run aware;
         *         MZ's Always Dash is applied by the caller).
         */
        isRunning() {
            return this.options.toggleRun ? this.runToggled : this.isPressed("run");
        }

        //---------------------------------------------------------------------
        // Glyphs
        //---------------------------------------------------------------------

        /**
         * @return {{device: string, family: string}} Device and family that
         *         glyphs are shown for (glyphStyle option applied).
         */
        glyphTarget() {
            const style = this.options.glyphStyle;
            if (style === "keyboard") {
                return { device: "keyboard", family: "keyboard" };
            }
            if (style !== "auto") {
                return { device: "gamepad", family: style };
            }
            if (this.device === "gamepad") {
                return { device: "gamepad", family: this.family };
            }
            return { device: "keyboard", family: "keyboard" };
        }

        /**
         * @brief The source to show for an action.
         * @param {string} a Action id or MZ name.
         * @param {string} [device] Device (default: glyph target).
         * @return {string|null} Source.
         */
        glyphSource(a, device) {
            const id = this.actionFor(a);
            const d = device || this.glyphTarget().device;
            let list = this.sourcesOf(id, d);
            const def = this.actions.get(id);
            if (!list.length && def && def.fallback) {
                list = this.sourcesOf(def.fallback, d);
            }
            return list[0] || null;
        }

        /**
         * @brief Display text of a source.
         * @param {string} source Source.
         * @param {string} [family] Gamepad family.
         * @param {Function} [t] Translator (key, fallback) -> text.
         * @return {string} Text.
         */
        sourceName(source, family, t) {
            const tr = t || ((k, fb) => fb);
            if (!source) {
                return "—";
            }
            const [kind, ctl] = [source.slice(0, source.indexOf(":")), source.slice(source.indexOf(":") + 1)];
            if (kind === "key") {
                return keyName(ctl, tr);
            }
            const fam = FAMILIES.includes(family) ? family : "generic";
            if (kind === "pad") {
                return PAD_NAMES[fam][Number(ctl)] || `#${ctl}`;
            }
            if (kind === "axis") {
                const n = parseInt(ctl, 10);
                const sign = ctl.endsWith("-") ? 0 : 1;
                if (STICK_NAMES[n]) {
                    return `${fam === "playstation" ? STICK_NAMES[n][0] : STICK_NAMES[n]}${AXIS_ARROWS[n][sign]}`;
                }
                return `${tr("UI.Key.Axis", "Axis")} ${n}${sign ? "+" : "−"}`;
            }
            return ctl;
        }
    }

    /**
     * @brief Display name of a keyboard code.
     * @param {string} code KeyboardEvent.code (or "#123").
     * @param {Function} t Translator.
     * @return {string} Name.
     */
    function keyName(code, t) {
        if (KEY_WORDS[code]) {
            return t(`UI.Key.${KEY_WORDS[code]}`, KEY_WORDS[code] === "Escape" ? "Esc" : KEY_WORDS[code]);
        }
        if (KEY_SYMBOLS[code]) {
            return KEY_SYMBOLS[code];
        }
        let m = /^Key([A-Z])$/.exec(code) || /^Digit(\d)$/.exec(code);
        if (m) {
            return m[1];
        }
        m = /^Numpad(\d)$/.exec(code);
        if (m) {
            return `${t("UI.Key.Numpad", "Num")} ${m[1]}`;
        }
        if (/^F\d+$/.test(code)) {
            return code;
        }
        return code[0] === "#" ? code : code.replace(/(Left|Right)$/, "");
    }

    /** @brief Internals for tests and tools. */
    const internals = { Engine, Recorder, familyOf, radialDeadzone, rotateDir, quartersForYaw, deviceOf, isSource, keyName, KEYCODE_TO_CODE, CODE_TO_KEYCODE, DEFAULT_OPTIONS, BUILTIN_ACTIONS, LEGACY };

    if (typeof PluginManager === "undefined") {
        if (typeof module !== "undefined" && module.exports) {
            module.exports = internals;
        }
        return;
    }

    //=========================================================================
    // MZ integration
    //=========================================================================

    const params = PluginManager.parameters(PLUGIN_NAME);
    const CONFIG = {
        tapToTurn: parseBool(params.tapToTurn, true),
        turnFrames: parseNum(params.turnFrames, 6),
        bufferFrames: parseNum(params.bufferFrames, 8),
        cameraRelative: parseBool(params.cameraRelative, true),
        deadzone: parseNum(params.deadzone, 0.2),
        glyphFolder: String(params.glyphFolder || "img/system/").replace(/\/?$/, "/"),
        glyphCell: parseNum(params.glyphCell, 16),
        glyphColumns: parseNum(params.glyphColumns, 8),
        glyphMap: (() => {
            try {
                const raw = params.glyphMap ? JSON.parse(params.glyphMap) : "";
                return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
            } catch (e) {
                console.warn(`[${PLUGIN_NAME}] Glyph Cell Overrides is not valid JSON.`, e);
                return {};
            }
        })(),
        touchControls: ["auto", "on", "off"].includes(params.touchControls) ? params.touchControls : "auto",
        overlayKey: params.overlayKey || "F10",
        recordFolder: params.recordFolder || "input-recordings",
    };

    const engine = new Engine();
    Object.assign(engine.optionDefaults, {
        tapToTurn: CONFIG.tapToTurn,
        turnFrames: CONFIG.turnFrames,
        bufferFrames: CONFIG.bufferFrames,
        deadzone: CONFIG.deadzone,
        touchControls: CONFIG.touchControls,
    });
    engine.resetOptions();

    const isPlaytest = () => {
        try {
            return Utils.isOptionValid("test");
        } catch (e) {
            return false;
        }
    };

    /**
     * @brief Translates through PokeMZ.UI when it is loaded.
     * @param {string} key String key.
     * @param {string} fb Fallback.
     * @return {string} Text.
     */
    const t = (key, fb) => {
        const UI = window.PokeMZ && window.PokeMZ.UI;
        return UI && UI.t ? UI.t(key, fb) : fb;
    };

    //-------------------------------------------------------------------------
    // Gamepads
    //-------------------------------------------------------------------------

    engine.pollPads = () => {
        if (!navigator.getGamepads) {
            return [];
        }
        try {
            return [...navigator.getGamepads()].filter(p => p && p.connected);
        } catch (e) {
            return [];
        }
    };

    //-------------------------------------------------------------------------
    // Text entry
    //-------------------------------------------------------------------------

    /**
     * @param {Element} el An element.
     * @return {boolean} True if typing into it produces text.
     */
    function isTextField(el) {
        if (!el || el === document.body) {
            return false;
        }
        if (el.isContentEditable) {
            return true;
        }
        if (el.tagName === "TEXTAREA") {
            return true;
        }
        if (el.tagName === "INPUT") {
            return !/^(button|checkbox|radio|range|submit|reset|color|file|image)$/i.test(el.type || "text");
        }
        return false;
    }

    let composing = false;
    const refreshTextEntry = () => engine.setTextEntry(composing || isTextField(document.activeElement));

    /**
     * @param {KeyboardEvent} e Key event.
     * @return {boolean} True if the key types text (letters, digits,
     *         symbols, space, backspace).
     */
    const typesText = e => e.isComposing || composing || (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) || e.key === "Backspace" || e.key === "Delete";

    //-------------------------------------------------------------------------
    // Keyboard
    //-------------------------------------------------------------------------

    /**
     * @param {KeyboardEvent} e Key event.
     * @return {string} Its source.
     */
    const keySource = e => (e.code ? `key:${e.code}` : engine.sourceForKeyCode(e.keyCode));

    const PREVENT_DEFAULT = new Set(["Backspace", "Tab", "PageUp", "PageDown", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]);

    /**
     * @brief keydown: updates raw state.
     * @param {KeyboardEvent} e Event.
     */
    function onKeyDown(e) {
        if (engine.textEntry && typesText(e)) {
            return;
        }
        if (!engine.textEntry && PREVENT_DEFAULT.has(e.code || KEYCODE_TO_CODE[e.keyCode])) {
            e.preventDefault();
        }
        if (e.keyCode === 144) {
            engine.release();
        }
        engine.setRaw(keySource(e), 1);
    }

    /**
     * @brief keyup: updates raw state.
     * @param {KeyboardEvent} e Event.
     */
    function onKeyUp(e) {
        engine.setRaw(keySource(e), 0);
        // Some browsers send keyup for only one Shift when both were held.
        if (e.key === "Shift") {
            engine.setRaw("key:ShiftLeft", 0);
            engine.setRaw("key:ShiftRight", 0);
        }
    }

    //-------------------------------------------------------------------------
    // Hotkeys
    //-------------------------------------------------------------------------

    const hotkeys = [];

    /**
     * @brief Registers a hotkey (debug tools and the like). Modifiers are
     *        matched exactly: {key: "F6"} doesn't fire for Shift+F6.
     * @param {Object} spec {key ("F6") | code ("KeyP") | keyCode (117),
     *        shift, ctrl, alt, repeat = false, label, playtestOnly}.
     * @param {Function} fn Called with the KeyboardEvent.
     * @return {Function} Unregister.
     */
    function registerHotkey(spec, fn) {
        const entry = Object.assign({ shift: false, ctrl: false, alt: false, repeat: false, playtestOnly: false }, spec, { fn });
        if (entry.playtestOnly && !isPlaytest()) {
            return () => {};
        }
        hotkeys.push(entry);
        return () => {
            const i = hotkeys.indexOf(entry);
            if (i >= 0) {
                hotkeys.splice(i, 1);
            }
        };
    }

    /**
     * @brief Text of a hotkey ("Shift+F6").
     * @param {Object} h Hotkey entry.
     * @return {string} Text.
     */
    const hotkeyText = h => `${h.ctrl ? "Ctrl+" : ""}${h.alt ? "Alt+" : ""}${h.shift ? "Shift+" : ""}${h.key || h.code || (KEYCODE_TO_CODE[h.keyCode] || `#${h.keyCode}`)}`;

    /**
     * @brief Dispatches hotkeys (capture phase, before the game sees it).
     * @param {KeyboardEvent} e Event.
     */
    function onHotkey(e) {
        if (engine.textEntry && typesText(e)) {
            return;
        }
        for (const h of [...hotkeys]) {
            const keyOk = (h.key !== undefined && h.key === e.key) || (h.code !== undefined && h.code === e.code) || (h.keyCode !== undefined && h.keyCode === e.keyCode);
            if (!keyOk || !!h.shift !== e.shiftKey || !!h.ctrl !== e.ctrlKey || !!h.alt !== e.altKey || (e.repeat && !h.repeat)) {
                continue;
            }
            e.preventDefault();
            try {
                h.fn(e);
            } catch (err) {
                console.error(err);
            }
        }
    }

    //-------------------------------------------------------------------------
    // MZ Input shim
    //-------------------------------------------------------------------------

    /**
     * @brief A live, writable MZ-style mapper view of a device's bindings.
     * @param {string} device "keyboard" or "gamepad".
     * @return {Proxy} Mapper.
     */
    function mapperProxy(device) {
        const toSource = k => (device === "keyboard" ? engine.sourceForKeyCode(Number(k)) : `pad:${Number(k)}`);
        return new Proxy(
            {},
            {
                get: (_, k) => (typeof k === "string" ? engine.deviceMap(device)[k] : undefined),
                set: (_, k, name) => {
                    const source = toSource(k);
                    for (const id of engine.actions.keys()) {
                        engine.unbind(id, device, source);
                    }
                    if (name) {
                        const list = engine.bindings[engine.ensureLegacyAction(String(name))][device];
                        list.push(source);
                    }
                    return true;
                },
                deleteProperty: (_, k) => {
                    const source = toSource(k);
                    for (const id of engine.actions.keys()) {
                        engine.unbind(id, device, source);
                    }
                    return true;
                },
                has: (_, k) => k in engine.deviceMap(device),
                ownKeys: () => Object.keys(engine.deviceMap(device)),
                getOwnPropertyDescriptor: (_, k) => {
                    const v = engine.deviceMap(device)[k];
                    return v === undefined ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
                },
            }
        );
    }

    const keyProxy = mapperProxy("keyboard");
    const padProxy = mapperProxy("gamepad");
    Object.defineProperty(Input, "keyMapper", {
        get: () => keyProxy,
        set: map => engine.setDeviceMap("keyboard", map || {}),
        configurable: true,
    });
    Object.defineProperty(Input, "gamepadMapper", {
        get: () => padProxy,
        set: map => engine.setDeviceMap("gamepad", map || {}),
        configurable: true,
    });

    Input.clear = function() {
        engine.release();
    };

    Input.update = function() {
        engine.repeatWait = this.keyRepeatWait;
        engine.repeatInterval = this.keyRepeatInterval;
        updateCameraRotation();
        engine.update();
    };

    Input.isPressed = name => engine.isPressed(name);
    Input.isTriggered = name => engine.isTriggered(name);
    Input.isRepeated = name => engine.isRepeated(name);
    Input.isLongPressed = name => engine.isLongPressed(name);
    Input.virtualClick = name => engine.tap(name);
    Object.defineProperty(Input, "dir4", { get: () => (engine.readable("up") ? engine.dir4 : 0), configurable: true });
    Object.defineProperty(Input, "dir8", { get: () => (engine.readable("up") ? engine.dir8 : 0), configurable: true });
    Object.defineProperty(Input, "date", { get: () => engine.lastPressDate, configurable: true });

    Input._setupEventHandlers = function() {
        document.addEventListener("keydown", onHotkey, true);
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("keyup", onKeyUp);
        document.addEventListener("focusin", refreshTextEntry);
        document.addEventListener("focusout", () => setTimeout(refreshTextEntry, 0));
        document.addEventListener("compositionstart", () => {
            composing = true;
            refreshTextEntry();
        });
        document.addEventListener("compositionend", () => {
            composing = false;
            refreshTextEntry();
        });
        window.addEventListener("blur", () => engine.blur("blur"));
        document.addEventListener("visibilitychange", () => document.hidden && engine.blur("hidden"));
        window.addEventListener("gamepadconnected", e => engine.emit("padchange", "connected", e.gamepad));
        window.addEventListener("gamepaddisconnected", e => {
            engine.blur("pad");
            engine.emit("padchange", "disconnected", e.gamepad);
        });
        try {
            if (typeof nw !== "undefined" && nw.Window) {
                nw.Window.get().on("blur", () => engine.blur("blur"));
            }
        } catch (e) {
            // Not NW.js.
        }
    };
    Input._onLostFocus = () => engine.blur("blur");
    Input._pollGamepads = () => {};

    //-------------------------------------------------------------------------
    // Pointer (active device, camera drag)
    //-------------------------------------------------------------------------

    let mouseTravel = 0;
    let lastMouse = null;

    const _onMouseDown = TouchInput._onMouseDown;
    TouchInput._onMouseDown = function(event) {
        engine.noteDevice("mouse");
        lastMouse = { x: event.pageX, y: event.pageY };
        _onMouseDown.apply(this, arguments);
    };

    const _onMouseMove = TouchInput._onMouseMove;
    TouchInput._onMouseMove = function(event) {
        if (lastMouse) {
            const dx = event.pageX - lastMouse.x;
            const dy = event.pageY - lastMouse.y;
            mouseTravel += Math.abs(dx) + Math.abs(dy);
            if (event.buttons & 4) {
                engine.addCameraDelta(dx, dy);
            }
        }
        lastMouse = { x: event.pageX, y: event.pageY };
        if (mouseTravel > 24) {
            mouseTravel = 0;
            engine.noteDevice("mouse");
        }
        _onMouseMove.apply(this, arguments);
    };

    const _onWheel = TouchInput._onWheel;
    TouchInput._onWheel = function(event) {
        engine.addCameraDelta(0, 0, Math.sign(event.deltaY));
        _onWheel.apply(this, arguments);
    };

    const _onTouchStart = TouchInput._onTouchStart;
    TouchInput._onTouchStart = function() {
        engine.noteDevice("touch");
        _onTouchStart.apply(this, arguments);
    };

    const _touchClear = TouchInput._onLostFocus;
    TouchInput._onLostFocus = function() {
        lastMouse = null;
        _touchClear.apply(this, arguments);
    };

    //-------------------------------------------------------------------------
    // Camera-relative movement
    //-------------------------------------------------------------------------

    /** @brief Rotates grid movement to match a rotated 3D camera. */
    function updateCameraRotation() {
        const Three = window.PokeMZ && window.PokeMZ.Three;
        let quarters = 0;
        if (CONFIG.cameraRelative && Three && Three.isActive && Three.isActive()) {
            try {
                const cam = Three.camera;
                quarters = cam && cam.state ? quartersForYaw(cam.state.yaw) : 0;
            } catch (e) {
                quarters = 0;
            }
        }
        engine.rotation = quarters;
    }

    //-------------------------------------------------------------------------
    // Player: direction, tap-to-turn, run, buffered confirm
    //-------------------------------------------------------------------------

    Game_Player.prototype.getInputDirection = function() {
        return engine.moveDirection();
    };

    const _moveByInput = Game_Player.prototype.moveByInput;
    Game_Player.prototype.moveByInput = function() {
        if (engine.options.tapToTurn && !this.isMoving() && this.canMove()) {
            const dir = this.getInputDirection();
            if (dir === 0) {
                this._pmzTurnDir = 0;
            } else if (!this._pmzWalking && engine.dirHeld < engine.options.turnFrames) {
                // Standing still: a new direction only turns the player, and
                // keeps them in place until it has been held long enough.
                if (dir !== this.direction()) {
                    $gameTemp.clearDestination();
                    this.setDirection(dir);
                    this._pmzTurnDir = dir;
                    return;
                }
                if (this._pmzTurnDir === dir) {
                    return;
                }
            }
        }
        _moveByInput.apply(this, arguments);
    };

    const _playerUpdate = Game_Player.prototype.update;
    Game_Player.prototype.update = function(sceneActive) {
        if (this.isMoving() && engine.isTriggered("confirm")) {
            engine.mark("player.confirm");
        }
        _playerUpdate.apply(this, arguments);
        if (this.isMoving()) {
            this._pmzWalking = true;
        } else if (this.getInputDirection() === 0) {
            this._pmzWalking = false;
        }
    };

    Game_Player.prototype.isDashButtonPressed = function() {
        const run = engine.isRunning();
        return ConfigManager.alwaysDash ? !run : run;
    };

    const _triggerButtonAction = Game_Player.prototype.triggerButtonAction;
    Game_Player.prototype.triggerButtonAction = function() {
        if (_triggerButtonAction.apply(this, arguments)) {
            return true;
        }
        if (engine.consumeBuffered("player.confirm", engine.options.bufferFrames)) {
            if (this.getOnOffVehicle()) {
                return true;
            }
            this.checkEventTriggerHere([0]);
            if ($gameMap.setupStartingEvent()) {
                return true;
            }
            this.checkEventTriggerThere([0, 1, 2]);
            if ($gameMap.setupStartingEvent()) {
                return true;
            }
        }
        return false;
    };

    //-------------------------------------------------------------------------
    // Persistence
    //-------------------------------------------------------------------------

    const _makeData = ConfigManager.makeData;
    ConfigManager.makeData = function() {
        const config = _makeData.apply(this, arguments);
        config.pokemzInput = engine.serialize();
        return config;
    };

    const _applyData = ConfigManager.applyData;
    ConfigManager.applyData = function(config) {
        _applyData.apply(this, arguments);
        if (config.pokemzInput) {
            engine.load(config.pokemzInput);
        } else if (config.pokemzKeyMapper || config.pokemzGamepadMapper) {
            engine.importLegacy(config.pokemzKeyMapper, config.pokemzGamepadMapper);
        }
    };

    /** @brief Writes config.rmmzsave. */
    const save = () => ConfigManager.save();

    //-------------------------------------------------------------------------
    // Glyph sheets
    //-------------------------------------------------------------------------

    const sheets = {};

    /**
     * @brief Loads a family's glyph sheet once.
     * @param {string} family Family (or "keyboard").
     * @return {Object} {status: "loading"|"ready"|"missing", url, img}.
     */
    function sheet(family) {
        if (sheets[family]) {
            return sheets[family];
        }
        const url = `${CONFIG.glyphFolder}InputGlyphs_${family}.png`;
        const entry = { status: "loading", url, img: null };
        sheets[family] = entry;
        const exists = (() => {
            try {
                if (Utils.isNwjs()) {
                    const fs = require("fs");
                    const path = require("path");
                    const base = path.dirname(process.mainModule.filename);
                    return fs.existsSync(path.join(base, url));
                }
            } catch (e) {
                // Fall through to an image request.
            }
            return true;
        })();
        if (!exists) {
            entry.status = "missing";
            return entry;
        }
        const img = new Image();
        img.onload = () => {
            entry.status = "ready";
            entry.img = img;
            engine.emit("devicechange", engine.device, engine.family);
        };
        img.onerror = () => (entry.status = "missing");
        img.src = url;
        return entry;
    }

    /**
     * @brief Cell of a source in a family's sheet.
     * @param {string} family Family.
     * @param {string} source Source.
     * @return {number} Cell index (-1 = none).
     */
    function cellOf(family, source) {
        const map = CONFIG.glyphMap[family];
        if (map && map[source] !== undefined) {
            return Number(map[source]);
        }
        if (source.startsWith("pad:")) {
            return Number(source.slice(4));
        }
        const m = /^axis:([0-3])([+-])$/.exec(source);
        if (m) {
            return 17 + Number(m[1]) * 2 + (m[2] === "+" ? 1 : 0);
        }
        if (source.startsWith("key:")) {
            return 0;
        }
        return -1;
    }

    /**
     * @brief What to show for an action on the active device.
     * @param {string} action Action id or MZ name.
     * @param {Object} [opts] {player (number), device, family} to force
     *        one.
     * @return {{action, device, family, source, text, image, keycap}}
     *         image = {url, x, y, size, width, height} when a sheet exists
     *         (keycap: true means draw text over a blank keycap).
     */
    function glyph(action, opts = {}) {
        const e = (opts.player && engine.player(opts.player)) || engine;
        const target = e.glyphTarget();
        const device = opts.device || target.device;
        const family = opts.family || (device === "keyboard" ? "keyboard" : opts.device ? e.family : target.family);
        const source = engine.glyphSource(action, device);
        const text = engine.sourceName(source, family, t);
        let image = null;
        if (source) {
            const s = sheet(family);
            const cell = cellOf(family, source);
            if (s.status === "ready" && cell >= 0) {
                const size = CONFIG.glyphCell;
                image = {
                    url: s.url,
                    img: s.img,
                    x: (cell % CONFIG.glyphColumns) * size,
                    y: Math.floor(cell / CONFIG.glyphColumns) * size,
                    size,
                    width: s.img.naturalWidth,
                    height: s.img.naturalHeight,
                };
            }
        }
        const keycap = !!image && device === "keyboard" && cellOf(family, source) === 0 && !(CONFIG.glyphMap.keyboard && CONFIG.glyphMap.keyboard[source] !== undefined);
        return { action: engine.actionFor(action), device, family, source, text, image, keycap };
    }

    /**
     * @brief Draws an action's glyph into an MZ Bitmap (image or text).
     * @param {Bitmap} bitmap Target.
     * @param {string} action Action id or MZ name.
     * @param {number} x X.
     * @param {number} y Y.
     * @param {number} [size=32] Size in pixels.
     * @return {number} Width drawn.
     */
    function drawGlyph(bitmap, action, x, y, size = 32) {
        const g = glyph(action);
        if (g.image) {
            bitmap.context.drawImage(g.image.img, g.image.x, g.image.y, g.image.size, g.image.size, x, y, size, size);
            bitmap._baseTexture.update();
            if (!g.keycap) {
                return size;
            }
        }
        const w = Math.max(size, bitmap.measureTextWidth(g.text) + 12);
        bitmap.drawText(g.text, x, y, w, size, "center");
        return w;
    }

    //-------------------------------------------------------------------------
    // Rumble
    //-------------------------------------------------------------------------

    /**
     * @brief Vibrates connected gamepads (respects the rumble options).
     * @param {number} [strong=0.6] Strong motor 0..1.
     * @param {number} [weak=0.6] Weak motor 0..1.
     * @param {number} [frames=15] Duration in frames.
     * @param {number} [player] Only this local player's gamepads (default:
     *        player 1's, i.e. every gamepad no other player claimed).
     */
    function rumble(strong = 0.6, weak = 0.6, frames = 15, player = 1) {
        if (!engine.options.rumble || engine.options.rumbleStrength <= 0 || engine.recorder.playing) {
            return;
        }
        const k = engine.options.rumbleStrength;
        const duration = Math.round((frames * 1000) / 60);
        const target = engine.player(player);
        if (!target) {
            return;
        }
        engine.pollPads().forEach((pad, n) => {
            const id = `pad#${pad.index !== undefined ? pad.index : n}`;
            if ((engine.claims.get(id) || engine) !== target) {
                return;
            }
            try {
                if (pad.vibrationActuator && pad.vibrationActuator.playEffect) {
                    pad.vibrationActuator
                        .playEffect("dual-rumble", { duration, strongMagnitude: clamp(strong * k, 0, 1), weakMagnitude: clamp(weak * k, 0, 1) })
                        .catch(() => {});
                } else if (pad.hapticActuators && pad.hapticActuators[0]) {
                    pad.hapticActuators[0].pulse(clamp(Math.max(strong, weak) * k, 0, 1), duration);
                }
            } catch (e) {
                // Rumble is best effort.
            }
        });
    }

    //-------------------------------------------------------------------------
    // Recording files
    //-------------------------------------------------------------------------

    /**
     * @brief Saves a recording (NW.js file, or a browser download).
     * @param {Object} rec Recording.
     * @return {string} Where it went.
     */
    function saveRecording(rec) {
        const json = JSON.stringify(rec);
        const name = `input-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        try {
            if (Utils.isNwjs()) {
                const fs = require("fs");
                const path = require("path");
                const dir = path.join(path.dirname(process.mainModule.filename), CONFIG.recordFolder);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, name), json);
                return path.join(CONFIG.recordFolder, name);
            }
        } catch (e) {
            console.warn(`[${PLUGIN_NAME}] could not save recording:`, e);
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return name;
    }

    //-------------------------------------------------------------------------
    // Debug overlay (playtest)
    //-------------------------------------------------------------------------

    /**
     * @brief Splits a list into rows.
     * @param {Array} list Items.
     * @param {number} n Items per row.
     * @return {Array<Array>} Rows.
     */
    const chunk = (list, n) => {
        const rows = [];
        for (let i = 0; i < list.length; i += n) {
            rows.push(list.slice(i, i + n));
        }
        return rows;
    };

    const overlay = {
        el: null,
        visible: false,

        /** @brief Shows or hides the overlay. */
        toggle() {
            this.visible = !this.visible;
            if (!this.el) {
                this.el = document.createElement("pre");
                this.el.id = "pmz-input-overlay";
                Object.assign(this.el.style, {
                    position: "fixed",
                    left: "8px",
                    bottom: "8px",
                    zIndex: 1000,
                    margin: 0,
                    padding: "6px 8px",
                    font: "11px/1.35 monospace",
                    color: "#e8f0ff",
                    background: "rgba(10,14,24,0.82)",
                    borderRadius: "4px",
                    pointerEvents: "none",
                    whiteSpace: "pre",
                });
                document.body.appendChild(this.el);
            }
            this.el.style.display = this.visible ? "block" : "none";
        },

        /** @brief Redraws (called every frame while visible). */
        render() {
            if (!this.visible || !this.el) {
                return;
            }
            const e = engine;
            const held = [...e.actions.keys()]
                .filter(id => e.states[id].pressed)
                .map(id => `${id}${e.states[id].value < 0.999 ? `(${e.states[id].value.toFixed(2)})` : ""}:${e.states[id].held}`);
            const v = e.moveVector();
            const cam = e.camera();
            const rec = e.recorder.recording ? `REC ${e.recorder.frames.length}` : e.recorder.playing ? "REPLAY" : "-";
            const marks = [...e.marks].filter(([, f]) => e.frame - f <= 30).map(([k, f]) => `${k}@-${e.frame - f}`);
            this.el.textContent = [
                `Input  frame ${e.frame}  device ${e.device} (${e.family})  glyphs ${e.glyphTarget().family}`,
                `pads   ${e.padFamilies.join(", ") || "none"}   players ${e.players.map(p => `P${p.index}:${p === e ? `${e.lastDeviceId}+` : p.deviceId || "-"}`).join(" ")}${e.joining ? `  joining P${e.joining.index}` : ""}`,
                `ctx    ${["gameplay", ...e.contexts.map(c => `${c.id}${c.block ? "*" : ""}`)].join(" > ")}${e.textEntry ? "  [text entry]" : ""}`,
                `held   ${held.join(" ") || "-"}`,
                `dir    dir4 ${e.dir4} dir8 ${e.dir8} move ${e.moveDirection()} held ${e.dirHeld} rot ${e.rotation}`,
                `stick  move ${v.x.toFixed(2)},${v.y.toFixed(2)}  cam ${cam.yaw.toFixed(2)},${cam.pitch.toFixed(2)} zoom ${cam.zoom.toFixed(2)}`,
                `buffer ${marks.join(" ") || "-"}`,
                `run    ${e.isRunning() ? "on" : "off"}${e.options.toggleRun ? " (toggle)" : ""}   locked ${e.locked.size}   rec ${rec}`,
                ...chunk(hotkeys.map(h => `${hotkeyText(h)}${h.label ? ` ${h.label}` : ""}`), 3).map((row, i) => `${i ? "      " : "keys  "} ${row.join("  ")}`),
            ].join("\n");
        },
    };

    const _updateMain = SceneManager.updateMain;
    SceneManager.updateMain = function() {
        _updateMain.apply(this, arguments);
        overlay.render();
    };

    if (isPlaytest()) {
        registerHotkey({ key: CONFIG.overlayKey, label: "input overlay" }, () => overlay.toggle());
        registerHotkey({ key: CONFIG.overlayKey, shift: true, label: "record" }, () => {
            if (engine.recorder.recording) {
                const where = saveRecording(engine.recorder.stop());
                console.log(`[${PLUGIN_NAME}] recording saved: ${where}`);
            } else {
                engine.recorder.start();
            }
        });
        registerHotkey({ key: CONFIG.overlayKey, ctrl: true, label: "replay" }, () => {
            if (engine.recorder.playing) {
                engine.recorder.cancel();
            } else if (engine.recorder.last) {
                engine.recorder.play(engine.recorder.last);
            }
        });
    }

    //-------------------------------------------------------------------------
    // Plugin commands
    //-------------------------------------------------------------------------

    PluginManager.registerCommand(PLUGIN_NAME, "rumble", args => rumble(parseNum(args.strong, 0.6), parseNum(args.weak, 0.6), parseNum(args.frames, 15)));
    PluginManager.registerCommand(PLUGIN_NAME, "pushContext", args =>
        engine.pushContext(String(args.id || "cutscene"), {
            block: true,
            allow: String(args.allow || "")
                .split(",")
                .map(s => s.trim())
                .filter(Boolean),
        })
    );
    PluginManager.registerCommand(PLUGIN_NAME, "popContext", args => engine.popContext(String(args.id || "cutscene")));

    //-------------------------------------------------------------------------
    // Local players
    //-------------------------------------------------------------------------

    const handles = new Map();

    /**
     * @brief A stable read API for one local player's input.
     * @param {Engine} e The player's engine.
     * @return {Object} Handle.
     */
    function playerHandle(e) {
        if (handles.has(e)) {
            return handles.get(e);
        }
        const h = {
            engine: e,
            get index() {
                return e.index;
            },
            /** @brief Claimed device id (player 1: the last one used). */
            get deviceId() {
                return e === engine ? e.lastDeviceId : e.deviceId;
            },
            /** @brief "keyboard", "gamepad", "touch" or "mouse". */
            get device() {
                return e.device;
            },
            get family() {
                return e.family;
            },
            /** @brief False for a player whose gamepad was unplugged. */
            get connected() {
                return e === engine || !!e.deviceId;
            },
            get dir4() {
                return e.readable("up") ? e.dir4 : 0;
            },
            get dir8() {
                return e.readable("up") ? e.dir8 : 0;
            },
            state: a => e.state(a),
            isPressed: (a, ctx) => e.isPressed(a, ctx),
            isTriggered: (a, ctx) => e.isTriggered(a, ctx),
            isRepeated: (a, ctx) => e.isRepeated(a, ctx),
            isReleased: (a, ctx) => e.isReleased(a, ctx),
            isLongPressed: a => e.isLongPressed(a),
            value: a => e.value(a),
            heldFrames: a => e.heldFrames(a),
            moveDirection: () => e.moveDirection(),
            moveVector: () => e.moveVector(),
            camera: () => e.camera(),
            pushContext: (id, opts) => e.pushContext(id, opts),
            popContext: id => e.popContext(id),
            consume: a => e.consume(a),
            isBuffered: (tag, frames) => e.isBuffered(tag, frames),
            consumeBuffered: (tag, frames) => e.consumeBuffered(tag, frames),
            glyph: (a, opts) => glyph(a, Object.assign({ player: e.index }, opts || {})),
            on: (name, fn) => e.on(name, fn),
            off: (name, fn) => e.off(name, fn),
        };
        handles.set(e, h);
        return h;
    }

    /**
     * @brief Display name of a device id ("Keyboard", "Gamepad 2 (xbox)").
     * @param {string} deviceId Device id.
     * @return {string} Name.
     */
    function deviceName(deviceId) {
        if (!deviceId) {
            return "—";
        }
        if (deviceId === "keyboard") {
            return t("UI.Controls.Keyboard", "Keyboard");
        }
        const m = /^pad#(\d+)$/.exec(deviceId);
        if (m) {
            const fam = engine.padFamilyOf.get(deviceId) || "generic";
            return `${t("UI.Controls.Gamepad", "Gamepad")} ${Number(m[1]) + 1} (${t(`UI.Input.Style.${fam}`, fam)})`;
        }
        return deviceId;
    }

    const players = {
        max: MAX_PLAYERS,
        /** @return {number} Players present (player 1 included). */
        count: () => engine.players.length,
        /** @return {Array<Object>} Player handles, player 1 first. */
        list: () => engine.players.map(playerHandle),
        /**
         * @param {number} index Player number.
         * @return {Object|null} Handle, or null if that player isn't here.
         */
        get: index => {
            const e = engine.player(index);
            return e ? playerHandle(e) : null;
        },
        /**
         * @brief Waits for a player to join with Confirm/Start on a free
         *        device (not player 1's current one).
         * @param {number} [index] Player number (default: next free).
         * @param {Object} [opts] {frames = 600, exclude}.
         * @return {Promise<Object|null>} {index, deviceId} or null.
         */
        join: (index, opts = {}) => engine.joinNext(Object.assign({ index, exclude: engine.lastDeviceId }, opts)),
        cancelJoin: () => engine.cancelJoin(),
        joinFramesLeft: () => engine.joinFramesLeft(),
        /** @return {boolean} True while waiting for a player to join. */
        isJoining: () => !!engine.joining,
        /**
         * @brief Removes a player (their device goes back to player 1).
         * @param {number} index Player number (2+).
         */
        leave: index => engine.removePlayer(index),
        deviceName,
    };

    PluginManager.registerCommand(PLUGIN_NAME, "joinPlayer", function(args) {
        const index = parseNum(args.player, 2);
        const switchId = parseNum(args.switchId, 0);
        const UI = window.PokeMZ && window.PokeMZ.UI;
        const done = r => switchId && $gameSwitches.setValue(switchId, !!r);
        if (UI && UI.screens && UI.screens.has("joinPlayer")) {
            UI.openScreen("joinPlayer", { player: index, onDone: done });
        } else {
            players.join(index).then(done);
        }
    });
    PluginManager.registerCommand(PLUGIN_NAME, "leavePlayer", args => players.leave(parseNum(args.player, 2)));

    //-------------------------------------------------------------------------
    // Public API
    //-------------------------------------------------------------------------

    const API = {
        engine,
        version: VERSION,
        // Actions
        registerAction: (id, def) => engine.registerAction(id, def),
        actions: () => [...engine.actions.values()],
        actionFor: n => engine.actionFor(n),
        // Snapshot
        state: a => engine.state(a),
        isPressed: (a, ctx) => engine.isPressed(a, ctx),
        isTriggered: (a, ctx) => engine.isTriggered(a, ctx),
        isRepeated: (a, ctx) => engine.isRepeated(a, ctx),
        isReleased: (a, ctx) => engine.isReleased(a, ctx),
        isLongPressed: a => engine.isLongPressed(a),
        value: a => engine.value(a),
        heldFrames: a => engine.heldFrames(a),
        get dir4() {
            return engine.dir4;
        },
        get dir8() {
            return engine.dir8;
        },
        moveDirection: () => engine.moveDirection(),
        moveVector: () => engine.moveVector(),
        camera: () => engine.camera(),
        isRunning: () => engine.isRunning(),
        // Contexts, consumption, buffering
        pushContext: (id, opts) => engine.pushContext(id, opts),
        popContext: id => engine.popContext(id),
        readable: (a, ctx) => engine.readable(engine.actionFor(a), ctx),
        consume: a => engine.consume(a),
        mark: tag => engine.mark(tag),
        isBuffered: (tag, frames) => engine.isBuffered(tag, frames),
        consumeBuffered: (tag, frames) => engine.consumeBuffered(tag, frames),
        // Virtual devices
        tap: a => engine.tap(a),
        setVirtual: (a, down, device) => engine.setVirtual(a, down, device),
        // Rebinding and options
        bindings: (a, device) => engine.sourcesOf(engine.actionFor(a), device).slice(),
        bind: (a, device, source, slot) => {
            engine.bind(engine.actionFor(a), device, source, slot);
            save();
        },
        unbind: (a, device, source) => {
            engine.unbind(engine.actionFor(a), device, source);
            save();
        },
        resetBindings: device => {
            engine.resetBindings(device);
            save();
        },
        captureNext: (device, opts) => engine.captureNext(device, opts),
        cancelCapture: () => engine.cancelCapture(),
        captureFramesLeft: () => engine.captureFramesLeft(),
        get options() {
            return Object.assign({}, engine.options);
        },
        option: id => engine.options[id],
        setOption: (id, v) => {
            engine.setOption(id, v);
            save();
        },
        resetOptions: () => {
            engine.resetOptions();
            save();
        },
        save,
        // Devices and glyphs
        get device() {
            return engine.device;
        },
        get family() {
            return engine.family;
        },
        get textEntry() {
            return engine.textEntry;
        },
        glyph,
        drawGlyph,
        sourceName: (source, family) => engine.sourceName(source, family || engine.family, t),
        // Extras
        rumble,
        recorder: engine.recorder,
        saveRecording,
        registerHotkey,
        hotkeys: () => hotkeys.map(h => ({ text: hotkeyText(h), label: h.label || "" })),
        overlay,
        players,
        on: (name, fn) => engine.on(name, fn),
        off: (name, fn) => engine.off(name, fn),
        internals,
    };

    window.PokeMZ = window.PokeMZ || {};
    window.PokeMZ.Input = API;
})();
