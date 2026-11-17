// The rider: a blocky figure built from boxes, posed every frame with two-bone IK so knees and elbows bend.
// Rig space matches the board: -Z is the nose, +Y is up off the base, +X is the toe edge (regular stance).

import * as THREE from 'three';
import { clamp, lerp, damp } from './util.js';

const V = () => new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// where the hand goes for each grab (board space) and how the board tweaks toward it: [pitch, roll, yaw]
const GRAB_POSE = [
  null,
  { hand: 'back', at: [0.2, 0.05, 0.06], tweak: [0, 0.3, 0] },        // Indy: toe edge, back hand
  { hand: 'front', at: [0.2, 0.05, -0.06], tweak: [0, 0.3, 0.2] },    // Mute: toe edge, front hand
  { hand: 'front', at: [-0.2, 0.05, -0.08], tweak: [0, -0.35, 0] },   // Melon: heel edge, front hand
  { hand: 'back', at: [-0.2, 0.05, 0.1], tweak: [0, -0.35, -0.2] },   // Stalefish: heel edge, back hand
  { hand: 'front', at: [0.02, 0.1, -0.72], tweak: [0.45, 0, 0] },     // Nose
  { hand: 'back', at: [0.02, 0.1, 0.72], tweak: [-0.45, 0, 0] },      // Tail
  { hand: 'front', at: [-0.2, 0.05, -0.1], tweak: [-0.35, -0.75, 0.5] }, // Method
  { hand: 'front', at: [0.2, 0.05, -0.3], tweak: [0.3, 0.55, -0.4] },    // Japan
];

export function createRider(gfx) {
  const { patchMaterial } = gfx;
  // a little self-light keeps the rider readable when riding into the low sun
  const mat = (color, opt = {}) => patchMaterial(new THREE.MeshStandardMaterial(Object.assign({ color, emissive: color, emissiveIntensity: 0.16, roughness: 0.85, metalness: 0 }, opt)));
  const M = {
    jacket: mat(0xf08a3c), jacket2: mat(0xc9662a), pants: mat(0x27324c), boot: mat(0x1b1d24), glove: mat(0x20222b),
    skin: mat(0xe9b891), beanie: mat(0x2a8f8c), board: mat(0x1c2233), deck: mat(0xf3ede2), strap: mat(0x15161b),
    lens: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 0.35) }),
  };
  const root = new THREE.Group();
  root.scale.setScalar(1.12);
  const lean = new THREE.Group(); root.add(lean);
  const mk = (w, h, d, m, parent = lean) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.castShadow = true; parent.add(o); return o; };

  // board
  const board = new THREE.Group(); lean.add(board);
  mk(0.3, 0.045, 1.26, M.board, board).position.y = 0.022;
  mk(0.26, 0.012, 1.2, M.deck, board).position.y = 0.05;
  mk(0.3, 0.012, 0.08, M.jacket, board).position.set(0, 0.052, -0.2);
  mk(0.3, 0.012, 0.08, M.jacket, board).position.set(0, 0.052, 0.2);
  for (const s of [-1, 1]) {
    const tip = mk(0.28, 0.04, 0.2, M.board, board); tip.position.set(0, 0.05, s * 0.71); tip.rotation.x = -s * 0.42;
    const tip2 = mk(0.2, 0.04, 0.1, M.board, board); tip2.position.set(0, 0.105, s * 0.82); tip2.rotation.x = -s * 0.62;
    const bind = mk(0.32, 0.05, 0.2, M.strap, board); bind.position.set(0, 0.07, s * 0.27);
  }

  // body parts (unit boxes scaled per frame along Y for limbs)
  const seg = (w, m) => mk(w, 1, w, m);
  const thigh = [seg(0.16, M.pants), seg(0.16, M.pants)], shin = [seg(0.15, M.pants), seg(0.15, M.pants)];
  const foot = [mk(0.3, 0.13, 0.15, M.boot), mk(0.3, 0.13, 0.15, M.boot)];
  const upper = [seg(0.13, M.jacket), seg(0.13, M.jacket)], fore = [seg(0.12, M.jacket2), seg(0.12, M.jacket2)];
  const hand = [mk(0.13, 0.13, 0.13, M.glove), mk(0.13, 0.13, 0.13, M.glove)];
  const torso = new THREE.Group(); lean.add(torso);
  mk(0.27, 0.54, 0.44, M.jacket, torso).position.y = 0.27;
  mk(0.28, 0.1, 0.45, M.jacket2, torso).position.y = 0.3;
  mk(0.26, 0.16, 0.42, M.pants, torso).position.y = 0.02;
  const head = new THREE.Group(); torso.add(head); head.position.y = 0.56;
  mk(0.27, 0.27, 0.27, M.skin, head).position.y = 0.14;
  mk(0.3, 0.12, 0.3, M.beanie, head).position.y = 0.27;
  mk(0.24, 0.07, 0.24, M.beanie, head).position.y = 0.35;
  mk(0.08, 0.08, 0.08, M.deck, head).position.y = 0.41;
  mk(0.29, 0.07, 0.29, M.strap, head).position.y = 0.17;
  mk(0.03, 0.09, 0.22, M.lens, head).position.set(0.145, 0.17, 0);

  const LT = 0.44, LS = 0.44, AU = 0.33, AF = 0.31;
  const s = { crouch: 0.2, grab: 0, grabId: 0, air: 0, lean: 0, tw: [0, 0, 0], headYaw: 1.1, crash: 0, wob: 0, lift: 0, bounce: 0 };
  const _a = V(), _b = V(), _k = V(), _d = V(), _p = V(), _t = V(), _pole = V(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

  /** Two-bone IK: places `mid` given root a, target b (clamped to reach) and a bend direction. */
  function ik(a, b, l1, l2, pole, mid) {
    _d.subVectors(b, a);
    let D = _d.length();
    const max = (l1 + l2) * 0.999;
    if (D > max) { _d.multiplyScalar(max / D); b.copy(a).add(_d); D = max; }
    if (D < 1e-4) { mid.copy(a); return; }
    _d.multiplyScalar(1 / D);
    const x = (l1 * l1 - l2 * l2 + D * D) / (2 * D), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
    if (_p.lengthSq() < 1e-6) _p.set(1, 0, 0);
    _p.normalize();
    mid.copy(a).addScaledVector(_d, x).addScaledVector(_p, h);
  }
  function limb(mesh, a, b) {
    _d.subVectors(b, a);
    const len = _d.length() || 1e-4;
    mesh.position.copy(a).addScaledVector(_d, 0.5);
    mesh.quaternion.setFromUnitVectors(Y, _d.multiplyScalar(1 / len));
    mesh.scale.y = len;
  }
  const hip = V(), sh = [V(), V()], ft = [V(), V()], hd = [V(), V()], kn = V(), el = V(), tmp = V();

  /**
   * @param r      Rider physics state
   * @param pos    interpolated position (THREE.Vector3)
   * @param quat   interpolated orientation (THREE.Quaternion)
   * @param lift   metres to raise the board so it rides on the edges of the voxel steps
   */
  function update(r, pos, quat, lift, dt, time) {
    const air = r.mode === 'air', rail = r.mode === 'rail', crash = r.mode === 'crash';
    s.lift = damp(s.lift, air || crash ? 0 : lift, 12, dt);
    root.position.copy(pos); root.position.y += s.lift;
    root.quaternion.copy(quat);

    // targets
    const gp = air && r.grab ? GRAB_POSE[r.grab] : null;
    s.grab = damp(s.grab, gp ? 1 : 0, gp ? 14 : 9, dt);
    if (gp) s.grabId = r.grab;
    const g = GRAB_POSE[s.grabId] || GRAB_POSE[1];
    for (let i = 0; i < 3; i++) s.tw[i] = damp(s.tw[i], gp ? gp.tweak[i] : 0, 10, dt);
    s.air = damp(s.air, air ? 1 : 0, 8, dt);
    s.crash = damp(s.crash, crash ? 1 : 0, 10, dt);
    const speedK = clamp(r.speed / 22, 0, 1);
    let crouch = 0.2 + 0.1 * speedK + r.tuck * 0.32 + r.charge * 0.3 + r.compress * 0.55 + Math.abs(r.lean) * 0.25 + r.brake * 0.15;
    if (air) crouch = 0.3 + s.grab * 0.55 + clamp((Math.abs(r.wFlip) + Math.abs(r.wRoll)) / 6, 0, 1) * 0.35 + r.charge * 0.2;
    if (rail) crouch = 0.42 + r.charge * 0.3;
    if (crash) crouch = 0.5 + 0.3 * Math.sin(time * 9);
    s.crouch = damp(s.crouch, clamp(crouch, 0, 1), air ? 10 : 14, dt);
    s.lean = damp(s.lean, air || rail ? 0 : r.lean * r.sw, 12, dt);
    s.wob = damp(s.wob, rail ? 1 : 0, 6, dt);
    const wobble = s.wob * Math.sin(time * 7.3) * 0.05;
    lean.rotation.set(0, 0, REDUCED_LEAN * (s.lean + wobble));
    // the board pivots on its edge when carving, so lift the centre a little
    lean.position.set(0, Math.abs(Math.sin(s.lean)) * 0.13, 0);

    // board tweak (grabs) and a visual skid angle when braking
    _e.set(s.tw[0], s.tw[2] + (air || rail ? 0 : r.brake * 0.9 * (r.steerSm < -0.1 ? -1 : 1)), s.tw[1], 'YXZ');
    board.quaternion.setFromEuler(_e);
    board.position.set(0, s.grab * 0.06, 0);

    const c = s.crouch;
    const hipY = lerp(0.84, 0.43, c), hipX = lerp(-0.03, -0.16, c) - s.grab * 0.03;
    hip.set(hipX, hipY, 0);
    const bend = lerp(0.12, 0.92, c) + s.grab * 0.15;         // torso folds toward the toes
    const twist = air ? clamp(r.wSpin / 8, -1, 1) * 0.5 : -r.steerSm * 0.22 * r.sw; // shoulders lead the turn
    torso.position.copy(hip);
    torso.rotation.set(0, twist, -bend, 'YZX');
    const look = r.sw > 0 ? 1.15 : -1.15;
    s.headYaw = damp(s.headYaw, look - twist * 0.6, 8, dt);
    head.rotation.set(0, s.headYaw, bend * 0.75, 'ZYX');

    // legs
    for (let i = 0; i < 2; i++) {
      const sg = i === 0 ? -1 : 1;
      ft[i].set(0.02, 0.135, sg * 0.27).applyQuaternion(board.quaternion).add(board.position);
      _a.set(hipX, hipY - 0.02, sg * 0.11);
      _pole.set(1, 0.15, sg * 0.55);
      _b.copy(ft[i]);
      ik(_a, _b, LT, LS, _pole, kn);
      limb(thigh[i], _a, kn); limb(shin[i], kn, _b);
      foot[i].position.set(0.04, 0.115, sg * 0.27).applyQuaternion(board.quaternion).add(board.position);
      foot[i].quaternion.copy(board.quaternion);
    }

    // arms
    torso.updateMatrix();
    for (let i = 0; i < 2; i++) {
      const sg = i === 0 ? -1 : 1, front = i === 0;
      sh[i].set(0.0, 0.47, sg * 0.27).applyMatrix4(torso.matrix);
      // relaxed riding pose, opening up in the air and windmilling in a crash
      const swing = Math.sin(time * 2.1 + i * 2.4) * 0.03;
      tmp.set(0.2 + 0.1 * c, lerp(-0.3, 0.02, s.air) + swing + (front ? -1 : 1) * s.lean * 0.25 - r.tuck * 0.12 * (1 - s.air),
        sg * lerp(0.36, 0.5, s.air) - (front ? 0.06 : -0.02));
      if (s.crash > 0.01) { tmp.x += Math.sin(time * 13 + i * 3) * 0.3 * s.crash; tmp.y += (0.25 + Math.cos(time * 11 + i) * 0.3) * s.crash; }
      _t.copy(sh[i]).add(tmp);
      if (s.grab > 0.001 && (g.hand === 'front') === front) {
        hd[i].set(g.at[0], g.at[1], g.at[2]).applyQuaternion(board.quaternion).add(board.position);
        _t.lerp(hd[i], s.grab);
      } else if (s.grab > 0.001) {
        _t.y += 0.3 * s.grab; _t.z += sg * 0.12 * s.grab;   // free arm goes up for style
      }
      _pole.set(-0.5, -0.6, sg * 0.8);
      ik(sh[i], _t, AU, AF, _pole, el);
      limb(upper[i], sh[i], el); limb(fore[i], el, _t);
      hand[i].position.copy(_t);
      hand[i].quaternion.copy(fore[i].quaternion);
    }
  }
  const REDUCED_LEAN = 1;
  return { root, update, state: s };
}
