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

- `PokeMZ.L10n.checkOverflow()` (or F7 to cycle pseudo-locales) outlines text that doesn't fit its box.
- **F10:** input overlay (focus owners and contexts).
- A component that throws is caught and logged to the console; the rest of the UI keeps running.
