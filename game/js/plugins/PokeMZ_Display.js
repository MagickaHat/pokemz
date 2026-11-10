//=============================================================================
// PokéMZ - Display.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Pixel-perfect display: resolutions, integer scaling,
 * no smoothing, crisp text and Options entries for all of it.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @orderAfter PokeMZ_Input
 *
 * @param resolutions
 * @text Resolutions
 * @desc Game resolutions the player can pick in Options, as WxH. The
 * first one is the default. Every one is a whole pixel grid.
 * @type string[]
 * @default ["256x192","320x240","384x288","336x192","432x240"]
 *
 * @param defaultWindowScale
 * @text Default Window Size
 * @desc "auto" = the largest whole multiple that fits the screen, or a
 * number (1-8) for a fixed multiple.
 * @type string
 * @default auto
 *
 * @param pixelArt
 * @text Pixel Art Mode
 * @desc Turns off MZ's smoothing and anti-aliasing (images, sprites, text)
 * so every game pixel stays a sharp square.
 * @type boolean
 * @default true
 *
 * @param crispText
 * @text Crisp Text
 * @desc Removes anti-aliasing from text drawn on MZ bitmaps (windows,
 * pictures), so pixel fonts stay pixel fonts.
 * @type boolean
 * @default true
 *
 * @param textStyle
 * @text Text Style
 * @desc How MZ draws the dark edge around text. "shadow" = 1 pixel drop
 * shadow (Pokémon style), "outline" = MZ's outline, "none".
 * @type select
 * @option shadow
 * @option outline
 * @option none
 * @default shadow
 *
 * @param windowMetrics
 * @text Small Window Metrics
 * @desc Derive MZ window line height and padding from the font size,
 * instead of MZ's 816x624 values (36px lines, 12px padding).
 * @type boolean
 * @default true
 *
 * @param mzTouchButtons
 * @text MZ Touch Buttons
 * @desc MZ's own on-screen buttons (menu, cancel, page) are drawn at 48px
 * and take a lot of a small screen. The Preact UI has its own.
 * @type boolean
 * @default false
 *
 * @param showOptions
 * @text Options Entries
 * @desc Adds Resolution, Window Size, Scaling and Fullscreen to Options.
 * @type boolean
 * @default true
 *
 * @help PokeMZ_Display.js
 *
 * Keeps everything on one pixel grid: the game renders at a small native
 * resolution (256x192 by default) and the window shows it at a whole
 * multiple of that size (2x, 3x, 4x...), with black bars around it when the
 * window is bigger. A game pixel is therefore always a square of whole
 * device pixels, the same size for the 2D canvas, the 3D view and the
 * Preact UI.
 *
 * Enable it right after PokeMZ_Input, above every other PokeMZ plugin.
 *
 * ---------------------------------------------------------------------------
 * Options (saved in config.rmmzsave)
 * ---------------------------------------------------------------------------
 *   Resolution    One of the "Resolutions" parameter. Bigger resolutions
 *                 show more of the world; they never stretch it.
 *   Window Size   Auto (largest multiple that fits) or 1x-8x. On NW.js the
 *                 window is resized; in a browser the largest multiple up
 *                 to that size that fits is used.
 *   Scaling       Pixel Perfect (whole multiples, black bars) or Fit (fills
 *                 the window; pixels become uneven sizes).
 *   Fullscreen    Same as F4.
 *
 * ---------------------------------------------------------------------------
 * Script
 * ---------------------------------------------------------------------------
 *   PokeMZ.Display.width / height       current game resolution
 *   PokeMZ.Display.scale                current scale (device pixels per
 *                                       game pixel; whole in Pixel Perfect)
 *   PokeMZ.Display.resolutions          [{w, h}, ...]
 *   PokeMZ.Display.setResolution(w, h)  changes it now (rebuilds the scene)
 *   PokeMZ.Display.setWindowScale(n)    "auto" or a number
 *   PokeMZ.Display.setScaling(mode)     "pixel" or "fit"
 *   PokeMZ.Display.onChange(fn)         called after any change; returns an
 *                                       unsubscribe function
 *   PokeMZ.Display.place(element, w, h) puts a DOM element exactly over
 *                                       the canvas (used by the Preact UI)
 *
 * ---------------------------------------------------------------------------
 * Art
 * ---------------------------------------------------------------------------
 * Author everything for the native grid: 16x16 tiles (Database > System 2 >
 * Tile Size = 16), a pixel font at its native size (the FRLG font is 16px:
 * Database > System 2 > Font Size = 16), and a 16px-based window skin
 * (img/system/Window.png keeps MZ's layout; draw its frame with 16px
 * corners or smaller). MZ windows get line height and padding from the
 * font size when "Small Window Metrics" is on.
 */

(() => {
    "use strict";

    //=========================================================================
    // Engine (pure; also loaded by the node tests)
    //=========================================================================

    const Engine = {
        /**
         * @brief Parses "WxH" strings into resolutions, skipping bad ones.
         * @param {string[]} list Entries such as "256x192".
         * @return {Array<{w: number, h: number}>} Parsed resolutions.
         */
        parseResolutions(list) {
            const out = [];
            for (const entry of list || []) {
                const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(String(entry));
                if (m && Number(m[1]) > 0 && Number(m[2]) > 0) {
                    const r = { w: Number(m[1]), h: Number(m[2]) };
                    if (!out.some(o => o.w === r.w && o.h === r.h)) {
                        out.push(r);
                    }
                }
            }
            return out.length ? out : [{ w: 256, h: 192 }];
        },

        /**
         * @brief Largest whole multiple of (w, h) that fits a viewport.
         * @param {number} viewW Viewport width in device pixels.
         * @param {number} viewH Viewport height in device pixels.
         * @param {number} w Game width.
         * @param {number} h Game height.
         * @return {number} The multiple, at least 1.
         */
        fitInteger(viewW, viewH, w, h) {
            return Math.max(1, Math.floor(Math.min(viewW / w, viewH / h) + 1e-6));
        },

        /**
         * @brief Device pixels per game pixel for the current settings.
         * @param {Object} o Inputs.
         * @param {number} o.viewW Viewport width (CSS px).
         * @param {number} o.viewH Viewport height (CSS px).
         * @param {number} o.w Game width.
         * @param {number} o.h Game height.
         * @param {number} o.dpr devicePixelRatio.
         * @param {string} o.scaling "pixel" or "fit".
         * @param {string|number} o.windowScale "auto" or a fixed multiple.
         * @return {number} Device pixels per game pixel.
         */
        deviceScale(o) {
            const dpr = o.dpr || 1;
            const vw = o.viewW * dpr;
            const vh = o.viewH * dpr;
            if (o.scaling === "fit") {
                return Math.max(1e-3, Math.min(vw / o.w, vh / o.h));
            }
            const fit = Engine.fitInteger(vw, vh, o.w, o.h);
            const fixed = Number(o.windowScale);
            return fixed > 0 ? Math.max(1, Math.min(fit, Math.floor(fixed))) : fit;
        },

        /**
         * @brief Position and size (CSS px) that puts a w x h game screen at
         *        `scale` device pixels per game pixel, centred, with its
         *        corner on a whole device pixel.
         * @return {{left: number, top: number, width: number, height: number}}
         */
        placement(viewW, viewH, w, h, scale, dpr) {
            dpr = dpr || 1;
            const dw = Math.round(w * scale);
            const dh = Math.round(h * scale);
            const left = Math.max(0, Math.floor((viewW * dpr - dw) / 2));
            const top = Math.max(0, Math.floor((viewH * dpr - dh) / 2));
            return { left: left / dpr, top: top / dpr, width: dw / dpr, height: dh / dpr };
        },

        /**
         * @brief MZ window metrics for a font size (MZ's own: 26px font ->
         *        36px lines, 12px padding, 8px item padding, +8 rows). A 16px
         *        font gives 18px lines, 6px padding, 4px item padding, +2.
         * @param {number} fontSize Main font size.
         * @return {{lineHeight: number, padding: number, itemPadding: number, rowExtra: number}}
         */
        windowMetrics(fontSize) {
            const f = Math.max(4, Math.round(fontSize));
            return {
                lineHeight: f + Math.max(2, Math.round(f / 8)),
                padding: Math.max(2, Math.round((f * 3) / 8)),
                itemPadding: Math.max(2, Math.round(f / 4)),
                rowExtra: Math.max(2, Math.round(f / 8)),
            };
        },

        /**
         * @brief Snaps RGBA alpha to fully opaque or fully transparent.
         * @param {Uint8ClampedArray} data Image data (modified).
         * @param {number} [cutoff] Alpha at or above this becomes 255.
         */
        thresholdAlpha(data, cutoff = 128) {
            for (let i = 3; i < data.length; i += 4) {
                data[i] = data[i] >= cutoff ? 255 : 0;
            }
        },

        /**
         * @brief The next value of a cycling option.
         * @param {Array} values Allowed values.
         * @param {*} current Current value.
         * @param {number} step +1 or -1.
         * @return {*} The next value (wraps).
         */
        cycle(values, current, step) {
            const i = values.findIndex(v => String(v) === String(current));
            const n = values.length;
            return values[(((i < 0 ? 0 : i + step) % n) + n) % n];
        },
    };

    if (typeof window === "undefined" || typeof PluginManager === "undefined") {
        if (typeof module !== "undefined" && module.exports) {
            module.exports = Engine;
        }
        return;
    }

    //=========================================================================
    // Parameters
    //=========================================================================

    const PLUGIN_NAME = "PokeMZ_Display";
    const params = PluginManager.parameters(PLUGIN_NAME);

    /**
     * @brief Parses a plugin-manager JSON list.
     * @param {string} text Parameter text.
     * @param {Array} fallback Value when empty or broken.
     * @return {Array} The list.
     */
    function parseList(text, fallback) {
        try {
            const v = JSON.parse(text);
            return Array.isArray(v) ? v : fallback;
        } catch (e) {
            return fallback;
        }
    }

    const bool = (v, d) => (v === undefined || v === "" ? d : v === "true");

    /** @brief Plugin settings. */
    const CONFIG = {
        resolutions: Engine.parseResolutions(parseList(params.resolutions, ["256x192"])),
        defaultWindowScale: params.defaultWindowScale || "auto",
        pixelArt: bool(params.pixelArt, true),
        crispText: bool(params.crispText, true),
        textStyle: params.textStyle || "shadow",
        windowMetrics: bool(params.windowMetrics, true),
        mzTouchButtons: bool(params.mzTouchButtons, false),
        showOptions: bool(params.showOptions, true),
    };

    const WINDOW_SCALES = ["auto", 1, 2, 3, 4, 5, 6, 7, 8];
    const SCALINGS = ["pixel", "fit"];

    /**
     * @brief A UI string, through PokeMZ.UI when it is loaded.
     * @param {string} key String key.
     * @param {string} fallback English text.
     * @return {string} The text.
     */
    function text(key, fallback) {
        const UI = window.PokeMZ && window.PokeMZ.UI;
        return UI && UI.t ? UI.t(key, fallback) : fallback;
    }

    //=========================================================================
    // Config
    //=========================================================================

    const defaultRes = CONFIG.resolutions[0];
    ConfigManager.pokemzResolution = `${defaultRes.w}x${defaultRes.h}`;
    ConfigManager.pokemzWindowScale = CONFIG.defaultWindowScale;
    ConfigManager.pokemzScaling = "pixel";

    const _ConfigManager_makeData = ConfigManager.makeData;
    ConfigManager.makeData = function() {
        const config = _ConfigManager_makeData.apply(this, arguments);
        config.pokemzResolution = this.pokemzResolution;
        config.pokemzWindowScale = this.pokemzWindowScale;
        config.pokemzScaling = this.pokemzScaling;
        return config;
    };

    const _ConfigManager_applyData = ConfigManager.applyData;
    ConfigManager.applyData = function(config) {
        _ConfigManager_applyData.apply(this, arguments);
        const res = resolutionFrom(config.pokemzResolution);
        this.pokemzResolution = `${res.w}x${res.h}`;
        this.pokemzWindowScale = WINDOW_SCALES.some(v => String(v) === String(config.pokemzWindowScale))
            ? config.pokemzWindowScale
            : CONFIG.defaultWindowScale;
        this.pokemzScaling = SCALINGS.includes(config.pokemzScaling) ? config.pokemzScaling : "pixel";
        if (!CONFIG.mzTouchButtons) {
            this.touchUI = false;
        }
    };

    /**
     * @brief One of the configured resolutions ("WxH" text, or the default).
     * @param {string} value Saved value.
     * @return {{w: number, h: number}} The resolution.
     */
    function resolutionFrom(value) {
        const parsed = Engine.parseResolutions([value])[0];
        return CONFIG.resolutions.find(r => r.w === parsed.w && r.h === parsed.h) || defaultRes;
    }

    /** @return {{w: number, h: number}} The resolution the player picked. */
    function currentResolution() {
        return resolutionFrom(ConfigManager.pokemzResolution);
    }

    //=========================================================================
    // Pixel art: no smoothing anywhere
    //=========================================================================

    if (CONFIG.pixelArt) {
        if (window.PIXI && PIXI.settings) {
            PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST;
            PIXI.settings.ROUND_PIXELS = true;
        }

        const _Bitmap_initialize = Bitmap.prototype.initialize;
        Bitmap.prototype.initialize = function() {
            _Bitmap_initialize.apply(this, arguments);
            this._smooth = false;
            if (this._baseTexture) {
                this._baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
            }
        };

        const _Bitmap_createCanvas = Bitmap.prototype._createCanvas;
        Bitmap.prototype._createCanvas = function() {
            _Bitmap_createCanvas.apply(this, arguments);
            this._context.imageSmoothingEnabled = false;
        };

        const _Graphics_createPixiApp = Graphics._createPixiApp;
        Graphics._createPixiApp = function() {
            _Graphics_createPixiApp.apply(this, arguments);
            if (this._app && this._app.renderer) {
                this._app.renderer.roundPixels = true;
            }
        };
    }

    //=========================================================================
    // Crisp text
    //=========================================================================

    /** @brief Scratch canvas for crisp text. */
    let scratch = null;

    /**
     * @brief Draws text through a scratch canvas whose alpha is snapped to
     *        0 or 255, so pixel fonts keep hard edges.
     */
    function drawCrispText(bitmap, text, x, y, maxWidth, lineHeight, align) {
        const context = bitmap.context;
        if (!context) {
            return;
        }
        if (!scratch) {
            scratch = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        }
        // Room around the line: glyphs may reach above y or below the line.
        const pad = Math.ceil(bitmap.fontSize) + 2;
        const measured = bitmap.measureTextWidth(text);
        const boxW = Math.ceil(Math.max(1, maxWidth && maxWidth < 0xffff ? Math.max(maxWidth, measured) : measured)) + pad * 2;
        const boxH = Math.ceil(lineHeight || bitmap.fontSize) + pad * 2;
        const c = scratch.canvas;
        if (c.width < boxW || c.height < boxH) {
            c.width = Math.max(c.width, boxW);
            c.height = Math.max(c.height, boxH);
        }
        scratch.clearRect(0, 0, c.width, c.height);
        scratch.save();
        scratch.font = bitmap._makeFontNameText();
        scratch.textAlign = align || "left";
        scratch.textBaseline = "alphabetic";
        const width = maxWidth && maxWidth < 0xffff ? maxWidth : measured;
        let tx = pad;
        if (align === "center") {
            tx += width / 2;
        } else if (align === "right") {
            tx += width;
        }
        tx = Math.round(tx);
        const ty = Math.round(pad + lineHeight / 2 + bitmap.fontSize * 0.35);
        const mw = maxWidth && maxWidth < 0xffff ? maxWidth : undefined;
        if (CONFIG.textStyle === "shadow") {
            scratch.fillStyle = bitmap.outlineColor;
            scratch.fillText(text, tx + 1, ty + 1, mw);
        } else if (CONFIG.textStyle === "outline" && bitmap.outlineWidth > 0) {
            scratch.strokeStyle = bitmap.outlineColor;
            scratch.lineWidth = Math.max(1, Math.round(bitmap.outlineWidth));
            scratch.lineJoin = "miter";
            scratch.strokeText(text, tx, ty, mw);
        }
        scratch.fillStyle = bitmap.textColor;
        scratch.fillText(text, tx, ty, mw);
        scratch.restore();
        const image = scratch.getImageData(0, 0, boxW, boxH);
        Engine.thresholdAlpha(image.data);
        scratch.putImageData(image, 0, 0);
        context.save();
        context.imageSmoothingEnabled = false;
        context.globalAlpha = bitmap.paintOpacity / 255;
        context.drawImage(c, 0, 0, boxW, boxH, Math.round(x) - pad, Math.round(y) - pad, boxW, boxH);
        context.restore();
        bitmap._baseTexture.update();
    }

    if (CONFIG.crispText) {
        const _Bitmap_drawText = Bitmap.prototype.drawText;
        Bitmap.prototype.drawText = function(text, x, y, maxWidth, lineHeight, align) {
            if (text === undefined || text === null || text === "") {
                return;
            }
            try {
                drawCrispText(this, String(text), x, y, maxWidth, lineHeight, align);
            } catch (e) {
                _Bitmap_drawText.apply(this, arguments);
            }
        };
    }

    //=========================================================================
    // Integer scaling and placement
    //=========================================================================

    /** @return {number} Current devicePixelRatio. */
    function dpr() {
        return window.devicePixelRatio || 1;
    }

    /** @return {{w: number, h: number}} Viewport size in CSS px. */
    function viewport() {
        return { w: Graphics._stretchWidth(), h: Graphics._stretchHeight() };
    }

    /** @brief Device pixels per game pixel, kept in sync with the window. */
    let deviceScale = 1;

    Graphics._updateRealScale = function() {
        if (this._width > 0 && this._height > 0) {
            const v = viewport();
            deviceScale = Engine.deviceScale({
                viewW: v.w,
                viewH: v.h,
                w: this._width,
                h: this._height,
                dpr: dpr(),
                scaling: ConfigManager.pokemzScaling,
                windowScale: ConfigManager.pokemzWindowScale,
            });
            this._realScale = deviceScale / dpr();
            window.scrollTo(0, 0);
        } else {
            this._realScale = 1;
        }
    };

    /**
     * @brief Puts a DOM element exactly over the game screen.
     * @param {HTMLElement} element The element.
     * @param {number} [w] Game width (default Graphics.width).
     * @param {number} [h] Game height (default Graphics.height).
     * @return {{left: number, top: number, width: number, height: number}} CSS box.
     */
    function place(element, w, h) {
        const v = viewport();
        const box = Engine.placement(v.w, v.h, w || Graphics._width, h || Graphics._height, deviceScale, dpr());
        const s = element.style;
        s.position = "absolute";
        s.margin = "0";
        s.right = s.bottom = "";
        s.left = `${box.left}px`;
        s.top = `${box.top}px`;
        s.width = `${box.width}px`;
        s.height = `${box.height}px`;
        return box;
    }

    Graphics._centerElement = function(element) {
        place(element, element.width || this._width, element.height || this._height);
    };

    const _Graphics_updateCanvas = Graphics._updateCanvas;
    Graphics._updateCanvas = function() {
        _Graphics_updateCanvas.apply(this, arguments);
        const smooth = ConfigManager.pokemzScaling === "fit" || !CONFIG.pixelArt;
        this._canvas.style.imageRendering = smooth ? "auto" : "pixelated";
    };

    //=========================================================================
    // Resolution at boot and at runtime
    //=========================================================================

    /** @brief Applies the picked resolution to MZ's screen and box sizes. */
    function applyResolution() {
        const r = currentResolution();
        if (Graphics._width !== r.w || Graphics._height !== r.h) {
            Graphics.resize(r.w, r.h);
        }
        const margin = 4;
        Graphics.boxWidth = r.w - margin * 2;
        Graphics.boxHeight = r.h - margin * 2;
    }

    Scene_Boot.prototype.resizeScreen = function() {
        applyResolution();
        Graphics.defaultScale = 1;
        this.adjustWindow();
    };

    Scene_Boot.prototype.adjustBoxSize = function() {
        applyResolution();
    };

    /**
     * @brief Resizes the NW.js window to the game size times the picked
     *        window scale (auto: the largest multiple that fits the screen).
     */
    function adjustWindow() {
        if (!Utils.isNwjs() || Graphics._isFullScreen()) {
            return;
        }
        const r = currentResolution();
        const ratio = dpr();
        const fixed = Number(ConfigManager.pokemzWindowScale);
        const fit = Engine.fitInteger(
            (window.screen.availWidth - 32) * ratio,
            (window.screen.availHeight - 64) * ratio,
            r.w,
            r.h
        );
        const scale = fixed > 0 ? Math.min(fit, fixed) : fit;
        const xDelta = Math.round((r.w * scale) / ratio) - window.innerWidth;
        const yDelta = Math.round((r.h * scale) / ratio) - window.innerHeight;
        window.moveBy(-xDelta / 2, -yDelta / 2);
        window.resizeBy(xDelta, yDelta);
    }

    Scene_Boot.prototype.adjustWindow = adjustWindow;

    const listeners = new Set();

    /** @brief Tells listeners (UI overlay, 3D view) about a change. */
    function emit() {
        for (const fn of [...listeners]) {
            try {
                fn(Display);
            } catch (e) {
                console.error(e);
            }
        }
    }

    /**
     * @brief Re-applies every display setting and, when the resolution
     *        changed, rebuilds the current scene at the new size.
     */
    function refresh() {
        const before = [Graphics._width, Graphics._height];
        applyResolution();
        adjustWindow();
        Graphics._updateAllElements();
        const scene = SceneManager._scene;
        if (scene && (before[0] !== Graphics._width || before[1] !== Graphics._height)) {
            if (scene._optionsWindow) {
                Window_Options._pmzRestoreIndex = scene._optionsWindow.index();
            }
            SceneManager.goto(scene.constructor);
        }
        emit();
    }

    if (!CONFIG.mzTouchButtons) {
        ConfigManager.touchUI = false;
        Scene_Base.prototype.buttonAreaHeight = function() {
            return 0;
        };
    }

    //=========================================================================
    // MZ window metrics for small fonts
    //=========================================================================

    if (CONFIG.windowMetrics) {
        const metrics = () => Engine.windowMetrics($gameSystem ? $gameSystem.mainFontSize() : 16);

        Window_Base.prototype.lineHeight = function() {
            return metrics().lineHeight;
        };
        Window_Base.prototype.itemPadding = function() {
            return metrics().itemPadding;
        };
        Window_Selectable.prototype.itemHeight = function() {
            return Window_Scrollable.prototype.itemHeight.call(this) + metrics().rowExtra;
        };
        Game_System.prototype.windowPadding = function() {
            return metrics().padding;
        };
    }

    // The title's game name: MZ draws it at 72px for 816x624; scale that to
    // the resolution, in multiples of 8px.
    if (CONFIG.windowMetrics) {
        Scene_Title.prototype.drawGameTitle = function() {
            const x = 8;
            const y = Math.floor(Graphics.height / 4);
            const maxWidth = Graphics.width - x * 2;
            const bitmap = this._gameTitleSprite.bitmap;
            bitmap.fontFace = $gameSystem.mainFontFace();
            bitmap.outlineColor = "black";
            bitmap.outlineWidth = 2;
            bitmap.fontSize = Math.max(8, Math.round((72 * Graphics.height) / 624 / 8) * 8);
            bitmap.drawText($dataSystem.gameTitle, x, y, maxWidth, bitmap.fontSize * 1.5, "center");
        };
    }

    //=========================================================================
    // Options entries
    //=========================================================================

    const SYM = {
        resolution: "pokemzResolution",
        windowScale: "pokemzWindowScale",
        scaling: "pokemzScaling",
        fullscreen: "pokemzFullscreen",
    };
    const OWN = new Set(Object.values(SYM));

    /**
     * @brief Text shown next to one of this plugin's options.
     * @param {string} symbol Option symbol.
     * @return {string} The value text.
     */
    function statusOf(symbol) {
        switch (symbol) {
            case SYM.resolution:
                return ConfigManager.pokemzResolution.replace("x", "×");
            case SYM.windowScale:
                return ConfigManager.pokemzWindowScale === "auto"
                    ? text("UI.Options.Auto", "Auto")
                    : `${ConfigManager.pokemzWindowScale}×`;
            case SYM.scaling:
                return ConfigManager.pokemzScaling === "fit"
                    ? text("UI.Options.ScalingFit", "Fit")
                    : text("UI.Options.ScalingPixel", "Pixel Perfect");
            case SYM.fullscreen:
                return Graphics._isFullScreen() ? text("UI.Options.On", "ON") : text("UI.Options.Off", "OFF");
        }
        return "";
    }

    /**
     * @brief Steps one of this plugin's options.
     * @param {string} symbol Option symbol.
     * @param {number} step +1 or -1.
     */
    function stepOption(symbol, step) {
        switch (symbol) {
            case SYM.resolution: {
                const values = CONFIG.resolutions.map(r => `${r.w}x${r.h}`);
                ConfigManager.pokemzResolution = Engine.cycle(values, ConfigManager.pokemzResolution, step);
                break;
            }
            case SYM.windowScale:
                ConfigManager.pokemzWindowScale = Engine.cycle(WINDOW_SCALES, ConfigManager.pokemzWindowScale, step);
                break;
            case SYM.scaling:
                ConfigManager.pokemzScaling = Engine.cycle(SCALINGS, ConfigManager.pokemzScaling, step);
                break;
            case SYM.fullscreen:
                Graphics._switchFullScreen();
                setTimeout(refresh, 100);
                return;
        }
        refresh();
    }

    if (CONFIG.showOptions) {
        const _addGeneralOptions = Window_Options.prototype.addGeneralOptions;
        Window_Options.prototype.addGeneralOptions = function() {
            _addGeneralOptions.apply(this, arguments);
            if (!CONFIG.mzTouchButtons) {
                this._list = this._list.filter(c => c.symbol !== "touchUI");
            }
            if (CONFIG.resolutions.length > 1) {
                this.addCommand(text("UI.Options.Resolution", "Resolution"), SYM.resolution);
            }
            this.addCommand(text("UI.Options.WindowSize", "Window Size"), SYM.windowScale);
            this.addCommand(text("UI.Options.Scaling", "Scaling"), SYM.scaling);
            this.addCommand(text("UI.Options.Fullscreen", "Fullscreen"), SYM.fullscreen);
        };

        const _statusText = Window_Options.prototype.statusText;
        Window_Options.prototype.statusText = function(index) {
            const symbol = this.commandSymbol(index);
            return OWN.has(symbol) ? statusOf(symbol) : _statusText.apply(this, arguments);
        };

        for (const [name, step] of [
            ["processOk", 1],
            ["cursorRight", 1],
            ["cursorLeft", -1],
        ]) {
            const orig = Window_Options.prototype[name];
            Window_Options.prototype[name] = function() {
                const symbol = this.commandSymbol(this.index());
                if (!OWN.has(symbol)) {
                    orig.apply(this, arguments);
                    return;
                }
                SoundManager.playCursor();
                stepOption(symbol, step);
                this.redrawItem(this.index());
            };
        }

        // Keep the cursor on the same entry when the scene is rebuilt.
        const _Scene_Options_createOptionsWindow = Scene_Options.prototype.createOptionsWindow;
        Scene_Options.prototype.createOptionsWindow = function() {
            _Scene_Options_createOptionsWindow.apply(this, arguments);
            if (Window_Options._pmzRestoreIndex !== undefined) {
                this._optionsWindow.select(Math.min(Window_Options._pmzRestoreIndex, this._optionsWindow.maxItems() - 1));
                Window_Options._pmzRestoreIndex = undefined;
            }
        };

        const _maxCommands = Scene_Options.prototype.maxCommands;
        Scene_Options.prototype.maxCommands = function() {
            const own = (CONFIG.resolutions.length > 1 ? 1 : 0) + 3 - (CONFIG.mzTouchButtons ? 0 : 1);
            return _maxCommands.apply(this, arguments) + own;
        };

        // Small screens: the options list scrolls instead of overflowing.
        const _optionsWindowRect = Scene_Options.prototype.optionsWindowRect;
        Scene_Options.prototype.optionsWindowRect = function() {
            const rect = _optionsWindowRect.apply(this, arguments);
            const maxH = Graphics.boxHeight - this.buttonAreaHeight();
            if (rect.height > maxH) {
                rect.height = maxH;
                rect.y = this.buttonAreaHeight();
            }
            rect.width = Math.min(rect.width, Graphics.boxWidth);
            rect.x = Math.floor((Graphics.boxWidth - rect.width) / 2);
            return rect;
        };
    }

    //=========================================================================
    // API
    //=========================================================================

    /** @brief Public display API (window.PokeMZ.Display). */
    const Display = {
        Engine,
        CONFIG,
        get width() {
            return Graphics.width;
        },
        get height() {
            return Graphics.height;
        },
        /** @brief Device pixels per game pixel (whole in Pixel Perfect mode). */
        get scale() {
            return deviceScale;
        },
        get resolutions() {
            return CONFIG.resolutions.slice();
        },
        get pixelPerfect() {
            return ConfigManager.pokemzScaling !== "fit";
        },
        place,
        /**
         * @brief Changes the game resolution (must be in the list).
         * @param {number} w Width.
         * @param {number} h Height.
         */
        setResolution(w, h) {
            ConfigManager.pokemzResolution = `${w}x${h}`;
            ConfigManager.pokemzResolution = `${currentResolution().w}x${currentResolution().h}`;
            refresh();
        },
        /** @param {string|number} n "auto" or a multiple. */
        setWindowScale(n) {
            ConfigManager.pokemzWindowScale = n;
            refresh();
        },
        /** @param {string} mode "pixel" or "fit". */
        setScaling(mode) {
            ConfigManager.pokemzScaling = SCALINGS.includes(mode) ? mode : "pixel";
            refresh();
        },
        /**
         * @brief Calls fn after any display change.
         * @param {Function} fn Listener (receives PokeMZ.Display).
         * @return {Function} Unsubscribe.
         */
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        refresh,
    };

    window.PokeMZ = window.PokeMZ || {};
    window.PokeMZ.Display = Display;
})();
