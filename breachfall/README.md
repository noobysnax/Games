# Breachfall

A round-based zombie survival shooter in a fully destructible voxel city block. Every hit earns points; spend them
on heavier guns off the walls or gamble on the crate. Heavier weapons break tougher walls, and breaking a wall is
how you reach the next part of the map. Anything that loses its support comes down as a falling rigid body.

Everything is generated in the browser: the 48 × 48 m block is 1.8 million 12.5 cm voxels, the guns and zombies
are coloured boxes, and every sound is synthesised. No assets.

## Play

```bash
npm run dev
```

Then open http://localhost:8080/. Any static file server works; the page loads three.js from a CDN.
`dist/index.html` is the whole game in one file (rebuild with `npm run build` after `npm install`).

## How progression works

Every material has a breaking tier. A weapon breaks everything at or below its tier, and nothing above it.

| Material | Breaks with | Opens |
|---|---|---|
| Plaster, glass, crates | anything, even the knife | rooms inside the safehouse |
| Timber (striped barricades) | shotgun or rifle | Street & Yard |
| Brick | grenade launcher or frag grenades | Warehouse |
| Concrete | rocket launcher | Research Block |
| Vault steel | an overclocked launcher, or the Arc Lance from the crate | Vault |
| Blast walls | nothing | (the edge of the map) |

The hazard-striped panels mark the intended breach points, but any wall of the right material can be broken.
Shooting something too tough throws sparks and tells you what it needs.

## Buying

| | Where | Price |
|---|---|---|
| Ranger M2 carbine | Safehouse, south wall | 600 |
| Breaker 12 shotgun | Safehouse, west wall | 1,000 |
| Wasp 9 SMG | Street, south wall | 1,200 |
| Kestrel AR | Street, east wall | 1,800 |
| Thumper GL | Yard, west wall | 3,000 |
| Hog MG | Warehouse, east wall | 4,000 |
| Ramrod RL | Warehouse, east wall | 5,500 |
| Frag grenades (4) | Yard, west wall | 750 |
| Armour plating (200 health) | Warehouse office | 2,500 |
| Overclock bench (+1 tier, 2.2× damage, bigger magazine) | Research Block | 5,000 |
| Mystery crate (random weapon) | starts in the safehouse | 950 |

Buying a weapon you already own refills its ammo for half price. You carry two weapons; buying a third replaces the
one in your hands. The crate holds everything on the walls plus the Mauler auto shotgun, Longbow sniper and the Arc
Lance. After a few spins it may relocate to another area you have opened, and refunds that spin.

Power-ups sometimes drop from kills: max ammo, insta-kill, double points, detonation (kills everything) and bonus points.
The vault holds a free overclock and gold bars that pay out when you shoot them.

## Controls

| | Keyboard and mouse | Controller | Touch |
|---|---|---|---|
| Move | W A S D | Left stick | Left thumb |
| Look | Mouse | Right stick | Right thumb |
| Fire / aim | Left / right mouse | RT / LT | Fire (hold) / Aim (toggle) |
| Sprint | Shift | Left stick click | Push the left thumb to the top |
| Jump | Space | A | Jump |
| Reload | R | X | Reload |
| Swap weapon | Q, wheel, 1 2 | Y | Swap |
| Frag / knife | G / V | RB / LB | Frag / Knife |
| Buy, use, take | E | X | Use |
| Pause | Esc | Menu | II |

M toggles sound. If the page cannot capture the mouse (some embedded views), hold a mouse button and drag to look.

## How it is put together

| File | What it does |
|---|---|
| `src/config.js` | Voxel size, materials and their breaking tiers, weapon stats, prices. |
| `src/voxels.js` | The voxel grid: ray casts, ragged-sphere carving per tier, and the flood fill that finds pieces no longer connected to the ground. |
| `src/map.js` | The level, written straight into the grid: safehouse, street, yard, warehouse, research block, vault. Wall buys, crate spots, zone outlines. |
| `src/mesher.js` | Greedy mesher, shared by the 32³ world chunks and falling pieces. |
| `src/gfx.js` | Renderer: chunk meshes, per-voxel colour grain, soft occlusion read from a half-resolution copy of the grid in a 3D texture, sun shadows, lamp lights, bloom. |
| `src/fx.js` | Debris chips, fire and smoke, and the rigid-body pieces that break off, tumble, crush and crumble. |
| `src/nav.js` | Walkable grid rebuilt from the voxels after every break, and a distance field to the player the horde follows. |
| `src/zombies.js` | The horde: pathing, clawing through flimsy walls when there is no route, attacks, instanced rendering. |
| `src/player.js` | First-person body against the voxels, with step-up over rubble. |
| `src/main.js` | Weapons, wall buys, crate, power-ups, rounds, viewmodel, screens and the frame loop. |
| `src/models.js`, `src/hud.js`, `src/input.js`, `src/audio.js` | Box models, HUD, keyboard/mouse/pad/touch input, synthesised sound. |

## Tests

```bash
npm test
```

builds the level without a browser and checks that it holds together: every zone starts sealed, each gate opens
for its weapon tier and not for the tier below, the holes are big enough to walk through, and cutting the water
tower's legs drops the tank as one piece.
