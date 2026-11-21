// The horde: blocky walkers that follow the nav distance field toward the nearest player, claw through anything
// flimsy when they have no route, and come apart part by part when they die. Also the Warden, the boss under
// the vault. In co-op the host runs all of this; the other players' copies only mirror what the host sends.

import * as THREE from 'three';
import { MAT, ID, VOX } from './config.js';

const CAP = 48, PARTS = 6;
const SKINS = [0, 1, 2, 3].map((i) => ID.SKIN0 + i), SHIRTS = [0, 1, 2, 3, 4, 5, 6].map((i) => ID.SHIRT0 + i), PANTS = [0, 1, 2, 3].map((i) => ID.PANTS0 + i);
// part sizes (w, h, d) before scaling, and which material each takes
const BODY = {
  walker: { hip: 0.1, leg: [0.17, 0.8, 0.19], torso: [0.44, 0.64, 0.25], arm: [0.12, 0.62, 0.13], head: [0.3, 0.32, 0.3] },
  boss: { hip: 0.15, leg: [0.26, 0.8, 0.28], torso: [0.66, 0.68, 0.4], arm: [0.22, 0.74, 0.24], head: [0.3, 0.3, 0.32] },
};
export const PART_NAMES = ['left leg', 'right leg', 'torso', 'left arm', 'right arm', 'head'];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _qx = new THREE.Quaternion(), _p = new THREE.Vector3(), _o = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _lm = new THREE.Matrix4(), _wm = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), WHITE = new THREE.Color(1.6, 0.5, 0.4);
const pick = (a) => a[(Math.random() * a.length) | 0];
const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
const dirOut = { x: 0, z: 0 };
const ST = ['rise', 'chase', 'attack', 'slam', 'throw', 'roar'];

export class Horde {
  constructor(gfx, world, nav, fx, audio) {
    this.gfx = gfx; this.world = world; this.nav = nav; this.fx = fx; this.audio = audio;
    this.list = []; this.byId = new Map(); this.nid = 0;
    this.replica = false;         // true on co-op clients: positions come from the host
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), CAP * PARTS);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    this.eyes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.2, 0.4) }), CAP);
    this.eyes.frustumCulled = false; this.eyes.count = 0;
    gfx.scene.add(this.mesh, this.eyes);
    // callbacks the game sets
    this.onKill = null; this.onLost = null; this.onAttack = null; this.onRemoteHit = null; this.carve = null; this.onBoss = null;
    this.listener = new THREE.Vector3();
    this.groanT = 2; this.frame = 0;
  }
  clear() { this.list.length = 0; this.byId.clear(); this.draw(); }
  get boss() { return this.list.find((z) => z.type === 'boss') || null; }

  make(id, type, x, y, z, o = {}) {
    const boss = type === 'boss';
    const zb = {
      id, type, x, z, y, yaw: o.yaw ?? Math.random() * 6.28, hp: o.hp ?? 100, maxHp: o.hp ?? 100, speed: o.speed ?? 1.3, state: 'rise', t: 0, anim: Math.random() * 6,
      scale: o.scale ?? (boss ? 2.1 : 0.94 + Math.random() * 0.14), skin: o.skin ?? (boss ? ID.BOSS_HIDE : pick(SKINS)), shirt: o.shirt ?? (boss ? ID.BOSS_PLATE : pick(SHIRTS)), pants: o.pants ?? (boss ? ID.BOSS_PLATE : pick(PANTS)),
      flash: 0, noPath: 0, clawT: 0, stuckT: 0, lx: x, lz: z, hitDone: false, lean: o.lean ?? Math.random() * 0.2, dims: BODY[boss ? 'boss' : 'walker'],
      m: Array.from({ length: PARTS }, () => new THREE.Matrix4()), lm: Array.from({ length: PARTS }, () => new THREE.Matrix4()), inv: Array.from({ length: PARTS }, () => new THREE.Matrix4()), invAt: -1,
      tx: x, ty: y, tz: z, tyaw: 0, slamCD: 5, throwCD: 4, minionCD: 6, smashCD: 0, enraged: false, held: null, target: null,
    };
    this.list.push(zb); this.byId.set(id, zb);
    return zb;
  }
  spawn(x, z, hp, speed, floorY, type = 'walker') {
    if (this.list.length >= CAP) return null;
    const zb = this.make(++this.nid, type, x, floorY, z, { hp, speed });
    if (type === 'boss') { zb.slamCD = 6; zb.throwCD = 4; }
    this.fx.dust(x, floorY + 0.1, z, type === 'boss' ? 40 : 10, ID.DIRT, 0.35 * zb.scale, 1.4);
    for (let i = 0; i < (type === 'boss' ? 30 : 8); i++) this.fx.chip(x + rnd(0.3 * zb.scale), floorY + 0.1, z + rnd(0.3 * zb.scale), rnd(1), 2 + Math.random() * 2.5, rnd(1), ID.DIRT, 0.09, 2);
    return zb;
  }
  remove(zb) { const i = this.list.indexOf(zb); if (i >= 0) this.list.splice(i, 1); this.byId.delete(zb.id); }

  /* ------------------------------------------------------------------ hits */
  partInverse(zb) {
    if (zb.invAt !== this.frame) { for (let i = 0; i < PARTS; i++) zb.inv[i].copy(zb.m[i]).invert(); zb.invAt = this.frame; }
    return zb.inv;
  }
  // every zombie the ray passes through before tmax, nearest first: [{ z, t, part, head }]
  rayHits(ox, oy, oz, dx, dy, dz, tmax) {
    const out = [];
    for (const zb of this.list) {
      if (zb.state === 'rise' && zb.t < 0.5) continue;
      // cheap bounding test first
      const s = zb.scale, cx = zb.x - ox, cy = zb.y + 0.9 * s - oy, cz = zb.z - oz, b = cx * dx + cy * dy + cz * dz;
      const r = 1.15 * s; if (b < -r || b > tmax + r || cx * cx + cy * cy + cz * cz - b * b > r * r) continue;
      const inv = this.partInverse(zb); let best = Infinity, part = -1;
      for (let i = 0; i < PARTS; i++) {
        _ro.set(ox, oy, oz).applyMatrix4(inv[i]);
        // the direction goes through the 3x3 part only, unnormalised, so t stays in world metres
        const e = inv[i].elements; _rd.set(e[0] * dx + e[4] * dy + e[8] * dz, e[1] * dx + e[5] * dy + e[9] * dz, e[2] * dx + e[6] * dy + e[10] * dz);
        let t0 = 0, t1 = tmax, ok = true;
        for (let a = 0; a < 3 && ok; a++) {
          const o = _ro.getComponent(a), d = _rd.getComponent(a);
          if (Math.abs(d) < 1e-12) { if (o < -0.5 || o > 0.5) ok = false; continue; }
          let ta = (-0.5 - o) / d, tb = (0.5 - o) / d; if (ta > tb) { const q = ta; ta = tb; tb = q; }
          if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) ok = false;
        }
        if (ok && t0 < best) { best = t0; part = i; }
      }
      if (part >= 0) out.push({ z: zb, t: best, part, head: part === 5 });
    }
    return out.sort((a, b) => a.t - b.t);
  }
  // zombies whose body is within r of a point (bodies swung into them, explosions)
  near(x, y, z, r) {
    const out = [];
    for (const zb of this.list) { const s = zb.scale, d = Math.hypot(zb.x - x, (zb.y + 0.9 * s - y) * 0.7, zb.z - z); if (d < r + 0.25 * s) out.push(zb); }
    return out;
  }

  // returns true if this killed it. On a co-op client the hit goes to the host instead.
  damage(zb, dmg, info = {}) {
    if (zb.state === 'dead') return false;
    zb.flash = 0.12;
    if (this.replica) { this.onRemoteHit?.(zb, dmg, info); return false; }
    zb.hp -= dmg;
    if (zb.hp > 0) return false;
    this.kill(zb, info);
    return true;
  }
  kill(zb, info = {}) {
    zb.state = 'dead'; this.remove(zb);
    if (!info.grab) this.gib(zb, info);
    if (!info.quiet) this.audio.kill();
    this.onKill?.(zb, info);
  }

  /* ----------------------------------------------------------------- gibs */
  partMats(zb, i) { return i <= 1 ? zb.pants : i === 2 ? zb.shirt : zb.skin; }
  // one part as a little voxel grid: its material, with a bloody end where it tore off
  partGrid(zb, i, vs) {
    const d = zb.dims, size = i <= 1 ? d.leg : i === 2 ? d.torso : i <= 4 ? d.arm : d.head, s = zb.scale;
    const nx = Math.max(1, Math.round(size[0] * s / vs)), ny = Math.max(1, Math.round(size[1] * s / vs)), nz = Math.max(1, Math.round(size[2] * s / vs));
    const g = new Uint8Array(nx * ny * nz), m = this.partMats(zb, i);
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      let v = m;
      const top = y === ny - 1, bot = y === 0, edge = x === 0 || z === 0 || x === nx - 1 || z === nz - 1;
      if ((i <= 1 || i >= 3) && i !== 5 && top) v = edge ? ID.BLOOD : (x + z) % 3 ? ID.FLESH : ID.BONE;
      if (i === 5 && bot) v = edge ? ID.BLOOD : ID.FLESH;
      if (i === 2 && (top || bot) && !edge) v = (x + z) & 1 ? ID.FLESH : ID.BLOOD;
      if (i <= 1 && y < 2) v = ID.PANTS0 + 2; // boots
      if (i >= 3 && i <= 4 && bot) v = zb.skin;
      if (Math.random() < 0.05) v = ID.BLOOD;
      g[(y * nz + z) * nx + x] = v;
    }
    return { g, nx, ny, nz };
  }
  gib(zb, info) {
    const fx = this.fx, dir = _o.set(info.dx || 0, info.dy || 0, info.dz || 0), sp = info.speed || 0;
    const blood = [ID.BLOOD, ID.BLOOD, ID.FLESH, ID.BONE];
    const vs = 0.0625 * Math.min(2, zb.scale), maxBodies = info.bodies ?? 5;
    let made = 0;
    const center = new THREE.Vector3(zb.x, zb.y + 0.9 * zb.scale, zb.z), scl = new THREE.Vector3();
    for (let i = 0; i < PARTS; i++) {
      zb.m[i].decompose(_p, _q, scl);
      const pos = _p.clone(), quat = _q.clone(), mats = [this.partMats(zb, i), this.partMats(zb, i), ...blood];
      if (info.vapor) { // hit by something huge and fast: the whole zombie sprays along the swing
        fx.vaporize(pos.x, pos.y, pos.z, mats, dir.x, dir.y, dir.z, Math.max(6, sp), (i === 2 ? 50 : 22) * Math.min(2, zb.scale), !!info.dis);
        continue;
      }
      const hit = info.part === i || (info.part == null && i === 2 && !info.explosive);
      if (hit && !info.explosive) { // the part that took the killing shot bursts
        fx.vaporize(pos.x, pos.y, pos.z, mats, dir.x, dir.y + 0.2, dir.z, 4.5, (i === 2 ? 46 : 26) * Math.min(2, zb.scale));
        fx.gore(pos.x, pos.y, pos.z, dir.x, 0.4, dir.z, 12, blood);
        continue;
      }
      if (made >= maxBodies) { fx.gore(pos.x, pos.y, pos.z, dir.x * 0.3, 0, dir.z * 0.3, 6, mats); continue; }
      const { g, nx, ny, nz } = this.partGrid(zb, i, vs);
      const origin = new THREE.Vector3(-nx * vs / 2, -ny * vs / 2, -nz * vs / 2).applyQuaternion(quat).add(pos);
      const b = fx.makeBody(g, nx, ny, nz, vs, origin, quat, null, { gib: true });
      if (!b) continue;
      made++;
      if (info.explosive) { const out = pos.clone().sub(center); out.y = Math.abs(out.y) + 0.5; out.normalize(); b.vel.copy(out).multiplyScalar(4 + Math.random() * 5).addScaledVector(dir, 3); b.ang.set(rnd(12), rnd(12), rnd(12)); }
      else { b.vel.copy(dir).multiplyScalar(i === 2 ? 2.2 : 1.2).add(new THREE.Vector3(rnd(0.8), 0.6 + Math.random(), rnd(0.8))); b.ang.set(rnd(5), rnd(3), rnd(5)); }
      if (info.crush) b.vel.y -= 2;
    }
    if (info.explosive) fx.gore(center.x, center.y, center.z, 0, 1, 0, 30, blood);
  }
  // the whole zombie as one rigid voxel body, posed as it was (for the Matter Destroyer to swing about)
  asBody(zb, id) {
    const s = zb.scale, vs = 0.0625 * Math.min(2, s), W = 1.1 * s, Hh = 2.0 * s, D = 1.3 * s;
    const nx = Math.ceil(W / vs), ny = Math.ceil(Hh / vs), nz = Math.ceil(D / vs), g = new Uint8Array(nx * ny * nz);
    const invs = zb.lm.map((m) => m.clone().invert());
    const mats = [0, 1, 2, 3, 4, 5].map((i) => this.partMats(zb, i));
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      _p.set((x + 0.5) * vs - W / 2, (y + 0.5) * vs, (z + 0.5) * vs - D / 2 + 0.1 * s);
      for (let i = 0; i < PARTS; i++) {
        _o.copy(_p).applyMatrix4(invs[i]);
        if (Math.abs(_o.x) <= 0.5 && Math.abs(_o.y) <= 0.5 && Math.abs(_o.z) <= 0.5) { g[(y * nz + z) * nx + x] = Math.random() < 0.04 ? ID.BLOOD : mats[i]; break; }
      }
    }
    _qy.setFromAxisAngle(Y, zb.yaw);
    const origin = new THREE.Vector3(-W / 2, 0, -D / 2 + 0.1 * s).applyQuaternion(_qy).add(new THREE.Vector3(zb.x, zb.y, zb.z));
    return this.fx.makeBody(g, nx, ny, nz, vs, origin, _qy.clone(), id, { zombie: { skin: zb.skin, shirt: zb.shirt, pants: zb.pants } });
  }

  /* ---------------------------------------------------------------- update */
  nearest(zb, targets) {
    let best = null, bd = 1e9;
    for (const t of targets) { if (t.dead) continue; const d = Math.hypot(t.x - zb.x, t.z - zb.z) + Math.abs(t.y - zb.y) * 2; if (d < bd) { bd = d; best = t; } }
    return best;
  }
  update(dt, targets, ctx = {}) {
    this.frame++;
    const list = this.list;
    this.groanT -= dt;
    if (this.groanT <= 0 && list.length) { const zb = pick(list); this.audio.groan(Math.hypot(zb.x - this.listener.x, zb.z - this.listener.z), zb.type === 'boss' ? 0.45 : 0.8 + Math.random() * 0.5); this.groanT = 0.5 + Math.random() * 2.2 / Math.min(4, 1 + list.length / 6); }
    if (this.replica) { this.mirror(dt); this.draw(); return; }
    for (let i = list.length - 1; i >= 0; i--) {
      const zb = list[i]; zb.t += dt; zb.flash = Math.max(0, zb.flash - dt);
      if (zb.state === 'rise') { if (zb.t > (zb.type === 'boss' ? 2.6 : 1.25)) { zb.state = 'chase'; zb.t = 0; if (zb.type === 'boss') this.onBoss?.('roar', zb); } continue; }
      if (zb.type === 'boss') { this.bossStep(zb, dt, targets, ctx); continue; }
      const tg = this.nearest(zb, targets);
      if (!tg) { zb.state = 'chase'; this.idle(zb, dt); continue; }
      const ddx = tg.x - zb.x, ddz = tg.z - zb.z, dp = Math.hypot(ddx, ddz) || 1e-3, dy = tg.y - zb.y;
      let mx = 0, mz = 0, sp = zb.speed;
      if (zb.state === 'attack') {
        sp *= 0.25;
        if (!zb.hitDone && zb.t > 0.36) { zb.hitDone = true; if (dp < 1.4 && Math.abs(dy) < 1.9 && !tg.dead) this.onAttack?.(zb, tg, 40); }
        if (zb.t > 0.85) { zb.state = 'chase'; zb.t = 0; }
        mx = ddx / dp; mz = ddz / dp;
      } else {
        const d = dp < 1.5 && Math.abs(dy) < 1.2 ? null : this.nav.dir(zb.x, zb.y + 0.2, zb.z, dirOut);
        if (d) { mx = d.x; mz = d.z; zb.noPath = 0; }
        else {
          mx = ddx / dp; mz = ddz / dp;
          if (dp >= 1.5 || Math.abs(dy) >= 1.2) {
            // no route: tear at whatever flimsy thing is in the way
            zb.noPath += dt; zb.clawT -= dt;
            if (zb.clawT <= 0 && zb.noPath > 0.8) { zb.clawT = 0.7; zb.anim += 2; this.carve?.(zb.x + mx * 0.55, zb.y + 0.9, zb.z + mz * 0.55, 0.46, 0, { push: 2, samples: 20, tall: 1.6 }); }
            if (zb.noPath > 14) { this.onLost?.(zb); this.remove(zb); continue; }
          }
        }
        if (dp < 1.05 && Math.abs(dy) < 1.9 && !tg.dead) { zb.state = 'attack'; zb.t = 0; zb.hitDone = false; }
      }
      // stop at arm's length; a zombie never walks into a player
      if (dp < 0.8 && Math.abs(dy) < 1.9) { const k = (0.8 - dp) / dp; mx = -ddx * k * 4 + mx * 0.05; mz = -ddz * k * 4 + mz * 0.05; }
      this.separate(zb, i, (ax, az) => { mx += ax; mz += az; });
      this.move(zb, mx, mz, sp, dt);
      const moved = Math.hypot(zb.x - zb.lx, zb.z - zb.lz);
      // wedged somewhere for a long time while far from everyone: send it round again
      if (moved > 0.004 || dp < 2.5) zb.stuckT = 0; else { zb.stuckT += dt; if (zb.stuckT > 9) { this.onLost?.(zb); this.remove(zb); continue; } }
      zb.lx = zb.x; zb.lz = zb.z;
    }
    this.draw();
  }
  idle(zb, dt) { zb.anim += dt * 0.6; }
  separate(zb, i, add) {
    const list = this.list;
    for (let j = 0; j < list.length; j++) {
      if (j === i) continue; const o = list[j], ex = zb.x - o.x, ez = zb.z - o.z, e2 = ex * ex + ez * ez, rr = 0.3 * (zb.scale + o.scale);
      if (e2 < rr * rr && e2 > 1e-6) { const e = Math.sqrt(e2), k = (rr - e) / e * 1.6; add(ex * k, ez * k); }
    }
  }
  move(zb, mx, mz, sp, dt) {
    const nav = this.nav, nx = zb.x + mx * sp * dt, nz = zb.z + mz * sp * dt, c0 = nav.locate(zb.x, zb.y + 0.2, zb.z);
    const can = (x, z) => { const c = nav.locate(x, zb.y + 0.2, z); if (c < 0) return false; return c === c0 || nav.canStep(c0, c) || nav.floor[c0] < 0 || c0 < 0; };
    if (can(nx, nz)) { zb.x = nx; zb.z = nz; } else if (can(nx, zb.z)) zb.x = nx; else if (can(zb.x, nz)) zb.z = nz;
    const f = nav.floorAt(zb.x, zb.y + 0.2, zb.z); if (f >= 0) zb.y += (f - zb.y) * (1 - Math.exp(-14 * dt));
    zb.anim += Math.min(Math.hypot(zb.x - zb.lx, zb.z - zb.lz), 0.2) * 3.4 / zb.scale;
    if (mx || mz) { let da = Math.atan2(mx, mz) - zb.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); zb.yaw += da * (1 - Math.exp(-9 * dt)); }
  }

  /* ----------------------------------------------------------------- boss */
  // The Warden: slow, huge, smashes through pillars, slams the floor, rips up boulders and throws them.
  bossStep(zb, dt, targets, ctx) {
    const inArena = (t) => !t.dead && ctx.inArena?.(t);
    const live = targets.filter(inArena);
    zb.slamCD -= dt; zb.throwCD -= dt; zb.minionCD -= dt; zb.smashCD -= dt;
    if (!zb.enraged && zb.hp < zb.maxHp * 0.5) { zb.enraged = true; zb.speed *= 1.5; this.onBoss?.('enrage', zb); }
    if (!live.length) { zb.state = 'roar'; zb.hp = Math.min(zb.maxHp, zb.hp + zb.maxHp * 0.01 * dt); zb.anim += dt; this.draw(); return; }
    const tg = this.nearest(zb, live), ddx = tg.x - zb.x, ddz = tg.z - zb.z, dp = Math.hypot(ddx, ddz) || 1e-3;
    const face = () => { let da = Math.atan2(ddx, ddz) - zb.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); zb.yaw += da * (1 - Math.exp(-5 * dt)); };
    if (zb.minionCD <= 0) { zb.minionCD = zb.enraged ? 7 : 10; this.onBoss?.('minions', zb); }
    if (zb.state === 'roar') zb.state = 'chase';
    if (zb.state === 'attack') {
      face();
      if (!zb.hitDone && zb.t > 0.55) { zb.hitDone = true; for (const t of live) { const d = Math.hypot(t.x - zb.x, t.z - zb.z); if (d < 3.4) this.onAttack?.(zb, t, 45); } this.onBoss?.('swipe', zb); }
      if (zb.t > 1.1) { zb.state = 'chase'; zb.t = 0; }
    } else if (zb.state === 'slam') {
      if (!zb.hitDone && zb.t > 0.9) { zb.hitDone = true; this.onBoss?.('slam', zb, live); }
      if (zb.t > 1.5) { zb.state = 'chase'; zb.t = 0; }
    } else if (zb.state === 'throw') {
      face();
      if (!zb.ripped && zb.t > 0.5) { zb.ripped = true; this.onBoss?.('rip', zb); }
      if (!zb.hitDone && zb.t > 1.05) { zb.hitDone = true; this.onBoss?.('throw', zb, tg); }
      if (zb.t > 1.5) { zb.state = 'chase'; zb.t = 0; }
    } else {
      if (dp < 3.0) { zb.state = 'attack'; zb.t = 0; zb.hitDone = false; }
      else if (zb.slamCD <= 0 && dp < 7) { zb.state = 'slam'; zb.t = 0; zb.hitDone = false; zb.slamCD = zb.enraged ? 4.5 : 7; this.onBoss?.('windup', zb); }
      else if (zb.throwCD <= 0 && dp > 6) { zb.state = 'throw'; zb.t = 0; zb.hitDone = false; zb.ripped = false; zb.throwCD = zb.enraged ? 3.8 : 5.5; }
      else {
        const d = this.nav.dir(zb.x, zb.y + 0.2, zb.z, dirOut);
        let mx = d ? d.x : ddx / dp, mz = d ? d.z : ddz / dp;
        // walk straight through pillars and anything else not made of stone
        if (zb.smashCD <= 0) {
          const fx = zb.x + Math.sin(zb.yaw) * 1.1 * zb.scale * 0.5, fz = zb.z + Math.cos(zb.yaw) * 1.1 * zb.scale * 0.5;
          if (this.world.solidAt(fx, zb.y + 1.6, fz)) { zb.smashCD = 0.45; this.carve?.(fx, zb.y + 1.7, fz, 1.0, 3, { push: 5, samples: 60, tall: 1.6 }); this.onBoss?.('smash', zb); }
        }
        this.move(zb, mx, mz, zb.speed, dt);
        zb.x = Math.max(12.8, Math.min(35.6, zb.x)); zb.z = Math.max(34.5, Math.min(45.5, zb.z));
      }
    }
    zb.flash = Math.max(0, zb.flash - dt);
  }

  /* ------------------------------------------------------------- co-op sync */
  snapshot() {
    const r = (v) => Math.round(v * 100) / 100;
    return this.list.map((z) => [z.id, r(z.x), r(z.y), r(z.z), r(z.yaw), ST.indexOf(z.state), r(z.t), r(z.anim), z.type === 'boss' ? 1 : 0, r(z.hp / z.maxHp), z.skin, z.shirt, z.pants, r(z.scale), r(z.lean)]);
  }
  applySnapshot(arr) {
    const seen = new Set();
    for (const e of arr) {
      const [id, x, y, z, yaw, st, t, anim, boss, hpf, skin, shirt, pants, scale, lean] = e; seen.add(id);
      let zb = this.byId.get(id);
      if (!zb) zb = this.make(id, boss ? 'boss' : 'walker', x, y, z, { yaw, skin, shirt, pants, scale, lean, hp: 1 });
      zb.tx = x; zb.ty = y; zb.tz = z; zb.tyaw = yaw; zb.hpf = hpf; zb.tanim = anim;
      const s = ST[st] || 'chase'; if (s !== zb.state) { zb.state = s; zb.t = t; }
    }
    for (const zb of this.list.slice()) if (!seen.has(zb.id)) this.remove(zb);
  }
  mirror(dt) {
    const k = 1 - Math.exp(-dt * 12);
    for (const zb of this.list) {
      zb.t += dt; zb.flash = Math.max(0, zb.flash - dt);
      zb.x += (zb.tx - zb.x) * k; zb.y += (zb.ty - zb.y) * k; zb.z += (zb.tz - zb.z) * k;
      let da = zb.tyaw - zb.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); zb.yaw += da * k;
      if (zb.tanim != null) { let a = zb.tanim - zb.anim; if (Math.abs(a) > 3) zb.anim = zb.tanim; else zb.anim += a * k; }
    }
  }

  /* ------------------------------------------------------------------ draw */
  part(i, zb, by, px, py, pz, rx, ox, oy, oz, size, color) {
    // pivot (px,py,pz) in zombie space, rotate rx about X there, centre offset from the pivot, then yaw and place
    const s = zb.scale;
    _qx.setFromAxisAngle(X, rx);
    _o.set(ox * s, oy * s, oz * s).applyQuaternion(_qx);
    _p.set(px * s + _o.x, py * s + _o.y + (by - zb.y), pz * s + _o.z); _s.set(size[0] * s, size[1] * s, size[2] * s);
    zb.lm[i].compose(_p, _qx, _s);
    _q.multiplyQuaternions(_qy, _qx); _p.applyQuaternion(_qy); _p.x += zb.x; _p.y += zb.y; _p.z += zb.z;
    zb.m[i].compose(_p, _q, _s);
    this.mesh.setMatrixAt(this.n++, zb.m[i]);
    _c.setHex(MAT[color].color); if (zb.flash > 0) _c.lerp(WHITE, zb.flash * 6);
    if (zb.type === 'boss' && zb.enraged) _c.lerp(WHITE, 0.08 + Math.sin(this.frame * 0.3) * 0.04);
    this.mesh.setColorAt(this.n - 1, _c);
  }
  draw() {
    this.n = 0; let e = 0;
    for (const zb of this.list) {
      const boss = zb.type === 'boss', D = zb.dims, rise = zb.state === 'rise' ? 1 - Math.min(1, zb.t / (boss ? 2.4 : 1.2)) : 0, by = zb.y - 1.75 * zb.scale * rise * rise;
      const a = zb.anim, sw = Math.sin(a);
      const atk = zb.state === 'attack' ? Math.sin(Math.min(1, zb.t / (boss ? 0.8 : 0.5)) * Math.PI) : 0;
      const slam = zb.state === 'slam' ? (zb.t < 0.9 ? zb.t / 0.9 : Math.max(0, 1 - (zb.t - 0.9) * 3)) : 0;
      const thr = zb.state === 'throw' ? (zb.t < 1.05 ? Math.min(1, zb.t / 0.6) : Math.max(0, 1 - (zb.t - 1.05) * 4)) : 0;
      const roar = zb.state === 'roar' ? 0.5 + Math.sin(a * 3) * 0.2 : 0;
      const lean = 0.16 + zb.lean + atk * 0.3 - rise * 0.5 - slam * 0.35 + (zb.state === 'slam' && zb.t > 0.9 ? 0.6 : 0) - roar * 0.4;
      _qy.setFromAxisAngle(Y, zb.yaw);
      const bob = Math.abs(Math.cos(a)) * 0.03, L = D.leg[1], T = D.torso[1];
      this.part(0, zb, by, -D.hip, L, 0, sw * 0.7, 0, -L / 2, 0, D.leg, zb.pants);
      this.part(1, zb, by, D.hip, L, 0, -sw * 0.7, 0, -L / 2, 0, D.leg, zb.pants);
      this.part(2, zb, by + bob, 0, L - 0.02, 0, lean, 0, T / 2, 0, D.torso, zb.shirt);
      const sy = L - 0.02 + Math.cos(lean) * (T - 0.08), sz = Math.sin(lean) * (T - 0.08), ax = D.torso[0] / 2 + D.arm[0] / 2 + 0.005;
      const up = slam * 2.4 + thr * 2.2 + roar * 1.6;
      const armA = -1.45 + rise * -1.3 + atk * 1.1 + Math.sin(a * 0.5) * 0.12 - up, armB = -1.3 + rise * -1.5 + atk * 1.2 - Math.sin(a * 0.5 + 1) * 0.14 - up;
      this.part(3, zb, by + bob, -ax, sy, sz, armA, 0, -D.arm[1] / 2 + 0.01, 0, D.arm, zb.skin);
      this.part(4, zb, by + bob, ax, sy, sz, armB, 0, -D.arm[1] / 2 + 0.01, 0, D.arm, zb.skin);
      const hy = L - 0.02 + Math.cos(lean) * (T + 0.02), hz = Math.sin(lean) * (T + 0.02);
      this.part(5, zb, by + bob, 0, hy, hz, lean * 0.5 + Math.sin(a * 0.7) * 0.08, 0, D.head[1] / 2, 0.02, D.head, zb.skin);
      // eyes: one glowing strip on the face
      const s = zb.scale; _qx.setFromAxisAngle(X, lean * 0.5); _q.multiplyQuaternions(_qy, _qx);
      _o.set(0, D.head[1] * 0.62 * s, (D.head[2] / 2 + 0.03) * s).applyQuaternion(_qx); _p.set(_o.x, hy * s + _o.y, hz * s + _o.z).applyQuaternion(_qy); _p.x += zb.x; _p.y += by + bob; _p.z += zb.z;
      _s.set((boss ? 0.24 : 0.2) * s, 0.035 * s, 0.02); _m.compose(_p, _q, _s); this.eyes.setMatrixAt(e++, _m);
    }
    this.mesh.count = this.n; this.eyes.count = e;
    this.mesh.instanceMatrix.needsUpdate = true; this.eyes.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
