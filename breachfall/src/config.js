// Shared constants and data tables: world size, materials, weapons. No three.js here, so tests can import it.

export const VOX = 0.125;                 // metres per voxel
export const SX = 384, SY = 128, SZ = 384; // 48 x 16 x 48 m
export const CH = 32;                     // chunk edge in voxels
export const FY = 46;                     // voxel y of the street-level ground surface
export const UFY = 6;                     // voxel y of the underground arena floor
export const NAV = 4;                     // voxels per nav cell (0.5 m)

// tier: the weakest weapon tier that can break it. 0 anything, 1 shotguns and rifles, 2 explosives,
// 3 rockets, 4 overclocked or arc weapons, 5 fusion-charged weapons or the Matter Destroyer, 9 never.
const M = (name, tier, color, jit = 0.14, glow = 0) => ({ name, tier, color, jit, glow });
export const MAT = [
  M('air', 0, 0x000000),
  M('bedrock', 9, 0x2a2b30, 0.10),          // 1
  M('asphalt', 2, 0x3f4046, 0.16),          // 2
  M('dirt', 1, 0x5b4a36, 0.22),             // 3
  M('floor tile', 2, 0x8d8473, 0.08),       // 4
  M('timber', 1, 0xa87a45, 0.20),           // 5
  M('dark timber', 1, 0x6e4a2a, 0.20),      // 6
  M('plaster', 0, 0xd9d2c0, 0.07),          // 7
  M('glass', 0, 0x9fd0dc, 0.05),            // 8
  M('brick', 2, 0x9a4a36, 0.16),            // 9
  M('brick', 2, 0x84392b, 0.16),            // 10
  M('concrete', 3, 0x8e9094, 0.09),         // 11
  M('concrete', 3, 0x76787d, 0.09),         // 12
  M('vault steel', 4, 0x56636f, 0.06),      // 13
  M('sheet metal', 2, 0x6f8089, 0.10),      // 14
  M('timber', 1, 0xe2b530, 0.10),           // 15 hazard paint on timber
  M('brick', 2, 0xe2b530, 0.10),            // 16 hazard paint on brick
  M('concrete', 3, 0xe2b530, 0.10),         // 17 hazard paint on concrete
  M('vault steel', 4, 0xe2b530, 0.08),      // 18 hazard paint on steel
  M('timber', 1, 0x1c1c1e, 0.10),           // 19 black stripe on timber
  M('lamp', 0, 0xffd9a0, 0.0, 1),           // 20
  M('leaves', 0, 0x4f6b35, 0.30),           // 21
  M('trunk', 1, 0x4a3524, 0.18),            // 22
  M('rusted steel', 2, 0x8a4f2e, 0.24),     // 23
  M('crate', 0, 0xc09a5c, 0.16),            // 24
  M('blast wall', 9, 0x34363d, 0.07),       // 25
  M('blast wall', 9, 0x2b2d33, 0.07),       // 26
  M('brick', 2, 0x1c1c1e, 0.10),            // 27 black stripe on brick
  M('concrete', 3, 0x1c1c1e, 0.10),         // 28 black stripe on concrete
  M('vault steel', 4, 0x1c1c1e, 0.08),      // 29 black stripe on steel
  M('grass', 1, 0x5d7038, 0.26),            // 30
  M('fabric', 0, 0x7a2f2f, 0.12),           // 31
  M('painted metal', 2, 0x2f5d7a, 0.12),    // 32
  M('painted metal', 2, 0x7a6a2f, 0.12),    // 33
  M('lab tile', 3, 0xc9d2d4, 0.05),         // 34
  M('gold', 0, 0xf0c040, 0.10, 0.35),       // 35
  M('screen', 0, 0x60e0c0, 0.0, 1),         // 36
  M('blood', 0, 0x6a1410, 0.20),            // 37
  M('flesh', 0, 0x8a2a20, 0.22),            // 38
  M('bone', 0, 0xd8cdb0, 0.10),             // 39
  M('skin', 0, 0x7d9070, 0.16),             // 40
  M('skin', 0, 0x8a9a82, 0.16),             // 41
  M('skin', 0, 0x6f8068, 0.16),             // 42
  M('skin', 0, 0x93a08a, 0.16),             // 43
  M('cloth', 0, 0x5a4a42, 0.18),            // 44
  M('cloth', 0, 0x3f4f5e, 0.18),            // 45
  M('cloth', 0, 0x6b5a3a, 0.18),            // 46
  M('cloth', 0, 0x4a3a4a, 0.18),            // 47
  M('cloth', 0, 0x6a2f2a, 0.18),            // 48
  M('cloth', 0, 0x39483a, 0.18),            // 49
  M('cloth', 0, 0x777a80, 0.18),            // 50
  M('cloth', 0, 0x2c2f38, 0.16),            // 51
  M('cloth', 0, 0x3a3328, 0.16),            // 52
  M('cloth', 0, 0x26282c, 0.16),            // 53
  M('cloth', 0, 0x33303a, 0.16),            // 54
  M('vault alloy', 5, 0x2a2440, 0.06),      // 55
  M('vault alloy', 5, 0x9a70ff, 0.04, 0.6), // 56 glowing seam
  M('arena stone', 9, 0x3a3532, 0.16),      // 57
  M('arena stone', 9, 0x2e2a28, 0.16),      // 58
  M('warning lamp', 0, 0xff5030, 0.0, 1),   // 59
  M('boss hide', 0, 0x4a5a3e, 0.18),        // 60
  M('boss plate', 0, 0x5a3a2a, 0.14),       // 61
  M('core', 0, 0xb080ff, 0.0, 1),           // 62
];
export const ID = {
  AIR: 0, BEDROCK: 1, ASPHALT: 2, DIRT: 3, TILE: 4, TIMBER: 5, TIMBER_D: 6, PLASTER: 7, GLASS: 8, BRICK: 9, BRICK_B: 10,
  CONC: 11, CONC_B: 12, STEEL: 13, SHEET: 14, HAZ1: 15, HAZ2: 16, HAZ3: 17, HAZ4: 18, BLK1: 19, LAMP: 20, LEAF: 21, TRUNK: 22,
  RUST: 23, CRATE: 24, WALL: 25, WALL_B: 26, BLK2: 27, BLK3: 28, BLK4: 29, GRASS: 30, FABRIC: 31, PAINT_B: 32, PAINT_Y: 33,
  LABTILE: 34, GOLD: 35, SCREEN: 36, BLOOD: 37, FLESH: 38, BONE: 39, SKIN0: 40, SHIRT0: 44, PANTS0: 51,
  ALLOY: 55, ALLOY_GLOW: 56, ROCK: 57, ROCK_B: 58, RED_LAMP: 59, BOSS_HIDE: 60, BOSS_PLATE: 61, CORE: 62,
};
export const TIER_NEED = ['', 'a shotgun or rifle', 'explosives', 'a rocket launcher', 'an overclocked launcher or the Arc Lance', 'the Warden\'s fusion core'];

// kind: hit (hitscan), nade (lobbed, explodes on impact), rocket, beam.
// dig: carve radius in metres per hit. tier: toughest material it can break.
export const WEAPONS = {
  rook:    { name: 'Rook .45', cls: 'Pistol', kind: 'hit', dmg: 30, rpm: 380, auto: false, mag: 8, reserve: 64, reload: 1.3, spread: 0.012, pellets: 1, tier: 0, dig: 0.11, recoil: 0.018, head: 2.2, snd: 'pistol' },
  ranger:  { name: 'Ranger M2', cls: 'Carbine', kind: 'hit', dmg: 78, rpm: 300, auto: false, mag: 12, reserve: 96, reload: 1.9, spread: 0.006, pellets: 1, tier: 1, dig: 0.22, recoil: 0.026, head: 2.5, pen: 1, snd: 'rifle' },
  breaker: { name: 'Breaker 12', cls: 'Shotgun', kind: 'hit', dmg: 42, rpm: 78, auto: false, mag: 6, reserve: 42, reload: 2.3, spread: 0.075, pellets: 8, tier: 1, dig: 0.58, recoil: 0.07, head: 1.3, range: 22, snd: 'shotgun' },
  wasp:    { name: 'Wasp 9', cls: 'SMG', kind: 'hit', dmg: 31, rpm: 820, auto: true, mag: 32, reserve: 192, reload: 1.7, spread: 0.028, pellets: 1, tier: 0, dig: 0.11, recoil: 0.012, head: 1.8, snd: 'smg' },
  kestrel: { name: 'Kestrel AR', cls: 'Assault rifle', kind: 'hit', dmg: 48, rpm: 640, auto: true, mag: 30, reserve: 210, reload: 2.1, spread: 0.016, pellets: 1, tier: 1, dig: 0.21, recoil: 0.016, head: 2.0, snd: 'rifle' },
  mauler:  { name: 'Mauler A12', cls: 'Auto shotgun', kind: 'hit', dmg: 36, rpm: 260, auto: true, mag: 10, reserve: 60, reload: 2.8, spread: 0.085, pellets: 7, tier: 1, dig: 0.48, recoil: 0.05, head: 1.3, range: 20, snd: 'shotgun' },
  hog:     { name: 'Hog MG', cls: 'Light machine gun', kind: 'hit', dmg: 58, rpm: 560, auto: true, mag: 90, reserve: 360, reload: 4.2, spread: 0.022, pellets: 1, tier: 1, dig: 0.24, recoil: 0.018, head: 1.8, pen: 1, snd: 'lmg' },
  longbow: { name: 'Longbow .50', cls: 'Sniper rifle', kind: 'hit', dmg: 520, rpm: 52, auto: false, mag: 5, reserve: 40, reload: 2.9, spread: 0.001, pellets: 1, tier: 2, dig: 0.42, recoil: 0.11, head: 3.0, pen: 4, zoom: 3.2, snd: 'sniper' },
  thumper: { name: 'Thumper GL', cls: 'Grenade launcher', kind: 'nade', dmg: 700, rpm: 70, auto: false, mag: 4, reserve: 20, reload: 3.0, spread: 0.004, pellets: 1, tier: 2, dig: 1.8, recoil: 0.06, snd: 'thump' },
  ramrod:  { name: 'Ramrod RL', cls: 'Rocket launcher', kind: 'rocket', dmg: 1200, rpm: 46, auto: false, mag: 1, reserve: 12, reload: 2.6, spread: 0.002, pellets: 1, tier: 3, dig: 2.4, recoil: 0.09, snd: 'rocket' },
  matter:  { name: 'Matter Destroyer', cls: 'Left: grab and throw · Right: disintegrate', kind: 'matter', dmg: 0, rpm: 600, auto: true, mag: Infinity, reserve: Infinity, reload: 0, spread: 0, pellets: 1, tier: 5, dig: 0.42, recoil: 0, snd: 'arc' },
  arc:     { name: 'Arc Lance', cls: 'Experimental', kind: 'beam', dmg: 95, rpm: 900, auto: true, mag: 120, reserve: 360, reload: 3.2, spread: 0, pellets: 1, tier: 4, dig: 0.5, recoil: 0.002, head: 1.5, snd: 'arc' },
};
for (const k in WEAPONS) WEAPONS[k].id = k;
export const CRATE_POOL = ['ranger', 'breaker', 'wasp', 'kestrel', 'mauler', 'hog', 'longbow', 'thumper', 'ramrod', 'arc'];
export const CRATE_WEIGHT = { ranger: 6, breaker: 6, wasp: 8, kestrel: 10, mauler: 9, hog: 9, longbow: 8, thumper: 7, ramrod: 6, arc: 3 };

export const PRICES = { crate: 950, bench: 5000, plating: 2500, frags: 750 };
export const FRAG = { dmg: 650, dig: 1.6, tier: 2, fuse: 2.2 };
