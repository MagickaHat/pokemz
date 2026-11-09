# FMOD banks

Put the `.bank` files built by FMOD Studio here. The `PokeMZ_FMOD_*` plugins load them at
runtime. With no banks, or if FMOD can't start, the game uses MZ's normal `.ogg` audio.

## Building banks

1. Use FMOD Studio **2.03** (the same version as `js/libs/fmodstudio.js`, currently 2.03.15).
   Banks built with a newer Studio version won't load.
2. In *Edit → Preferences → Build*, choose the **HTML5** platform (or Desktop) with
   FADPCM/Vorbis encoding. Turn on **"Build metadata and assets to separate banks"** only if you
   also list the `.assets.bank` files as banks.
3. *File → Build*, then copy the files from `Build/<Platform>/` into this folder.

Expected layout:

```
audio/fmod/
  Master.bank            always loaded (startup bank)
  Master.strings.bank    always loaded: needed to find events by path
  Music.bank             optional, add to "Startup Banks" or load per map
  Forest.bank            optional, loaded with <FMOD Bank: Forest> in a map note
```

Startup banks are set in `PokeMZ_FMOD_Core` → *Startup Banks*. Other banks load per map
(`<FMOD Bank: A, B>` map note, and the map waits for them) or with the *Load Bank* plugin
command.

## Studio project conventions

| What | Where in Studio | Used by |
|---|---|---|
| MZ BGM `Battle1` | `event:/BGM/Battle1` | Play BGM, map BGM, battle BGM |
| MZ BGS `River` | `event:/BGS/River` | Play BGS |
| MZ ME `Victory1` | `event:/ME/Victory1` | Play ME, victory/defeat |
| MZ SE `Cursor3` | `event:/SE/Cursor3` | Play SE, animations |
| System sounds | `event:/System/Cursor`, `Ok`, `Cancel`, `Buzzer`, `Equip`, `Save`, `Load`, `BattleStart`, `Escape`, `EnemyAttack`, ... `UseSkill` | Menus, battles |
| Option sliders | `vca:/Master`, `vca:/BGM`, `vca:/BGS`, `vca:/ME`, `vca:/SE` | Options screen |
| ME duck | `snapshot:/MEDuck` | ME Behaviour = duck |
| MZ pan | local parameter `Pan` (-1..1) | optional |

Names that don't match go through the *Name Mapping* table in `PokeMZ_FMOD_Audio`, and
anything without an event plays the `.ogg` as before. So you can move to FMOD one sound at a
time.

- **Looping** is authored in Studio (loop regions). MZ's loop flag is ignored.
- **BGM/BGS** should be 2D (no spatializer). **Emitters and one-shots at a position** need a
  spatializer. Their min/max distances are in tiles (*Tiles Per Meter* in Core).
- **Global parameters** (e.g. `TimeOfDay`, `Weather`) are kept in save files.
- **Timeline markers** named `Switch:12=on`, `Variable:5=3` or `CommonEvent:7` act on the game.
- **Programmer sounds** (e.g. one `event:/Cry` for every cry): put the files in an audio
  table, then use *Play Programmer Sound* with the audio table key. Loose files aren't
  supported in the HTML5 build.
- **Snapshots** for menus and battles can be set in `PokeMZ_FMOD_Audio`
  (*Menu Snapshot*, *Battle Snapshot*).

## Upgrading the FMOD library

Download the **FMOD Engine HTML5** package and copy `api/studio/lib/upstream/wasm/fmodstudio.js`
and `fmodstudio.wasm` (the wasm build) to `js/libs/`. Then **re-apply this one edit** in
`fmodstudio.js`, or NW.js (Windows/Mac/Linux builds) will treat FMOD as a Node module and fail:

```
var ENVIRONMENT_IS_NODE=typeof process=="object"&&...
```
becomes
```
var ENVIRONMENT_IS_NODE=false&&typeof process=="object"&&...
```

`node --test tests/fmod.test.js` checks that the edit is there. Thanks to Creta Park's
[FMOD_MV.js](https://github.com/creta5164/fmod-rmmv) for documenting this fix.

## Deployment

MZ's *Exclude unused files* can't see this folder or `js/libs/fmodstudio.*`. Check that they
are in the deployed game.

FMOD is free for small indie budgets but needs a licence registration with Firelight
Technologies. Credit "FMOD Studio by Firelight Technologies Pty Ltd." in the game.
