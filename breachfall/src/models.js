// Blocky models made of coloured boxes: the guns (first person, wall racks, crate), stations, the crate.

import * as THREE from 'three';

const GM = 0x2b2e33, ST = 0x5a6068, WD = 0x7a5230, TN = 0xa58a5a, BK = 0x18191c, OL = 0x4a5238, RD = 0xb03a2a, CY = 0x60e8ff, YL = 0xe2b530;

// [x, y, z, w, h, d, colour, glow?] in metres, gun pointing down -z, origin at the grip
const GUNS = {
  rook: { muzzle: [0, 0.062, -0.26], parts: [
    [0, 0.06, -0.12, 0.036, 0.044, 0.24, ST], [0, 0.035, -0.1, 0.03, 0.02, 0.2, GM], [0, -0.03, -0.015, 0.032, 0.11, 0.052, WD],
    [0, 0.088, -0.02, 0.012, 0.012, 0.02, BK], [0, 0.088, -0.22, 0.008, 0.012, 0.012, BK], [0, 0.005, -0.07, 0.01, 0.03, 0.06, GM]] },
  ranger: { muzzle: [0, 0.055, -0.72], parts: [
    [0, 0.05, -0.3, 0.04, 0.05, 0.42, WD], [0, 0.058, -0.6, 0.02, 0.02, 0.26, GM], [0, 0.075, -0.25, 0.034, 0.03, 0.3, GM],
    [0, 0.02, 0.12, 0.038, 0.09, 0.26, WD], [0, -0.03, -0.02, 0.03, 0.08, 0.045, WD], [0, 0.0, -0.2, 0.026, 0.07, 0.05, GM],
    [0, 0.1, -0.12, 0.008, 0.02, 0.012, BK], [0, 0.085, -0.7, 0.006, 0.03, 0.01, BK]] },
  breaker: { muzzle: [0, 0.055, -0.78], parts: [
    [0, 0.06, -0.48, 0.03, 0.03, 0.6, GM], [0, 0.025, -0.44, 0.028, 0.026, 0.5, GM], [0, 0.02, -0.4, 0.048, 0.044, 0.18, WD],
    [0, 0.045, -0.1, 0.044, 0.07, 0.22, ST], [0, 0.015, 0.14, 0.04, 0.085, 0.28, WD], [0, -0.03, -0.01, 0.03, 0.08, 0.045, WD],
    [0, 0.082, -0.76, 0.008, 0.014, 0.01, YL]] },
  wasp: { muzzle: [0, 0.05, -0.42], parts: [
    [0, 0.05, -0.15, 0.044, 0.06, 0.3, GM], [0, 0.05, -0.36, 0.022, 0.022, 0.12, BK], [0, -0.03, -0.01, 0.03, 0.09, 0.045, GM],
    [0, -0.06, -0.15, 0.026, 0.17, 0.04, BK], [0, 0.05, 0.1, 0.012, 0.012, 0.2, ST], [0, 0.02, 0.2, 0.03, 0.07, 0.012, ST],
    [0, 0.09, -0.08, 0.01, 0.018, 0.014, BK], [0, 0.09, -0.27, 0.01, 0.018, 0.01, BK]] },
  kestrel: { muzzle: [0, 0.055, -0.68], parts: [
    [0, 0.05, -0.18, 0.044, 0.07, 0.36, GM], [0, 0.055, -0.5, 0.022, 0.022, 0.34, GM], [0, 0.05, -0.44, 0.046, 0.05, 0.2, TN],
    [0, 0.03, 0.14, 0.036, 0.075, 0.26, TN], [0, -0.035, -0.01, 0.03, 0.09, 0.045, GM], [0, -0.055, -0.2, 0.028, 0.15, 0.06, BK],
    [0, 0.1, -0.16, 0.024, 0.03, 0.14, BK], [0, 0.09, -0.6, 0.006, 0.03, 0.01, BK]] },
  mauler: { muzzle: [0, 0.055, -0.6], parts: [
    [0, 0.05, -0.2, 0.05, 0.07, 0.4, GM], [0, 0.058, -0.5, 0.034, 0.034, 0.22, BK], [0, 0.02, -0.42, 0.05, 0.04, 0.16, OL],
    [0, 0.03, 0.12, 0.038, 0.075, 0.22, OL], [0, -0.035, -0.01, 0.03, 0.09, 0.045, GM], [0, -0.06, -0.2, 0.06, 0.1, 0.11, BK],
    [0, 0.092, -0.3, 0.008, 0.016, 0.012, YL]] },
  hog: { muzzle: [0, 0.055, -0.82], parts: [
    [0, 0.05, -0.2, 0.05, 0.08, 0.44, OL], [0, 0.055, -0.6, 0.026, 0.026, 0.44, GM], [0, 0.06, -0.5, 0.04, 0.04, 0.14, BK],
    [0, 0.03, 0.16, 0.04, 0.085, 0.26, OL], [0, -0.035, -0.01, 0.03, 0.09, 0.045, GM], [-0.045, -0.04, -0.22, 0.09, 0.11, 0.13, OL],
    [0, 0.105, -0.14, 0.03, 0.022, 0.2, BK], [0.03, -0.02, -0.7, 0.008, 0.12, 0.008, ST], [-0.03, -0.02, -0.7, 0.008, 0.12, 0.008, ST]] },
  longbow: { muzzle: [0, 0.055, -0.98], parts: [
    [0, 0.045, -0.2, 0.042, 0.06, 0.46, OL], [0, 0.055, -0.68, 0.022, 0.022, 0.56, GM], [0, 0.055, -0.95, 0.034, 0.034, 0.08, BK],
    [0, 0.03, 0.17, 0.038, 0.08, 0.28, OL], [0, -0.03, -0.01, 0.03, 0.08, 0.045, OL], [0, -0.02, -0.2, 0.026, 0.07, 0.07, BK],
    [0, 0.115, -0.2, 0.04, 0.04, 0.26, BK], [0, 0.115, -0.34, 0.046, 0.046, 0.03, BK], [0, 0.115, -0.065, 0.03, 0.03, 0.01, CY, 1], [0, 0.085, -0.2, 0.014, 0.03, 0.03, GM]] },
  thumper: { muzzle: [0, 0.055, -0.5], parts: [
    [0, 0.055, -0.3, 0.07, 0.07, 0.34, OL], [0, 0.055, -0.48, 0.076, 0.076, 0.03, BK], [0, 0.05, -0.06, 0.05, 0.07, 0.16, GM],
    [0, 0.03, 0.14, 0.036, 0.075, 0.24, WD], [0, -0.035, -0.01, 0.03, 0.09, 0.045, WD], [0, -0.02, -0.28, 0.03, 0.08, 0.04, WD],
    [0, 0.11, -0.2, 0.01, 0.05, 0.012, BK]] },
  ramrod: { muzzle: [0, 0.07, -0.72], parts: [
    [0, 0.07, -0.12, 0.09, 0.09, 1.0, OL], [0, 0.07, -0.64, 0.11, 0.11, 0.06, BK], [0, 0.07, 0.4, 0.12, 0.12, 0.08, BK],
    [0, -0.02, -0.12, 0.03, 0.1, 0.045, GM], [0, -0.02, -0.34, 0.03, 0.09, 0.04, GM], [0.06, 0.09, -0.2, 0.03, 0.05, 0.12, BK],
    [0, 0.07, -0.68, 0.05, 0.05, 0.08, RD]] },
  arc: { muzzle: [0, 0.055, -0.62], parts: [
    [0, 0.05, -0.16, 0.06, 0.08, 0.34, ST], [0, 0.055, -0.44, 0.02, 0.02, 0.3, CY, 1], [0.03, 0.055, -0.44, 0.012, 0.05, 0.3, GM], [-0.03, 0.055, -0.44, 0.012, 0.05, 0.3, GM],
    [0, 0.055, -0.6, 0.07, 0.07, 0.03, GM], [0, 0.03, 0.12, 0.04, 0.07, 0.2, GM], [0, -0.035, -0.01, 0.03, 0.09, 0.045, BK],
    [0, 0.1, -0.16, 0.03, 0.02, 0.2, CY, 1], [0, -0.01, -0.22, 0.05, 0.06, 0.1, YL]] },
  frag: { muzzle: [0, 0, 0], parts: [[0, 0, 0, 0.07, 0.085, 0.07, OL], [0, 0.055, 0, 0.03, 0.03, 0.03, ST], [0.03, 0.05, 0, 0.012, 0.05, 0.02, ST]] },
  knife: { muzzle: [0, 0, 0], parts: [[0, 0.02, -0.14, 0.008, 0.035, 0.2, 0xc8ccd2], [0, 0.02, -0.03, 0.03, 0.045, 0.02, GM], [0, 0.015, 0.03, 0.024, 0.03, 0.1, BK]] },
};

const _c = new THREE.Color();
export function boxesGeometry(parts) {
  const pos = [], nrm = [], col = [], idx = []; let base = 0;
  for (const p of parts) {
    const g = new THREE.BoxGeometry(p[3], p[4], p[5]); g.translate(p[0], p[1], p[2]);
    pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array);
    _c.setHex(p[6]); if (p[7]) _c.multiplyScalar(1 + p[7] * 5);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(_c.r, _c.g, _c.b);
    for (const i of g.index.array) idx.push(i + base);
    base += g.attributes.position.count; g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
  return geo;
}
// glow parts get colours above 1, which the Lambert material mostly ignores; give them an unlit twin instead
export function boxModel(parts, shadows = false) {
  const lit = parts.filter((p) => !p[7]), glow = parts.filter((p) => p[7]);
  const g = new THREE.Group();
  if (lit.length) { const m = new THREE.Mesh(boxesGeometry(lit), new THREE.MeshLambertMaterial({ vertexColors: true })); m.castShadow = shadows; g.add(m); }
  if (glow.length) g.add(new THREE.Mesh(boxesGeometry(glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
  return g;
}
const upgraded = (parts) => parts.map((p) => (p[7] ? p : [p[0], p[1], p[2], p[3], p[4], p[5], p[6] === GM || p[6] === ST || p[6] === BK ? 0x3a2f5c : p[6] === WD || p[6] === TN || p[6] === OL ? 0x26a6b8 : p[6]]))
  .concat([[0, 0.02, -0.1, 0.05, 0.008, 0.2, CY, 1]]);
export function gunModel(id, up = false) { const G = GUNS[id]; const m = boxModel(up ? upgraded(G.parts) : G.parts); m.userData.muzzle = new THREE.Vector3(...G.muzzle); return m; }

/* ------------------------------------------------------------------ labels */
export function labelSprite(title, sub, accent = '#e2b530') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  const draw = (t, s) => {
    g.clearRect(0, 0, 512, 160);
    g.fillStyle = 'rgba(14,15,18,.82)'; g.fillRect(0, 22, 512, 116);
    g.fillStyle = accent; g.fillRect(0, 22, 10, 116);
    g.textBaseline = 'middle'; g.fillStyle = '#f2ead8'; g.font = '600 50px "Saira Condensed", "Arial Narrow", sans-serif'; g.fillText(t, 30, 60, 470);
    g.fillStyle = accent; g.font = '400 40px "Saira Stencil One", Impact, sans-serif'; g.fillText(s, 30, 108, 470);
  };
  draw(title, sub);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: false }));
  sp.scale.set(0.8, 0.25, 1); sp.userData.set = (t, s) => { draw(t, s); tex.needsUpdate = true; };
  return sp;
}

/* ---------------------------------------------------------------- stations */
export function rackModel(gun) {
  const g = boxModel([[0, 0, 0.03, 1.5, 0.62, 0.05, 0x24262b], [0, 0.29, 0.06, 1.5, 0.04, 0.03, YL], [0, -0.29, 0.06, 1.5, 0.04, 0.03, YL],
    [-0.35, -0.12, 0.09, 0.03, 0.03, 0.08, ST], [0.3, -0.12, 0.09, 0.03, 0.03, 0.08, ST]], true);
  gun.scale.setScalar(1.25); gun.rotation.y = Math.PI / 2; gun.position.set(0.12, -0.1, 0.13); g.add(gun);
  return g;
}
export function fragStation() {
  const g = boxModel([[0, 0, 0.03, 1.1, 0.62, 0.05, 0x24262b], [0, 0.29, 0.06, 1.1, 0.04, 0.03, RD], [0, -0.29, 0.06, 1.1, 0.04, 0.03, RD], [0, -0.14, 0.12, 0.9, 0.03, 0.14, ST]], true);
  for (let i = 0; i < 4; i++) { const f = gunModel('frag'); f.scale.setScalar(1.5); f.position.set(-0.33 + i * 0.22, -0.06, 0.12); g.add(f); }
  return g;
}
export function platingStation() {
  return boxModel([[0, -0.3, 0.2, 0.9, 1.9, 0.4, 0x2d3a44], [0, 0.1, 0.41, 0.6, 0.7, 0.03, 0x3c5566], [0, 0.1, 0.43, 0.34, 0.42, 0.02, 0x7ad0ff, 1], [0, 0.1, 0.45, 0.1, 0.3, 0.02, 0xf2f6f8, 0.4], [0, 0.1, 0.45, 0.3, 0.1, 0.02, 0xf2f6f8, 0.4],
    [0, -0.7, 0.42, 0.7, 0.3, 0.04, 0x1c2226], [0, 0.68, 0.2, 0.96, 0.06, 0.46, YL]], true);
}
export function benchModel() {
  return boxModel([[0, -0.9, 0.45, 1.8, 0.9, 0.9, 0x2c2640], [0, -0.42, 0.45, 1.9, 0.08, 1.0, 0x4a4466], [-0.7, 0.2, 0.1, 0.12, 1.2, 0.12, 0x3a3550], [0.7, 0.2, 0.1, 0.12, 1.2, 0.12, 0x3a3550],
    [0, 0.82, 0.1, 1.6, 0.14, 0.2, 0x3a3550], [0, 0.72, 0.14, 1.3, 0.04, 0.06, CY, 1], [-0.7, 0.2, 0.17, 0.04, 1.0, 0.02, CY, 1], [0.7, 0.2, 0.17, 0.04, 1.0, 0.02, CY, 1],
    [0, -0.34, 0.45, 0.9, 0.03, 0.3, 0x8a80c0, 0.6], [0.75, -0.3, 0.75, 0.16, 0.2, 0.16, YL]], true);
}
export function crateModel() {
  const g = new THREE.Group();
  const base = boxModel([[0, 0.22, 0, 1.5, 0.44, 0.72, 0x3b2f24], [0, 0.22, 0, 1.54, 0.08, 0.76, 0x1e1a16], [-0.6, 0.22, 0, 0.06, 0.46, 0.76, 0x8a6a2a], [0.6, 0.22, 0, 0.06, 0.46, 0.76, 0x8a6a2a],
    [0, 0.2, 0.365, 0.2, 0.16, 0.02, YL], [0, 0.43, 0, 1.36, 0.02, 0.58, 0x70d8ff, 1]], true);
  const lid = boxModel([[0, 0.05, 0.36, 1.54, 0.1, 0.76, 0x4a3a2c], [-0.6, 0.05, 0.36, 0.06, 0.12, 0.78, 0x8a6a2a], [0.6, 0.05, 0.36, 0.06, 0.12, 0.78, 0x8a6a2a], [0, 0.11, 0.36, 0.5, 0.02, 0.3, YL]], true);
  lid.position.set(0, 0.44, -0.36);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.26, 30, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x4fc8ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
  beam.position.y = 16.6;
  g.add(base, lid, beam); g.userData = { lid, beam };
  return g;
}
export function powerupModel(kind) {
  const C = { ammo: 0x58d868, kill: 0xff5040, double: 0xffd040, nuke: 0x60c8ff, cash: 0xffe9a0 }[kind];
  const P = {
    ammo: [[0, 0, 0, 0.3, 0.2, 0.2, C, 1], [0, 0.13, 0, 0.1, 0.06, 0.06, C, 1]],
    kill: [[0, 0.04, 0, 0.26, 0.2, 0.22, C, 1], [0, -0.1, 0, 0.16, 0.1, 0.18, C, 1]],
    double: [[-0.1, 0, 0, 0.06, 0.3, 0.06, C, 1], [0.1, 0, 0, 0.06, 0.3, 0.06, C, 1], [0, 0.12, 0, 0.26, 0.06, 0.06, C, 1], [0, -0.12, 0, 0.26, 0.06, 0.06, C, 1]],
    nuke: [[0, 0, 0, 0.12, 0.34, 0.12, C, 1], [0, 0, 0, 0.34, 0.12, 0.12, C, 1], [0, 0, 0, 0.12, 0.12, 0.34, C, 1]],
    cash: [[0, 0, 0, 0.3, 0.12, 0.18, C, 1], [0, 0.1, 0, 0.24, 0.08, 0.14, C, 1]],
  }[kind];
  return boxModel(P);
}
