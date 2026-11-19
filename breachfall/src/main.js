// Breachfall: round-based survival in a fully destructible voxel city block.
// Earn points, buy heavier weapons off the walls or from the crate, and blast your way into new areas.

import * as THREE from 'three';
import { VOX, SX, SY, SZ, MAT, ID, TIER_NEED, WEAPONS, CRATE_POOL, CRATE_WEIGHT, PRICES, FRAG } from './config.js';
import { World } from './voxels.js';
import { buildMap, zoneAt } from './map.js';
import { Nav } from './nav.js';
import { Gfx, QUALITY } from './gfx.js';
import { Fx } from './fx.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Horde } from './zombies.js';
import { Hud } from './hud.js';
import { gunModel, labelSprite, rackModel, fragStation, platingStation, benchModel, crateModel, powerupModel, boxModel } from './models.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('breachfall.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('breachfall.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const ZONE_ORDER = 'ABCDE';
const MAT_TOUGH = (m) => MAT[m].name.charAt(0).toUpperCase() + MAT[m].name.slice(1);

const canvas = $('gl');
let qi = store.get('quality', matchMedia('(pointer: coarse)').matches ? 0 : 1);
let sens = store.get('sens', 1);
let world, map, gfx, nav, fx, horde, player, audio, input, hud;
let state = 'boot';
const S = {};               // the current run
const W = {};               // weapon handling state
const props = { inter: [], labels: [], crates: [], spinModels: {}, flash: null, tracers: null, beam: null, core: null };
const projs = [], drops = [];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/* ================================================================== weapons */
function stats(id, up) {
  const B = WEAPONS[id]; if (!up) return B;
  return { ...B, name: B.name + ' OC', dmg: B.dmg * 2.2, mag: Math.ceil(B.mag * 1.5), reserve: Math.ceil(B.reserve * 1.6), tier: Math.min(4, B.tier + 1), dig: B.dig * 1.25, rpm: B.rpm * 1.1, reload: B.reload * 0.8, spread: B.spread * 0.8, up: true };
}
function makeSlot(id, up = false) {
  const st = stats(id, up), model = gunModel(id, up);
  model.visible = false; gfx.vmScene.add(model);
  return { id, up, st, mag: st.mag, reserve: st.reserve, model };
}
const cur = () => S.slots[S.cur];
const owns = (id) => S.slots.find((s) => s.id === id);
function give(id, up = false) {
  const have = owns(id);
  if (have) { S.cur = S.slots.indexOf(have); refill(have); startSwap(); return; }
  const slot = makeSlot(id, up);
  if (S.slots.length < 2) { S.slots.push(slot); S.cur = S.slots.length - 1; }
  else { const old = S.slots[S.cur]; gfx.vmScene.remove(old.model); S.slots[S.cur] = slot; }
  startSwap();
}
function refill(slot) { slot.mag = slot.st.mag; slot.reserve = slot.st.reserve; }
function startSwap() { W.swapT = 0.45; W.reloadT = 0; audio.swap(); audio.arc(false); }

function addPoints(n, kind = '') {
  if (n > 0 && S.double > 0 && kind !== 'flat') n *= 2;
  S.points += n; S.earned += Math.max(0, n);
  if (n) hud.pop(n, kind === 'flat' ? '' : kind);
}
function spend(n) {
  if (S.points < n) { audio.deny(); hud.toast(`You need ${fmt(n - S.points)} more points`); return false; }
  S.points -= n; audio.buy(); hud.pop(-n, 'spend'); return true;
}

function hitZombie(zb, dmg, info) {
  if (S.insta > 0) dmg = 1e9;
  const killed = horde.damage(zb, dmg, info);
  if (killed) {
    addPoints(info.knife ? 130 : info.crush ? 100 : info.head ? 100 : 60, info.head ? 'head' : '');
    hud.hitmark('kill'); audio.hitmark(true);
  } else if (!info.quiet) { addPoints(10); hud.hitmark(info.head ? 'head' : ''); audio.hitmark(info.head); audio.flesh(); }
  return killed;
}

function camDir(out) { return gfx.camera.getWorldDirection(out); }
function muzzleWorld(out) {
  // the viewmodel lives in camera space; map its muzzle into the world (approximate: different fov)
  const m = cur().model; out.copy(m.userData.muzzle).applyMatrix4(m.matrix);
  out.z *= 0.75; return out.applyMatrix4(gfx.camera.matrixWorld);
}

function blockedNote(mat, tier) {
  const t = MAT[mat].tier;
  if (t <= tier || performance.now() - W.noteAt < 3500) return;
  W.noteAt = performance.now();
  hud.toast(t >= 9 ? 'Blast walls cannot be broken' : `${MAT_TOUGH(mat)} needs ${TIER_NEED[t]}`);
}

function breakAt(x, y, z, r, tier, o) {
  const res = fx.blast(x, y, z, r, tier, o);
  if (res.gold) addPoints(res.gold * 3, 'gold');
  return res;
}

function fireHitscan(st, o, d) {
  const range = st.range ? st.range * 2.2 : 140;
  const h = world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range);
  const tw = h ? h.t : range;
  let pen = st.pen || 0, stopped = false, hitAny = false;
  for (const hz of horde.rayHits(o.x, o.y, o.z, d.x, d.y, d.z, tw)) {
    const fall = st.range ? Math.max(0.3, 1 - Math.max(0, hz.t - st.range * 0.4) / st.range) : 1;
    hitZombie(hz.z, st.dmg * (hz.head ? st.head || 1.5 : 1) * fall, { head: hz.head, dx: d.x, dy: d.y, dz: d.z, quiet: hitAny });
    hitAny = true;
    fx.gore(o.x + d.x * hz.t, o.y + d.y * hz.t, o.z + d.z * hz.t, d.x, d.y, d.z, 3, [0x5a1410, 0x7a1c14]);
    if (pen-- <= 0) { stopped = true; tracer(o, d, hz.t); break; }
  }
  if (stopped) return;
  tracer(o, d, tw);
  if (!h) return;
  const px = o.x + d.x * h.t, py = o.y + d.y * h.t, pz = o.z + d.z * h.t;
  const tough = MAT[h.mat].tier > st.tier;
  if (!tough) breakAt(px + d.x * VOX * 0.5, py + d.y * VOX * 0.5, pz + d.z * VOX * 0.5, st.dig, st.tier, { push: 2.2, samples: 18, nx: h.nx, ny: h.ny, nz: h.nz });
  else if (!h.ny) blockedNote(h.mat, st.tier);
  const hard = MAT[h.mat].tier >= 2;
  if (hard || tough) fx.sparks(px, py, pz, tough ? 6 : 3, h.nx, h.ny, h.nz, 0xffc060, 4);
  fx.dust(px + h.nx * 0.05, py + h.ny * 0.05, pz + h.nz * 0.05, 2, h.mat, 0.06, 0.5);
  if (Math.random() < 0.5) audio.impact(Math.hypot(px - player.x, pz - player.z), hard);
}

function fireOnce() {
  const slot = cur(), st = slot.st;
  if (slot.mag <= 0) { audio.dry(); W.fireT = 0.25; if (slot.reserve > 0) startReload(); return; }
  slot.mag--; W.fireT = 60 / st.rpm;
  const cam = gfx.camera; camDir(_fwd);
  const o = cam.position.clone();
  const aimK = W.aimK, moving = Math.min(1, player.speed / 4.5);
  let spread = st.spread * (1 - aimK * (st.pellets > 1 ? 0.3 : 0.7)) * (1 + moving * 0.8) * (player.onGround ? 1 : 2.2);
  if (st.zoom && aimK < 0.9) spread += 0.05;
  const right = _v2.crossVectors(_fwd, _up).normalize(), upv = new THREE.Vector3().crossVectors(right, _fwd);
  const dir = new THREE.Vector3();
  if (st.kind === 'hit' || st.kind === 'beam') {
    for (let p = 0; p < st.pellets; p++) {
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * spread;
      dir.copy(_fwd).addScaledVector(right, Math.cos(a) * r).addScaledVector(upv, Math.sin(a) * r).normalize();
      fireHitscan(st, o, dir);
    }
  } else {
    dir.copy(_fwd).addScaledVector(right, rnd(spread)).addScaledVector(upv, rnd(spread)).normalize();
    launch(st.kind, st, o.clone().addScaledVector(_fwd, 0.5).addScaledVector(upv, -0.08), dir);
  }
  if (st.kind !== 'beam') audio.shot(st.snd);
  const rk = st.recoil * (0.75 + Math.random() * 0.5) * (1 - aimK * 0.4);
  player.pitch = Math.min(1.5, player.pitch + rk); player.yaw += rnd(rk * 0.35);
  W.kick = Math.min(1, W.kick + 0.35 + rk * 4);
  showFlash(st);
  muzzleWorld(_v); gfx.muzzleFlash(_v, st.kind === 'beam' ? 0x60e8ff : 0xffb060);
  if (slot.mag === 0 && slot.reserve > 0) W.autoReload = 0.25;
}

function startReload() {
  const slot = cur();
  if (W.reloadT > 0 || W.swapT > 0 || slot.mag >= slot.st.mag || slot.reserve <= 0) return;
  W.reloadT = slot.st.reload; W.reloadSnd = false; audio.reload(0); audio.arc(false);
}

function weaponsStep(dt) {
  const slot = cur(), st = slot.st;
  W.fireT -= dt; W.knifeT = Math.max(0, W.knifeT - dt); W.nadeT = Math.max(0, W.nadeT - dt);
  if (W.swapT > 0) W.swapT = Math.max(0, W.swapT - dt);
  if (W.reloadT > 0) {
    W.reloadT -= dt;
    if (!W.reloadSnd && W.reloadT < st.reload * 0.35) { W.reloadSnd = true; audio.reload(1); }
    if (W.reloadT <= 0) { W.reloadT = 0; const n = Math.min(st.mag - slot.mag, slot.reserve); slot.mag += n; slot.reserve -= n; }
  }
  if (W.autoReload > 0 && (W.autoReload -= dt) <= 0) startReload();
  // swap
  const wantSwap = input.hit('KeyQ', 'T:swap') || input.wheel !== 0 || (input.hit('Digit1') && S.cur !== 0) || (input.hit('Digit2') && S.cur !== 1);
  if (wantSwap && S.slots.length > 1 && W.knifeT <= 0) { S.cur = input.hit('Digit1') ? 0 : input.hit('Digit2') ? 1 : 1 - S.cur; startSwap(); }
  if (input.hit('KeyR', 'T:reload') || (input.hit('PadX') && !W.target)) startReload();
  // aim
  if (input.hit('T:aim')) W.aimToggle = !W.aimToggle;
  const aiming = (input.aim || W.aimToggle) && W.reloadT <= 0 && W.swapT <= 0 && W.knifeT <= 0 && !player.sprinting;
  W.aimK += ((aiming ? 1 : 0) - W.aimK) * (1 - Math.exp(-14 * dt));
  // knife
  if (input.hit('KeyV', 'T:melee') && W.knifeT <= 0) knife();
  // frag
  if (input.hit('KeyG', 'T:nade') && W.nadeT <= 0 && W.knifeT <= 0) {
    if (S.nades > 0) {
      S.nades--; W.nadeT = 0.8; camDir(_fwd);
      launch('frag', FRAG, gfx.camera.position.clone().addScaledVector(_fwd, 0.4), _fwd.clone().add(new THREE.Vector3(0, 0.18, 0)).normalize());
      audio.knife();
    } else if (performance.now() - W.noteAt > 2000) { W.noteAt = performance.now(); hud.toast('No frags. Buy them at the frag rack in the yard'); }
  }
  // fire
  const ready = W.reloadT <= 0 && W.swapT <= 0 && W.knifeT <= 0 && !player.dead;
  const want = st.auto ? input.fire : input.hit('Mouse0', 'T:fire');
  let beamOn = false;
  if (ready && want) {
    let guard = 0;
    while (W.fireT <= 0 && guard++ < 4) { fireOnce(); if (!st.auto || slot.mag <= 0) break; }
    if (st.kind === 'beam' && slot.mag > 0) beamOn = true;
  }
  if (W.fireT < -0.05) W.fireT = -0.05;
  W.beamOn = beamOn && input.fire;
  audio.arc(W.beamOn);
  W.kick = Math.max(0, W.kick - dt * 7);
}

function knife() {
  W.knifeT = 0.5; audio.knife();
  camDir(_fwd);
  let best = null, bd = 1.8;
  for (const zb of horde.list) {
    const dx = zb.x - player.x, dz = zb.z - player.z, d = Math.hypot(dx, dz);
    if (d < bd && Math.abs(zb.y - player.y) < 1.5 && (dx * _fwd.x + dz * _fwd.z) / (d || 1) > 0.45) { best = zb; bd = d; }
  }
  setTimeout(() => {
    if (state !== 'play') return;
    if (best && horde.list.includes(best)) { hitZombie(best, 150, { knife: true, dx: _fwd.x, dy: 0, dz: _fwd.z }); return; }
    const o = gfx.camera.position, h = world.raycast(o.x, o.y, o.z, _fwd.x, _fwd.y, _fwd.z, 1.6);
    if (h) {
      const p = o.clone().addScaledVector(_fwd, h.t + VOX * 0.5);
      if (MAT[h.mat].tier > 0) { fx.sparks(p.x, p.y, p.z, 5, h.nx, h.ny, h.nz); audio.impact(0, true); }
      else breakAt(p.x, p.y, p.z, 0.3, 0, { push: 2.5, samples: 24, nx: h.nx, ny: h.ny, nz: h.nz });
    }
  }, 120);
}

/* ================================================================ projectiles */
const projMats = {
  nade: new THREE.MeshLambertMaterial({ color: 0x4a5238 }), frag: new THREE.MeshLambertMaterial({ color: 0x4a5238 }),
  rocket: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3, 1.4) }),
};
const projGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
function launch(kind, st, pos, dir) {
  const speed = kind === 'rocket' ? 34 : kind === 'nade' ? 30 : 15;
  const mesh = new THREE.Mesh(projGeo, projMats[kind]); mesh.position.copy(pos);
  if (kind === 'rocket') mesh.scale.set(1, 1, 3.2);
  gfx.scene.add(mesh);
  projs.push({ kind, st, pos: pos.clone(), vel: dir.clone().multiplyScalar(speed).add(new THREE.Vector3(player.vx * 0.5, 0, player.vz * 0.5)), mesh, t: 0, fuse: kind === 'frag' ? st.fuse : 6, trail: 0 });
}
function projStep(dt) {
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i]; p.t += dt;
    p.vel.y -= (p.kind === 'rocket' ? 0.6 : p.kind === 'nade' ? 9 : 19) * dt;
    const len = p.vel.length() * dt, d = _v.copy(p.vel).normalize();
    const h = world.raycast(p.pos.x, p.pos.y, p.pos.z, d.x, d.y, d.z, len);
    let boom = null;
    if (p.kind !== 'frag') {
      const zs = p.t > 0.03 ? horde.rayHits(p.pos.x, p.pos.y, p.pos.z, d.x, d.y, d.z, h ? h.t : len) : [];
      if (zs.length) boom = p.pos.clone().addScaledVector(d, zs[0].t);
      else if (h) boom = p.pos.clone().addScaledVector(d, h.t + VOX);
      if (!boom) p.pos.addScaledVector(d, len);
    } else if (h) {
      p.pos.addScaledVector(d, Math.max(0, h.t - 0.03));
      const n = _v2.set(h.nx, h.ny, h.nz), vn = p.vel.dot(n);
      p.vel.addScaledVector(n, -1.5 * vn).multiplyScalar(0.55);
      if (Math.abs(vn) > 2) audio.impact(p.pos.distanceTo(gfx.camera.position), true);
    } else p.pos.addScaledVector(d, len);
    p.fuse -= dt;
    if (!boom && p.fuse <= 0) boom = p.pos.clone();
    if (p.kind === 'rocket') {
      p.mesh.lookAt(_v2.copy(p.pos).add(p.vel));
      if ((p.trail -= dt) <= 0) { p.trail = 0.016; fx.dust(p.pos.x, p.pos.y, p.pos.z, 1, ID.CONC_B, 0.04, 0.3); fx.sparks(p.pos.x, p.pos.y, p.pos.z, 1, -d.x, -d.y, -d.z, 0xffa040, 2); }
    } else if (p.kind === 'nade' && (p.trail -= dt) <= 0) { p.trail = 0.04; fx.dust(p.pos.x, p.pos.y, p.pos.z, 1, ID.PLASTER, 0.02, 0.1); }
    p.mesh.position.copy(p.pos); p.mesh.rotation.x += dt * 8 * (p.kind === 'rocket' ? 0 : 1);
    if (boom || p.pos.y < 0) { explode(boom || p.pos, p.st); gfx.scene.remove(p.mesh); projs.splice(i, 1); }
  }
}
function explode(p, st) {
  const res = breakAt(p.x, p.y, p.z, st.dig, st.tier, { push: 6.5, samples: 240, tall: 1.25 });
  if (!res.removed && res.toughest > st.tier) blockedNote(res.toughMat, st.tier);
  fx.fireball(p.x, p.y, p.z, st.dig); gfx.blastFlash(p.x, p.y + 0.3, p.z);
  const dc = p.distanceTo(gfx.camera.position);
  audio.explosion(dc, Math.min(1.5, st.dig / 1.6));
  fx.shake = Math.max(fx.shake, Math.max(0, 1 - dc / 20) * 0.7);
  const R = Math.max(2.4, st.dig * 2.1);
  for (const zb of horde.list.slice()) {
    const dx = zb.x - p.x, dy = zb.y + 0.9 - p.y, dz = zb.z - p.z, d = Math.hypot(dx, dy, dz);
    if (d < R) hitZombie(zb, st.dmg * (1 - (d / R) * 0.6), { explosive: true, dx: dx / (d || 1), dy: 0.6, dz: dz / (d || 1) });
  }
  const dp = Math.hypot(player.x - p.x, player.y + 0.9 - p.y, player.z - p.z);
  if (dp < R * 0.75 && !player.dead) { player.damage(38 * (1 - dp / (R * 0.75)) + 6); S.hurtFlash = 0.5; audio.hurt(); }
  for (const b of fx.bodies) {
    const bp = b.group.position, d = bp.distanceTo(p);
    if (d < R * 1.6) { const k = (1 - d / (R * 1.6)) * 7 * Math.min(1, 600 / b.n + 0.2); b.vel.addScaledVector(_v.copy(bp).sub(p).normalize(), k); b.vel.y += k * 0.5; b.asleep = false; b.rest = 0; }
  }
}

/* =================================================================== props */
function buildProps() {
  const fy = map.floorY, add = (o) => { gfx.scene.add(o); return o; };
  const place = (o, x, z, nx, nz, y, off = 0.02) => { o.position.set(x + nx * off, fy + y, z + nz * off); o.rotation.y = Math.atan2(nx, nz); return o; };
  const label = (title, sub, x, z, nx, nz, y, accent) => { const l = labelSprite(title, sub, accent); l.position.set(x + nx * 0.25, fy + y, z + nz * 0.25); add(l); props.labels.push(l); return l; };
  for (const wb of map.wallbuys) {
    const W0 = WEAPONS[wb.weapon];
    add(place(rackModel(gunModel(wb.weapon)), wb.x, wb.z, wb.nx, wb.nz, 1.35));
    label(W0.name, `${fmt(wb.price)}  ·  ${W0.cls}`, wb.x, wb.z, wb.nx, wb.nz, 1.95);
    props.inter.push({
      x: wb.x + wb.nx * 0.5, z: wb.z + wb.nz * 0.5,
      text() { const o = owns(wb.weapon); return o ? `Ammo for ${o.st.name} <b>${fmt(o.up ? 2500 : wb.price / 2)}</b>` : `Buy ${W0.name} <b>${fmt(wb.price)}</b>`; },
      use() {
        const o = owns(wb.weapon);
        if (o) { if (o.reserve >= o.st.reserve && o.mag >= o.st.mag) { hud.toast('Ammo is already full'); return; } if (spend(o.up ? 2500 : wb.price / 2)) refill(o); }
        else if (spend(wb.price)) { give(wb.weapon); hud.toast(`${W0.name}: breaks ${W0.tier >= 2 ? 'brick' : W0.tier >= 1 ? 'timber' : 'plaster and glass'}`); }
      },
    });
  }
  for (const s of map.stations) {
    if (s.kind === 'frags') {
      add(place(fragStation(), s.x, s.z, s.nx, s.nz, 1.3)); label('Frag grenades', `${fmt(PRICES.frags)}  ·  4 frags, break brick`, s.x, s.z, s.nx, s.nz, 1.9, '#d8563c');
      props.inter.push({ x: s.x + s.nx * 0.5, z: s.z + s.nz * 0.5, text: () => `Refill frag grenades <b>${fmt(PRICES.frags)}</b>`, use() { if (S.nades >= 4) { hud.toast('You are carrying 4 frags already'); return; } if (spend(PRICES.frags)) S.nades = 4; } });
    } else if (s.kind === 'plating') {
      add(place(platingStation(), s.x, s.z, s.nx, s.nz, 1.0, 0.25)); label('Armour plating', `${fmt(PRICES.plating)}  ·  double health`, s.x, s.z, s.nx, s.nz, 2.15, '#7ad0ff');
      props.inter.push({ x: s.x + s.nx * 0.8, z: s.z + s.nz * 0.8, text: () => (S.plated ? 'Armour plating fitted' : `Fit armour plating <b>${fmt(PRICES.plating)}</b>`), use() { if (S.plated) return; if (spend(PRICES.plating)) { S.plated = true; player.maxHp = 200; player.hp = 200; hud.banner('Armour plating', 'Health raised to 200'); } } });
    } else if (s.kind === 'bench') {
      add(place(benchModel(), s.x, s.z, s.nx, s.nz, 1.0, 0.1)); label('Overclock bench', `${fmt(PRICES.bench)}  ·  +1 breaking tier`, s.x, s.z, s.nx, s.nz, 2.3, '#8a80ff');
      props.inter.push({ x: s.x + s.nx * 1.1, z: s.z + s.nz * 1.1, text: () => (cur().up ? `${cur().st.name} is already overclocked` : `Overclock ${cur().st.name} <b>${fmt(PRICES.bench)}</b>`), use() { if (!cur().up && spend(PRICES.bench)) overclock(); } });
    }
  }
  // the crate: one model per spot, only the active one is shown
  map.crates.forEach((c, i) => {
    const m = crateModel(); m.position.set(c.x, fy, c.z); m.rotation.y = c.yaw; m.visible = false; add(m); props.crates.push(m);
    props.inter.push({ x: c.x, z: c.z, r: 1.7, crate: i, text: crateText, use: crateUse });
  });
  for (const id of CRATE_POOL) { const g = gunModel(id); g.scale.setScalar(1.5); g.visible = false; add(g); props.spinModels[id] = g; }
  props.spinModels.move = boxModel([[0, 0, 0, 0.5, 0.12, 0.12, 0xff3020, 1], [0, 0, 0, 0.12, 0.5, 0.12, 0xff3020, 1], [0, 0, 0, 0.12, 0.12, 0.5, 0xff3020, 1]]);
  props.spinModels.move.visible = false; add(props.spinModels.move);
  // vault core
  const P = map.pedestal, core = props.core = boxModel([[0, 0, 0, 0.32, 0.32, 0.32, 0x8a80ff, 1], [0, 0, 0, 0.44, 0.08, 0.08, 0xffe9a0, 1], [0, 0, 0, 0.08, 0.44, 0.08, 0xffe9a0, 1]]);
  core.position.set(P.x, P.y + 0.45, P.z); add(core);
  props.inter.push({ x: P.x - 0.9, z: P.z, r: 1.9, text: () => (S.coreTaken ? '' : `Take the vault core: free overclock for ${cur().st.name}`), use() { if (S.coreTaken || cur().up) { if (cur().up) hud.toast('Switch to a weapon that is not overclocked'); return; } S.coreTaken = true; core.visible = false; overclock(); } });
  // muzzle flash, tracers, beam
  props.flash = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.18), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.4, 1.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  props.flash.visible = false;
  const TN = 48, tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TN * 6), 3)); tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TN * 6), 3));
  props.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  props.tracers.frustumCulled = false; props.tracers.userData = { n: TN, life: new Float32Array(TN), i: 0 }; add(props.tracers);
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18 * 3), 3));
  props.beam = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 5, 7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  props.beam.frustumCulled = false; props.beam.visible = false; add(props.beam);
}

function overclock() {
  const old = cur(), slot = makeSlot(old.id, true);
  gfx.vmScene.remove(old.model); S.slots[S.cur] = slot; startSwap(); audio.upgrade();
  hud.banner(slot.st.name, `Overclocked · now breaks ${['plaster', 'timber', 'brick', 'concrete', 'vault steel'][slot.st.tier]}`, 3.6);
}

function tracer(o, d, len) {
  const T = props.tracers, u = T.userData, i = u.i = (u.i + 1) % u.n, pos = T.geometry.attributes.position.array;
  muzzleWorld(_v);
  const s = Math.min(len, 3 + Math.random() * 4), a = Math.max(0.4, len - s);
  pos[i * 6] = o.x + d.x * a; pos[i * 6 + 1] = o.y + d.y * a; pos[i * 6 + 2] = o.z + d.z * a;
  pos[i * 6 + 3] = o.x + d.x * len; pos[i * 6 + 4] = o.y + d.y * len; pos[i * 6 + 5] = o.z + d.z * len;
  if (len < 6) { pos[i * 6] = _v.x; pos[i * 6 + 1] = _v.y; pos[i * 6 + 2] = _v.z; }
  u.life[i] = 0.07;
}
function tracersStep(dt) {
  const T = props.tracers, u = T.userData, col = T.geometry.attributes.color.array;
  for (let i = 0; i < u.n; i++) {
    u.life[i] = Math.max(0, u.life[i] - dt); const k = u.life[i] / 0.07;
    col[i * 6] = 2.4 * k * 0.3; col[i * 6 + 1] = 1.7 * k * 0.3; col[i * 6 + 2] = 0.8 * k * 0.3; col[i * 6 + 3] = 2.6 * k; col[i * 6 + 4] = 1.9 * k; col[i * 6 + 5] = 1.0 * k;
  }
  T.geometry.attributes.position.needsUpdate = true; T.geometry.attributes.color.needsUpdate = true;
  // arc beam
  const B = props.beam; B.visible = !!W.beamOn;
  if (W.beamOn) {
    camDir(_fwd); const o = gfx.camera.position, h = world.raycast(o.x, o.y, o.z, _fwd.x, _fwd.y, _fwd.z, 40), len = h ? h.t : 40;
    muzzleWorld(_v); const p = B.geometry.attributes.position.array, n = 18, end = _v2.copy(o).addScaledVector(_fwd, len);
    for (let k = 0; k < n; k++) { const t = k / (n - 1), j = k && k < n - 1 ? 0.08 + len * 0.006 : 0; p[k * 3] = _v.x + (end.x - _v.x) * t + rnd(j); p[k * 3 + 1] = _v.y + (end.y - _v.y) * t + rnd(j); p[k * 3 + 2] = _v.z + (end.z - _v.z) * t + rnd(j); }
    B.geometry.attributes.position.needsUpdate = true;
    if (Math.random() < 0.5) fx.sparks(end.x, end.y, end.z, 2, -_fwd.x, -_fwd.y, -_fwd.z, 0x80f0ff, 3);
  }
}
function showFlash(st) {
  if (st.kind === 'beam') return;
  const m = cur().model; m.add(props.flash); props.flash.position.copy(m.userData.muzzle); props.flash.position.z -= 0.06;
  props.flash.rotation.z = Math.random() * 3; props.flash.scale.setScalar(st.pellets > 1 || st.kind === 'rocket' ? 1.8 : 1);
  props.flash.visible = true; W.flashT = 0.045;
}

/* =================================================================== crate */
function crateText() {
  const C = S.crate;
  if (this.crate !== C.at || C.state === 'leave') return '';
  if (C.state === 'idle') return `Spin the crate for a random weapon <b>${fmt(PRICES.crate)}</b>`;
  if (C.state === 'offer') return `Take ${WEAPONS[C.pick].name}`;
  return '';
}
function crateUse() {
  const C = S.crate; if (this.crate !== C.at) return;
  if (C.state === 'idle') {
    if (!spend(PRICES.crate)) return;
    C.state = 'spin'; C.t = 0; C.tick = 0; C.ticks = 0; C.uses++;
    const others = map.crates.map((c, i) => i).filter((i) => i !== C.at && S.opened.has(map.crates[i].zone));
    C.move = C.uses >= 4 && others.length > 0 && Math.random() < 0.2;
    const pool = CRATE_POOL.filter((id) => !owns(id)); let tot = 0; for (const id of pool) tot += CRATE_WEIGHT[id];
    let r = Math.random() * tot; C.pick = pool[pool.length - 1]; for (const id of pool) { r -= CRATE_WEIGHT[id]; if (r <= 0) { C.pick = id; break; } }
  } else if (C.state === 'offer') {
    hideSpin(); C.state = 'idle'; give(C.pick); hud.toast(`${WEAPONS[C.pick].name}: ${WEAPONS[C.pick].cls}`);
  }
}
function hideSpin() { for (const k in props.spinModels) props.spinModels[k].visible = false; }
function crateStep(dt) {
  const C = S.crate, spot = map.crates[C.at], m = props.crates[C.at], fy = map.floorY;
  props.crates.forEach((c, i) => { c.visible = i === C.at; });
  const lid = m.userData.lid; let open = 0;
  C.t += dt;
  const showAt = (g, h) => { g.position.set(spot.x, fy + h, spot.z); g.rotation.y = spot.yaw + Math.PI / 2 + Math.sin(C.t * 1.5) * 0.25; g.visible = true; };
  if (C.state === 'spin') {
    open = Math.min(1, C.t * 3);
    C.tick -= dt;
    if (C.tick <= 0) { C.ticks++; C.tick = 0.05 + (C.t / 4.2) ** 2 * 0.45; hideSpin(); C.show = CRATE_POOL[(Math.random() * CRATE_POOL.length) | 0]; audio.crateTick(C.ticks); }
    showAt(props.spinModels[C.show], 0.55 + Math.min(1, C.t / 1.2) * 0.45);
    if (C.t >= 4.2) {
      hideSpin(); C.t = 0;
      if (C.move) { C.state = 'leave'; addPoints(PRICES.crate, 'flat'); hud.toast('The crate is relocating. Points refunded'); audio.deny(); }
      else { C.state = 'offer'; audio.crateDone(); }
    }
  } else if (C.state === 'offer') {
    open = 1; showAt(props.spinModels[C.pick], 1.0 - Math.max(0, C.t - 6) / 4 * 0.6);
    if (C.t > 10) { C.state = 'idle'; hideSpin(); }
  } else if (C.state === 'leave') {
    open = 1; showAt(props.spinModels.move, 1 + C.t * 0.4);
    m.position.y = fy + Math.max(0, C.t - 1.2) ** 2 * 3; m.rotation.y = spot.yaw + Math.max(0, C.t - 1.2) * 3;
    if (C.t > 3) {
      hideSpin(); m.position.y = fy; m.rotation.y = spot.yaw;
      const others = map.crates.map((c, i) => i).filter((i) => i !== C.at && S.opened.has(map.crates[i].zone));
      C.at = others[(Math.random() * others.length) | 0] ?? C.at; C.state = 'idle'; C.uses = 0;
      const n = map.crates[C.at]; fx.dust(n.x, fy + 0.3, n.z, 16, ID.CONC, 0.7, 1.2);
      hud.toast(`The crate moved to the ${map.zones.find((z) => z.id === n.zone).name.toLowerCase()}`);
    }
  }
  lid.rotation.x = -open * 1.7;
  m.userData.beam.material.opacity = 0.1 + Math.sin(performance.now() / 300) * 0.03;
}

/* ================================================================ power-ups */
const POWERS = { ammo: 'Max ammo', kill: 'Insta-kill', double: 'Double points', nuke: 'Detonation', cash: 'Bonus points' };
function dropPower(x, z) {
  const kinds = ['ammo', 'ammo', 'kill', 'kill', 'double', 'double', 'nuke', 'cash', 'cash'];
  const kind = kinds[(Math.random() * kinds.length) | 0], mesh = powerupModel(kind);
  const f = nav.floorAt(x, z); mesh.position.set(x, (f >= 0 ? f : map.floorY) + 0.8, z); gfx.scene.add(mesh);
  drops.push({ kind, mesh, x, z, y: mesh.position.y, t: 0 });
}
function dropsStep(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]; d.t += dt;
    d.mesh.rotation.y += dt * 2; d.mesh.position.y = d.y + Math.sin(d.t * 2.4) * 0.1;
    d.mesh.visible = d.t < 20 || ((d.t * 7) | 0) % 2 === 0;
    const take = Math.hypot(d.x - player.x, d.z - player.z) < 1.3 && Math.abs(d.y - player.y - 0.8) < 1.6 && !player.dead;
    if (take || d.t > 26) { gfx.scene.remove(d.mesh); drops.splice(i, 1); if (take) usePower(d.kind); }
  }
  if (S.double > 0) S.double = Math.max(0, S.double - dt);
  if (S.insta > 0) S.insta = Math.max(0, S.insta - dt);
  hud.power('double', 'Double points', S.double); hud.power('kill', 'Insta-kill', S.insta);
}
function usePower(kind) {
  audio.power(); hud.banner(POWERS[kind], '', 2);
  if (kind === 'ammo') { for (const s of S.slots) refill(s); if (S.nades < 4) S.nades = 4; }
  else if (kind === 'kill') S.insta = 30;
  else if (kind === 'double') S.double = 30;
  else if (kind === 'cash') addPoints(500, 'flat');
  else if (kind === 'nuke') {
    fx.shake = 0.6; gfx.blastFlash(player.x, player.y + 6, player.z, 0xfff0c0);
    for (const zb of horde.list.slice()) horde.damage(zb, 1e9, { explosive: true, dy: 1 });
    addPoints(400, 'flat'); audio.explosion(12, 1.5);
  }
}

/* ================================================================== rounds */
function startRound(n) {
  S.round = n; S.phase = 'fight'; S.drops = 0;
  S.toSpawn = Math.round(6 + n * 2.6 + Math.max(0, n - 5) * 2); S.spawnT = 1.5;
  hud.banner(`Round ${n}`, n === 1 ? 'Hold the safehouse' : `${S.toSpawn} incoming`, 3); audio.round(true);
}
function zombieHp(n) { return n < 10 ? 150 + 100 * (n - 1) : 1050 * 1.1 ** (n - 9); }
function spawnOne() {
  const cand = [];
  for (const zn of map.zones) if (S.opened.has(zn.id)) for (const sp of zn.spawns) {
    const d = Math.hypot(sp[0] - player.x, sp[1] - player.z);
    if (d < 6 || world.boxSolid(sp[0] - 0.2, map.floorY + 0.3, sp[1] - 0.2, sp[0] + 0.2, map.floorY + 1.6, sp[1] + 0.2)) continue;
    cand.push({ sp, d, ok: nav.reachable(sp[0], sp[1]) && d < 34 });
  }
  const good = cand.filter((c) => c.ok), pool = good.length ? good : cand;
  if (!pool.length) return false;
  const c = pool[(Math.random() * pool.length) | 0], n = S.round;
  let sp = 1.2 + Math.random() * 0.35;
  if (Math.random() < Math.min(0.85, (n - 2) * 0.14)) sp = 3.1 + Math.random() * 0.8;
  if (n >= 8 && Math.random() < 0.25) sp = 4.3;
  const f = nav.floorAt(c.sp[0], c.sp[1]);
  return !!horde.spawn(c.sp[0] + rnd(0.3), c.sp[1] + rnd(0.3), zombieHp(n), sp, f >= 0 ? f : map.floorY);
}
function roundsStep(dt) {
  if (S.phase === 'break') { S.breakT -= dt; if (S.breakT <= 0) startRound(S.round + 1); return; }
  S.spawnT -= dt;
  const maxAlive = Math.min(24, 5 + S.round * 2);
  if (S.toSpawn > 0 && S.spawnT <= 0 && horde.list.length < maxAlive) { if (spawnOne()) S.toSpawn--; S.spawnT = Math.max(0.35, 2.1 - S.round * 0.15) * (0.6 + Math.random() * 0.8); }
  if (S.toSpawn === 0 && horde.list.length === 0) {
    S.phase = 'break'; S.breakT = 9; audio.round(false); hud.banner(`Round ${S.round} survived`, 'Next wave in 9 seconds', 3.5);
    S.best = Math.max(S.best, S.round); store.set('best', S.best);
  }
}

/* =================================================================== run */
function newRun(first) {
  if (!first) {
    world.data.fill(0); map = buildMap(world); gfx.map = map;
    gfx.occUpdate([0, 0, 0, SX - 1, SY - 1, SZ - 1]); gfx.buildAll(); nav.rebuild(0, 0, 9999, 9999);
    for (const b of fx.bodies.slice()) fx.crumble(b);
    fx.chips.n = 0; fx.glow.n = 0; horde.clear();
    for (const p of projs) gfx.scene.remove(p.mesh); projs.length = 0;
    for (const d of drops) gfx.scene.remove(d.mesh); drops.length = 0;
    for (const s of S.slots) gfx.vmScene.remove(s.model);
    props.core.visible = true; hideSpin();
  }
  Object.assign(S, { phase: 'break', round: 0, breakT: 4, points: 500, earned: 0, kills: 0, heads: 0, toSpawn: 0, spawnT: 0, slots: [], cur: 0, nades: 0, double: 0, insta: 0,
    opened: new Set(['A']), deepest: 'A', plated: false, coreTaken: false, hurtFlash: 0, deadT: 0, crushCD: 0, best: store.get('best', 0),
    crate: { at: map.crates.findIndex((c) => c.zone === 'A'), state: 'idle', t: 0, uses: 0, pick: null, show: null } });
  Object.assign(W, { flowT: 0, fireT: 0, reloadT: 0, swapT: 0, knifeT: 0, nadeT: 0, aimK: 0, kick: 0, aimToggle: false, noteAt: 0, flashT: 0, beamOn: false, autoReload: 0, target: null });
  player.reset(); player.maxHp = 100; player.hp = 100;
  give('rook'); W.swapT = 0;
  hud.reset(); nav.flow(player.x, player.z);
}

function zonesStep() {
  const zn = zoneAt(map, player.x, player.z);
  if (zn && !S.opened.has(zn.id)) {
    S.opened.add(zn.id); audio.zone();
    if (ZONE_ORDER.indexOf(zn.id) > ZONE_ORDER.indexOf(S.deepest)) S.deepest = zn.id;
    addPoints(zn.id === 'E' ? 2500 : 250, 'flat');
    hud.banner(zn.name, zn.id === 'E' ? 'Vault breached. Shoot the gold for points' : 'New area opened', 3.4);
  }
  S.zoneName = zn ? zn.name : S.zoneName;
  const h = S.deepest === 'E' ? (S.coreTaken ? 'Shoot the gold bars for points' : 'Take the vault core from the pedestal') : map.hints[S.deepest];
  hud.hint(S.round >= 1 ? `${S.zoneName || ''}  ·  ${h}` : '');
}

/* ================================================================ interact */
function interactStep() {
  camDir(_fwd);
  let best = null, bd = 9;
  for (const it of props.inter) {
    const dx = it.x - player.x, dz = it.z - player.z, d = Math.hypot(dx, dz), r = it.r || 1.5;
    if (d > r || Math.abs(player.y - map.floorY) > 0.8) continue;
    if (d > 0.7 && (dx * _fwd.x + dz * _fwd.z) / d < 0.2) continue;
    const t = it.text(); if (!t) continue;
    if (d < bd) { bd = d; best = { it, t }; }
  }
  W.target = best;
  const key = input.touch ? 'Use' : input.pad ? 'X' : 'E';
  hud.prompt(best && !player.dead ? `<kbd>${key}</kbd> ${best.t}` : null);
  if (best && input.hit('KeyE', 'KeyF', 'T:use', 'PadX')) best.it.use();
  for (const l of props.labels) { const d2 = l.position.distanceToSquared(gfx.camera.position); l.visible = d2 < 81 && d2 > 2.2; }
}

/* ================================================================== camera */
const hip = new THREE.Vector3(0.16, -0.19, -0.42), ads = new THREE.Vector3(0, -0.092, -0.34);
const VM_OFF = { ramrod: [0.22, -0.16, -0.62], longbow: [0.16, -0.19, -0.5], hog: [0.17, -0.2, -0.46] };
let knifeModel = null;
function cameraStep(dt) {
  const cam = gfx.camera, slot = cur(), st = slot.st;
  const k = 0.0022 * sens * (1 - W.aimK * (st.zoom ? 0.75 : 0.35));
  player.yaw -= input.lookX * k; player.pitch = Math.max(-1.52, Math.min(1.52, player.pitch - input.lookY * k));
  const bob = player.onGround ? Math.sin(player.bob * 2) * 0.035 * Math.min(1, player.speed / 4) * (1 - W.aimK * 0.8) : 0;
  cam.position.set(player.x, player.eyeY + bob, player.z);
  const sh = fx.shake * fx.shake;
  cam.rotation.set(player.pitch + rnd(sh * 0.05), player.yaw + rnd(sh * 0.05), rnd(sh * 0.03));
  const scoped = st.zoom && W.aimK > 0.85;
  const fov = 78 - W.aimK * (st.zoom ? 78 - 78 / st.zoom : 16) + (player.sprinting ? 4 : 0);
  if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 18); cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld();
  // viewmodel
  for (const s of S.slots) s.model.visible = s === slot && !scoped && W.knifeT <= 0.05;
  const m = slot.model, a = W.aimK;
  const vo = VM_OFF[slot.id]; m.position.lerpVectors(vo ? _v.set(...vo) : hip, ads, a);
  const t = player.bob * 2, mv = Math.min(1, player.speed / 4) * (1 - a * 0.85);
  m.position.x += Math.cos(t * 0.5) * 0.012 * mv; m.position.y += -Math.abs(Math.sin(t * 0.5)) * 0.014 * mv;
  m.position.z += W.kick * 0.06 * (1 - a * 0.5);
  W.swayX = (W.swayX || 0) * Math.exp(-10 * dt) + input.lookX * 0.00012; W.swayY = (W.swayY || 0) * Math.exp(-10 * dt) + input.lookY * 0.00012;
  let rx = W.kick * 0.18 * (1 - a * 0.6) - W.swayY, ry = W.swayX, rz = 0;
  if (W.reloadT > 0) { const p = 1 - W.reloadT / st.reload, s = Math.sin(Math.min(1, p * 1.15) * Math.PI); rx -= s * 0.45; rz += s * 0.4; m.position.y -= s * 0.1; }
  if (W.swapT > 0) { const s = W.swapT / 0.45; m.position.y -= s * 0.3; rx -= s * 0.6; }
  if (player.sprinting && W.reloadT <= 0) { ry += 0.55; rz += 0.25; m.position.x -= 0.04; m.position.y -= 0.03; }
  m.rotation.set(rx, ry, rz);
  m.updateMatrix();
  if (!knifeModel) { knifeModel = gunModel('knife'); gfx.vmScene.add(knifeModel); }
  knifeModel.visible = W.knifeT > 0;
  if (W.knifeT > 0) { const p = 1 - W.knifeT / 0.5, s = Math.sin(Math.min(1, p * 1.6) * Math.PI); knifeModel.position.set(0.2 - s * 0.22, -0.2 + s * 0.06, -0.3 - s * 0.18); knifeModel.rotation.set(-0.2, 0.9 - s * 1.4, -0.5 + s * 0.3); }
  if (W.flashT > 0 && (W.flashT -= dt) <= 0) props.flash.visible = false;
  gfx.vmSun.position.set(0.4, 0.8, 0.3);
}

/* ==================================================================== HUD */
function hudStep(dt) {
  const slot = cur(), other = S.slots[1 - S.cur];
  S.hurtFlash = Math.max(0, S.hurtFlash - dt * 1.6);
  const left = S.phase === 'fight' ? S.toSpawn + horde.list.length : 0;
  hud.stats({
    round: S.round || 0, points: S.points, ammo: slot.st.kind === 'beam' ? slot.mag : slot.mag, reserve: slot.reserve, wname: slot.st.name, wcls: slot.st.cls, other: other ? `${other.st.name}  [Q]` : '',
    hp: player.hp, maxHp: player.maxHp, nades: S.nades, lowAmmo: slot.mag <= Math.ceil(slot.st.mag * 0.25), hurtFlash: S.hurtFlash,
    gap: 5 + (slot.st.spread * 260 + (player.speed > 0.5 ? 6 : 0) + W.kick * 8) * (1 - W.aimK), scoped: !!slot.st.zoom && W.aimK > 0.85,
    left: S.phase === 'fight' ? `${left} left` : S.round ? 'Break' : 'Get ready',
  });
  hud.update(dt);
}

/* ================================================================== loop */
let last = performance.now(), fpsAcc = 0, fpsN = 0;
function step(dt) {
  player.update(dt, input, false);
  if (player.y < -2) { player.reset(); }
  weaponsStep(dt);
  horde.update(dt, player, S.round);
  projStep(dt); dropsStep(dt); crateStep(dt); roundsStep(dt); zonesStep(); interactStep();
  S.crushCD = Math.max(0, S.crushCD - dt);
  if (player.dead) { S.deadT += dt; if (S.deadT > 2.6) gameOver(); }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (state === 'boot') return;
  input.poll();
  if (input.hit('Escape') && (state === 'play') && (input.touch || input.lockFailed || !input.locked)) pause();
  if (state === 'play') step(dt);
  if (state === 'play' || state === 'over') {
    cameraStep(dt);
  } else if (state === 'menu') {
    const t = now / 1000, c = gfx.camera;
    c.position.set(20.5 + Math.sin(t * 0.13) * 1.2, 2.3 + Math.sin(t * 0.2) * 0.2, 9.6 + Math.cos(t * 0.11) * 0.8);
    c.lookAt(15, 1.6, 6.6); c.updateMatrixWorld();
    for (const s of S.slots) s.model.visible = false;
  }
  if (state !== 'pause') {
    fx.listener.copy(gfx.camera.position);
    fx.update(dt);
    tracersStep(dt);
    const b = gfx.flush(dt);
    if (b) { nav.rebuildVoxBox(b); W.flowT = 0; }
    if ((W.flowT -= dt) <= 0 && state === 'play') { nav.flow(player.x, player.z); W.flowT = 0.25; }
    gfx.updateLamps(gfx.camera.position.x, gfx.camera.position.y, gfx.camera.position.z, dt);
    props.core.rotation.y += dt; props.core.rotation.x += dt * 0.6;
  }
  if (state === 'play') hudStep(dt);
  $('touch').hidden = !(input.touch && state === 'play');
  gfx.resize();
  gfx.render();
  input.endFrame();
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { $('fps').textContent = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
}

/* ================================================================ screens */
const screens = ['intro', 'pause', 'over'];
function showScreen(id) { for (const s of screens) $(s).hidden = s !== id; hud.show(state === 'play' || state === 'over'); }
async function play() {
  audio.start(); state = 'play'; showScreen(null); hud.show(true);
  const ok = await input.capture();
  if (!ok && !input.touch && !input.locked) hud.toast('Mouse capture is not available here: hold the mouse button and drag to look', 5);
  canvas.focus();
}
function pause() { if (state !== 'play') return; state = 'pause'; audio.arc(false); input.release(); showScreen('pause'); }
function gameOver() {
  state = 'over'; input.release(); audio.arc(false);
  S.best = Math.max(S.best, S.round); store.set('best', S.best);
  $('overRound').textContent = S.round; $('overKills').textContent = fmt(S.kills); $('overPoints').textContent = fmt(S.earned);
  $('overBest').textContent = S.best; $('overZone').textContent = map.zones.find((z) => z.id === S.deepest).name;
  $('overTitle').textContent = S.round >= 10 ? 'You held out' : 'Overrun';
  showScreen('over');
}

function controlsTabs() {
  const sets = {
    keyboard: [['W A S D', 'Move'], ['Mouse', 'Aim · left click fires'], ['Right mouse', 'Aim down sights'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['R', 'Reload'], ['Q · wheel · 1 2', 'Swap weapon'], ['G', 'Throw frag'], ['V', 'Knife'], ['E', 'Buy · use · take'], ['Esc', 'Pause']],
    gamepad: [['Left stick', 'Move · click to sprint'], ['Right stick', 'Look'], ['RT · LT', 'Fire · aim'], ['A', 'Jump'], ['X', 'Buy and use, or reload'], ['Y', 'Swap weapon'], ['RB', 'Throw frag'], ['LB · R3', 'Knife'], ['Menu', 'Pause']],
    touch: [['Left thumb', 'Move · push to the top to sprint'], ['Right thumb', 'Look'], ['Fire', 'Hold to shoot, drag to aim'], ['Aim', 'Toggle sights'], ['Use', 'Buy · take'], ['Frag · Knife · Swap', 'Top row of buttons'], ['Reload · Jump', 'Beside Fire']],
  };
  for (const box of document.querySelectorAll('[data-ctl]')) {
    const panel = box.querySelector('[data-panel]'), tabs = box.querySelectorAll('.tab');
    const set = (k) => { tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === k))); panel.innerHTML = '<dl class="keys">' + sets[k].map(([a, b]) => `<dt>${a.split(' · ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</dt><dd>${b}</dd>`).join('') + '</dl>'; };
    tabs.forEach((t) => t.addEventListener('click', () => set(t.dataset.tab)));
    set(matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard');
  }
}

function setLoad(k, t) { $('loadFill').style.width = `${Math.round(k * 100)}%`; $('loadText').textContent = t; }

async function boot() {
  controlsTabs();
  setLoad(0.08, 'Pouring 1.8 million voxels…'); await nextFrame();
  world = new World(SX, SY, SZ); map = buildMap(world);
  setLoad(0.3, 'Lighting the block…'); await nextFrame();
  try { gfx = new Gfx(canvas, world, map, qi); }
  catch (e) { setLoad(0, 'WebGL 2 is not available in this browser, so the game cannot start.'); console.error(e); return; }
  setLoad(0.45, 'Meshing 432 chunks…'); await nextFrame();
  gfx.buildAll();
  setLoad(0.75, 'Routing the horde…'); await nextFrame();
  audio = new Audio(); audio.setOn(store.get('sound', true));
  nav = new Nav(world); fx = new Fx(gfx, world, audio); horde = new Horde(gfx, world, nav, fx, audio);
  player = new Player(world, map); input = new Input(canvas, $('touch')); hud = new Hud();
  try { await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]); } catch { /* fonts optional */ }
  buildProps();
  horde.onKill = (zb, info) => { S.kills++; if (info.head) S.heads++; if (S.drops < 4 && Math.random() < 0.035) { S.drops++; dropPower(zb.x, zb.z); } };
  horde.onLost = () => { S.toSpawn++; };
  horde.onAttack = () => { player.damage(40); audio.hurt(); S.hurtFlash = 0.8; fx.shake = Math.max(fx.shake, 0.3); };
  fx.onCrush = (b) => {
    const p = b.group.position, r = b.rad * 0.75;
    for (const zb of horde.list.slice()) if (Math.hypot(zb.x - p.x, zb.z - p.z) < r && zb.y < p.y && zb.y + 2 > p.y - b.rad) { if (hitZombie(zb, 1e9, { crush: true, dx: b.vel.x * 0.2, dy: 0.3, dz: b.vel.z * 0.2 })) hud.toast('Crushed'); }
    if (S.crushCD <= 0 && b.vel.y < -3 && Math.hypot(player.x - p.x, player.z - p.z) < r && player.y < p.y && player.y + 1.9 > p.y - b.rad) { S.crushCD = 1; player.damage(35); S.hurtFlash = 0.8; audio.hurt(); }
  };
  input.onLockChange = (locked) => { if (!locked && state === 'play' && !input.touch && !input.lockFailed) pause(); };
  canvas.addEventListener('mousedown', () => { if (state === 'play' && !input.locked && !input.lockFailed && !input.touch) input.capture(); });
  newRun(true);
  // settings
  const qs = $('qualSel'); qs.value = String(qi); qs.addEventListener('change', () => { qi = +qs.value; store.set('quality', qi); gfx.setQuality(qi); });
  const ss = $('sndSel'); ss.value = audio.on ? '1' : '0'; ss.addEventListener('change', () => { audio.setOn(ss.value === '1'); store.set('sound', ss.value === '1'); });
  const sr = $('sensRange'); sr.value = String(sens); $('sensOut').textContent = sens.toFixed(2);
  sr.addEventListener('input', () => { sens = +sr.value; $('sensOut').textContent = sens.toFixed(2); store.set('sens', sens); });
  $('startBtn').addEventListener('click', play);
  $('resumeBtn').addEventListener('click', play);
  $('restartBtn').addEventListener('click', () => { newRun(false); play(); });
  $('againBtn').addEventListener('click', () => { newRun(false); play(); });
  $('pauseBtn').addEventListener('click', pause);
  addEventListener('keydown', (e) => { if (e.code === 'KeyM' && audio) { audio.setOn(!audio.on); store.set('sound', audio.on); hud.toast(audio.on ? 'Sound on' : 'Sound off'); } });
  $('bestRound').textContent = store.get('best', 0) ? `Best: round ${store.get('best', 0)}` : '';
  setLoad(1, 'Ready');
  $('load').hidden = true; $('startBtn').disabled = false; $('intro').classList.remove('boot');
  state = 'menu';
  window.__bf = { S, W, get player() { return player; }, get horde() { return horde; }, get world() { return world; }, get map() { return map; }, get gfx() { return gfx; }, get fx() { return fx; }, give, startRound, play, explode, stats, fireOnce, newRun, get state() { return state; } };
}

requestAnimationFrame(frame);
boot();
