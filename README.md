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
3. Give tall B-E tiles (trees, signs, fences) terrain tag **7** to stand them up,
   and ledge tiles terrain tag **6** (and make them impassable).

### Map note tags

```
<3D>
<3D Camera: pitch=55 yaw=0 distance=14 fov=30>
<3D Smooth: 0.5>
<3D Water: depth=0.2 opacity=0.85 bed=#1c3550>
<3D Fog: #b8d0e8 near=20 far=45>
<3D Clamp: off>
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
<3D Model: pokeball.glb scale=0.5 turn keepSprite>
<3D Light: #ffaa55 radius=4 intensity=1 height=1 flicker>
```

### Plugin commands

`PokeMZ_Three_Core`: Camera Follow, Pan To Tile, Set Angle, Offset, Shake,
Reset (all eased, optionally waiting), Rebuild Terrain.
`PokeMZ_Three_Lighting`: Set Time Of Day (day, dawn, dusk, night).

Remember to ship the `models/` folder: MZ's "Exclude unused files" can't see it.
