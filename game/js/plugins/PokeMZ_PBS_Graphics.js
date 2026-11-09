//=============================================================================
// PokéMZ - PBS_Graphics.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Pokémon graphics in the pokeemerald folder layout,
 * with shiny palette swaps.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_PBS_Core
 * @orderAfter PokeMZ_PBS_Pokemon
 *
 * @param folder
 * @text Folder
 * @type string
 * @default img/pokemon/
 *
 * @param transparentIndex0
 * @text Palette Index 0 Is Transparent
 * @desc As on the GBA: pixels of the palette's first color are drawn
 * transparent.
 * @type boolean
 * @default true
 *
 * @help
 * ============================================================================
 * PokeMZ_PBS_Graphics
 * ============================================================================
 * One folder per species, like pokeemerald's graphics/pokemon/:
 *
 *   img/pokemon/<species>/front.png     96x96 battler (front)
 *   img/pokemon/<species>/back.png      96x96 battler (back)
 *   img/pokemon/<species>/frontf.png    optional female front
 *   img/pokemon/<species>/backf.png     optional female back
 *   img/pokemon/<species>/icon.png      party icon, two 32x32 frames stacked
 *   img/pokemon/<species>/overworld.png following Pokémon: an MZ single
 *                                       character sheet (3 x 4 frames, any
 *                                       frame size); overworldf.png optional
 *   img/pokemon/<species>/normal.pal    JASC-PAL palette of the sprites
 *   img/pokemon/<species>/shiny.pal     shiny palette (same order)
 *
 * Forms use a sub-folder named after the form ("raichu/alola/"); files
 * missing there come from the base species, then from question_mark/.
 * Eggs use img/pokemon/egg/. Shiny sprites are made at load time by
 * swapping each normal.pal color for the shiny.pal color at the same index.
 *
 * Ship img/pokemon/ by hand: MZ's "Exclude unused files" can't see it.
 *
 *   ImageManager.loadPokemon("pikachu", { view: "front", shiny: true })
 *   new Sprite_PokemonPic(pokemonOrSpeciesId, "front")
 *   new Sprite_PokemonIcon(pokemon)
 *   PokeMZ.Graphics.load(id, opts) -> Promise<Bitmap>
 */

(() => {
    "use strict";

    //=========================================================================
    // Engine (pure)
    //=========================================================================

    /**
     * @brief Parses a JASC-PAL palette.
     * @param {string} text File text.
     * @return {Array<Array<number>>} [[r, g, b], ...].
     * @throws {Error} When the text is not a JASC palette.
     */
    function parseJascPal(text) {
        const lines = String(text)
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(Boolean);
        if (lines[0] !== "JASC-PAL") {
            throw new Error("not a JASC-PAL file");
        }
        const count = Number(lines[2]);
        const out = [];
        for (let i = 0; i < count && 3 + i < lines.length; i++) {
            const [r, g, b] = lines[3 + i].split(/\s+/).map(Number);
            out.push([r, g, b]);
        }
        return out;
    }

    /** @brief 5-bit (GBA) quantized color key. */
    const key5 = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

    /**
     * @brief Swaps colors of an RGBA buffer from one palette to another
     *        (exact color, then 5-bit match). Pixels of palette index 0 are
     *        made transparent when asked.
     * @param {Uint8ClampedArray} data RGBA pixels (changed in place).
     * @param {Array<Array<number>>} from Normal palette.
     * @param {Array<Array<number>>} [to] Target palette (null: only
     *        transparency).
     * @param {Object} [o] {transparentIndex0 = true}.
     * @return {number} Pixels changed.
     */
    function remapPalette(data, from, to, o = {}) {
        const exact = new Map();
        const coarse = new Map();
        from.forEach(([r, g, b], i) => {
            const k = (r << 16) | (g << 8) | b;
            if (!exact.has(k)) {
                exact.set(k, i);
            }
            const q = key5(r, g, b);
            if (!coarse.has(q)) {
                coarse.set(q, i);
            }
        });
        const clear0 = o.transparentIndex0 !== false;
        let changed = 0;
        for (let p = 0; p < data.length; p += 4) {
            if (data[p + 3] === 0) {
                continue;
            }
            const r = data[p];
            const g = data[p + 1];
            const b = data[p + 2];
            let i = exact.get((r << 16) | (g << 8) | b);
            if (i === undefined) {
                i = coarse.get(key5(r, g, b));
            }
            if (i === undefined) {
                continue;
            }
            if (i === 0 && clear0) {
                data[p + 3] = 0;
                changed++;
            } else if (to && to[i]) {
                data[p] = to[i][0];
                data[p + 1] = to[i][1];
                data[p + 2] = to[i][2];
                changed++;
            }
        }
        return changed;
    }

    /**
     * @brief Candidate folders for a species, most specific first.
     * @param {Object} species SpeciesData-like {id, baseSpecies, folder}.
     * @param {boolean} egg Egg graphics.
     * @return {Array<string>} Folder names relative to the graphics folder.
     */
    function folders(species, egg, noFallback) {
        if (egg) {
            return species ? [`${species.baseSpecies || species.id}/egg`, "egg"] : ["egg"];
        }
        if (!species) {
            return ["question_mark"];
        }
        const out = [];
        if (species.baseSpecies) {
            out.push(`${species.baseSpecies}/${species.folder || species.id}`, species.baseSpecies);
        } else {
            out.push(species.id);
        }
        if (!noFallback) {
            out.push("question_mark");
        }
        return out;
    }

    /**
     * @brief Image files for a view, most specific first.
     * @param {string} view "front" | "back" | "icon" | "overworld".
     * @param {boolean} female Female variant first.
     * @return {Array<string>} File names (without .png).
     */
    function files(view, female) {
        if (view === "icon") {
            return ["icon"];
        }
        return female ? [`${view}f`, view] : [view];
    }

    const Engine = { parseJascPal, remapPalette, folders, files };

    if (typeof window === "undefined" || typeof PluginManager === "undefined") {
        if (typeof module !== "undefined" && module.exports) {
            module.exports = Engine;
        }
        return;
    }

    //=========================================================================
    // MZ glue
    //=========================================================================

    const PLUGIN_NAME = "PokeMZ_PBS_Graphics";
    const params = PluginManager.parameters(PLUGIN_NAME);
    let FOLDER = String(params.folder || "img/pokemon/");
    if (!FOLDER.endsWith("/")) {
        FOLDER += "/";
    }
    const CLEAR0 = params.transparentIndex0 !== "false";
    const PBS = window.PokeMZ.PBS;

    /**
     * @brief Loads an image without MZ's "failed to load" error screen.
     * @param {string} url URL.
     * @return {Promise<Bitmap|null>} The bitmap, or null when missing.
     */
    function tryLoad(url) {
        return new Promise(resolve => {
            const bitmap = Object.create(Bitmap.prototype);
            bitmap.initialize();
            bitmap._url = url;
            bitmap._onError = function() {
                Bitmap.prototype._onError.call(this);
                resolve(null);
            };
            bitmap._startLoading();
            if (!bitmap.isError()) {
                bitmap.addLoadListener(() => resolve(bitmap));
            }
        });
    }

    const textCache = new Map();

    /**
     * @brief Loads a text file (palettes); null when missing.
     * @param {string} url URL.
     * @return {Promise<string|null>} Text.
     */
    function tryText(url) {
        if (!textCache.has(url)) {
            textCache.set(
                url,
                new Promise(resolve => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("GET", url);
                    xhr.overrideMimeType("text/plain");
                    xhr.onload = () => resolve(xhr.status < 400 ? xhr.responseText : null);
                    xhr.onerror = () => resolve(null);
                    xhr.send();
                })
            );
        }
        return textCache.get(url);
    }

    const cache = new Map();

    /**
     * @brief Loads a Pokémon image (with fallbacks and shiny palettes).
     * @param {string} speciesId Species or form ID ("" for "?").
     * @param {Object} [o] {view = "front", shiny, female, egg}.
     * @return {Promise<Bitmap>} The bitmap (a "?" if nothing exists).
     */
    function load(speciesId, o = {}) {
        const view = o.view || "front";
        const k = `${speciesId}|${view}|${o.shiny ? 1 : 0}|${o.female ? 1 : 0}|${o.egg ? 1 : 0}`;
        if (!cache.has(k)) {
            cache.set(k, loadUncached(speciesId, view, o));
        }
        return cache.get(k);
    }

    async function loadUncached(speciesId, view, o) {
        const species = speciesId ? PBS.species.tryGet(speciesId) : null;
        // Overworld sheets have no "?" fallback: no art means no sprite.
        for (const folder of folders(species, o.egg, view === "overworld")) {
            for (const file of files(view, o.female)) {
                const src = await tryLoad(`${FOLDER}${folder}/${file}.png`);
                if (!src) {
                    continue;
                }
                const out = await finish(src, folder, o);
                out._pmzFound = true;
                return out;
            }
        }
        return new Bitmap(view === "icon" ? 32 : 96, view === "icon" ? 64 : 96);
    }

    /** @brief Copies the image and applies transparency / shiny colors. */
    async function finish(src, folder, o) {
        const normalText = await tryText(`${FOLDER}${folder}/normal.pal`);
        const shinyText = o.shiny ? await tryText(`${FOLDER}${folder}/shiny.pal`) : null;
        if (!normalText || (!CLEAR0 && !shinyText)) {
            return src;
        }
        const out = new Bitmap(src.width, src.height);
        out.blt(src, 0, 0, src.width, src.height, 0, 0);
        try {
            const normal = parseJascPal(normalText);
            const shiny = shinyText ? parseJascPal(shinyText) : null;
            const img = out.context.getImageData(0, 0, out.width, out.height);
            remapPalette(img.data, normal, shiny, { transparentIndex0: CLEAR0 });
            out.context.putImageData(img, 0, 0);
            out.baseTexture.update();
        } catch (e) {
            console.warn(`[PokeMZ.Graphics] ${folder}: ${e.message}`);
        }
        return out;
    }

    /**
     * @brief Synchronous bitmap that fills in when the image is ready.
     * @param {string} speciesId Species ID.
     * @param {Object} [o] Options of load().
     * @return {Bitmap} Bitmap (resized when loaded).
     */
    ImageManager.loadPokemon = function(speciesId, o = {}) {
        const target = new Bitmap(1, 1);
        target._pmzVersion = 0;
        load(speciesId, o).then(src => {
            target.resize(src.width, src.height);
            target.clear();
            target.blt(src, 0, 0, src.width, src.height, 0, 0);
            target._pmzVersion++;
        });
        return target;
    };

    /** @return {Object} Options for a Game_Pokemon (shiny, female, egg). */
    function optsOf(pkmn, view) {
        if (!pkmn || typeof pkmn === "string") {
            return { view };
        }
        return { view, shiny: pkmn.shiny, female: pkmn.gender === "female", egg: pkmn.isEgg() };
    }

    /**
     * @brief A battler picture (front or back), positioned with the
     *        species metrics (y offset, elevation).
     */
    class Sprite_PokemonPic extends Sprite {
        /**
         * @param {Game_Pokemon|string} pkmn Pokémon or species ID.
         * @param {string} [view] "front" or "back".
         */
        initialize(pkmn, view = "front") {
            super.initialize();
            this.anchor.x = 0.5;
            this.anchor.y = 1;
            this._view = view;
            this.setPokemon(pkmn);
        }

        /** @brief Changes the Pokémon shown. */
        setPokemon(pkmn) {
            this._pokemon = pkmn;
            const id = typeof pkmn === "string" ? pkmn : pkmn ? pkmn.speciesId : "";
            this._speciesId = id;
            this.bitmap = ImageManager.loadPokemon(id, optsOf(pkmn, this._view));
            this._version = -1;
            const m = id ? PBS.metrics.tryGet(id) || PBS.metrics.tryGet((PBS.species.tryGet(id) || {}).baseSpecies) : null;
            this._offsetY = m ? (this._view === "back" ? m.backY : m.frontY - m.elevation) : 0;
        }

        update() {
            super.update();
            if (this.bitmap && this.bitmap._pmzVersion !== this._version) {
                this._version = this.bitmap._pmzVersion;
                this.setFrame(0, 0, this.bitmap.width, this.bitmap.height);
                this.pivot.y = -this._offsetY;
            }
        }
    }
    window.Sprite_PokemonPic = Sprite_PokemonPic;

    /**
     * @brief A two-frame party icon that bobs (faster with more HP).
     */
    class Sprite_PokemonIcon extends Sprite {
        /** @param {Game_Pokemon|string} pkmn Pokémon or species ID. */
        initialize(pkmn) {
            super.initialize();
            this._pokemon = pkmn;
            const id = typeof pkmn === "string" ? pkmn : pkmn ? pkmn.speciesId : "";
            this.bitmap = ImageManager.loadPokemon(id, optsOf(pkmn, "icon"));
            this._count = 0;
            this._frame = 0;
            this._version = -1;
        }

        /** @return {number} Frames per icon frame. */
        speed() {
            const p = this._pokemon;
            if (!p || typeof p === "string") {
                return 16;
            }
            const r = p.mhp ? p.hp / p.mhp : 0;
            return r <= 0 ? 0 : r < 0.25 ? 32 : r < 0.5 ? 24 : 12;
        }

        update() {
            super.update();
            const speed = this.speed();
            if (speed && ++this._count >= speed) {
                this._count = 0;
                this._frame ^= 1;
                this._version = -1;
            }
            if (this.bitmap && this.bitmap._pmzVersion !== this._version) {
                this._version = this.bitmap._pmzVersion;
                const size = this.bitmap.width;
                this.setFrame(0, this.bitmap.height > size ? this._frame * size : 0, size, size);
            }
        }
    }
    window.Sprite_PokemonIcon = Sprite_PokemonIcon;

    PBS.onReload(() => cache.clear());

    window.PokeMZ.Graphics = Object.assign(Engine, {
        folder: FOLDER,
        load,
        /**
         * @brief Whether a species has its own image for a view.
         * @return {Promise<boolean>} True if a file was found.
         */
        exists: (speciesId, o = {}) => load(speciesId, o).then(b => !!b._pmzFound),
        optsOf,
        /** @brief Forgets cached images (after replacing files). */
        clearCache() {
            cache.clear();
            textCache.clear();
        },
    });
})();
