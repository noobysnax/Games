// The other players in a co-op game: a soldier with their gun, a name tag, and their Matter Destroyer beam.

import * as THREE from 'three';
import { gunModel, labelSprite, soldierModel } from './models.js';

export const COLORS = [0xe2b530, 0x60c8ff, 0xff7050, 0x80e070, 0xc080ff, 0xffffff];
const _v = new THREE.Vector3();

export class Remotes {
  constructor(gfx) { this.gfx = gfx; this.map = new Map(); }
  get list() { return [...this.map.values()]; }

  set(id, s) {
    let r = this.map.get(id);
    if (!r) {
      const color = COLORS[(s.c ?? 0) % COLORS.length], model = soldierModel(color), tag = labelSprite(s.name || 'Player', '', '#' + color.toString(16).padStart(6, '0'));
      tag.scale.set(0.9, 0.28, 1); tag.position.y = 2.15; model.add(tag);
      const beam = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3)),
        new THREE.LineBasicMaterial({ color: new THREE.Color(4, 2, 8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      beam.frustumCulled = false; beam.visible = false;
      this.gfx.scene.add(model, beam);
      r = { id, model, tag, beam, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0, walk: 0, gun: null, w: null, up: false, name: s.name, hp: 100, mhp: 100, dead: false, c: s.c };
      this.map.set(id, r);
    }
    Object.assign(r, { tx: s.x, ty: s.y, tz: s.z, tyaw: s.yaw, pitch: s.pitch, hp: s.hp, mhp: s.mhp, dead: s.dead, name: s.name, beamT: s.beam, b: s.b, zone: s.zone });
    if (r.name !== r.shownName) { r.shownName = r.name; r.tag.userData.set(r.name, ''); }
    if (s.w !== r.w || s.up !== r.up) {
      if (r.gun) r.model.userData.armR.remove(r.gun);
      r.w = s.w; r.up = s.up; r.gun = gunModel(s.w || 'rook', s.up); r.gun.position.set(0, -0.56, -0.08); r.gun.rotation.x = Math.PI / 2;
      r.model.userData.armR.add(r.gun);
    }
    return r;
  }
  remove(id) { const r = this.map.get(id); if (!r) return; this.gfx.scene.remove(r.model, r.beam); this.map.delete(id); }
  clear() { for (const id of [...this.map.keys()]) this.remove(id); }

  update(dt) {
    const k = 1 - Math.exp(-dt * 14);
    for (const r of this.map.values()) {
      const ox = r.x, oz = r.z;
      r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k;
      let da = r.tyaw - r.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); r.yaw += da * k;
      const sp = Math.hypot(r.x - ox, r.z - oz) / Math.max(dt, 1e-3); r.walk += sp * dt * 2.2;
      const m = r.model, u = m.userData, sw = Math.sin(r.walk) * Math.min(1, sp / 3) * 0.7;
      m.position.set(r.x, r.y, r.z); m.rotation.y = r.yaw;
      u.legL.rotation.x = sw; u.legR.rotation.x = -sw;
      u.armR.rotation.x = -Math.PI / 2 + r.pitch; u.armL.rotation.x = -Math.PI / 2.4 + r.pitch; u.armL.rotation.z = -0.4;
      u.head.rotation.x = r.pitch * 0.7;
      // down: lie on the floor until the next round
      m.rotation.x = r.dead ? -Math.PI / 2 : 0; m.position.y = r.dead ? r.y + 0.25 : r.y;
      // beam: 0 none, 1 disintegrate, 2 tether
      r.beam.visible = !!r.beamT && !r.dead && !!r.b;
      if (r.beam.visible) {
        const p = r.beam.geometry.attributes.position.array, n = 16;
        _v.set(0.3, 1.38, -0.62).applyAxisAngle(THREE.Object3D.DEFAULT_UP, r.yaw).add(m.position);
        const j = r.beamT === 1 ? 0.07 : 0.02;
        for (let i = 0; i < n; i++) { const t = i / (n - 1), sag = r.beamT === 2 ? Math.sin(t * Math.PI) * 0.3 : 0; p[i * 3] = _v.x + (r.b[0] - _v.x) * t + (Math.random() - 0.5) * j; p[i * 3 + 1] = _v.y + (r.b[1] - _v.y) * t - sag + (Math.random() - 0.5) * j; p[i * 3 + 2] = _v.z + (r.b[2] - _v.z) * t + (Math.random() - 0.5) * j; }
        r.beam.geometry.attributes.position.needsUpdate = true;
        r.beam.material.color.setRGB(r.beamT === 1 ? 4 : 1.2, r.beamT === 1 ? 1.8 : 4, r.beamT === 1 ? 8 : 6);
      }
    }
  }
}
