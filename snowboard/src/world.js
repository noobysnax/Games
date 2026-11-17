// Turns the course into voxel meshes: the stepped snow columns you ride on, the blocky backdrop ranges,
// instanced spruces and boulders, the lodge, gates, rails and lantern posts.

import * as THREE from 'three';
import { T, tileUV } from './gfx.js';
import { XH, D0, D1, NX, NZ, SURF, DYE, FLOOR, terrainH, isLake } from './course.js';
import { clamp, hash3, mulberry32, fbm } from './util.js';

/* ------------------------------------------------------------------ rideable terrain */
const CS = 36;
const MAXQ = 60000;
const sP = new Float32Array(MAXQ * 12), sN = new Int8Array(MAXQ * 12), sU = new Float32Array(MAXQ * 8), sC = new Uint8Array(MAXQ * 12), sL = new Uint8Array(MAXQ * 4), sI = new Uint32Array(MAXQ * 6);

function buildTerrainChunk(course, cx, cz) {
  const { colH, colSurf, colLight } = course;
  let nq = 0;
  const H = (i, j) => (i < 0 || j < 0 || i >= NX || j >= NZ ? null : colH[j * NX + i]);
  const L = (i, j) => (i < 0 || j < 0 || i >= NX || j >= NZ ? 0 : colLight[j * NX + i]);
  const quad = (x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, nx, ny, nz, tile, v0, v1, c0, c1, c2, c3, l0, l1, l2, l3, rot) => {
    if (nq >= MAXQ) return;
    const p = nq * 12, u = nq * 8, l = nq * 4, ii = nq * 6, vb = nq * 4;
    sP[p] = x0; sP[p + 1] = y0; sP[p + 2] = z0; sP[p + 3] = x1; sP[p + 4] = y1; sP[p + 5] = z1;
    sP[p + 6] = x2; sP[p + 7] = y2; sP[p + 8] = z2; sP[p + 9] = x3; sP[p + 10] = y3; sP[p + 11] = z3;
    for (let k = 0; k < 4; k++) { sN[p + k * 3] = nx * 127; sN[p + k * 3 + 1] = ny * 127; sN[p + k * 3 + 2] = nz * 127; }
    const uv = [[0, v0], [1, v0], [1, v1], [0, v1]];
    for (let k = 0; k < 4; k++) { const q = uv[(k + rot) & 3], t = tileUV(tile, q[0], q[1]); sU[u + k * 2] = t[0]; sU[u + k * 2 + 1] = t[1]; }
    const cs = [c0, c1, c2, c3], ls = [l0, l1, l2, l3];
    for (let k = 0; k < 4; k++) { const c = clamp(cs[k], 0, 1) * 255; sC[p + k * 3] = c; sC[p + k * 3 + 1] = c; sC[p + k * 3 + 2] = c; sL[l + k] = clamp(ls[k], 0, 1) * 255; }
    // split along the brighter diagonal so AO gradients stay smooth
    if (c0 + c2 < c1 + c3) { sI[ii] = vb + 1; sI[ii + 1] = vb + 2; sI[ii + 2] = vb + 3; sI[ii + 3] = vb + 1; sI[ii + 4] = vb + 3; sI[ii + 5] = vb; }
    else { sI[ii] = vb; sI[ii + 1] = vb + 1; sI[ii + 2] = vb + 2; sI[ii + 3] = vb; sI[ii + 4] = vb + 2; sI[ii + 5] = vb + 3; }
    nq++;
  };
  const TOP = [T.groomed, T.snow, T.packed, T.ice, T.stoneTop];
  for (let j = cz * CS; j < Math.min(NZ, cz * CS + CS); j++) for (let i = cx * CS; i < Math.min(NX, cx * CS + CS); i++) {
    const h = colH[j * NX + i], sfl = colSurf[j * NX + i], surf = sfl & 7;
    const x0 = i - XH, x1 = x0 + 1, z1 = -(D0 + j), z0 = z1 - 1;
    const shade = 0.95 + hash3(i, 7, j) * 0.05;
    // top
    const occ = (di, dj) => { const hn = H(i + di, j + dj); return hn === null ? 0 : clamp((hn - h) / 0.6, 0, 1); };
    const oW = occ(-1, 0), oE = occ(1, 0), oU = occ(0, -1), oD = occ(0, 1);
    const ao = (a, b, c) => shade * (1 - 0.5 * Math.min(1, (a + b + c) / 2));
    const lt = (di, dj) => Math.max(L(i, j), L(i + di, j), L(i, j + dj), L(i + di, j + dj));
    const tile = sfl & DYE ? T.dye : TOP[surf];
    quad(x0, h, z1, x1, h, z1, x1, h, z0, x0, h, z0, 0, 1, 0, tile, 0, 1,
      ao(oW, oU, occ(-1, -1)), ao(oE, oU, occ(1, -1)), ao(oE, oD, occ(1, 1)), ao(oW, oD, occ(-1, 1)),
      lt(-1, -1), lt(1, -1), lt(1, 1), lt(-1, 1), surf === SURF.POWDER ? (hash3(i, 3, j) * 4) | 0 : 0);
    // sides, down to each lower neighbour
    for (let s = 0; s < 4; s++) {
      const di = s === 0 ? -1 : s === 1 ? 1 : 0, dj = s === 2 ? -1 : s === 3 ? 1 : 0;
      let hn = H(i + di, j + dj);
      if (hn === null) hn = h - 8;
      if (hn >= h) continue;
      const drop = h - hn, light = Math.max(L(i, j), L(i + di, j + dj)) * 0.8;
      for (let k = 0; k < 14; k++) {
        const yt = h - k, yb = k === 13 ? hn : Math.max(hn, yt - 1);
        if (yt <= hn) break;
        const last = yb === hn;
        const st = k === 0 ? (surf === SURF.ROCK || drop > 2.5 ? T.stoneSnow : surf === SURF.ICE ? T.ice : T.snowSide) : drop > 2.5 ? T.stone : T.snowSide;
        const ct = shade * (k === 0 ? 0.97 : 0.9), cb = shade * (last ? 0.7 : 0.9), v0 = Math.max(0, 1 - (yt - yb));
        if (s === 0) quad(x0, yb, z0, x0, yb, z1, x0, yt, z1, x0, yt, z0, -1, 0, 0, st, v0, 1, cb, cb, ct, ct, light, light, light, light, 0);
        else if (s === 1) quad(x1, yb, z1, x1, yb, z0, x1, yt, z0, x1, yt, z1, 1, 0, 0, st, v0, 1, cb, cb, ct, ct, light, light, light, light, 0);
        else if (s === 2) quad(x0, yb, z1, x1, yb, z1, x1, yt, z1, x0, yt, z1, 0, 0, 1, st, v0, 1, cb, cb, ct, ct, light, light, light, light, 0);
        else quad(x1, yb, z0, x0, yb, z0, x0, yt, z0, x1, yt, z0, 0, 0, -1, st, v0, 1, cb, cb, ct, ct, light, light, light, light, 0);
      }
    }
  }
  if (!nq) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(sP.slice(0, nq * 12), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(sN.slice(0, nq * 12), 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(sU.slice(0, nq * 8), 2));
  g.setAttribute('color', new THREE.BufferAttribute(sC.slice(0, nq * 12), 3, true));
  g.setAttribute('aLight', new THREE.BufferAttribute(sL.slice(0, nq * 4), 1, true));
  g.setIndex(new THREE.BufferAttribute(sI.slice(0, nq * 6), 1));
  g.computeBoundingSphere();
  return g;
}

/* ------------------------------------------------------------------ backdrop: coarse coloured columns */
function buildFar(cell, xa, xb, da, db, hole, quant, keep) {
  const nx = Math.round((xb - xa) / cell), nz = Math.round((db - da) / cell);
  const Hh = new Float32Array((nx + 2) * (nz + 2)), kind = new Uint8Array((nx + 2) * (nz + 2));
  const idx = (i, j) => (j + 1) * (nx + 2) + i + 1;
  for (let j = -1; j <= nz; j++) for (let i = -1; i <= nx; i++) {
    const x = xa + (i + 0.5) * cell, d = da + (j + 0.5) * cell;
    let h = terrainH(x, d), k = 0;
    if (h <= FLOOR + 0.01 && isLake(x, d)) k = 1;
    else if (h < 170 && h > FLOOR + 1 && fbm(x * 0.006 + 9, d * 0.006 - 4, 3) > -0.05 && fbm(x * 0.05, d * 0.05, 2) > -0.25) { k = 2; h += Math.min(cell * 0.75, 6); }
    Hh[idx(i, j)] = Math.round(h / quant) * quant; kind[idx(i, j)] = k;
  }
  const pos = [], nor = [], col = [], ind = [];
  const quad = (a, b, c, d, n, r, g, bl, r2 = r, g2 = g, b2 = bl) => {
    const vb = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) nor.push(n[0] * 127, n[1] * 127, n[2] * 127);
    col.push(r2 * 255, g2 * 255, b2 * 255, r2 * 255, g2 * 255, b2 * 255, r * 255, g * 255, bl * 255, r * 255, g * 255, bl * 255);
    ind.push(vb, vb + 1, vb + 2, vb, vb + 2, vb + 3);
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x0 = xa + i * cell, x1 = x0 + cell, d0 = da + j * cell, z1 = -d0, z0 = z1 - cell;
    const xc = x0 + cell / 2, dc = d0 + cell / 2;
    if (hole(xc, dc) || (keep && !keep(xc, dc))) continue;
    const h = Hh[idx(i, j)], k = kind[idx(i, j)], jit = 0.94 + hash3(i, cell, j) * 0.08;
    let steep = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) steep = Math.max(steep, Math.abs(h - Hh[idx(i + di, j + dj)]));
    let r, g, b;
    if (k === 1) { r = 0.6; g = 0.77; b = 0.87; }
    else if (k === 2) { const m = 0.45 + hash3(i, 2, j) * 0.3; r = 0.9 * (1 - m) + 0.12 * m; g = 0.93 * (1 - m) + 0.23 * m; b = 0.97 * (1 - m) + 0.17 * m; }
    else if (steep > cell * 1.5) { r = 0.6; g = 0.61; b = 0.66; }
    else { r = 0.9; g = 0.93; b = 0.97; }
    r *= jit; g *= jit; b *= jit;
    // top: note the winding here builds (x0,z1)->(x1,z1)->(x1,z0)->(x0,z0)
    quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], r, g, b);
    const side = (di, dj, a, bb, c, d2, n) => {
      const hx2 = xc + di * cell, hd2 = dc + dj * cell;
      let hn = Hh[idx(i + di, j + dj)];
      if (hole(hx2, hd2) || (keep && !keep(hx2, hd2))) hn = Math.min(hn, h) - cell * 2;
      if (hn >= h) return;
      const rock = h - hn > cell * 0.9 && k !== 2;
      const sr = rock ? 0.4 * jit : k === 2 ? 0.1 : 0.78 * jit, sg = rock ? 0.4 * jit : k === 2 ? 0.2 : 0.83 * jit, sb = rock ? 0.44 * jit : k === 2 ? 0.15 : 0.92 * jit;
      quad([a[0], hn, a[1]], [bb[0], hn, bb[1]], [c[0], h, c[1]], [d2[0], h, d2[1]], n, sr, sg, sb, sr * 0.8, sg * 0.8, sb * 0.8);
    };
    side(-1, 0, [x0, z0], [x0, z1], [x0, z1], [x0, z0], [-1, 0, 0]);
    side(1, 0, [x1, z1], [x1, z0], [x1, z0], [x1, z1], [1, 0, 0]);
    side(0, -1, [x0, z1], [x1, z1], [x1, z1], [x0, z1], [0, 0, 1]);
    side(0, 1, [x1, z0], [x0, z0], [x0, z0], [x1, z0], [0, 0, -1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(nor), 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(col), 3, true));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(ind), 1));
  geo.computeBoundingSphere();
  return geo;
}

/* ------------------------------------------------------------------ voxel models (props) */
const B = { LOG: 1, SPRUCE: 2, ROCK: 3, PLANKS: 4, COBBLE: 5, ROOF: 6, WINDOW: 7, DOORB: 8, DOORT: 9, DARK: 10, BANNER: 11, CHECKER: 12, SNOW: 13, STONE: 14 };
const BT = [];
BT[B.LOG] = [T.logTop, T.logSide, T.logTop]; BT[B.SPRUCE] = [T.leafTop, T.spruceSnow, T.spruce]; BT[B.ROCK] = [T.stoneTop, T.stoneSnow, T.stone];
BT[B.PLANKS] = [T.planks, T.planks, T.planks]; BT[B.COBBLE] = [T.cobble, T.cobble, T.cobble]; BT[B.ROOF] = [T.snow, T.roofSnow, T.roof];
BT[B.WINDOW] = [T.planks, T.window, T.planks]; BT[B.DOORB] = [T.planks, T.doorB, T.planks]; BT[B.DOORT] = [T.planks, T.doorT, T.planks];
BT[B.DARK] = [T.darkWood, T.darkWood, T.darkWood]; BT[B.BANNER] = [T.banner, T.banner, T.banner]; BT[B.CHECKER] = [T.checker, T.checker, T.checker];
BT[B.SNOW] = [T.snow, T.snowSide, T.snowSide]; BT[B.STONE] = [T.stone, T.stone, T.stone];

const FACES = [];
for (let d = 0; d < 6; d++) {
  const a = d >> 1, s = d & 1 ? -1 : 1, u = (a + 1) % 3, v = (a + 2) % 3, n = [0, 0, 0];
  n[a] = s;
  let cs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (s < 0) cs = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const corners = cs.map(([du, dv]) => {
    const o = [0, 0, 0]; o[a] = s > 0 ? 1 : 0; o[u] = du; o[v] = dv;
    const o1 = [0, 0, 0]; o1[u] = du ? 1 : -1;
    const o2 = [0, 0, 0]; o2[v] = dv ? 1 : -1;
    let tu, tv;
    if (a === 1) { tu = o[0]; tv = o[2]; } else if (a === 0) { tu = o[2]; tv = o[1]; } else { tu = o[0]; tv = o[1]; }
    return { o, o1, o2, tu, tv };
  });
  FACES.push({ n, corners, tex: d === 2 ? 0 : d === 3 ? 2 : 1 });
}
const AO = [0.45, 0.64, 0.82, 1.0];

class Vox {
  constructor() { this.m = new Map(); }
  key(x, y, z) { return (x + 128) | ((y + 128) << 8) | ((z + 128) << 16); }
  set(x, y, z, id) { this.m.set(this.key(x, y, z), id); }
  setIfAir(x, y, z, id) { const k = this.key(x, y, z); if (!this.m.has(k)) this.m.set(k, id); }
  get(x, y, z) { return this.m.get(this.key(x, y, z)) || 0; }
  /** Culled, AO-shaded mesh. Block (0,*,0) is centred on the origin in x/z. */
  mesh(ox = -0.5, oz = -0.5) {
    const pos = [], nor = [], uv = [], col = [], ind = [];
    for (const [k, id] of this.m) {
      const x = (k & 255) - 128, y = ((k >> 8) & 255) - 128, z = ((k >> 16) & 255) - 128;
      const leaf = id === B.SPRUCE, shade = 0.93 + hash3(x, y, z) * 0.12;
      for (let d = 0; d < 6; d++) {
        const F = FACES[d], nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
        const nb = this.get(nx, ny, nz);
        if (nb && !(nb === B.SPRUCE && !leaf)) continue;
        const tile = BT[id][F.tex], vb = pos.length / 3, aos = [];
        for (let c = 0; c < 4; c++) {
          const C = F.corners[c];
          const s1 = this.get(nx + C.o1[0], ny + C.o1[1], nz + C.o1[2]) ? 1 : 0, s2 = this.get(nx + C.o2[0], ny + C.o2[1], nz + C.o2[2]) ? 1 : 0;
          const cr = this.get(nx + C.o1[0] + C.o2[0], ny + C.o1[1] + C.o2[1], nz + C.o1[2] + C.o2[2]) ? 1 : 0;
          const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
          aos.push(ao);
          pos.push(x + C.o[0] + ox, y + C.o[1], z + C.o[2] + oz);
          nor.push(F.n[0] * 127, F.n[1] * 127, F.n[2] * 127);
          const t = tileUV(tile, C.tu, C.tv);
          uv.push(t[0], t[1]);
          const a = AO[ao] * shade * 255;
          col.push(a, a, a);
        }
        if (aos[0] + aos[2] < aos[1] + aos[3]) ind.push(vb + 1, vb + 2, vb + 3, vb + 1, vb + 3, vb);
        else ind.push(vb, vb + 1, vb + 2, vb, vb + 2, vb + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(nor), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(col), 3, true));
    g.setIndex(ind);
    g.computeBoundingSphere();
    return g;
  }
}

function spruceModel(rnd) {
  const v = new Vox(), th = 5 + ((rnd() * 4) | 0);
  for (let y = -2; y < th; y++) v.set(0, y, 0, B.LOG);
  for (let i = 2; i <= th; i++) {
    const k = (th + 1 - i) / (th - 1);
    let rr = Math.max(0.75, k * 2.9);
    if (i % 2 === 0) rr *= 0.62;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if ((dx || dz) && dx * dx + dz * dz <= rr * rr + 0.3) v.setIfAir(dx, i, dz, B.SPRUCE);
  }
  v.set(0, th, 0, B.SPRUCE); v.set(0, th + 1, 0, B.SPRUCE);
  return v.mesh();
}
function rockModel(rnd, R) {
  const v = new Vox(), ry = R * 0.75;
  for (let x = -3; x <= 3; x++) for (let y = -2; y <= 3; y++) for (let z = -3; z <= 3; z++) {
    const d = Math.sqrt((x * x) / (R * R) + ((y - 0.2) * (y - 0.2)) / (ry * ry) + (z * z) / (R * R));
    if (d < 1 - rnd() * 0.22) v.set(x, y, z, B.ROCK);
  }
  return v.mesh();
}
function lodgeModel(W, D, smoke) {
  const v = new Vox(), x1 = W - 1, z1 = D - 1, WH = 6;
  for (let x = 0; x <= x1; x++) for (let z = 0; z <= z1; z++) { for (let y = -3; y <= 0; y++) v.set(x, y, z, B.COBBLE); }
  for (let y = 1; y <= WH; y++) for (let x = 0; x <= x1; x++) for (let z = 0; z <= z1; z++) {
    if (!(x === 0 || x === x1 || z === 0 || z === z1)) continue;
    const corner = (x === 0 || x === x1) && (z === 0 || z === z1);
    let id = y === 1 ? B.COBBLE : corner || y === 4 ? B.DARK : B.PLANKS;
    if (!corner && (y === 2 || y === 3 || y === 6) && (x + z) % 3 === 1) id = B.WINDOW;
    v.set(x, y, z, id);
  }
  for (const z of [Math.floor(D / 2) - 1, Math.floor(D / 2)]) { v.set(0, 1, z, B.DOORB); v.set(0, 2, z, B.DOORT); v.set(0, 3, z, B.DARK); }
  // deck on the piste side
  for (let x = -4; x < 0; x++) for (let z = 2; z <= z1 - 2; z++) { v.set(x, 0, z, B.PLANKS); for (let y = -3; y < 0; y++) if (x === -4 && (z === 2 || z === z1 - 2)) v.set(x, y, z, B.DARK); }
  for (const z of [2, z1 - 2]) for (let y = 1; y <= 3; y++) v.set(-4, y, z, B.DARK);
  for (let z = 1; z <= z1 - 1; z++) for (let x = -5; x < 0; x++) v.set(x, 4, z, B.ROOF);
  // gable roof, ridge along x
  let zl = -1, zr = z1 + 1, y = WH + 1;
  for (; zl <= zr; zl++, zr--, y++) {
    for (let x = -1; x <= x1 + 1; x++) { v.set(x, y, zl, B.ROOF); v.set(x, y, zr, B.ROOF); }
    for (let z = zl + 1; z < zr; z++) { v.set(0, y, z, (z + y) % 4 === 0 ? B.WINDOW : B.PLANKS); v.set(x1, y, z, B.PLANKS); }
  }
  const cxp = x1 - 3, czp = 3, top = WH + 6;
  for (let yy = 1; yy <= top; yy++) v.set(cxp, yy, czp, B.COBBLE);
  smoke.push([cxp + 0.5, top + 1.2, czp + 0.5]);
  return v.mesh(0, 0);
}
function gateModel(g) {
  const v = new Vox(), hw = Math.round(g.half);
  const top = g.kind === 'start' ? 6 : 8;
  for (const s of [-hw, hw]) for (let y = -4; y <= top; y++) v.set(s, y, 0, B.DARK);
  for (let x = -hw; x <= hw; x++) v.set(x, top, 0, B.DARK);
  for (let x = -hw + 1; x <= hw - 1; x++) {
    if (g.kind === 'start') v.set(x, top - 1, 0, B.BANNER);
    else { v.set(x, top - 1, 0, B.CHECKER); v.set(x, top - 2, 0, B.CHECKER); }
  }
  for (let x = -hw; x <= hw; x++) v.set(x, top + 1, 0, B.SNOW);
  return v.mesh();
}

function mergeGeoms(list) {
  let n = 0;
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  parts.forEach((p) => (n += p.attributes.position.count));
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };

/* ------------------------------------------------------------------ assemble */
export async function buildWorld(gfx, course, progress) {
  const { scene, patchMaterial, atlas } = gfx;
  const terrainMat = patchMaterial(new THREE.MeshStandardMaterial({ map: atlas.map, vertexColors: true, roughness: 0.88, metalness: 0 }), { blockLight: true, snow: true });
  const voxelMat = patchMaterial(new THREE.MeshStandardMaterial({ map: atlas.map, emissiveMap: atlas.emissive, emissive: 0xffffff, emissiveIntensity: 1, vertexColors: true, roughness: 0.92, metalness: 0, alphaTest: 0.5 }));
  const treeMat = patchMaterial(new THREE.MeshStandardMaterial({ map: atlas.map, vertexColors: true, roughness: 0.95, metalness: 0, alphaTest: 0.5 }), { sway: true });
  const farMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas.map, alphaTest: 0.5 });
  gfx.extras.emissiveMats.push(voxelMat);

  // rideable terrain
  const ncx = Math.ceil(NX / CS), ncz = Math.ceil(NZ / CS);
  let done = 0;
  for (let cz = 0; cz < ncz; cz++) {
    for (let cx = 0; cx < ncx; cx++) {
      const g = buildTerrainChunk(course, cx, cz);
      if (g) { const m = new THREE.Mesh(g, terrainMat); m.castShadow = true; m.receiveShadow = true; scene.add(m); }
      done++;
    }
    await progress(done / (ncx * ncz) * 0.6);
  }

  // backdrop rings
  const inFine = (x, d) => Math.abs(x) < XH && d > D0 && d < D1;
  const inMid = (x, d) => Math.abs(x) < 272 && d > -240 && d < 928;
  const mid = new THREE.Mesh(buildFar(4, -272, 272, -240, 928, inFine, 1), farMat);
  mid.receiveShadow = true; scene.add(mid);
  await progress(0.72);
  const far = new THREE.Mesh(buildFar(16, -1904, 1904, -1568, 2240, inMid, 4, (x, d) => Math.hypot(x, d - 336) < 1900), farMat);
  scene.add(far);
  await progress(0.84);

  // trees, in bands down the hill so off-screen bands are culled
  const rnd = mulberry32(77);
  const spruces = []; for (let i = 0; i < 6; i++) spruces.push(spruceModel(rnd));
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1), YA = new THREE.Vector3(0, 1, 0);
  const place = (geo, mat, items, cast, depth) => {
    if (!items.length) return;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((t, i) => { Q.setFromAxisAngle(YA, (t.rot || 0) * Math.PI / 2); V.set(t.x, t.y, -t.d); M.compose(V, Q, S1); im.setMatrixAt(i, M); });
    im.instanceMatrix.needsUpdate = true; im.castShadow = cast; im.receiveShadow = true;
    if (depth) im.customDepthMaterial = depthMat;
    im.computeBoundingSphere(); scene.add(im);
  };
  const BAND = 90;
  for (let b = -1; b < D1 / BAND + 1; b++) for (let v = 0; v < 6; v++) {
    place(spruces[v], treeMat, course.trees.filter((t) => t.variant === v && Math.floor(t.d / BAND) === b), true, true);
  }
  for (let v = 0; v < 3; v++) place(rockModel(rnd, 1.3 + v * 0.4), voxelMat, course.rocks.filter((r) => r.variant === v), true, false);

  // lodge + gates
  const smoke = [];
  const L = course.lodge;
  const lodge = new THREE.Mesh(lodgeModel(L.x1 - L.x0, L.d1 - L.d0, smoke), voxelMat);
  lodge.position.set(L.x0, Math.round(L.y * 8) / 8, -L.d1); lodge.castShadow = true; lodge.receiveShadow = true; scene.add(lodge);
  for (const s of smoke) { s[0] += L.x0; s[1] += L.y; s[2] += -L.d1; }
  for (const g of course.gates) {
    const m = new THREE.Mesh(gateModel(g), voxelMat);
    m.position.set(Math.round(g.x) + 0.5, Math.floor(g.y), -g.d); m.castShadow = true; scene.add(m);
  }

  // lantern posts (instanced)
  {
    const n = course.lanterns.length;
    const postG = mergeGeoms([box(0.18, 1.75, 0.18, 0, 0.875, 0), box(0.3, 0.12, 0.3, 0, 0.06, 0), box(0.5, 0.08, 0.5, 0, 1.75, 0)]);
    const frameG = mergeGeoms([box(0.52, 0.07, 0.52, 0, 2.25, 0), box(0.62, 0.1, 0.62, 0, 2.33, 0), box(0.06, 0.42, 0.06, 0.2, 2.0, 0.2), box(0.06, 0.42, 0.06, -0.2, 2.0, 0.2), box(0.06, 0.42, 0.06, 0.2, 2.0, -0.2), box(0.06, 0.42, 0.06, -0.2, 2.0, -0.2), box(0.44, 0.05, 0.44, 0, 1.8, 0)]);
    const capG = mergeGeoms([box(0.66, 0.1, 0.66, 0, 2.43, 0)]);
    const coreG = mergeGeoms([box(0.32, 0.36, 0.32, 0, 2.0, 0)]);
    const dark = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x2c2119, roughness: 0.85 }));
    const iron = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x1d1a18, roughness: 0.6, metalness: 0.4 }));
    const snowCap = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xeef3f9, roughness: 0.9 }));
    const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.8) });
    gfx.extras.lanternCore = core;
    const mk = (g, m, cast) => {
      const im = new THREE.InstancedMesh(g, m, n); im.castShadow = cast; im.receiveShadow = true;
      course.lanterns.forEach((l, i) => { M.makeTranslation(l.x, l.y, -l.d); im.setMatrixAt(i, M); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); scene.add(im);
    };
    mk(postG, dark, true); mk(frameG, iron, true); mk(capG, snowCap, false); mk(coreG, core, false);
  }

  // kicker flags
  {
    const pole = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.6, metalness: 0.5 }));
    const cols = { red: 0xd8402c, blue: 0x2f7fe0 };
    for (const f of course.flags) {
      const p = new THREE.Mesh(box(0.12, 3.2, 0.12, 0, 1.6, 0), pole); p.position.set(f.x, f.y, -f.d); p.castShadow = true; scene.add(p);
      const fl = new THREE.Mesh(box(0.9, 0.6, 0.06, 0.5, 2.85, 0), patchMaterial(new THREE.MeshStandardMaterial({ color: cols[f.color], roughness: 0.9, side: THREE.DoubleSide })));
      fl.position.copy(p.position); fl.castShadow = true; scene.add(fl);
    }
  }

  // rails and boxes
  {
    const steel = [], paint = [], deck = [];
    const zAxis = new THREE.Vector3(0, 0, 1), dir = new THREE.Vector3();
    for (const r of course.rails) {
      const isBox = r.kind === 'box', w = isBox ? 1.0 : 0.14, th = isBox ? 0.36 : 0.1;
      for (const sg of r.segs) {
        dir.set(sg.dx, sg.dy, sg.dz); Q.setFromUnitVectors(zAxis, dir);
        const mx = (sg.a.x + sg.b.x) / 2, my = (sg.a.y + sg.b.y) / 2, mz = (sg.a.z + sg.b.z) / 2;
        const put = (list, g) => { g.applyQuaternion(Q); g.translate(mx, my, mz); list.push(g); };
        if (isBox) {
          put(deck, box(w - 0.12, 0.05, sg.len + 0.02, 0, -0.025, 0));
          put(paint, box(w, th, sg.len, 0, -0.05 - th / 2, 0));
          put(steel, box(0.07, 0.07, sg.len + 0.04, w / 2 - 0.03, -0.03, 0)); put(steel, box(0.07, 0.07, sg.len + 0.04, -w / 2 + 0.03, -0.03, 0));
        } else put(steel, box(w, th, sg.len + 0.06, 0, -th / 2, 0));
        const nposts = Math.max(1, Math.round(sg.len / 2.4));
        for (let k = 0; k <= nposts; k++) {
          const t = k / nposts, px = sg.a.x + sg.dx * sg.len * t, py = sg.a.y + sg.dy * sg.len * t, pz = sg.a.z + sg.dz * sg.len * t;
          const gy = course.heightAt(px, pz) - 0.3, hgt = py - th - gy;
          if (hgt > 0.12) paint.push(box(isBox ? 0.16 : 0.11, hgt, isBox ? 0.16 : 0.11, px, gy + hgt / 2, pz));
        }
      }
    }
    const add = (list, mat) => { if (!list.length) return; const m = new THREE.Mesh(mergeGeoms(list), mat); m.castShadow = true; m.receiveShadow = true; scene.add(m); };
    add(steel, patchMaterial(new THREE.MeshStandardMaterial({ color: 0xc9d1dd, roughness: 0.38, metalness: 0.3 })));
    add(paint, patchMaterial(new THREE.MeshStandardMaterial({ color: 0xe8842e, roughness: 0.6, metalness: 0.1 })));
    add(deck, patchMaterial(new THREE.MeshStandardMaterial({ color: 0xdfe4ec, roughness: 0.5, metalness: 0.1 })));
  }
  await progress(1);
  return { smoke, terrainMat };
}
