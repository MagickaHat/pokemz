# Editing the Preact UI

This guide covers how the Preact screens (start menu, message box, party, bag, battle and the rest) are built, where each piece lives, and how to change them without breaking the pixel grid.

## Where things live

| File | What it holds |
|---|---|
| `game/js/plugins/PokeMZ_UI_Core.js` | The overlay itself, the `PokeMZ.UI` API (hooks, `registerScreen`, `openScreen`, `attach`, transitions, toasts), shared building blocks (`Panel`, `Button`, `BackButton`, `List`, `MzImage`, `Icon`, `Face`, `Glyph`, ...) |
| `game/js/plugins/PokeMZ_UI_Messages.js` | Show Text / Choices / Input Number / name entry in Preact |
| `game/js/plugins/PokeMZ_UI_Controls.js` | Options › Controls, accessibility options, touch controls |
| `game/js/plugins/PokeMZ_UI_StartMenu.js` | The start menu and its placeholder screens |
| `game/js/plugins/PokeMZ_UI_Pokemon.js` | Party, summary, bag, Pokédex, PC, battle, evolution, town map, trade, day care |
| `game/css/pokemz-ui.css` | **All** styling. Variables at the top, then one section per screen (search for `/* Party ---`, `/* Bag ---`, `/* Battle ---`, ...) |
| `game/data/locales/ui.csv` | Every UI string (`Key,en,es-es,...`) |

Plugin order (Plugin Manager): `PokeMZ_Input`, `PokeMZ_Display`, the 3D plugins, then `PokeMZ_UI_Core`, `PokeMZ_Locale`, and after them the other `PokeMZ_UI_*` plugins.

There is **no build step**. Components are plain functions that return [htm](https://github.com/developit/htm) tagged templates, so you edit the `.js` file and reload.

## How the overlay works

- MZ draws the game into its canvas at the game resolution (256×192 by default). `PokeMZ_Display` shows that canvas at a **whole multiple** (2×, 3×, …) and centres it.
- The Preact UI is a DOM layer (`#pokemz-ui`) placed exactly over the canvas. Its root is laid out at the game resolution and scaled by the same whole multiple.
- **So `1px` in the CSS is one game pixel on screen.** Lay everything out in game pixels, as if the screen were 256×192.
- The overlay always draws above the canvas (above pictures, weather and fades), and it is not part of `SceneManager.snap()`.

## The pixel-grid rules

These keep the UI on the same pixel grid as the 2D and 3D layers. `css/pokemz-ui.css` follows them; keep following them when you edit:

1. **Whole `px` values only.** No `em`/`rem`/fractional sizes for anything that draws.
2. **Fonts at their native size.** The FRLG font is a 16px pixel font: use `16px` (or `32px` for a 2× title). Any other size blurs the glyphs. Lines are 18px (`--pmz-line`).
3. **No `border-radius`, blur, soft shadows or soft gradients.** They draw at screen resolution, smoother than a game pixel. Instead use:
   - square boxes, or add class `pmz-corners` for stepped 1px corners
   - `border-image` with your own 9-slice PNG (see below)
   - hard shadows: `text-shadow: 1px 1px 0 color`
   - hard gradient stops: `linear-gradient(#a 0 50%, #b 50%)`
4. **Images at whole scales.** `MzImage`, `Icon`, `Face`, `PokemonImage` round `scale` to a whole number (≥ 1). Use `image-rendering: pixelated` (already on `.pmz-root` and `.pmz-image`).
5. **Movement in whole pixels.** Built-in slide transitions use `steps()` easing. For your own animations, use `steps()` or `translate` by whole px, and scale only by 2, 3, ….

`zoom` transitions and the Poké Ball spin in battle break rule 5 while they run. That is fine for a few frames, but avoid it for anything that stays on screen.

## Layout grid

The top of `css/pokemz-ui.css` defines a few layout tokens. Screens place their boxes from the screen edges with them, instead of hard-coding the 192px height, so a larger resolution gives the screen more room instead of breaking it:

| Token | Value | Meaning |
|---|---|---|
| `--pmz-gap` | 4px | space between boxes, and to the screen edge |
| `--pmz-row` | 18px | one row of text (16px font + 2px) |
| `--pmz-header-h` | 20px | a one-row header or tab strip at the top |
| `--pmz-help-h` | 22px | the help bar at the bottom |
| `--pmz-content-bottom` | 24px | where content ends, above the help bar (`bottom: var(--pmz-content-bottom)`) |

A typical screen: header `top: 2px; height: var(--pmz-header-h)`, content from `top: 24px` to `bottom: var(--pmz-content-bottom)`, then the `HelpBar`. Budget rows: a panel with 4px padding and a 1px border holds `floor((height - 10) / 18)` rows of text.

### Sprites stand on their feet

Pokémon sprites are 96×96 frames drawn at 1×. Don't position the image's top-left corner; place a zero-size **anchor** at the Pokémon's feet and let the sprite stand on it. That is how `.pmz-pk-battler` works:

```css
.pmz-pk-battler { position: absolute; left: var(--x); top: var(--y); width: 0; height: 0; }
.pmz-pk-battler > .pmz-pk-image { position: absolute; bottom: 0; left: var(--pmz-img-half); }
```

`PokemonImage` sets `--pmz-img-half` to minus half its width, so 64px, 80px and 96px art all centre on the same point. Animations (`transform`) on the anchor scale and move around the feet.

### Battle coordinates (256×192)

Feet and platform positions are CSS variables in the Battle section of the stylesheet. Change `--x`/`--y` to move things:

| What | Selector | Default |
|---|---|---|
| Foe (singles), feet | `.pmz-pk-battler.is-foe0` | `--x: 188px; --y: 88px` |
| Player (singles), feet | `.pmz-pk-battler.is-player0` | `--x: 64px; --y: 144px` |
| Foe platform (centre, size) | `.pmz-pk-platform.is-foe` | `188, 82`, 128×24 |
| Player platform | `.pmz-pk-platform.is-player` | `64, 140`, 144×28 |
| Doubles foes | `.is-doubles … .is-foe0 / .is-foe1` | `208, 96` / `152, 92` |
| Doubles players | `.is-doubles … .is-player0 / .is-player1` | `48, 144` / `100, 144` |
| Foe HP box | `.pmz-pk-bbox.is-foe0` | `left: 4px; top: 4px`, 128 wide |
| Player HP box | `.pmz-pk-bbox.is-player0` | `right: 4px; top: 96px` |
| Bottom area height | `--pmz-battle-bottom-h` | 48px (2 lines of text) |

HP bars are 48px tracks (`HP_BAR_WIDTH` in `PokeMZ_UI_Pokemon.js`) and EXP bars 64px (`EXP_BAR_WIDTH`), so the fill is always a whole number of pixels. Change the constant and the CSS width together.

## Changing how something looks (CSS only)

Most edits never touch JavaScript.

1. Find the class: open the browser devtools in a playtest (F8 in NW.js), use the element picker on the UI, and read its class (every element has a `pmz-…` class).
2. Search for that class in `css/pokemz-ui.css` and edit it.
3. Press **F6** in a playtest (or just save the file in NW.js). The CSS, `ui.csv` and the UI plugins other than Core reload without restarting.

The variables at the top of the stylesheet restyle everything at once:

```css
#pokemz-ui {
    --pmz-font-size: 16px;      /* pixel font's native size */
    --pmz-line: 18px;           /* line height */
    --pmz-fg: #404040;          /* text */
    --pmz-fg-shadow: #d0d0c8;   /* 1px text shadow */
    --pmz-bg: #f8f8f8;          /* panel fill */
    --pmz-border: #4a6890;      /* panel outer border */
    --pmz-border-inner: #a8c0e0;/* panel inner border */
    --pmz-select: #dce8f8;      /* selected item */
    --pmz-pad: 4px;             /* panel padding */
    --pmz-message-lines: 2;     /* message box lines */
}
```

Pokémon screens have their own block of `--pmz-pk-*` variables (HP colors, slot colors, battle sky, …) at the start of the `Pokémon screens` section.

### Adding graphics (window frames, backgrounds)

Put PNGs anywhere under `game/` (for example `img/ui/`) and reference them from the CSS:

```css
/* A 9-slice frame: 24x24 PNG with 8px corners. */
.pmz-panel {
    border: 8px solid transparent;
    border-image: url("../img/ui/frame.png") 8 fill / 8px stretch;
    image-rendering: pixelated;
    background: none;
    box-shadow: none;
}

/* A full-screen background drawn at 256x192. */
.pmz-pk-party {
    background: url("../img/ui/party_bg.png") 0 0 / 256px 192px no-repeat;
}
```

Draw the art at 1× game pixels. Ship the folder by hand: MZ's "Exclude unused files" can't see files that only the CSS uses.

## Changing layout or behaviour (JavaScript)

### Anatomy of a screen

```js
(() => {
    const UI = window.PokeMZ.UI;
    const { html, useText, useGame, useCursorList, registerScreen } = UI;
    const { Panel, BackButton } = UI.components;

    /** @brief A list of the party's items. Props: close() from the screen host. */
    function ItemsScreen({ close }) {
        const title = useText("My.Items.Title", "Items");            // ui.csv key + fallback
        const items = useGame(() => $gameParty.items());              // re-renders when it changes
        const cursor = useCursorList(items.length, {                  // keys, pad, mouse, touch
            onOk: i => UI.toast(items[i].name),
            onCancel: close,
        });
        return html`<div class="pmz-screen my-items">
            <${Panel} title=${title} class="my-items-panel">
                <div class="pmz-list" ...${cursor.listProps}>
                    ${items.map((it, i) => html`<div key=${it.id} ...${cursor.itemProps(i)}>${it.name}</div>`)}
                </div>
            <//>
            <${BackButton} onPress=${close} />
        </div>`;
    }

    registerScreen("myItems", ItemsScreen, { transition: "fade" });
})();
```

- **htm syntax:** `html\`...\`` is JSX without a build step. Components are written `<${Name} prop=${value}>…<//>`, and props are spread with `...${obj}`. Attributes use `class` (not `className`). `${cond ? html\`…\` : null}` renders conditionally, and lists use `.map` with a `key`.
- **Opening a screen:** `PokeMZ.UI.openScreen("myItems", props)`. The "Open Screen" plugin command and start-menu entries work too. Every screen gets `close()`.
- **Replacing a built-in screen:** register the same id from your own plugin, placed below the UI plugins. For example, `registerScreen("bag", MyBag)` replaces the bag, and the start menu opens yours.

### Hooks you'll use most

| Hook | Use |
|---|---|
| `useGame(selector)` | Read game state (`$gameParty`, variables, …). It re-renders when the value changes (checked once per frame). |
| `useCursorList(count, {columns, wrap, onOk, onCancel, onChange, isEnabled})` | A list or grid cursor. Spread `listProps` on the container and `itemProps(i)` on each item. |
| `useFocus({ok, cancel, up, …}, {priority})` | Raw action handlers for custom layouts. The newest, highest-priority owner gets input. |
| `useAction(action, fn)` | One action, e.g. `useAction("pageDown", next)`. |
| `useText(key, fallback, args)` | A `ui.csv` string (ICU args, `\N[1]`, …). It re-renders on language change. |
| `useFrame(fn)` / `useTween(target, frames)` / `wait(frames)` | Timing in MZ frames. |
| `useGlyph(action)` / `<${Glyph} action="confirm" />` | The button prompt for the active device. |

### Start menu entries

```js
PokeMZ.UI.menu.addCommand({
    id: "map", labelKey: "Start.Menu.Map", order: 45,
    visible: () => $gameSwitches.value(10),
    onSelect: () => PokeMZ.UI.openScreen("townMap"),
});
PokeMZ.UI.menu.removeCommand("pokegear");
```

`order` places the entry (Pokédex 10 … Exit 80). Return `"close"` from `onSelect` to close the menu.

### HUDs on a scene

```js
PokeMZ.UI.attach(Scene_Map, "clock", function Clock() {
    const t = PokeMZ.UI.useGame(() => $gameSystem.playtimeText());
    return PokeMZ.UI.html`<div class="pmz-panel my-clock">${t}</div>`;
});
```

Position `.my-clock` in the CSS in game pixels (e.g. `left: 4px; top: 4px`).

### Patching MZ from a UI plugin

Use `PokeMZ.UI.patch(owner, "method", "MyPlugin.key", orig => function (...a) { … orig.apply(this, a) … })` instead of overwriting prototypes. Hot reload can then re-apply your plugin without stacking patches.

## Worked example: make the start menu wider and add a title

1. In `css/pokemz-ui.css`, find `.pmz-start-menu` (Start menu section) and change `width: 88px` to `width: 104px`.
2. In `PokeMZ_UI_StartMenu.js`, `StartMenu()` returns `<${Panel} class="pmz-start-menu">`. Give it a title: `<${Panel} class="pmz-start-menu" title=${useText("Start.Menu.Title", "Menu")}>`.
3. Add `Start.Menu.Title,Menu,,,,,` to `data/locales/ui.csv`.
4. Press F6 in the playtest and open the menu.

## Other resolutions

Players can pick another resolution in Options (320×240, 384×288, 16:9 ones, …), so the UI has more room, not bigger pixels. Prefer layouts that stretch:

- anchor boxes with `left/right/top/bottom` instead of fixed widths where it makes sense
- use flex or grid for rows
- read `Graphics.width / Graphics.height` in JS (as the town map does) rather than assuming 256×192

Check each screen at 256×192 first, since it is the tightest.

## Debugging

- **Layout audit:** `cd tools && npm run ui:audit` opens every Preact screen (party, summary pages, bag, Pokédex, PC, battles, messages, name entry, controls, …) in a headless Chromium at 256×192 and 320×240. It reports anything off screen, text that doesn't fit its box, and boxes running into the help bar, and saves a screenshot of every screen to `tools/ui-audit-out/`. Use `-- --only battle` for one screen and `-- --res 256x192` for one resolution. It needs Playwright: `npm i -D playwright && npx playwright install chromium`. Add your own screens to `SCENARIOS` at the top of `tools/ui-audit.js`.

- `PokeMZ.L10n.checkOverflow()` (or F7 to cycle pseudo-locales) outlines text that doesn't fit its box.
- **F10:** input overlay (focus owners and contexts).
- A component that throws is caught and logged to the console; the rest of the UI keeps running.
