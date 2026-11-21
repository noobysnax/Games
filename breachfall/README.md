# Breachfall

A round-based zombie survival shooter in a fully destructible voxel city block, solo or in co-op with friends.
Every hit earns points; spend them on heavier guns off the walls or gamble on the crate. Heavier weapons break
tougher walls, and breaking a wall is how you reach the next part of the map. Anything that loses its support comes
down as a falling rigid body, and zombies come apart limb by limb.

Under the old vault is the Undercroft, where the Warden waits. Kill it, take its fusion core, blast open the deep
vault, and take the Matter Destroyer: grab zombies, loose debris or chunks ripped straight out of the walls, swing
them through the horde and throw them.

Everything is generated in the browser: the 48 × 16 × 48 m block is 7 million 12.5 cm voxels, the guns and zombies
are coloured boxes, and every sound is synthesised. No assets.

## Play

```bash
npm run dev
```

Then open http://localhost:8080/. Any static file server works; the page loads three.js from a CDN.
`dist/index.html` is the whole game in one file (rebuild with `npm run build` after `npm install`).

## Co-op

One player clicks **Host co-op** and gets a five-letter room code. Friends type the code and click **Join**. Friends
can join a game already in progress; they get the host's world exactly as it is, holes and all.

Co-op connects the browsers directly with WebRTC. PeerJS's free public server introduces them to each other, so
there is no server to run. It needs the game served from a normal web address. A file opened from disk or an
embedded preview (such as the claude.ai artifact view) cannot make the connection.

The easiest ways to put it online:

- **GitHub Pages**: in the repository's Settings → Pages, choose "Deploy from a branch", pick the branch, folder
  `/ (root)`, and save. The game is then at `https://<user>.github.io/<repo>/breachfall/dist/index.html`. Pages is
  free for public repositories.
- **itch.io**: create a new project, set "Kind of project" to HTML, zip `dist/index.html` and upload the zip, and tick
  "This file will be played in the browser".

How it works: the host's game runs the zombies, the rounds, the power-ups and the boss, and numbers every change to
the world. A wall breaking is an edit the host sends to everyone; the level and the carving maths are deterministic,
so every world stays identical. A piece of debris belongs to whoever set it moving or grabbed it, and that player
streams its position. A few networks (some phone carriers and office firewalls) block direct connections; those
players will not be able to join.

To test co-op locally, run your own PeerJS server (`npx peerjs --port 9000`) and add `?peer=localhost:9000` to the
address in each browser tab.

## How progression works

Every material has a breaking tier. A weapon breaks everything at or below its tier, and nothing above it.

| Material | Breaks with | Opens |
|---|---|---|
| Plaster, glass, crates | anything, even the knife | rooms inside the safehouse |
| Timber (striped barricades) | shotgun or rifle | Street & Yard |
| Brick | grenade launcher or frag grenades | Warehouse |
| Concrete | rocket launcher | Research Block |
| Vault steel | an overclocked launcher, or the Arc Lance from the crate | Vault, then the stairs down to the Undercroft |
| Vault alloy (purple) | any weapon charged by the Warden's fusion core | Deep Vault and the Matter Destroyer |
| Stone and blast walls | nothing | (the edge of the map, the Undercroft's walls and ceiling) |

The hazard-striped panels mark the intended breach points, but any wall of the right material can be broken.

## The Warden

Walking down the stairs in the vault's corner wakes the Warden, a three-metre zombie that walks straight through the
arena's pillars. It swipes anything close, slams the floor (jump to avoid the shockwave), rips boulders out of the
floor and throws them, and calls in runners. At half health it speeds up. Regular waves hold off while it is alive.
When it dies it drops a fusion core: picking it up charges every player's weapons so they can break vault alloy.

## The Matter Destroyer

| | Mouse | Controller | Touch |
|---|---|---|---|
| Grab (hold) | Left | RT | Fire |
| Disintegrate (hold) | Right | LT | Aim |

Grab picks up a zombie, a loose piece of debris, or rips a chunk out of whatever wall or floor you are pointing at.
Swing the view to swing what you hold; let go to throw it. Anything heavy moving fast tears through zombies (fast
enough and they burst apart along the swing) and smashes into walls, breaking them. Heavier pieces break tougher
walls. A thrown zombie bursts when it hits something hard. Disintegrate turns whatever the beam touches into dust;
use it while holding something to crush it. It never needs ammo.

## Zombies

Each zombie has six parts: two legs, a torso, two arms and a head. A shot works out which part it hit, and the killing
blow makes that part burst while the rest falls away as separate tumbling voxel pieces. A headshot pops the head; an
explosion throws every limb.

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
one in your hands. Power-ups sometimes drop from kills: max ammo, insta-kill, double points, detonation and bonus
points. In co-op they apply to everyone. A downed player comes back at the start of the next round; the game ends
when everyone is down.

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
| `src/map.js` | The level, written straight into the grid: safehouse, street, yard, warehouse, research block, vault, the Undercroft and the deep vault. |
| `src/mesher.js` | Greedy mesher, shared by the 32³ world chunks and every falling piece. |
| `src/gfx.js` | Renderer: chunk meshes, per-voxel colour grain, soft occlusion from a half-resolution copy of the grid in a 3D texture, sun shadows, lamp lights, bloom. |
| `src/fx.js` | Debris, fire and smoke, and the rigid bodies: pieces that break off, zombie limbs, held and thrown chunks. |
| `src/nav.js` | Two-layer walkable grid (street level and underground, joined by the stairs), rebuilt after every break, with a distance field to the nearest player. |
| `src/zombies.js` | The horde and the Warden: pathing, clawing, attacks, per-part hit tests, gibs, and the mirrored copy co-op clients draw. |
| `src/net.js`, `src/remote.js` | Co-op connection (PeerJS) and the other players' soldiers, name tags and beams. |
| `src/player.js` | First-person body against the voxels, with step-up over rubble. |
| `src/main.js` | Weapons, Matter Destroyer, wall buys, crate, power-ups, rounds, boss fight, co-op messages, screens and the frame loop. |
| `src/models.js`, `src/hud.js`, `src/input.js`, `src/audio.js` | Box models, HUD, keyboard/mouse/pad/touch input, synthesised sound. |

## Tests

```bash
npm test
```

builds the level without a browser and checks that it holds together: every zone starts sealed, each gate opens for
its weapon tier and not for the tier below, the holes are big enough to walk through, the stairs connect the street
to the Undercroft in both directions, vault alloy only gives way to fusion-charged weapons, and cutting the water
tower's legs drops the tank as one piece.
