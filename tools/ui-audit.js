#!/usr/bin/env node
//=============================================================================
// PokéMZ - Preact UI layout audit
//=============================================================================
//
// Opens every Preact screen in a headless Chromium at each game resolution,
// checks that nothing is off screen or clipped, and saves screenshots.
//
//   npm run ui:audit                    every screen, 256x192 and 320x240
//   npm run ui:audit -- --res 256x192   one resolution
//   npm run ui:audit -- --only battle   screens whose name contains "battle"
//
// Needs Playwright with Chromium (npm i -D playwright && npx playwright
// install chromium). Output goes to tools/ui-audit-out/ (screenshots and
// report.json). Exits with 1 when a screen has problems.

"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const GAME = path.join(__dirname, "..", "game");
const OUT = path.join(__dirname, "ui-audit-out");

/** @brief Game-pixel scale used for screenshots. */
const SCALE = 3;

/**
 * @brief The screens to check. `run` is evaluated in the page with the game
 *        on the map and the test party given; it must not wait for promises
 *        that only resolve on player input. `wait` is how long to let it
 *        settle (ms), `keys` are pressed afterwards.
 */
const SCENARIOS = [
    { name: "start-menu", run: () => SceneManager._scene.callMenu() },
    { name: "message", run: () => void PokeMZ.UI.message("Hello! This is a two-line test message for the message box.") },
    { name: "choices", run: () => void PokeMZ.UI.choose(["Yes", "No", "Maybe later"], { text: "Do you want to continue?" }) },
    { name: "number-input", run: () => void PokeMZ.UI.inputNumber(3, 25, { text: "How many?" }) },
    { name: "name-entry", run: () => void PokeMZ.UI.enterName({ actorId: 1, maxLength: 8 }), wait: 2000 },
    { name: "party", run: () => PokeMZ.UI.openScreen("party") },
    { name: "summary-info", run: () => void PokeMZ.PokemonUI.showSummary($gameParty.pokemon(), 0) },
    { name: "summary-memo", run: () => void PokeMZ.PokemonUI.showSummary($gameParty.pokemon(), 0), keys: ["ArrowRight"] },
    { name: "summary-skills", run: () => void PokeMZ.PokemonUI.showSummary($gameParty.pokemon(), 0), keys: ["ArrowRight", "ArrowRight"] },
    { name: "summary-ability", run: () => void PokeMZ.PokemonUI.showSummary($gameParty.pokemon(), 0), keys: ["ArrowRight", "ArrowRight", "ArrowRight"] },
    { name: "summary-moves", run: () => void PokeMZ.PokemonUI.showSummary($gameParty.pokemon(), 0), keys: ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight"] },
    { name: "summary-move-details", run: () => void PokeMZ.PokemonUI.showSummary($gameParty.pokemon(), 0), keys: ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "Enter"] },
    { name: "move-forget", run: () => void PokeMZ.PokemonUI.pickMove($gameParty.pokemon()[0], { extra: "tackle", title: "Forget which move?" }) },
    { name: "bag", run: () => PokeMZ.UI.openScreen("bag") },
    { name: "pokedex", run: () => PokeMZ.UI.openScreen("pokedex") },
    { name: "dex-entry", run: () => PokeMZ.UI.openScreen("pokedex"), keys: ["Enter"] },
    {
        name: "pc",
        run: () => {
            // A few Pokémon in box 1, so the grid and the info panel show.
            for (const id of ["bulbasaur", "charizard", "pikachu"]) {
                if (PokeMZ.PBS.species.has(id)) {
                    $gamePokemon.storage.deposit ? $gamePokemon.storage.deposit(new Game_Pokemon(id, 5)) : null;
                }
            }
            PokeMZ.UI.openScreen("pc");
        },
        wait: 2000,
    },
    { name: "move-reminder", run: () => PokeMZ.UI.openScreen("moveReminder") },
    { name: "day-care", run: () => PokeMZ.UI.openScreen("dayCare") },
    { name: "town-map", run: () => PokeMZ.UI.openScreen("townMap") },
    { name: "controls", run: () => PokeMZ.UI.openScreen("controls") },
    { name: "input-options", run: () => PokeMZ.UI.openScreen("inputOptions") },
    {
        name: "evolution",
        run: () => {
            const p = $gameParty.pokemon()[0];
            void PokeMZ.Pokemon.Flow.evolutionScene(p, "ivysaur");
        },
        wait: 2500,
    },
    { name: "battle-single", run: () => void PokeMZ.Battle.startWild("bulbasaur", 5), wait: 9000 },
    { name: "battle-moves", run: () => void PokeMZ.Battle.startWild("bulbasaur", 5), wait: 9000, keys: ["Enter"] },
    { name: "battle-double", run: () => void PokeMZ.Battle.startTrainer("twinsamyandmay"), wait: 11000, keys: ["Enter", "Enter", "Enter"] },
];

/**
 * @brief Runs in the page: lists layout problems inside the UI overlay.
 * @return {Array<Object>} Problems ({kind, text, cls, rect}).
 */
function inspect() {
    const root = document.querySelector("#pokemz-ui .pmz-root");
    if (!root) {
        return [{ kind: "no-overlay" }];
    }
    const box = root.getBoundingClientRect();
    const k = box.width / Graphics.width || 1;
    const problems = [];
    const label = el => (el.textContent || "").trim().slice(0, 40);
    const visible = el => {
        for (let e = el; e && e !== root; e = e.parentElement) {
            const cs = getComputedStyle(e);
            if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) {
                return false;
            }
        }
        return true;
    };
    for (const el of root.querySelectorAll("*")) {
        if (el.closest(".pmz-transition") && el.closest(".pmz-transition").getAnimations().length) {
            continue; // still animating in
        }
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || !visible(el)) {
            continue;
        }
        const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className);
        // The part actually drawn: clipped by every overflow ancestor (lists
        // that scroll, the battle field, ...).
        const vis = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
            const cs = getComputedStyle(a);
            if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
                const ar = a.getBoundingClientRect();
                vis.left = Math.max(vis.left, ar.left);
                vis.top = Math.max(vis.top, ar.top);
                vis.right = Math.min(vis.right, ar.right);
                vis.bottom = Math.min(vis.bottom, ar.bottom);
            }
        }
        if (vis.right - vis.left < 1 || vis.bottom - vis.top < 1) {
            continue; // scrolled out of view or fully clipped
        }
        const rect = [r.left - box.left, r.top - box.top, r.width, r.height].map(v => Math.round(v / k));
        // Off screen (1 game pixel of slack).
        if (vis.left < box.left - k || vis.top < box.top - k || vis.right > box.right + k || vis.bottom > box.bottom + k) {
            if (!/pmz-(touch|toast|transition)/.test(cls)) {
                problems.push({ kind: "offscreen", cls, text: label(el), rect });
            }
        }
        // Text clipped by its own box.
        if (el.firstChild && el.children.length <= 2 && el.textContent.trim()) {
            const cs = getComputedStyle(el);
            if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis") {
                problems.push({ kind: "clipped-x", cls, text: label(el), rect });
            }
            const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== "none"; // cut to N lines on purpose
            if (!clamped && el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== "visible" && cs.overflowY !== "auto" && cs.overflowY !== "scroll") {
                problems.push({ kind: "clipped-y", cls, text: label(el), rect });
            }
        }
        // A child sticking out of a panel.
        // (Panels that clip their content on purpose are skipped.)
        const parent = el.parentElement;
        if (
            parent &&
            parent.classList.contains("pmz-panel") &&
            getComputedStyle(parent).overflowX === "visible" &&
            !/pmz-pk-(battler|anchor|gimmick|icon)|pmz-keyboard-page/.test(cls)
        ) {
            const p = el.parentElement.getBoundingClientRect();
            if (r.bottom > p.bottom + k || r.right > p.right + k || r.left < p.left - k || r.top < p.top - k) {
                problems.push({ kind: "outside-panel", cls, text: label(el), rect, panel: String(el.parentElement.className) });
            }
        }
    }
    // Panels overlapping the help bar.
    const help = root.querySelector(".pmz-pk-help");
    if (help) {
        const h = help.getBoundingClientRect();
        for (const p of root.querySelectorAll(".pmz-panel")) {
            if (p === help || help.contains(p) || p.contains(help) || !visible(p) || p.closest(".pmz-pk-help")) {
                continue;
            }
            const r = p.getBoundingClientRect();
            if (r.bottom > h.top + k && r.top < h.bottom && r.right > h.left && r.left < h.right) {
                problems.push({ kind: "overlaps-help", cls: String(p.className), rect: [r.left, r.top, r.width, r.height].map(v => Math.round((v - 0) / k)) });
            }
        }
    }
    return problems;
}

/** @brief Serves the game folder. */
function serve() {
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".wasm": "application/wasm", ".ogg": "audio/ogg", ".woff": "font/woff", ".woff2": "font/woff2", ".csv": "text/csv" };
    const server = http.createServer((req, res) => {
        const file = path.join(GAME, decodeURIComponent(req.url.split("?")[0]));
        if (!file.startsWith(GAME) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404);
            res.end();
            return;
        }
        res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/**
 * @brief Boots the game to the map at a resolution, with the test party.
 * @return {Promise<import("playwright").Page>} The page.
 */
async function boot(browser, url, w, h) {
    const page = await browser.newPage({ viewport: { width: w * SCALE, height: h * SCALE }, deviceScaleFactor: 1 });
    page.on("pageerror", e => (page._errors = (page._errors || []).concat(String(e))));
    await page.goto(`${url}/index.html?test`);
    await page.waitForFunction(() => SceneManager._scene && SceneManager._scene.constructor.name === "Scene_Title" && SceneManager._scene.isReady(), null, { timeout: 30000 });
    await page.evaluate(([w, h]) => PokeMZ.Display.setResolution(w, h), [w, h]);
    await page.evaluate(() => {
        DataManager.setupNewGame();
        SceneManager.goto(Scene_Map);
    });
    await page.waitForFunction(() => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isStarted && SceneManager._scene.isStarted() && $gamePlayer, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        $gameSystem.disableEncounter(); // keys pressed by a scenario must not start a battle
        PokeMZ.Debug.giveParty();
        if (PokeMZ.Debug.giveItems) {
            PokeMZ.Debug.giveItems();
        }
        const dex = PokeMZ.Pokemon && PokeMZ.Pokemon.dex;
        for (const p of $gameParty.pokemon ? $gameParty.pokemon() : []) {
            if (dex && dex.register) {
                dex.register(p);
            }
        }
    });
    return page;
}

async function main() {
    const args = process.argv.slice(2);
    const opt = name => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : null;
    };
    let playwright;
    try {
        playwright = require("playwright");
    } catch (e) {
        console.error("ui-audit needs Playwright: npm i -D playwright && npx playwright install chromium");
        process.exit(2);
    }
    const resolutions = (opt("--res") || "256x192,320x240").split(",").map(r => r.split("x").map(Number));
    const only = opt("--only");
    const scenarios = SCENARIOS.filter(s => !only || s.name.includes(only));
    fs.mkdirSync(OUT, { recursive: true });
    const server = await serve();
    const url = `http://127.0.0.1:${server.address().port}`;
    const browser = await playwright.chromium.launch();
    const report = {};
    let failed = 0;
    try {
        for (const [w, h] of resolutions) {
            const key = `${w}x${h}`;
            report[key] = {};
            // A few pages at once: every scenario boots a fresh game.
            const queue = scenarios.slice();
            const worker = async () => {
                for (let s = queue.shift(); s; s = queue.shift()) {
                    const page = await boot(browser, url, w, h);
                    try {
                        await page.evaluate(`(${s.run.toString()})()`);
                        await page.waitForTimeout(s.wait || 1500);
                        for (const k of s.keys || []) {
                            await page.keyboard.press(k);
                            await page.waitForTimeout(700);
                        }
                        await page.waitForTimeout(400);
                        const problems = await page.evaluate(inspect);
                        const errors = page._errors || [];
                        report[key][s.name] = { problems, errors };
                        failed += problems.length + errors.length;
                        const canvas = await page.$("#gameCanvas");
                        await canvas.screenshot({ path: path.join(OUT, `${key}-${s.name}.png`) });
                        const tag = problems.length || errors.length ? `${problems.length} problem(s), ${errors.length} error(s)` : "ok";
                        console.log(`${key} ${s.name.padEnd(16)} ${tag}`);
                        for (const p of problems.slice(0, 6)) {
                            console.log(`    ${p.kind.padEnd(14)} ${p.cls}  "${p.text || ""}"  [${p.rect}]`);
                        }
                        for (const e of errors.slice(0, 3)) {
                            console.log(`    error ${e}`);
                        }
                    } finally {
                        await page.close();
                    }
                }
            };
            await Promise.all([worker(), worker(), worker()]);
        }
    } finally {
        await browser.close();
        server.close();
    }
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
    console.log(`\nScreenshots and report.json in ${OUT}`);
    process.exit(failed ? 1 : 0);
}

if (require.main === module) {
    main().catch(e => {
        console.error(e);
        process.exit(2);
    });
}

module.exports = { SCENARIOS, inspect };
