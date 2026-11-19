// First-person body: a 0.48 x 1.75 m box moved against the voxels, with step-up so rubble and the lip of a
// fresh hole do not stop you.

import { VOX } from './config.js';

const HW = 0.24, H = 1.75, EYE = 1.6, STEP = 0.5;

export class Player {
  constructor(world, map) {
    this.world = world; this.map = map;
    this.reset();
  }
  reset() {
    const s = this.map.spawn;
    this.x = s.x; this.y = this.map.floorY; this.z = s.z; this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = s.yaw; this.pitch = 0; this.onGround = true;
    this.hp = 100; this.maxHp = 100; this.hurtT = 99; this.dead = false;
    this.eyeY = this.y + EYE; this.bob = 0; this.kick = 0; this.speed = 0; this.airT = 0;
  }
  hits(x, y, z) { return this.world.boxSolid(x - HW, y, z - HW, x + HW, y + H, z + HW); }
  get eye() { return EYE; }

  damage(n) {
    if (this.dead) return;
    this.hp -= n; this.hurtT = 0;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
  }

  update(dt, inp, slow) {
    this.hurtT += dt;
    if (!this.dead && this.hurtT > 4 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 28 * dt);
    const sprint = inp.sprint && inp.moveZ < -0.3 && !slow;
    const max = this.dead ? 0 : slow ? 2.7 : sprint ? 6.7 : 4.5;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const wx = (inp.moveX * c + inp.moveZ * s) * max, wz = (-inp.moveX * s + inp.moveZ * c) * max;
    const acc = this.onGround ? 14 : 3.5, k = 1 - Math.exp(-acc * dt);
    this.vx += (wx - this.vx) * k; this.vz += (wz - this.vz) * k;
    if (this.onGround && inp.hit('Space', 'T:jump') && !this.dead) { this.vy = 6.6; this.onGround = false; }
    this.vy -= 21 * dt;

    // unstick: if something ended up inside us, rise out of it
    if (this.hits(this.x, this.y, this.z)) { for (let i = 0; i < 20 && this.hits(this.x, this.y, this.z); i++) this.y += VOX; this.vy = 0; }

    this.axis(this.vx * dt, 0); this.axis(0, this.vz * dt);
    const ny = this.y + this.vy * dt;
    if (this.hits(this.x, ny, this.z)) {
      if (this.vy < 0) { let y = Math.ceil(ny / VOX) * VOX; while (this.hits(this.x, y, this.z) && y < ny + 1) y += VOX; this.y = y; this.onGround = true; }
      this.vy = 0;
    } else { this.y = ny; this.onGround = false; }
    this.airT = this.onGround ? 0 : this.airT + dt;

    this.speed = Math.hypot(this.vx, this.vz);
    if (this.onGround) this.bob += this.speed * dt * 1.9;
    this.sprinting = sprint && this.speed > 5;
    // the camera eases over steps instead of snapping
    const ty = this.y + EYE - (this.dead ? 1.1 : 0);
    this.eyeY += (ty - this.eyeY) * (1 - Math.exp(-(ty > this.eyeY ? 16 : 26) * dt));
    if (Math.abs(ty - this.eyeY) > 1.2) this.eyeY = ty;
  }

  axis(dx, dz) {
    if (!dx && !dz) return;
    const nx = this.x + dx, nz = this.z + dz;
    if (!this.hits(nx, this.y, nz)) { this.x = nx; this.z = nz; return; }
    if (this.onGround || this.vy < 1) {
      for (let up = VOX; up <= STEP + 1e-6; up += VOX) {
        if (!this.hits(nx, this.y + up, nz) && !this.hits(this.x, this.y + up, this.z)) { this.x = nx; this.z = nz; this.y += up; return; }
      }
    }
    if (dx) this.vx = 0; else this.vz = 0;
  }
}
