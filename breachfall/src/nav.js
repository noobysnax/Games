// Walkability on a 0.5 m grid derived from the voxels, and a distance field toward the player that
// every zombie follows. Blow a hole in a wall and the next rebuild lets them through it.

import { VOX, SX, SZ, FY, NAV } from './config.js';

export const NX = SX / NAV, NZ = SZ / NAV;
const CLEAR = 14;          // voxels of headroom (1.75 m)
const STEP = 4;            // climbable step in voxels
const INF = 0xffff;

export class Nav {
  constructor(world) {
    this.w = world;
    this.floor = new Int16Array(NX * NZ).fill(-1); // voxel y of the standing surface, -1 blocked
    this.dist = new Uint16Array(NX * NZ).fill(INF);
    this.heap = new Int32Array(NX * NZ * 4);
    this.rebuild(0, 0, NX - 1, NZ - 1);
  }
  // column test: the middle 2x2 voxels of the cell must be clear for CLEAR voxels above some floor
  cellFloor(cx, cz) {
    const w = this.w, x0 = cx * NAV + 1, z0 = cz * NAV + 1;
    let run = 0, start = -1;
    for (let y = FY - 2; y < FY + 12 + CLEAR; y++) {
      const open = !(w.get(x0, y, z0) || w.get(x0 + 1, y, z0) || w.get(x0, y, z0 + 1) || w.get(x0 + 1, y, z0 + 1));
      if (open) { if (run === 0) start = y; if (++run >= CLEAR) return start; }
      else { run = 0; if (y >= FY + 12) return -1; }
    }
    return -1;
  }
  rebuild(cx0, cz0, cx1, cz1) {
    cx0 = Math.max(0, cx0); cz0 = Math.max(0, cz0); cx1 = Math.min(NX - 1, cx1); cz1 = Math.min(NZ - 1, cz1);
    for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) this.floor[z * NX + x] = this.cellFloor(x, z);
  }
  rebuildVoxBox(b) { this.rebuild((b[0] >> 2) - 1, (b[2] >> 2) - 1, (b[3] >> 2) + 1, (b[5] >> 2) + 1); }
  cell(wx, wz) { return Math.floor(wz / (VOX * NAV)) * NX + Math.floor(wx / (VOX * NAV)); }
  floorAt(wx, wz) { const f = this.floor[this.cell(wx, wz)]; return f < 0 ? -1 : f * VOX; }
  walkable(wx, wz) { const cx = Math.floor(wx / (VOX * NAV)), cz = Math.floor(wz / (VOX * NAV)); return cx >= 0 && cz >= 0 && cx < NX && cz < NZ && this.floor[cz * NX + cx] >= 0; }
  canStep(a, b) { const fa = this.floor[a], fb = this.floor[b]; return fa >= 0 && fb >= 0 && Math.abs(fa - fb) <= STEP; }

  // Dijkstra from the target cell over 8 neighbours (10 straight, 14 diagonal)
  flow(wx, wz) {
    const d = this.dist, f = this.floor, h = this.heap; d.fill(INF);
    let c = this.cell(wx, wz);
    if (f[c] < 0) { // target is over a hole or on rubble: start from the nearest walkable cell
      const cx = c % NX, cz = (c / NX) | 0; let best = -1, bd = 1e9;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= NX || z >= NZ || f[z * NX + x] < 0) continue;
        const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = z * NX + x; }
      }
      if (best < 0) return; c = best;
    }
    let n = 0;
    const push = (cell, cost) => { let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (h[p * 2] <= cost) break; h[i * 2] = h[p * 2]; h[i * 2 + 1] = h[p * 2 + 1]; i = p; } h[i * 2] = cost; h[i * 2 + 1] = cell; };
    const pop = () => {
      const top = h[1]; n--; const cost = h[n * 2], cell = h[n * 2 + 1]; let i = 0;
      for (;;) { let k = i * 2 + 1; if (k >= n) break; if (k + 1 < n && h[(k + 1) * 2] < h[k * 2]) k++; if (h[k * 2] >= cost) break; h[i * 2] = h[k * 2]; h[i * 2 + 1] = h[k * 2 + 1]; i = k; }
      h[i * 2] = cost; h[i * 2 + 1] = cell; return top;
    };
    d[c] = 0; push(c, 0);
    while (n > 0) {
      const dc = h[0], cur = pop();
      if (dc > d[cur]) continue;
      const x = cur % NX, z = (cur / NX) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= NX || zz >= NZ) continue;
        const nb = zz * NX + xx; if (!this.canStep(cur, nb)) continue;
        if (dx && dz && !(this.canStep(cur, z * NX + xx) && this.canStep(cur, zz * NX + x))) continue; // no corner cutting
        const nd = dc + (dx && dz ? 14 : 10);
        if (nd < d[nb] && nd < INF && n * 2 + 2 < h.length) { d[nb] = nd; push(nb, nd); }
      }
    }
  }
  reachable(wx, wz) { return this.dist[this.cell(wx, wz)] < INF; }
  // unit direction toward the target from a position, or null if there is no route
  dir(wx, wz, out) {
    const cx = Math.floor(wx / (VOX * NAV)), cz = Math.floor(wz / (VOX * NAV));
    if (cx < 0 || cz < 0 || cx >= NX || cz >= NZ) return null;
    const c = cz * NX + cx, d = this.dist; let best = d[c], bx = 0, bz = 0;
    if (best === INF) return null;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const xx = cx + dx, zz = cz + dz; if (xx < 0 || zz < 0 || xx >= NX || zz >= NZ) continue;
      const nb = zz * NX + xx; if (d[nb] >= best || !this.canStep(c, nb)) continue;
      if (dx && dz && !(this.canStep(c, cz * NX + xx) && this.canStep(c, zz * NX + cx))) continue;
      best = d[nb]; bx = dx; bz = dz;
    }
    if (!bx && !bz) return null;
    // aim at the centre of the next cell so they do not scrape along walls
    const tx = (cx + bx + 0.5) * VOX * NAV - wx, tz = (cz + bz + 0.5) * VOX * NAV - wz, l = Math.hypot(tx, tz) || 1;
    out.x = tx / l; out.z = tz / l; return out;
  }
}
