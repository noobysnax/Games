// The mountain: one analytic height function, sampled into
//   - a 0.5 m physics grid, read through a cubic B-spline (C2 smooth, so the rider never feels the voxels)
//   - a 1 m column grid for the voxel renderer (heights snapped to 1/8 m "snow layers")
// plus everything that sits on it: kickers, rails, trees, rocks, lanterns, buildings.
// Course space is (x, d): x across the hill, d metres downhill from the start gate. World z = -d.
// No DOM, no three.js.

import { clamp, lerp, smooth, fbm, ridged, mulberry32, TAU } from './util.js';

export const XH = 72;            // half width of the detailed terrain
export const D0 = -32;           // detailed terrain starts this far behind the gate
export const D1 = 696;           // ...and ends here
export const NX = XH * 2;
export const NZ = D1 - D0;
export const FINISH = 612;
export const FLOOR = 15;         // valley floor / frozen lake level
export const SURF = { PISTE: 0, POWDER: 1, PARK: 2, ICE: 3, ROCK: 4 };
export const DYE = 8;            // column flag: painted lip line

const DEG = Math.PI / 180;

/* ---------------------------------------------------------------- fall-line profile */
// [distance downhill, slope angle in degrees]; positive = descending.
const SLOPE_KEYS = [
  [-80, -42], [-24, -40], [-15, -10], [-10, 30], [-4, 26], [-1, 3], [9, 3],
  [15, 25], [34, 27], [46, 16], [58, 13], [112, 13],          // drop-in, rollers
  [120, 19], [136, 19], [143, 8], [150, 8], [156, 27], [196, 27], [208, 15], // first kicker + landing
  [305, 14], [316, 10.5], [392, 10.5],                         // bends, rail garden
  [402, 18], [420, 23], [440, 23], [447, 20], [452, 20], [459, 30], [520, 30], [534, 14], // big kicker
  [596, 12], [607, 5], [618, 0], [640, -2.5], [700, -1], [740, 4], [900, 5], [1000, 0], [1300, 0],
];
const PD0 = -80, PSTEP = 0.25, PN = Math.round((1300 - PD0) / PSTEP);
const prof = new Float32Array(PN + 1);
function slopeAt(d) {
  const K = SLOPE_KEYS;
  if (d <= K[0][0]) return K[0][1];
  for (let i = 0; i < K.length - 1; i++) {
    if (d < K[i + 1][0]) return lerp(K[i][1], K[i + 1][1], smooth(K[i][0], K[i + 1][0], d));
  }
  return K[K.length - 1][1];
}
{
  let h = 0;
  for (let i = 0; i <= PN; i++) {
    prof[i] = h;
    h -= Math.tan(slopeAt(PD0 + (i + 0.5) * PSTEP) * DEG) * PSTEP;
  }
  const shift = 30 - prof[Math.round((FINISH - PD0) / PSTEP)];
  for (let i = 0; i <= PN; i++) prof[i] += shift;
}
export function profile(d) {
  if (d < PD0) return prof[0] - (PD0 - d) * 0.9;
  const f = Math.min((d - PD0) / PSTEP, PN - 1e-3);
  const i = f | 0;
  return prof[i] + (prof[i + 1] - prof[i]) * (f - i);
}

/* ---------------------------------------------------------------- piste shape */
const bendWin = (d) => smooth(194, 234, d) * (1 - smooth(286, 326, d));
const gullyWin = (d) => smooth(520, 548, d) * (1 - smooth(584, 608, d));
function centerRaw(d) {
  return 5 * Math.sin((TAU * d) / 260)
    + 14 * bendWin(d) * Math.sin((TAU * (d - 204)) / 112)
    + 5 * gullyWin(d) * Math.sin((TAU * (d - 530)) / 90);
}
const CSTEP = 0.5, CN = Math.round((1300 - PD0) / CSTEP);
const cxT = new Float32Array(CN + 1), cxppT = new Float32Array(CN + 1);
for (let i = 0; i <= CN; i++) {
  const d = PD0 + i * CSTEP;
  cxT[i] = centerRaw(d);
  cxppT[i] = (centerRaw(d + 1.5) - 2 * centerRaw(d) + centerRaw(d - 1.5)) / 2.25;
}
const tab = (T, d) => {
  const f = clamp((d - PD0) / CSTEP, 0, CN - 1e-3);
  const i = f | 0;
  return T[i] + (T[i + 1] - T[i]) * (f - i);
};
/** x of the piste centreline at distance d. */
export const centerX = (d) => tab(cxT, d);
const centerPP = (d) => tab(cxppT, d);
/** Half width of the groomed piste. */
export function halfWidth(d) {
  let w = 17;
  w = lerp(w, 12.5, bendWin(d));
  w = lerp(w, 8.5, gullyWin(d));
  w = lerp(9, w, smooth(6, 30, d));
  w = lerp(w, 34, smooth(596, 630, d));
  return w;
}
const rollers = (d) => 1.15 * Math.sin((TAU * (d - 60)) / 21) * smooth(58, 66, d) * (1 - smooth(100, 110, d));

/* ---------------------------------------------------------------- kickers */
// d = lip position, xo = offset from the centreline, w = width, h = lip height, len = ramp length, sh = landing shoulder
export const KICKERS = [
  { name: 'Side hit', d: 86, xo: 9.5, w: 6, h: 0.9, len: 5, sh: 8 },
  { name: 'First kicker', d: 150, xo: 0, w: 11, h: 2.0, len: 11, sh: 18 },
  { name: 'Bend hip', d: 262, xo: -7, w: 6, h: 1.1, len: 6, sh: 9 },
  { name: 'Big Ember', d: 452, xo: 0, w: 13, h: 3.4, len: 15, sh: 26 },
  { name: 'Gully pop', d: 592, xo: 0, w: 6, h: 1.0, len: 5.5, sh: 8 },
];
for (const k of KICKERS) k.x = centerRaw(k.d) + k.xo;
function kickerLat(k, x) { return 1 - smooth(k.w / 2 - 2.4, k.w / 2, Math.abs(x - k.x)); }
function kickerH(x, d) {
  let h = 0;
  for (const k of KICKERS) {
    if (d < k.d - k.len || d > k.d + k.sh) continue;
    const lat = kickerLat(k, x);
    if (lat <= 0) continue;
    if (d <= k.d) {
      const t = (d - (k.d - k.len)) / k.len;
      h += k.h * t * t * lat;
    } else {
      h += k.h * 0.9 * (1 - smooth(0, k.sh, d - k.d)) * lat;
    }
  }
  return h;
}

/* ---------------------------------------------------------------- the height function */
const POND = { x: -36, d: 664, r: 12 };
const POND_Y = profile(POND.d) - 0.35;
const LODGE = { x0: 26, x1: 44, d0: 650, d1: 664 };

function localH(x, d) {
  const cx = centerX(d), w = halfWidth(d);
  const u = x - cx, a = Math.abs(u);
  const out = Math.max(0, a - w), outc = Math.min(out, 58);
  let bank = 0.16 * Math.pow(outc, 1.22);
  const gw = gullyWin(d);
  if (gw > 0) bank = lerp(bank, Math.max(bank, Math.min(0.17 * out * out, 3.4 + 0.22 * outc)), gw);
  const baseFade = smooth(592, 640, d);
  bank *= 1 - 0.8 * baseFade;
  let h = profile(d) + 0.004 * Math.min(a, w) ** 2 + bank;
  h += rollers(d) * (1 - smooth(w - 2, w + 8, a));
  h -= clamp(centerPP(d), -0.05, 0.05) * 4.2 * clamp(u, -w - 3, w + 3);
  const off = smooth(w - 1, w + 12, a) * (1 - 0.7 * baseFade);
  h += fbm(x * 0.045 + 3.1, d * 0.045 - 7.7, 3) * 2.6 * off;
  h += fbm(x * 0.17, d * 0.17 + 9, 2) * 0.4 * smooth(w, w + 5, a);
  h += fbm(x * 0.03 + 11, d * 0.03 + 50, 2) * 0.3;
  const ax = Math.abs(x);
  if (ax > 80) h -= (ax - 80) * 0.62;
  // frozen pond and the lodge terrace are levelled
  const pd = Math.hypot(x - POND.x, d - POND.d);
  if (pd < 22) h = lerp(POND_Y, h, smooth(POND.r, 22, pd));
  const lx = Math.max(LODGE.x0 - x, 0, x - LODGE.x1), ld = Math.max(LODGE.d0 - d, 0, d - LODGE.d1);
  const ldist = Math.hypot(lx, ld);
  if (ldist < 8) h = lerp(LODGE_Y, h, smooth(1.5, 8, ldist));
  return h;
}
const LODGE_Y = profile(657) + 0.25;

/** Terrain height at course position (x, d): valid everywhere, including the far backdrop. */
export function terrainH(x, d) {
  let h = localH(x, d) + kickerH(x, d);
  if (Math.abs(x) <= XH + 8 && d >= D0 - 8 && d <= D1 + 8) return h;
  const floor = FLOOR;
  if (h < floor) h = floor;
  const R = Math.hypot(x, d - 330);
  if (R > 400) {
    const ang = Math.abs(Math.atan2(x, d - 330));
    const m = smooth(400, 1000, R) * smooth(0.22, 0.75, ang);
    if (m > 0) h += m * (Math.pow(ridged(x * 0.0013 + 5, d * 0.0013 - 3, 5), 1.3) * 380 + 24);
  }
  return h;
}
export const isLake = (x, d) => localH(x, d) <= FLOOR;

/* ---------------------------------------------------------------- sections */
export const SECTIONS = [
  { d: 0, name: 'Summit' }, { d: 44, name: 'The Rollers' }, { d: 116, name: 'First Kicker' },
  { d: 200, name: 'Lantern Bends' }, { d: 318, name: 'Rail Garden' }, { d: 398, name: 'Big Ember' },
  { d: 528, name: 'The Gully' }, { d: 606, name: 'Lodge' },
];
export function sectionAt(d) {
  let s = SECTIONS[0];
  for (const c of SECTIONS) if (d >= c.d - 4) s = c;
  return s;
}

/* ---------------------------------------------------------------- rails */
// Each point: [d, height above the snow]. Rails start almost flush with the snow so you can ride straight on.
const RAIL_DEFS = [
  { name: 'Down rail', kind: 'rail', xo: -9, pts: [[328, 0.1], [330.5, 0.55], [342, 0.55]] },
  { name: 'Fun box', kind: 'box', xo: 8.5, pts: [[332, 0.12], [334.2, 0.5], [346, 0.5]] },
  { name: 'Long rail', kind: 'rail', xo: 0, pts: [[351, 0.1], [353.5, 0.6], [375, 0.6]] },
  { name: 'Kink rail', kind: 'rail', xo: -8.5, pts: [[364, 0.1], [366.5, 0.6], [373, 1.35], [380, 0.65], [387, 0.65]] },
  { name: 'Long box', kind: 'box', xo: 9, pts: [[370, 0.12], [372.2, 0.5], [389, 0.5]] },
  { name: 'Gully rail', kind: 'rail', xo: 0, pts: [[556, 0.1], [558.5, 0.6], [574, 0.6]] },
];

/* ---------------------------------------------------------------- build */
/**
 * Build the course. `onProgress(fraction)` may return a promise so the caller can yield to the browser.
 */
export async function buildCourse(onProgress = () => {}) {
  /* physics grid */
  const PS = 0.5;
  const NPX = Math.round((XH * 2) / PS) + 1, NPD = Math.round((D1 - D0) / PS) + 1;
  const PH = new Float32Array(NPX * NPD);
  for (let j = 0; j < NPD; j++) {
    const d = D0 + j * PS;
    for (let i = 0; i < NPX; i++) PH[j * NPX + i] = terrainH(-XH + i * PS, d);
    if ((j & 127) === 0) await onProgress(0.6 * (j / NPD));
  }

  /** Smooth height + gradient at world (x, z). Writes out.h, out.gx, out.gz. */
  function sample(x, z, out) {
    const fx = clamp((x + XH) / PS, 1, NPX - 3.001), fd = clamp((-z - D0) / PS, 1, NPD - 3.001);
    const ix = fx | 0, id = fd | 0, tx = fx - ix, td = fd - id;
    const tx2 = tx * tx, tx3 = tx2 * tx, td2 = td * td, td3 = td2 * td;
    const ux = 1 - tx, ud = 1 - td;
    const wx0 = (ux * ux * ux) / 6, wx1 = (3 * tx3 - 6 * tx2 + 4) / 6, wx2 = (-3 * tx3 + 3 * tx2 + 3 * tx + 1) / 6, wx3 = tx3 / 6;
    const ex0 = -0.5 * ux * ux, ex1 = 1.5 * tx2 - 2 * tx, ex2 = -1.5 * tx2 + tx + 0.5, ex3 = 0.5 * tx2;
    const wd0 = (ud * ud * ud) / 6, wd1 = (3 * td3 - 6 * td2 + 4) / 6, wd2 = (-3 * td3 + 3 * td2 + 3 * td + 1) / 6, wd3 = td3 / 6;
    const ed0 = -0.5 * ud * ud, ed1 = 1.5 * td2 - 2 * td, ed2 = -1.5 * td2 + td + 0.5, ed3 = 0.5 * td2;
    let h = 0, hx = 0, hd = 0;
    let r = (id - 1) * NPX + ix - 1;
    let a = PH[r] * wx0 + PH[r + 1] * wx1 + PH[r + 2] * wx2 + PH[r + 3] * wx3;
    let b = PH[r] * ex0 + PH[r + 1] * ex1 + PH[r + 2] * ex2 + PH[r + 3] * ex3;
    h += a * wd0; hx += b * wd0; hd += a * ed0;
    r += NPX;
    a = PH[r] * wx0 + PH[r + 1] * wx1 + PH[r + 2] * wx2 + PH[r + 3] * wx3;
    b = PH[r] * ex0 + PH[r + 1] * ex1 + PH[r + 2] * ex2 + PH[r + 3] * ex3;
    h += a * wd1; hx += b * wd1; hd += a * ed1;
    r += NPX;
    a = PH[r] * wx0 + PH[r + 1] * wx1 + PH[r + 2] * wx2 + PH[r + 3] * wx3;
    b = PH[r] * ex0 + PH[r + 1] * ex1 + PH[r + 2] * ex2 + PH[r + 3] * ex3;
    h += a * wd2; hx += b * wd2; hd += a * ed2;
    r += NPX;
    a = PH[r] * wx0 + PH[r + 1] * wx1 + PH[r + 2] * wx2 + PH[r + 3] * wx3;
    b = PH[r] * ex0 + PH[r + 1] * ex1 + PH[r + 2] * ex2 + PH[r + 3] * ex3;
    h += a * wd3; hx += b * wd3; hd += a * ed3;
    out.h = h; out.gx = hx / PS; out.gz = -hd / PS;
    return out;
  }
  const _s = { h: 0, gx: 0, gz: 0 };
  const heightAt = (x, z) => sample(x, z, _s).h;

  /* render columns */
  const colH = new Float32Array(NX * NZ), colSurf = new Uint8Array(NX * NZ);
  for (let j = 0; j < NZ; j++) {
    const d = D0 + j + 0.5, cx = centerX(d), w = halfWidth(d);
    for (let i = 0; i < NX; i++) {
      const x = -XH + i + 0.5;
      const h = terrainH(x, d);
      colH[j * NX + i] = Math.round(h * 8) / 8;
      const a = Math.abs(x - cx);
      let s = a < w - 0.5 ? SURF.PISTE : SURF.POWDER;
      const slope = Math.hypot(terrainH(x + 1, d) - terrainH(x - 1, d), terrainH(x, d + 1) - terrainH(x, d - 1)) / 2;
      if (s === SURF.POWDER && (slope > 1.15 || (Math.abs(x) > 60 && fbm(x * 0.07, d * 0.07 + 3, 2) > 0.34))) s = SURF.ROCK;
      if (d < -6 && fbm(x * 0.09, d * 0.09, 2) > 0.05) s = SURF.ROCK;
      for (const k of KICKERS) {
        if (d > k.d - k.len - 1 && d < k.d + 3 && kickerLat(k, x) > 0.35) {
          s = SURF.PARK;
          if (d > k.d - 1.2 && d < k.d + 0.1 && kickerLat(k, x) > 0.6) s |= DYE;
        }
      }
      if (Math.hypot(x - POND.x, d - POND.d) < POND.r) s = SURF.ICE;
      colSurf[j * NX + i] = s;
    }
    if ((j & 63) === 0) await onProgress(0.6 + 0.3 * (j / NZ));
  }
  const surfaceAt = (x, z) => {
    const i = clamp(Math.floor(x + XH), 0, NX - 1), j = clamp(Math.floor(-z - D0), 0, NZ - 1);
    return colSurf[j * NX + i] & 7;
  };

  /* rails */
  const rails = RAIL_DEFS.map((def) => {
    const pts = def.pts.map(([d, off]) => {
      const x = centerX(def.pts[0][0]) + def.xo;
      return { x, y: terrainH(x, d) + off, z: -d };
    });
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
      segs.push({ a, b, len, dx: dx / len, dy: dy / len, dz: dz / len });
    }
    const half = def.kind === 'box' ? 0.5 : 0.07;
    for (let j = Math.floor(def.pts[0][0] - D0) - 1; j <= Math.floor(def.pts[def.pts.length - 1][0] - D0) + 1; j++) {
      for (let i = Math.floor(pts[0].x + XH - 1.6); i <= Math.floor(pts[0].x + XH + 1.6); i++) colSurf[j * NX + i] = SURF.PARK;
    }
    return { name: def.name, kind: def.kind, half, capture: def.kind === 'box' ? 0.8 : 0.5, pts, segs, zMax: pts[0].z, zMin: pts[pts.length - 1].z };
  });

  /* props */
  const rnd = mulberry32(20261);
  const trees = [], rocks = [], lanterns = [], flags = [], colliders = [];
  const onKicker = (x, d) => KICKERS.some((k) => d > k.d - k.len - 4 && d < k.d + k.sh + 4 && Math.abs(x - k.x) < k.w / 2 + 3);
  for (let gd = -4; gd < D1 - 6; gd += 5.5) {
    for (let gx = -XH + 3; gx < XH - 3; gx += 5.5) {
      const x = gx + rnd() * 4.5, d = gd + rnd() * 4.5;
      const out = Math.abs(x - centerX(d)) - halfWidth(d);
      const roll = rnd(), kind = rnd();
      if (out < 2.6 || onKicker(x, d)) continue;
      if (d > 600 && Math.abs(x) < 50) continue;
      if (Math.hypot(x - POND.x, d - POND.d) < POND.r + 6) continue;
      if (x > LODGE.x0 - 6 && x < LODGE.x1 + 6 && d > LODGE.d0 - 6 && d < LODGE.d1 + 8) continue;
      const i = clamp(Math.floor(x + XH), 0, NX - 1), j = clamp(Math.floor(d - D0), 0, NZ - 1);
      const surf = colSurf[j * NX + i] & 7;
      const forest = clamp(0.3 + fbm(x * 0.02 + 50, d * 0.02 - 20, 3) * 1.3, 0.04, 0.9) * smooth(14, 80, d);
      if (surf === SURF.ROCK || roll > forest) {
        if (kind < 0.07 && out > 4 && surf !== SURF.ICE) {
          const variant = (rnd() * 3) | 0;
          rocks.push({ x: Math.floor(x) + 0.5, d: Math.floor(d) + 0.5, y: colH[j * NX + i], r: 1.2 + variant * 0.4, variant, rot: (rnd() * 4) | 0 });
        }
        continue;
      }
      trees.push({ x: Math.floor(x) + 0.5, d: Math.floor(d) + 0.5, y: colH[j * NX + i], variant: (rnd() * 6) | 0, rot: (rnd() * 4) | 0 });
    }
  }
  for (const t of trees) colliders.push({ x: t.x, z: -t.d, r: 0.55, y0: t.y, h: 9, kind: 'tree' });
  for (const r of rocks) colliders.push({ x: r.x, z: -r.d, r: r.r, y0: r.y, h: 1.6, kind: 'rock' });
  let side = 1;
  for (let d = 18; d < FINISH + 20; d += 13) {
    side = -side;
    const x = Math.round(centerX(d) + side * (halfWidth(d) + 1.6)) + 0.5;
    if (onKicker(x, d)) continue;
    const dd = Math.floor(d) + 0.5;
    lanterns.push({ x, d: dd, y: Math.round(terrainH(x, dd) * 8) / 8 });
  }
  for (const k of KICKERS) {
    if (k.h < 1.5) continue;
    for (const s of [-1, 1]) {
      const x = Math.round(k.x + s * (k.w / 2 + 1)) + 0.5, d = Math.floor(k.d - 1) + 0.5;
      flags.push({ x, d, y: Math.round(terrainH(x, d) * 8) / 8, color: s < 0 ? 'red' : 'blue' });
    }
  }
  for (const l of lanterns) colliders.push({ x: l.x, z: -l.d, r: 0.22, y0: l.y, h: 2.4, kind: 'post' });
  for (const f of flags) colliders.push({ x: f.x, z: -f.d, r: 0.2, y0: f.y, h: 3, kind: 'post' });
  const gates = [
    { kind: 'start', x: centerX(10), d: 10.5, half: 5 },
    { kind: 'finish', x: centerX(FINISH), d: FINISH + 0.5, half: 12 },
  ];
  for (const g of gates) {
    g.y = terrainH(g.x, g.d);
    for (const s of [-1, 1]) {
      const px = Math.round(g.x + s * g.half) + 0.5;
      colliders.push({ x: px, z: -g.d, r: 0.6, y0: terrainH(px, g.d), h: 7, kind: 'post' });
    }
  }
  const boxes = [{ x0: LODGE.x0, x1: LODGE.x1, z0: -LODGE.d1, z1: -LODGE.d0, y1: LODGE_Y + 12 }];

  // spatial hash for cylinder colliders
  const CELL = 8, hash = new Map();
  const key = (cx, cz) => cx * 4096 + cz;
  for (const c of colliders) {
    const k = key(Math.floor(c.x / CELL), Math.floor(c.z / CELL));
    let a = hash.get(k);
    if (!a) hash.set(k, (a = []));
    a.push(c);
  }
  function collidersNear(x, z, visit) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = hash.get(key(cx + i, cz + j));
      if (a) for (const c of a) visit(c);
    }
  }

  // lantern light per column (0..1), for the night glow
  const colLight = new Float32Array(NX * NZ);
  for (const l of lanterns) {
    const li = Math.floor(l.x + XH), lj = Math.floor(l.d - D0), R = 9;
    for (let j = Math.max(0, lj - R); j <= Math.min(NZ - 1, lj + R); j++) for (let i = Math.max(0, li - R); i <= Math.min(NX - 1, li + R); i++) {
      const v = clamp(1 - Math.hypot(i - li, j - lj) / R, 0, 1);
      if (v > colLight[j * NX + i]) colLight[j * NX + i] = v;
    }
  }
  await onProgress(1);

  const spawn = (d) => {
    const x = centerX(d), z = -d;
    return { x, y: heightAt(x, z), z };
  };

  return {
    sample, heightAt, surfaceAt, colH, colSurf, colLight, rails, trees, rocks, lanterns, flags, gates, boxes,
    collidersNear, spawn, lodge: { ...LODGE, y: LODGE_Y }, pond: { ...POND, y: POND_Y },
    bounds: { xMin: -XH + 4, xMax: XH - 4, zMax: -D0 - 26, zMin: -D1 + 6 },
  };
}
