//=============================================================================
// PokéMZ - Locale.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Localization: CSV string tables, message formatting,
 * locale-aware formatting, wrapping, keyboards and debug tools.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @orderAfter PokeMZ_UI_Core
 * @orderBefore PokeMZ_UI_Messages
 *
 * @param language
 * @text Default Language
 * @desc Column of the string tables used until the player picks one in
 * Options. "auto" picks the closest match to the system language.
 * @type string
 * @default auto
 *
 * @param sourceLanguage
 * @text Source Language
 * @desc Language the database, maps and events are written in. Text from
 * the game data is used as-is for this language.
 * @type string
 * @default en
 *
 * @param files
 * @text String Tables
 * @desc CSV files in data/locales/ (a browser cannot list folders).
 * languages.csv and keyboards.csv are loaded separately.
 * @type string[]
 * @default ["ui.csv","database.csv","dialogue.csv","pokemon.csv","moves.csv","abilities.csv","items.csv","types.csv","trainer_types.csv","trainers.csv","map_metadata.csv","town_map.csv","encounters.csv","regional_dexes.csv","ribbons.csv","berry_plants.csv","battle_tower.csv"]
 *
 * @param showOption
 * @text Language Option
 * @desc Adds a Language entry to the Options screen.
 * @type boolean
 * @default true
 *
 * @param autoWrap
 * @text Auto Wrap MZ Windows
 * @desc Word-wraps text in MZ's message and help windows to their width.
 * @type boolean
 * @default true
 *
 * @param mirrorKeyboard
 * @text Mirror Physical Keyboard
 * @desc On-screen name entry letters follow the player's physical layout
 * (e.g. AZERTY) when the browser can detect it.
 * @type boolean
 * @default true
 *
 * @param debug
 * @text Debug Tools (playtest)
 * @desc Pseudo-locales, F7 language cycling, missing-string reports and
 * overflow highlighting while playtesting.
 * @type boolean
 * @default true
 *
 * @command setLanguage
 * @text Set Language
 * @desc Switches the game language (and saves it in the config).
 *
 * @arg language
 * @text Language
 * @desc A column of languages.csv, e.g. en, es-es, fr.
 * @type string
 * @default en
 *
 * @help
 * ============================================================================
 * PokeMZ_Locale
 * ============================================================================
 * Place below PokeMZ_UI_Core and above PokeMZ_UI_Messages. Works without the
 * UI plugins as well.
 *
 * Every text has a stable ID (e.g. Item.POTION.Name). The tables in
 * data/locales/*.csv have a "Key" column and one column per language; columns
 * starting with "#" are notes for translators. IDs are global across files.
 *
 * Lookup: language -> its Fallback chain (languages.csv) -> source language
 * -> the caller's fallback -> the key.
 *
 * Messages use ICU MessageFormat:
 *   {name}  {n, number}  {d, date, short}  {t, time}
 *   {n, plural, one {# Poké Ball} other {# Poké Balls}}
 *   {n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}
 *   {g, select, female {She} male {He} other {They}}
 * MZ escape codes (\N[1], \C[2], \{ ...) are protected: braces in them are not
 * message syntax, values inserted into a message cannot add codes, and the
 * checker makes sure translations keep the same codes as the source.
 * \L[Some.Key] in any text (Show Text, database, ui.csv) inserts that string.
 *
 * Event text: run "npm run l10n extract" with the editor closed. It puts a
 * <L10n: Dlg.xxxxxx> comment above each Show Text / Show Choices / Scrolling
 * Text and copies the text to data/locales/dialogue.csv. The editor keeps the
 * source text; other languages are swapped in at runtime.
 *
 * Database: names, descriptions and messages use <L10n: Item.POTION> in the
 * note as their key, or Db.Item.<id> without one. Fields are .Name,
 * .Description, .Nickname, .Profile, .Message1 ... .Message4.
 *
 * Saves store IDs, not text: actor names keep following the language until
 * the player renames them, and the language is kept in the config.
 *
 * API (window.PokeMZ.L10n):
 *   t(key, args, fallback)  format(pattern, args)  has(key)
 *   setLanguage(code)  language  languages()  onChange(fn)
 *   formatNumber  formatPercent  formatCurrency  formatDate  formatTime
 *   formatList  formatRelative  formatPlayTime  compare  sortBy
 *   graphemes(text)  wrap(text, width, measure)  keyboardPages()
 *   report()  checkOverflow()
 *
 * Playtest: F7 cycles languages (including the pseudo-locales qps-accent and
 * qps-keys), Shift+F7 jumps back to the source language.
 */

(() => {
    "use strict";

    //=========================================================================
    // Engine (pure: no MZ or DOM; also loaded by tools/l10n.js and tests)
    //=========================================================================

    /**
     * @brief Parses RFC 4180 CSV (quotes, "" escapes, CRLF, BOM, no final
     *        newline). Blank lines are dropped.
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

    /**
     * @brief Writes rows as CSV (LF line endings, quoting only when needed).
     * @param {Array<Array<string>>} rows Rows of fields.
     * @return {string} CSV text with a final newline.
     */
    function writeCsv(rows) {
        const field = v => {
            const s = v === undefined || v === null ? "" : String(v);
            return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        return rows.map(r => r.map(field).join(",")).join("\n") + "\n";
    }

    //-------------------------------------------------------------------------
    // MZ escape codes
    //-------------------------------------------------------------------------

    /** @brief One MZ escape code at the start of a string (after the "\"). */
    const CODE_BODY = /^(?:[A-Za-z]+(?:\[[^\]\r\n]*\])?|[$.|^!><{}])/;

    /**
     * @brief Lists the MZ escape codes in raw text (\N[1], \C[2], \{ ...).
     *        "\\" (a literal backslash) is not a code.
     * @param {string} text Raw text.
     * @return {Array<string>} Codes in order, upper-cased letters.
     */
    function escapeCodes(text) {
        const out = [];
        const s = String(text);
        for (let i = 0; i < s.length; i++) {
            if (s[i] !== "\\") {
                continue;
            }
            if (s[i + 1] === "\\") {
                i++;
                continue;
            }
            const m = CODE_BODY.exec(s.slice(i + 1));
            if (m) {
                out.push(`\\${m[0].replace(/^[a-z]+/i, x => x.toUpperCase())}`);
                i += m[0].length;
            }
        }
        return out;
    }

    /**
     * @brief Makes a value safe to insert into text: backslashes are doubled
     *        so player input can't become escape codes, and control
     *        characters MZ uses internally are removed.
     * @param {*} value Any value.
     * @return {string} Safe text.
     */
    function protect(value) {
        return String(value).replace(/[\x1b\f]/g, "").replace(/\\/g, "\\\\");
    }

    //-------------------------------------------------------------------------
    // ICU MessageFormat (subset)
    //-------------------------------------------------------------------------

    /**
     * @brief Parses an ICU message into an AST. MZ escape codes are kept as
     *        literal text, so "\{" is never a brace. Apostrophes quote only
     *        before { } # or another apostrophe (so "l'objet" is plain text).
     * @param {string} src Message pattern.
     * @return {Array} AST nodes: strings, {type: "arg"|"number"|"date"|"time"|
     *         "plural"|"selectordinal"|"select"|"hash", ...}.
     * @throws {SyntaxError} On malformed messages.
     */
    function parseMessage(src) {
        let i = 0;

        const fail = msg => {
            throw new SyntaxError(`${msg} at ${i} in "${src}"`);
        };

        const skipWs = () => {
            while (i < src.length && /\s/.test(src[i])) {
                i++;
            }
        };

        const ident = () => {
            skipWs();
            const m = /^[^\s,{}#'=]+/.exec(src.slice(i));
            if (!m) {
                fail("expected a name");
            }
            i += m[0].length;
            skipWs();
            return m[0];
        };

        /**
         * @brief Reads nodes until "}" (when nested) or the end.
         * @param {boolean} nested Inside a plural/select branch.
         * @param {boolean} inPlural "#" means the number.
         */
        const nodes = (nested, inPlural) => {
            const out = [];
            let text = "";
            const flush = () => {
                if (text) {
                    out.push(text);
                    text = "";
                }
            };
            while (i < src.length) {
                const c = src[i];
                if (c === "\\") {
                    if (src[i + 1] === "\\") {
                        text += "\\\\";
                        i += 2;
                        continue;
                    }
                    const m = CODE_BODY.exec(src.slice(i + 1));
                    if (m) {
                        text += `\\${m[0]}`;
                        i += 1 + m[0].length;
                        continue;
                    }
                    text += c;
                    i++;
                } else if (c === "'") {
                    const next = src[i + 1];
                    if (next === "'") {
                        text += "'";
                        i += 2;
                    } else if (next === "{" || next === "}" || (next === "#" && inPlural)) {
                        const end = src.indexOf("'", i + 1);
                        if (end < 0) {
                            text += src.slice(i + 1);
                            i = src.length;
                        } else {
                            text += src.slice(i + 1, end).replace(/''/g, "'");
                            i = end + 1;
                        }
                    } else {
                        text += c;
                        i++;
                    }
                } else if (c === "{") {
                    flush();
                    i++;
                    out.push(argument());
                } else if (c === "}") {
                    if (!nested) {
                        fail("unexpected }");
                    }
                    break;
                } else if (c === "#" && inPlural) {
                    flush();
                    out.push({ type: "hash" });
                    i++;
                } else {
                    text += c;
                    i++;
                }
            }
            flush();
            return out;
        };

        const expect = ch => {
            skipWs();
            if (src[i] !== ch) {
                fail(`expected "${ch}"`);
            }
            i++;
        };

        const argument = () => {
            const name = ident();
            if (src[i] === "}") {
                i++;
                return { type: "arg", name };
            }
            expect(",");
            const kind = ident();
            if (kind === "number" || kind === "date" || kind === "time") {
                let style = "";
                if (src[i] === ",") {
                    i++;
                    skipWs();
                    const end = src.indexOf("}", i);
                    if (end < 0) {
                        fail("unclosed argument");
                    }
                    style = src.slice(i, end).trim();
                    i = end;
                }
                expect("}");
                return { type: kind, name, style };
            }
            if (kind !== "plural" && kind !== "selectordinal" && kind !== "select") {
                fail(`unknown argument type "${kind}"`);
            }
            expect(",");
            skipWs();
            let offset = 0;
            const om = /^offset:\s*(\d+)/.exec(src.slice(i));
            if (om && kind !== "select") {
                offset = Number(om[1]);
                i += om[0].length;
            }
            const options = {};
            skipWs();
            while (i < src.length && src[i] !== "}") {
                let sel;
                if (src[i] === "=") {
                    i++;
                    sel = `=${ident()}`;
                } else {
                    sel = ident();
                }
                expect("{");
                options[sel] = nodes(true, kind !== "select");
                expect("}");
                skipWs();
            }
            expect("}");
            if (!options.other) {
                fail(`${kind} needs an "other" branch`);
            }
            return { type: kind, name, offset, options };
        };

        return nodes(false, false);
    }

    /**
     * @brief Collects the argument names used anywhere in an AST.
     * @param {Array} ast AST from parseMessage.
     * @param {Set<string>} [into] Set to fill.
     * @return {Set<string>} Names.
     */
    function messageArgs(ast, into = new Set()) {
        for (const n of ast) {
            if (typeof n === "string" || n.type === "hash") {
                continue;
            }
            into.add(n.name);
            if (n.options) {
                for (const k of Object.keys(n.options)) {
                    messageArgs(n.options[k], into);
                }
            }
        }
        return into;
    }

    //-------------------------------------------------------------------------
    // Unicode text: graphemes and line breaking
    //-------------------------------------------------------------------------

    const hasSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function";

    /** @brief Grapheme regex for runtimes without Intl.Segmenter. */
    const GRAPHEME_RE = (() => {
        const ext = "[\\p{M}\\u200C\\uFE00-\\uFE0F\\u{E0020}-\\u{E007F}\\u{1F3FB}-\\u{1F3FF}]*";
        const hangul = "[\\u1100-\\u115F\\uA960-\\uA97C]+[\\u1160-\\u11A7\\uD7B0-\\uD7C6]*[\\u11A8-\\u11FF\\uD7CB-\\uD7FB]*";
        const base = `(?:\\r\\n|\\p{RI}\\p{RI}|${hangul}|[\\s\\S])${ext}`;
        try {
            return new RegExp(`${base}(?:\\u200D${base})*`, "gu");
        } catch (e) {
            return /[\s\S]/gu;
        }
    })();

    const segmenters = new Map();

    /**
     * @brief Gets a cached Intl.Segmenter.
     * @param {string} locale BCP 47 tag.
     * @param {string} granularity "grapheme" or "word".
     * @return {Intl.Segmenter|null} The segmenter, if supported.
     */
    function segmenter(locale, granularity) {
        if (!hasSegmenter) {
            return null;
        }
        const id = `${locale}|${granularity}`;
        if (!segmenters.has(id)) {
            segmenters.set(id, new Intl.Segmenter(locale || undefined, { granularity }));
        }
        return segmenters.get(id);
    }

    /**
     * @brief Splits text into user-perceived characters (grapheme clusters),
     *        so "é" written as e + accent, emoji sequences and Hangul count
     *        as one character.
     * @param {string} text Text.
     * @param {string} [locale] BCP 47 tag.
     * @return {Array<string>} Graphemes.
     */
    function graphemes(text, locale) {
        const s = String(text);
        const seg = segmenter(locale, "grapheme");
        if (seg) {
            return Array.from(seg.segment(s), x => x.segment);
        }
        return s.match(GRAPHEME_RE) || [];
    }

    /** @brief Characters that may not start a line (closing punctuation, small kana). */
    const NO_START = new Set(
        [..."!%),.:;?]}¢°’”‰′″℃、。〉》」』】〕〗〙〟ゝゞ々ーぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ・ヽヾ！％），．：；？］｝｡｣､･ｰ…‥»"]
    );
    /** @brief Characters that may not end a line (opening punctuation). */
    const NO_END = new Set([..."([{£¥«‘“〈《「『【〔〖〘〝（［｛｢¿¡"]);

    /**
     * @brief Line-break class of a grapheme (a reduced UAX #14).
     * @param {string} g Grapheme.
     * @return {string} BK, SP, ZW, GL, HY, ID, SA, CL, OP, CODE or AL.
     */
    function breakClass(g) {
        const c = g.codePointAt(0);
        if (g === "\n" || g === "\r\n" || g === "\r" || g === "\f") {
            return "BK";
        }
        if (g[0] === "\x1b") {
            return "CODE";
        }
        if (c === 0x20 || c === 0x09 || c === 0x3000) {
            return "SP";
        }
        if (c === 0x200b) {
            return "ZW";
        }
        if (c === 0xa0 || c === 0x202f || c === 0x2060 || c === 0xfeff || c === 0x2007) {
            return "GL";
        }
        if (c === 0x2d || c === 0xad || c === 0x2010 || c === 0x2012 || c === 0x2013 || c === 0x2014) {
            return "HY";
        }
        if (NO_START.has(g[0])) {
            return "CL";
        }
        if (NO_END.has(g[0])) {
            return "OP";
        }
        if (
            (c >= 0x0e00 && c <= 0x0eff) || // Thai, Lao
            (c >= 0x1000 && c <= 0x109f) || // Myanmar
            (c >= 0x1780 && c <= 0x17ff) // Khmer
        ) {
            return "SA";
        }
        if (
            (c >= 0x2e80 && c <= 0x9fff) || // CJK radicals .. ideographs, kana
            (c >= 0xac00 && c <= 0xd7af) || // Hangul syllables
            (c >= 0xf900 && c <= 0xfaff) ||
            (c >= 0xff01 && c <= 0xff60) ||
            (c >= 0x1f300 && c <= 0x1faff) || // emoji
            (c >= 0x20000 && c <= 0x3ffff)
        ) {
            return "ID";
        }
        return "AL";
    }

    /**
     * @brief Splits text into unbreakable units: graphemes, with MZ codes
     *        ("\x1b" + code) kept whole.
     * @param {string} text Converted text (codes start with "\x1b").
     * @param {string} [locale] BCP 47 tag.
     * @return {Array<string>} Units.
     */
    function units(text, locale) {
        const out = [];
        const s = String(text);
        let plain = "";
        const flush = () => {
            if (plain) {
                out.push(...graphemes(plain, locale));
                plain = "";
            }
        };
        for (let i = 0; i < s.length; i++) {
            if (s[i] === "\x1b") {
                flush();
                const m = CODE_BODY.exec(s.slice(i + 1));
                const len = m ? m[0].length : 0;
                out.push(s.slice(i, i + 1 + len));
                i += len;
            } else {
                plain += s[i];
            }
        }
        flush();
        return out;
    }

    /**
     * @brief Finds where lines may break. Works for spaced scripts, CJK
     *        (anywhere, with kinsoku rules), and Thai/Lao/Khmer/Myanmar (word
     *        boundaries from Intl.Segmenter when available).
     * @param {Array<string>} us Units from units().
     * @param {string} [locale] BCP 47 tag.
     * @return {Array<number>} Per index i: 0 = no break before us[i],
     *         1 = may break, 2 = must break.
     */
    function breakOpportunities(us, locale) {
        const cls = us.map(breakClass);
        // Treat codes as part of the following unit.
        const eff = i => {
            let j = i;
            while (j < cls.length && cls[j] === "CODE") {
                j++;
            }
            return j < cls.length ? cls[j] : "AL";
        };
        const prevEff = i => {
            let j = i;
            while (j >= 0 && cls[j] === "CODE") {
                j--;
            }
            return j >= 0 ? cls[j] : "";
        };
        // Word boundaries inside runs of SA characters.
        const saBreaks = new Set();
        const wordSeg = segmenter(locale, "word");
        for (let i = 0; i < us.length; ) {
            if (cls[i] !== "SA") {
                i++;
                continue;
            }
            let j = i;
            while (j < us.length && (cls[j] === "SA" || /^\p{M}/u.test(us[j]))) {
                j++;
            }
            if (wordSeg) {
                // Map word-boundary string offsets back to unit indices.
                let charPos = 0;
                let unitIdx = i;
                for (const part of wordSeg.segment(us.slice(i, j).join(""))) {
                    while (unitIdx < j && charPos < part.index) {
                        charPos += us[unitIdx++].length;
                    }
                    if (part.index > 0 && charPos === part.index) {
                        saBreaks.add(unitIdx);
                    }
                }
            } else {
                for (let k = i + 1; k < j; k++) {
                    saBreaks.add(k);
                }
            }
            i = j;
        }

        const out = new Array(us.length).fill(0);
        for (let i = 1; i < us.length; i++) {
            if (cls[i] === "CODE" && cls[i - 1] !== "BK") {
                continue; // break, if any, goes before the next real unit
            }
            const a = prevEff(i - 1);
            const b = cls[i] === "CODE" ? eff(i) : cls[i];
            if (a === "BK") {
                out[i] = 2;
            } else if (a === "ZW") {
                out[i] = 1;
            } else if (a === "GL" || b === "GL" || b === "SP" || b === "BK" || b === "ZW") {
                out[i] = 0;
            } else if (b === "CL" || a === "OP") {
                out[i] = 0;
            } else if (a === "SP") {
                out[i] = 1;
            } else if (a === "HY") {
                const before = prevEff(i - 2);
                out[i] = before && before !== "SP" && b !== "CL" ? 1 : 0;
            } else if (a === "ID" || b === "ID") {
                out[i] = 1;
            } else if (a === "CL" && (b === "ID" || b === "OP")) {
                out[i] = 1;
            } else if (a === "SA" && b === "SA") {
                out[i] = saBreaks.has(i) ? 1 : 0;
            }
        }
        return out;
    }

    /**
     * @brief Word-wraps text to a width. Existing line breaks are kept,
     *        spaces at the end of a line are dropped, a soft hyphen at a break
     *        becomes "-", and words longer than a line are split between
     *        graphemes.
     * @param {string} text Converted text (MZ codes as "\x1b...").
     * @param {number} maxWidth Width available.
     * @param {function(string): number} measure Width of a line of text
     *        (which may contain codes).
     * @param {string} [locale] BCP 47 tag.
     * @return {string} Text with "\n" inserted.
     */
    function wrap(text, maxWidth, measure, locale) {
        const us = units(text, locale);
        if (!us.length || !(maxWidth > 0)) {
            return String(text);
        }
        const brk = breakOpportunities(us, locale);
        const isSpace = u => u === " " || u === "\t" || u === "\u3000";
        const lines = [];
        let line = [];
        let lastBreak = -1; // index in `line` where a break may happen
        const lineText = arr => arr.join("").replace(/\u00ad/g, "");
        const finish = arr => {
            let end = arr.length;
            while (end > 0 && isSpace(arr[end - 1])) {
                end--;
            }
            const out = arr.slice(0, end);
            if (out.length && out[out.length - 1] === "\u00ad") {
                out[out.length - 1] = "-";
            }
            lines.push(lineText(out));
        };
        for (let i = 0; i < us.length; i++) {
            const u = us[i];
            if (brk[i] === 2) {
                lines.push(lineText(line));
                line = [];
                lastBreak = -1;
            } else if (brk[i] === 1 && line.length) {
                lastBreak = line.length;
            }
            if (breakClass(u) === "BK") {
                continue; // the break itself is implied by the next unit
            }
            line.push(u);
            if (isSpace(u) || breakClass(u) === "CODE") {
                continue; // trailing spaces may overhang
            }
            if (measure(lineText(line)) <= maxWidth) {
                continue;
            }
            if (lastBreak > 0) {
                const rest = line.slice(lastBreak);
                finish(line.slice(0, lastBreak));
                while (rest.length && isSpace(rest[0])) {
                    rest.shift();
                }
                line = rest;
                lastBreak = -1;
            }
            // Still too wide: hard-break the word between graphemes.
            while (line.length > 1 && measure(lineText(line)) > maxWidth) {
                let cut = line.length - 1;
                while (cut > 1 && measure(lineText(line.slice(0, cut))) > maxWidth) {
                    cut--;
                }
                finish(line.slice(0, cut));
                line = line.slice(cut);
                lastBreak = -1;
            }
        }
        if (/\n$/.test(text) || line.length) {
            lines.push(lineText(line));
        }
        return lines.join("\n");
    }

    //-------------------------------------------------------------------------
    // Pseudo-localization
    //-------------------------------------------------------------------------

    const PSEUDO_MAP = {
        a: "á", b: "ƀ", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "î", j: "ĵ", k: "ķ", l: "ļ", m: "ɱ",
        n: "ñ", o: "ö", p: "þ", q: "ǫ", r: "ŕ", s: "š", t: "ţ", u: "û", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
        A: "Å", B: "Ɓ", C: "Ç", D: "Ð", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Î", J: "Ĵ", K: "Ķ", L: "Ļ", M: "Ṁ",
        N: "Ñ", O: "Ö", P: "Þ", Q: "Ǫ", R: "Ŕ", S: "Š", T: "Ţ", U: "Û", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž",
    };

    /**
     * @brief Accents letters and pads text by ~40% so untranslated or
     *        truncated strings stand out. Escape codes are left alone.
     * @param {string} text Formatted text.
     * @return {string} Pseudo text in [brackets].
     */
    function pseudo(text) {
        let letters = 0;
        let out = "";
        const s = String(text);
        for (let i = 0; i < s.length; i++) {
            if (s[i] === "\\" || s[i] === "\x1b") {
                if (s[i + 1] === "\\") {
                    out += s.slice(i, i + 2);
                    i++;
                    continue;
                }
                const m = CODE_BODY.exec(s.slice(i + 1));
                const len = m ? m[0].length : 0;
                out += s.slice(i, i + 1 + len);
                i += len;
                continue;
            }
            if (PSEUDO_MAP[s[i]]) {
                letters++;
            }
            out += PSEUDO_MAP[s[i]] || s[i];
        }
        const pad = Math.ceil(letters * 0.4);
        return `[${out}${pad ? ` ${"~".repeat(pad)}` : ""}]`;
    }

    //-------------------------------------------------------------------------
    // Catalogue, lookup, formatting
    //-------------------------------------------------------------------------

    const PSEUDO_LOCALES = ["qps-accent", "qps-keys"];

    /**
     * @brief Turns a column name (es-mx) into a BCP 47 tag (es-MX).
     * @param {string} code Column name.
     * @return {string} Tag.
     */
    function toBcp47(code) {
        const parts = String(code).split(/[-_]/);
        return parts.map((p, i) => (i === 0 ? p.toLowerCase() : p.length === 2 ? p.toUpperCase() : p.length === 4 ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p)).join("-");
    }

    /**
     * @brief Creates a localization engine: string tables, language
     *        metadata, fallbacks, message formatting and Intl helpers.
     * @param {Object} [opts] {sourceLanguage = "en", onMissing(key, lang)}.
     * @return {Object} The engine.
     */
    function createEngine(opts = {}) {
        const engine = {
            source: (opts.sourceLanguage || "en").toLowerCase(),
            /** @type {Map<string, {values: Object, notes: Object, file: string}>} */
            entries: new Map(),
            columns: new Set(),
            duplicates: [],
            meta: {},
            metaLanguages: [],
            layouts: {},
            language: (opts.sourceLanguage || "en").toLowerCase(),
            astCache: new Map(),
            intlCache: new Map(),
            missing: new Map(),
            fallbackHits: new Map(),
            used: new Set(),
            onMissing: opts.onMissing || null,

            /** @brief Forgets all tables (before a reload). */
            clear() {
                this.entries = new Map();
                this.columns = new Set();
                this.duplicates = [];
                this.astCache.clear();
            },

            /**
             * @brief Adds a string table.
             * @param {string} text CSV text with a Key column.
             * @param {string} file File name (for reports).
             */
            addCsv(text, file) {
                const rows = parseCsv(text);
                const header = (rows.shift() || []).map(s => s.trim());
                const langs = header.map((h, i) => (i === 0 || h.startsWith("#") ? null : h.toLowerCase()));
                langs.forEach(l => l && this.columns.add(l));
                rows.forEach((row, r) => {
                    const key = (row[0] || "").trim();
                    if (!key || key.startsWith("#")) {
                        return;
                    }
                    const values = {};
                    const notes = {};
                    header.forEach((h, i) => {
                        if (i === 0 || row[i] === undefined || row[i] === "") {
                            return;
                        }
                        if (langs[i]) {
                            values[langs[i]] = row[i];
                        } else {
                            notes[h.slice(1).toLowerCase()] = row[i];
                        }
                    });
                    if (this.entries.has(key)) {
                        this.duplicates.push({ key, file, line: r + 2, first: this.entries.get(key).file });
                    }
                    this.entries.set(key, { values, notes, file, line: r + 2 });
                });
                this.astCache.clear();
            },

            /**
             * @brief Loads languages.csv (Key column = property, one column
             *        per language).
             * @param {string} text CSV text.
             */
            setLanguagesCsv(text) {
                const rows = parseCsv(text);
                const header = (rows.shift() || []).map(s => s.trim().toLowerCase());
                this.metaLanguages = header.slice(1).filter(h => h && !h.startsWith("#"));
                this.meta = {};
                for (const lang of this.metaLanguages) {
                    this.meta[lang] = {};
                }
                for (const row of rows) {
                    const prop = (row[0] || "").trim().toLowerCase();
                    if (!prop || prop.startsWith("#")) {
                        continue;
                    }
                    header.forEach((lang, i) => {
                        if (i > 0 && this.meta[lang]) {
                            this.meta[lang][prop] = (row[i] || "").trim();
                        }
                    });
                }
                this.intlCache.clear();
            },

            /**
             * @brief Loads keyboards.csv (Key column = PageN.Label / PageN.RowM,
             *        one column per layout).
             * @param {string} text CSV text.
             */
            setKeyboardsCsv(text) {
                const rows = parseCsv(text);
                const header = (rows.shift() || []).map(s => s.trim().toLowerCase());
                this.layouts = {};
                header.slice(1).forEach(id => id && !id.startsWith("#") && (this.layouts[id] = []));
                for (const row of rows) {
                    const m = /^page(\d+)\.(label|row(\d+))$/i.exec((row[0] || "").trim());
                    if (!m) {
                        continue;
                    }
                    const p = Number(m[1]) - 1;
                    header.forEach((id, i) => {
                        const value = row[i];
                        if (i === 0 || !this.layouts[id] || value === undefined || value === "") {
                            return;
                        }
                        const pages = this.layouts[id];
                        pages[p] = pages[p] || { label: "", rows: [] };
                        if (m[3]) {
                            pages[p].rows[Number(m[3]) - 1] = value;
                        } else {
                            pages[p].label = value;
                        }
                    });
                }
                for (const id of Object.keys(this.layouts)) {
                    this.layouts[id] = this.layouts[id].filter(Boolean).map(pg => ({ label: pg.label, rows: pg.rows.filter(Boolean) }));
                }
            },

            /** @return {Array<string>} Real languages (languages.csv, else table columns). */
            languages() {
                return this.metaLanguages.length ? this.metaLanguages.slice() : [...this.columns];
            },

            /**
             * @brief Picks the best available language for a request.
             * @param {string|Array<string>} want Code, "auto", or a list of
             *        preferred codes.
             * @param {Array<string>} [system] System languages for "auto".
             * @return {string} A language code.
             */
            resolve(want, system = []) {
                const all = this.languages().concat(PSEUDO_LOCALES);
                let list = Array.isArray(want) ? want : [want];
                if (list.length === 1 && String(list[0]).toLowerCase() === "auto") {
                    list = system;
                }
                list = list.map(l => String(l || "").toLowerCase().replace(/_/g, "-"));
                // In order of preference: exact match, else same base language.
                for (const l of list) {
                    if (all.includes(l)) {
                        return l;
                    }
                    const base = l.split("-")[0];
                    const hit = this.languages().find(x => x === base || x.split("-")[0] === base);
                    if (hit) {
                        return hit;
                    }
                }
                return this.source;
            },

            /**
             * @brief The languages tried, in order, for a language.
             * @param {string} [lang] Language (default: current).
             * @return {Array<string>} Chain ending with the source language.
             */
            chain(lang = this.language) {
                const out = [];
                const visit = l => {
                    if (!l || out.includes(l)) {
                        return;
                    }
                    out.push(l);
                    const fb = this.meta[l] && this.meta[l].fallback;
                    if (fb) {
                        fb.split(/[|,;\s]+/).forEach(x => visit(x.toLowerCase()));
                    }
                };
                visit(PSEUDO_LOCALES.includes(lang) ? this.source : lang);
                visit(this.source);
                return out;
            },

            /** @return {string} BCP 47 tag for Intl (languages.csv "Intl"). */
            intlTag(lang = this.language) {
                const real = PSEUDO_LOCALES.includes(lang) ? this.source : lang;
                const m = this.meta[real];
                return (m && m.intl) || toBcp47(real);
            },

            /** @return {string} "ltr" or "rtl". */
            direction(lang = this.language) {
                const m = this.meta[lang];
                return m && m.direction === "rtl" ? "rtl" : "ltr";
            },

            /** @return {boolean} True if the key exists in any language. */
            has(key) {
                return this.entries.has(key);
            },

            /**
             * @brief Raw pattern for a key, following the fallback chain.
             * @param {string} key Stable ID.
             * @param {Object} [o] {lang, noSource: skip the source language
             *        (for text whose source lives in the game data)}.
             * @return {{text: string, lang: string}|undefined} The hit.
             */
            lookup(key, o = {}) {
                const lang = o.lang || this.language;
                this.used.add(key);
                const entry = this.entries.get(key);
                const chain = this.chain(lang);
                if (entry) {
                    for (const l of chain) {
                        if (o.noSource && l === this.source) {
                            continue;
                        }
                        if (entry.values[l] !== undefined) {
                            if (l !== chain[0] && !PSEUDO_LOCALES.includes(lang)) {
                                this.count(this.fallbackHits, key, lang);
                            }
                            return { text: entry.values[l], lang: l };
                        }
                    }
                }
                if (!o.noSource) {
                    this.count(this.missing, key, lang);
                    if (this.onMissing) {
                        this.onMissing(key, lang);
                    }
                }
                return undefined;
            },

            count(map, key, lang) {
                const id = `${lang}\u0000${key}`;
                map.set(id, (map.get(id) || 0) + 1);
            },

            /**
             * @brief Raw text for a key in the current language, with
             *        pseudo-locales applied. Undefined when missing.
             * @param {string} key Stable ID.
             * @param {Object} [o] Options for lookup().
             * @return {string|undefined} Pattern (not yet formatted).
             */
            get(key, o = {}) {
                if ((o.lang || this.language) === "qps-keys") {
                    return `⟦${key}⟧`;
                }
                const hit = this.lookup(key, o);
                return hit ? hit.text : undefined;
            },

            /**
             * @brief Parses (with a cache) and formats a message.
             * @param {string} pattern ICU pattern.
             * @param {Object|Array} [args] Values by name (arrays: by index,
             *        also usable as %1, %2 ...).
             * @param {Object} [o] {lang, raw: skip pseudo-localization}.
             * @return {string} Text (MZ codes intact; inserted values
             *         protected).
             */
            format(pattern, args, o = {}) {
                const lang = o.lang || this.language;
                const values = args || {};
                let ast = this.astCache.get(pattern);
                if (!ast) {
                    try {
                        ast = parseMessage(String(pattern));
                    } catch (e) {
                        ast = [String(pattern)];
                        if (typeof console !== "undefined") {
                            console.warn(`[PokeMZ.L10n] ${e.message}`);
                        }
                    }
                    this.astCache.set(pattern, ast);
                }
                let out = this.render(ast, values, lang, null);
                if (Array.isArray(values)) {
                    out = out.replace(/%(\d+)/g, (m, n) => (values[n - 1] !== undefined ? protect(values[n - 1]) : m));
                }
                return lang === "qps-accent" && !o.raw ? pseudo(out) : out;
            },

            /** @brief Renders AST nodes to text. */
            render(ast, values, lang, hash) {
                let out = "";
                for (const n of ast) {
                    if (typeof n === "string") {
                        out += n;
                        continue;
                    }
                    if (n.type === "hash") {
                        out += hash !== null ? this.formatNumber(hash, {}, lang) : "#";
                        continue;
                    }
                    const v = values[n.name];
                    switch (n.type) {
                        case "arg":
                            out += v === undefined ? `{${n.name}}` : typeof v === "number" ? this.formatNumber(v, {}, lang) : protect(v);
                            break;
                        case "number":
                            out += this.formatNumber(Number(v), numberStyle(n.style), lang);
                            break;
                        case "date":
                        case "time":
                            out += protect(this.formatDate(v, dateStyle(n.type, n.style), lang));
                            break;
                        case "select": {
                            const branch = n.options[String(v)] || n.options.other;
                            out += this.render(branch, values, lang, hash);
                            break;
                        }
                        default: {
                            const num = Number(v);
                            const exact = n.options[`=${num}`];
                            const rel = num - n.offset;
                            let branch = exact;
                            if (!branch) {
                                const cat = this.intl("PluralRules", lang, { type: n.type === "plural" ? "cardinal" : "ordinal" }).select(rel);
                                branch = n.options[cat] || n.options.other;
                            }
                            out += this.render(branch, values, lang, rel);
                            break;
                        }
                    }
                }
                return out;
            },

            /**
             * @brief Looks up and formats a key.
             * @param {string} key Stable ID.
             * @param {Object|Array} [args] Message arguments.
             * @param {string} [fallback] Pattern used when the key is missing.
             * @return {string} The text, or the key in ⟦brackets⟧ if missing.
             */
            t(key, args, fallback) {
                const raw = this.get(key);
                if (raw === undefined) {
                    return fallback !== undefined ? this.format(fallback, args) : `⟦${key}⟧`;
                }
                return this.format(raw, args);
            },

            /**
             * @brief Gets a cached Intl object.
             * @param {string} type Constructor name in Intl.
             * @param {string} lang Language.
             * @param {Object} [options] Constructor options.
             * @return {Object} The Intl object.
             */
            intl(type, lang = this.language, options = {}) {
                const tag = this.intlTag(lang);
                const id = `${type}|${tag}|${JSON.stringify(options)}`;
                let obj = this.intlCache.get(id);
                if (!obj) {
                    try {
                        obj = new Intl[type](tag, options);
                    } catch (e) {
                        obj = new Intl[type]("en", options);
                    }
                    this.intlCache.set(id, obj);
                }
                return obj;
            },

            formatNumber(n, options = {}, lang) {
                return Number.isFinite(n) ? this.intl("NumberFormat", lang, options).format(n) : String(n);
            },

            formatPercent(ratio, digits = 0, lang) {
                return this.formatNumber(ratio, { style: "percent", maximumFractionDigits: digits }, lang);
            },

            formatDate(date, options = { dateStyle: "medium" }, lang) {
                const d = date instanceof Date ? date : new Date(date);
                return isNaN(d) ? "" : this.intl("DateTimeFormat", lang, options).format(d);
            },

            formatList(items, type = "conjunction", lang) {
                const list = items.map(String);
                if (typeof Intl.ListFormat !== "function") {
                    return list.join(", ");
                }
                return this.intl("ListFormat", lang, { type, style: "long" }).format(list);
            },

            formatRelative(value, unit, lang) {
                if (typeof Intl.RelativeTimeFormat !== "function") {
                    return `${value} ${unit}`;
                }
                return this.intl("RelativeTimeFormat", lang, { numeric: "auto" }).format(value, unit);
            },

            /**
             * @brief Formats seconds as h:mm:ss with the locale's digits.
             * @param {number} seconds Play time.
             * @return {string} Text.
             */
            formatPlayTime(seconds, lang) {
                const s = Math.max(0, Math.floor(seconds));
                const two = n => this.formatNumber(n, { minimumIntegerDigits: 2, useGrouping: false }, lang);
                const h = this.formatNumber(Math.floor(s / 3600), { useGrouping: false }, lang);
                return `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
            },

            /** @brief Locale-aware string comparison (case/accent-insensitive first, numbers in order). */
            compare(a, b, lang) {
                return this.intl("Collator", lang, { numeric: true, sensitivity: "variant" }).compare(String(a), String(b));
            },

            /**
             * @brief Sorts a copy of a list by a text key in locale order.
             * @param {Array} list Items.
             * @param {function(*): string} keyFn Text to sort by.
             * @return {Array} Sorted copy.
             */
            sortBy(list, keyFn = x => x, lang) {
                const col = this.intl("Collator", lang, { numeric: true, sensitivity: "variant" });
                return list
                    .map(item => ({ item, k: String(keyFn(item)) }))
                    .sort((x, y) => col.compare(x.k, y.k))
                    .map(x => x.item);
            },

            graphemes(text, lang) {
                return graphemes(text, this.intlTag(lang));
            },

            wrap(text, maxWidth, measure, lang) {
                return wrap(text, maxWidth, measure, this.intlTag(lang));
            },

            /**
             * @brief Validates the tables. Errors break text at runtime;
             *        warnings need a translator's attention.
             * @return {{errors: Array<string>, warnings: Array<string>}} Issues.
             */
            check() {
                const errors = [];
                const warnings = [];
                for (const d of this.duplicates) {
                    errors.push(`${d.file}:${d.line} duplicate key "${d.key}" (first in ${d.first})`);
                }
                const known = this.languages();
                for (const lang of [...this.columns]) {
                    if (this.metaLanguages.length && !known.includes(lang)) {
                        warnings.push(`column "${lang}" is not in languages.csv`);
                    }
                }
                for (const lang of this.metaLanguages) {
                    for (const fb of this.chain(lang).slice(1)) {
                        if (!known.includes(fb)) {
                            errors.push(`languages.csv: ${lang} falls back to unknown "${fb}"`);
                        }
                    }
                    const kb = this.meta[lang].keyboard;
                    if (kb && Object.keys(this.layouts).length && !this.layouts[kb]) {
                        errors.push(`languages.csv: ${lang} uses unknown keyboard "${kb}"`);
                    }
                }
                for (const [key, entry] of this.entries) {
                    const where = `${entry.file}:${entry.line} ${key}`;
                    const src = entry.values[this.source];
                    let srcArgs = null;
                    if (src !== undefined) {
                        try {
                            srcArgs = messageArgs(parseMessage(src));
                        } catch (e) {
                            errors.push(`${where} [${this.source}] ${e.message}`);
                        }
                    }
                    const srcCodes = src !== undefined ? escapeCodes(src).sort().join(" ") : null;
                    for (const lang of Object.keys(entry.values)) {
                        if (lang === this.source) {
                            continue;
                        }
                        const text = entry.values[lang];
                        let args;
                        try {
                            args = messageArgs(parseMessage(text));
                        } catch (e) {
                            errors.push(`${where} [${lang}] ${e.message}`);
                            continue;
                        }
                        if (src === undefined) {
                            warnings.push(`${where} [${lang}] has no ${this.source} source text`);
                            continue;
                        }
                        const codes = escapeCodes(text).sort().join(" ");
                        if (codes !== srcCodes) {
                            errors.push(`${where} [${lang}] escape codes differ: "${codes}" vs ${this.source} "${srcCodes}"`);
                        }
                        if (srcArgs) {
                            for (const a of args) {
                                if (!srcArgs.has(a)) {
                                    errors.push(`${where} [${lang}] uses {${a}}, which the source doesn't have`);
                                }
                            }
                            for (const a of srcArgs) {
                                if (!args.has(a)) {
                                    warnings.push(`${where} [${lang}] doesn't use {${a}}`);
                                }
                            }
                        }
                    }
                    if (entry.notes.stale) {
                        warnings.push(`${where} source changed; review translations (then clear #Stale)`);
                    }
                }
                return { errors, warnings };
            },

            /**
             * @brief Translation coverage per language.
             * @return {Object<string, {done: number, total: number}>} Counts.
             */
            stats() {
                const out = {};
                const langs = this.languages();
                for (const lang of langs) {
                    out[lang] = { done: 0, total: 0 };
                }
                for (const entry of this.entries.values()) {
                    if (entry.values[this.source] === undefined) {
                        continue;
                    }
                    for (const lang of langs) {
                        out[lang].total++;
                        if (entry.values[lang] !== undefined) {
                            out[lang].done++;
                        }
                    }
                }
                return out;
            },
        };
        return engine;
    }

    /** @brief Maps a {n, number, style} style to Intl options. */
    function numberStyle(style) {
        switch (style) {
            case "integer":
                return { maximumFractionDigits: 0 };
            case "percent":
                return { style: "percent" };
            case "":
            case undefined:
                return {};
            default: {
                const m = /^\.(0+)$/.exec(style);
                return m ? { minimumFractionDigits: m[1].length, maximumFractionDigits: m[1].length } : {};
            }
        }
    }

    /** @brief Maps a {d, date|time, style} style to Intl options. */
    function dateStyle(type, style) {
        const s = ["short", "medium", "long", "full"].includes(style) ? style : "medium";
        return type === "date" ? { dateStyle: s } : { timeStyle: s === "full" ? "long" : s };
    }

    const Engine = {
        parseCsv,
        writeCsv,
        escapeCodes,
        protect,
        parseMessage,
        messageArgs,
        graphemes,
        units,
        breakOpportunities,
        wrap,
        pseudo,
        toBcp47,
        createEngine,
        PSEUDO_LOCALES,
    };

    // Outside MZ (Node: tools and tests) only the engine is needed.
    if (typeof PluginManager === "undefined") {
        if (typeof module !== "undefined" && module.exports) {
            module.exports = Engine;
        }
        return;
    }

    //=========================================================================
    // Runtime (RPG Maker MZ)
    //=========================================================================

    const PLUGIN_NAME = "PokeMZ_Locale";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const parseBool = (v, fallback) => (v === undefined || v === "" ? fallback : v === "true");
    const parseList = v => {
        try {
            return JSON.parse(v);
        } catch (e) {
            return null;
        }
    };

    const CONFIG = {
        language: params.language || "auto",
        sourceLanguage: (params.sourceLanguage || "en").toLowerCase(),
        files: parseList(params.files) || [
            "ui.csv",
            "database.csv",
            "dialogue.csv",
            "pokemon.csv",
            "moves.csv",
            "abilities.csv",
            "items.csv",
            "types.csv",
            "trainer_types.csv",
            "trainers.csv",
            "map_metadata.csv",
            "town_map.csv",
            "encounters.csv",
            "regional_dexes.csv",
            "ribbons.csv",
            "berry_plants.csv",
            "battle_tower.csv",
        ],
        showOption: parseBool(params.showOption, true),
        autoWrap: parseBool(params.autoWrap, true),
        mirrorKeyboard: parseBool(params.mirrorKeyboard, true),
        debug: parseBool(params.debug, true),
    };

    const isPlaytest = () => Utils.isOptionValid("test");
    const debugOn = () => CONFIG.debug && isPlaytest();
    const UI = () => (window.PokeMZ && window.PokeMZ.UI) || null;

    const warned = new Set();
    const engine = createEngine({
        sourceLanguage: CONFIG.sourceLanguage,
        onMissing(key, lang) {
            if (debugOn() && !warned.has(key) && L10n.ready) {
                warned.add(key);
                console.warn(`[PokeMZ.L10n] missing "${key}" (${lang})`);
            }
        },
    });

    const listeners = new Set();
    const staleDialogue = new Map();

    //-------------------------------------------------------------------------
    // Loading
    //-------------------------------------------------------------------------

    /**
     * @brief Fetches a text file from data/locales/.
     * @param {string} file File name.
     * @param {boolean} bust Add a cache buster (reloads).
     * @return {Promise<string|null>} Text, or null when missing.
     */
    function fetchText(file, bust) {
        return new Promise(resolve => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", `data/locales/${file}${bust ? `?v=${Date.now()}` : ""}`);
            xhr.overrideMimeType("text/plain; charset=utf-8");
            xhr.onload = () => resolve(xhr.status < 400 ? xhr.responseText : null);
            xhr.onerror = () => resolve(null);
            xhr.send();
        });
    }

    let loadPromise = null;

    /**
     * @brief (Re)loads languages.csv, keyboards.csv and the string tables.
     * @param {boolean} [bust] Bypass the cache (hot reload).
     * @return {Promise<void>} Resolves when loaded.
     */
    function load(bust = false) {
        loadPromise = (async () => {
            const [langs, kbs, ...tables] = await Promise.all(
                ["languages.csv", "keyboards.csv"].concat(CONFIG.files).map(f => fetchText(f, bust))
            );
            if (langs) {
                engine.setLanguagesCsv(langs);
            }
            if (kbs) {
                engine.setKeyboardsCsv(kbs);
            }
            engine.clear();
            tables.forEach((text, i) => {
                if (text !== null) {
                    engine.addCsv(text, CONFIG.files[i]);
                } else if (debugOn()) {
                    console.warn(`[PokeMZ.L10n] could not load data/locales/${CONFIG.files[i]}`);
                }
            });
            if (debugOn() && engine.duplicates.length) {
                for (const d of engine.duplicates) {
                    console.warn(`[PokeMZ.L10n] duplicate key "${d.key}" in ${d.file}:${d.line} (first in ${d.first})`);
                }
            }
            L10n.ready = true;
            loadFonts();
        })();
        return loadPromise;
    }

    /** @brief Registers the per-language fonts from languages.csv ("Font"). */
    function loadFonts() {
        for (const lang of engine.languages()) {
            const font = engine.meta[lang] && engine.meta[lang].font;
            if (font) {
                FontManager.load(`pmz-locale-${lang}`, font);
            }
        }
    }

    /** @return {string} CSS font family for the current language, or "". */
    function localeFontFamily() {
        const lang = engine.chain().find(l => engine.meta[l] && engine.meta[l].font);
        return lang ? `pmz-locale-${lang}` : "";
    }

    //-------------------------------------------------------------------------
    // Language state
    //-------------------------------------------------------------------------

    ConfigManager.pokemzLanguage = "";

    /** @return {Array<string>} The system's preferred languages. */
    const systemLanguages = () => (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"]);

    /**
     * @brief Switches the language and refreshes everything showing text.
     * @param {string} code Language code, or "auto".
     * @param {Object} [o] {save = true: remember it in the config}.
     */
    function setLanguage(code, o = {}) {
        const lang = engine.resolve(code, systemLanguages());
        const changed = lang !== engine.language;
        engine.language = lang;
        if (o.save !== false) {
            ConfigManager.pokemzLanguage = code === "auto" ? "" : lang;
        }
        applyDocument();
        if (!changed) {
            return;
        }
        applyDatabase();
        const ui = UI();
        if (ui) {
            ui.strings.bump();
        }
        refreshScene();
        for (const fn of [...listeners]) {
            try {
                fn(lang);
            } catch (e) {
                console.error(e);
            }
        }
        if (debugOn()) {
            setTimeout(() => L10n.checkOverflow(), 600);
        }
    }

    /**
     * @brief Sets lang/dir on the page (inherited by the UI overlay, which
     *        makes the browser use the right line breaking and glyphs) and the
     *        locale font (CSS variable --pmz-locale-font).
     */
    function applyDocument() {
        const root = document.documentElement;
        root.lang = engine.intlTag();
        root.dir = engine.direction();
        const font = localeFontFamily();
        if (font) {
            root.style.setProperty("--pmz-locale-font", `"${font}", "pokemz-ui-font"`);
        } else {
            root.style.removeProperty("--pmz-locale-font");
        }
    }

    const _mainFontFace = Game_System.prototype.mainFontFace;
    Game_System.prototype.mainFontFace = function() {
        const font = localeFontFamily();
        const base = _mainFontFace.apply(this, arguments);
        return font ? `${font}, ${base}` : base;
    };

    /** @brief Redraws the MZ windows of the current scene. */
    function refreshScene() {
        const scene = SceneManager._scene;
        if (!scene) {
            return;
        }
        const visit = node => {
            if (node instanceof Window_Base) {
                try {
                    if (node instanceof Window_Command) {
                        const index = node.index();
                        node.refresh();
                        node.select(Math.min(index, node.maxItems() - 1));
                    } else if (typeof node.refresh === "function") {
                        node.refresh();
                    }
                } catch (e) {
                    // Some windows can't refresh outside their normal flow.
                }
            }
            for (const child of node.children || []) {
                visit(child);
            }
        };
        visit(scene);
    }

    UI_patchConfig();

    /** @brief Saves the chosen language in config.rmmzsave (not in saves). */
    function UI_patchConfig() {
        const makeData = ConfigManager.makeData;
        ConfigManager.makeData = function() {
            const config = makeData.apply(this, arguments);
            config.pokemzLanguage = this.pokemzLanguage;
            return config;
        };
        const applyData = ConfigManager.applyData;
        ConfigManager.applyData = function(config) {
            applyData.apply(this, arguments);
            this.pokemzLanguage = typeof config.pokemzLanguage === "string" ? config.pokemzLanguage : "";
        };
    }

    //-------------------------------------------------------------------------
    // Boot
    //-------------------------------------------------------------------------

    const _Scene_Boot_create = Scene_Boot.prototype.create;
    Scene_Boot.prototype.create = function() {
        _Scene_Boot_create.apply(this, arguments);
        if (!loadPromise) {
            load();
        }
    };

    const _Scene_Boot_isReady = Scene_Boot.prototype.isReady;
    Scene_Boot.prototype.isReady = function() {
        return _Scene_Boot_isReady.apply(this, arguments) && L10n.ready;
    };

    const _Scene_Boot_start = Scene_Boot.prototype.start;
    Scene_Boot.prototype.start = function() {
        stashDatabase();
        engine.language = engine.resolve(ConfigManager.pokemzLanguage || CONFIG.language, systemLanguages());
        applyDatabase();
        applyDocument();
        const ui = UI();
        if (ui) {
            ui.strings.bump();
        }
        _Scene_Boot_start.apply(this, arguments);
    };

    //-------------------------------------------------------------------------
    // \L[key] text code
    //-------------------------------------------------------------------------

    const L_CODE = /(^|[^\\])((?:\\\\)*)\\L\[([^\]\r\n]+)\]/gi;

    /**
     * @brief Replaces \L[key] with the key's text (recursively, up to 8
     *        levels, so a cycle can't hang the game).
     * @param {string} text Raw text.
     * @param {number} [depth] Current depth.
     * @return {string} Expanded text.
     */
    function expand(text, depth = 0) {
        const s = String(text);
        if (depth > 8 || s.indexOf("\\") < 0) {
            return s;
        }
        return s.replace(L_CODE, (m, pre, slashes, key) => {
            const raw = engine.get(key.trim());
            const value = raw === undefined ? `⟦${key}⟧` : engine.format(raw);
            return pre + slashes + expand(value, depth + 1);
        });
    }

    const _convertEscapeCharacters = Window_Base.prototype.convertEscapeCharacters;
    Window_Base.prototype.convertEscapeCharacters = function(text) {
        return _convertEscapeCharacters.call(this, expand(text));
    };

    //-------------------------------------------------------------------------
    // Database and system text (language-agnostic: stashed sources)
    //-------------------------------------------------------------------------

    const DB = [
        ["$dataActors", "Actor", ["name", "nickname", "profile"]],
        ["$dataClasses", "Class", ["name"]],
        ["$dataSkills", "Skill", ["name", "description", "message1", "message2"]],
        ["$dataItems", "Item", ["name", "description"]],
        ["$dataWeapons", "Weapon", ["name", "description"]],
        ["$dataArmors", "Armor", ["name", "description"]],
        ["$dataEnemies", "Enemy", ["name"]],
        ["$dataStates", "State", ["name", "message1", "message2", "message3", "message4"]],
    ];

    const capital = s => s[0].toUpperCase() + s.slice(1);
    const noteKey = note => {
        const m = /<L10n:\s*([^>\s]+)\s*>/i.exec(note || "");
        return m ? m[1] : null;
    };

    /** @brief Remembers the source text of database objects (once per load). */
    function stashDatabase() {
        for (const [global, type, fields] of DB) {
            const list = window[global];
            if (!Array.isArray(list)) {
                continue;
            }
            for (const obj of list) {
                if (obj && !obj._pmzSrc) {
                    obj._pmzSrc = {};
                    for (const f of fields) {
                        obj._pmzSrc[f] = obj[f];
                    }
                    obj._pmzKey = noteKey(obj.note) || `Db.${type}.${obj.id}`;
                }
            }
        }
        const sys = window.$dataSystem;
        if (sys && !sys._pmzSrc) {
            sys._pmzSrc = JSON.parse(
                JSON.stringify({
                    gameTitle: sys.gameTitle,
                    currencyUnit: sys.currencyUnit,
                    elements: sys.elements,
                    skillTypes: sys.skillTypes,
                    weaponTypes: sys.weaponTypes,
                    armorTypes: sys.armorTypes,
                    equipTypes: sys.equipTypes,
                    terms: sys.terms,
                })
            );
        }
    }

    /**
     * @brief Text for game-data text: a translation for the current
     *        language, or the source text from the game data.
     * @param {string} key Stable ID.
     * @param {string} source Source text.
     * @return {string} Text (raw, codes intact).
     */
    function dataText(key, source) {
        if (engine.language === "qps-keys") {
            return `⟦${key}⟧`;
        }
        const hit = engine.lookup(key, { noSource: true });
        const text = hit ? engine.format(hit.text, null, { raw: true }) : source;
        return engine.language === "qps-accent" && text ? pseudo(text) : text;
    }

    /** @brief Writes localized text into the database, system and map. */
    function applyDatabase() {
        for (const [global, , fields] of DB) {
            const list = window[global];
            if (!Array.isArray(list)) {
                continue;
            }
            for (const obj of list) {
                if (obj && obj._pmzSrc) {
                    for (const f of fields) {
                        if (typeof obj._pmzSrc[f] === "string" && (obj._pmzSrc[f] || f === "name")) {
                            obj[f] = dataText(`${obj._pmzKey}.${capital(f)}`, obj._pmzSrc[f]);
                        }
                    }
                }
            }
        }
        const sys = window.$dataSystem;
        if (sys && sys._pmzSrc) {
            const src = sys._pmzSrc;
            sys.gameTitle = dataText("System.GameTitle", src.gameTitle);
            sys.currencyUnit = dataText("System.CurrencyUnit", src.currencyUnit);
            for (const f of ["elements", "skillTypes", "weaponTypes", "armorTypes", "equipTypes"]) {
                sys[f] = src[f].map((v, i) => (v ? dataText(`System.${capital(f)}.${i}`, v) : v));
            }
            for (const f of ["basic", "commands", "params"]) {
                sys.terms[f] = src.terms[f].map((v, i) => (v ? dataText(`System.Terms.${capital(f)}.${i}`, v) : v));
            }
            for (const k of Object.keys(src.terms.messages)) {
                sys.terms.messages[k] = dataText(`System.Terms.Messages.${k}`, src.terms.messages[k]);
            }
            if (document.title !== sys.gameTitle && sys.gameTitle) {
                document.title = sys.gameTitle;
            }
        }
        applyMap();
    }

    /** @brief Localizes the current map's display name. */
    function applyMap() {
        const map = window.$dataMap;
        if (!map || map._pmzId === undefined) {
            return;
        }
        if (map._pmzSrcName === undefined) {
            map._pmzSrcName = map.displayName || "";
        }
        const key = noteKey(map.note) || `Map.${map._pmzId}`;
        if (map._pmzSrcName) {
            map.displayName = dataText(`${key}.DisplayName`, map._pmzSrcName);
        }
    }

    let loadingMapId = 0;
    const _loadMapData = DataManager.loadMapData;
    DataManager.loadMapData = function(mapId) {
        loadingMapId = mapId;
        _loadMapData.apply(this, arguments);
    };

    const _onLoad = DataManager.onLoad;
    DataManager.onLoad = function(object) {
        _onLoad.apply(this, arguments);
        if (object === window.$dataMap && object) {
            object._pmzId = loadingMapId;
            applyMap();
        }
    };

    //-------------------------------------------------------------------------
    // Actors: names follow the language until the player renames them
    //-------------------------------------------------------------------------

    for (const getter of ["name", "nickname", "profile"]) {
        const flag = `_pmzLoc${capital(getter)}`;
        const get = Game_Actor.prototype[getter];
        Game_Actor.prototype[getter] = function() {
            return this[flag] && this.actor() ? this.actor()[getter] : get.apply(this, arguments);
        };
        const setterName = `set${capital(getter)}`;
        const set = Game_Actor.prototype[setterName];
        Game_Actor.prototype[setterName] = function(value) {
            set.apply(this, arguments);
            this[flag] = false;
        };
    }

    const _Game_Actor_setup = Game_Actor.prototype.setup;
    Game_Actor.prototype.setup = function() {
        _Game_Actor_setup.apply(this, arguments);
        this._pmzLocName = true;
        this._pmzLocNickname = true;
        this._pmzLocProfile = true;
    };

    // Save file info: keep the source title, not the current translation.
    const _makeSavefileInfo = DataManager.makeSavefileInfo;
    DataManager.makeSavefileInfo = function() {
        const info = _makeSavefileInfo.apply(this, arguments);
        if ($dataSystem._pmzSrc) {
            info.title = $dataSystem._pmzSrc.gameTitle;
        }
        return info;
    };

    // Playtest: warn about translated text stored in variables.
    const _makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function() {
        const contents = _makeSaveContents.apply(this, arguments);
        if (debugOn() && engine.language !== engine.source) {
            const texts = new Set();
            for (const entry of engine.entries.values()) {
                const v = entry.values[engine.language];
                if (v && v.length > 2) {
                    texts.add(v);
                }
            }
            ($gameVariables._data || []).forEach((v, id) => {
                if (typeof v === "string" && texts.has(v)) {
                    console.warn(`[PokeMZ.L10n] variable ${id} holds translated text "${v}"; store an ID instead so saves work in every language.`);
                }
            });
        }
        return contents;
    };

    //-------------------------------------------------------------------------
    // Event dialogue: <L10n: Dlg.xxxx> comments
    //-------------------------------------------------------------------------

    /**
     * @brief Finds the <L10n: id> comment right above a command.
     * @param {Array} list Command list.
     * @param {number} index Index of the command.
     * @return {string|null} The ID.
     */
    function dialogueId(list, index) {
        let i = index - 1;
        const indent = list[index] ? list[index].indent : 0;
        const lines = [];
        while (i >= 0 && list[i] && list[i].code === 408 && list[i].indent === indent) {
            lines.unshift(list[i].parameters[0]);
            i--;
        }
        if (i < 0 || !list[i] || list[i].code !== 108 || list[i].indent !== indent) {
            return null;
        }
        lines.unshift(list[i].parameters[0]);
        return noteKey(lines.join("\n"));
    }

    /**
     * @brief Notes when the editor text no longer matches the extracted
     *        source (someone edited it without re-running extract).
     */
    function checkStale(id, editorText) {
        const entry = engine.entries.get(id);
        const src = entry && entry.values[engine.source];
        if (src !== undefined && src !== editorText) {
            staleDialogue.set(id, editorText);
        }
    }

    /**
     * @brief Replaces message lines with a translation, if there is one.
     * @param {string} id Dialogue ID.
     */
    function translateMessage(id) {
        const editorText = $gameMessage._texts.join("\n");
        checkStale(id, editorText);
        const text = dataText(id, editorText);
        if (text !== editorText) {
            $gameMessage._texts = text.split("\n");
        }
        if ($gameMessage._speakerName) {
            $gameMessage._speakerName = dataText(`${id}.Speaker`, $gameMessage._speakerName);
        }
    }

    const _command101 = Game_Interpreter.prototype.command101;
    Game_Interpreter.prototype.command101 = function() {
        const id = dialogueId(this._list, this._index);
        this._pmzDlgId = id;
        const result = _command101.apply(this, arguments);
        this._pmzDlgId = null;
        if (result && id) {
            translateMessage(id);
        }
        return result;
    };

    const _setupChoices = Game_Interpreter.prototype.setupChoices;
    Game_Interpreter.prototype.setupChoices = function() {
        const id = this._pmzDlgId || dialogueId(this._list, this._index);
        _setupChoices.apply(this, arguments);
        if (id) {
            $gameMessage._choices = $gameMessage._choices.map((c, i) => dataText(`${id}.Choice${i + 1}`, c));
        }
    };

    const _command105 = Game_Interpreter.prototype.command105;
    Game_Interpreter.prototype.command105 = function() {
        const id = dialogueId(this._list, this._index);
        const result = _command105.apply(this, arguments);
        if (result && id) {
            translateMessage(id);
        }
        return result;
    };

    //-------------------------------------------------------------------------
    // Word wrapping in MZ windows
    //-------------------------------------------------------------------------

    /**
     * @brief Wraps converted text to a window's width using its font.
     * @param {Window_Base} win The window.
     * @param {string} text Converted text.
     * @param {number} width Available width.
     * @return {string} Wrapped text.
     */
    function wrapForWindow(win, text, width) {
        win._pmzMeasuring = true;
        try {
            const measure = s => win.textSizeEx(s).width;
            return engine.wrap(text, width, measure);
        } finally {
            win._pmzMeasuring = false;
            win.resetFontSettings();
        }
    }

    /**
     * @brief Draws text with escape codes, wrapped to a width.
     * @param {string} text Raw text.
     * @param {number} x X.
     * @param {number} y Y.
     * @param {number} width Width.
     * @return {number} Width used.
     */
    Window_Base.prototype.drawTextWrapped = function(text, x, y, width) {
        this._pmzWrapWidth = width;
        const w = this.drawTextEx(text, x, y, width);
        this._pmzWrapWidth = 0;
        return w;
    };

    const _createTextState = Window_Base.prototype.createTextState;
    Window_Base.prototype.createTextState = function(text, x, y, width) {
        const state = _createTextState.apply(this, arguments);
        if (this._pmzMeasuring) {
            return state;
        }
        let avail = this._pmzWrapWidth || 0;
        if (!avail && CONFIG.autoWrap && this._pmzAutoWrap) {
            avail = this instanceof Window_Message ? this.innerWidth - this.newLineX(state) : width || this.innerWidth - x;
        }
        if (avail > 0) {
            state.text = wrapForWindow(this, state.text, avail);
        }
        return state;
    };

    for (const cls of [Window_Message, Window_Help, Window_ScrollText]) {
        cls.prototype._pmzAutoWrap = true;
    }

    //-------------------------------------------------------------------------
    // Name entry keyboards
    //-------------------------------------------------------------------------

    let physicalLayout = null;

    /** @brief Reads the player's physical keyboard layout, if possible. */
    function detectPhysicalLayout() {
        if (!CONFIG.mirrorKeyboard || !navigator.keyboard || !navigator.keyboard.getLayoutMap) {
            return;
        }
        navigator.keyboard
            .getLayoutMap()
            .then(map => {
                const row = codes => codes.map(c => map.get(c) || "").join("");
                physicalLayout = [
                    row(["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft"]),
                    row(["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote"]),
                    row(["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma"]),
                ].map(r => [...r].filter(ch => /\p{L}/u.test(ch)).join(""));
                const ui = UI();
                if (ui) {
                    ui.strings.bump();
                }
            })
            .catch(() => {});
    }

    /**
     * @brief Keyboard pages for name entry in the current language: the
     *        language's layout from keyboards.csv, with its first two (letter)
     *        pages rearranged to match the physical keyboard when the
     *        physical layout has the same letters (e.g. AZERTY vs QWERTY).
     * @return {Array<{label: string, rows: Array<Array<string>>}>|null} Pages,
     *         or null when keyboards.csv has nothing for this language.
     */
    function keyboardPages() {
        const lang = engine.chain().find(l => engine.meta[l] && engine.meta[l].keyboard && engine.layouts[engine.meta[l].keyboard]);
        if (!lang) {
            return null;
        }
        const tag = engine.intlTag();
        const pages = engine.layouts[engine.meta[lang].keyboard].map(p => ({
            label: engine.language === "qps-accent" ? pseudo(p.label) : p.label,
            rows: p.rows.map(r => graphemes(r, tag).filter(g => g !== " ")),
        }));
        if (physicalLayout && pages.length >= 2 && engine.meta[lang].mirror !== "false") {
            const physical = physicalLayout.map(r => graphemes(r, tag));
            const letters = new Set(physical.flat().map(c => c.toLocaleLowerCase(tag)));
            const pageLetters = new Set(
                pages[1].rows
                    .flat()
                    .filter(c => /\p{L}/u.test(c))
                    .map(c => c.toLocaleLowerCase(tag))
            );
            const sameSet = letters.size >= 20 && [...letters].every(c => pageLetters.has(c)) && pageLetters.size - letters.size <= 8;
            if (sameSet) {
                const extras = pageRowsExtras(pages[1].rows, letters, tag);
                pages[1] = { label: pages[1].label, rows: physical.map(r => r.map(c => c.toLocaleLowerCase(tag))).concat(extras.length ? [extras] : []) };
                pages[0] = { label: pages[0].label, rows: pages[1].rows.map(r => r.map(c => c.toLocaleUpperCase(tag))) };
            }
        }
        return pages;
    }

    /** @brief Keys of a page that the physical rows don't cover (kept in a final row). */
    function pageRowsExtras(rows, letters, tag) {
        return rows.flat().filter(c => !letters.has(c.toLocaleLowerCase(tag)));
    }

    //-------------------------------------------------------------------------
    // Options: Language
    //-------------------------------------------------------------------------

    const LANGUAGE = "pokemzLanguage";

    /** @return {Array<string>} Languages offered in Options. */
    function optionLanguages() {
        return engine.languages().concat(debugOn() ? PSEUDO_LOCALES : []);
    }

    /** @return {string} Native name of a language. */
    function languageName(lang) {
        const m = engine.meta[lang];
        return (m && m.name) || lang;
    }

    if (CONFIG.showOption) {
        const _addGeneralOptions = Window_Options.prototype.addGeneralOptions;
        Window_Options.prototype.addGeneralOptions = function() {
            const label = engine.has("UI.Options.Language") ? engine.t("UI.Options.Language") : "Language";
            this.addCommand(label, LANGUAGE);
            _addGeneralOptions.apply(this, arguments);
        };

        const _statusText = Window_Options.prototype.statusText;
        Window_Options.prototype.statusText = function(index) {
            return this.commandSymbol(index) === LANGUAGE ? languageName(engine.language) : _statusText.apply(this, arguments);
        };

        const cycle = (win, delta) => {
            const list = optionLanguages();
            const i = list.indexOf(engine.language);
            const next = list[(i + delta + list.length) % list.length];
            SoundManager.playCursor();
            setLanguage(next);
            ConfigManager.save();
            win.refresh();
        };

        for (const [name, delta] of [
            ["processOk", 1],
            ["cursorRight", 1],
            ["cursorLeft", -1],
        ]) {
            const orig = Window_Options.prototype[name];
            Window_Options.prototype[name] = function() {
                if (this.commandSymbol(this.index()) === LANGUAGE) {
                    cycle(this, delta);
                } else {
                    orig.apply(this, arguments);
                }
            };
        }

        const _maxCommands = Scene_Options.prototype.maxCommands;
        Scene_Options.prototype.maxCommands = function() {
            return _maxCommands.apply(this, arguments) + 1;
        };
    }

    PluginManager.registerCommand(PLUGIN_NAME, "setLanguage", args => {
        setLanguage(String(args.language || CONFIG.sourceLanguage));
        ConfigManager.save();
    });

    //-------------------------------------------------------------------------
    // Debug tooling (playtest)
    //-------------------------------------------------------------------------

    /** @brief F7 cycles languages; Shift+F7 returns to the source language. */
    function installDebugKeys() {
        document.addEventListener("keydown", e => {
            if (e.keyCode !== 118 || e.ctrlKey || e.altKey) {
                return;
            }
            e.preventDefault();
            if (e.shiftKey) {
                setLanguage(engine.source);
            } else {
                const list = optionLanguages();
                setLanguage(list[(list.indexOf(engine.language) + 1) % list.length]);
            }
            const ui = UI();
            const msg = `Language: ${languageName(engine.language)} (${engine.language})`;
            if (ui && ui.toast) {
                ui.toast(msg, 90);
            } else {
                console.info(`[PokeMZ.L10n] ${msg}`);
            }
        });
    }

    /**
     * @brief Text of an entry list for report(): "lang: key (n)".
     * @param {Map} map Counter map.
     * @return {Array<Object>} Rows.
     */
    function counterRows(map) {
        return [...map].map(([id, n]) => {
            const [lang, key] = id.split("\u0000");
            return { lang, key, hits: n };
        });
    }

    //-------------------------------------------------------------------------
    // Public API
    //-------------------------------------------------------------------------

    const L10n = {
        engine,
        Engine,
        config: CONFIG,
        ready: false,

        get language() {
            return engine.language;
        },
        languages: () => engine.languages(),
        languageName,
        intlTag: lang => engine.intlTag(lang),
        direction: lang => engine.direction(lang),
        setLanguage,
        load,

        /**
         * @brief Calls fn(lang) after each language change.
         * @param {function(string)} fn Listener.
         * @return {function()} Unsubscribes.
         */
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },

        has: key => engine.has(key),
        get: key => engine.get(key),
        t: (key, args, fallback) => engine.t(key, args, fallback),
        format: (pattern, args) => engine.format(pattern, args),
        expand,
        protect,
        escapeCodes,

        formatNumber: (n, options) => engine.formatNumber(n, options),
        formatPercent: (ratio, digits) => engine.formatPercent(ratio, digits),
        formatDate: (d, options) => engine.formatDate(d, options),
        formatTime: d => engine.formatDate(d, { timeStyle: "short" }),
        formatList: (items, type) => engine.formatList(items, type),
        formatRelative: (v, unit) => engine.formatRelative(v, unit),
        formatPlayTime: s => engine.formatPlayTime(s),
        /**
         * @brief Formats money with the currency unit, following the
         *        UI.Format.Currency pattern ({amount} and {unit}) of the language.
         * @param {number} amount Amount.
         * @return {string} Text.
         */
        formatCurrency(amount) {
            const unit = window.TextManager ? TextManager.currencyUnit : "";
            const pattern = engine.get("UI.Format.Currency") || "{amount, number} {unit}";
            return engine.format(pattern, { amount: Number(amount), unit });
        },
        compare: (a, b) => engine.compare(a, b),
        sortBy: (list, keyFn) => engine.sortBy(list, keyFn),

        graphemes: text => engine.graphemes(text),
        wrap: (text, width, measure) => engine.wrap(text, width, measure),
        keyboardPages,

        /**
         * @brief Prints missing strings, fallback hits, stale dialogue and
         *        table problems to the console.
         * @return {Object} The same data.
         */
        report() {
            const result = engine.check();
            const data = {
                language: engine.language,
                missing: counterRows(engine.missing),
                fallbacks: counterRows(engine.fallbackHits),
                staleDialogue: [...staleDialogue].map(([id, text]) => ({ id, editorText: text })),
                errors: result.errors,
                warnings: result.warnings,
                coverage: engine.stats(),
                unusedThisSession: [...engine.entries.keys()].filter(k => !engine.used.has(k)).length,
            };
            console.group("[PokeMZ.L10n] report");
            console.table(data.missing);
            console.table(data.fallbacks);
            console.table(data.staleDialogue);
            data.errors.forEach(e => console.error(e));
            data.warnings.forEach(w => console.warn(w));
            console.table(data.coverage);
            console.groupEnd();
            return data;
        },

        /**
         * @brief Outlines UI text that doesn't fit its box (playtest).
         * @return {Array<Element>} Overflowing elements.
         */
        checkOverflow() {
            const root = document.getElementById("pokemz-ui");
            if (!root) {
                return [];
            }
            const bad = [];
            for (const el of root.querySelectorAll(".pmz-l10n-overflow")) {
                el.classList.remove("pmz-l10n-overflow");
            }
            for (const el of root.querySelectorAll("*")) {
                if (!el.firstChild || el.children.length > 2 || !el.textContent.trim()) {
                    continue;
                }
                if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") {
                    el.classList.add("pmz-l10n-overflow");
                    bad.push(el);
                }
            }
            if (bad.length) {
                console.warn(`[PokeMZ.L10n] ${bad.length} text element(s) overflow in ${engine.language}:`, bad.map(e => e.textContent.trim()));
            }
            return bad;
        },
    };

    window.PokeMZ = window.PokeMZ || {};
    window.PokeMZ.L10n = L10n;

    //-------------------------------------------------------------------------
    // Hook into PokeMZ_UI_Core's string table
    //-------------------------------------------------------------------------

    const ui = UI();
    if (ui && ui.strings && ui.strings.setProvider) {
        ui.strings.setProvider({
            get: key => engine.get(key),
            has: key => engine.has(key),
            format: (text, args) => engine.format(text, args),
            setLanguage: lang => setLanguage(lang),
            get language() {
                return engine.language;
            },
            load: done => (loadPromise && !L10n.ready ? loadPromise : load(L10n.ready)).then(() => (done ? done() : undefined)),
            isReady: () => L10n.ready,
            expand,
        });
    }

    detectPhysicalLayout();
    if (debugOn()) {
        installDebugKeys();
    }
})();
