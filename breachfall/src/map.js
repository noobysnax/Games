// The level, written straight into the voxel grid. Coordinates below are metres; y is height above the floor.
//
//   z 48 +---------------------------+-----------+
//        | D  research block         | E  vault  |
//   z 32 +----------+----------------+-----------+
//        | B  yard  | C  warehouse               |
//   z 16 +----------+                            |
//        | A  safe- +----------------------------+ z 14
//        |    house | B  street                  |
//   z 0  +----------+----------------------------+
//
// A is walled in brick with two timber barricades (tier 1). C is brick (tier 2), D concrete (tier 3),
// E steel (tier 4). Every wall of a tier breaks the same way, the hazard-striped panels are just hints.

import { VOX, SX, SY, SZ, FY, ID } from './config.js';
import { hash3 } from './voxels.js';

export function buildMap(w) {
  const { BEDROCK, ASPHALT, DIRT, TILE, TIMBER, TIMBER_D, PLASTER, GLASS, BRICK, BRICK_B, CONC, CONC_B, STEEL, SHEET, HAZ1, HAZ2, HAZ3, HAZ4,
    BLK1, LAMP, LEAF, TRUNK, RUST, CRATE, WALL, WALL_B, BLK2, BLK3, BLK4, GRASS, FABRIC, PAINT_B, PAINT_Y, LABTILE, GOLD, SCREEN } = ID;
  const v = (m) => Math.round(m / VOX);
  const box = (x0, y0, z0, x1, y1, z1, mat) => w.fill(v(x0), FY + v(y0), v(z0), v(x1), FY + v(y1), v(z1), mat);
  const brick = (x, y, z) => { const row = y >> 1, bi = Math.floor((x + z + (row & 1) * 3) / 5); return hash3(bi, row, 7) < 0.34 ? BRICK_B : BRICK; };
  const planksV = (x, y, z) => (hash3(Math.floor((x + z) / 3), 0, 3) < 0.4 ? TIMBER_D : TIMBER);
  const planksH = (x, y, z) => (hash3(Math.floor(x / 3), 1, 0) < 0.4 ? TIMBER_D : TIMBER);
  const conc = (x, y, z) => (((x + z) % 16 === 0 || (y - FY) % 16 === 15) ? CONC_B : CONC);
  const blast = (x, y, z) => ((y - FY) % 12 >= 10 || (x + z) % 32 === 0 ? WALL_B : WALL);
  const stripes = (a, b) => (x, y, z) => (((x + y + z) >> 2) & 1 ? a : b);
  const lamps = [];
  const lamp = (x, y, z, color = 0xffc98a, power = 1, size = 2) => {
    const vx = v(x), vy = FY + v(y), vz = v(z);
    w.fill(vx - (size >> 1), vy, vz - (size >> 1), vx + ((size + 1) >> 1), vy + 1, vz + ((size + 1) >> 1), LAMP);
    lamps.push({ x, y: (vy - 1) * VOX, z, color, power, vox: [vx, vy, vz] });
  };
  const sphere = (cx, cy, cz, r, mat, fillP = 1) => {
    const X = v(cx), Y = FY + v(cy), Z = v(cz), R = r / VOX;
    w.fill(Math.floor(X - R), Math.floor(Y - R), Math.floor(Z - R), Math.ceil(X + R), Math.ceil(Y + R), Math.ceil(Z + R),
      (x, y, z) => { const d = (x - X) ** 2 + (y - Y) ** 2 + (z - Z) ** 2; return d < R * R * (0.7 + 0.5 * hash3(x >> 1, y >> 1, z >> 1)) && hash3(x, y, z) < fillP ? mat : -1; });
  };
  const cyl = (cx, cz, y0, y1, r, mat, wall = 0) => {
    const X = v(cx), Z = v(cz), R = r / VOX, Ri = wall ? R - wall : -1;
    w.fill(Math.floor(X - R), FY + v(y0), Math.floor(Z - R), Math.ceil(X + R), FY + v(y1), Math.ceil(Z + R),
      (x, y, z) => { const d = (x + 0.5 - X) ** 2 + (z + 0.5 - Z) ** 2; return d < R * R && d >= Ri * Math.abs(Ri) ? mat : -1; });
  };
  // paint a striped frame onto an existing wall slab (keeps the middle as it is)
  const frame = (x0, y0, z0, x1, y1, z1, a, b) => {
    const X0 = v(x0), X1 = v(x1), Z0 = v(z0), Z1 = v(z1), Y0 = FY + v(y0), Y1 = FY + v(y1), s = stripes(a, b), alongX = X1 - X0 > Z1 - Z0;
    w.fill(X0, Y0, Z0, X1, Y1, Z1, (x, y, z) => {
      const p = alongX ? x - X0 : z - Z0, n = alongX ? X1 - X0 : Z1 - Z0;
      return (p < 3 || p >= n - 3 || y >= Y1 - 3) ? s(x, y, z) : -1;
    });
  };
  const crate = (x, z, s = 0.75, y = 0, mat = CRATE) => {
    box(x, y, z, x + s, y + s, z + s, mat);
    const X0 = v(x), X1 = v(x + s) - 1, Z0 = v(z), Z1 = v(z + s) - 1, Y0 = FY + v(y), Y1 = FY + v(y + s) - 1;
    w.fill(X0, Y0, Z0, X1 + 1, Y1 + 1, Z1 + 1, (xx, yy, zz) => {
      const e = (xx === X0 || xx === X1 ? 1 : 0) + (yy === Y0 || yy === Y1 ? 1 : 0) + (zz === Z0 || zz === Z1 ? 1 : 0);
      return e >= 2 ? TIMBER_D : -1;
    });
  };
  const barrel = (x, z, mat = RUST) => { cyl(x, z, 0, 0.95, 0.32, mat); cyl(x, z, 0.3, 0.375, 0.36, BLK2); cyl(x, z, 0.65, 0.725, 0.36, BLK2); };
  const tree = (x, z, h = 2.8, r = 1.5) => {
    box(x - 0.19, 0, z - 0.19, x + 0.19, h + 0.6, z + 0.19, TRUNK);
    sphere(x, h + 0.7, z, r, LEAF, 0.86); sphere(x + 0.5, h + 0.2, z - 0.4, r * 0.7, LEAF, 0.8);
  };
  const streetLamp = (x, z, dx, dz) => {
    box(x - 0.09, 0, z - 0.09, x + 0.16, 4.2, z + 0.16, SHEET);
    box(Math.min(x, x + dx) - 0.06, 4.08, Math.min(z, z + dz) - 0.06, Math.max(x, x + dx) + 0.19, 4.2, Math.max(z, z + dz) + 0.19, SHEET);
    lamp(x + dx, 3.95, z + dz, 0xffc070, 1.5, 3);
  };

  /* ------------------------------------------------------------ ground */
  w.fill(0, 0, 0, SX, 4, SZ, BEDROCK);
  w.fill(0, 4, 0, SX, FY, SZ, ASPHALT);
  w.fill(v(1), 4, v(16.375), v(20), FY, v(32), (x, y, z) => (hash3(x >> 3, 5, z >> 3) < 0.22 || (y === 4) ? DIRT : GRASS));
  w.fill(v(1), 4, v(1), v(15), FY, v(16), planksH);
  w.fill(v(20.375), 4, v(14.375), v(47), FY, v(32), TILE);
  w.fill(v(1), 4, v(32.5), v(36), FY, v(47), (x, y, z) => ((x % 8 === 0 || z % 8 === 0) && y === FY - 1 ? CONC_B : LABTILE));
  w.fill(v(36.5), 4, v(32.5), v(47), FY, v(47), STEEL);
  // lane dashes on the street
  for (let x = 17; x < 46; x += 3) w.fill(v(x), FY - 1, v(7.4), v(x + 1.5), FY, v(7.6), PLASTER);

  /* --------------------------------------------------------- perimeter */
  const PH = 4.5;
  box(0, 0, 0, 48, PH, 1, blast); box(0, 0, 47, 48, PH, 48, blast); box(0, 0, 0, 1, PH, 48, blast); box(47, 0, 0, 48, PH, 48, blast);
  box(47, PH, 13, 48, 5.75, 33, blast);

  /* ------------------------------------------------------ A: safehouse */
  box(15, 0, 1, 15.375, 3.25, 16.375, brick);
  box(1, 0, 16, 15.375, 3.25, 16.375, brick);
  // timber barricades (tier 1): east to the street, north to the yard
  box(15, 0, 6, 15.375, 2.5, 9, 0); box(15, 0, 6, 15.25, 2.25, 9, planksV); box(15, 2.25, 6, 15.25, 2.5, 9, stripes(HAZ1, BLK1));
  box(14.875, 0.5, 6, 15.375, 0.75, 9, TIMBER_D); box(14.875, 1.75, 6, 15.375, 2.0, 9, TIMBER_D);
  box(3, 0, 16, 5.5, 2.5, 16.375, 0); box(3, 0, 16, 5.5, 2.25, 16.25, planksV); box(3, 2.25, 16, 5.5, 2.5, 16.25, stripes(HAZ1, BLK1));
  box(3, 0.5, 15.875, 5.5, 0.75, 16.375, TIMBER_D); box(3, 1.75, 15.875, 5.5, 2.0, 16.375, TIMBER_D);
  // windows, too high to climb through
  for (const z of [2.5, 11.5]) { box(15, 1.3, z, 15.375, 2.3, z + 1.6, 0); box(15.125, 1.3, z, 15.25, 2.3, z + 1.6, GLASS); box(15, 1.75, z, 15.375, 1.85, z + 1.6, TIMBER_D); }
  for (const x of [8.5, 11.5]) { box(x, 1.3, 16, x + 1.6, 2.3, 16.375, 0); box(x, 1.3, 16.125, x + 1.6, 2.3, 16.25, GLASS); box(x, 1.75, 16, x + 1.6, 1.85, 16.375, TIMBER_D); }
  // roof: planks on beams, one skylight
  box(1, 3.25, 1, 15.375, 3.5, 16.375, planksH);
  for (let x = 3; x < 15; x += 2.4) box(x, 3.0, 1, x + 0.25, 3.25, 16, TIMBER_D);
  box(10.5, 3.25, 6.5, 13, 3.5, 9, GLASS); box(11.7, 3.25, 6.5, 11.8, 3.5, 9, TIMBER_D);
  // plaster partitions (tier 0, any gun eats them)
  box(8, 0, 1, 8.25, 3.0, 10, PLASTER); box(8, 0, 5, 8.25, 2.1, 6.1, 0);
  box(1, 0, 10, 8.25, 3.0, 10.25, PLASTER); box(3.5, 0, 10, 4.6, 2.1, 10.25, 0);
  // bunk room
  for (const z of [1.2, 3.6]) {
    box(1.1, 0, z, 3.1, 0.12, z + 0.12, TIMBER_D); box(1.1, 0.35, z, 3.1, 0.5, z + 1, TIMBER); box(1.1, 0.5, z, 3.1, 0.62, z + 1, FABRIC);
    box(1.1, 1.35, z, 3.1, 1.5, z + 1, TIMBER); box(1.1, 1.5, z, 3.1, 1.62, z + 1, FABRIC);
    for (const [px, pz] of [[1.1, z], [2.98, z], [1.1, z + 0.88], [2.98, z + 0.88]]) box(px, 0, pz, px + 0.12, 1.9, pz + 0.12, TIMBER_D);
  }
  box(6.9, 0, 1.1, 7.9, 1.9, 1.6, SHEET); box(7.36, 0.1, 1.6, 7.44, 1.8, 1.65, BLK2);
  crate(6.2, 8.6); crate(7.0, 8.9, 0.6); crate(6.4, 8.7, 0.5, 0.75); barrel(1.6, 8.9);
  // main hall: table, shelves, clutter
  box(10.5, 0.8, 11, 13.5, 0.9, 12.4, TIMBER); for (const [px, pz] of [[10.6, 11.1], [13.28, 11.1], [10.6, 12.18], [13.28, 12.18]]) box(px, 0, pz, px + 0.12, 0.8, pz + 0.12, TIMBER_D);
  box(10.9, 0, 10.3, 11.4, 0.5, 10.8, TIMBER_D); box(12.4, 0, 12.7, 12.9, 0.5, 13.2, TIMBER_D);
  box(8.3, 0, 12.5, 8.8, 2.2, 15.5, TIMBER_D); for (const y of [0.5, 1.1, 1.7]) { box(8.3, y, 12.5, 8.9, y + 0.08, 15.5, TIMBER); crate(8.35, 12.8 + y, 0.4, y + 0.08); }
  barrel(14.4, 1.6); barrel(14.3, 2.5, PAINT_B); crate(13.2, 14.6, 0.9); crate(14.2, 14.9, 0.6); crate(9, 1.4, 0.8);
  // kitchen corner
  box(1.1, 0, 14.6, 2.9, 0.9, 15.9, PLASTER); box(1.1, 0.9, 14.6, 2.9, 0.98, 15.9, TILE); box(6.2, 0, 15.2, 7.4, 1.8, 15.9, SHEET);
  lamp(4.5, 2.9, 5.5); lamp(11.7, 2.9, 3.6); lamp(11.7, 2.9, 13.2); lamp(4.5, 2.9, 13.2);

  /* -------------------------------------------------------- B: street */
  // box truck
  box(22, 0.45, 4, 28, 0.6, 6.3, RUST);
  for (const x of [22.6, 26.6]) for (const z of [3.95, 6.05]) cyl(x + 0.4, z + 0.15, 0, 0.8, 0.0, BLK2), box(x, 0, z, x + 0.8, 0.8, z + 0.3, BLK2);
  box(22, 0.6, 4.05, 23.9, 2.3, 6.25, PAINT_B); box(22.15, 0.75, 4.2, 23.75, 2.15, 6.1, 0); box(22, 1.4, 4.3, 22.15, 2.1, 6.0, GLASS);
  box(22.6, 1.4, 4.05, 23.6, 2.1, 4.2, GLASS); box(22.6, 1.4, 6.1, 23.6, 2.1, 6.25, GLASS);
  box(24.1, 0.6, 4, 28, 3.0, 6.3, SHEET); box(24.25, 0.75, 4.15, 28, 2.85, 6.15, 0); crate(24.6, 4.4, 0.7, 0.75); crate(25.6, 5.2, 0.6, 0.75);
  // barriers, dumpster, burnt car, trees, lights
  for (const x of [30, 32.4, 34.8]) { box(x, 0, 10, x + 2, 0.4, 10.6, CONC); box(x, 0.4, 10.15, x + 2, 0.95, 10.45, conc); }
  box(16.2, 0, 10, 18.2, 1.2, 11.2, PAINT_Y); box(16.35, 0.15, 10.15, 18.05, 1.2, 11.05, 0); box(16.2, 1.2, 10, 18.2, 1.3, 10.7, BLK2);
  box(39, 0.3, 1.8, 43, 0.9, 3.6, RUST); box(40, 0.9, 1.9, 42.2, 1.45, 3.5, RUST); box(40.15, 0.95, 2.0, 42.05, 1.35, 3.4, 0);
  for (const x of [39.4, 42]) for (const z of [1.75, 3.4]) box(x, 0, z, x + 0.65, 0.65, z + 0.25, BLK2);
  box(17.3, 0, 2.3, 18.7, 0.45, 3.7, brick); box(17.45, 0.3, 2.45, 18.55, 0.45, 3.55, DIRT); tree(18, 3);
  box(29.3, 0, 11.8, 30.7, 0.45, 13.2, brick); box(29.45, 0.3, 11.95, 30.55, 0.45, 13.05, DIRT); tree(30, 12.5, 3.2, 1.7);
  streetLamp(19.5, 12.6, 0, -0.9); streetLamp(33, 1.6, 0, 0.9); streetLamp(45.6, 12.6, -0.9, 0);
  // bus shelter
  box(36, 0, 12.9, 39.6, 2.3, 13, GLASS); box(36, 0, 11.6, 36.1, 2.3, 13, GLASS); box(39.5, 0, 11.6, 39.6, 2.3, 13, GLASS);
  box(35.9, 2.3, 11.4, 39.7, 2.42, 13.1, SHEET); box(36.4, 0.4, 12.4, 39.2, 0.5, 12.85, TIMBER); box(36.5, 0, 12.5, 36.62, 0.4, 12.75, SHEET); box(39, 0, 12.5, 39.12, 0.4, 12.75, SHEET);
  // kiosk
  box(41.5, 0, 6.5, 45.5, 2.6, 9.5, brick); box(41.875, 0, 6.875, 45.125, 2.6, 9.125, 0); box(41.4, 2.6, 6.4, 45.6, 2.8, 9.6, CONC);
  box(41.5, 0, 7.4, 41.875, 2.1, 8.5, 0); box(43, 1.0, 6.5, 44.6, 2.0, 6.875, 0); box(43, 1.0, 6.625, 44.6, 2.0, 6.75, GLASS);
  box(44.5, 0, 7.2, 45.1, 1.0, 8.9, TIMBER); crate(42.2, 8.3, 0.6); lamp(43.5, 2.47, 8, 0xffc98a, 0.8);
  barrel(46.2, 12.2); barrel(46.3, 11.3, PAINT_Y); crate(28.5, 1.4, 0.9); crate(29.5, 1.5, 0.6); crate(16, 4.6, 0.8);

  /* ---------------------------------------------------------- B: yard */
  // shed
  box(2, 0, 26, 6, 2.5, 30.5, planksV); box(2.25, 0, 26.25, 5.75, 2.5, 30.25, 0); box(5.75, 0, 27.6, 6, 2.0, 28.8, 0);
  box(1.8, 2.5, 25.8, 6.2, 2.7, 30.7, planksH); box(2.3, 0.9, 26.3, 2.9, 1.0, 30.2, TIMBER); crate(2.4, 26.4, 0.5, 1.0); crate(2.4, 29.2, 0.6); barrel(5.2, 29.7);
  lamp(4, 2.37, 28.3, 0xffb060, 0.7);
  // water tank on timber legs: cut the legs and it comes down
  for (const [px, pz] of [[13, 19], [15, 19], [13, 21], [15, 21]]) box(px - 0.12, 0, pz - 0.12, px + 0.13, 3, pz + 0.13, TIMBER_D);
  box(12.88, 1.4, 18.9, 15.13, 1.52, 19.1, TIMBER); box(12.88, 1.4, 20.9, 15.13, 1.52, 21.1, TIMBER);
  box(12.6, 3, 18.6, 15.4, 3.25, 21.4, planksH); cyl(14, 20, 3.25, 5.4, 1.25, RUST, 2); cyl(14, 20, 3.25, 3.5, 1.25, RUST); cyl(14, 20, 5.3, 5.42, 1.3, RUST);
  // greenhouse
  box(9, 0, 26, 14, 2.4, 30, GLASS); box(9.125, 0, 26.125, 13.875, 2.4, 29.875, 0); box(9, 2.4, 26, 14, 2.5, 30, GLASS);
  for (const x of [9, 11.44, 13.88]) for (const z of [26, 29.88]) box(x, 0, z, x + 0.12, 2.5, z + 0.12, TIMBER);
  box(11, 0, 26, 12, 2.0, 26.125, 0);
  box(9.4, 0, 27, 10.4, 0.45, 29.6, TIMBER); box(9.5, 0.35, 27.1, 10.3, 0.5, 29.5, DIRT); sphere(9.9, 0.75, 28.3, 0.45, LEAF, 0.7);
  box(12.6, 0, 27, 13.6, 0.45, 29.6, TIMBER); box(12.7, 0.35, 27.1, 13.5, 0.5, 29.5, DIRT); sphere(13.1, 0.8, 27.8, 0.5, LEAF, 0.7); sphere(13.1, 0.7, 29, 0.4, LEAF, 0.7);
  // garden wall, trees, table, wood pile
  box(1, 0, 24, 8.5, 1.0, 24.375, brick); box(4.2, 0, 24, 5.6, 1.0, 24.375, 0);
  tree(5, 20.3, 3.0, 1.7); tree(17.4, 29.2, 2.6, 1.5); tree(10.4, 23.2, 2.4, 1.3);
  box(16.2, 0.72, 23, 18.4, 0.8, 24, TIMBER); box(16.3, 0, 23.1, 16.42, 0.72, 23.9, TIMBER_D); box(18.18, 0, 23.1, 18.3, 0.72, 23.9, TIMBER_D);
  box(16.2, 0.4, 22.5, 18.4, 0.47, 22.85, TIMBER); box(16.2, 0.4, 24.15, 18.4, 0.47, 24.5, TIMBER);
  box(16.3, 0, 22.6, 16.4, 0.4, 22.75, TIMBER_D); box(18.2, 0, 22.6, 18.3, 0.4, 22.75, TIMBER_D); box(16.3, 0, 24.25, 16.4, 0.4, 24.4, TIMBER_D); box(18.2, 0, 24.25, 18.3, 0.4, 24.4, TIMBER_D);
  for (let i = 0; i < 4; i++) box(7 + (i & 1) * 0.1, i * 0.25, 30.6, 9 - (i & 1) * 0.1, i * 0.25 + 0.25, 31.6 - i * 0.2, i & 1 ? TRUNK : TIMBER_D);
  barrel(19.2, 17.2); barrel(18.4, 17.4, PAINT_B); crate(1.3, 17, 0.9); crate(1.4, 18.1, 0.6);
  streetLamp(10, 17.2, 0, 0.9); streetLamp(1.6, 25.3, 0.9, 0);

  /* ----------------------------------------------------- C: warehouse */
  box(20, 0, 14, 47, 5.5, 14.375, brick);
  box(20, 0, 14, 20.375, 5.5, 32, brick);
  frame(31, 0, 14, 34, 2.75, 14.375, HAZ2, BLK2);
  frame(20, 0, 21, 20.375, 2.75, 24, HAZ2, BLK2);
  for (let x = 23; x < 45; x += 4.5) { box(x, 3.6, 14, x + 2, 4.6, 14.375, 0); box(x, 3.6, 14.125, x + 2, 4.6, 14.25, GLASS); }
  for (let z = 17; z < 30; z += 4.5) { box(20, 3.6, z, 20.375, 4.6, z + 2, 0); box(20.125, 3.6, z, 20.25, 4.6, z + 2, GLASS); }
  // roof: sheet metal on trusses, two skylights
  box(20, 5.5, 14, 47, 5.625, 32.5, SHEET);
  for (let z = 16.5; z < 32; z += 3) box(20.375, 5.125, z, 47, 5.5, z + 0.25, TIMBER_D);
  box(26, 5.5, 17.5, 28, 5.625, 29, GLASS); box(37, 5.5, 20, 39, 5.625, 29, GLASS);
  // shelving rows with crates
  for (const z of [18, 22.5, 27]) {
    for (let x = 23; x <= 35; x += 3) { box(x, 0, z, x + 0.12, 4, z + 0.12, RUST); box(x, 0, z + 0.88, x + 0.12, 4, z + 1, RUST); }
    for (const y of [1.25, 2.5, 3.75]) box(23, y, z, 35.12, y + 0.12, z + 1, TIMBER);
    for (let x = 23.2; x < 34.4; x += 0.95) for (const y of [0, 1.37, 2.62]) {
      const h = hash3(v(x), v(y), v(z));
      if (h < 0.72) crate(x, z + 0.1 + (h * 7 % 0.15), 0.5 + (h * 13 % 0.3), y, h < 0.25 ? TIMBER : CRATE);
    }
  }
  // containers you can walk through
  box(38, 0, 15.6, 44, 2.6, 18, PAINT_B); box(38, 0.125, 15.725, 44, 2.475, 17.875, 0); w.fill(v(38), FY, v(15.6), v(44), FY + v(2.6), v(18), (x, y, z) => (w.get(x, y, z) === PAINT_B && x % 3 === 0 ? RUST : -1));
  box(39, 0, 19.5, 45, 2.6, 21.9, PAINT_Y); box(39, 0.125, 19.625, 45, 2.475, 21.775, 0);
  crate(42.6, 16.3, 0.9); crate(40, 20.2, 0.8);
  // office cabin
  box(40, 0, 26, 47, 2.7, 26.25, PLASTER); box(40, 0, 26, 40.25, 2.7, 32, PLASTER); box(40, 2.7, 26, 47, 2.85, 32, PLASTER);
  box(40, 0, 28.4, 40.25, 2.1, 29.5, 0); box(42, 1.0, 26, 45.5, 2.0, 26.25, 0); box(42, 1.0, 26.06, 45.5, 2.0, 26.19, GLASS);
  box(43, 0.75, 30.6, 45.6, 0.85, 31.6, TIMBER); box(43.1, 0, 30.7, 43.22, 0.75, 31.5, SHEET); box(45.4, 0, 30.7, 45.52, 0.75, 31.5, SHEET);
  box(44, 0.85, 31.2, 44.9, 1.4, 31.3, BLK2); box(44.06, 0.92, 31.14, 44.84, 1.34, 31.2, SCREEN);
  lamp(43.5, 2.57, 29, 0xcfe6ff, 0.9);
  // forklift, pallets, drums
  box(30, 0.2, 29.4, 31.8, 0.9, 30.6, PAINT_Y); box(30.2, 0.9, 29.5, 31, 1.9, 30.5, 0); box(30.1, 0.9, 29.45, 30.2, 1.9, 29.55, BLK2); box(30.1, 0.9, 30.45, 30.2, 1.9, 30.55, BLK2);
  box(30.1, 1.9, 29.4, 31.1, 2.0, 30.6, BLK2); box(31.8, 0, 29.5, 31.9, 2.4, 29.62, SHEET); box(31.8, 0, 30.38, 31.9, 2.4, 30.5, SHEET);
  box(31.9, 0.25, 29.55, 33, 0.32, 29.7, SHEET); box(31.9, 0.25, 30.3, 33, 0.32, 30.45, SHEET);
  for (const x of [30.1, 31.2]) for (const z of [29.3, 30.5]) box(x, 0, z, x + 0.5, 0.5, z + 0.2, BLK2);
  for (const [x, z] of [[24, 30.4], [26, 30.2], [36.5, 15.4]]) { box(x, 0, z, x + 1.2, 0.15, z + 1.2, TIMBER_D); crate(x + 0.1, z + 0.15, 0.9, 0.15); }
  barrel(21.2, 15.2); barrel(22, 15.4, PAINT_B); barrel(21.3, 16.1, PAINT_Y); barrel(36.4, 30.8); barrel(37.2, 31.1);
  for (const [x, z] of [[24, 20.5], [33, 20.5], [42, 23.6], [24, 25], [33, 25], [31, 16]]) { box(x - 0.03, 4.4, z - 0.03, x + 0.03, 5.125, z + 0.03, BLK2); lamp(x, 4.3, z, 0xffd9a8, 1.3, 3); }

  /* ----------------------------------------------- D: research block */
  box(1, 0, 32, 36, 4, 32.5, conc);
  frame(9, 0, 32, 12, 2.75, 32.5, HAZ3, BLK3);
  frame(27, 0, 32, 30, 2.75, 32.5, HAZ3, BLK3);
  box(1, 4, 32, 36.5, 4.375, 47, conc);
  for (const [x, z] of [[12, 36], [22, 36], [12, 42], [22, 42]]) box(x, 4, z, x + 1.5, 4.375, z + 1.5, GLASS);
  for (const x of [8, 16, 24, 31]) for (const z of [37, 43]) box(x, 0, z, x + 0.5, 4, z + 0.5, conc);
  // glass cells along the west side, specimen tanks
  box(7, 0, 33, 7.125, 2.6, 46.5, GLASS); box(7, 0, 35.5, 7.125, 2.1, 36.6, 0); box(7, 0, 42, 7.125, 2.1, 43.1, 0);
  box(1, 0, 39.5, 7, 2.6, 39.625, GLASS); box(1, 2.6, 33, 7.125, 2.7, 46.5, SHEET);
  for (const [x, z] of [[3, 34.5], [5, 37.5], [3, 42], [5, 45]]) {
    cyl(x, z, 0, 0.3, 0.7, SHEET); cyl(x, z, 0.3, 2.2, 0.62, GLASS, 1); cyl(x, z, 0.3, 1.9, 0.3, SCREEN); cyl(x, z, 2.2, 2.4, 0.7, SHEET);
  }
  // benches and consoles
  for (const [x, z, len] of [[10, 34, 5], [18, 34, 5], [10, 45, 4], [26, 40, 3.5]]) {
    box(x, 0.85, z, x + len, 0.95, z + 0.9, LABTILE); box(x, 0, z, x + 0.1, 0.85, z + 0.9, SHEET); box(x + len - 0.1, 0, z, x + len, 0.85, z + 0.9, SHEET);
    box(x + 0.6, 0.95, z + 0.5, x + 1.4, 1.5, z + 0.6, BLK2); box(x + 0.66, 1.0, z + 0.44, x + 1.34, 1.44, z + 0.5, SCREEN);
    crate(x + len - 1, z + 0.2, 0.4, 0.95);
  }
  for (let x = 17; x < 30; x += 1.3) { box(x, 0, 46.2, x + 1.1, 2.3, 47, BLK2); for (let y = 0.3; y < 2.1; y += 0.4) box(x + 0.15, y, 46.14, x + 0.95, y + 0.1, 46.2, hash3(v(x), v(y), 3) < 0.6 ? SCREEN : SHEET); }
  crate(33, 33.2, 0.9); crate(34, 33.4, 0.7); barrel(34.8, 34.6, PAINT_Y); barrel(2, 46.2);
  for (const [x, z] of [[4, 36], [4, 43], [10.5, 39.5], [19, 39.5], [27.5, 36], [27.5, 44], [33.5, 40]]) lamp(x, 3.87, z, 0xbfe4ff, 1.2, 4);

  /* ---------------------------------------------------------- E: vault */
  box(36, 0, 32, 36.5, 4, 47, STEEL); box(36, 0, 32, 47, 4, 32.5, STEEL); box(36, 4, 32, 47, 4.5, 47, STEEL);
  frame(36, 0, 38, 36.5, 2.75, 41, HAZ4, BLK4);
  // door ring relief on the lab side
  { const X = v(36) - 1, Y = FY + v(1.3), Z = v(39.5); w.fill(X, Y - 9, Z - 9, X + 1, Y + 10, Z + 10, (x, y, z) => { const d = Math.hypot(y - Y, z - Z); return (d > 6.5 && d < 8.6) || d < 1.6 ? STEEL : -1; }); }
  for (const [x, z, n] of [[38, 34, 3], [44, 34, 4], [45, 44, 4], [38, 45, 3], [45, 39, 2]]) for (let i = 0; i < n; i++) box(x - 0.6 + i * 0.12, i * 0.25, z - 0.4 + i * 0.06, x + 0.6 - i * 0.12, i * 0.25 + 0.25, z + 0.4 - i * 0.06, GOLD);
  box(41.4, 0, 39.4, 42.6, 0.9, 40.6, STEEL); box(41.3, 0.9, 39.3, 42.7, 1.0, 40.7, GOLD);
  lamp(42, 3.87, 36, 0xffe2a0, 1.1, 4); lamp(42, 3.87, 43, 0xffe2a0, 1.1, 4);

  w.dirtyChunks.clear(); w.dirtyBox = null;

  const FYm = FY * VOX;
  return {
    floorY: FYm,
    spawn: { x: 4.6, z: 6.4, yaw: -Math.PI / 2 },
    zones: [
      { id: 'A', name: 'Safehouse', rects: [[1, 1, 15, 16]], spawns: [[12.2, 15.3], [1.6, 12], [9.2, 9.2], [6.6, 1.9], [14.2, 4.6]] },
      { id: 'B', name: 'Street & Yard', rects: [[15.4, 1, 47, 14], [15.4, 14, 20, 16.4], [1, 16.4, 20, 32]], spawns: [[46, 2], [46, 13], [26, 12.8], [20.5, 2], [34, 6.5], [2, 31], [18.6, 31], [8.6, 18], [18.5, 19.5], [9, 25]] },
      { id: 'C', name: 'Warehouse', rects: [[20.4, 14.4, 47, 32]], spawns: [[22, 17], [45.5, 15.2], [37, 30], [21.5, 26], [36.5, 24], [46, 24.6]] },
      { id: 'D', name: 'Research Block', rects: [[1, 32.5, 36, 47]], spawns: [[9, 33.6], [34.5, 36], [14, 46], [2, 40.8], [30, 45], [20, 40]] },
      { id: 'E', name: 'Vault', rects: [[36.5, 32.5, 47, 47]], spawns: [] },
    ],
    // wall racks: x/z on the wall face, facing (nx, nz)
    wallbuys: [
      { weapon: 'ranger', price: 600, x: 11.7, z: 1.0, nx: 0, nz: 1 },
      { weapon: 'breaker', price: 1000, x: 1.0, z: 12.6, nx: 1, nz: 0 },
      { weapon: 'wasp', price: 1200, x: 24.5, z: 1.0, nx: 0, nz: 1 },
      { weapon: 'kestrel', price: 1800, x: 47.0, z: 8.2, nx: -1, nz: 0 },
      { weapon: 'thumper', price: 3000, x: 1.0, z: 21.8, nx: 1, nz: 0 },
      { weapon: 'hog', price: 4000, x: 47.0, z: 23.4, nx: -1, nz: 0 },
      { weapon: 'ramrod', price: 5500, x: 47.0, z: 18.4, nx: -1, nz: 0 },
    ],
    stations: [
      { kind: 'frags', x: 1.0, z: 18.9, nx: 1, nz: 0 },
      { kind: 'plating', x: 47.0, z: 29.2, nx: -1, nz: 0 },
      { kind: 'bench', x: 33.2, z: 45.2, nx: 0, nz: -1 },
    ],
    crates: [{ x: 5, z: 12.4, yaw: 0, zone: 'A' }, { x: 37.6, z: 4.6, yaw: 0, zone: 'B' }, { x: 22.4, z: 30.2, yaw: Math.PI / 2, zone: 'C' }, { x: 9.6, z: 41.2, yaw: 0, zone: 'D' }],
    pedestal: { x: 42, z: 40, y: FYm + 1.0 },
    lamps,
    // where the HUD points you next
    hints: { A: 'Buy the Breaker 12 and blast through the striped timber barricade', B: 'Brick needs explosives: the Thumper GL is on the yard wall', C: 'Concrete needs the Ramrod RL from the warehouse wall', D: 'Vault steel needs an overclocked launcher or the Arc Lance', E: '' },
  };
}

export function zoneAt(map, x, z) {
  for (const zn of map.zones) for (const r of zn.rects) if (x >= r[0] && x < r[2] && z >= r[1] && z < r[3]) return zn;
  return null;
}
