// The voxel world: one byte per voxel (material id), with carving, ray casts, box tests and the
// "what is no longer holding on to anything" search that turns cut-off pieces into falling bodies.

import { VOX, CH, MAT, ID } from './config.js';

const F_CUR = 0x40, F_GND = 0x80, F_ANY = 0xc0, M_MASK = 0x3f; // flag bits are only set inside findIslands
const TIER = new Uint8Array(64);
MAT.forEach((m, i) => { TIER[i] = m.tier; });

// cheap integer hash -> 0..1, used for ragged crater edges
export function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class World {
  constructor(sx, sy, sz) {
    this.sx = sx; this.sy = sy; this.sz = sz;
    this.data = new Uint8Array(sx * sy * sz);
    this.cx = Math.ceil(sx / CH); this.cy = Math.ceil(sy / CH); this.cz = Math.ceil(sz / CH);
    this.dirtyChunks = new Set();
    this.dirtyBox = null;          // voxel-space box of everything changed since the last takeDirtyBox()
    this.queue = new Int32Array(1 << 18);
    this.touched = [];
  }
  idx(x, y, z) { return (y * this.sz + z) * this.sx + x; }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz; }
  get(x, y, z) { return this.inside(x, y, z) ? this.data[(y * this.sz + z) * this.sx + x] : 0; }
  // for collisions: outside the map sideways or below counts as solid, above is open sky
  solid(x, y, z) {
    if (y >= this.sy) return false;
    if (x < 0 || z < 0 || y < 0 || x >= this.sx || z >= this.sz) return true;
    return this.data[(y * this.sz + z) * this.sx + x] !== 0;
  }
  solidAt(wx, wy, wz) { return this.solid(Math.floor(wx / VOX), Math.floor(wy / VOX), Math.floor(wz / VOX)); }
  set(x, y, z, m) { if (this.inside(x, y, z)) this.data[(y * this.sz + z) * this.sx + x] = m; }
  fill(x0, y0, z0, x1, y1, z1, m) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); z0 = Math.max(0, z0);
    x1 = Math.min(this.sx, x1); y1 = Math.min(this.sy, y1); z1 = Math.min(this.sz, z1);
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
      const o = (y * this.sz + z) * this.sx;
      if (typeof m === 'function') { for (let x = x0; x < x1; x++) { const v = m(x, y, z); if (v >= 0) this.data[o + x] = v; } }
      else this.data.fill(m, o + x0, o + x1);
    }
  }
  markDirty(x0, y0, z0, x1, y1, z1) {
    // chunks one voxel beyond the box too: their boundary faces may have changed
    const a = Math.max(0, (x0 - 1) >> 5), b = Math.min(this.cx - 1, (x1 + 1) >> 5);
    const c = Math.max(0, (y0 - 1) >> 5), d = Math.min(this.cy - 1, (y1 + 1) >> 5);
    const e = Math.max(0, (z0 - 1) >> 5), f = Math.min(this.cz - 1, (z1 + 1) >> 5);
    for (let cy = c; cy <= d; cy++) for (let cz = e; cz <= f; cz++) for (let cx = a; cx <= b; cx++) this.dirtyChunks.add((cy * this.cz + cz) * this.cx + cx);
    const B = this.dirtyBox;
    if (!B) this.dirtyBox = [x0, y0, z0, x1, y1, z1];
    else { B[0] = Math.min(B[0], x0); B[1] = Math.min(B[1], y0); B[2] = Math.min(B[2], z0); B[3] = Math.max(B[3], x1); B[4] = Math.max(B[4], y1); B[5] = Math.max(B[5], z1); }
  }
  takeDirtyBox() { const b = this.dirtyBox; this.dirtyBox = null; return b; }

  // true if any voxel in the world-space box is solid
  boxSolid(x0, y0, z0, x1, y1, z1) {
    const e = 1e-4;
    const ax = Math.floor(x0 / VOX), bx = Math.floor((x1 - e) / VOX), ay = Math.floor(y0 / VOX), by = Math.floor((y1 - e) / VOX), az = Math.floor(z0 / VOX), bz = Math.floor((z1 - e) / VOX);
    for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) if (this.solid(x, y, z)) return true;
    return false;
  }

  // Voxel DDA. Origin and length in metres. Returns null or { t, x, y, z, nx, ny, nz, mat }.
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const inv = 1 / VOX;
    let x = Math.floor(ox * inv), y = Math.floor(oy * inv), z = Math.floor(oz * inv);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(VOX / dx) : Infinity, tdy = dy !== 0 ? Math.abs(VOX / dy) : Infinity, tdz = dz !== 0 ? Math.abs(VOX / dz) : Infinity;
    let tx = dx !== 0 ? ((dx > 0 ? (x + 1) * VOX - ox : ox - x * VOX) / Math.abs(dx)) : Infinity;
    let ty = dy !== 0 ? ((dy > 0 ? (y + 1) * VOX - oy : oy - y * VOX) / Math.abs(dy)) : Infinity;
    let tz = dz !== 0 ? ((dz > 0 ? (z + 1) * VOX - oz : oz - z * VOX) / Math.abs(dz)) : Infinity;
    let t = 0, nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < 4096; i++) {
      if (this.inside(x, y, z)) {
        const m = this.data[(y * this.sz + z) * this.sx + x];
        if (m) return { t, x, y, z, nx, ny, nz, mat: m & M_MASK };
      } else if (y < 0 || ((x < 0 || x >= this.sx || z < 0 || z >= this.sz) && y < this.sy)) return { t, x, y, z, nx, ny, nz, mat: 1 };
      if (tx < ty && tx < tz) { t = tx; tx += tdx; x += sx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { t = ty; ty += tdy; y += sy; nx = 0; ny = -sy; nz = 0; }
      else { t = tz; tz += tdz; z += sz; nx = 0; ny = 0; nz = -sz; }
      if (t > maxT) return null;
    }
    return null;
  }

  // Remove a ragged sphere of everything the tier can break. Centre and radius in metres. `tall` stretches it
  // upward and downward, which is what makes a blast on a wall leave a doorway instead of a porthole.
  // Returns { removed, samples: [x,y,z,mat,...] (voxel coords, thinned for debris), seeds: [idx...], toughest }.
  carve(cx, cy, cz, r, tier, maxSamples = 160, tall = 1, collect = false) {
    const inv = 1 / VOX, vx = cx * inv, vy = cy * inv, vz = cz * inv, vr = r * inv;
    const big = vr * 1.46 * tall + 1, it = 1 / tall;
    const x0 = Math.max(0, Math.floor(vx - big)), x1 = Math.min(this.sx - 1, Math.ceil(vx + big));
    const y0 = Math.max(0, Math.floor(vy - big)), y1 = Math.min(this.sy - 1, Math.ceil(vy + big));
    const z0 = Math.max(0, Math.floor(vz - big)), z1 = Math.min(this.sz - 1, Math.ceil(vz + big));
    const out = { removed: 0, samples: [], seeds: [], toughest: 0, toughMat: 0, gold: 0, cidx: collect ? [] : null, cmats: collect ? [] : null };
    const d = this.data, sxz = this.sx * this.sz;
    const keep = Math.min(1, maxSamples / Math.max(1, 4.2 * vr * vr * vr * 0.35));
    let bx0 = 1e9, by0 = 1e9, bz0 = 1e9, bx1 = -1, by1 = -1, bz1 = -1;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const o = (y * this.sz + z) * this.sx;
      for (let x = x0; x <= x1; x++) {
        const m = d[o + x]; if (!m) continue;
        const ddx = x + 0.5 - vx, ddy = (y + 0.5 - vy) * it, ddz = z + 0.5 - vz, d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 > big * big) continue;
        const t = TIER[m];
        const k = t > tier ? 0 : t === tier ? 0.7 : t === tier - 1 ? 1 : 1.25;
        if (k === 0) { if (d2 < vr * vr && t > out.toughest) { out.toughest = t; out.toughMat = m; } continue; }
        const rr = vr * k * (0.82 + 0.3 * hash3(x, y, z));
        if (d2 > rr * rr) continue;
        d[o + x] = 0; out.removed++; if (m === ID.GOLD) out.gold++; if (collect) { out.cidx.push(o + x); out.cmats.push(m); }
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z;
        if (out.samples.length < maxSamples * 4 && hash3(z, x, y + out.removed) < keep) out.samples.push(x, y, z, m);
        if (x > 0) out.seeds.push(o + x - 1); if (x < this.sx - 1) out.seeds.push(o + x + 1);
        if (z > 0) out.seeds.push(o + x - this.sx); if (z < this.sz - 1) out.seeds.push(o + x + this.sx);
        if (y > 0) out.seeds.push(o + x - sxz); if (y < this.sy - 1) out.seeds.push(o + x + sxz);
      }
    }
    if (out.removed) this.markDirty(bx0, by0, bz0, bx1, by1, bz1);
    return out;
  }

  // Flood from each seed. A piece that reaches bedrock (or anything unbreakable), or is simply huge, stays.
  // Anything else is cut out of the grid and returned as { n, idx: Int32Array, mats: Uint8Array, box }.
  findIslands(seeds, budget = 60000) {
    const d = this.data, sx = this.sx, sz = this.sz, sy = this.sy, sxz = sx * sz, q = this.queue, touched = this.touched;
    const islands = [];
    touched.length = 0;
    for (let s = 0; s < seeds.length; s++) {
      const seed = seeds[s], v0 = d[seed];
      if (!v0 || (v0 & F_ANY)) continue;
      let head = 0, tail = 0, grounded = false;
      const start = touched.length;
      d[seed] |= F_CUR; q[tail++] = seed; touched.push(seed);
      while (head < tail) {
        const i = q[head++];
        const m = d[i] & M_MASK;
        if (TIER[m] >= 9) { grounded = true; break; }
        if (tail - 6 >= q.length || tail > budget) { grounded = true; break; }
        const x = i % sx, zy = (i / sx) | 0, z = zy % sz, y = (zy / sz) | 0;
        let n, v;
        if (y > 0) { n = i - sxz; v = d[n]; if (v) { if (v & F_GND) { grounded = true; break; } if (!(v & F_CUR)) { d[n] = v | F_CUR; q[tail++] = n; touched.push(n); } } }
        else { grounded = true; break; }
        if (x > 0) { n = i - 1; v = d[n]; if (v) { if (v & F_GND) { grounded = true; break; } if (!(v & F_CUR)) { d[n] = v | F_CUR; q[tail++] = n; touched.push(n); } } }
        if (x < sx - 1) { n = i + 1; v = d[n]; if (v) { if (v & F_GND) { grounded = true; break; } if (!(v & F_CUR)) { d[n] = v | F_CUR; q[tail++] = n; touched.push(n); } } }
        if (z > 0) { n = i - sx; v = d[n]; if (v) { if (v & F_GND) { grounded = true; break; } if (!(v & F_CUR)) { d[n] = v | F_CUR; q[tail++] = n; touched.push(n); } } }
        if (z < sz - 1) { n = i + sx; v = d[n]; if (v) { if (v & F_GND) { grounded = true; break; } if (!(v & F_CUR)) { d[n] = v | F_CUR; q[tail++] = n; touched.push(n); } } }
        if (y < sy - 1) { n = i + sxz; v = d[n]; if (v) { if (v & F_GND) { grounded = true; break; } if (!(v & F_CUR)) { d[n] = v | F_CUR; q[tail++] = n; touched.push(n); } } }
      }
      if (grounded) { for (let k = start; k < touched.length; k++) d[touched[k]] = (d[touched[k]] & M_MASK) | F_GND; continue; }
      // a complete floating piece: lift it out
      const n = touched.length - start, idx = new Int32Array(n), mats = new Uint8Array(n);
      let bx0 = 1e9, by0 = 1e9, bz0 = 1e9, bx1 = -1, by1 = -1, bz1 = -1;
      for (let k = 0; k < n; k++) {
        const i = touched[start + k]; idx[k] = i; mats[k] = d[i] & M_MASK; d[i] = 0;
        const x = i % sx, zy = (i / sx) | 0, z = zy % sz, y = (zy / sz) | 0;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z;
      }
      touched.length = start;
      this.markDirty(bx0, by0, bz0, bx1, by1, bz1);
      islands.push({ n, idx, mats, box: [bx0, by0, bz0, bx1, by1, bz1] });
    }
    for (let k = 0; k < touched.length; k++) d[touched[k]] &= M_MASK;
    touched.length = 0;
    return islands;
  }
}
