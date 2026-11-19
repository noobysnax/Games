// Renderer: voxel chunk meshes, the shared voxel material (per-voxel colour grain, soft occlusion read from a
// low-res copy of the world in a 3D texture), dusk sky, sun shadows, a small pool of lamp lights, bloom.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VOX, SX, SY, SZ, CH } from './config.js';
import { meshBox } from './mesher.js';

export const QUALITY = [
  { name: 'Light', pr: 1, shadow: 1024, bloom: false, msaa: 0, lamps: 3, debris: 900 },
  { name: 'Balanced', pr: 1.25, shadow: 2048, bloom: true, msaa: 0, lamps: 4, debris: 1800 },
  { name: 'Cinematic', pr: 2, shadow: 4096, bloom: true, msaa: 4, lamps: 6, debris: 3000 },
];

const OX = SX / 2, OY = SY / 2, OZ = SZ / 2;

function voxelMaterial(occTex, withAO) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.defines = withAO ? { VOX_AO: 1 } : {};
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uOcc = { value: occTex };
    sh.uniforms.uOccInv = { value: new THREE.Vector3(1 / (SX * VOX), 1 / (SZ * VOX), 1 / (SY * VOX)) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON; varying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal; vWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
precision highp sampler3D;
varying vec3 vOP; varying vec3 vON; varying vec3 vWP;
uniform sampler3D uOcc; uniform vec3 uOccInv;
float vGlow;
float vhash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float occ(vec3 wp, float lod) { return textureLod(uOcc, vec3(wp.x, wp.z, wp.y) * uOccInv, lod).r; }`)
      .replace('#include <color_fragment>', `
vec3 cell = floor(vOP - vON * 0.5);
float h1 = vhash(cell), h2 = vhash(floor(cell / 4.0) + 7.0), h3 = vhash(floor(cell / 16.0) + 3.0);
float flag = vColor.a;
float jit = flag < 0.5 ? flag * 0.8 : 0.0;
vGlow = flag >= 0.5 ? (flag - 0.5) * 2.0 : 0.0;
diffuseColor.rgb *= pow(vColor.rgb, vec3(2.2)) * (1.0 + (h1 - 0.5) * jit * 1.5 + (h2 - 0.5) * jit * 0.8 + (h3 - 0.5) * jit * 0.5);`)
      .replace('#include <aomap_fragment>', `
#ifdef VOX_AO
  vec3 nrm = normalize(vON);
  float near = occ(vWP + nrm * 0.2, 0.0) * 0.8 + occ(vWP + nrm * 0.5, 1.0) * 0.75 + occ(vWP + nrm * 1.1, 2.0) * 0.6;
  float ao = clamp(1.0 - near * 0.95, 0.0, 1.0);
  vec3 sp = vWP + nrm * 0.7;
  float cover = occ(sp + vec3(0.0, 1.4, 0.0), 2.0) * 0.8 + occ(sp + vec3(0.0, 3.0, 0.0), 3.0) * 1.2 + occ(sp + vec3(0.0, 6.0, 0.0), 4.0) * 1.6;
  float sky = clamp(1.0 - cover, 0.0, 1.0);
  reflectedLight.indirectDiffuse *= (0.25 + 0.75 * ao * ao) * mix(0.34, 1.0, sky);
#endif
totalEmissiveRadiance += diffuseColor.rgb * vGlow * 3.2;`);
  };
  return mat;
}

class OverlayPass extends Pass {
  constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth(); renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

export class Gfx {
  constructor(canvas, world, map, qi) {
    this.world = world; this.map = map; this.qi = qi; this.q = QUALITY[qi];
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    const scene = this.scene = new THREE.Scene();
    this.fogColor = new THREE.Color(0x9a8f9c);
    scene.fog = new THREE.FogExp2(this.fogColor, 0.0135);
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.06, 420);
    this.camera.rotation.order = 'YXZ';
    scene.add(this.camera);
    // first-person weapon is drawn in its own scene on top, so it never pokes through walls
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight(0xc8d4ec, 0x6a5a48, 2.4));
    this.vmSun = new THREE.DirectionalLight(0xffd0a0, 2.2); this.vmScene.add(this.vmSun, this.vmSun.target);
    this.vmFlash = new THREE.PointLight(0xffc070, 0, 3, 2); this.vmFlash.position.set(0.1, -0.05, -0.6); this.vmScene.add(this.vmFlash);

    this._sky(); this._lights(); this._backdrop();
    this._occInit();
    this.mat = voxelMaterial(this.occTex, true);
    this.bodyMat = voxelMaterial(this.occTex, false);
    this.chunks = new Array(world.cx * world.cy * world.cz).fill(null);
    this.chunkRoot = new THREE.Group(); scene.add(this.chunkRoot);
    this.occDirty = false; this.occTimer = 0;

    this.composer = null;
    this.resize();
  }

  _sky() {
    const geo = new THREE.SphereGeometry(380, 24, 12);
    this.sunDir = new THREE.Vector3(0.62, 0.5, -0.6).normalize();
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: this.sunDir } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vD; uniform vec3 uSun;
        void main(){ vec3 d = normalize(vD); float h = clamp(d.y, -0.2, 1.0);
          vec3 top = vec3(0.10, 0.17, 0.33), mid = vec3(0.50, 0.44, 0.52), hor = vec3(1.25, 0.72, 0.42);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.15, 0.8, h));
          float s = max(dot(d, uSun), 0.0);
          c += vec3(1.0, 0.55, 0.25) * pow(s, 6.0) * 0.5 + vec3(1.0, 0.8, 0.55) * pow(s, 60.0) * 1.2 + vec3(8.0, 6.0, 4.0) * smoothstep(0.9993, 0.9997, s);
          c = mix(vec3(0.34, 0.30, 0.34), c, smoothstep(-0.12, 0.02, d.y));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat); this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  _lights() {
    this.hemi = new THREE.HemisphereLight(0x9db6e6, 0x5a4a3c, 1.25); this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffc48a, 3.4);
    const c = new THREE.Vector3(SX * VOX / 2, 0, SZ * VOX / 2);
    sun.target.position.copy(c); sun.position.copy(c).addScaledVector(this.sunDir, 70);
    sun.castShadow = true;
    const s = sun.shadow; s.mapSize.set(this.q.shadow, this.q.shadow);
    s.camera.left = -37; s.camera.right = 37; s.camera.top = 37; s.camera.bottom = -37; s.camera.near = 10; s.camera.far = 140;
    s.bias = -0.0005; s.normalBias = 0.035; s.radius = 1.6;
    this.scene.add(sun, sun.target);
    this.vmSun.position.set(0.4, 0.8, 0.3);
    // a handful of real lights hop between the nearest lamps; the lamp voxels themselves always glow
    this.lampLights = [];
    for (let i = 0; i < this.q.lamps; i++) { const l = new THREE.PointLight(0xffc98a, 0, 11, 1.7); this.scene.add(l); this.lampLights.push({ light: l, lamp: null, k: 0 }); }
    this.flash = new THREE.PointLight(0xffb060, 0, 9, 1.8); this.scene.add(this.flash);
    this.boom = new THREE.PointLight(0xff9040, 0, 26, 1.6); this.scene.add(this.boom);
    this.flashT = 0; this.boomT = 0;
  }

  _backdrop() {
    // dead city beyond the blast wall: plain dark blocks that the fog fades out
    const g = [], rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    const m = new THREE.Matrix4();
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, d = 58 + rnd() * 90, w = 8 + rnd() * 16, h = 8 + rnd() * rnd() * 46, dd = 8 + rnd() * 16;
      const b = new THREE.BoxGeometry(w, h, dd); m.makeRotationY(rnd() * 0.5).setPosition(24 + Math.cos(a) * d, h / 2 - 1, 24 + Math.sin(a) * d); b.applyMatrix4(m); g.push(b);
    }
    const pos = [], idx = []; let base = 0;
    for (const b of g) { pos.push(...b.attributes.position.array); for (const i of b.index.array) idx.push(i + base); base += b.attributes.position.count; b.dispose(); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x35323a }));
    this.scene.add(mesh);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshLambertMaterial({ color: 0x3a3838 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(24, 0.3, 24); this.scene.add(ground);
  }

  /* ------------------------------------------- occupancy volume for soft occlusion */
  _occInit() {
    this.occ = new Uint8Array(OX * OY * OZ);
    const t = this.occTex = new THREE.Data3DTexture(this.occ, OX, OZ, OY);
    t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.unpackAlignment = 1; t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    this.occUpdate([0, 0, 0, SX - 1, SY - 1, SZ - 1]);
  }
  occUpdate(b) {
    const d = this.world.data, o = this.occ, sxz = SX * SZ;
    const x0 = Math.max(0, b[0] >> 1), y0 = Math.max(0, b[1] >> 1), z0 = Math.max(0, b[2] >> 1), x1 = Math.min(OX - 1, b[3] >> 1), y1 = Math.min(OY - 1, b[4] >> 1), z1 = Math.min(OZ - 1, b[5] >> 1);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      let i = ((y * 2) * SZ + z * 2) * SX + x0 * 2, k = (y * OZ + z) * OX + x0;
      for (let x = x0; x <= x1; x++, i += 2, k++) {
        const n = (d[i] ? 1 : 0) + (d[i + 1] ? 1 : 0) + (d[i + SX] ? 1 : 0) + (d[i + SX + 1] ? 1 : 0) + (d[i + sxz] ? 1 : 0) + (d[i + sxz + 1] ? 1 : 0) + (d[i + sxz + SX] ? 1 : 0) + (d[i + sxz + SX + 1] ? 1 : 0);
        o[k] = n * 31 + (n ? 7 : 0);
      }
    }
    this.occDirty = true;
  }

  /* ----------------------------------------------------------------- chunks */
  remesh(ci) {
    const w = this.world, cx = ci % w.cx, cz = ((ci / w.cx) | 0) % w.cz, cy = (ci / (w.cx * w.cz)) | 0;
    const lo = [cx * CH, cy * CH, cz * CH], hi = [Math.min(SX, lo[0] + CH), Math.min(SY, lo[1] + CH), Math.min(SZ, lo[2] + CH)];
    const md = meshBox(w.data, SX, SY, SZ, lo, hi);
    let mesh = this.chunks[ci];
    if (!md.quads) { if (mesh) { this.chunkRoot.remove(mesh); mesh.geometry.dispose(); this.chunks[ci] = null; } return; }
    const geo = this.geometry(md);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(lo[0] + CH / 2, lo[1] + CH / 2, lo[2] + CH / 2), CH * 0.87);
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; }
    else {
      mesh = this.chunks[ci] = new THREE.Mesh(geo, this.mat); mesh.scale.setScalar(VOX); mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix(); this.chunkRoot.add(mesh);
    }
  }
  geometry(md) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(md.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(md.nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(md.col, 4, true));
    geo.setIndex(new THREE.BufferAttribute(md.idx, 1));
    return geo;
  }
  // a free-standing voxel mesh (falling pieces), positions in voxel units
  voxelMesh(md) {
    const geo = this.geometry(md); geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.bodyMat); mesh.scale.setScalar(VOX); mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
  buildAll(onProgress) {
    const n = this.chunks.length;
    for (let i = 0; i < n; i++) this.remesh(i);
    this.world.dirtyChunks.clear();
    if (onProgress) onProgress(1);
  }
  // remesh what changed; returns the changed voxel box (or null) so the caller can update pathfinding
  flush(dt) {
    const w = this.world;
    // remesh within a time budget; a big blast spreads over a few frames instead of hitching one
    if (w.dirtyChunks.size) {
      const t0 = performance.now(); let n = 0;
      for (const ci of w.dirtyChunks) { this.remesh(ci); w.dirtyChunks.delete(ci); if (++n >= 4 && performance.now() - t0 > 7) break; }
    }
    const b = w.takeDirtyBox();
    if (b) this.occUpdate(b);
    this.occTimer -= dt;
    if (this.occDirty && this.occTimer <= 0) { this.occTex.needsUpdate = true; this.occDirty = false; this.occTimer = 0.12; }
    return b;
  }

  /* ----------------------------------------------------------------- lights */
  updateLamps(px, py, pz, dt) {
    const lamps = this.map.lamps, w = this.world;
    // nearest living lamps get the real lights
    const want = [];
    for (const l of lamps) {
      if (l.dead) continue;
      if (!w.get(l.vox[0], l.vox[1], l.vox[2])) { l.dead = true; continue; }
      l.d = (l.x - px) ** 2 + (l.y - py) ** 2 * 2 + (l.z - pz) ** 2; want.push(l);
    }
    want.sort((a, b) => a.d - b.d); want.length = Math.min(want.length, this.lampLights.length);
    for (const s of this.lampLights) {
      const keep = s.lamp && !s.lamp.dead && want.includes(s.lamp);
      if (keep) { s.k = Math.min(1, s.k + dt * 3); want.splice(want.indexOf(s.lamp), 1); }
      else { s.k = Math.max(0, s.k - dt * 5); if (s.k === 0) s.lamp = null; }
    }
    for (const s of this.lampLights) {
      if (!s.lamp && want.length) { s.lamp = want.shift(); s.k = 0; s.light.position.set(s.lamp.x, s.lamp.y - 0.15, s.lamp.z); s.light.color.setHex(s.lamp.color); }
      s.light.intensity = s.lamp ? s.k * s.lamp.power * 16 : 0;
    }
    this.flashT = Math.max(0, this.flashT - dt); this.flash.intensity = this.flashT > 0 ? 30 * (this.flashT / 0.06) : 0;
    this.vmFlash.intensity = this.flashT > 0 ? 5 * (this.flashT / 0.06) : 0;
    this.boomT = Math.max(0, this.boomT - dt); this.boom.intensity = this.boomT > 0 ? 140 * (this.boomT / 0.35) ** 2 : 0;
  }
  muzzleFlash(pos, color = 0xffb060) { this.flash.position.copy(pos); this.flash.color.setHex(color); this.vmFlash.color.setHex(color); this.flashT = 0.06; }
  blastFlash(x, y, z, color = 0xff9040) { this.boom.position.set(x, y, z); this.boom.color.setHex(color); this.boomT = 0.35; }

  /* ------------------------------------------------------------------ frame */
  setQuality(qi) {
    this.qi = qi; this.q = QUALITY[qi];
    this.sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.resize(true);
  }
  resize(force) {
    const c = this.renderer.domElement, w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
    const pr = Math.min(devicePixelRatio || 1, this.q.pr);
    if (!force && w === this.w && h === this.h && pr === this.pr) return;
    this.w = w; this.h = h; this.pr = pr;
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    this.camera.aspect = this.vmCamera.aspect = w / h; this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: this.q.msaa });
    const comp = this.composer = new EffectComposer(this.renderer, rt);
    comp.setPixelRatio(1); comp.setSize(w * pr, h * pr);
    comp.addPass(new RenderPass(this.scene, this.camera));
    comp.addPass(new OverlayPass(this.vmScene, this.vmCamera));
    if (this.q.bloom) comp.addPass(new UnrealBloomPass(new THREE.Vector2(w * pr / 2, h * pr / 2), 0.42, 0.55, 1.0));
    comp.addPass(new OutputPass());
  }
  render() {
    this.sky.position.copy(this.camera.position);
    this.composer.render();
  }
}
