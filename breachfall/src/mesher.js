// Greedy mesher: turns a box of the voxel grid into merged quads, one material per quad.
// Works on any array laid out like the world ((y * sz + z) * sx + x), so falling pieces reuse it.

import { MAT } from './config.js';

const PAL = new Uint8Array(64 * 4);
MAT.forEach((m, i) => {
  PAL[i * 4] = (m.color >> 16) & 255; PAL[i * 4 + 1] = (m.color >> 8) & 255; PAL[i * 4 + 2] = m.color & 255;
  // alpha carries shading hints to the shader: below 128 is colour jitter, 128 and up is glow strength
  PAL[i * 4 + 3] = m.glow > 0 ? 128 + Math.round(m.glow * 127) : Math.round(Math.min(1, m.jit / 0.4) * 127);
});

let P = new Float32Array(1 << 16), N = new Int8Array(1 << 16), C = new Uint8Array(1 << 17), I = new Uint32Array(1 << 16);
let mask = new Int16Array(64 * 64);
function grow(nv, ni) {
  if (nv * 3 > P.length) { const p = new Float32Array(P.length * 2); p.set(P); P = p; const n = new Int8Array(N.length * 2); n.set(N); N = n; const c = new Uint8Array(C.length * 2); c.set(C); C = c; }
  if (ni > I.length) { const i = new Uint32Array(I.length * 2); i.set(I); I = i; }
}

// data/dims: the array; lo/hi: box to mesh (hi exclusive). Positions come out in voxel units, minus `org`.
export function meshBox(data, sx, sy, sz, lo, hi, org = [0, 0, 0]) {
  const dims = [sx, sy, sz], strides = [1, sx * sz, sx]; // x, y, z strides
  let nv = 0, ni = 0;
  const x = [0, 0, 0], q = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const w = hi[u] - lo[u], h = hi[v] - lo[v];
    if (mask.length < w * h) mask = new Int16Array(w * h);
    const sd = strides[d], su = strides[u], sv = strides[v];
    q[0] = q[1] = q[2] = 0; q[d] = 1;
    // plane k sits between voxel k-1 and voxel k along d
    for (let k = lo[d]; k <= hi[d]; k++) {
      let any = false, n = 0;
      for (let j = lo[v]; j < hi[v]; j++) {
        x[d] = k; x[v] = j; x[u] = lo[u];
        let i = (x[1] * sz + x[2]) * sx + x[0];
        for (let ii = 0; ii < w; ii++, i += su, n++) {
          const a = k > 0 ? data[i - sd] & 63 : 0, b = k < dims[d] ? data[i] & 63 : 0;
          // a face belongs to this box only if its solid voxel does
          if (a && !b && k > lo[d]) { mask[n] = a; any = true; }
          else if (b && !a && k < hi[d]) { mask[n] = -b; any = true; }
          else mask[n] = 0;
        }
      }
      if (!any) continue;
      n = 0;
      for (let j = 0; j < h; j++) for (let i = 0; i < w;) {
        const m = mask[n];
        if (!m) { i++; n++; continue; }
        let ww = 1; while (i + ww < w && mask[n + ww] === m) ww++;
        let hh = 1, ok = true;
        while (j + hh < h && ok) { for (let t = 0; t < ww; t++) if (mask[n + t + hh * w] !== m) { ok = false; break; } if (ok) hh++; }
        grow(nv + 4, ni + 6);
        x[d] = k; x[u] = lo[u] + i; x[v] = lo[v] + j;
        const mat = m > 0 ? m : -m, sgn = m > 0 ? 1 : -1;
        for (let c = 0; c < 4; c++) {
          const du = (c === 1 || c === 2) ? ww : 0, dv = c >= 2 ? hh : 0, o = (nv + c) * 3;
          P[o + d] = x[d] - org[d]; P[o + u] = x[u] + du - org[u]; P[o + v] = x[v] + dv - org[v];
          N[o] = N[o + 1] = N[o + 2] = 0; N[o + d] = sgn;
          const co = (nv + c) * 4; C[co] = PAL[mat * 4]; C[co + 1] = PAL[mat * 4 + 1]; C[co + 2] = PAL[mat * 4 + 2]; C[co + 3] = PAL[mat * 4 + 3];
        }
        if (sgn > 0) { I[ni] = nv; I[ni + 1] = nv + 1; I[ni + 2] = nv + 2; I[ni + 3] = nv; I[ni + 4] = nv + 2; I[ni + 5] = nv + 3; }
        else { I[ni] = nv; I[ni + 1] = nv + 2; I[ni + 2] = nv + 1; I[ni + 3] = nv; I[ni + 4] = nv + 3; I[ni + 5] = nv + 2; }
        nv += 4; ni += 6;
        for (let b = 0; b < hh; b++) for (let a = 0; a < ww; a++) mask[n + a + b * w] = 0;
        i += ww; n += ww;
      }
    }
  }
  return { pos: P.slice(0, nv * 3), nrm: N.slice(0, nv * 3), col: C.slice(0, nv * 4), idx: I.slice(0, ni), quads: nv / 4 };
}
export const palette = PAL;
