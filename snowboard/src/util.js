// Shared math helpers and deterministic noise. No DOM, no three.js: the physics tests import this in Node.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent approach of `a` toward `b` with rate `k` (1/s). */
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
/** Wrap an angle into (-PI, PI]. */
export const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
export const TAU = Math.PI * 2;

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function makeSimplex(seed) {
  const rnd = mulberry32(seed);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const gx = [1, -1, 1, -1, 1, -1, 0, 0];
  const gy = [1, 1, -1, -1, 0, 0, 1, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  return (xin, yin) => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let tt = 0.5 - x0 * x0 - y0 * y0;
    if (tt > 0) {
      const g = p[ii + p[jj]] & 7;
      tt *= tt;
      n += tt * tt * (gx[g] * x0 + gy[g] * y0);
    }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt > 0) {
      const g = p[ii + i1 + p[jj + j1]] & 7;
      tt *= tt;
      n += tt * tt * (gx[g] * x1 + gy[g] * y1);
    }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt > 0) {
      const g = p[ii + 1 + p[jj + 1]] & 7;
      tt *= tt;
      n += tt * tt * (gx[g] * x2 + gy[g] * y2);
    }
    return 70 * n;
  };
}

const SN = makeSimplex(1337);
export function fbm(x, z, oct = 4) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * SN(x * f + i * 31.7, z * f - i * 17.3);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}
export function ridged(x, z, oct = 5) {
  let a = 1, f = 1, s = 0, n = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(SN(x * f + i * 17.3, z * f - i * 9.1));
    v *= v;
    v *= w;
    w = clamp(v * 1.6, 0, 1);
    s += v * a;
    n += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / n;
}
