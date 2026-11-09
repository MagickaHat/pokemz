#!/usr/bin/env node
//=============================================================================
// PokéMZ - tools/sprites.js
//=============================================================================

/**
 * @file Pokémon sprite formatter and palette harmonizer (Node).
 *
 *   node tools/sprites.js build   [--only a,b] [--dry-run] [--force]
 *        [--fix-dupes] [--tolerance n] [--ow-frame WxH] [--pbs]
 *        Rewrite img/pokemon/ in place: every sprite of a folder becomes a
 *        4bpp indexed PNG on the folder's normal.pal (15-bit colors, index
 *        0 transparent), canvases are padded / cropped to their size, and
 *        palettes are padded to 16. Unchanged folders are skipped (cache).
 *   node tools/sprites.js check   [--only a,b] [--pbs]
 *        Validate without writing; exit 1 on errors (folders that still
 *        need a build count as errors).
 *   node tools/sprites.js preview [--only a,b] [--scale n]
 *        Contact sheet (normal + shiny of every sprite, palettes, issues):
 *        tools/.cache/sprites/preview/index.html
 *   node tools/sprites.js watch   [build options] [--preview]
 *        Build, then rebuild each folder when its files change.
 *
 * Options: --root <dir> (game folder, default: ../game), --report <file>
 * (JSON issue list), --json (JSON report on stdout), --verbose (show info
 * lines), --no-cache.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PNG = require("./lib/png.js");
const Sprites = require("./lib/sprites.js");

const CACHE_DIR = path.join(__dirname, ".cache", "sprites");

/** @brief Files the tool reads in a unit folder. */
const KNOWN = new Set([...Object.keys(Sprites.VIEWS), "normal.pal", "shiny.pal"]);

//-----------------------------------------------------------------------------
// Scanning
//-----------------------------------------------------------------------------

/**
 * @brief Lists the units (folders holding sprites or palettes) under the
 *        graphics folder, parents before their sub-folders.
 * @param {string} dir img/pokemon folder.
 * @return {Array<string>} Unit ids ("sylveon", "raichu/alola").
 */
function scanUnits(dir) {
    const out = [];
    /** @brief Recursive walk. */
    const walk = rel => {
        const abs = path.join(dir, rel);
        let entries;
        try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch {
            return;
        }
        if (rel && entries.some(e => e.isFile() && /\.(png|pal)$/i.test(e.name))) {
            out.push(rel.split(path.sep).join("/"));
        }
        for (const e of entries.filter(x => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
            walk(rel ? path.join(rel, e.name) : e.name);
        }
    };
    walk("");
    return out;
}

/**
 * @brief Stats the files of a unit (skipping sub-folders).
 * @param {string} abs Unit folder.
 * @return {Object<string, {size: number, mtimeMs: number}>} Name -> stat.
 */
function statUnit(abs) {
    const out = {};
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        if (e.isFile()) {
            const st = fs.statSync(path.join(abs, e.name));
            out[e.name] = { size: st.size, mtimeMs: st.mtimeMs };
        }
    }
    return out;
}

/**
 * @brief SHA-1 of a file.
 * @param {string} file Path.
 * @return {string} Hex digest.
 */
const sha1File = file => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");

/**
 * @brief Filters units by --only species ids (a species brings its forms).
 * @param {Array<string>} units Unit ids.
 * @param {?Set<string>} only Species ids.
 * @return {Array<string>} Kept ids.
 */
function filterUnits(units, only) {
    return only ? units.filter(u => only.has(u) || only.has(u.split("/")[0])) : units;
}

//-----------------------------------------------------------------------------
// Cache
//-----------------------------------------------------------------------------

/**
 * @brief Incremental build cache: per unit, the file stats/hashes after the
 *        last build and the issues it found. A unit whose files still match
 *        is skipped (its issues are reported from the cache).
 */
class BuildCache {
    /**
     * @brief Opens the cache of a graphics folder.
     * @param {string} dir img/pokemon folder.
     * @param {Object} o Build options (part of the cache key).
     * @param {boolean} enabled False: never skip, never save.
     */
    constructor(dir, o, enabled) {
        const id = crypto.createHash("sha1").update(path.resolve(dir)).digest("hex").slice(0, 12);
        this.file = path.join(o.cacheDir || CACHE_DIR, `build-${id}.json`);
        this.stamp = crypto
            .createHash("sha1")
            .update(JSON.stringify([Sprites.VERSION, !!o.fixDupes, o.tolerance || 0, o.owFrame || null]))
            .digest("hex");
        this.enabled = enabled;
        this.data = { units: {} };
        this.dirty = false;
        if (enabled) {
            try {
                this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
            } catch {
                this.data = { units: {} };
            }
        }
    }

    /**
     * @brief Cached entry of a unit when its files did not change.
     * @param {string} id Unit id.
     * @param {string} abs Unit folder.
     * @return {?Object} Entry {stamp, files, issues}, null when stale.
     */
    fresh(id, abs) {
        const e = this.enabled && this.data.units[id];
        if (!e || e.stamp !== this.stamp) {
            return null;
        }
        const now = statUnit(abs);
        const names = Object.keys(now).filter(n => KNOWN.has(n) || /\.(png|pal)$/i.test(n));
        if (names.length !== Object.keys(e.files).length) {
            return null;
        }
        for (const n of names) {
            const old = e.files[n];
            if (!old || old.size !== now[n].size) {
                return null;
            }
            if (old.mtimeMs !== now[n].mtimeMs) {
                if (sha1File(path.join(abs, n)) !== old.sha1) {
                    return null;
                }
                old.mtimeMs = now[n].mtimeMs; // touched, not changed
                this.dirty = true;
            }
        }
        return e;
    }

    /**
     * @brief Records the current state of a unit.
     * @param {string} id Unit id.
     * @param {string} abs Unit folder.
     * @param {Array<Object>} issues Issues of the build.
     */
    store(id, abs, issues) {
        if (!this.enabled) {
            return;
        }
        const files = {};
        for (const [n, st] of Object.entries(statUnit(abs))) {
            if (KNOWN.has(n) || /\.(png|pal)$/i.test(n)) {
                files[n] = { ...st, sha1: sha1File(path.join(abs, n)) };
            }
        }
        this.data.units[id] = { stamp: this.stamp, files, issues };
        this.dirty = true;
    }

    /** @brief Writes the cache file when it changed. */
    save() {
        if (this.enabled && this.dirty) {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(this.file, JSON.stringify(this.data));
            this.dirty = false;
        }
    }
}

//-----------------------------------------------------------------------------
// Building
//-----------------------------------------------------------------------------

/**
 * @brief Reads the files of a unit the engine needs.
 * @param {string} abs Unit folder.
 * @return {Object<string, Buffer>} Name -> bytes.
 */
function readUnit(abs) {
    const files = {};
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        if (e.isFile() && (KNOWN.has(e.name) || /\.(png|pal)$/i.test(e.name))) {
            files[e.name] = fs.readFileSync(path.join(abs, e.name));
        }
    }
    return files;
}

/**
 * @brief Palettes of a form's base species, read from disk.
 * @param {string} dir img/pokemon folder.
 * @param {string} id Unit id ("raichu/alola").
 * @return {?{normal, shiny, count}} Palettes (normalized), null if none.
 */
function basePalettes(dir, id) {
    if (!id.includes("/")) {
        return null;
    }
    const base = path.join(dir, id.split("/")[0]);
    try {
        const raw = Sprites.parsePal(fs.readFileSync(path.join(base, "normal.pal"), "utf8"));
        const normal = Sprites.normalizePalette(raw).pal;
        let shiny = null;
        try {
            shiny = Sprites.normalizePalette(Sprites.parsePal(fs.readFileSync(path.join(base, "shiny.pal"), "utf8"))).pal;
        } catch {
            shiny = null;
        }
        return { normal, shiny, count: raw.length };
    } catch {
        return null;
    }
}

/**
 * @brief Builds (or checks) units.
 * @param {string} root Game folder.
 * @param {Object} o Options.
 * @param {Array<string>} [o.units] Unit ids (default: every unit, --only).
 * @param {boolean} [o.write] Write files (build) or only report (check).
 * @param {boolean} [o.force] Ignore the cache.
 * @param {boolean} [o.noCache] Neither read nor write the cache.
 * @param {string} [o.cacheDir] Cache folder (default tools/.cache/sprites).
 * @return {{units: Array<Object>, written: number, skipped: number}}
 *         Per unit {id, issues, skipped, written: [files], result}.
 */
function build(root, o = {}) {
    const dir = path.join(root, "img", "pokemon");
    const ids = o.units || filterUnits(scanUnits(dir), o.only);
    const cache = new BuildCache(dir, o, !o.noCache);
    const out = { units: [], written: 0, skipped: 0 };
    for (const id of ids) {
        const abs = path.join(dir, ...id.split("/"));
        if (!fs.existsSync(abs)) {
            continue;
        }
        const cached = o.force ? null : cache.fresh(id, abs);
        if (cached) {
            out.skipped++;
            out.units.push({ id, issues: cached.issues, skipped: true, written: [], result: null });
            continue;
        }
        const files = readUnit(abs);
        const result = Sprites.processUnit({ id, files, base: basePalettes(dir, id) }, o);
        const issues = result.issues.slice();
        const pending = Object.keys(result.outputs);
        const written = [];
        if (o.write && result.ok && !o.dryRun) {
            for (const name of pending) {
                fs.writeFileSync(path.join(abs, name), result.outputs[name]);
                written.push(name);
            }
            cache.store(id, abs, issues);
        } else if (pending.length) {
            issues.push({
                level: o.write && !o.dryRun ? "info" : "error",
                code: "needs-build",
                message: `would rewrite ${pending.join(", ")}${o.write && !o.dryRun ? " (not written: fix the errors first)" : ""}`,
                file: null
            });
        } else if (result.ok && !o.dryRun) {
            cache.store(id, abs, issues);
        }
        if (written.length) {
            out.written++;
        }
        out.units.push({ id, issues, skipped: false, written, result });
    }
    cache.save();
    return out;
}

/**
 * @brief Cross-checks folders against the PBS species and forms.
 * @param {string} root Game folder.
 * @param {Array<string>} ids Unit ids.
 * @return {Promise<Array<Object>>} Issues ({unit, level, code, message}).
 */
async function pbsIssues(root, ids) {
    const { loadAll } = require("./pbs.js");
    const { registries } = await loadAll(root);
    const species = new Set();
    const forms = new Set();
    for (const s of registries.species || []) {
        if (s.baseSpecies) {
            forms.add(`${s.baseSpecies}/${s.folder || s.id}`);
        } else {
            species.add(s.id);
        }
    }
    const out = [];
    for (const id of ids) {
        const kind = Sprites.unitKind(id);
        if (kind === "species" && !species.has(id)) {
            out.push({ unit: id, level: "warn", code: "orphan-folder", message: "no PBS species with this id", file: null });
        } else if (kind === "form" && !forms.has(id)) {
            out.push({ unit: id, level: "warn", code: "orphan-folder", message: "no PBS form uses this folder", file: null });
        }
    }
    return out;
}

//-----------------------------------------------------------------------------
// Report
//-----------------------------------------------------------------------------

/**
 * @brief Flattens build results into a report.
 * @param {Object} res Result of build().
 * @param {Array<Object>} [extra] More issues (PBS cross-check).
 * @return {{summary: Object, issues: Array<Object>}} Report.
 */
function makeReport(res, extra = []) {
    const issues = [];
    for (const u of res.units) {
        for (const i of u.issues) {
            issues.push({ unit: u.id, ...i });
        }
    }
    issues.push(...extra);
    const count = l => issues.filter(i => i.level === l).length;
    return {
        summary: {
            units: res.units.length,
            skipped: res.skipped,
            written: res.written,
            errors: count("error"),
            warnings: count("warn"),
            info: count("info")
        },
        issues
    };
}

/**
 * @brief Prints a report grouped by unit.
 * @param {Object} report Report of makeReport().
 * @param {Object} res Result of build() (written files).
 * @param {boolean} verbose Also print info lines.
 */
function printReport(report, res, verbose) {
    const byUnit = new Map();
    for (const i of report.issues) {
        if (i.level === "info" && !verbose) {
            continue;
        }
        if (!byUnit.has(i.unit)) {
            byUnit.set(i.unit, []);
        }
        byUnit.get(i.unit).push(i);
    }
    const tag = { error: "ERROR", warn: "warn ", info: "info " };
    for (const u of res.units) {
        if (u.written.length) {
            console.log(`${u.id}: wrote ${u.written.join(", ")}`);
        }
    }
    for (const [unit, list] of byUnit) {
        console.log(`${unit}/`);
        for (const i of list) {
            console.log(`  ${tag[i.level]} ${i.file ? i.file + ": " : ""}${i.message} [${i.code}]`);
        }
    }
    const s = report.summary;
    console.log(
        `${s.units} folder(s): ${s.written} rewritten, ${s.skipped} unchanged (cached); ` +
            `${s.errors} error(s), ${s.warnings} warning(s)`
    );
}

//-----------------------------------------------------------------------------
// Contact sheet
//-----------------------------------------------------------------------------

/**
 * @brief Escapes HTML text.
 * @param {string} s Text.
 * @return {string} Escaped text.
 */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * @brief Writes the contact sheet: per unit, every sprite in normal and
 *        shiny colors, both palettes and the validation issues. Preview
 *        images are cached per unit (regenerated when its files change).
 * @param {string} root Game folder.
 * @param {Object} o Options (only, scale, plus build options).
 * @return {string} Path of index.html.
 */
function preview(root, o = {}) {
    const dir = path.join(root, "img", "pokemon");
    const outDir = path.join(CACHE_DIR, "preview");
    const imgDir = path.join(outDir, "img");
    fs.rmSync(imgDir, { recursive: true, force: true });
    fs.mkdirSync(imgDir, { recursive: true });
    const ids = filterUnits(scanUnits(dir), o.only);
    const res = build(root, { ...o, units: ids, write: false, noCache: true });
    const report = makeReport(res);
    const scale = o.scale || 2;
    const trns = [0, ...new Array(15).fill(255)];
    const cards = [];
    for (const u of res.units) {
        const r = u.result;
        const key = crypto.createHash("sha1").update(u.id).digest("hex").slice(0, 10);
        const issues = report.issues.filter(i => i.unit === u.id && i.level !== "info");
        const level = issues.some(i => i.level === "error") ? "error" : issues.length ? "warn" : "ok";
        const rows = [];
        for (const [label, pal] of [
            ["normal", r.normal],
            ["shiny", r.shiny]
        ]) {
            if (!pal) {
                continue;
            }
            const cells = [];
            for (const [name, img] of Object.entries(r.sprites)) {
                const file = `${key}-${name.replace(".png", "")}-${label}.png`;
                fs.writeFileSync(path.join(imgDir, file), PNG.encodeIndexed({ ...img, palette: pal }, { trns }));
                cells.push(
                    `<figure><img src="img/${file}" width="${img.width * scale}" height="${img.height * scale}" alt="${esc(name)}"><figcaption>${esc(name)}</figcaption></figure>`
                );
            }
            const swatches = pal
                .map((c, i) => `<i title="${i}: ${c.join(" ")}" style="background:rgb(${c.join(",")})"></i>`)
                .join("");
            rows.push(`<div class="row"><b>${label}</b><div class="pal">${swatches}</div>${cells.join("")}</div>`);
        }
        const list = issues.map(i => `<li class="${i.level}">${esc(i.file ? i.file + ": " : "")}${esc(i.message)}</li>`);
        cards.push(
            `<section class="card ${level}" data-id="${esc(u.id)}"><h2>${esc(u.id)}</h2>${rows.join("")}` +
                (list.length ? `<ul>${list.join("")}</ul>` : "") +
                `</section>`
        );
    }
    const s = report.summary;
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sprite Contact Sheet</title>
<style>
:root{--bg:#f4f4f6;--card:#fff;--fg:#1c1c22;--muted:#666;--err:#c62828;--warn:#b26a00;--chk:#e6e6ea}
@media (prefers-color-scheme:dark){:root{--bg:#141418;--card:#1f1f26;--fg:#eee;--muted:#999;--err:#ff6b6b;--warn:#ffb74d;--chk:#2a2a33}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif}
header{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
h1{font-size:18px;margin:0}input[type=search]{padding:4px 8px}
.card{background:var(--card);border-radius:8px;padding:8px 12px;margin-bottom:12px;border-left:4px solid transparent}
.card.error{border-left-color:var(--err)}.card.warn{border-left-color:var(--warn)}
h2{font-size:15px;margin:4px 0 8px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:6px}
.row>b{width:48px;color:var(--muted);font-weight:500}
figure{margin:0;text-align:center}figcaption{font-size:11px;color:var(--muted)}
img{image-rendering:pixelated;background:repeating-conic-gradient(var(--chk) 0 25%,transparent 0 50%) 0 0/16px 16px}
.pal{display:grid;grid-template-columns:repeat(8,12px);gap:1px;align-self:center}
.pal i{width:12px;height:12px;display:block;outline:1px solid #8884}
ul{margin:4px 0;padding-left:20px}li.error{color:var(--err)}li.warn{color:var(--warn)}
body.only-bad .card.ok{display:none}
</style></head><body>
<header><h1>Sprite contact sheet</h1>
<span>${s.units} folders · ${s.errors} errors · ${s.warnings} warnings</span>
<input type="search" id="q" placeholder="Filter species">
<label><input type="checkbox" id="bad"> Problems only</label></header>
${cards.join("\n")}
<script>
const q=document.getElementById("q"),bad=document.getElementById("bad");
q.oninput=()=>{for(const c of document.querySelectorAll(".card"))c.hidden=!c.dataset.id.includes(q.value.toLowerCase())};
bad.onchange=()=>document.body.classList.toggle("only-bad",bad.checked);
</script></body></html>
`;
    const file = path.join(outDir, "index.html");
    fs.writeFileSync(file, html);
    return file;
}

//-----------------------------------------------------------------------------
// Watch
//-----------------------------------------------------------------------------

/**
 * @brief Builds, then rebuilds folders as their files change.
 * @param {string} root Game folder.
 * @param {Object} o Build options (preview: refresh the contact sheet).
 * @return {fs.FSWatcher} Watcher (close it to stop).
 */
function watch(root, o = {}) {
    const dir = path.join(root, "img", "pokemon");
    const run = units => {
        const res = build(root, { ...o, units, write: true });
        const changed = { ...res, units: res.units.filter(u => !u.skipped) };
        if (changed.units.length) {
            printReport(makeReport(changed), changed, o.verbose);
            if (o.preview) {
                console.log(`preview: ${preview(root, o)}`);
            }
        }
    };
    run(undefined);
    console.log(`Watching ${dir} (Ctrl+C to stop)`);
    const pending = new Set();
    let timer = null;
    const watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
        if (!filename || !/\.(png|pal)$/i.test(filename)) {
            return;
        }
        const unit = path.dirname(filename).split(path.sep).join("/");
        if (unit === ".") {
            return;
        }
        pending.add(unit);
        // A changed base palette may change forms that inherit it.
        for (const u of scanUnits(dir)) {
            if (u.startsWith(`${unit}/`)) {
                pending.add(u);
            }
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
            const units = [...pending].sort();
            pending.clear();
            try {
                run(units);
            } catch (e) {
                console.error(e.message || e);
            }
        }, 300);
    });
    return watcher;
}

//-----------------------------------------------------------------------------
// CLI
//-----------------------------------------------------------------------------

/**
 * @brief Parses command line options.
 * @param {Array<string>} args Arguments after the command.
 * @return {Object} Options.
 * @throws {Error} On malformed values.
 */
function parseArgs(args) {
    const val = name => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const o = {
        root: path.resolve(val("--root") || path.join(__dirname, "..", "game")),
        only: val("--only") ? new Set(val("--only").split(",").map(s => s.trim())) : null,
        dryRun: args.includes("--dry-run"),
        force: args.includes("--force"),
        noCache: args.includes("--no-cache"),
        fixDupes: args.includes("--fix-dupes"),
        tolerance: Number(val("--tolerance") || 0),
        owFrame: null,
        pbs: args.includes("--pbs"),
        json: args.includes("--json"),
        report: val("--report"),
        verbose: args.includes("--verbose"),
        preview: args.includes("--preview"),
        scale: Number(val("--scale") || 2)
    };
    if (!Number.isFinite(o.tolerance) || o.tolerance < 0) {
        throw new Error("--tolerance must be a number >= 0");
    }
    if (val("--ow-frame")) {
        const m = /^(\d+)x(\d+)$/.exec(val("--ow-frame"));
        if (!m) {
            throw new Error("--ow-frame must look like 32x32");
        }
        o.owFrame = [Number(m[1]), Number(m[2])];
    }
    return o;
}

/**
 * @brief Runs build/check with report output.
 * @param {Object} o Options.
 * @param {boolean} write Build (true) or check (false).
 * @return {Promise<number>} Exit code.
 */
async function runBuild(o, write) {
    const res = build(o.root, { ...o, write });
    const extra = o.pbs ? await pbsIssues(o.root, res.units.map(u => u.id)) : [];
    const report = makeReport(res, extra);
    if (o.report) {
        fs.writeFileSync(o.report, JSON.stringify(report, null, 2) + "\n");
    }
    if (o.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        printReport(report, res, o.verbose);
    }
    return report.summary.errors ? 1 : 0;
}

/**
 * @brief Command line entry point.
 * @param {Array<string>} argv process.argv.
 * @return {Promise<number>} Exit code.
 */
async function main(argv) {
    const args = argv.slice(2);
    const cmd = args[0];
    const o = parseArgs(args.slice(1));
    switch (cmd) {
        case "build":
            return runBuild(o, true);
        case "check":
            return runBuild(o, false);
        case "preview":
            console.log(preview(o.root, o));
            return 0;
        case "watch":
            watch(o.root, o);
            return new Promise(() => {}); // until Ctrl+C
        default:
            console.log(
                "Usage: node tools/sprites.js <build|check|preview|watch> [--root <game dir>] [--only a,b] " +
                    "[--dry-run] [--force] [--no-cache] [--fix-dupes] [--tolerance n] [--ow-frame WxH] [--pbs] " +
                    "[--json] [--report file] [--verbose] [--preview] [--scale n]"
            );
            return cmd ? 1 : 0;
    }
}

if (require.main === module) {
    main(process.argv).then(
        code => process.exit(code || 0),
        e => {
            console.error(e.message || e);
            process.exit(1);
        }
    );
}

module.exports = { scanUnits, build, makeReport, preview, watch, parseArgs, pbsIssues, BuildCache, main };
