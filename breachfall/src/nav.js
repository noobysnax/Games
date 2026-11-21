// Walkability on a 0.5 m grid derived from the voxels, in two layers: street level and the underground,
// joined wherever their floors meet within a step (the stairs). A distance field toward the nearest player
// steers every zombie. Blow a hole in a wall and the next rebuild lets them through it.

import { VOX, SX, SZ, FY, UFY, NAV } from './config.js';

export const NX = SX / NAV, NZ = SZ / NAV, NC = NX * NZ;
const CLEAR = 14;          // voxels of headroom (1.75 m)
const STEP = 4;            // climbable step in voxels
const INF = 0xffff;
// the voxel heights each layer looks for a floor in
const RANGE = [[FY - 12, FY + 12], [UFY - 2, FY - 13]];
const SPLIT = (FY - 12.5) * VOX;

export class Nav {
  constructor(world) {
    this.w = world;
    this.floor = new Int16Array(NC * 2).fill(-1); // voxel y of the standing surface, -1 none
    this.dist = new Uint16Array(NC * 2).fill(INF);
    this.heap = new Int32Array(NC * 2 * 6);
    this.col = new Uint8Array(160);
    this.rebuild(0, 0, NX - 1, NZ - 1);
  }
  // the lowest height in the layer's range with something solid underfoot and CLEAR voxels of room above
  cellFloor(cx, cz, L) {
    const w = this.w, x0 = cx * NAV + 1, z0 = cz * NAV + 1, [y0, y1] = RANGE[L], col = this.col;
    const n = y1 - y0 + CLEAR + 2;
    for (let k = 0; k < n; k++) { const y = y0 - 1 + k; col[k] = w.get(x0, y, z0) || w.get(x0 + 1, y, z0) || w.get(x0, y, z0 + 1) || w.get(x0 + 1, y, z0 + 1) ? 1 : 0; }
    for (let y = y0; y <= y1; y++) {
      const k = y - y0 + 1;
      if (!col[k - 1] || col[k]) continue;
      let ok = true; for (let j = 1; j < CLEAR; j++) if (col[k + j]) { ok = false; break; }
      if (ok) return y;
    }
    return -1;
  }
  rebuild(cx0, cz0, cx1, cz1) {
    cx0 = Math.max(0, cx0); cz0 = Math.max(0, cz0); cx1 = Math.min(NX - 1, cx1); cz1 = Math.min(NZ - 1, cz1);
    for (let L = 0; L < 2; L++) for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) this.floor[L * NC + z * NX + x] = this.cellFloor(x, z, L);
  }
  rebuildVoxBox(b) { this.rebuild((b[0] >> 2) - 1, (b[2] >> 2) - 1, (b[3] >> 2) + 1, (b[5] >> 2) + 1); }

  // cell index (layer included) for a world position, or -1 off the grid
  locate(wx, wy, wz) {
    const cx = Math.floor(wx / (VOX * NAV)), cz = Math.floor(wz / (VOX * NAV));
    if (cx < 0 || cz < 0 || cx >= NX || cz >= NZ) return -1;
    const c = cz * NX + cx, L = wy < SPLIT ? 1 : 0, f = this.floor;
    if (f[L * NC + c] < 0 && f[(1 - L) * NC + c] >= 0 && Math.abs(f[(1 - L) * NC + c] * VOX - wy) < 0.9) return (1 - L) * NC + c;
    return L * NC + c;
  }
  floorOf(i) { return i < 0 || this.floor[i] < 0 ? -1 : this.floor[i] * VOX; }
  floorAt(wx, wy, wz) { return this.floorOf(this.locate(wx, wy, wz)); }
  walkable(wx, wy, wz) { const i = this.locate(wx, wy, wz); return i >= 0 && this.floor[i] >= 0; }
  reachable(wx, wy, wz) { const i = this.locate(wx, wy, wz); return i >= 0 && this.dist[i] < INF; }
  canStep(a, b) { const f = this.floor, fa = f[a], fb = f[b]; return fa >= 0 && fb >= 0 && Math.abs(fa - fb) <= STEP; }
  // neighbouring cell at (x+dx, z+dz) that i can step onto, in either layer, or -1
  step(i, dx, dz) {
    const c = i % NC, x = (c % NX) + dx, z = ((c / NX) | 0) + dz;
    if (x < 0 || z < 0 || x >= NX || z >= NZ) return -1;
    const L = i >= NC ? 1 : 0, a = L * NC + z * NX + x, b = (1 - L) * NC + z * NX + x;
    if (this.canStep(i, a)) return a;
    if (this.canStep(i, b)) return b;
    return -1;
  }

  // Dijkstra from every target at once (10 straight, 14 diagonal), so each zombie heads for its nearest player
  flow(targets) {
    const d = this.dist, f = this.floor, h = this.heap; d.fill(INF);
    let n = 0;
    const push = (cell, cost) => { let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (h[p * 2] <= cost) break; h[i * 2] = h[p * 2]; h[i * 2 + 1] = h[p * 2 + 1]; i = p; } h[i * 2] = cost; h[i * 2 + 1] = cell; };
    const pop = () => {
      const top = h[1]; n--; const cost = h[n * 2], cell = h[n * 2 + 1]; let i = 0;
      for (;;) { let k = i * 2 + 1; if (k >= n) break; if (k + 1 < n && h[(k + 1) * 2] < h[k * 2]) k++; if (h[k * 2] >= cost) break; h[i * 2] = h[k * 2]; h[i * 2 + 1] = h[k * 2 + 1]; i = k; }
      h[i * 2] = cost; h[i * 2 + 1] = cell; return top;
    };
    for (const t of targets) {
      let c = this.locate(t.x, t.y, t.z); if (c < 0) continue;
      if (f[c] < 0) { // standing on rubble or over a hole: start from the nearest walkable cell in that layer
        const L = c >= NC ? NC : 0, cc = c % NC, cx = cc % NX, cz = (cc / NX) | 0; let best = -1, bd = 1e9;
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
          const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= NX || z >= NZ || f[L + z * NX + x] < 0) continue;
          const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = L + z * NX + x; }
        }
        if (best < 0) continue; c = best;
      }
      if (d[c]) { d[c] = 0; push(c, 0); }
    }
    while (n > 0) {
      const dc = h[0], cur = pop();
      if (dc > d[cur]) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nb = this.step(cur, dx, dz); if (nb < 0) continue;
        if (dx && dz && (this.step(cur, dx, 0) < 0 || this.step(cur, 0, dz) < 0)) continue; // no corner cutting
        const nd = dc + (dx && dz ? 14 : 10);
        if (nd < d[nb] && nd < INF && n * 2 + 2 < h.length) { d[nb] = nd; push(nb, nd); }
      }
    }
  }
  // unit direction toward the nearest target from a position, or null if there is no route
  dir(wx, wy, wz, out) {
    const c = this.locate(wx, wy, wz); if (c < 0) return null;
    const d = this.dist; let best = d[c], bn = -1;
    if (best === INF) return null;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nb = this.step(c, dx, dz); if (nb < 0 || d[nb] >= best) continue;
      if (dx && dz && (this.step(c, dx, 0) < 0 || this.step(c, 0, dz) < 0)) continue;
      best = d[nb]; bn = nb;
    }
    if (bn < 0) return null;
    // aim at the centre of the next cell so they do not scrape along walls
    const nc = bn % NC, tx = ((nc % NX) + 0.5) * VOX * NAV - wx, tz = (((nc / NX) | 0) + 0.5) * VOX * NAV - wz, l = Math.hypot(tx, tz) || 1;
    out.x = tx / l; out.z = tz / l; return out;
  }
}
