// The horde: blocky walkers that follow the nav distance field, claw through anything flimsy when they have
// no route, and burst into chips when they die. All of them are drawn as one instanced mesh of boxes.

import * as THREE from 'three';

const CAP = 40, PARTS = 6;
const SKIN = [0x7d9070, 0x8a9a82, 0x6f8068, 0x93a08a], SHIRT = [0x5a4a42, 0x3f4f5e, 0x6b5a3a, 0x4a3a4a, 0x6a2f2a, 0x39483a, 0x777a80], PANTS = [0x2c2f38, 0x3a3328, 0x26282c, 0x33303a];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _qx = new THREE.Quaternion(), _p = new THREE.Vector3(), _o = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), WHITE = new THREE.Color(1.6, 0.5, 0.4);
const pick = (a) => a[(Math.random() * a.length) | 0];
const dirOut = { x: 0, z: 0 };

export class Horde {
  constructor(gfx, world, nav, fx, audio) {
    this.world = world; this.nav = nav; this.fx = fx; this.audio = audio;
    this.list = [];
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), CAP * PARTS);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    this.eyes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.2, 0.4) }), CAP);
    this.eyes.frustumCulled = false; this.eyes.count = 0;
    gfx.scene.add(this.mesh, this.eyes);
    this.onKill = null; this.onHit = null; this.onLost = null; this.onAttack = null;
    this.groanT = 2;
  }
  clear() { this.list.length = 0; }

  spawn(x, z, hp, speed, floorY) {
    if (this.list.length >= CAP) return null;
    const zb = {
      x, z, y: floorY, yaw: Math.random() * 6.28, hp, maxHp: hp, speed, state: 'rise', t: 0, anim: Math.random() * 6, scale: 0.94 + Math.random() * 0.14,
      skin: pick(SKIN), shirt: pick(SHIRT), pants: pick(PANTS), flash: 0, noPath: 0, clawT: 0, stuckT: 0, lx: x, lz: z, hitDone: false, lean: Math.random() * 0.2,
    };
    this.list.push(zb);
    this.fx.dust(x, floorY + 0.1, z, 10, 3, 0.35, 1.4);
    for (let i = 0; i < 8; i++) this.fx.chip(x + (Math.random() - 0.5) * 0.6, floorY + 0.1, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 2, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 2, 3, 0.09, 2);
    return zb;
  }

  // every zombie the ray passes through before tmax, nearest first: [{ z, t, head }]
  rayHits(ox, oy, oz, dx, dy, dz, tmax) {
    const out = [];
    for (const zb of this.list) {
      if (zb.state === 'rise' && zb.t < 0.5) continue;
      const s = zb.scale, by = zb.y + (zb.state === 'rise' ? -1.7 * (1 - Math.min(1, zb.t / 1.2)) : 0);
      // head: sphere
      const hx = zb.x - ox, hy = by + 1.58 * s - oy, hz = zb.z - oz, b = hx * dx + hy * dy + hz * dz;
      let best = -1, head = false;
      if (b > 0) { const d2 = hx * hx + hy * hy + hz * hz - b * b; if (d2 < 0.045) { best = b - Math.sqrt(0.045 - d2); head = true; } }
      // body: box
      const w = 0.27, x0 = zb.x - w, x1 = zb.x + w, y0 = by, y1 = by + 1.42 * s, z0 = zb.z - w, z1 = zb.z + w;
      let t0 = 0, t1 = tmax, ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        const o = a === 0 ? ox : a === 1 ? oy : oz, d = a === 0 ? dx : a === 1 ? dy : dz, lo = a === 0 ? x0 : a === 1 ? y0 : z0, hi = a === 0 ? x1 : a === 1 ? y1 : z1;
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) ok = false; continue; }
        let ta = (lo - o) / d, tb = (hi - o) / d; if (ta > tb) { const q = ta; ta = tb; tb = q; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) ok = false;
      }
      if (ok && (best < 0 || t0 < best - 0.25)) { best = t0; head = false; }
      if (best >= 0 && best < tmax) out.push({ z: zb, t: best, head });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  // returns true if this killed it
  damage(zb, dmg, info = {}) {
    if (zb.state === 'dead') return false;
    zb.hp -= dmg; zb.flash = 0.12;
    if (zb.hp > 0) { this.onHit?.(zb, info); return false; }
    zb.state = 'dead';
    const i = this.list.indexOf(zb); if (i >= 0) this.list.splice(i, 1);
    const big = info.explosive || info.crush;
    this.fx.gore(zb.x, zb.y + 0.9, zb.z, info.dx || 0, info.dy || 0, info.dz || 0, big ? 44 : 28, [zb.shirt, zb.shirt, zb.pants, zb.skin, 0x5a1410, 0x7a1c14, 0x7a1c14]);
    this.audio.kill();
    this.onKill?.(zb, info);
    return true;
  }

  update(dt, player, round) {
    const nav = this.nav, list = this.list, px = player.x, pz = player.z, py = player.y;
    this.groanT -= dt;
    if (this.groanT <= 0 && list.length) { const zb = pick(list); this.audio.groan(Math.hypot(zb.x - px, zb.z - pz), 0.8 + Math.random() * 0.5); this.groanT = 0.5 + Math.random() * 2.2 / Math.min(4, 1 + list.length / 6); }
    for (let i = list.length - 1; i >= 0; i--) {
      const zb = list[i]; zb.t += dt; zb.flash = Math.max(0, zb.flash - dt);
      if (zb.state === 'rise') { if (zb.t > 1.25) { zb.state = 'chase'; zb.t = 0; } continue; }
      const ddx = px - zb.x, ddz = pz - zb.z, dp = Math.hypot(ddx, ddz) || 1e-3, dy = py - zb.y;
      let mx = 0, mz = 0, sp = zb.speed;
      if (zb.state === 'attack') {
        sp *= 0.25;
        if (!zb.hitDone && zb.t > 0.36) { zb.hitDone = true; if (dp < 1.4 && Math.abs(dy) < 1.9 && !player.dead) this.onAttack?.(zb); }
        if (zb.t > 0.85) { zb.state = 'chase'; zb.t = 0; }
        mx = ddx / dp; mz = ddz / dp;
      } else {
        const d = dp < 1.5 && Math.abs(dy) < 1.2 ? null : nav.dir(zb.x, zb.z, dirOut);
        if (d) { mx = d.x; mz = d.z; zb.noPath = 0; }
        else {
          mx = ddx / dp; mz = ddz / dp;
          if (dp >= 1.5 || Math.abs(dy) >= 1.2) {
            // no route: tear at whatever flimsy thing is in the way
            zb.noPath += dt; zb.clawT -= dt;
            if (zb.clawT <= 0 && zb.noPath > 0.8) { zb.clawT = 0.7; zb.anim += 2; this.fx.blast(zb.x + mx * 0.55, zb.y + 0.9, zb.z + mz * 0.55, 0.46, 0, { push: 2, samples: 20, tall: 1.6 }); }
            if (zb.noPath > 14) { this.onLost?.(zb); list.splice(i, 1); continue; }
          }
        }
        if (dp < 1.05 && Math.abs(dy) < 1.9 && !player.dead) { zb.state = 'attack'; zb.t = 0; zb.hitDone = false; }
      }
      // keep apart
      for (let j = 0; j < list.length; j++) {
        if (j === i) continue; const o = list[j], ex = zb.x - o.x, ez = zb.z - o.z, e2 = ex * ex + ez * ez;
        if (e2 < 0.36 && e2 > 1e-6) { const e = Math.sqrt(e2), k = (0.6 - e) / e * 1.6; mx += ex * k; mz += ez * k; }
      }
      // stop at arm's length; a zombie never walks into the player
      if (dp < 0.8 && Math.abs(dy) < 1.9) { const k = (0.8 - dp) / dp; mx = -ddx * k * 4 + mx * 0.05; mz = -ddz * k * 4 + mz * 0.05; }
      const nx = zb.x + mx * sp * dt, nz = zb.z + mz * sp * dt, c0 = nav.cell(zb.x, zb.z);
      const can = (x, z) => { const c = nav.cell(x, z); return c === c0 || nav.canStep(c0, c) || nav.floor[c0] < 0; };
      if (can(nx, nz)) { zb.x = nx; zb.z = nz; } else if (can(nx, zb.z)) zb.x = nx; else if (can(zb.x, nz)) zb.z = nz;
      const f = nav.floorAt(zb.x, zb.z); if (f >= 0) zb.y += (f - zb.y) * (1 - Math.exp(-14 * dt));
      const moved = Math.hypot(zb.x - zb.lx, zb.z - zb.lz);
      zb.anim += Math.min(moved, 0.2) * 3.4 / zb.scale;
      // wedged somewhere for a long time while far from the player: send it round again
      if (moved > 0.004 || dp < 2.5) zb.stuckT = 0; else { zb.stuckT += dt; if (zb.stuckT > 9) { this.onLost?.(zb); list.splice(i, 1); continue; } }
      zb.lx = zb.x; zb.lz = zb.z;
      let da = Math.atan2(mx, mz) - zb.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); zb.yaw += da * (1 - Math.exp(-9 * dt));
    }
    this.draw();
  }

  part(i, zb, by, px, py, pz, rx, ox, oy, oz, sx, sy, sz, color) {
    // pivot (px,py,pz) in zombie space, rotate rx about X there, centre offset from the pivot, then yaw and place
    const s = zb.scale;
    _qx.setFromAxisAngle(X, rx); _q.multiplyQuaternions(_qy, _qx);
    _o.set(ox * s, oy * s, oz * s).applyQuaternion(_qx); _p.set(px * s + _o.x, py * s + _o.y, pz * s + _o.z).applyQuaternion(_qy);
    _p.x += zb.x; _p.y += by; _p.z += zb.z; _s.set(sx * s, sy * s, sz * s);
    _m.compose(_p, _q, _s); this.mesh.setMatrixAt(i, _m);
    _c.setHex(color); if (zb.flash > 0) _c.lerp(WHITE, zb.flash * 6);
    this.mesh.setColorAt(i, _c);
  }
  draw() {
    let n = 0, e = 0;
    for (const zb of this.list) {
      const rise = zb.state === 'rise' ? 1 - Math.min(1, zb.t / 1.2) : 0, by = zb.y - 1.75 * rise * rise;
      const a = zb.anim, sw = Math.sin(a), atk = zb.state === 'attack' ? Math.sin(Math.min(1, zb.t / 0.5) * Math.PI) : 0;
      const lean = 0.16 + zb.lean + atk * 0.3 - rise * 0.5;
      _qy.setFromAxisAngle(Y, zb.yaw);
      const bob = Math.abs(Math.cos(a)) * 0.03;
      this.part(n++, zb, by, -0.1, 0.8, 0, sw * 0.7, 0, -0.4, 0, 0.17, 0.8, 0.19, zb.pants);
      this.part(n++, zb, by, 0.1, 0.8, 0, -sw * 0.7, 0, -0.4, 0, 0.17, 0.8, 0.19, zb.pants);
      this.part(n++, zb, by + bob, 0, 0.78, 0, lean, 0, 0.32, 0, 0.44, 0.64, 0.25, zb.shirt);
      const sy = 0.78 + Math.cos(lean) * 0.56, sz = Math.sin(lean) * 0.56;
      const armA = -1.45 + rise * -1.3 + atk * 1.1 + Math.sin(a * 0.5) * 0.12, armB = -1.3 + rise * -1.5 + atk * 1.2 - Math.sin(a * 0.5 + 1) * 0.14;
      this.part(n++, zb, by + bob, -0.29, sy, sz, armA, 0, -0.3, 0, 0.12, 0.62, 0.13, zb.skin);
      this.part(n++, zb, by + bob, 0.29, sy, sz, armB, 0, -0.3, 0, 0.12, 0.62, 0.13, zb.skin);
      const hy = 0.78 + Math.cos(lean) * 0.66, hz = Math.sin(lean) * 0.66;
      this.part(n++, zb, by + bob, 0, hy, hz, lean * 0.5 + Math.sin(a * 0.7) * 0.08, 0, 0.16, 0.02, 0.3, 0.32, 0.3, zb.skin);
      // eyes: one glowing strip on the face
      const s = zb.scale; _qx.setFromAxisAngle(X, lean * 0.5); _q.multiplyQuaternions(_qy, _qx);
      _o.set(0, 0.2 * s, 0.165 * s).applyQuaternion(_qx); _p.set(_o.x, hy * s + _o.y, hz * s + _o.z).applyQuaternion(_qy); _p.x += zb.x; _p.y += by + bob; _p.z += zb.z;
      _s.set(0.2 * s, 0.035 * s, 0.02); _m.compose(_p, _q, _s); this.eyes.setMatrixAt(e++, _m);
    }
    this.mesh.count = n; this.eyes.count = e;
    this.mesh.instanceMatrix.needsUpdate = true; this.eyes.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
