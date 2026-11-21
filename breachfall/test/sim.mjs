// Headless checks of the rules the game depends on: the level builds, zones start sealed off from each other,
// each gate opens for the right weapon tier and no lower one, and cut-off pieces are found and lifted out.
import { SX, SY, SZ, FY, UFY, VOX, WEAPONS, MAT } from '../src/config.js';
import { World, hash3 } from '../src/voxels.js';
import { meshBox } from '../src/mesher.js';
import { buildMap, zoneAt } from '../src/map.js';
import { Nav } from '../src/nav.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails++; };
const ms = (f) => { const t = performance.now(); const r = f(); return [r, performance.now() - t]; };

const world = new World(SX, SY, SZ);
const [map, tMap] = ms(() => buildMap(world));
let solid = 0; for (let i = 0; i < world.data.length; i++) if (world.data[i]) solid++;
console.log(`map built in ${tMap.toFixed(0)} ms, ${(solid / 1e6).toFixed(2)} M solid voxels`);
ok(world.data.every((m) => m < MAT.length), 'every voxel is a known material');

let quads = 0;
const [, tMesh] = ms(() => { for (let cy = 0; cy < world.cy; cy++) for (let cz = 0; cz < world.cz; cz++) for (let cx = 0; cx < world.cx; cx++) quads += meshBox(world.data, SX, SY, SZ, [cx * 32, cy * 32, cz * 32], [cx * 32 + 32, cy * 32 + 32, cz * 32 + 32]).quads; });
console.log(`meshed ${world.cx * world.cy * world.cz} chunks in ${tMesh.toFixed(0)} ms, ${quads} quads`);
ok(quads > 5000 && quads < 900000, 'quad count is sane');

const [nav, tNav] = ms(() => new Nav(world));
console.log(`nav built in ${tNav.toFixed(0)} ms`);
const P = map.spawn;
const fy0 = map.floorY;
ok(nav.walkable(P.x, fy0, P.z), 'player spawn is walkable');
ok(!world.boxSolid(P.x - 0.25, map.floorY, P.z - 0.25, P.x + 0.25, map.floorY + 1.75, P.z + 0.25), 'player spawn is clear');
const zy = (zn) => (zn.under ? map.underY : fy0);
for (const zn of map.zones) for (const s of zn.spawns) { ok(nav.walkable(s[0], zy(zn), s[1]) && zoneAt(map, s[0], s[1], zy(zn)) === zn, `zone ${zn.id} spawn ${s} is walkable and inside its zone`); }
for (const c of map.crates) ok(zoneAt(map, c.x, c.z)?.id === c.zone, `crate spot in zone ${c.zone}`);

const reach = (zid) => { const zn = map.zones.find((z) => z.id === zid); const s = zn.spawns[0] || { E: [40, 42.5], G: [40, 36] }[zid]; return nav.reachable(s[0], zy(zn), s[1]); };
const flow = () => { const [, t] = ms(() => nav.flow([{ x: P.x, y: fy0, z: P.z }])); return t; };
console.log(`flow field in ${flow().toFixed(1)} ms`);
ok(map.zones[0].spawns.every((s) => nav.reachable(s[0], fy0, s[1])), 'all safehouse spawns reach the player');
ok(!reach('B') && !reach('C') && !reach('D') && !reach('E') && !reach('F') && !reach('G'), 'zones B to G start sealed');

// fire a weapon at a wall point from a given side: n shots, each `pellets` hits scattered around the aim point
function shoot(wid, x, y, z, dx, dz, shots, tierBoost = 0, sweep = 0) {
  const W = WEAPONS[wid]; let removed = 0, islands = 0;
  for (let s = 0; s < shots; s++) for (let p = 0; p < W.pellets; p++) {
    const sp = W.kind === 'hit' ? 0.28 : 0, yy = y + sweep * ((s % 3) - 1) * 1.3, side = sweep ? ((s & 1) - 0.5) * 0.6 : 0;
    const ox = x - dx * 3 + ((hash3(s, p, 1) - 0.5) * sp * 2 + side) * (dz ? 1 : 0), oy = yy + (hash3(s, p, 2) - 0.5) * sp * 2, oz = z - dz * 3 + ((hash3(s, p, 3) - 0.5) * sp * 2 + side) * (dx ? 1 : 0);
    const h = world.raycast(ox, oy, oz, dx, 0, dz, 8); if (!h) continue;
    const hx = ox + dx * h.t, hz = oz + dz * h.t, c = W.kind === 'hit' ? 0.5 * VOX : 0;
    const r = world.carve(hx + dx * c, oy, hz + dz * c, W.dig, W.tier + tierBoost, 160, W.kind === 'hit' ? 1 : 1.25);
    removed += r.removed; islands += world.findIslands(r.seeds).length;
  }
  const b = world.takeDirtyBox(); if (b) nav.rebuildVoxBox(b);
  return { removed, islands };
}
const fy = map.floorY;

// tier 0 and the timber barricade
let r = shoot('rook', 15, fy + 1, 7.5, 1, 0, 40); flow();
ok(r.removed === 0 && !reach('B'), 'pistol cannot open the timber barricade');
r = shoot('breaker', 15, fy + 1.0, 7.5, 1, 0, 10, 0, 0.45); flow();
console.log(`  breaker: 10 shells removed ${r.removed} voxels, ${r.islands} loose pieces`);
ok(reach('B'), 'ten Breaker shells swept over the barricade open the timber barricade for zombies');
// can the player fit through? look for a 0.5 x 1.75 m gap somewhere along the gate
let fit = false; for (let z = 6.3; z < 8.8 && !fit; z += 0.0625) for (let up = 0; up <= 0.5; up += 0.125) if (!world.boxSolid(14.8, fy + up, z - 0.25, 15.5, fy + up + 1.75, z + 0.25)) fit = true;
ok(fit, 'the hole is big enough for the player (with a step up)');
ok(!reach('C'), 'warehouse still sealed');

// brick
r = shoot('breaker', 32.5, fy + 1, 14, 0, 1, 10); flow();
ok(r.removed === 0 && !reach('C'), 'shotgun does nothing to brick');
r = shoot('thumper', 32.5, fy + 1.5, 14, 0, 1, 1); flow();
console.log(`  thumper: 1 grenade removed ${r.removed} voxels, ${r.islands} loose pieces`);
ok(reach('C'), 'one Thumper grenade opens the brick wall');
ok(!reach('D'), 'research block still sealed');

// concrete
r = shoot('thumper', 28.5, fy + 1.5, 32, 0, 1, 3); flow();
ok(!reach('D'), 'grenades do not open concrete');
r = shoot('ramrod', 28.5, fy + 1.5, 32, 0, 1, 1); flow();
console.log(`  ramrod: 1 rocket removed ${r.removed} voxels, ${r.islands} loose pieces`);
ok(reach('D'), 'one rocket opens the concrete wall');

// steel
r = shoot('ramrod', 36, fy + 1.5, 39.5, 1, 0, 2); flow();
ok(!reach('E'), 'plain rockets do not open the vault');
r = shoot('ramrod', 36, fy + 1.5, 39.5, 1, 0, 2, 1); flow();
console.log(`  overclocked ramrod: 2 rockets removed ${r.removed} voxels`);
ok(reach('E'), 'overclocked rockets open the vault');
ok(reach('F'), 'the vault stairs lead down into the Undercroft');
// and the other way: from the arena floor the stairs climb back up to the street
nav.flow([{ x: 24, y: map.underY, z: 40 }]);
ok(nav.reachable(P.x, fy0, P.z), 'the Undercroft connects back up to the safehouse');
nav.flow([{ x: P.x, y: fy0, z: P.z }]);
ok(!reach('G'), 'the deep vault is still sealed');
r = shoot('ramrod', 36.5, map.underY + 1.5, 39.5, 1, 0, 3, 1); flow();
ok(world.get(Math.round(36.9 / VOX), Math.round((map.underY + 1.5) / VOX), Math.round(39.5 / VOX)) >= 55 && !reach('G'), 'overclocked rockets do nothing to vault alloy');
r = shoot('ramrod', 36.5, map.underY + 1.5, 39.5, 1, 0, 2, 2); flow();
console.log(`  fusion-charged rockets: removed ${r.removed} voxels`);
ok(reach('G'), 'fusion-charged rockets open the deep vault');
const vy = Math.round(map.underY / VOX) - 1, solidUnder = world.get(Math.round(40 / VOX), vy - 3, Math.round(38 / VOX));
ok(MAT[solidUnder].tier >= 9, 'the deep vault sits on unbreakable rock');

// structural: saw through the four legs of the water tank, the tank must come loose as one piece
let loose = [];
const [, tCut] = ms(() => { for (const [x, z] of [[13, 19], [15, 19], [13, 21], [15, 21]]) for (const y of [0.6, 0.9]) { const c = world.carve(x, fy + y, z, 0.5, 1); loose.push(...world.findIslands(c.seeds)); } });
const big = loose.reduce((a, b) => (b.n > (a?.n || 0) ? b : a), null);
console.log(`  tank: ${loose.length} loose pieces, largest ${big?.n} voxels, found in ${tCut.toFixed(1)} ms`);
ok(big && big.n > 3000, 'cutting the legs drops the water tank');
ok(world.get(Math.round(14 / VOX), FY + Math.round(4 / VOX), Math.round(18.8 / VOX)) === 0, 'the tank voxels left the grid');
ok(world.data.every((m) => m < 64), 'no flood-fill flags left behind');

const [, tBlast] = ms(() => { const c = world.carve(30, fy + 1, 22, 2.3, 3); world.findIslands(c.seeds); });
const [, tFloor] = ms(() => { const c = world.carve(20, fy, 40, 2.3, 3); world.findIslands(c.seeds); });
console.log(`  rocket into the research block floor (over the arena): ${tFloor.toFixed(1)} ms`);
console.log(`  rocket blast in the racks: ${tBlast.toFixed(1)} ms, ${world.dirtyChunks.size} chunks to remesh`);

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
