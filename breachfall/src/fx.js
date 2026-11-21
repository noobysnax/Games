// Everything that flies after something breaks: loose voxel chips, glowing sparks and fire, smoke blocks,
// and the big one: cut-off pieces of the map that fall, tumble and crush as rigid bodies.

import * as THREE from 'three';
import { VOX, MAT, ID } from './config.js';
import { meshBox } from './mesher.js';

const G = 19;
const COLORS = MAT.map((m) => new THREE.Color(m.color));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
const _violet = new THREE.Color(0xb080ff);

// One instanced-cube particle pool. Layout per particle: pos3 vel3 rot2 spin2 size life maxLife grav flags
const STRIDE = 14;
class Pool {
  constructor(scene, cap, material, shadows) {
    this.cap = cap; this.n = 0; this.d = new Float32Array(cap * STRIDE);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.castShadow = false; this.mesh.receiveShadow = !!shadows;
    this.mesh.setColorAt(0, _c.set(1, 1, 1)); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
  }
  add(x, y, z, vx, vy, vz, size, life, grav, collide, color, bright = 1) {
    let i = this.n;
    if (i >= this.cap) i = (Math.random() * this.cap) | 0; else this.n++;
    const d = this.d, o = i * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = Math.random() * 6; d[o + 7] = Math.random() * 6; d[o + 8] = rnd(9); d[o + 9] = rnd(9);
    d[o + 10] = size; d[o + 11] = life; d[o + 12] = life; d[o + 13] = grav + (collide ? 1000 : 0);
    _c.copy(color); if (bright !== 1) _c.multiplyScalar(bright);
    this.mesh.setColorAt(i, _c); this.colorDirty = true;
  }
  update(dt, world) {
    const d = this.d, mesh = this.mesh;
    for (let i = 0; i < this.n; i++) {
      const o = i * STRIDE;
      d[o + 11] -= dt;
      if (d[o + 11] <= 0) { // swap-remove
        const l = --this.n;
        if (i !== l) { d.copyWithin(o, l * STRIDE, l * STRIDE + STRIDE); mesh.getColorAt(l, _c); mesh.setColorAt(i, _c); this.colorDirty = true; }
        i--; continue;
      }
      let g = d[o + 13]; const collide = g > 500; if (collide) g -= 1000;
      d[o + 4] -= G * g * dt;
      if (collide) {
        const nx = d[o] + d[o + 3] * dt, ny = d[o + 1] + d[o + 4] * dt, nz = d[o + 2] + d[o + 5] * dt, h = d[o + 10] * 0.5;
        if (world.solidAt(nx, d[o + 1], d[o + 2])) d[o + 3] *= -0.35; else d[o] = nx;
        if (world.solidAt(d[o], d[o + 1], nz)) d[o + 5] *= -0.35; else d[o + 2] = nz;
        if (world.solidAt(d[o], ny - (d[o + 4] < 0 ? h : -h), d[o + 2])) {
          if (d[o + 4] < 0) { d[o + 3] *= 0.55; d[o + 5] *= 0.55; d[o + 8] *= 0.4; d[o + 9] *= 0.4; }
          d[o + 4] *= -0.28; if (Math.abs(d[o + 4]) < 0.7) { d[o + 4] = 0; d[o + 8] = 0; d[o + 9] = 0; }
        } else d[o + 1] = ny;
      } else {
        d[o] += d[o + 3] * dt; d[o + 1] += d[o + 4] * dt; d[o + 2] += d[o + 5] * dt;
        const k = Math.exp(-2.2 * dt); d[o + 3] *= k; d[o + 4] *= k; d[o + 5] *= k;
      }
      d[o + 6] += d[o + 8] * dt; d[o + 7] += d[o + 9] * dt;
      const s = d[o + 10] * Math.min(1, d[o + 11] / Math.min(0.5, d[o + 12] * 0.5));
      _e.set(d[o + 6], d[o + 7], 0); _q.setFromEuler(_e); _p.set(d[o], d[o + 1], d[o + 2]); _s.set(s, s, s);
      _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
    }
    mesh.count = this.n; mesh.instanceMatrix.needsUpdate = true;
    if (this.colorDirty) { mesh.instanceColor.needsUpdate = true; this.colorDirty = false; }
  }
}

const DIRS = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) DIRS.push([x, y, z]);

export class Fx {
  constructor(gfx, world, audio) {
    this.gfx = gfx; this.world = world; this.audio = audio;
    this.chips = new Pool(gfx.scene, gfx.q.debris, new THREE.MeshLambertMaterial(), true);
    this.glow = new Pool(gfx.scene, 700, new THREE.MeshBasicMaterial({ fog: false }), false);
    this.bodies = []; this.byId = new Map(); this.uid = 0;
    this.onImpact = null;      // (body, x, y, z, speed, nx, ny, nz) when a piece hits the world
    this.onMove = null;        // (body, dt) every frame a piece is awake
    this.shake = 0;
    this.onCrush = null;       // (body) => void, called while a heavy piece is moving fast
    this.listener = new THREE.Vector3();
  }

  /* ------------------------------------------------------------- particles */
  chip(x, y, z, vx, vy, vz, mat, size = VOX, life = 0) {
    this.chips.add(x, y, z, vx, vy, vz, size, life || 4 + Math.random() * 5, 1, true, COLORS[mat]);
  }
  // debris from a carve: samples are [vx, vy, vz, mat, ...] in voxel coords
  burst(samples, cx, cy, cz, power, nx = 0, ny = 0, nz = 0) {
    for (let i = 0; i < samples.length; i += 4) {
      const x = (samples[i] + 0.5) * VOX, y = (samples[i + 1] + 0.5) * VOX, z = (samples[i + 2] + 0.5) * VOX;
      let dx = x - cx, dy = y - cy, dz = z - cz; const l = Math.hypot(dx, dy, dz) || 1, p = power * (0.35 + Math.random() * 0.8);
      dx = dx / l + nx * 1.2 + rnd(0.5); dy = dy / l + ny * 1.2 + 0.45 + rnd(0.4); dz = dz / l + nz * 1.2 + rnd(0.5);
      this.chip(x, y, z, dx * p, dy * p, dz * p, samples[i + 3], VOX * (Math.random() < 0.25 ? 1.7 : 1));
    }
  }
  sparks(x, y, z, n, nx = 0, ny = 1, nz = 0, color = 0xffc060, speed = 6) {
    _c.setHex(color);
    for (let i = 0; i < n; i++) this.glow.add(x, y, z, (nx + rnd(0.9)) * speed * Math.random(), (ny + rnd(0.9)) * speed * Math.random() + 1, (nz + rnd(0.9)) * speed * Math.random(), 0.03 + Math.random() * 0.03, 0.15 + Math.random() * 0.3, 0.6, false, _c, 2.2);
  }
  dust(x, y, z, n, mat, spread = 0.3, up = 0.6) {
    _c.copy(COLORS[mat]).lerp(new THREE.Color(0xb8b0a8), 0.6);
    for (let i = 0; i < n; i++) this.chips.add(x + rnd(spread), y + rnd(spread), z + rnd(spread), rnd(0.8), up * Math.random() + 0.1, rnd(0.8), 0.07 + Math.random() * 0.12, 0.7 + Math.random() * 0.9, -0.03, false, _c);
  }
  fireball(x, y, z, r) {
    const n = Math.min(70, 14 + r * 22);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, e = Math.random() * 1.4 - 0.2, sp = r * (1.1 + Math.random() * 2.2);
      _c.setHex(Math.random() < 0.4 ? 0xffe9a0 : Math.random() < 0.6 ? 0xff9a30 : 0xff5a18);
      this.glow.add(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1.5, Math.sin(a) * Math.cos(e) * sp, r * (0.1 + Math.random() * 0.16), 0.18 + Math.random() * 0.36, -0.25, false, _c, 2.1);
    }
    _c.setHex(0x2c2a2a);
    for (let i = 0; i < n * 0.7; i++) {
      const a = Math.random() * 6.283, sp = r * (0.4 + Math.random() * 1.6);
      this.chips.add(x + rnd(r * 0.3), y + rnd(r * 0.3), z + rnd(r * 0.3), Math.cos(a) * sp, 0.8 + Math.random() * 2.4, Math.sin(a) * sp, r * (0.14 + Math.random() * 0.22), 1.2 + Math.random() * 1.8, -0.06, false, _c, 0.6 + Math.random() * 1.6);
    }
  }
  gore(x, y, z, dx, dy, dz, n, mats) {
    for (let i = 0; i < n; i++) {
      const m = mats[(Math.random() * mats.length) | 0];
      this.chips.add(x + rnd(0.2), y + rnd(0.4), z + rnd(0.2), dx * 3 + rnd(2.5), dy * 3 + 1.5 + Math.random() * 3, dz * 3 + rnd(2.5), 0.05 + Math.random() * 0.08, 3 + Math.random() * 4, 1, true, COLORS[m]);
    }
  }
  // fine chips flung along a direction: what is left of something hit very hard or disintegrated
  vaporize(x, y, z, mats, dx, dy, dz, speed, n, glow = false) {
    for (let i = 0; i < n; i++) {
      const m = mats[(Math.random() * mats.length) | 0], s = speed * (0.3 + Math.random() * 0.9);
      const vx = dx * s + rnd(speed * 0.35), vy = dy * s + rnd(speed * 0.3) + 1.2, vz = dz * s + rnd(speed * 0.35);
      if (glow) { _c.copy(COLORS[m]).lerp(_violet, 0.55); this.glow.add(x + rnd(0.3), y + rnd(0.6), z + rnd(0.3), vx * 0.35, vy * 0.2 + 0.8, vz * 0.35, 0.03 + Math.random() * 0.05, 0.4 + Math.random() * 0.7, -0.15, false, _c, 2.2); }
      else this.chips.add(x + rnd(0.25), y + rnd(0.6), z + rnd(0.25), vx, vy, vz, 0.035 + Math.random() * 0.06, 2.5 + Math.random() * 4, 1, true, COLORS[m]);
    }
  }

  /* ------------------------------------------------------- breaking things */
  // Carve, throw debris, and let whatever lost its support come down. `o.eid` names the bodies that fall out,
  // so every player in a co-op game gives the same piece the same id.
  blast(x, y, z, r, tier, o = {}) {
    const res = this.world.carve(x, y, z, r, tier, o.samples ?? 120, o.tall ?? 1);
    if (!res.removed) return res;
    if (o.dis) { // disintegration: the matter turns to glowing dust instead of flying chunks
      for (let i = 0; i < res.samples.length; i += 4) {
        const sx = (res.samples[i] + 0.5) * VOX, sy = (res.samples[i + 1] + 0.5) * VOX, sz = (res.samples[i + 2] + 0.5) * VOX;
        _c.copy(COLORS[res.samples[i + 3]]).lerp(_violet, 0.45);
        this.glow.add(sx, sy, sz, rnd(0.6), 0.6 + Math.random() * 1.4, rnd(0.6), 0.04 + Math.random() * 0.05, 0.35 + Math.random() * 0.6, -0.2, false, _c, 2.0);
      }
    } else {
      this.burst(res.samples, x, y, z, o.push ?? 3, o.nx, o.ny, o.nz);
      if (res.samples.length) this.dust(x, y, z, Math.min(14, 2 + r * 8), res.samples[3], r * 0.6);
    }
    const islands = this.world.findIslands(res.seeds);
    islands.forEach((isl, k) => this.addBody(isl, x, y, z, o.push ?? 3, o.eid != null ? `${o.eid}.${k}` : null));
    return res;
  }

  // Rip a ragged ball out of the world as one solid piece (the Matter Destroyer's grab, the Warden's boulders).
  extract(x, y, z, r, tier, id, eid) {
    const res = this.world.carve(x, y, z, r, tier, 30, 1, true);
    if (!res.removed) return null;
    this.dust(x, y, z, 8, res.cmats[0], r * 0.6, 1);
    const w = this.world; let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1, y1 = -1, z1 = -1;
    for (const i of res.cidx) { const vx = i % w.sx, zy = (i / w.sx) | 0, vz = zy % w.sz, vy = (zy / w.sz) | 0; if (vx < x0) x0 = vx; if (vx > x1) x1 = vx; if (vy < y0) y0 = vy; if (vy > y1) y1 = vy; if (vz < z0) z0 = vz; if (vz > z1) z1 = vz; }
    const islands = w.findIslands(res.seeds);
    islands.forEach((isl, k) => this.addBody(isl, x, y, z, 1, eid != null ? `${eid}.${k}` : null));
    return this.addBody({ n: res.removed, idx: Int32Array.from(res.cidx), mats: Uint8Array.from(res.cmats), box: [x0, y0, z0, x1, y1, z1] }, x, y, z, 0, id, true);
  }

  // a piece cut out of the world grid
  addBody(isl, cx, cy, cz, push, id = null, keep = false) {
    const w = this.world, [x0, y0, z0, x1, y1, z1] = isl.box, n = isl.n;
    const kick = (px, py, pz, s) => { const dx = px - cx, dy = py - cy, dz = pz - cz, l = Math.hypot(dx, dy, dz) || 1, k = push * s / (1 + l * l * 0.6); return [dx / l * k, dy / l * k + k * 0.3, dz / l * k]; };
    if (!keep && (n < 12 || n > 90000)) { // crumbs, or something absurdly large: just chips
      const step = Math.max(1, Math.floor(n / 400));
      for (let k = 0; k < n; k += step) { const i = isl.idx[k], x = i % w.sx, zy = (i / w.sx) | 0, z = zy % w.sz, y = (zy / w.sz) | 0, v = kick((x + 0.5) * VOX, (y + 0.5) * VOX, (z + 0.5) * VOX, 1); this.chip((x + 0.5) * VOX, (y + 0.5) * VOX, (z + 0.5) * VOX, v[0] + rnd(0.5), v[1], v[2] + rnd(0.5), isl.mats[k]); }
      return null;
    }
    const dx = x1 - x0 + 3, dy = y1 - y0 + 3, dz = z1 - z0 + 3, local = new Uint8Array(dx * dy * dz);
    for (let k = 0; k < n; k++) {
      const i = isl.idx[k], x = i % w.sx - x0 + 1, zy = (i / w.sx) | 0, z = zy % w.sz - z0 + 1, y = ((zy / w.sz) | 0) - y0 + 1;
      local[(y * dz + z) * dx + x] = isl.mats[k];
    }
    const b = this.makeBody(local, dx, dy, dz, VOX, _p.set((x0 - 1) * VOX, (y0 - 1) * VOX, (z0 - 1) * VOX), null, id);
    const v = kick(b.group.position.x, b.group.position.y, b.group.position.z, Math.min(1, 300 / n) + 0.15);
    b.vel.set(v[0], v[1], v[2]); b.ang.set(rnd(0.6), rnd(0.3), rnd(0.6)).multiplyScalar(Math.min(1, 200 / n) + 0.1);
    if (n > 400) this.audio?.rumble(Math.min(1, n / 6000), this.dist(b.group.position));
    return b;
  }

  // A rigid body from any small voxel grid. `origin` is where local voxel (0,0,0) sits before rotation by `quat`.
  makeBody(local, dx, dy, dz, vs, origin, quat, id, o = {}) {
    let n = 0, mx = 0, my = 0, mz = 0;
    const best = new Float32Array(26).fill(-1e9), bx = new Int16Array(26), by = new Int16Array(26), bz = new Int16Array(26), all = [];
    for (let y = 0; y < dy; y++) for (let z = 0; z < dz; z++) for (let x = 0; x < dx; x++) {
      const m = local[(y * dz + z) * dx + x]; if (!m) continue;
      n++; mx += x; my += y; mz += z; all.push(x, y, z, m);
      for (let q = 0; q < 26; q++) { const D = DIRS[q], s = x * D[0] + y * D[1] + z * D[2]; if (s > best[q]) { best[q] = s; bx[q] = x; by[q] = y; bz[q] = z; } }
    }
    if (!n) return null;
    mx = mx / n + 0.5; my = my / n + 0.5; mz = mz / n + 0.5;
    const md = meshBox(local, dx, dy, dz, [0, 0, 0], [dx, dy, dz]);
    const mesh = this.gfx.voxelMesh(md, vs), group = new THREE.Group();
    mesh.position.set(-mx * vs, -my * vs, -mz * vs); group.add(mesh);
    if (quat) group.quaternion.copy(quat);
    group.position.set(mx * vs, my * vs, mz * vs).applyQuaternion(group.quaternion).add(origin);
    this.gfx.scene.add(group);
    // contact points: the extreme voxels in 26 directions, plus a few at random
    const pts = [], seen = new Set();
    const addPt = (x, y, z) => { const k = (x * 977 + y) * 977 + z; if (seen.has(k)) return; seen.add(k); pts.push((x + 0.5 - mx) * vs, (y + 0.5 - my) * vs, (z + 0.5 - mz) * vs); };
    for (let q = 0; q < 26; q++) addPt(bx[q], by[q], bz[q]);
    for (let q = 0; q < 12; q++) { const k = ((Math.random() * n) | 0) * 4; addPt(all[k], all[k + 1], all[k + 2]); }
    const cstep = Math.max(1, Math.floor(n / 140)), crumbs = [];
    for (let k = 0; k < all.length; k += cstep * 4) crumbs.push((all[k] + 0.5 - mx) * vs, (all[k + 1] + 0.5 - my) * vs, (all[k + 2] + 0.5 - mz) * vs, all[k + 3]);
    let ex = 0, ey = 0, ez = 0; for (let k = 0; k < pts.length; k += 3) { ex = Math.max(ex, Math.abs(pts[k])); ey = Math.max(ey, Math.abs(pts[k + 1])); ez = Math.max(ez, Math.abs(pts[k + 2])); }
    const body = {
      id: id ?? `L${++this.uid}`, group, mesh, n, vs, mass: n * (vs / VOX) ** 3, pts: new Float32Array(pts), crumbs, vel: new THREE.Vector3(), ang: new THREE.Vector3(),
      invI: 1 / Math.max(0.01, (4 * (ex * ex + ey * ey + ez * ez)) / 14), rad: Math.hypot(ex, ey, ez) + vs * 0.5, rest: 0, age: 0, asleep: false, thud: 0,
      held: false, owner: null, thrown: 0, remote: 0, target: null, gib: !!o.gib, zombie: o.zombie || null, danger: null, hitCD: 0, carveCD: 0,
    };
    this.bodies.push(body); this.byId.set(body.id, body);
    this.trim();
    return body;
  }
  trim() {
    let gibs = 0; for (const b of this.bodies) if (b.gib) gibs++;
    for (let i = 0; i < this.bodies.length && (this.bodies.length > 48 || gibs > 30); i++) {
      const b = this.bodies[i]; if (b.held || b.remote || b.thrown > 0) continue;
      if (this.bodies.length <= 48 && !b.gib) continue;
      if (b.gib) gibs--; this.crumble(b); i--;
    }
  }

  dist(p) { return p.distanceTo(this.listener); }

  // break a body into chips; 'gore' adds blood, 'vapor' turns it to glowing dust
  crumble(b, style = '') {
    const i = this.bodies.indexOf(b); if (i < 0) return;
    this.bodies.splice(i, 1); this.byId.delete(b.id);
    const q = b.group.quaternion, p = b.group.position;
    for (let k = 0; k < b.crumbs.length; k += 4) {
      _p.set(b.crumbs[k], b.crumbs[k + 1], b.crumbs[k + 2]).applyQuaternion(q).add(p);
      if (style === 'vapor') { _c.copy(COLORS[b.crumbs[k + 3]]).lerp(_violet, 0.5); this.glow.add(_p.x, _p.y, _p.z, b.vel.x * 0.2 + rnd(0.8), 0.5 + Math.random() * 1.5, b.vel.z * 0.2 + rnd(0.8), 0.04 + Math.random() * 0.06, 0.4 + Math.random() * 0.6, -0.2, false, _c, 2); continue; }
      const s = style === 'gore' ? 1.6 : 0.8;
      this.chip(_p.x, _p.y, _p.z, b.vel.x * (style ? 0.6 : 1) + rnd(s), b.vel.y * 0.5 + Math.random() * 1.2 * s, b.vel.z * (style ? 0.6 : 1) + rnd(s), b.crumbs[k + 3], b.vs * (1 + Math.random() * 0.9), 2.5 + Math.random() * 4);
    }
    if (style === 'gore') this.gore(p.x, p.y, p.z, b.vel.x * 0.15, 0.2, b.vel.z * 0.15, 24, [ID.BLOOD, ID.BLOOD, ID.FLESH, ID.BONE]);
    this.gfx.scene.remove(b.group); b.mesh.geometry.dispose();
  }

  stepBody(b, dt) {
    const w = this.world, pos = b.group.position, q = b.group.quaternion, vel = b.vel, ang = b.ang, invI = b.invI;
    if (b.held && b.target) {
      // a spring to the hold point that heavy pieces answer slowly: swing the camera and they swing with it
      const k = 1 - Math.exp(-dt * 26 / (1 + b.mass / 2200));
      vel.x += ((b.target.x - pos.x) * 13 - vel.x) * k; vel.y += ((b.target.y - pos.y) * 13 - vel.y) * k; vel.z += ((b.target.z - pos.z) * 13 - vel.z) * k;
      ang.multiplyScalar(Math.exp(-2.5 * dt));
    } else vel.y -= G * dt;
    pos.addScaledVector(vel, dt);
    _q.set(ang.x * dt * 0.5, ang.y * dt * 0.5, ang.z * dt * 0.5, 0).multiply(q);
    q.x += _q.x; q.y += _q.y; q.z += _q.z; q.w += _q.w; q.normalize();
    let contacts = 0, cx = 0, cy = 0, cz = 0, impact = 0, ix = 0, iy = 0, iz = 0, inx = 0, iny = 0, inz = 0;
    const pts = b.pts;
    for (let k = 0; k < pts.length; k += 3) {
      _p.set(pts[k], pts[k + 1], pts[k + 2]).applyQuaternion(q);
      const rx = _p.x, ry = _p.y, rz = _p.z, px = pos.x + rx, py = pos.y + ry, pz = pos.z + rz;
      const vx = Math.floor(px / VOX), vy = Math.floor(py / VOX), vz = Math.floor(pz / VOX);
      if (!w.solid(vx, vy, vz)) continue;
      // push out through the nearest open face, preferring up
      let nx = 0, ny = 1, nz = 0, depth = (vy + 1) * VOX - py;
      if (w.solid(vx, vy + 1, vz)) {
        depth = 1e9;
        const fx = px / VOX - vx, fz = pz / VOX - vz, fy = py / VOX - vy;
        if (!w.solid(vx - 1, vy, vz) && fx * VOX < depth) { depth = fx * VOX; nx = -1; ny = 0; nz = 0; }
        if (!w.solid(vx + 1, vy, vz) && (1 - fx) * VOX < depth) { depth = (1 - fx) * VOX; nx = 1; ny = 0; nz = 0; }
        if (!w.solid(vx, vy, vz - 1) && fz * VOX < depth) { depth = fz * VOX; nx = 0; ny = 0; nz = -1; }
        if (!w.solid(vx, vy, vz + 1) && (1 - fz) * VOX < depth) { depth = (1 - fz) * VOX; nx = 0; ny = 0; nz = 1; }
        if (!w.solid(vx, vy - 1, vz) && fy * VOX < depth) { depth = fy * VOX; nx = 0; ny = -1; nz = 0; }
        if (depth > 1e8) { depth = VOX; nx = 0; ny = 1; nz = 0; }
      }
      contacts++; cx += nx * depth; cy += ny * depth; cz += nz * depth;
      const pvx = vel.x + ang.y * rz - ang.z * ry, pvy = vel.y + ang.z * rx - ang.x * rz, pvz = vel.z + ang.x * ry - ang.y * rx;
      const vn = pvx * nx + pvy * ny + pvz * nz;
      if (vn >= 0) continue;
      const cnx = ry * nz - rz * ny, cny = rz * nx - rx * nz, cnz = rx * ny - ry * nx;
      const j = -(1.12) * vn / (1 + invI * (cnx * cnx + cny * cny + cnz * cnz));
      vel.x += nx * j; vel.y += ny * j; vel.z += nz * j; ang.x += cnx * j * invI; ang.y += cny * j * invI; ang.z += cnz * j * invI;
      const tx = pvx - nx * vn, ty = pvy - ny * vn, tz = pvz - nz * vn, tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-3) {
        const ux = tx / tl, uy = ty / tl, uz = tz / tl, ctx = ry * uz - rz * uy, cty = rz * ux - rx * uz, ctz = rx * uy - ry * ux;
        const jt = Math.min(0.6 * j, tl / (1 + invI * (ctx * ctx + cty * cty + ctz * ctz)));
        vel.x -= ux * jt; vel.y -= uy * jt; vel.z -= uz * jt; ang.x -= ctx * jt * invI; ang.y -= cty * jt * invI; ang.z -= ctz * jt * invI;
      }
      if (-vn > impact) { impact = -vn; ix = px; iy = py; iz = pz; inx = nx; iny = ny; inz = nz; }
    }
    if (contacts) {
      pos.x += cx / contacts * 0.5; pos.y += cy / contacts * 0.5; pos.z += cz / contacts * 0.5;
      ang.multiplyScalar(Math.exp(-3.5 * dt)); vel.x *= Math.exp(-1.5 * dt); vel.z *= Math.exp(-1.5 * dt);
      if (!b.held && vel.lengthSq() < 0.2 && ang.lengthSq() < 0.5) b.rest += dt; else b.rest = Math.max(0, b.rest - dt);
    } else b.rest = 0;
    b.thud -= dt;
    if (impact > 2.6 && b.thud <= 0) {
      b.thud = 0.25;
      const size = Math.min(1, b.mass / 4000), d = this.dist(pos);
      this.audio?.thud(size, d, impact);
      this.dust(ix, iy + 0.1, iz, 4 + size * 14, b.crumbs[3] || 11, 0.3 + size, 1.2);
      if (d < 14) this.shake = Math.max(this.shake, size * impact * 0.02 * (1 - d / 14));
      for (let k = 0; k < 2 + size * 10; k++) { const c = ((Math.random() * (b.crumbs.length / 4)) | 0) * 4; this.chip(ix + rnd(0.4), iy + 0.15, iz + rnd(0.4), rnd(2.5), 1 + Math.random() * 3, rnd(2.5), b.crumbs[c + 3]); }
    }
    if (impact > 2.6) this.onImpact?.(b, ix, iy, iz, impact, inx, iny, inz);
    if (pos.y < -5) b.age = 99;
  }

  update(dt) {
    this.chips.update(dt, this.world); this.glow.update(dt, this.world);
    this.shake = Math.max(0, this.shake - dt * 1.4);
    const sub = dt > 0.012 ? 2 : 1, h = dt / sub, now = performance.now();
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]; if (!b) continue;
      b.age += dt; b.thrown = Math.max(0, b.thrown - dt); b.hitCD = Math.max(0, b.hitCD - dt); b.carveCD = Math.max(0, b.carveCD - dt);
      if (b.remote) {
        // another player owns this piece: follow what they send, and take over if they go quiet
        if (now - b.remote > 1500) { b.remote = 0; b.asleep = false; }
        else if (b.target) {
          const k = 1 - Math.exp(-dt * 14), pos = b.group.position;
          b.vel.set((b.target.x - pos.x) / Math.max(dt, 1e-3), (b.target.y - pos.y) / Math.max(dt, 1e-3), (b.target.z - pos.z) / Math.max(dt, 1e-3)).multiplyScalar(k);
          pos.lerp(b.target, k); if (b.targetQ) b.group.quaternion.slerp(b.targetQ, k);
          continue;
        }
      }
      if (!b.asleep) {
        for (let s = 0; s < sub; s++) this.stepBody(b, h);
        if (this.onCrush && b.mass > 60 && b.vel.lengthSq() > 9) this.onCrush(b);
        if (b.rest > 0.45) { b.asleep = true; b.sleepAt = b.age; }
      }
      this.onMove?.(b, dt);
      if (!this.bodies.includes(b)) continue;
      if (b.held || b.thrown > 0) continue;
      const life = b.gib ? 2.2 : 3.5;
      if ((b.asleep && b.age - b.sleepAt > life) || b.age > (b.gib ? 9 : 16)) this.crumble(b, b.zombie ? 'gore' : '');
    }
  }
}
