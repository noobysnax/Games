// Renderer, atmosphere and post chain. Same look as Lanternvale Skies: procedural 16px pixel-art atlas,
// analytic sky + height fog shared by every material, soft shadows, god rays, bloom, film grade.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp, lerp, smooth, mulberry32 } from './util.js';

export const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ atlas */
export const T = {
  snow: 0, snowSide: 1, groomed: 2, packed: 3, dye: 4, ice: 5, stone: 6, stoneSnow: 7,
  logSide: 8, logTop: 9, spruce: 10, spruceSnow: 11, leafTop: 12, planks: 13, cobble: 14, roof: 15,
  roofSnow: 16, window: 17, doorB: 18, doorT: 19, steel: 20, paint: 21, flagRed: 22, flagBlue: 23,
  checker: 24, darkWood: 25, boxTop: 26, lamp: 27, banner: 28, stoneTop: 29,
};
const AW = 256, AH = 128;
export const tileUV = (t, s, v) => [((t % 8) * 32 + 8 + s * 16) / AW, (Math.floor(t / 8) * 32 + 8 + v * 16) / AH];

function buildAtlas() {
  const r = mulberry32(2024);
  const hx = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const pal = (a) => a.map(hx);
  const solid = () => { const b = new Uint8ClampedArray(1024); b.fill(255); return b; };
  const put = (b, x, y, c, a = 255) => { x = ((x % 16) + 16) % 16; y = ((y % 16) + 16) % 16; const i = (y * 16 + x) * 4; b[i] = c[0]; b[i + 1] = c[1]; b[i + 2] = c[2]; b[i + 3] = a; };
  const get = (b, x, y) => { const i = (y * 16 + x) * 4; return [b[i], b[i + 1], b[i + 2], b[i + 3]]; };
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const pick = (a) => a[(r() * a.length) | 0];
  const lattice = (n = 4) => {
    const g = []; for (let i = 0; i < n * n; i++) g.push(r());
    const s = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const fx = (x / 16) * n, fy = (y / 16) * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = s(fx - x0), ty = s(fy - y0);
      const A = g[(y0 % n) * n + (x0 % n)], B = g[(y0 % n) * n + ((x0 + 1) % n)], C = g[((y0 + 1) % n) * n + (x0 % n)], D = g[((y0 + 1) % n) * n + ((x0 + 1) % n)];
      return lerp(lerp(A, B, tx), lerp(C, D, tx), ty);
    };
  };
  const copy = (b) => new Uint8ClampedArray(b);
  const each = (fn) => { const b = solid(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(b, x, y, fn(x, y)); return b; };
  const tiles = {}, emis = {};

  const SNOW = pal([0xf1f5fa, 0xe8eff7, 0xfafcfe, 0xdee8f3]);
  { const n = lattice(4); const b = each((x, y) => mul(pick(SNOW), 0.95 + n(x, y) * 0.06));
    for (let k = 0; k < 7; k++) put(b, (r() * 16) | 0, (r() * 16) | 0, [255, 255, 255]);
    for (let k = 0; k < 5; k++) put(b, (r() * 16) | 0, (r() * 16) | 0, hx(0xcfdcec)); tiles[T.snow] = b; }
  tiles[T.snowSide] = each((x, y) => mul(pick(SNOW), (y % 5 === 4 ? 0.9 : 0.955) + r() * 0.02));
  tiles[T.groomed] = each((x) => mul(pick(pal([0xeef3f9, 0xe9f0f7, 0xf4f8fc])), x % 2 ? 0.925 : 1.0));
  { const n = lattice(2); tiles[T.packed] = each((x, y) => mul(pick(pal([0xe9f0f8, 0xe3ecf6, 0xeef4fa])), 0.97 + n(x, y) * 0.04)); }
  { const b = copy(tiles[T.packed]); for (let x = 0; x < 16; x++) { const o = r() < 0.3 ? 1 : 0; for (let y = 5 + o; y < 10 + o; y++) put(b, x, y, mul(pick(pal([0x2f7fe0, 0x3b8cf0, 0x2a70cc])), 0.95 + r() * 0.1)); } tiles[T.dye] = b; }
  { const n = lattice(4); const b = each((x, y) => mul(pick(pal([0xa9d3ea, 0xb7dcee, 0x9ecbe4])), 0.92 + n(x, y) * 0.14));
    for (let k = 0; k < 3; k++) { let x = (r() * 16) | 0, y = (r() * 16) | 0; for (let i = 0; i < 7; i++) { put(b, x, y, hx(0xe6f4fb)); x += r() < 0.6 ? 1 : 0; y += r() < 0.5 ? 1 : -1; } } tiles[T.ice] = b; }
  const SP = pal([0x8b8b8f, 0x7f7f84, 0x96969b, 0x747479]);
  { const n = lattice(4); const b = each((x, y) => mul(pick(SP), 0.82 + n(x, y) * 0.28));
    for (let k = 0; k < 3; k++) { let x = (r() * 16) | 0, y = (r() * 16) | 0; for (let i = 0; i < 5; i++) { put(b, x, y, hx(0x5e5e63)); x += r() < 0.5 ? 1 : 0; y += r() < 0.6 ? 1 : -1; } }
    for (let k = 0; k < 8; k++) put(b, (r() * 16) | 0, (r() * 16) | 0, hx(0xa9a9ad)); tiles[T.stone] = b; }
  { const b = copy(tiles[T.stone]); for (let x = 0; x < 16; x++) { const d = 2 + (r() < 0.6 ? 1 : 0) + (r() < 0.3 ? 2 : 0); for (let y = 0; y < d; y++) put(b, x, y, pick(SNOW)); }
    for (let k = 0; k < 6; k++) put(b, (r() * 16) | 0, 5 + ((r() * 10) | 0), pick(SNOW)); tiles[T.stoneSnow] = b; }
  { const b = copy(tiles[T.stone]), n = lattice(4); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (n(x, y) > 0.42) put(b, x, y, pick(SNOW)); tiles[T.stoneTop] = b; }
  { const base = hx(0x6b4a2b), ks = []; for (let x = 0; x < 16; x++) ks.push(0.8 + r() * 0.32);
    const b = each((x) => mul(base, ks[x] * (0.9 + r() * 0.16) * (x % 4 === 0 ? 0.74 : 1)));
    const kx = (r() * 14) | 0, ky = (r() * 14) | 0; put(b, kx, ky, hx(0x3f2a17)); put(b, kx + 1, ky, hx(0x3f2a17)); tiles[T.logSide] = b; }
  tiles[T.logTop] = each((x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return mul(d > 6.6 ? hx(0x5a3d22) : Math.floor(d) % 2 ? hx(0xb88a55) : hx(0xa47843), 0.93 + r() * 0.12); });
  const LEAF = pal([0x2a5432, 0x23492b, 0x305f39, 0x1e3f25]);
  { const b = solid(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { let c = pick(LEAF); if ((x + y * 2) % 5 === 0) c = mul(c, 1.25); put(b, x, y, c, r() < 0.13 ? 0 : 255); } tiles[T.spruce] = b; }
  { const b = copy(tiles[T.spruce]); for (let x = 0; x < 16; x++) { const d = 3 + (r() < 0.6 ? 1 : 0) + (r() < 0.35 ? 2 : 0); for (let y = 0; y < d; y++) put(b, x, y, mul(pick(SNOW), y === d - 1 ? 0.9 : 1)); } tiles[T.spruceSnow] = b; }
  tiles[T.leafTop] = each(() => (r() < 0.1 ? pick(LEAF) : pick(SNOW)));
  { const base = hx(0xb27c47), bk = [1.0, 0.88, 1.06, 0.93], sx = [3, 11, 7, 14];
    tiles[T.planks] = each((x, y) => { const bd = y >> 2; let c = mul(base, bk[bd] * (0.94 + r() * 0.1)); if (y % 4 === 3) c = mul(c, 0.6); else if (x === sx[bd]) c = mul(c, 0.68); return c; }); }
  { const base = hx(0x4d3523), bk = [1.0, 0.86, 1.08, 0.92];
    tiles[T.darkWood] = each((x, y) => { let c = mul(base, bk[y >> 2] * (0.92 + r() * 0.14)); if (y % 4 === 3) c = mul(c, 0.6); return c; }); }
  { const pts = []; for (let i = 0; i < 8; i++) pts.push({ x: r() * 16, y: r() * 16, s: 0.78 + r() * 0.36 });
    tiles[T.cobble] = each((x, y) => { let d1 = 1e9, d2 = 1e9, bp = null; for (const p of pts) for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16) { const d = Math.hypot(x + 0.5 - p.x - ox, y + 0.5 - p.y - oy); if (d < d1) { d2 = d1; d1 = d; bp = p; } else if (d < d2) d2 = d; }
      return d2 - d1 < 1.15 ? mul(hx(0x4b4a4c), 0.85 + r() * 0.25) : mul(hx(0x8f8e90), bp.s * (0.92 + r() * 0.12)); }); }
  { const P = pal([0x55627a, 0x4b576c, 0x5f6d86, 0x434e61]), cols = []; for (let i = 0; i < 64; i++) cols.push(pick(P));
    tiles[T.roof] = each((x, y) => { const ry = y >> 2, off = (ry & 1) * 2, sxx = ((x + off) >> 2) & 3; let c = mul(cols[ry * 4 + sxx], 0.94 + r() * 0.1); if (y % 4 === 3) c = mul(c, 0.55); else if ((x + off) % 4 === 0) c = mul(c, 0.78); return c; }); }
  { const b = copy(tiles[T.roof]); for (let x = 0; x < 16; x++) { const d = 4 + (r() < 0.5 ? 1 : 0) + (r() < 0.3 ? 2 : 0); for (let y = 0; y < d; y++) put(b, x, y, mul(pick(SNOW), y === d - 1 ? 0.88 : 1)); } tiles[T.roofSnow] = b; }
  const black = () => { const e = solid(); for (let i = 0; i < 256; i++) { e[i * 4] = 0; e[i * 4 + 1] = 0; e[i * 4 + 2] = 0; } return e; };
  { const b = solid(), e = black();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const border = x < 2 || x > 13 || y < 2 || y > 13, mull = x === 7 || x === 8 || y === 7 || y === 8;
      if (border || mull) put(b, x, y, mul(hx(0x5b3a1f), (x === 0 || y === 0 || x === 15 || y === 15 ? 0.7 : 1) * (0.9 + r() * 0.15)));
      else { let c = mix(hx(0xffe09a), hx(0xf0a048), y / 15); if ((x + y) % 7 === 0) c = mix(c, [255, 250, 230], 0.5); put(b, x, y, c); put(e, x, y, mul(mix(hx(0xffd590), hx(0xff9a40), y / 15), 0.95 + r() * 0.05)); } }
    tiles[T.window] = b; emis[T.window] = e; }
  const door = (top) => { const b = solid(), e = black();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { let c = mul(hx(0x6a4426), 0.92 + r() * 0.12); if (x % 5 === 0) c = mul(c, 0.66); if (x === 0 || x === 15) c = mul(c, 0.7); put(b, x, y, c); }
    if (top) { for (let y = 4; y <= 10; y++) for (let x = 3; x <= 12; x++) { if (x === 7 || x === 8 || y === 7) continue; put(b, x, y, mix(hx(0xffdc94), hx(0xf2a24a), (y - 4) / 6)); put(e, x, y, mul(hx(0xffc274), 0.95)); } }
    else { put(b, 12, 7, hx(0xd8b060)); put(b, 12, 8, hx(0xb08a40)); }
    return [b, e]; };
  { const [b] = door(false); tiles[T.doorB] = b; } { const [b, e] = door(true); tiles[T.doorT] = b; emis[T.doorT] = e; }
  tiles[T.steel] = each((x, y) => mul(pick(pal([0x8a94a3, 0x7f8998, 0x969fae])), y < 2 ? 1.25 : y > 13 ? 0.75 : 0.95 + r() * 0.08));
  { const b = each((x, y) => mul(pick(pal([0xe8842e, 0xdc7a2a, 0xf09440])), y < 2 ? 1.12 : y > 13 ? 0.8 : 0.96 + r() * 0.07));
    for (let k = 0; k < 5; k++) put(b, (r() * 16) | 0, (r() * 16) | 0, hx(0x9a5a22)); tiles[T.paint] = b; }
  const cloth = (P) => each((x, y) => mul(pick(pal(P)), 0.9 + 0.12 * Math.sin(x * 0.9 + y * 0.25) + r() * 0.04));
  tiles[T.flagRed] = cloth([0xd8402c, 0xc93826, 0xe24a34]);
  tiles[T.flagBlue] = cloth([0x2f7fe0, 0x2a70cc, 0x3b8cf0]);
  { const b = cloth([0xf0903a, 0xe6842f, 0xf59c48]); for (let x = 0; x < 16; x++) for (const y of [3, 4, 11, 12]) put(b, x, y, mul(hx(0xfff0d8), 0.92 + r() * 0.06)); tiles[T.banner] = b; }
  tiles[T.checker] = each((x, y) => mul(((x >> 2) + (y >> 2)) % 2 ? hx(0x1c1c22) : hx(0xf2f2f2), 0.94 + r() * 0.06));
  tiles[T.boxTop] = each((x, y) => (x < 2 || x > 13 ? mul(hx(0xe8842e), 0.95 + r() * 0.08) : mul(hx(0xd9dee8), (y % 8 === 7 ? 0.86 : 0.97) + r() * 0.04)));
  { const b = solid(), e = black(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const c = mix(hx(0xffe2a0), hx(0xf7a040), Math.hypot(x - 7.5, y - 7.5) / 10); put(b, x, y, c); put(e, x, y, c); } tiles[T.lamp] = b; emis[T.lamp] = e; }

  const atlas = new Uint8Array(AW * AH * 4), em = new Uint8Array(AW * AH * 4);
  for (const key in tiles) {
    const t = +key, b = tiles[key], e = emis[key], cx = (t % 8) * 32, cy = Math.floor(t / 8) * 32;
    for (let py = 0; py < 32; py++) for (let px = 0; px < 32; px++) {
      const tx = (((px - 8) % 16) + 16) % 16, trow = (((py - 8) % 16) + 16) % 16, sy = 15 - trow, si = (sy * 16 + tx) * 4, di = ((cy + py) * AW + cx + px) * 4;
      atlas[di] = b[si]; atlas[di + 1] = b[si + 1]; atlas[di + 2] = b[si + 2]; atlas[di + 3] = b[si + 3];
      if (e) { em[di] = e[si]; em[di + 1] = e[si + 1]; em[di + 2] = e[si + 2]; }
      em[di + 3] = 255;
    }
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, AW, AH, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    return t;
  };
  void get;
  return { map: mk(atlas), emissive: mk(em) };
}

/* ------------------------------------------------------------------ shared GLSL */
const SKY_GLSL = `
uniform vec3 uZenith; uniform vec3 uHorizonSun; uniform vec3 uHorizonAway; uniform vec3 uSunGlow; uniform vec3 uSunDir; uniform float uSkyInt; uniform float uFogDensity;
vec3 skyColor(vec3 dir){
  float sd=dot(dir,uSunDir); float h=clamp(dir.y,0.0,1.0);
  vec3 horizon=mix(uHorizonAway,uHorizonSun,pow(sd*0.5+0.5,3.0));
  vec3 col=mix(horizon,uZenith,pow(h,0.38));
  float g=max(sd,0.0);
  col+=uSunGlow*(pow(g,8.0)*0.38+pow(g,60.0)*1.1)*(1.0-0.5*h);
  return col*uSkyInt;
}
vec3 applyFog(vec3 col,vec3 wdir,float dist,float wy){
  float hf=exp(-max(wy-40.0,0.0)*0.011);
  float d=uFogDensity*(0.35+0.65*hf);
  float f=1.0-exp(-d*d*dist*dist);
  vec3 fd=normalize(vec3(wdir.x,max(wdir.y,0.0)*0.25+0.015,wdir.z));
  return mix(col,skyColor(fd),f);
}`;

export function createGfx(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.15, 7000);
  camera.layers.enable(1);

  const skyU = {
    uZenith: { value: new THREE.Color() }, uHorizonSun: { value: new THREE.Color() }, uHorizonAway: { value: new THREE.Color() }, uSunGlow: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(1, 0.1, 0) }, uSkyInt: { value: 1.0 }, uFogDensity: { value: 0.002 },
  };
  const commonU = {
    uTime: { value: 0 }, uLanternCol: { value: new THREE.Color(1.0, 0.55, 0.2) }, uLanternStr: { value: 1 },
    uTrail: { value: null }, uTrailOrigin: { value: new THREE.Vector2() }, uTrailSize: { value: 32 }, uSparkle: { value: 1 },
  };

  /** Give a standard material the shared fog, lantern light and (for snow) sparkle + board tracks. */
  function patchMaterial(mat, { blockLight = false, snow = false, sway = false } = {}) {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, skyU, commonU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        uniform float uTime;
        ${blockLight ? 'attribute float aLight; varying float vBL;' : ''}
        ${snow ? 'varying vec3 vWPos; varying float vTop;' : ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${blockLight ? 'vBL=aLight;' : ''}
        ${sway ? 'transformed.xz+=vec2(sin(uTime*1.3+position.y*0.9),cos(uTime*1.1+position.y*0.7))*0.012*max(position.y-2.0,0.0);' : ''}
        ${snow ? 'vWPos=(modelMatrix*vec4(transformed,1.0)).xyz; vTop=step(0.5,normal.y);' : ''}`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        ${SKY_GLSL}
        uniform vec3 uLanternCol; uniform float uLanternStr; uniform float uTime;
        ${blockLight ? 'varying float vBL;' : ''}
        ${snow ? `varying vec3 vWPos; varying float vTop; uniform sampler2D uTrail; uniform vec2 uTrailOrigin; uniform float uTrailSize; uniform float uSparkle;
        float h31(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}` : ''}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        ${snow ? `{ vec2 tuv=(vWPos.xz-uTrailOrigin)/uTrailSize;
          float tr=texture2D(uTrail,tuv).r*vTop*step(0.0,tuv.x)*step(tuv.x,1.0)*step(0.0,tuv.y)*step(tuv.y,1.0);
          diffuseColor.rgb*=mix(vec3(1.0),vec3(0.6,0.71,0.9),tr); }` : ''}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${blockLight ? 'totalEmissiveRadiance+=diffuseColor.rgb*uLanternCol*(vBL*uLanternStr);' : ''}
        ${snow ? `{ vec3 cell=floor(vWPos*16.0+0.01); float hs=h31(cell);
          float tw=step(0.9972,hs)*(0.55+0.45*sin(uTime*2.0+hs*900.0+dot(cameraPosition,vec3(0.9,0.5,0.7))));
          totalEmissiveRadiance+=vec3(1.0,0.93,0.82)*tw*vTop*uSparkle; }` : ''}`)
        .replace('#include <fog_fragment>', `{
          vec3 rel=-vViewPosition; float dist=length(rel);
          vec3 wdir=normalize((vec4(rel,0.0)*viewMatrix).xyz);
          gl_FragColor.rgb=applyFog(gl_FragColor.rgb,wdir,dist,cameraPosition.y+wdir.y*dist);
        }`);
    };
    return mat;
  }

  /* lights */
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  const SHADOW_EXT = 70;
  Object.assign(sun.shadow.camera, { left: -SHADOW_EXT, right: SHADOW_EXT, top: SHADOW_EXT, bottom: -SHADOW_EXT, near: 1, far: 520 });
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x9ab8ff, 0x3a2a1c, 0.6);
  scene.add(hemi);

  /* sky dome */
  const skyMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uSunDisc: { value: new THREE.Color() }, uNight: { value: 0 }, uMoonDir: { value: new THREE.Vector3() }, uTime: commonU.uTime }, skyU),
    vertexShader: `varying vec3 vWorld; void main(){vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;gl_Position.z=gl_Position.w;}`,
    fragmentShader: `${SKY_GLSL}
    uniform vec3 uSunDisc; uniform float uNight; uniform vec3 uMoonDir; uniform float uTime; varying vec3 vWorld;
    float h31(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
    void main(){
      vec3 dir=normalize(vWorld-cameraPosition);
      vec3 col=skyColor(dir);
      float sd=dot(dir,uSunDir);
      col+=uSunDisc*smoothstep(0.99935,0.99965,sd)*smoothstep(-0.02,0.01,dir.y);
      if(uNight>0.01){
        vec3 p=dir*170.0; vec3 id=floor(p); vec3 f=fract(p)-0.5; float h=h31(id);
        if(h>0.985){vec3 o=vec3(h31(id+1.7),h31(id+3.1),h31(id+5.3))-0.5; float d=length(f-o*0.6); float tw=0.6+0.4*sin(uTime*(1.5+h*4.0)+h*80.0);
          col+=vec3(0.85,0.9,1.0)*smoothstep(0.12,0.0,d)*tw*uNight*smoothstep(0.0,0.25,dir.y)*(h>0.996?3.0:1.2);}
        float md=dot(dir,uMoonDir);
        col+=vec3(0.95,0.97,1.05)*(smoothstep(0.99955,0.9998,md)*3.5+pow(max(md,0.0),300.0)*0.25)*uNight;
      }
      gl_FragColor=vec4(col,1.0);
    }`,
    side: THREE.BackSide, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  /* clouds */
  const NOISE_GLSL = `
  float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
  float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y);}
  float fbm5(vec2 p){float s=0.0,a=0.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){s+=a*vnoise(p);p=m*p;a*=0.5;}return s;}`;
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uTime: commonU.uTime, uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() }, uCover: { value: 0.52 } }, skyU),
    vertexShader: `varying vec3 vWorld; void main(){vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: `${SKY_GLSL}${NOISE_GLSL}
    uniform float uTime; uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform float uCover; varying vec3 vWorld;
    float dens(vec2 p){return fbm5(p)+0.38*fbm5(p*3.3+7.0)-0.17;}
    void main(){
      vec3 rel=vWorld-cameraPosition; float dist=length(rel); vec3 dir=rel/dist;
      vec2 p=vWorld.xz*0.0013+vec2(uTime*0.0045,uTime*0.0017);
      float d=dens(p);
      float cov=smoothstep(uCover,uCover+0.3,d);
      float fade=1.0-smoothstep(1800.0,3800.0,dist);
      if(cov*fade<0.003) discard;
      float d2=dens(p+normalize(uSunDir.xz+1e-4)*0.04);
      float lit=clamp(0.55+(d-d2)*5.0,0.0,1.0);
      vec3 col=mix(uCloudShade,uCloudLit,lit);
      float sd=max(dot(dir,uSunDir),0.0);
      col+=uSunGlow*uSkyInt*pow(sd,7.0)*(1.15-cov)*1.6;
      col*=mix(1.0,0.82,smoothstep(0.75,1.0,cov));
      col=mix(col,skyColor(dir),smoothstep(0.3,0.0,dir.y)*0.65);
      gl_FragColor=vec4(col,cov*fade*0.96);
    }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), cloudMat);
  clouds.rotation.x = -Math.PI / 2; clouds.position.y = 560; clouds.frustumCulled = false; clouds.renderOrder = -5; scene.add(clouds);

  /* post: god rays -> bloom -> tonemap -> grade (+ speed blur) */
  const QUALITY = [
    { name: 'Light', pr: 0.85, shadow: 1024, msaa: 0, rays: false },
    { name: 'Balanced', pr: 1.25, shadow: 2048, msaa: 2, rays: true },
    { name: 'Cinematic', pr: 2, shadow: 4096, msaa: 4, rays: true },
  ];
  let qi = 1;
  const composerRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: QUALITY[qi].msaa });
  const composer = new EffectComposer(renderer, composerRT);
  composer.addPass(new RenderPass(scene, camera));
  const rayPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 0 }, uThreshold: { value: 2.6 }, uCol: { value: new THREE.Color(1, 0.7, 0.4) }, uAspect: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength; uniform float uThreshold; uniform vec3 uCol; uniform float uAspect; varying vec2 vUv;
    float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    void main(){
      vec3 base=texture2D(tDiffuse,vUv).rgb;
      if(uStrength<0.002){gl_FragColor=vec4(base,1.0);return;}
      const int NS=36; vec2 delta=(vUv-uSun)*(0.85/float(NS)); vec2 uv=vUv-delta*h(vUv*913.0);
      float illum=1.0; vec3 acc=vec3(0.0);
      for(int i=0;i<NS;i++){uv-=delta;vec3 s=texture2D(tDiffuse,clamp(uv,0.001,0.999)).rgb;float lum=dot(s,vec3(0.2126,0.7152,0.0722));
        vec2 dd=(uv-uSun)*vec2(uAspect,1.0); float near=exp(-dot(dd,dd)*7.0);
        acc+=s*max(lum-uThreshold,0.0)/(lum+1e-3)*illum*near; illum*=0.955;}
      vec2 pd=(vUv-uSun)*vec2(uAspect,1.0); float fall=1.0/(1.0+dot(pd,pd)*9.0);
      gl_FragColor=vec4(base+acc/float(NS)*uCol*uStrength*fall,1.0);
    }`,
  });
  composer.addPass(rayPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.6, 1.55);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const gradePass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uGrain: { value: REDUCED ? 0.0 : 0.024 }, uNight: { value: 0 }, uRush: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uGrain; uniform float uNight; uniform float uRush; varying vec2 vUv;
    float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    void main(){
      vec2 dc=vUv-0.5; float r2=dot(dc,dc);
      vec3 col; vec2 ca=dc*r2*(0.012+uRush*0.03);
      col.r=texture2D(tDiffuse,vUv-ca).r; col.g=texture2D(tDiffuse,vUv).g; col.b=texture2D(tDiffuse,vUv+ca).b;
      if(uRush>0.01){ // radial speed blur, strongest at the edges
        vec3 acc=col; float k=uRush*0.05*smoothstep(0.02,0.4,r2);
        for(int i=1;i<6;i++){acc+=texture2D(tDiffuse,vUv-dc*k*float(i)).rgb;}
        col=acc/6.0;
      }
      float l=dot(col,vec3(0.299,0.587,0.114));
      col=mix(vec3(l),col,1.1);
      col+=mix(vec3(-0.012,0.004,0.03),vec3(-0.02,0.0,0.05),uNight)*(1.0-l)+vec3(0.025,0.008,-0.02)*l*(1.0-uNight);
      col=(col-0.5)*1.04+0.5;
      col*=1.0-smoothstep(0.18,0.75,r2)*0.42;
      col+=(h(vUv*uRes+fract(uTime)*91.7)-0.5)*uGrain;
      gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
    }`,
  });
  composer.addPass(gradePass);

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
    gradePass.uniforms.uRes.value.set(w * pr, h * pr); rayPass.uniforms.uAspect.value = w / h;
  }
  function applyQuality(i) {
    qi = clamp(i, 0, 2);
    const Q = QUALITY[qi];
    const pr = Math.min(devicePixelRatio || 1, Q.pr);
    renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
    sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.samples = Q.msaa; rt.dispose(); }
    resize();
    return Q;
  }

  /* time of day */
  const KEYS = [
    { e: -90, zen: 0x02040c, hs: 0x0a1226, ha: 0x050a18, glow: 0x0a1020, light: 0x8ea6e4, li: 0.42, hemi: 0.5, fog: 0.0024, exp: 1.25, lant: 1, night: 1, cl: 0x262f4a, cs: 0x0a0f1e },
    { e: -9, zen: 0x040a1e, hs: 0x1c2446, ha: 0x0a1228, glow: 0x1a1a38, light: 0x8ea6e4, li: 0.42, hemi: 0.5, fog: 0.0024, exp: 1.2, lant: 1, night: 1, cl: 0x323858, cs: 0x0e1428 },
    { e: -3, zen: 0x13224a, hs: 0xb85a4a, ha: 0x2c3462, glow: 0x903a28, light: 0xff8050, li: 0.3, hemi: 0.5, fog: 0.0025, exp: 1.0, lant: 0.95, night: 0.55, cl: 0xb86a5e, cs: 0x2a2c50 },
    { e: 1, zen: 0x22417e, hs: 0xff8648, ha: 0x6a6aa2, glow: 0xff6a28, light: 0xff7a3c, li: 1.7, hemi: 0.75, fog: 0.0024, exp: 0.8, lant: 0.8, night: 0.08, cl: 0xff9468, cs: 0x5a5a92 },
    { e: 6.5, zen: 0x1d4ca8, hs: 0xffb474, ha: 0x8c9fd6, glow: 0xff7e30, light: 0xffa45a, li: 2.9, hemi: 0.9, fog: 0.0019, exp: 0.66, lant: 0.55, night: 0, cl: 0xffbe8c, cs: 0x8a86b8 },
    { e: 16, zen: 0x3368b6, hs: 0xffdcb0, ha: 0xb2c4e4, glow: 0xffb070, light: 0xffd2a0, li: 3.2, hemi: 1.0, fog: 0.0018, exp: 0.6, lant: 0.15, night: 0, cl: 0xfff0dc, cs: 0xa8b4d0 },
    { e: 40, zen: 0x2e66c4, hs: 0xd8e6f6, ha: 0xbcd2ee, glow: 0xfff0d8, light: 0xfff3e2, li: 3.3, hemi: 1.05, fog: 0.0015, exp: 0.56, lant: 0.05, night: 0, cl: 0xffffff, cs: 0xb6c2d8 },
    { e: 90, zen: 0x2e66c4, hs: 0xd8e6f6, ha: 0xbcd2ee, glow: 0xfff0d8, light: 0xfff3e2, li: 3.2, hemi: 0.8, fog: 0.0015, exp: 0.56, lant: 0.05, night: 0, cl: 0xffffff, cs: 0xb6c2d8 },
  ];
  const CKEYS = ['zen', 'hs', 'ha', 'glow', 'light', 'cl', 'cs'];
  for (const k of KEYS) for (const c of CKEYS) k[c] = new THREE.Color(k[c]);
  const P = {};
  for (const c of CKEYS) P[c] = new THREE.Color();
  const tod = { t: 16.9, sunElev: 0, sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), lightDir: new THREE.Vector3(), P };
  const SUN_AZ = -1.1;
  const extras = { lanternCore: null, emissiveMats: [], onTOD: [] };
  function setTOD(t) {
    tod.t = ((t % 24) + 24) % 24;
    const el = Math.sin(((tod.t - 6) / 12) * Math.PI) * 0.96, elev = Math.asin(clamp(el, -1, 1)) * 0.95;
    const az = SUN_AZ + ((tod.t - 18) / 12) * Math.PI;
    tod.sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
    tod.moonDir.copy(tod.sunDir).negate();
    tod.sunElev = (elev * 180) / Math.PI;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].e < tod.sunElev) i++;
    const A = KEYS[i], B = KEYS[i + 1], f = smooth(0, 1, clamp((tod.sunElev - A.e) / (B.e - A.e), 0, 1));
    for (const c of CKEYS) P[c].copy(A[c]).lerp(B[c], f);
    for (const k of ['li', 'hemi', 'fog', 'exp', 'lant', 'night']) P[k] = lerp(A[k], B[k], f);
    skyU.uZenith.value.copy(P.zen); skyU.uHorizonSun.value.copy(P.hs); skyU.uHorizonAway.value.copy(P.ha); skyU.uSunGlow.value.copy(P.glow);
    skyU.uSunDir.value.copy(tod.sunDir); skyU.uFogDensity.value = P.fog;
    skyMat.uniforms.uSunDisc.value.copy(P.light).multiplyScalar(40 * smooth(-3, 1, tod.sunElev));
    skyMat.uniforms.uNight.value = P.night; skyMat.uniforms.uMoonDir.value.copy(tod.moonDir);
    cloudMat.uniforms.uCloudLit.value.copy(P.cl); cloudMat.uniforms.uCloudShade.value.copy(P.cs);
    if (tod.sunElev > -4) { const e = Math.max(elev, (17 * Math.PI) / 180); tod.lightDir.set(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e)); }
    else tod.lightDir.set(tod.moonDir.x, Math.max(tod.moonDir.y, 0.5), tod.moonDir.z).normalize();
    sun.color.copy(P.light); sun.intensity = P.li;
    const hs = P.zen.clone().lerp(P.ha, 0.55), m = Math.max(hs.r, hs.g, hs.b, 1e-4);
    hemi.color.copy(hs.multiplyScalar(1 / m));
    hemi.groundColor.setRGB(0.5, 0.56, 0.7).lerp(P.light, 0.2); hemi.intensity = P.hemi;
    renderer.toneMappingExposure = P.exp;
    commonU.uLanternStr.value = 0.3 + P.lant * 3.0;
    commonU.uSparkle.value = (1 - P.night) * smooth(-2, 8, tod.sunElev) * 2.2 + P.night * 0.5;
    if (extras.lanternCore) extras.lanternCore.color.setRGB(1.0, 0.56, 0.2).multiplyScalar(2.5 + P.lant * 9);
    for (const m2 of extras.emissiveMats) m2.emissiveIntensity = 0.25 + P.lant * 3.4;
    gradePass.uniforms.uNight.value = P.night;
    rayPass.uniforms.uCol.value.copy(P.glow).lerp(P.light, 0.5);
    for (const fn of extras.onTOD) fn(tod);
  }
  const fmtTime = (t) => { const h = Math.floor(t), m = Math.floor((t - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
  const phaseName = (t) => (t < 5 ? 'Night' : t < 6.6 ? 'First light' : t < 9 ? 'Morning' : t < 15.5 ? 'Midday' : t < 16.9 ? 'Afternoon' : t < 18.4 ? 'Golden hour' : t < 19.4 ? 'Dusk' : 'Night');

  const _sp = new THREE.Vector3(), _cd = new THREE.Vector3(), _snap = new THREE.Vector3(), _lr = new THREE.Vector3(), _lu = new THREE.Vector3(), _lf = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  /** Per-frame atmosphere update + draw. `focus` is where shadows should be centred (the rider). */
  function render(dt, time, focus, rush) {
    commonU.uTime.value = time; gradePass.uniforms.uTime.value = time;
    gradePass.uniforms.uRush.value = REDUCED ? 0 : rush;
    camera.updateMatrixWorld();
    const fl = 1 + (Math.sin(time * 11.3) * 0.5 + Math.sin(time * 7.1 + 1.3) * 0.3 + Math.sin(time * 23.7) * 0.2) * 0.035;
    commonU.uLanternStr.value = (0.3 + P.lant * 3.0) * fl;
    sky.position.copy(camera.position);
    // shadow frustum follows the rider, snapped to texels so shadows don't shimmer
    const texel = (2 * SHADOW_EXT) / sun.shadow.mapSize.x;
    _cd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _snap.copy(focus).addScaledVector(_cd, SHADOW_EXT * 0.45);
    _lf.copy(tod.lightDir).negate(); _lr.crossVectors(_lf, _up).normalize(); _lu.crossVectors(_lr, _lf);
    const a = Math.round(_snap.dot(_lr) / texel) * texel, b = Math.round(_snap.dot(_lu) / texel) * texel, c = _snap.dot(_lf);
    _snap.copy(_lr).multiplyScalar(a).addScaledVector(_lu, b).addScaledVector(_lf, c);
    sun.target.position.copy(_snap); sun.position.copy(_snap).addScaledVector(tod.lightDir, 260);
    sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
    // god rays
    _sp.copy(camera.position).addScaledVector(tod.sunDir, 1000).project(camera);
    const facing = _cd.dot(tod.sunDir), onScreen = Math.abs(_sp.x) < 1.6 && Math.abs(_sp.y) < 1.6 && _sp.z < 1;
    rayPass.uniforms.uSun.value.set(_sp.x * 0.5 + 0.5, _sp.y * 0.5 + 0.5);
    rayPass.uniforms.uStrength.value = QUALITY[qi].rays && onScreen ? smooth(0.25, 0.75, facing) * smooth(-2, 4, tod.sunElev) * (1.15 - smooth(10, 40, tod.sunElev) * 0.6) * 0.9 : 0;
    rayPass.enabled = rayPass.uniforms.uStrength.value > 0.002;
    renderer.shadowMap.needsUpdate = true;
    composer.render(dt);
  }

  const atlas = buildAtlas();
  addEventListener('resize', resize);
  return {
    THREE, renderer, scene, camera, composer, sun, hemi, skyU, commonU, patchMaterial, atlas, tod, setTOD, fmtTime, phaseName,
    applyQuality, resize, render, extras, QUALITY, get quality() { return qi; },
  };
}
