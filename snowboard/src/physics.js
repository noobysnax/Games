// Rider physics: fixed-step, renderer-independent. The board is a point on a C2-smooth surface with
// an edge-grip model (velocity is steered toward the board's heading without losing speed; skidding scrubs it),
// ballistic air with three rotation axes, rail grinds, and trick scoring.
// No DOM, no three.js.

import { clamp, lerp, damp, wrapPi, TAU } from './util.js';
import { SURF, FINISH, centerX } from './course.js';

export const STEP = 1 / 120;

export const TUNE = {
  G: 12,
  // ground
  turnMax: 2.5,        // rad/s board yaw rate at low speed
  latMax: 15.5,        // m/s^2 lateral acceleration the rider will ask for at speed
  steerRate: 15,       // 1/s smoothing of steering input
  gripAcc: 24,         // m/s^2 edge hold before the board washes out
  skidMu: 0.6,         // scrub when the board is sideways to travel
  drag: 0.0078,        // 1/m air drag
  tuckDrag: 0.6,
  pushAcc: 3.4, pushMax: 5.5,
  brakeBase: 5.5, brakeLin: 0.22,
  stickK: 1.9,         // >1 keeps the board glued over small rolls; kickers still launch
  stickGap: 0.06,
  // jump
  jumpMin: 3.2, jumpMax: 5.5, chargeTime: 0.5, coyote: 0.13,
  // air
  spinMax: 7.6, flipMax: 5.9, rollMax: 6.4, rotAccel: 9, rotSettle: 7, magnet: 6, airDrag: 0.0012,
  crashTilt: 1.0, hardImpact: 19, crashSpeed: 8,
  // boost
  boostAcc: 9.5, boostVmax: 31, boostDrain: 0.3, boostRegen: 0.035,
  // rails
  railMu: 0.035, railDrag: 0.004, railSpin: 5.2,
  crashTime: 1.25,
};

export const GRABS = [null, 'Indy', 'Mute', 'Melon', 'Stalefish', 'Nose Grab', 'Tail Grab', 'Method', 'Japan'];

const SURFACE = [
  /* PISTE  */ { mu: 0.034, grip: 10.5, drag: 0 },
  /* POWDER */ { mu: 0.07, grip: 7, drag: 0.0035 },
  /* PARK   */ { mu: 0.03, grip: 10.5, drag: 0 },
  /* ICE    */ { mu: 0.008, grip: 2, drag: 0 },
  /* ROCK   */ { mu: 0.5, grip: 9, drag: 0 },
];

const S = { h: 0, gx: 0, gz: 0 };

function basisQuat(fx, fy, fz, nx, ny, nz, q) {
  // columns: right = f x n, up = n, back = -f
  const rx = fy * nz - fz * ny, ry = fz * nx - fx * nz, rz = fx * ny - fy * nx;
  const m00 = rx, m10 = ry, m20 = rz, m01 = nx, m11 = ny, m21 = nz, m02 = -fx, m12 = -fy, m22 = -fz;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q.w = s / 4; q.x = (m21 - m12) / s; q.y = (m02 - m20) / s; q.z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q.w = (m21 - m12) / s; q.x = s / 4; q.y = (m01 + m10) / s; q.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q.w = (m02 - m20) / s; q.x = (m01 + m10) / s; q.y = s / 4; q.z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q.w = (m10 - m01) / s; q.x = (m02 + m20) / s; q.y = (m12 + m21) / s; q.z = s / 4;
  }
  return q;
}
function qMulAxis(q, axis, ang) {
  // q = q * R(axis, ang), axis 0=x 1=y 2=z
  const h = ang * 0.5, s = Math.sin(h), c = Math.cos(h);
  const { x, y, z, w } = q;
  if (axis === 0) { q.x = x * c + w * s; q.y = y * c + z * s; q.z = z * c - y * s; q.w = w * c - x * s; }
  else if (axis === 1) { q.x = x * c - z * s; q.y = y * c + w * s; q.z = z * c + x * s; q.w = w * c - y * s; }
  else { q.x = x * c + y * s; q.y = y * c - x * s; q.z = z * c + w * s; q.w = w * c - z * s; }
  return q;
}

export class Rider {
  constructor(course) {
    this.course = course;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.n = { x: 0, y: 1, z: 0 };
    this.quat = { x: 0, y: 0, z: 0, w: 1 };
    this.events = [];
    this.best = 0;
    this.reset(3);
  }

  reset(d = 3) {
    const sp = this.course.spawn(d);
    Object.assign(this.pos, sp);
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.mode = 'ground';
    this.yaw = 0; this.sw = 1; this.steerSm = 0;
    this.holding = d < 12;
    this.charge = 0; this.jumpHeld = false; this.coyote = 0;
    this.frameYaw = 0; this.spin = 0; this.flip = 0; this.roll = 0;
    this.wSpin = 0; this.wFlip = 0; this.wRoll = 0;
    this.spin0 = 0; this.flip0 = 0; this.roll0 = 0; this.flipT = 0; this.rollT = 0;
    this.airTime = 0; this.grab = 0; this.grabT = 0; this.grabs = []; this.swTake = 1;
    this.spinLock = 0; this.flipLock = 0;
    this.rail = null; this.railSeg = 0; this.railS = 0; this.railDir = 1; this.railSpeed = 0;
    this.railYaw = 0; this.railTime = 0; this.railCool = 0; this.railQ = 0; this.railPts = 0; this.railSwaps = 0;
    this.crashT = 0; this.crashSpin = 0; this.landT = 0;
    this.boost = 0.6; this.boosting = false;
    this.score = 0; this.flow = 1; this.combo = [];
    this.runTime = 0; this.started = false; this.finished = false; this.finishTime = 0;
    // outputs for visuals/audio
    this.speed = 0; this.turnRate = 0; this.lean = 0; this.carve = 0; this.skid = 0; this.tuck = 0;
    this.compress = 0; this.brake = 0; this.surf = 0; this.prevTravelYaw = 0; this.height = 0;
    this.events.length = 0;
    this.updateQuat();
  }

  emit(type, data) { this.events.push(Object.assign({ type }, data)); }

  /** Advance one fixed step. inp: { steer, pitch, roll, jump, boost, brake, grab } */
  step(inp, dt = STEP) {
    this.railCool = Math.max(0, this.railCool - dt);
    this.landT = Math.max(0, this.landT - dt);
    this.compress = damp(this.compress, 0, 7, dt);
    if (this.started && !this.finished) this.runTime += dt;
    const wasBoost = this.boosting;
    this.boosting = false;
    if (this.mode === 'ground') this.stepGround(inp, dt);
    else if (this.mode === 'air') this.stepAir(inp, dt);
    else if (this.mode === 'rail') this.stepRail(inp, dt);
    else this.stepCrash(inp, dt);
    if (this.boosting && !wasBoost) this.emit('boost');
    if (!this.boosting) this.boost = Math.min(1, this.boost + TUNE.boostRegen * dt);
    this.jumpHeld = !!inp.jump;
    this.collide();
    const d = -this.pos.z;
    if (!this.finished && d > FINISH && this.started) {
      this.finished = true; this.finishTime = this.runTime;
      if (this.mode === 'ground') this.bank('clean');
      const isBest = this.score > this.best;
      if (isBest) this.best = this.score;
      this.emit('finish', { time: this.runTime, score: this.score, best: this.best, isBest });
    }
    this.speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    this.updateQuat();
  }

  /* ------------------------------------------------------------ ground */
  stepGround(inp, dt) {
    const T = TUNE, p = this.pos, v = this.vel, c = this.course;
    c.sample(p.x, p.z, S);
    let il = 1 / Math.hypot(S.gx, 1, S.gz);
    let nx = -S.gx * il, ny = il, nz = -S.gz * il;
    const surfId = c.surfaceAt(p.x, p.z), sf = SURFACE[surfId];
    this.surf = surfId;

    const fwd = inp.pitch < -0.3, brake = clamp(Math.max(inp.brake || 0, inp.pitch > 0.25 ? inp.pitch : 0), 0, 1);
    this.n.x = nx; this.n.y = ny; this.n.z = nz;
    if (this.holding) {
      if (fwd || inp.boost || inp.jump || Math.abs(inp.steer) > 0.5) { this.holding = false; }
      else { v.x = v.y = v.z = 0; this.steerSm = 0; this.tuck = damp(this.tuck, 0, 8, dt); return; }
    }

    // keep velocity in the surface
    let vn = v.x * nx + v.y * ny + v.z * nz;
    v.x -= nx * vn; v.y -= ny * vn; v.z -= nz * vn;
    let s = Math.hypot(v.x, v.y, v.z);

    // steering
    const charging = !!inp.jump;
    this.steerSm = damp(this.steerSm, inp.steer, T.steerRate, dt);
    const wmax = Math.min(T.turnMax, T.latMax / Math.max(s, 2.5)) * (charging ? 0.8 : 1);
    this.yaw -= this.steerSm * wmax * dt;

    // board axes in the surface
    let f0x = -Math.sin(this.yaw), f0z = -Math.cos(this.yaw);
    let k = f0x * nx + f0z * nz;
    let fx = f0x - nx * k, fy = -ny * k, fz = f0z - nz * k;
    il = 1 / Math.hypot(fx, fy, fz); fx *= il; fy *= il; fz *= il;
    if (s > 1 && (v.x * fx + v.y * fy + v.z * fz) * this.sw < -0.25 * s) this.sw = -this.sw;
    const ex = fx * this.sw, ey = fy * this.sw, ez = fz * this.sw;
    const lx = ny * ez - nz * ey, ly = nz * ex - nx * ez, lz = nx * ey - ny * ex; // left of travel

    let skid = 0;
    if (s > 0.05) {
      const uf = (v.x * ex + v.y * ey + v.z * ez) / s, ul = (v.x * lx + v.y * ly + v.z * lz) / s;
      const alpha = Math.atan2(ul, uf);
      // heading relaxes toward travel when hands-off, and hard just after landing
      const kh = this.landT > 0 ? 11 : Math.abs(inp.steer) < 0.1 ? 1.3 : 0;
      const dyaw = alpha * (1 - Math.exp(-kh * dt));
      this.yaw += dyaw;
      // edge grip turns travel toward the board without costing speed
      const grip = sf.grip * (this.landT > 0 ? 0.35 : 1);
      let a2 = dyaw + (alpha - dyaw) * Math.exp(-grip * dt);
      const maxd = (T.gripAcc * dt) / Math.max(s, 1);
      a2 = alpha + clamp(a2 - alpha, -maxd, maxd);
      skid = Math.abs(Math.sin(a2 - dyaw));
      s = Math.max(0, s - T.skidMu * T.G * ny * skid * dt);
      const ca = Math.cos(a2), sa = Math.sin(a2);
      v.x = (ex * ca + lx * sa) * s; v.y = (ey * ca + ly * sa) * s; v.z = (ez * ca + lz * sa) * s;
    }

    // gravity along the slope: the board runs freely along its length, the edge holds against the rest
    // (so a board set across the hill stays put, and only sideslips when it is steep)
    const gtx = T.G * ny * nx, gty = -T.G + T.G * ny * ny, gtz = T.G * ny * nz;
    const ga = gtx * ex + gty * ey + gtz * ez, gl = gtx * lx + gty * ly + gtz * lz;
    const hold = T.skidMu * T.G * ny * (sf.grip > 5 ? 0.9 : 0.15);
    const gs = Math.sign(gl) * Math.max(0, Math.abs(gl) - hold);
    v.x += (ex * ga + lx * gs) * dt; v.y += (ey * ga + ly * gs) * dt; v.z += (ez * ga + lz * gs) * dt;
    s = Math.hypot(v.x, v.y, v.z);

    // resistances
    this.tuck = damp(this.tuck, fwd || charging || inp.boost ? 1 : 0, 9, dt);
    const dragMul = lerp(1, T.tuckDrag, this.tuck) * (1 + brake * 0.4);
    let dec = sf.mu * T.G * ny + (T.drag * dragMul + sf.drag) * s * s + brake * (T.brakeBase + T.brakeLin * s);
    if (this.finished) dec += 2.2 + 0.1 * s;
    if (s > 1e-4) {
      const s2 = Math.max(0, s - dec * dt);
      v.x *= s2 / s; v.y *= s2 / s; v.z *= s2 / s; s = s2;
    }
    // thrust: push off when slow, boost when asked
    let thr = 0;
    if (fwd && s < T.pushMax && !this.finished) thr += T.pushAcc * (1 - s / T.pushMax);
    if (inp.boost && this.boost > 0.02) {
      this.boosting = true;
      this.boost = Math.max(0, this.boost - T.boostDrain * dt);
      thr += T.boostAcc * clamp((T.boostVmax - s) / 6, 0, 1);
    }
    if (thr > 0) { v.x += ex * thr * dt; v.y += ey * thr * dt; v.z += ez * thr * dt; }
    if (s < 0.25 && thr === 0 && Math.hypot(S.gx, S.gz) < sf.mu + 0.05) { v.x = v.y = v.z = 0; }
    if (!this.started && (s > 1.5 || -p.z > 12)) this.started = true;

    // jump
    if (charging) this.charge = Math.min(1, this.charge + dt / T.chargeTime);
    const released = this.jumpHeld && !inp.jump;
    this.brake = brake; this.skid = clamp(skid * clamp(s / 6, 0, 1) + brake * clamp(s / 4, 0, 1), 0, 1);
    this.n.x = nx; this.n.y = ny; this.n.z = nz;
    if (released) {
      this.jumpOff(nx, ny, nz);
      this.takeoff(inp, true);
      this.integrateAir(dt);
      return;
    }
    if (!charging) this.charge = 0;

    // move, then resolve against the surface
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    c.sample(p.x, p.z, S);
    il = 1 / Math.hypot(S.gx, 1, S.gz);
    nx = -S.gx * il; ny = il; nz = -S.gz * il;
    const gap = p.y - S.h;
    vn = v.x * nx + v.y * ny + v.z * nz;
    if (gap <= 0) {
      p.y = S.h;
      if (vn < 0) { v.x -= nx * vn; v.y -= ny * vn; v.z -= nz * vn; }
    } else if (vn <= T.stickK * T.G * ny * dt + 0.015 && gap < T.stickGap) {
      p.y = S.h;
      v.x -= nx * vn; v.y -= ny * vn; v.z -= nz * vn;
    } else {
      this.takeoff(inp, false);
      return;
    }
    this.n.x = nx; this.n.y = ny; this.n.z = nz;
    this.height = 0;

    // visual/audio outputs
    const ty = s > 1 ? Math.atan2(-v.x, -v.z) : this.prevTravelYaw;
    const w = wrapPi(ty - this.prevTravelYaw) / dt;
    this.prevTravelYaw = ty;
    this.turnRate = damp(this.turnRate, clamp(w, -4, 4), 10, dt);
    this.lean = clamp(Math.atan((s * this.turnRate) / T.G) * 0.95, -0.9, 0.9);
    this.carve = clamp((Math.abs(s * this.turnRate) / 13) * clamp(s / 5, 0, 1), 0, 1);

    if (this.tryRail()) return;
  }

  jumpOff(nx, ny, nz) {
    const T = TUNE, v = this.vel;
    const J = lerp(T.jumpMin, T.jumpMax, this.charge);
    let jx = nx * 0.55, jy = ny * 0.55 + 0.45, jz = nz * 0.55;
    const il = 1 / Math.hypot(jx, jy, jz);
    v.x += jx * il * J; v.y += jy * il * J; v.z += jz * il * J;
    this.emit('jump', { power: this.charge });
  }

  takeoff(inp, jumped) {
    const v = this.vel, n = this.n;
    const hs = Math.hypot(v.x, v.z);
    this.frameYaw = hs > 0.5 ? Math.atan2(-v.x, -v.z) : this.yaw + (this.sw < 0 ? Math.PI : 0);
    const sy = Math.sin(this.frameYaw), cy = Math.cos(this.frameYaw);
    this.spin = wrapPi(this.yaw - this.frameYaw);
    this.flip = Math.asin(clamp(n.x * sy + n.z * cy, -1, 1));
    this.roll = -Math.asin(clamp(n.x * cy - n.z * sy, -1, 1));
    this.spin0 = Math.round(this.spin / Math.PI) * Math.PI; this.flip0 = this.flip; this.roll0 = this.roll;
    this.flipT = this.flip; this.rollT = 0;
    const wind = jumped ? 0.35 + 0.45 * this.charge : this.jumpHeld || inp.jump ? 0.5 * this.charge : 0;
    this.wSpin = -this.steerSm * TUNE.spinMax * wind;
    const pitch = inp.pitch || 0;
    this.wFlip = pitch > 0 ? pitch * TUNE.flipMax * wind * 0.8 : 0;
    this.wRoll = 0;
    this.swTake = Math.abs(this.spin) > Math.PI / 2 ? -1 : 1;
    // riding off an edge with the stick already held (carving, tucking, braking) must not start a trick by accident:
    // the stick has to come back to centre first. A deliberate pop keeps a spin or back-flip wind-up, but forward
    // is the tuck, so it never turns into a front flip unless it is pressed again in the air.
    this.spinLock = !jumped && Math.abs(inp.steer) > 0.3 ? Math.sign(inp.steer) : 0;
    this.flipLock = pitch < -0.3 ? -1 : !jumped && pitch > 0.3 ? 1 : 0;
    this.mode = 'air'; this.airTime = 0; this.grab = 0; this.grabT = 0; this.grabs = [];
    this.coyote = jumped ? 0 : TUNE.coyote;
    this.charge = jumped ? 0 : this.charge;
    this.carve = 0; this.skid = 0; this.lean = 0; this.turnRate = 0;
  }

  /* ------------------------------------------------------------ air */
  stepAir(inp, dt) {
    const T = TUNE;
    this.airTime += dt;
    // late pop just after riding off an edge
    if (this.coyote > 0) {
      this.coyote -= dt;
      if (inp.jump) this.charge = Math.min(1, this.charge + dt / T.chargeTime);
      if (this.jumpHeld && !inp.jump) { this.jumpOff(0, 1, 0); this.coyote = 0; this.charge = 0; }
    } else if (!inp.jump) this.charge = 0;
    else this.charge = Math.min(1, this.charge + dt / T.chargeTime); // pre-load for the landing

    // rotation: stick drives angular velocity, hands-off settles to the nearest landable angle
    if (this.spinLock && (inp.steer * this.spinLock < 0.3 || this.airTime > 0.4)) this.spinLock = 0;
    if (this.flipLock && inp.pitch * this.flipLock < 0.3) this.flipLock = 0;
    const spinIn = this.spinLock ? 0 : -inp.steer, flipIn = this.flipLock ? 0 : inp.pitch, rollIn = -(inp.roll || 0);
    const settle = (ang, w, target) => damp(w, clamp((target - ang) * T.magnet, -4.2, 4.2), T.rotSettle, dt);
    if (Math.abs(spinIn) > 0.15) this.wSpin = damp(this.wSpin, spinIn * T.spinMax, T.rotAccel, dt);
    else this.wSpin = settle(this.spin, this.wSpin, Math.round(this.spin / Math.PI + clamp(this.wSpin, -1, 1) * 0.22) * Math.PI);
    if (Math.abs(flipIn) > 0.2) this.wFlip = damp(this.wFlip, flipIn * T.flipMax, T.rotAccel, dt);
    else this.wFlip = settle(this.flip, this.wFlip, Math.round((this.flip - this.flipT) / TAU + clamp(this.wFlip, -1, 1) * 0.16) * TAU + this.flipT);
    if (Math.abs(rollIn) > 0.2) this.wRoll = damp(this.wRoll, rollIn * T.rollMax, T.rotAccel, dt);
    else this.wRoll = settle(this.roll, this.wRoll, Math.round((this.roll - this.rollT) / TAU + clamp(this.wRoll, -1, 1) * 0.16) * TAU + this.rollT);
    this.spin += this.wSpin * dt; this.flip += this.wFlip * dt; this.roll += this.wRoll * dt;

    // grabs
    const g = this.airTime > 0.1 ? inp.grab | 0 : 0;
    if (g !== this.grab) {
      this.grab = g; this.grabT = 0;
      if (g) this.grabs.push({ id: g, t: 0 });
    } else if (g) {
      this.grabT += dt;
      this.grabs[this.grabs.length - 1].t = this.grabT;
    }
    this.tuck = damp(this.tuck, g ? 1 : 0.25, 8, dt);
    this.integrateAir(dt);
  }

  integrateAir(dt) {
    const T = TUNE, p = this.pos, v = this.vel, c = this.course;
    v.y -= T.G * dt;
    const sp = Math.hypot(v.x, v.y, v.z), k = 1 - T.airDrag * sp * dt;
    v.x *= k; v.y *= k; v.z *= k;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    // landing pitch/bank to settle toward: the snow a little ahead
    c.sample(p.x + v.x * 0.2, p.z + v.z * 0.2, S);
    const il = 1 / Math.hypot(S.gx, 1, S.gz), sy = Math.sin(this.frameYaw), cy = Math.cos(this.frameYaw);
    this.flipT = Math.asin(clamp((-S.gx * sy - S.gz * cy) * il, -1, 1));
    this.rollT = -Math.asin(clamp((-S.gx * cy + S.gz * sy) * il, -1, 1));
    if (this.tryRail()) return;
    c.sample(p.x, p.z, S);
    this.height = p.y - S.h;
    if (p.y <= S.h) this.land();
  }

  land() {
    const T = TUNE, p = this.pos, v = this.vel;
    p.y = S.h;
    const il = 1 / Math.hypot(S.gx, 1, S.gz), nx = -S.gx * il, ny = il, nz = -S.gz * il;
    this.n.x = nx; this.n.y = ny; this.n.z = nz;
    // how far the board is from flat on the snow, and from pointing along travel
    const sr = Math.sin(this.roll), cr = Math.cos(this.roll), sf = Math.sin(this.flip), cf = Math.cos(this.flip);
    const ux = -sr * cf, uy = cr * cf, uz = sf, sy = Math.sin(this.frameYaw), cy = Math.cos(this.frameYaw);
    const wx = ux * cy + uz * sy, wz = -ux * sy + uz * cy;
    const tilt = Math.acos(clamp(wx * nx + uy * ny + wz * nz, -1, 1));
    const hs = Math.hypot(v.x, v.z);
    const travel = hs > 0.5 ? Math.atan2(-v.x, -v.z) : this.frameYaw;
    const e = Math.abs(wrapPi(this.frameYaw + this.spin - travel));
    const spinErr = Math.min(e, Math.PI - e);
    const vn = v.x * nx + v.y * ny + v.z * nz, impact = Math.max(0, -vn);
    if (vn < 0) { v.x -= nx * vn; v.y -= ny * vn; v.z -= nz * vn; }
    const item = this.airItem();
    if (tilt > T.crashTilt || impact > T.hardImpact * 1.7) {
      this.emit('land', { impact, quality: 'crash' });
      this.crash('Bail');
      return;
    }
    let quality = 'clean';
    if (spinErr > 0.85 || tilt > 0.72 || impact > T.hardImpact) quality = 'sketchy';
    else if (spinErr < 0.3 && tilt < 0.32 && this.airTime > 0.5) quality = 'perfect';
    const keep = (quality === 'sketchy' ? 0.62 : 1) * (1 - clamp((impact - 8) * 0.006, 0, 0.1));
    v.x *= keep; v.y *= keep; v.z *= keep;
    this.yaw = this.frameYaw + this.spin;
    this.mode = 'ground'; this.landT = 0.3; this.grab = 0;
    this.prevTravelYaw = travel; this.steerSm *= 0.4;
    this.compress = clamp(impact / 13, 0.15, 1);
    this.height = 0;
    if (item) this.combo.push(item);
    this.emit('land', { impact, quality, air: this.airTime });
    this.bank(quality);
  }

  /** Summarise the current air as a trick item (or null when nothing happened). */
  airItem(live = false) {
    const rnd = live ? (x) => Math.floor(x + 0.2) : Math.round;
    const dS = this.spin - this.spin0, dF = this.flip - this.flip0, dR = this.roll - this.roll0;
    const half = rnd(Math.abs(dS) / Math.PI), flips = rnd(Math.abs(dF) / TAU), rolls = rnd(Math.abs(dR) / TAU);
    const parts = [];
    let pts = 0;
    const count = ['', 'Double ', 'Triple ', 'Quad '];
    if (flips > 0) { parts.push((count[Math.min(flips, 4) - 1]) + (dF > 0 ? 'Backflip' : 'Frontflip')); pts += 400 * flips + 100 * flips * flips; }
    if (rolls > 0) { parts.push((count[Math.min(rolls, 4) - 1]) + 'Barrel Roll'); pts += 350 * rolls + 100 * rolls * rolls; }
    if (half > 0) {
      const front = (dS > 0) === (this.swTake > 0);
      parts.push((this.swTake < 0 ? 'Switch ' : '') + (front ? 'FS ' : 'BS ') + half * 180);
      pts += 50 * half * (half + 1);
    }
    const seen = new Set();
    for (const g of this.grabs) {
      if (g.t < 0.18 || seen.has(g.id)) continue;
      seen.add(g.id);
      parts.push(GRABS[g.id]);
      pts += 120 + 260 * Math.min(g.t, 1.5);
    }
    if ((flips > 0 || rolls > 0) && half > 0) pts *= 1.3;
    if (this.airTime > 0.6) pts += 30 * this.airTime * this.airTime;
    if (!parts.length) {
      if (this.airTime < 0.85) return null;
      parts.push('Air');
    }
    return { name: parts.join(' + '), points: Math.round(pts) };
  }

  bank(quality) {
    if (!this.combo.length) return;
    let total = 0;
    for (const it of this.combo) total += it.points;
    const mult = 1 + 0.5 * (this.combo.length - 1);
    const q = quality === 'perfect' ? 1.25 : quality === 'sketchy' ? 0.5 : 1;
    const pts = Math.round((total * mult * q * this.flow) / 10) * 10;
    this.score += pts;
    this.boost = Math.min(1, this.boost + pts / 3500 + (quality === 'perfect' ? 0.08 : 0));
    this.emit('score', { points: pts, names: this.combo.map((c) => c.name), quality, mult, flow: this.flow });
    this.flow = clamp(this.flow + (quality === 'sketchy' ? -0.2 : pts >= 100 ? 0.15 : 0), 1, 3);
    this.combo = [];
  }

  crash(reason) {
    this.mode = 'crash'; this.crashT = 0; this.combo = []; this.flow = 1; this.grab = 0; this.charge = 0;
    this.rail = null; this.boosting = false;
    this.emit('crash', { reason });
  }

  /* ------------------------------------------------------------ rails */
  tryRail() {
    if (this.railCool > 0) return false;
    const p = this.pos, v = this.vel, grounded = this.mode === 'ground';
    for (const rail of this.course.rails) {
      if (p.z > rail.zMax + 1 || p.z < rail.zMin - 1 || Math.abs(p.x - rail.pts[0].x) > 2.5) continue;
      for (let i = 0; i < rail.segs.length; i++) {
        const sg = rail.segs[i], a = sg.a;
        const hl = Math.hypot(sg.dx, sg.dz), hx = sg.dx / hl, hz = sg.dz / hl;
        const wx = p.x - a.x, wz = p.z - a.z;
        const along = (wx * hx + wz * hz) / (sg.len * hl);
        if (along < -0.02 || along > 1) continue;
        const lat = Math.abs(wx * hz - wz * hx);
        const dy = p.y - (a.y + (sg.b.y - a.y) * along);
        const cap = rail.capture + (grounded ? 0.35 : 0);
        if (lat > cap || dy > 0.4 || dy < -0.32) continue;
        const va = v.x * sg.dx + v.y * sg.dy + v.z * sg.dz;
        if (Math.abs(va) < 3 || (!grounded && v.y > 3)) continue;
        // lock on
        const boardYaw = grounded ? this.yaw : this.frameYaw + this.spin;
        if (!grounded) { const it = this.airItem(); if (it) this.combo.push(it); }
        this.mode = 'rail'; this.rail = rail; this.railSeg = i; this.railS = along * sg.len;
        this.railDir = va > 0 ? 1 : -1;
        this.railSpeed = Math.max(Math.abs(va), Math.hypot(v.x, v.y, v.z) * 0.92);
        const travelYaw = Math.atan2(-sg.dx * this.railDir, -sg.dz * this.railDir);
        this.railYaw = wrapPi(boardYaw - travelYaw);
        this.railQ = Math.round(this.railYaw / (Math.PI / 2));
        this.railTime = 0; this.railPts = 0; this.railSwaps = 0; this.charge = 0; this.grab = 0;
        this.lean = 0; this.carve = 0; this.skid = 0; this.height = 0;
        this.emit('railStart', { name: rail.name, kind: rail.kind });
        return true;
      }
    }
    return false;
  }

  railName() {
    const side = Math.abs(this.railQ) % 2 === 1;
    return (side ? 'Boardslide' : '50-50') + (this.railSwaps > 0 ? ' +' + this.railSwaps + ' swap' + (this.railSwaps > 1 ? 's' : '') : '');
  }

  stepRail(inp, dt) {
    const T = TUNE, rail = this.rail;
    let sg = rail.segs[this.railSeg];
    const sgn = this.railDir;
    this.railSpeed += (-T.G * sg.dy * sgn - T.railMu * T.G - T.railDrag * this.railSpeed * this.railSpeed) * dt;
    this.railS += sgn * this.railSpeed * dt;
    let ended = this.railSpeed < 1.2;
    while (!ended && this.railS > sg.len) {
      if (this.railSeg < rail.segs.length - 1) { this.railS -= sg.len; sg = rail.segs[++this.railSeg]; } else ended = true;
    }
    while (!ended && this.railS < 0) {
      if (this.railSeg > 0) { sg = rail.segs[--this.railSeg]; this.railS += sg.len; } else ended = true;
    }
    const sl = clamp(this.railS, 0, sg.len);
    this.pos.x = sg.a.x + sg.dx * sl; this.pos.y = sg.a.y + sg.dy * sl + 0.02; this.pos.z = sg.a.z + sg.dz * sl;
    this.vel.x = sg.dx * sgn * this.railSpeed; this.vel.y = sg.dy * sgn * this.railSpeed; this.vel.z = sg.dz * sgn * this.railSpeed;

    // spin the board on the rail; hands-off it settles square or sideways
    this.steerSm = damp(this.steerSm, inp.steer, T.steerRate, dt);
    if (Math.abs(inp.steer) > 0.15) this.railYaw -= inp.steer * T.railSpin * dt;
    else this.railYaw = damp(this.railYaw, Math.round(this.railYaw / (Math.PI / 2)) * (Math.PI / 2), 9, dt);
    const q = Math.round(this.railYaw / (Math.PI / 2));
    if (q !== this.railQ) { this.railQ = q; this.railSwaps++; this.railPts += 120; }
    this.railTime += dt;
    this.railPts += (Math.abs(q) % 2 === 1 ? 300 : 190) * dt;
    this.tuck = damp(this.tuck, inp.jump ? 1 : 0.3, 9, dt);

    if (inp.jump) this.charge = Math.min(1, this.charge + dt / T.chargeTime);
    const released = this.jumpHeld && !inp.jump;
    if (released || ended) this.leaveRail(inp, released);
  }

  leaveRail(inp, jumped) {
    const rail = this.rail, sg = rail.segs[this.railSeg], v = this.vel, sgn = this.railDir;
    this.combo.push({ name: this.railName() + ' · ' + rail.name, points: Math.round(60 + this.railPts) });
    this.emit('railEnd', { name: rail.name, time: this.railTime });
    this.frameYaw = Math.atan2(-sg.dx * sgn, -sg.dz * sgn);
    if (jumped) {
      this.jumpOff(0, 1, 0);
      const side = inp.steer * 2.4;
      v.x += Math.cos(this.frameYaw) * side; v.z += -Math.sin(this.frameYaw) * side;
    } else v.y += 0.9;
    this.spin = this.railYaw; this.spin0 = Math.round(this.spin / Math.PI) * Math.PI;
    this.flip = this.flip0 = this.flipT = Math.asin(clamp(sg.dy * sgn, -1, 1));
    this.roll = this.roll0 = this.rollT = 0;
    this.wSpin = jumped ? -this.steerSm * TUNE.spinMax * 0.5 : 0; this.wFlip = 0; this.wRoll = 0;
    this.swTake = Math.abs(wrapPi(this.spin)) > Math.PI / 2 ? -1 : 1;
    this.mode = 'air'; this.airTime = 0; this.grab = 0; this.grabs = []; this.coyote = 0; this.charge = 0;
    this.spinLock = 0; this.flipLock = (inp.pitch || 0) < -0.3 ? -1 : !jumped && inp.pitch > 0.3 ? 1 : 0;
    this.rail = null; this.railCool = 0.4;
  }

  /* ------------------------------------------------------------ crash */
  stepCrash(inp, dt) {
    const T = TUNE, p = this.pos, v = this.vel, c = this.course;
    this.crashT += dt;
    v.y -= T.G * dt;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    c.sample(p.x, p.z, S);
    let s = Math.hypot(v.x, v.y, v.z);
    if (p.y <= S.h + 0.02) {
      p.y = S.h;
      const il = 1 / Math.hypot(S.gx, 1, S.gz), nx = -S.gx * il, ny = il, nz = -S.gz * il;
      const vn = v.x * nx + v.y * ny + v.z * nz;
      if (vn < 0) { v.x -= nx * vn; v.y -= ny * vn; v.z -= nz * vn; }
      s = Math.hypot(v.x, v.y, v.z);
      if (s > 1e-3) { const s2 = Math.max(0, s - (7 + 0.35 * s) * dt); v.x *= s2 / s; v.y *= s2 / s; v.z *= s2 / s; s = s2; }
      this.n.x = nx; this.n.y = ny; this.n.z = nz;
    }
    this.crashSpin += (3 + s * 0.9) * dt;
    this.height = p.y - S.h;
    if ((this.crashT > T.crashTime && s < 7 && this.height < 0.1) || this.crashT > 2.6) {
      this.mode = 'ground'; this.sw = 1; this.crashSpin = 0;
      this.yaw = s > 1.5 ? Math.atan2(-v.x, -v.z) : Math.atan2(S.gx, S.gz);
      this.prevTravelYaw = this.yaw; this.landT = 0.2; this.steerSm = 0; this.charge = 0;
      this.emit('recover', {});
    }
  }

  /* ------------------------------------------------------------ obstacles and bounds */
  collide() {
    const p = this.pos, v = this.vel, c = this.course, T = TUNE;
    if (this.mode !== 'rail') {
      c.collidersNear(p.x, p.z, (col) => {
        const dx = p.x - col.x, dz = p.z - col.z, rr = col.r + 0.32, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || p.y > col.y0 + col.h || p.y < col.y0 - 1.5) return;
        const dist = Math.sqrt(d2) || 1e-3, nx = dx / dist, nz = dz / dist;
        p.x += nx * (rr - dist); p.z += nz * (rr - dist);
        const vn = v.x * nx + v.z * nz;
        if (vn >= 0) return;
        const hit = -vn;
        v.x -= nx * vn * 1.25; v.z -= nz * vn * 1.25;
        if (col.kind === 'post') { v.x *= 0.85; v.z *= 0.85; if (hit > 3) this.emit('bump', { hit }); return; }
        if (hit > T.crashSpeed && this.mode !== 'crash') { v.x *= 0.5; v.y *= 0.5; v.z *= 0.5; this.crash(col.kind === 'tree' ? 'Tree!' : 'Rock!'); }
        else if (hit > 2) this.emit('bump', { hit });
      });
      for (const b of c.boxes) {
        const m = 0.4;
        if (p.x < b.x0 - m || p.x > b.x1 + m || p.z < b.z0 - m || p.z > b.z1 + m || p.y > b.y1) continue;
        const pen = [p.x - (b.x0 - m), b.x1 + m - p.x, p.z - (b.z0 - m), b.z1 + m - p.z];
        let k = 0;
        for (let i = 1; i < 4; i++) if (pen[i] < pen[k]) k = i;
        if (k === 0) { p.x = b.x0 - m; if (v.x > 0) v.x *= -0.2; }
        else if (k === 1) { p.x = b.x1 + m; if (v.x < 0) v.x *= -0.2; }
        else if (k === 2) { p.z = b.z0 - m; if (v.z > 0) v.z *= -0.2; }
        else { p.z = b.z1 + m; if (v.z < 0) v.z *= -0.2; }
      }
    }
    const B = c.bounds;
    if (p.x < B.xMin) { p.x = B.xMin; if (v.x < 0) v.x = 0; }
    if (p.x > B.xMax) { p.x = B.xMax; if (v.x > 0) v.x = 0; }
    if (p.z > B.zMax) { p.z = B.zMax; if (v.z > 0) v.z = 0; }
    if (p.z < B.zMin) { p.z = B.zMin; if (v.z < 0) v.z = 0; }
  }

  /* ------------------------------------------------------------ orientation */
  updateQuat() {
    const q = this.quat, n = this.n;
    if (this.mode === 'air') {
      q.x = 0; q.y = Math.sin(this.frameYaw / 2); q.z = 0; q.w = Math.cos(this.frameYaw / 2);
      qMulAxis(q, 2, this.roll); qMulAxis(q, 0, this.flip); qMulAxis(q, 1, this.spin);
    } else if (this.mode === 'rail') {
      const sg = this.rail.segs[this.railSeg], s = this.railDir;
      const tx = sg.dx * s, ty = sg.dy * s, tz = sg.dz * s;
      let ux = -tx * ty, uy = 1 - ty * ty, uz = -tz * ty;
      const il = 1 / Math.hypot(ux, uy, uz);
      basisQuat(tx, ty, tz, ux * il, uy * il, uz * il, q);
      qMulAxis(q, 1, this.railYaw);
    } else {
      const f0x = -Math.sin(this.yaw), f0z = -Math.cos(this.yaw), k = f0x * n.x + f0z * n.z;
      let fx = f0x - n.x * k, fy = -n.y * k, fz = f0z - n.z * k;
      const il = 1 / Math.hypot(fx, fy, fz);
      basisQuat(fx * il, fy * il, fz * il, n.x, n.y, n.z, q);
      if (this.mode === 'crash') { qMulAxis(q, 0, -this.crashSpin); qMulAxis(q, 2, this.crashSpin * 0.37); }
    }
  }

  /** Short text for what the rider is doing right now (HUD). */
  liveTrick() {
    if (this.mode === 'air') { const it = this.airItem(true); return it && it.name !== 'Air' ? it.name : ''; }
    if (this.mode === 'rail') return this.railName();
    return '';
  }
}

export { centerX };
