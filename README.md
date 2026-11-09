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
`Area.Screen.Item`. MZ escape codes such as `\N[1]` work in values. The Core `Language`
parameter picks the column; missing cells fall back to `en`, then to the key. A future
localization plugin can take over lookups with `PokeMZ.UI.strings.setProvider({get(key)})`.

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
