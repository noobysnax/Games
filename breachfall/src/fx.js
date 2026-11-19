// Everything that flies after something breaks: loose voxel chips, glowing sparks and fire, smoke blocks,
// and the big one: cut-off pieces of the map that fall, tumble and crush as rigid bodies.

import * as THREE from 'three';
import { VOX, MAT } from './config.js';
import { meshBox } from './mesher.js';

const G = 19;
const COLORS = MAT.map((m) => new THREE.Color(m.color));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;

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
    this.bodies = [];
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
  gore(x, y, z, dx, dy, dz, n, colors) {
    for (let i = 0; i < n; i++) {
      _c.setHex(colors[(Math.random() * colors.length) | 0]);
      this.chips.add(x + rnd(0.2), y + rnd(0.5), z + rnd(0.2), dx * 3 + rnd(2.5), dy * 3 + 1.5 + Math.random() * 3, dz * 3 + rnd(2.5), 0.07 + Math.random() * 0.1, 3 + Math.random() * 4, 1, true, _c);
    }
  }

  /* ------------------------------------------------------- breaking things */
  // Carve, throw debris, and let whatever lost its support come down. Returns the carve result.
  blast(x, y, z, r, tier, o = {}) {
    const res = this.world.carve(x, y, z, r, tier, o.samples ?? 120, o.tall ?? 1);
    if (!res.removed) return res;
    this.burst(res.samples, x, y, z, o.push ?? 3, o.nx, o.ny, o.nz);
    if (res.samples.length) this.dust(x, y, z, Math.min(14, 2 + r * 8), res.samples[3], r * 0.6);
    const islands = this.world.findIslands(res.seeds);
    for (const isl of islands) this.addBody(isl, x, y, z, o.push ?? 3);
    return res;
  }

  addBody(isl, cx, cy, cz, push) {
    const w = this.world, [x0, y0, z0, x1, y1, z1] = isl.box, n = isl.n;
    const kick = (px, py, pz, s) => { const dx = px - cx, dy = py - cy, dz = pz - cz, l = Math.hypot(dx, dy, dz) || 1, k = push * s / (1 + l * l * 0.6); return [dx / l * k, dy / l * k + k * 0.3, dz / l * k]; };
    if (n < 12 || n > 90000) { // crumbs, or something absurdly large: just chips
      const step = Math.max(1, Math.floor(n / 400));
      for (let k = 0; k < n; k += step) { const i = isl.idx[k], x = i % w.sx, zy = (i / w.sx) | 0, z = zy % w.sz, y = (zy / w.sz) | 0, v = kick((x + 0.5) * VOX, (y + 0.5) * VOX, (z + 0.5) * VOX, 1); this.chip((x + 0.5) * VOX, (y + 0.5) * VOX, (z + 0.5) * VOX, v[0] + rnd(0.5), v[1], v[2] + rnd(0.5), isl.mats[k]); }
      return;
    }
    const dx = x1 - x0 + 3, dy = y1 - y0 + 3, dz = z1 - z0 + 3, local = new Uint8Array(dx * dy * dz);
    let mx = 0, my = 0, mz = 0;
    const best = new Float32Array(26).fill(-1e9), bi = new Int32Array(26);
    const lx = new Int16Array(n), ly = new Int16Array(n), lz = new Int16Array(n);
    for (let k = 0; k < n; k++) {
      const i = isl.idx[k], x = i % w.sx - x0 + 1, zy = (i / w.sx) | 0, z = zy % w.sz - z0 + 1, y = ((zy / w.sz) | 0) - y0 + 1;
      local[(y * dz + z) * dx + x] = isl.mats[k]; lx[k] = x; ly[k] = y; lz[k] = z; mx += x; my += y; mz += z;
      for (let q = 0; q < 26; q++) { const D = DIRS[q], s = x * D[0] + y * D[1] + z * D[2]; if (s > best[q]) { best[q] = s; bi[q] = k; } }
    }
    mx = mx / n + 0.5; my = my / n + 0.5; mz = mz / n + 0.5;
    const md = meshBox(local, dx, dy, dz, [0, 0, 0], [dx, dy, dz]);
    const mesh = this.gfx.voxelMesh(md), group = new THREE.Group();
    mesh.position.set(-mx * VOX, -my * VOX, -mz * VOX); group.add(mesh);
    group.position.set((x0 - 1 + mx) * VOX, (y0 - 1 + my) * VOX, (z0 - 1 + mz) * VOX);
    this.gfx.scene.add(group);
    // contact points: the extreme voxels in 26 directions, plus a few random ones
    const pts = [], seen = new Set();
    const addPt = (k) => { if (seen.has(k)) return; seen.add(k); pts.push((lx[k] + 0.5 - mx) * VOX, (ly[k] + 0.5 - my) * VOX, (lz[k] + 0.5 - mz) * VOX); };
    for (let q = 0; q < 26; q++) addPt(bi[q]);
    for (let q = 0; q < 14; q++) addPt((Math.random() * n) | 0);
    // a thinned copy of the voxels for when it finally crumbles
    const cstep = Math.max(1, Math.floor(n / 140)), crumbs = [];
    for (let k = 0; k < n; k += cstep) crumbs.push((lx[k] + 0.5 - mx) * VOX, (ly[k] + 0.5 - my) * VOX, (lz[k] + 0.5 - mz) * VOX, isl.mats[k]);
    const ex = (x1 - x0 + 1) * VOX, ey = (y1 - y0 + 1) * VOX, ez = (z1 - z0 + 1) * VOX;
    const v = kick(group.position.x, group.position.y, group.position.z, Math.min(1, 300 / n) + 0.15);
    const body = {
      group, mesh, n, pts: new Float32Array(pts), crumbs, vel: new THREE.Vector3(v[0], v[1], v[2]),
      ang: new THREE.Vector3(rnd(0.6), rnd(0.3), rnd(0.6)).multiplyScalar(Math.min(1, 200 / n) + 0.1),
      invI: 1 / Math.max(0.02, (ex * ex + ey * ey + ez * ez) / 14), rad: Math.hypot(ex, ey, ez) / 2, rest: 0, age: 0, asleep: false, thud: 0,
    };
    this.bodies.push(body);
    if (this.bodies.length > 22) this.crumble(this.bodies[0]);
    if (n > 400) this.audio?.rumble(Math.min(1, n / 6000), this.dist(group.position));
    return body;
  }

  dist(p) { return p.distanceTo(this.listener); }

  crumble(b) {
    const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1);
    const q = b.group.quaternion, p = b.group.position;
    for (let k = 0; k < b.crumbs.length; k += 4) {
      _p.set(b.crumbs[k], b.crumbs[k + 1], b.crumbs[k + 2]).applyQuaternion(q).add(p);
      this.chip(_p.x, _p.y, _p.z, b.vel.x + rnd(0.8), b.vel.y + Math.random() * 1.2, b.vel.z + rnd(0.8), b.crumbs[k + 3], VOX * (1 + Math.random() * 0.9), 2.5 + Math.random() * 4);
    }
    this.gfx.scene.remove(b.group); b.mesh.geometry.dispose();
  }

  stepBody(b, dt) {
    const w = this.world, pos = b.group.position, q = b.group.quaternion, vel = b.vel, ang = b.ang, invI = b.invI;
    vel.y -= G * dt;
    pos.addScaledVector(vel, dt);
    _q.set(ang.x * dt * 0.5, ang.y * dt * 0.5, ang.z * dt * 0.5, 0).multiply(q);
    q.x += _q.x; q.y += _q.y; q.z += _q.z; q.w += _q.w; q.normalize();
    let contacts = 0, cx = 0, cy = 0, cz = 0, impact = 0, ix = 0, iy = 0, iz = 0;
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
      if (-vn > impact) { impact = -vn; ix = px; iy = py; iz = pz; }
    }
    if (contacts) {
      pos.x += cx / contacts * 0.5; pos.y += cy / contacts * 0.5; pos.z += cz / contacts * 0.5;
      ang.multiplyScalar(Math.exp(-3.5 * dt)); vel.x *= Math.exp(-1.5 * dt); vel.z *= Math.exp(-1.5 * dt);
      if (vel.lengthSq() < 0.2 && ang.lengthSq() < 0.5) b.rest += dt; else b.rest = Math.max(0, b.rest - dt);
    } else b.rest = 0;
    b.thud -= dt;
    if (impact > 2.6 && b.thud <= 0) {
      b.thud = 0.25;
      const size = Math.min(1, b.n / 4000), d = this.dist(pos);
      this.audio?.thud(size, d, impact);
      this.dust(ix, iy + 0.1, iz, 4 + size * 14, b.crumbs[3] || 11, 0.3 + size, 1.2);
      if (d < 14) this.shake = Math.max(this.shake, size * impact * 0.02 * (1 - d / 14));
      // heavy hits knock chips off the piece and chew the ground a little
      for (let k = 0; k < 4 + size * 10; k++) { const c = ((Math.random() * (b.crumbs.length / 4)) | 0) * 4; this.chip(ix + rnd(0.4), iy + 0.15, iz + rnd(0.4), rnd(2.5), 1 + Math.random() * 3, rnd(2.5), b.crumbs[c + 3]); }
    }
    if (pos.y < -5) b.age = 99;
  }

  update(dt) {
    this.chips.update(dt, this.world); this.glow.update(dt, this.world);
    this.shake = Math.max(0, this.shake - dt * 1.4);
    const sub = dt > 0.012 ? 2 : 1, h = dt / sub;
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]; b.age += dt;
      if (!b.asleep) {
        for (let s = 0; s < sub; s++) this.stepBody(b, h);
        if (this.onCrush && b.n > 60 && b.vel.lengthSq() > 9) this.onCrush(b);
        if (b.rest > 0.45) { b.asleep = true; b.sleepAt = b.age; }
      }
      if ((b.asleep && b.age - b.sleepAt > 3.5) || b.age > 16) this.crumble(b);
    }
  }
}
