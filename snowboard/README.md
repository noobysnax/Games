# Lanternvale Slopes

A voxel snowboarding game in the same style as Lanternvale Skies: procedural pixel-art blocks, golden-hour
sky and fog, bloom, lanterns that light the piste at night. One small mountain, about 40 seconds top to bottom:

Summit drop-in → rollers → first kicker → banked lantern bends → rail garden → big kicker → gully → lodge.

Everything is generated in the browser. No assets, no build step needed to play.

## Play

```bash
npm run dev
```

Then open http://localhost:8080/. Any static file server works too; the page loads three.js from a CDN.

`dist/index.html` is the whole game in one file (rebuild it with `npm run build` after `npm install`).

## Controls

| | Keyboard | Xbox controller | Touch |
|---|---|---|---|
| Carve / spin in the air | A D | Left stick | Left thumb stick |
| Push off and tuck | W | Stick up | Stick up |
| Brake | S | LT, or stick down | Stick down |
| Front flip / back flip (air) | W / S | Stick up / down | Stick up / down |
| Jump (hold to crouch, release to pop) | Space | A | Jump |
| Speed boost | Shift | RT | Boost |
| Barrel roll (air) | Q E | LB RB | |
| Grabs (air) | Arrow keys, combine two for more | Right stick, eight directions; B X Y | Hold Grab, drag for direction |
| Restart run / pause | R / Esc | View / Menu | Pause button |

Also on the keyboard: 1–4 time of day, T time-lapse, G quality, M sound, H hide the HUD.

Things worth knowing:

- Land with the board flat on the snow and pointing along your direction of travel. Regular or switch both count.
  Let go of the stick and the rider settles toward the nearest clean landing by itself.
- Tucking (forward) never turns into a front flip by accident: push forward again once you are in the air.
- Hold a direction while you crouch to wind up a spin, or pull back as you pop for a back flip.
- Rails start flush with the snow, so you can ride straight onto them. Steer on a rail to swing between a
  50-50 and a boardslide; jump off before the end to keep the combo going into the air.
- Tricks fill the boost meter. Clean landings raise the flow multiplier; a crash resets it.
- A controller is picked up as soon as you press a button. If the page is embedded in another site and the
  controller is ignored, open the game in its own tab.

## How it is put together

| File | What it does |
|---|---|
| `src/course.js` | The mountain as one height function, plus kickers, rails, trees, lanterns. Samples it into a 0.5 m physics grid (read through a cubic B-spline) and 1 m voxel columns. |
| `src/physics.js` | Rider physics at a fixed 120 Hz: edge grip, air rotation, rails, crashes, trick scoring. `TUNE` at the top holds every feel constant. |
| `src/input.js` | Keyboard, Gamepad API and touch merged into one input state. |
| `src/gfx.js` | Renderer, pixel-art atlas, sky, fog, time of day, post-processing. |
| `src/world.js` | Voxel meshes: snow columns, far ranges, trees, lodge, rails. |
| `src/riderRig.js` | The blocky rider, posed with two-bone IK. |
| `src/fx.js`, `src/audio.js` | Snow spray, board track, sparks, snowfall; procedural sound. |
| `src/main.js` | Loop (fixed step + render interpolation), chase camera, HUD, menus. |

The rider never touches the voxels directly. Physics runs on a smooth surface fitted through them, and the
board is lifted just enough to sit on the edges of the steps, which is why riding feels smooth on blocky snow.

## Tuning and tests

```bash
npm test
```

runs bot riders down the course without a browser and checks that the run is rideable (finishes, air time off
both kickers, rails catch, tricks score). It prints speeds and air times per section, which is the quickest way
to see what a change to `TUNE` or the course profile does.

To reshape the hill, edit `SLOPE_KEYS`, `KICKERS` and `RAIL_DEFS` in `src/course.js`.
