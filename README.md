# PokéMZ

The official repository for the free-to-play fan game engine.

## 3D maps (Three.js)

Maps can opt in to a Three.js renderer while MZ keeps running all game logic,
windows, pictures, weather, tone and fades. The system is split into plugins
(enable them in this order in the Plugin Manager):

| Plugin | What it does |
|---|---|
| `PokeMZ_Three_Core` | Renderer bridge, terrain from tile data, animated autotiles, water, upright tiles, billboarded characters, blob shadows, scriptable camera |
| `PokeMZ_Three_Effects` | Balloons, animations and the destination marker follow 3D characters |
| `PokeMZ_Three_Input` | Mouse / touch picking (click to move, tap events) |
| `PokeMZ_Three_Movement` | Height-aware passability and Pokémon-style ledges |
| `PokeMZ_Three_Models` | glTF / GLB buildings and props from the `models/` folder |
| `PokeMZ_Three_Lighting` | Ambient, sun (optional shadows), point lights, time of day |

### Authoring a 3D map

1. Add `<3D>` to the map's note.
2. Paint **height regions** (default 1-20; height = region × 0.5 tiles) and
   **ramp regions** (default 21) for stairs and slopes. Cliff walls are generated.
   Keep these separate from your encounter-zone regions.
3. Paint cliffs like a 2D map: cliff-top tiles get a height region, and the
   cliff face rows in front (south) use A3/A4 wall-side tiles or B-E tiles with
   terrain tag **5**. In 3D the face rows become a steep slope showing those tiles,
   covering exactly the same tiles as in 2D (about 2 rows per tile of height).
4. Give tall B-E tiles (trees, signs, fences) terrain tag **7** to stand them up,
   and ledge tiles terrain tag **6** (and make them impassable).
5. Water reflects characters, upright tiles and models automatically.
   Random encounters zoom the 3D camera onto the player.

### Map note tags

```
<3D>
<3D Camera: pitch=55 yaw=0 distance=14 fov=30>
<3D Smooth: 0.5>
<3D Water: depth=0.2 opacity=0.85 bed=#1c3550>
<3D Fog: #b8d0e8 near=20 far=45>
<3D Clamp: off>
<3D Reflections: off>            (or a strength, e.g. <3D Reflections: 0.5>)
<3D LedgeDirection: 2>
<3D Model: house.glb x=5 y=8 rot=0 scale=1 block=4x3 door>
<3D Lighting: off>
<3D Ambient: #ffffff 0.7>
<3D Sun: #fff8ec 0.45 dir=-1,2,1.5 shadows>
<3D Light: #ffaa55 x=5 y=3 radius=4 intensity=1 height=1 flicker>
<3D TimeOfDay: off>
```

### Event comment / note tags (active page)

```
<3D Flat>                                  tile-graphic event lies on the ground
<3D Shadow: off>                           no blob shadow
<3D Ledges>                                event hops ledges (move routes, approach/away)
<3D Model: pokeball.glb scale=0.5 turn keepSprite>
<3D Light: #ffaa55 radius=4 intensity=1 height=1 flicker>
```

### Plugin commands

`PokeMZ_Three_Core`: Camera Follow, Pan To Tile, Set Angle, Offset, Shake,
Reset (all eased, optionally waiting), Rebuild Terrain.
`PokeMZ_Three_Lighting`: Set Time Of Day (day, dawn, dusk, night).

Remember to ship the `models/` folder: MZ's "Exclude unused files" can't see it.

## Preact UI

Screens can be written as [Preact](https://preactjs.com) components that sit in a DOM
overlay locked to the game canvas. There is no build step: `js/libs/preact-htm.js` is
vendored and components use `htm` tagged templates. Enable these plugins below the 3D
plugins, in this order:

| Plugin | What it does |
|---|---|
| `PokeMZ_UI_Core` | Overlay host, game-state bridge, scene lifecycle, input actions and focus, MZ asset loading, timing and audio hooks, `ui.csv` strings, transitions, toasts, hot reload |
| `PokeMZ_UI_Messages` | Show Text, Choices and Input Number in Preact; promise API; on-screen keyboard; name entry (replaces Scene_Name) |
| `PokeMZ_UI_Controls` | Options › Controls (keyboard and gamepad remapping, saved in config) and a UI Animations on/off option |
| `PokeMZ_UI_StartMenu` | Pokémon-style start menu (Pokédex, Party, Trainer, Pokégear, Bag, Save, Options, Exit) that replaces Scene_Menu on the map |

Keyboard, gamepad, mouse and touch all trigger the same actions. Hover moves the cursor,
a click or tap confirms, and a right-click, two-finger tap or the on-screen Back button
cancels.

### Strings

All UI text comes from `data/locales/ui.csv` (`Key,en,es-es,...`), using keys of the form
`Area.Screen.Item`. MZ escape codes such as `\N[1]` work in values. With `PokeMZ_Locale`
enabled (see [Localization](#localization)) it handles languages, fallbacks and message
formatting: `t("Bag.Count", null, { n: 3 })`. Without it, the Core `Language` parameter picks
the column and missing cells fall back to `en`, then to the key.

### Writing a screen

```js
const { html, useText, useCursorList, registerScreen } = PokeMZ.UI;
const { BackButton, Panel } = PokeMZ.UI.components;

function BagScreen({ close }) {
    const title = useText("Start.Menu.Bag");
    const items = PokeMZ.UI.useGame(() => $gameParty.items());
    const cursor = useCursorList(items.length, { onOk: i => {/* use item */}, onCancel: close });
    return html`<div class="pmz-placeholder">
        <div class="pmz-panel pmz-title-bar">${title}</div>
        <${Panel} class="pmz-placeholder-body">
            <div class="pmz-list" ...${cursor.listProps}>
                ${items.map((it, i) => html`<div ...${cursor.itemProps(i)}>${it.name}</div>`)}
            </div>
        <//>
        <${BackButton} onPress=${close} />
    </div>`;
}
registerScreen("bag", BagScreen); // replaces the placeholder
```

Other entry points:

- `PokeMZ.UI.openScreen(id, props)`
- `attach(Scene_Map, id, Hud)` for overlays
- `PokeMZ.UI.menu.addCommand({...})`
- `message` / `choose` / `confirm` / `inputNumber` / `enterName` (promises)
- `useGame`, `useFrame`, `useTween`, `wait(frames)`
- `audio` / `sound`
- `transitions.register(name, {enter, exit})`
- `toast(text)`

Patch MZ methods with `PokeMZ.UI.patch(...)` so a plugin can be hot reloaded. Styling lives
in `css/pokemz-ui.css` (CSS variables at the top), so graphics can be added later with CSS
alone.

While playtesting, F6 (or saving a file, in NW.js) reloads the UI CSS, `data/locales/*.csv`
and the `PokeMZ_UI_*` plugins other than Core.

Caveats:

- The overlay always draws above the canvas, so it can't sit between pictures or weather,
  and it is not included in `SceneManager.snap()`.
- Like `models/`, assets used only by UI code are invisible to MZ's "Exclude unused files".

## Localization

`PokeMZ_Locale` (enable it right after `PokeMZ_UI_Core`) makes every text in the game
translatable through the CSV files in `data/locales/`. It also works without the UI plugins.

### Files

| File | Contents |
|---|---|
| `languages.csv` | One column per language: native `Name`, `Intl` tag, `Fallback` chain, `Direction`, name-entry `Keyboard`, optional `Font` |
| `keyboards.csv` | On-screen keyboard layouts (`abc`, `qwerty`, `azerty`, `qwertz`, `es`, `pt`, `cyrillic`, `greek`): `PageN.Label`, `PageN.RowM` |
| `ui.csv`, `pokemon.csv`, `moves.csv`, … | String tables: `Key` column, one column per language |
| `database.csv` | Database and System text (generated by `extract`) |
| `dialogue.csv` | Event text (generated by `extract`) |

Columns starting with `#` (such as `#Context`, `#Stale` and `#Note`) are notes for translators, and
the game ignores them. Keys are **stable IDs** that are global across files. They never depend
on row order or on the text itself. List any new table in the plugin's `String Tables`
parameter.

### Lookup and fallbacks

A string is looked up in the current language first, then in that language's `Fallback` chain
(for example `es-mx` → `es-es`), then in `en`. If none of those has it, the caller's fallback is
used, and if there is no fallback either, the key itself is shown as `⟦Key⟧`. The player picks
the language in **Options › Language**. The choice is saved in the config file, not in save
files. `auto` follows the system language.

### Message format

Values use [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/):

```
Bag.Count,"{n, plural, one {# item} other {# items}}","{n, plural, one {# objet} other {# objets}}"
Rival.Won,"{g, select, female {She} male {He} other {They}} won {money, number} {unit}!"
```

`{x}`, `{x, number}`, `{x, number, percent}`, `{d, date, short}`, `{t, time}`, `plural` (with `=N`
and `offset:`), `selectordinal` and `select` are supported. The old `%1` style still works.

MZ escape codes are **protected**:
- `\{` is never read as a brace.
- Values inserted into a message can't add codes, so a player named `\C[2]` stays literal.
- `npm run l10n check` fails when a translation's codes differ from the source.

Use `\L[Some.Key]` in any text (Show Text, the database, other strings) to insert a string.

```js
PokeMZ.L10n.t("Bag.Count", { n: 3 });          // "3 items"
PokeMZ.UI.t("Bag.Count", "", { n: 3 });         // same, through the UI helpers
PokeMZ.UI.useText("Bag.Count", "", { n: 3 });   // re-renders on language change
```

### Locale-aware formatting and sorting

`PokeMZ.L10n` provides these helpers, all using the current language:
- `formatNumber`, `formatPercent`, `formatCurrency` (`UI.Format.Currency`), `formatDate`, `formatTime`, `formatList`, `formatRelative` and `formatPlayTime`
- `compare` and `sortBy`, which sort with the language's collation and order numbers naturally ("Item 9" < "Item 10")

### Word wrapping

- **Preact message box:** the browser handles line breaking. It follows the page's `lang`, which is correct for every script. The typewriter lays out the whole page in advance, so words never jump to the next line while being typed.
- **MZ windows:** `Window_Message`, `Window_Help` and `Window_ScrollText` wrap automatically (the `Auto Wrap` parameter). Other windows can use `drawTextWrapped(text, x, y, width)`.
- **How wrapping works:** it counts grapheme clusters, so accents and emoji stay together. It breaks at spaces and hyphens, and anywhere in CJK text while following kinsoku rules. In Thai, Lao, Khmer and Myanmar it breaks between words using `Intl.Segmenter` when the runtime has it. Text color and size codes take up no width.

### Name entry

The on-screen keyboard uses the language's layout from `keyboards.csv`, for example AZERTY for
French. When the browser can detect the player's physical keyboard and it has the same letters,
the letter pages follow it. A typed name counts characters as grapheme clusters, so `é` is one
character however it was typed.

### Language-agnostic saves

- Database names, descriptions and messages, System terms and map display names are swapped
  at load time and on every language change. Saves never contain them.
- Give a database entry a readable key with `<L10n: Item.POTION>` in its note. Without one,
  the key is `Db.Item.<id>`.
- Actor names, nicknames and profiles follow the language until the player renames the actor.
- Game code should store IDs (species, moves, items) and never display text. In playtest, saving
  warns when a variable holds translated text.

### Event dialogue

Close the editor, then run:

```bash
npm run l10n extract
```

This puts a `<L10n: Dlg.k3x9qa>` comment above every Show Text, Show Choices and Scrolling
Text, and copies the text, speaker names and choices into `dialogue.csv` (with a `#Context` for
translators). The editor keeps the English text. Re-running `extract` is safe:
- IDs are kept.
- Edited source text updates the `en` column and marks translated rows `#Stale`.
- An event copied with its comment but given new text gets a new ID.
- Text that was removed is marked `(unused)`, and its translations are kept.

### Debug tools (playtest)

| | |
|---|---|
| F7 / Shift+F7 | Cycle languages, including the pseudo-locales `qps-accent` (accented, 40% longer) and `qps-keys` (shows IDs) / back to `en` |
| `PokeMZ.L10n.report()` | Missing strings, fallbacks used, stale dialogue, table errors and coverage |
| `PokeMZ.L10n.checkOverflow()` | Outlines UI text that doesn't fit (also runs after each language change) |
| `npm run l10n check` | Validate all tables (duplicates, codes, placeholders, ICU syntax, languages.csv) |
| `npm run l10n stats` | Coverage per language |
| `npm test` | Engine and tool tests |
