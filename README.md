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
- Database entries are keyed by an `<L10n: Item.POTION>` tag in their note. With the editor
  closed, run `npm run l10n tag` after adding entries (or maps with a display name): it tags
  every untagged entry from its name (`Maiden’s Stance` → `Skill.MAIDENS_STANCE`, duplicates
  get `_2`), skipping separators such as `-----Reserved`, and renames existing
  `database.csv` rows so translations carry over. Tags are never rewritten, so renaming or
  moving an entry keeps its translations; edit the tag by hand to re-key one. Untagged
  entries fall back to `Db.Item.<id>`, and `extract` reminds you about them.
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
| `npm run l10n tag` | Give database entries and maps readable keys (see above) |
| `npm run l10n check` | Validate all tables (duplicates, codes, placeholders, ICU syntax, languages.csv) |
| `npm run l10n stats` | Coverage per language |
| `npm test` | Engine and tool tests |

## FMOD audio

The game can play its audio through [FMOD Studio](https://www.fmod.com) banks
(`js/libs/fmodstudio.js` + `.wasm`, HTML5 build 2.03). Every MZ sound looks for a matching
FMOD event first and plays the `.ogg` if there isn't one. So you can switch one sound at a time,
and the game still runs if FMOD is missing or fails to start. Enable these plugins below
the UI plugins, in this order:

| Plugin | What it does |
|---|---|
| `PokeMZ_FMOD_Core` | Startup/shutdown, per-frame update, browser audio unlock, error handling, async bank loading, event instances, local/global parameters, default overrides, callbacks, snapshots, buses/VCAs, programmer sounds, focus handling, `PokeMZ.FMOD` API |
| `PokeMZ_FMOD_Audio` | Takes over MZ's BGM/BGS/ME/SE and system sounds (name mapping, `.ogg` fallback), ME behaviour, Master Volume option and VCA sliders, per-map banks, save/load, scene snapshots, plugin commands |
| `PokeMZ_FMOD_Spatial` | Listener (3D camera or player), handedness, event emitters, ambient emitters (point or region) |
| `PokeMZ_FMOD_Debug` | F6 overlay and `PokeMZ.FMOD.debug` console tools (playtest only) |
| `PokeMZ_FMOD_Profiler` | Shift+F6 graphs and event stats, Ctrl+F6 recordings (JSON + FMOD command capture) (playtest only) |

Bank layout, Studio naming conventions and upgrade notes: [`audio/fmod/README.md`](audio/fmod/README.md).

### Note tags

```
Map note:
<FMOD Bank: Forest, Caves>                          banks loaded while on this map
<FMOD Ambient: event:/Amb/Waterfall x=12 y=4>      point ambience
<FMOD Ambient: event:/Amb/Sea region=30>           area ambience (nearest region tile)
<FMOD Ambient: event:/Amb/Wind volume=0.5>         2D ambience
<FMOD Preload: event:/BGM/Route1, Forest>          sample data kept loaded on this map

Event page comment / event note:
<FMOD Emitter: event:/SFX/Fountain params="Flow:0.5">
```

### Plugin commands

`PokeMZ_FMOD_Audio`: Play Event, Play One-Shot, Play Programmer Sound, Stop, Pause/Resume,
Set Parameter (a handle, or `bgm` / `bgs`), Set Global Parameter, Start/Stop Snapshot,
Load/Unload Bank, Preload/Release Samples, Set Bus/VCA Volume, Key Off, Set Timeline Position,
Wait For Event End, Wait For Marker, Stop All.

### Memory budgets

An event's samples load when it first plays and unload when its last instance ends.
**Preloading** (`<FMOD Preload: ...>` map note, the *Preload Samples* command,
`PokeMZ.FMOD.preload(target, {pinned})`) keeps an event's or a whole bank's samples loaded, so
there is no delay on first play. With a **Memory Budget** (MB) set in `PokeMZ_FMOD_Core`:
- While FMOD uses more than the budget, preloads that haven't been used for
  *Evict After* seconds are unloaded, least recently used first. They reload the next time
  the event plays.
- Pinned preloads stay loaded.
- If nothing is left to unload, a warning goes to the console, the F6 overlay and the profiler.

*Platform Overrides* set the budget, max channels, initial heap, idle sample pool, DSP buffer
and startup preloading separately for **desktop** (NW.js), **browser** and **mobile**. Mobile
defaults to a 64 MB budget, 48 channels and no idle pool. Add `&fmodPlatform=mobile` to a
playtest URL to try another platform's settings.

### Profiler

FMOD's Live Update profiler can't connect to HTML5 builds, so `PokeMZ_FMOD_Profiler` records
inside the game:
- **Graphs** (Shift+F6): CPU (Studio, DSP, streams), FMOD memory against the budget, channels
  (total/real) and FMOD update time. Below them are the busiest events (plays, peak
  simultaneous instances, playing time) and the latest log lines.
- **Recordings** (Ctrl+F6 to start and stop):
  - Each frame records CPU, memory and peak, wasm heap, channels, instances, file I/O
    rates, Studio command queue and handle usage, and update time.
  - The log covers instance starts and stops, banks, preloads, evictions, budget warnings,
    snapshots, global parameters, markers, scene and map changes, update spikes and errors.
  - Recordings save to `fmod-profiles/fmod-profile-<date>.json` in NW.js, or download in a
    browser.
- **Command capture**: with *FMOD Command Capture* on, a `.fmodcmd` file is saved next to the
  recording. This is FMOD's own capture of every API call, which
  `Studio::System::loadCommandReplay` can replay.
- **Console**: `PokeMZ.FMOD.profiler.start()`, `.stop()`, `.summary()`, `.eventStats()`.

### Script

```js
const h = PokeMZ.FMOD.play("event:/SFX/Engine", { name: "engine", scope: "map",
    params: { RPM: 1200 }, follow: PokeMZ.FMOD.spatial.follow($gamePlayer) });
h.setParameter("RPM", 3000);
h.on("marker", m => console.log(m.name));
PokeMZ.FMOD.setGlobalParameter("TimeOfDay", 18);
PokeMZ.FMOD.audio.setBgmParameter("Intensity", 1);   // kept in save files
PokeMZ.FMOD.playProgrammer("event:/Cry", "Cry025");
```

### Debug tools (playtest)

| | |
|---|---|
| F6 | Overlay: CPU, memory against the budget, preloads, banks, live instances with parameters and distance, listener, globals, snapshots, errors |
| Shift+F6 / Ctrl+F6 | Profiler panel / start-stop a recording |
| `PokeMZ.FMOD.debug.listEvents()` | Every event path in the loaded banks |
| `PokeMZ.FMOD.debug.info(path)` / `.play(path)` | Inspect / audition an event |
| `node --test tests/fmod.test.js` | Engine tests and boot, budget and profiler tests against the real FMOD wasm (silent output) |

Remember to ship `audio/fmod/`: MZ's "Exclude unused files" can't see it.

## PBS data and Pokémon

Pokémon data lives in `data/pbs/*.json` (Essentials' PBS file names, JSON format). These
plugins load it and build the game systems on top of it. Enable them in this order: `PS_Sim` at the
top of the list, the `PokeMZ_PBS_*` plugins right after `PokeMZ_Locale`, and `PokeMZ_UI_Pokemon`
after `PokeMZ_UI_StartMenu`.

| Plugin | What it does |
|---|---|
| `PS_Sim` | The Pokémon Showdown simulator (`@pkmn/sim`), bundled by `npm run build:showdown` |
| `PokeMZ_PBS_Core` | Async loading, line-accurate JSON parser, schemas, registries, two-pass references, MZ map/item alignment, hot reload |
| `PokeMZ_PBS_Pokemon` | `Game_Pokemon` actors, party, bag and item handlers, Pokédex, PC boxes, day care and eggs, evolution, wild encounters |
| `PokeMZ_PBS_Graphics` | pokeemerald-style graphics folders with shiny palette swaps |
| `PokeMZ_PBS_Battle` | Battle bridge to Showdown: singles, doubles and multi battles, battle-only forms (Mega, Primal, Z-Moves, Tera, Dynamax/Gigantamax), custom content as a Showdown mod, localized battle text |
| `PokeMZ_PBS_Followers` | The first healthy party Pokémon follows the player (HGSS style), with moods, talking, found items and overworld effects |
| `PokeMZ_PBS_Berries` | Berry planting (Gen 4 style): soil events, growth, watering, mulch, harvests |
| `PokeMZ_PBS_Trade` | NPC trades, a portable Pokémon format and a trade protocol ready for online trades |
| `PokeMZ_UI_Pokemon` | Gen 3 style screens: battle, party, summary, bag, Pokédex, PC, Town Map/Fly, evolution, trade, move reminder, day care |

### Files and IDs

Each file is an object keyed by ID; keys starting with `#` are comments. IDs follow
Showdown's convention: lower case letters and digits only (`raichualola`, `willowisp`). The tool fills
the files from Showdown, so species and move IDs match Showdown by construction.

| File | Key | Notes |
|---|---|---|
| `types.json`, `natures.json`, `abilities.json`, `moves.json` | ID | Natures and types have their own locale tables |
| `pokemon.json` | species ID | Stats, abilities, learnsets (level/TM/tutor/egg), evolutions, Pokédex data. Height and weight are in decimetres and hectograms (always shown in metric) |
| `pokemon_forms.json` | form ID | `baseSpecies` + `forme` + only the fields that differ |
| `pokemon_metrics.json` | species ID | Battler y offsets and elevation |
| `items.json` | item ID | Pocket, field/battle use, `effect` (item handler) + `params` |
| `map_metadata.json`, `encounters.json` | MZ map ID | Checked against `MapInfos.json`; add `"#map": "Route 1"` to be warned when the map is renamed |
| `trainers.json` | ID | `battleType` (`single` / `double`), `gimmicks` (`mega`, `zmove`, `dynamax`, `terastallize`); Pokémon may set `teraType`, `dynamaxLevel`, `gigantamax` |
| `berry_plants.json` | Berry item ID | Hours per stage, soil drying per hour, yield (imported from PokeAPI) |
| `town_map.json` | region ID | Image, grid size, points (localized names, POIs, `flyTo`, `switch`) |
| `trades.json` | trade ID | In-game trades: `npcName`, `nickname`, `wants`, `gives`, `once` |
| `trainer_types.json`, `regional_dexes.json`, `ribbons.json`, `phone.json`, `battle_tower.json`, `map_connections.json` | ID | |

Errors keep their position, for example `moves.json:120:14  /thunderbolt/type  unknown types "electrik"
(did you mean "electric"?)`. In playtest the boot stops on errors and lists them; warnings go to the
console (`PokeMZ.PBS.report()`). Files can refer to each other in any order: IDs are registered
first and references are resolved in a second pass.

```js
PokeMZ.PBS.species.get("pikachu").name             // localized (pokemon.csv)
PokeMZ.PBS.moves.filter(m => m.type === "fire")
PokeMZ.PBS.encountersFor($gameMap.mapId())
PokeMZ.PBS.reload()                                // playtest; also on file change and F6
```

### Items

Every PBS item has an MZ database entry tagged `<PBS: potion>` (and `<L10n: Item.potion>`), so event
commands such as Change Items and item conditions work. The MZ entry owns the icon and price; the PBS
entry owns the Pokémon behaviour. Item counts are kept in the bag (`$gameParty.bag()`), sorted into
pockets. Canon field items (healing, revives, PP, vitamins, candies, mints, ability items, evolution
stones, TMs, repels, Escape Rope, fishing rods) come with handlers.

### Pokémon

`Game_Pokemon` extends `Game_Actor`. Instances are created at runtime with actor IDs from 100000 up,
so they need no `Actors.json` slots and MZ's 1000-actor limit doesn't apply. The party is
`$gameParty.pokemon()`; the trainer stays MZ's party leader. Every move a Pokémon has known is kept in its
move bank for the move reminder. Evolution works like Pokémon Legends: Arceus: a Pokémon that meets its
conditions becomes ready to evolve, and the player evolves it from the party menu whenever they like
(trade evolutions still happen at once). The Pokédex shows full entries only for caught species. Rules
default to Gen 9 and can be changed in `PokeMZ.Pokemon.rules`.

### Graphics

Like pokeemerald's `graphics/pokemon/`, each species has a folder in `img/pokemon/`:
- `front.png` and `back.png`: 96×96 battlers. `frontf.png` and `backf.png` are optional female versions.
- `icon.png`: two 32×32 frames stacked.
- `normal.pal` and `shiny.pal`: JASC-PAL palettes.

Forms use a sub-folder (`raichu/alola/`). Shiny sprites are made by swapping palette colors at
load time. Missing files fall back to the base species, then to `question_mark/`. Ship `img/pokemon/`
by hand: MZ's "Exclude unused files" can't see it.

### Extending

```js
const { T } = PokeMZ.PBS;
PokeMZ.PBS.extendSchema("pokemon", { rarity: T.int().opt(0) });        // new field
PokeMZ.PBS.registerFile({ name: "quests", file: "quests.json", schema: T.struct({ name: T.localized() }) });
PokeMZ.PBS.enums.add("pockets", "ingredients");                         // open enums
PokeMZ.Pokemon.ItemHandlers.register("myeffect", { canUse, use });
PokeMZ.Pokemon.EvolutionMethods.register("mymethod", (pkmn, evo, ctx) => true);
PokeMZ.Pokemon.FormHandlers.register("castform", pkmn => "castformsunny");
PokeMZ.Pokemon.FieldMoves.register("cut", { canUse, use });
PokeMZ.Battle.registerEffect("abilities", "myability", { name: "My Ability", onModifyAtk(a) { return this.chainModify(1.5); } });
```

Entries marked `"custom": true` (fakemon, new moves) are not checked against Showdown and are loaded
into the battle simulator as a Showdown mod.

### Double battles and battle-only forms

| Battle | How to start it |
|---|---|
| Trainer doubles | Give the trainer `"battleType": "double"` |
| Two trainers at once | *Trainer Battle* with **Second Trainer**. Each trainer keeps to their own slot |
| Partner battle (multi) | *Trainer Battle* with **Partner**. The partner is a `trainers.json` entry controlled by the AI |
| Wild doubles | *Wild Battle* with **Second Species**, or `"doubles": <chance>` on an encounter type. Balls only work once one foe is left |

In doubles the player chooses an action for each Pokémon, and Back returns to the previous one.
Moves that need a target open a target picker.

| Battle-only form | Key item needed | Extra requirement |
|---|---|---|
| Mega Evolution | Mega Ring | |
| Primal Reversion | (none; it uses the Red/Blue Orb) | |
| Z-Moves | Z-Ring | |
| Terastallization | Tera Orb | Recharged by *Heal Party* |
| Dynamax / Gigantamax | Dynamax Band | Map metadata `"dynamax": true` |

When the player has the key item, Shift in the move menu toggles the gimmick. Trainers use only the gimmicks
listed in their `gimmicks`. Pokémon have a Tera Type (Tera Shards change it), a Dynamax Level (Dynamax
Candy) and a G-Max Factor (Max Soup). Battle-only forms revert after the battle.

Sides other than the player's are driven by controllers (`PokeMZ.Battle.AIController`). Any object
with `choose(sideId, bridge)` can drive a side, which is where an online opponent would plug in.

### Following Pokémon

The first party Pokémon that can battle follows the player. It uses
`img/pokemon/<species>/overworld.png`: an MZ single-character sheet (3 × 4 frames, any frame size, shiny
via the palettes, optional `overworldf.png`). A species without this sheet stays in its ball.

It goes back into its ball:
- while Surfing, unless it is a Water or Flying type
- on the bicycle
- on maps with `"followers": false`
- while the plugin's switch is off

Face it and press OK to talk. It reacts to friendship, status, HP, weather, time and the map, with a
balloon and a localized line. Walking with it raises friendship, and it sometimes finds items
(per-map `followerItems`).

On 2D maps, grass, water and sand tiles show small effects. On 3D maps it is drawn like other
followers, with shadow and reflection. Plugin commands: *Toggle Follower*, *Follower Emote*, *Talk To
Follower*.

### Berries

Put `<Berry Plant>` in an event's note (or a page comment) to make it soil. The player plants a
Berry, and it grows through five stages on the real clock (or play time).

- **Watering:** watering cans water the soil. Hours spent dry lower the yield.
- **Mulch:** laid before planting, it changes growth speed, drying, how long ripe Berries stay and how often they regrow.
- **Unpicked Berries:** they fall and regrow, up to a limit.
- **Graphics:** `img/characters/$berrytree_<id>.png` (or `$berrytree.png`), with rows for sprouted, taller, flowering and ripe. Without a sheet the event keeps its own image.

### Town Map and Fly

The Town Map (Town Map item, the start menu's Pokégear, or `openScreen("townMap")`) shows a
`town_map.json` region. The image is `img/townmap/<image>.png`; without it, a grid is drawn. A
blinking marker shows where the player is (map metadata `townMap`, or the parent map's). Fly is a
field move on outdoor maps. It opens the map, and the player can fly to points whose `flyTo` map was
visited or whose switch is on.

### Trading

*NPC Trade* runs a `trades.json` trade:
1. The player chooses a Pokémon that fits `wants`: a species, or `{type, species, minLevel}`.
2. The trade plays out on screen.
3. The received Pokémon keeps its OT, so it gets the traded EXP bonus. Trade evolutions happen at once.

The result goes to a variable: 1 traded, 2 declined, 3 no suitable Pokémon, 4 already traded.

For online trading later:
- **`PokemonCodec`** encodes a Pokémon as versioned, ID-only data with a checksum. It validates incoming data against the PBS registries (IVs/EVs, moves and PP, items, ability slot, gender, level).
- **`TradeSession`** runs the protocol (`hello` → `offer` → `accept` → `confirm`, or `cancel`) over any transport with `send`, `onMessage` and `close`.
- **`LocalTransport.pair()`** connects two sessions in memory, which is how NPC trades work. A WebSocket or WebRTC transport with the same three methods can connect two players.

```js
const { received } = await PokeMZ.Trade.tradeWith(transport, $gameParty.pokemon()[0]);
```

### Plugin commands

`PokeMZ_PBS_Pokemon`: Give Pokémon, Give Egg, Heal Party, Open PC, Open Day Care, Move Reminder,
Check Evolution, Give Item, Party Has Species.
`PokeMZ_PBS_Battle`: Wild Battle (optional second species), Trainer Battle (optional second trainer
or partner). The result goes in a variable.
`PokeMZ_PBS_Followers`: Toggle Follower, Follower Emote, Talk To Follower.
`PokeMZ_PBS_Trade`: NPC Trade.

### Tools

Run these from `tools/` (run `npm install` there first):

| | |
|---|---|
| `npm run pbs import` | Fill the PBS files from Showdown and PokeAPI and merge names (with official translations) into the locale CSVs. Options: `--only pokemon,moves`, `--dry-run`, `--offline` |
| `npm run pbs check` | Validate the PBS files (exit code 1 on errors) |
| `npm run pbs items` | Create tagged `Items.json` entries for PBS items. Close the editor first |
| `npm run pbs gfx` | List species without graphics (battlers, icons, overworld sheets) |
| `npm run build:showdown` | Rebuild `js/plugins/PS_Sim.js` |
| `npm test` | All tests |

Showdown has no growth rates, catch rates, base EXP, EV yields, egg cycles or Pokédex text. The
importer takes those from [PokeAPI's CSV data](https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv),
which is downloaded once into `tools/.cache/`.
