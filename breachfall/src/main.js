// Breachfall: round-based survival in a fully destructible voxel city block, solo or co-op.
// Earn points, buy heavier weapons off the walls or from the crate, blast your way into new areas, go down
// under the vault, kill the Warden, and take the Matter Destroyer.
//
// Co-op model: the host's game is the authority for zombies, rounds, power-ups and the ORDER of every change to
// the world. A wall breaking is an "edit" that the host numbers and sends to everyone; since the level and the
// carving maths are deterministic, every player's world stays identical. Physics pieces are owned by whoever
// set them moving (or grabbed them) and that player streams where they are.

import * as THREE from 'three';
import { VOX, SX, SY, SZ, MAT, ID, TIER_NEED, WEAPONS, CRATE_POOL, CRATE_WEIGHT, PRICES, FRAG } from './config.js';
import { World } from './voxels.js';
import { buildMap, zoneAt } from './map.js';
import { Nav } from './nav.js';
import { Gfx } from './gfx.js';
import { Fx } from './fx.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Horde } from './zombies.js';
import { Hud } from './hud.js';
import { Net } from './net.js';
import { Remotes, COLORS } from './remote.js';
import { gunModel, labelSprite, rackModel, fragStation, platingStation, benchModel, crateModel, powerupModel, boxModel } from './models.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('breachfall.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('breachfall.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const r2 = (v) => Math.round(v * 100) / 100;
const ZONE_ORDER = 'ABCDEFG';
const MAT_TOUGH = (m) => MAT[m].name.charAt(0).toUpperCase() + MAT[m].name.slice(1);
const TIER_WORD = ['plaster', 'timber', 'brick', 'concrete', 'vault steel', 'vault alloy'];
const BOSS_NAME = 'The Warden';
const G = 19;

const canvas = $('gl');
let qi = store.get('quality', matchMedia('(pointer: coarse)').matches ? 0 : 1);
let sens = store.get('sens', 1);
let world, map, gfx, nav, fx, horde, player, audio, input, hud, remotes;
const net = new Net();
let state = 'boot';
const S = {};               // the current run
const W = {};               // weapon handling state
const M = { held: null, beam: 0, end: new THREE.Vector3(), tick: 0, grabCD: 0, holdDist: 3, pending: 0 }; // Matter Destroyer
const props = { inter: [], labels: [], crates: [], spinModels: {}, flash: null, tracers: null, beam: null, tether: null, core: null, matter: null };
const projs = [], drops = new Map();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const NULL_INPUT = { moveX: 0, moveZ: 0, sprint: false, hit: () => false };

/* ================================================================== weapons */
function stats(id, up) {
  const B = WEAPONS[id];
  let st = !up ? B : { ...B, name: B.name + ' OC', dmg: B.dmg * 2.2, mag: Math.ceil(B.mag * 1.5), reserve: Math.ceil(B.reserve * 1.6), tier: Math.min(4, B.tier + 1), dig: B.dig * 1.25, rpm: B.rpm * 1.1, reload: B.reload * 0.8, spread: B.spread * 0.8, up: true };
  if (S.charged && st.tier < 5) st = { ...st, tier: 5, charged: true, cls: st.cls + ' · fusion-charged' };
  return st;
}
function restat() { for (const s of S.slots) { s.st = stats(s.id, s.up); s.mag = Math.min(s.mag, s.st.mag); } }
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
function startSwap() { W.swapT = 0.45; W.reloadT = 0; audio.swap(); audio.arc(false); if (M.held) releaseHold(false); }

function addPoints(n, kind = '') {
  if (n > 0 && S.double > 0 && kind !== 'flat') n *= 2;
  S.points += n; S.earned += Math.max(0, n);
  if (n) hud.pop(n, kind === 'flat' ? '' : kind);
}
function spend(n) {
  if (S.points < n) { audio.deny(); hud.toast(`You need ${fmt(n - S.points)} more points`); return false; }
  S.points -= n; audio.buy(); hud.pop(-n, 'spend'); return true;
}

/* ============================================================ world edits */
// Every change to the voxel world goes through here, so co-op players stay in step.
function edit(e) {
  e.by = e.by ?? net.id;
  if (net.client) { net.send({ k: 'edit', e }); return; }
  e.s = ++S.seq;
  if (net.host) { S.log.push(e); net.broadcast({ k: 'w', e }); }
  applyEdit(e);
}
function applyEdit(e, silent = false) {
  S.seq = Math.max(S.seq, e.s);
  if (silent) { const r = world.carve(e.x, e.y, e.z, e.r, e.tier, 0, e.o?.tall ?? 1); world.findIslands(r.seeds); return; }
  if (e.t === 'grab') {
    const b = fx.extract(e.x, e.y, e.z, e.r, e.tier, `${e.s}.g`, e.s);
    if (!b) { if (e.by === net.id) M.pending = 0; return; }
    b.owner = e.by;
    if (e.by === net.id) attachHold(b, false);
    else if (e.by === 'boss') { b.net = true; if (!net.client) { b.held = true; S.bossRock = b; } else b.remote = performance.now(); }
    else b.remote = performance.now();
    return;
  }
  const res = fx.blast(e.x, e.y, e.z, e.r, e.tier, { ...e.o, eid: e.s });
  if (e.by === net.id) {
    if (res.gold) addPoints(res.gold * 3, 'gold');
    if (!res.removed && res.toughest > e.tier && e.o?.note) blockedNote(res.toughMat, e.tier);
  }
}
function breakAt(x, y, z, r, tier, o = {}) { edit({ t: 'blast', x, y, z, r, tier, o }); }

/* ============================================================ zombie damage */
// the local player hits a zombie; on a co-op client the host decides whether it died
function hitZombie(zb, dmg, info = {}) {
  info.by = net.id;
  if (S.insta > 0 && zb.type !== 'boss') dmg = 1e9;
  if (zb.swept) return false;
  const killed = horde.damage(zb, dmg, info);
  if (!killed && !info.quiet) { addPoints(10); hud.hitmark(info.head ? 'head' : ''); audio.hitmark(info.head); audio.flesh(); }
  if (net.client && dmg >= 1e8) zb.swept = true;
  return killed;
}
function killPoints(info) { return info.grab || info.vapor ? 100 : info.knife ? 130 : info.crush ? 100 : info.head ? 100 : 60; }
// runs on every machine when a zombie dies (the host broadcasts it)
function onKill(zb, info) {
  const pts = info.pts ?? (zb.type === 'boss' ? 2000 : killPoints(info));
  if (info.by === net.id) { addPoints(pts, info.head ? 'head' : ''); hud.hitmark('kill'); audio.hitmark(true); S.kills++; if (info.head) S.heads++; if (info.crush) hud.toast('Crushed'); }
  if (net.client) return;
  if (net.host) net.broadcast({ k: 'kill', id: zb.id, info: { part: info.part, dx: r2(info.dx || 0), dy: r2(info.dy || 0), dz: r2(info.dz || 0), explosive: info.explosive, vapor: info.vapor, dis: info.dis, speed: info.speed, crush: info.crush, grab: info.grab, head: info.head, by: info.by, pts, quiet: info.quiet } });
  if (zb.type === 'boss') bossDown(zb);
  else if (S.drops < 4 && Math.random() < 0.035 && !info.grab) { S.drops++; dropPower(zb.x, zb.y, zb.z); }
}

function camDir(out) { return gfx.camera.getWorldDirection(out); }
function muzzleWorld(out) {
  // the viewmodel lives in camera space; map its muzzle into the world (approximate: different fov)
  const m = cur().model; out.copy(m.userData.muzzle).applyMatrix4(m.matrix);
  out.z *= 0.75; return out.applyMatrix4(gfx.camera.matrixWorld);
}

function blockedNote(mat, tier) {
  const t = MAT[mat].tier;
  if (t <= tier || performance.now() - W.noteAt < 3500 || (t >= 9 && S.stoneNoted)) return;
  W.noteAt = performance.now(); if (t >= 9) S.stoneNoted = true;
  hud.toast(t >= 9 ? 'Stone and blast walls cannot be broken' : `${MAT_TOUGH(mat)} needs ${TIER_NEED[t]}`);
}

const BLOOD = [ID.BLOOD, ID.FLESH, ID.BLOOD];
function fireHitscan(st, o, d, ends) {
  const range = st.range ? st.range * 2.2 : 140;
  const h = world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range);
  const tw = h ? h.t : range;
  let pen = st.pen || 0, stopped = false, hitAny = false;
  for (const hz of horde.rayHits(o.x, o.y, o.z, d.x, d.y, d.z, tw)) {
    const fall = st.range ? Math.max(0.3, 1 - Math.max(0, hz.t - st.range * 0.4) / st.range) : 1;
    const mult = hz.head ? st.head || 1.5 : hz.part === 2 ? 1 : 0.85;
    hitZombie(hz.z, st.dmg * mult * fall, { head: hz.head, part: hz.part, dx: d.x, dy: d.y, dz: d.z, quiet: hitAny });
    hitAny = true;
    fx.gore(o.x + d.x * hz.t, o.y + d.y * hz.t, o.z + d.z * hz.t, d.x, d.y, d.z, 3, BLOOD);
    if (pen-- <= 0) { stopped = true; tracer(o, d, hz.t); ends.push(hz.t); break; }
  }
  if (stopped) return;
  tracer(o, d, tw); ends.push(tw);
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
  const dir = new THREE.Vector3(), shots = [];
  if (st.kind === 'hit' || st.kind === 'beam') {
    for (let p = 0; p < st.pellets; p++) {
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * spread, ends = [];
      dir.copy(_fwd).addScaledVector(right, Math.cos(a) * r).addScaledVector(upv, Math.sin(a) * r).normalize();
      fireHitscan(st, o, dir, ends);
      shots.push([r2(dir.x), r2(dir.y), r2(dir.z), r2(ends[0] || 0)]);
    }
  } else {
    dir.copy(_fwd).addScaledVector(right, rnd(spread)).addScaledVector(upv, rnd(spread)).normalize();
    launch(st.kind, st, o.clone().addScaledVector(_fwd, 0.5).addScaledVector(upv, -0.08), dir);
  }
  if (st.kind !== 'beam') audio.shot(st.snd);
  if (net.active && (shots.length || st.kind !== 'hit')) net.send({ k: 'fx', t: 'shot', w: slot.id, o: [r2(o.x), r2(o.y), r2(o.z)], s: shots, from: net.id });
  const rk = st.recoil * (0.75 + Math.random() * 0.5) * (1 - aimK * 0.4);
  player.pitch = Math.min(1.5, player.pitch + rk); player.yaw += rnd(rk * 0.35);
  W.kick = Math.min(1, W.kick + 0.35 + rk * 4);
  showFlash(st);
  muzzleWorld(_v); gfx.muzzleFlash(_v, st.kind === 'beam' ? 0x60e8ff : 0xffb060);
  if (slot.mag === 0 && slot.reserve > 0) W.autoReload = 0.25;
}

function startReload() {
  const slot = cur();
  if (slot.st.kind === 'matter' || W.reloadT > 0 || W.swapT > 0 || slot.mag >= slot.st.mag || slot.reserve <= 0) return;
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
  // knife and frags work with every weapon
  if (input.hit('KeyV', 'T:melee') && W.knifeT <= 0) knife();
  if (input.hit('KeyG', 'T:nade') && W.nadeT <= 0 && W.knifeT <= 0) {
    if (S.nades > 0) {
      S.nades--; W.nadeT = 0.8; camDir(_fwd);
      launch('frag', FRAG, gfx.camera.position.clone().addScaledVector(_fwd, 0.4), _fwd.clone().add(new THREE.Vector3(0, 0.18, 0)).normalize());
      audio.knife();
    } else if (performance.now() - W.noteAt > 2000) { W.noteAt = performance.now(); hud.toast('No frags. Buy them at the frag rack in the yard'); }
  }
  W.kick = Math.max(0, W.kick - dt * 7);
  if (st.kind === 'matter') { W.aimK += (0 - W.aimK) * (1 - Math.exp(-14 * dt)); W.beamOn = false; audio.arc(false); return; }
  // aim
  if (input.hit('T:aim')) W.aimToggle = !W.aimToggle;
  const aiming = (input.aim || W.aimToggle) && W.reloadT <= 0 && W.swapT <= 0 && W.knifeT <= 0 && !player.sprinting;
  W.aimK += ((aiming ? 1 : 0) - W.aimK) * (1 - Math.exp(-14 * dt));
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
}

function knife() {
  W.knifeT = 0.5; audio.knife();
  camDir(_fwd);
  let best = null, bd = 1.8;
  for (const zb of horde.list) {
    const dx = zb.x - player.x, dz = zb.z - player.z, d = Math.hypot(dx, dz);
    if (d < bd + (zb.scale - 1) * 0.6 && Math.abs(zb.y - player.y) < 1.5 && (dx * _fwd.x + dz * _fwd.z) / (d || 1) > 0.45) { best = zb; bd = d; }
  }
  setTimeout(() => {
    if (state !== 'play') return;
    if (best && horde.list.includes(best)) { hitZombie(best, 150, { knife: true, part: 2, dx: _fwd.x, dy: 0, dz: _fwd.z }); return; }
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
function launch(kind, st, pos, dir, remote = false) {
  const speed = kind === 'rocket' ? 34 : kind === 'nade' ? 30 : 15;
  const mesh = new THREE.Mesh(projGeo, projMats[kind]); mesh.position.copy(pos);
  if (kind === 'rocket') mesh.scale.set(1, 1, 3.2);
  gfx.scene.add(mesh);
  const vel = dir.clone().multiplyScalar(speed); if (!remote) vel.add(new THREE.Vector3(player.vx * 0.5, 0, player.vz * 0.5));
  projs.push({ kind, st, pos: pos.clone(), vel, mesh, t: 0, fuse: kind === 'frag' ? st.fuse : 6, trail: 0, remote });
  if (!remote && net.active) net.send({ k: 'fx', t: 'proj', kind, p: [pos.x, pos.y, pos.z], d: [dir.x, dir.y, dir.z], from: net.id });
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
    if (boom || p.pos.y < -2) {
      gfx.scene.remove(p.mesh); projs.splice(i, 1);
      const at = boom || p.pos;
      if (p.remote) boomVisual(at.x, at.y, at.z, p.st.dig);   // the owner sends the real explosion
      else explodeLocal(at, p.st);
    }
  }
}
function boomVisual(x, y, z, dig) {
  fx.fireball(x, y, z, dig); gfx.blastFlash(x, y + 0.3, z);
  const dc = Math.hypot(x - gfx.camera.position.x, y - gfx.camera.position.y, z - gfx.camera.position.z);
  audio.explosion(dc, Math.min(1.5, dig / 1.6));
  fx.shake = Math.max(fx.shake, Math.max(0, 1 - dc / 20) * 0.7);
}
// my own projectile went off
function explodeLocal(p, st) {
  boomVisual(p.x, p.y, p.z, st.dig);
  const s = { dig: st.dig, tier: st.tier, dmg: st.dmg };
  if (net.client) net.send({ k: 'boom', p: [p.x, p.y, p.z], st: s });
  else explode(p, s, net.id);
}
// the authoritative part of an explosion (solo or host): break the world, hurt everything near it
function explode(p, st, by) {
  edit({ t: 'blast', x: p.x, y: p.y, z: p.z, r: st.dig, tier: st.tier, o: { push: 6.5, samples: 240, tall: 1.25, note: true }, by });
  if (net.host) net.broadcast({ k: 'fx', t: 'boom', p: [p.x, p.y, p.z], dig: st.dig }, by === 'h' ? null : by);
  const R = Math.max(2.4, st.dig * 2.1);
  for (const zb of horde.list.slice()) {
    const dx = zb.x - p.x, dy = zb.y + 0.9 * zb.scale - p.y, dz = zb.z - p.z, d = Math.hypot(dx, dy, dz) - (zb.scale - 1) * 0.6;
    if (d < R) {
      const dmg = st.dmg * (1 - (Math.max(0, d) / R) * 0.6) * (S.insta > 0 && zb.type !== 'boss' ? 1e9 : 1);
      if (!horde.damage(zb, dmg, { explosive: true, dx: dx / (d || 1), dy: 0.6, dz: dz / (d || 1), by }) && by === net.id) addPoints(10);
    }
  }
  for (const t of targets()) {
    const dp = Math.hypot(t.x - p.x, t.y + 0.9 - p.y, t.z - p.z);
    if (dp < R * 0.75 && !t.dead) hurtPlayer(t.id, 38 * (1 - dp / (R * 0.75)) + 6);
  }
  for (const b of fx.bodies) {
    const bp = b.group.position, d = bp.distanceTo(p);
    if (d < R * 1.6 && !b.held && !b.remote) { const k = (1 - d / (R * 1.6)) * 7 * Math.min(1, 600 / b.mass + 0.2); b.vel.addScaledVector(_v.copy(bp).sub(p).normalize(), k); b.vel.y += k * 0.5; b.asleep = false; b.rest = 0; }
  }
}

/* ============================================================== players */
function myState() {
  const s = cur();
  return { x: r2(player.x), y: r2(player.y), z: r2(player.z), yaw: r2(player.yaw), pitch: r2(player.pitch), w: s ? s.id : 'rook', up: !!(s && s.up), hp: Math.ceil(player.hp), mhp: player.maxHp,
    dead: player.dead, name: S.name, c: S.color, beam: M.beam, b: M.beam ? [r2(M.end.x), r2(M.end.y), r2(M.end.z)] : null, g: player.onGround };
}
// everyone the zombies can go for (the host knows where every player is)
function targets() {
  const me = { id: net.id, x: player.x, y: player.y, z: player.z, dead: player.dead || state === 'over', onGround: player.onGround };
  const out = [me];
  if (net.host) for (const [id, s] of S.peers) out.push({ id, x: s.x, y: s.y, z: s.z, dead: s.dead, onGround: s.g });
  return out;
}
function hurtPlayer(id, n) {
  if (id === net.id) hurtMe(n);
  else net.to(id, { k: 'hurt', n });
}
function hurtMe(n) {
  if (player.dead) return;
  player.damage(n); audio.hurt(); S.hurtFlash = 0.8; fx.shake = Math.max(fx.shake, 0.3);
  if (player.dead) { hud.banner('You are down', net.active && S.alive > 1 ? 'Back on your feet next round' : '', 3); M.held && releaseHold(false); }
}
function respawn() {
  const hp = player.maxHp; player.reset(); player.maxHp = hp; player.hp = hp; S.deadT = 0;
  hud.toast('Back in the fight');
}

/* ============================================================ Matter Destroyer */
// Left (held): grab a zombie, a loose piece, or rip a chunk out of the world, and swing it. Let go to throw.
// Right (held): disintegrate whatever the beam touches.
function matterStep(dt, live) {
  const slot = cur(), on = live && slot.st.kind === 'matter' && W.swapT <= 0 && W.knifeT <= 0 && !player.dead;
  M.grabCD -= dt; M.pending = Math.max(0, M.pending - dt);
  if (M.held && !fx.bodies.includes(M.held)) M.held = null;
  if (!on) { if (M.held) releaseHold(false); M.beam = 0; audio.matter(0); props.beam.visible = props.tether.visible = false; return; }
  const grab = input.fire, destroy = input.aim || input.mouseDown[2] || input.t.btn.has('aim');
  camDir(_fwd); const o = gfx.camera.position;
  if (grab && !M.held && M.grabCD <= 0 && !M.pending) tryGrab(o, _fwd);
  if (!grab && M.held) releaseHold(true);
  if (M.held) {
    const b = M.held;
    if (!b.target) b.target = new THREE.Vector3();
    b.target.copy(o).addScaledVector(_fwd, M.holdDist); b.target.y = Math.max(b.target.y, player.y + 0.3);
    b.asleep = false; b.rest = 0; M.beam = 2; M.end.copy(b.group.position);
    if (destroy) { popBody(b, 'vapor'); M.held = null; audio.explosion(2, 0.2); }
  } else if (destroy) {
    M.beam = 1; M.tick -= dt;
    const h = world.raycast(o.x, o.y, o.z, _fwd.x, _fwd.y, _fwd.z, 16);
    M.end.copy(o).addScaledVector(_fwd, h ? h.t : 16);
    if (M.tick <= 0) { M.tick = 1 / 16; destroyTick(o, _fwd, h); }
  } else M.beam = 0;
  audio.matter(M.beam);
  // beams
  const show = (line, on2, color, jitter, sag) => {
    line.visible = on2; if (!on2) return;
    muzzleWorld(_v); const p = line.geometry.attributes.position.array, n = p.length / 3;
    for (let k = 0; k < n; k++) { const t = k / (n - 1), j = k && k < n - 1 ? jitter : 0, s = Math.sin(t * Math.PI) * sag; p[k * 3] = _v.x + (M.end.x - _v.x) * t + rnd(j); p[k * 3 + 1] = _v.y + (M.end.y - _v.y) * t - s + rnd(j); p[k * 3 + 2] = _v.z + (M.end.z - _v.z) * t + rnd(j); }
    line.geometry.attributes.position.needsUpdate = true; line.material.color.copy(color);
  };
  show(props.beam, M.beam === 1, new THREE.Color(4, 1.8, 8), 0.06, 0);
  show(props.tether, M.beam === 2, new THREE.Color(1.2, 4, 6), 0.015, 0.25);
  if (M.beam === 1 && Math.random() < 0.6) fx.sparks(M.end.x, M.end.y, M.end.z, 2, -_fwd.x, -_fwd.y, -_fwd.z, 0xb080ff, 2.5);
}
function rayBody(o, d, tmax) {
  let best = null, bt = tmax;
  for (const b of fx.bodies) {
    if (b.held || b.danger) continue;
    const p = b.group.position, ox = p.x - o.x, oy = p.y - o.y, oz = p.z - o.z, t = ox * d.x + oy * d.y + oz * d.z;
    if (t < 0 || t > bt) continue;
    const r = b.rad * 0.8 + 0.15; if (ox * ox + oy * oy + oz * oz - t * t < r * r) { bt = t; best = b; }
  }
  return best ? { b: best, t: bt } : null;
}
function tryGrab(o, d) {
  M.grabCD = 0.3;
  const h = world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 16), tw = h ? h.t : 16;
  const bh = rayBody(o, d, tw);
  const zs = horde.rayHits(o.x, o.y, o.z, d.x, d.y, d.z, bh ? bh.t : tw).filter((z) => z.z.type !== 'boss');
  if (zs.length) { grabZombie(zs[0].z); return; }
  if (bh) { attachHold(bh.b, true); return; }
  if (h && MAT[h.mat].tier <= 5) {
    edit({ t: 'grab', x: o.x + d.x * (h.t + 0.3), y: o.y + d.y * (h.t + 0.3), z: o.z + d.z * (h.t + 0.3), r: 0.72, tier: 5 });
    M.pending = net.client ? 1.2 : 0;
    return;
  }
  audio.dry();
}
function grabZombie(zb) {
  if (net.client) { net.send({ k: 'zgrab', id: zb.id }); M.pending = 1.2; zb.swept = true; return; }
  const b = horde.asBody(zb, 'z' + zb.id); horde.kill(zb, { grab: true, by: net.id, quiet: true });
  if (b) { b.owner = net.id; attachHold(b, false); }
}
function attachHold(b, claim) {
  M.held = b; M.pending = 0; b.held = true; b.owner = net.id; b.remote = 0; b.net = true; b.asleep = false; b.thrown = 0;
  M.holdDist = Math.min(4.2 + b.rad * 0.5, Math.max(1.5 + b.rad, b.group.position.distanceTo(gfx.camera.position)));
  if (claim && net.active) net.send({ k: 'bgrab', id: b.id, by: net.id });
  audio.swap();
}
function releaseHold(throwIt) {
  const b = M.held; if (!b) return; M.held = null;
  b.held = false; b.target = null; b.thrown = 2.5;
  if (throwIt) { b.vel.multiplyScalar(1.25); audio.whoosh(b.vel.length()); }
}
function destroyTick(o, d, h) {
  const tw = h ? h.t : 16;
  const bh = rayBody(o, d, tw);
  const zs = horde.rayHits(o.x, o.y, o.z, d.x, d.y, d.z, bh ? bh.t : tw);
  if (zs.length) { const z = zs[0]; hitZombie(z.z, z.z.type === 'boss' ? 260 : 400, { part: z.part, head: z.head, dis: true, vapor: true, speed: 2, dx: d.x, dy: d.y, dz: d.z, quiet: true }); return; }
  if (bh) { popBody(bh.b, 'vapor'); return; }
  if (h) edit({ t: 'blast', x: o.x + d.x * (h.t + 0.15), y: o.y + d.y * (h.t + 0.15), z: o.z + d.z * (h.t + 0.15), r: 0.45, tier: 5, o: { dis: true, samples: 22, push: 0.5 } });
}
function popBody(b, style) {
  if (!fx.bodies.includes(b)) return;
  fx.crumble(b, style);
  if (net.active) net.send({ k: 'bpop', id: b.id, style, from: net.id });
}

// pieces I own that are moving fast: through zombies, into walls, into players (the Warden's boulders)
function bodySweep(b) {
  if (b.owner !== net.id && !(b.owner === 'boss' && !net.client)) return;
  if (!(b.held || b.thrown > 0 || b.danger)) return;
  const v = b.vel, sp = v.length(); if (sp < 4) return;
  const p = b.group.position, dx = v.x / sp, dy = v.y / sp, dz = v.z / sp;
  if (b.danger) {
    for (const t of targets()) {
      if (t.dead || b.danger.hit.has(t.id)) continue;
      if (Math.hypot(t.x - p.x, t.y + 0.9 - p.y, t.z - p.z) < b.rad * 0.7 + 0.55) { b.danger.hit.add(t.id); hurtPlayer(t.id, b.danger.dmg); }
    }
    return;
  }
  for (const zb of horde.near(p.x, p.y, p.z, b.rad * 0.75 + 0.2)) {
    if (zb.swept) continue;
    if (zb.type === 'boss') { if (b.hitCD > 0) continue; b.hitCD = 0.4; hitZombie(zb, Math.min(2500, sp * b.mass * 0.05 + 200), { part: 2, dx, dy, dz }); fx.shake = Math.max(fx.shake, 0.3); continue; }
    if (sp > 7.5) hitZombie(zb, 1e9, { vapor: true, speed: sp, part: 2, dx, dy, dz });
    else if (b.hitCD <= 0) { b.hitCD = 0.15; hitZombie(zb, sp * 70, { part: 2, dx, dy, dz }); }
  }
}
function bodyImpact(b, x, y, z, speed, nx, ny, nz) {
  if (b.owner !== net.id && !(b.owner === 'boss' && !net.client)) return;
  if (b.danger) { // a boulder lands: it breaks what it hits and shatters
    b.danger = null; breakAt(x - nx * 0.15, y - ny * 0.15, z - nz * 0.15, 0.8, 2, { push: 4, samples: 50 });
    popBody(b, ''); fx.shake = Math.max(fx.shake, 0.25); return;
  }
  if (!(b.held || b.thrown > 0)) return;
  if (b.zombie && speed > 8.5) { popBody(b, 'gore'); return; }
  if (speed > 7 && b.carveCD <= 0) {
    b.carveCD = 0.09;
    const r = Math.max(0.28, Math.min(0.9, 0.2 + Math.cbrt(b.mass) * 0.035)), tier = b.mass > 2500 ? 3 : b.mass > 350 ? 2 : 1;
    breakAt(x - nx * 0.12, y - ny * 0.12, z - nz * 0.12, r, tier, { push: Math.min(6, speed * 0.35), samples: 36 });
  }
}

/* ===================================================================== boss */
const inArena = (t) => zoneAt(map, t.x, t.z, t.y)?.id === 'F';
function startBoss() {
  S.boss = 'fight';
  const n = 1 + S.peers.size, hp = 25000 + 15000 * (n - 1) + 500 * S.round;
  horde.spawn(map.boss.x, map.boss.z, hp, 1.4, map.underY, 'boss');
  announce('boss');
}
function announce(kind, extra) {
  if (net.host) net.broadcast({ k: 'say', kind, extra });
  if (kind === 'boss') { hud.banner(BOSS_NAME, 'Kill it and take its fusion core', 4); audio.roar(10); fx.shake = 0.5; }
  else if (kind === 'enrage') hud.banner(`${BOSS_NAME} is enraged`, '', 2.5);
  else if (kind === 'bossdown') { hud.banner(`${BOSS_NAME} is down`, 'Take the fusion core it dropped', 4); audio.round(false); }
  else if (kind === 'charged') { hud.banner('Fusion charged', 'Every weapon now breaks vault alloy', 4); audio.upgrade(); }
  else if (kind === 'vault') { hud.banner('Deep vault open', 'Take the Matter Destroyer', 4); }
  else if (kind === 'joined') hud.toast(`${extra} joined`);
  else if (kind === 'left') hud.toast(`${extra} left`);
}
function bossDown(zb) {
  S.boss = 'dead'; S.bossRock = null;
  dropPower(zb.x, zb.y, zb.z, 'core');
  announce('bossdown');
}
function bossEvent(ev, zb, data) {
  const dc = Math.hypot(zb.x - player.x, zb.z - player.z);
  if (ev === 'roar') { audio.roar(dc); fx.shake = Math.max(fx.shake, 0.4); }
  else if (ev === 'enrage') { audio.roar(dc); announce('enrage'); }
  else if (ev === 'minions') {
    const F = map.zones.find((z) => z.id === 'F'), alive = horde.list.filter((z) => z.type !== 'boss' && inArena(z)).length;
    for (let i = 0; i < 2 && alive + i < 8; i++) { const sp = F.spawns[(Math.random() * F.spawns.length) | 0]; horde.spawn(sp[0] + rnd(0.4), sp[1] + rnd(0.4), zombieHp(Math.max(5, S.round)), 2.6 + Math.random(), map.underY); }
  } else if (ev === 'slam') {
    const fx0 = zb.x + Math.sin(zb.yaw) * 1.4, fz0 = zb.z + Math.cos(zb.yaw) * 1.4;
    breakAt(fx0, map.underY + 0.05, fz0, 1.3, 3, { push: 6, samples: 90 });
    if (net.host) net.broadcast({ k: 'fx', t: 'slam', p: [fx0, map.underY, fz0] });
    slamVisual(fx0, map.underY, fz0);
    for (const t of data) { const d = Math.hypot(t.x - fx0, t.z - fz0); if (d < 6.5 && t.onGround !== false && t.y < map.underY + 0.6) hurtPlayer(t.id, 50 * (1 - d / 6.5) + 10); }
  } else if (ev === 'rip') {
    edit({ t: 'grab', x: zb.x + Math.sin(zb.yaw) * 2.2, y: map.underY - 0.05, z: zb.z + Math.cos(zb.yaw) * 2.2, r: 0.8, tier: 3, by: 'boss' });
  } else if (ev === 'throw') {
    const b = S.bossRock; S.bossRock = null;
    if (!b || !fx.bodies.includes(b)) return;
    b.held = false; b.target = null; b.thrown = 3; b.net = true; b.danger = { dmg: 35, hit: new Set() };
    const p = b.group.position, tx = data.x - p.x, ty = data.y + 1.0 - p.y, tz = data.z - p.z, dist = Math.hypot(tx, tz), T = Math.max(0.35, dist / 15);
    b.vel.set(tx / T, (ty + 0.5 * G * T * T) / T, tz / T); b.ang.set(rnd(4), rnd(4), rnd(4));
    audio.whoosh(15);
  } else if (ev === 'smash') fx.shake = Math.max(fx.shake, Math.max(0, 0.3 - dc / 40));
  else if (ev === 'swipe') audio.whoosh(12);
}
function slamVisual(x, y, z) {
  const dc = Math.hypot(x - player.x, z - player.z);
  audio.explosion(dc, 1.2); fx.shake = Math.max(fx.shake, Math.max(0.15, 0.8 - dc / 15));
  gfx.blastFlash(x, y + 0.5, z, 0xff8040);
  for (let i = 0; i < 40; i++) { const a = Math.random() * 6.283, s = 3 + Math.random() * 5; fx.chip(x + Math.cos(a) * 0.5, y + 0.1, z + Math.sin(a) * 0.5, Math.cos(a) * s, 2 + Math.random() * 3, Math.sin(a) * s, ID.CONC, 0.1); }
}
function bossStepHost(dt) {
  // carry the ripped boulder in the right hand until the throw
  const b = S.bossRock, zb = horde.boss;
  if (b && zb && fx.bodies.includes(b)) { if (!b.target) b.target = new THREE.Vector3(); zb.m[4].decompose(_v, new THREE.Quaternion(), _v2); b.target.copy(_v).y += 0.6 * zb.scale; b.asleep = false; }
  else if (b) S.bossRock = null;
}

/* =================================================================== props */
function buildProps() {
  const fy = map.floorY, add = (o) => { gfx.scene.add(o); return o; };
  const place = (o, x, z, nx, nz, y, off = 0.02) => { o.position.set(x + nx * off, fy + y, z + nz * off); o.rotation.y = Math.atan2(nx, nz); return o; };
  const label = (title, sub, x, z, nx, nz, y, accent, base = fy) => { const l = labelSprite(title, sub, accent); l.position.set(x + nx * 0.25, base + y, z + nz * 0.25); add(l); props.labels.push(l); return l; };
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
        else if (spend(wb.price)) { give(wb.weapon); hud.toast(`${W0.name}: breaks ${TIER_WORD[W0.tier]}`); }
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
      props.inter.push({ x: s.x + s.nx * 1.1, z: s.z + s.nz * 1.1, text: () => (cur().id === 'matter' ? '' : cur().up ? `${cur().st.name} is already overclocked` : `Overclock ${cur().st.name} <b>${fmt(PRICES.bench)}</b>`), use() { if (cur().id !== 'matter' && !cur().up && spend(PRICES.bench)) overclock(); } });
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
  // vault core: a free overclock
  const P = map.pedestal, core = props.core = boxModel([[0, 0, 0, 0.32, 0.32, 0.32, 0x8a80ff, 1], [0, 0, 0, 0.44, 0.08, 0.08, 0xffe9a0, 1], [0, 0, 0, 0.08, 0.44, 0.08, 0xffe9a0, 1]]);
  core.position.set(P.x, P.y + 0.45, P.z); add(core);
  props.inter.push({ x: P.x + 0.9, z: P.z, r: 1.9, text: () => (S.coreTaken || cur().id === 'matter' ? '' : `Take the vault core: free overclock for ${cur().st.name}`), use() { if (S.coreTaken || cur().up) { if (cur().up) hud.toast('Switch to a weapon that is not overclocked'); return; } S.coreTaken = true; core.visible = false; overclock(); } });
  // the Matter Destroyer on its pedestal in the deep vault
  const MP = map.matter, md = props.matter = gunModel('matter'); md.scale.setScalar(2.2); md.position.set(MP.x, MP.y, MP.z); add(md);
  const ml = label('Matter Destroyer', 'Left: grab · Right: disintegrate', MP.x, MP.z, 0, 0, MP.y - map.underY + 0.75, '#b080ff', map.underY);
  ml.userData.under = true;
  props.inter.push({ x: MP.x, z: MP.z + 1.0, y: map.underY, r: 2.0, text: () => (owns('matter') ? '' : 'Take the Matter Destroyer'), use() { if (owns('matter')) return; give('matter'); hud.banner('Matter Destroyer', 'Hold left to grab and swing · hold right to disintegrate', 5); audio.upgrade(); } });
  // muzzle flash, tracers, beams
  props.flash = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.18), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.4, 1.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  props.flash.visible = false;
  const TN = 64, tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TN * 6), 3)); tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TN * 6), 3));
  props.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  props.tracers.frustumCulled = false; props.tracers.userData = { n: TN, life: new Float32Array(TN), i: 0 }; add(props.tracers);
  const line = (n) => { const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); const l = new THREE.Line(g2, new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 5, 7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); l.frustumCulled = false; l.visible = false; return add(l); };
  props.arc = line(18); props.beam = line(18); props.tether = line(14);
}

function overclock() {
  const old = cur(), slot = makeSlot(old.id, true);
  gfx.vmScene.remove(old.model); S.slots[S.cur] = slot; startSwap(); audio.upgrade();
  hud.banner(slot.st.name, `Overclocked · now breaks ${TIER_WORD[slot.st.tier]}`, 3.6);
}

function tracer(o, d, len, fromMe = true) {
  const T = props.tracers, u = T.userData, i = u.i = (u.i + 1) % u.n, pos = T.geometry.attributes.position.array;
  const s = Math.min(len, 3 + Math.random() * 4), a = Math.max(0.4, len - s);
  pos[i * 6] = o.x + d.x * a; pos[i * 6 + 1] = o.y + d.y * a; pos[i * 6 + 2] = o.z + d.z * a;
  pos[i * 6 + 3] = o.x + d.x * len; pos[i * 6 + 4] = o.y + d.y * len; pos[i * 6 + 5] = o.z + d.z * len;
  if (len < 6 && fromMe) { muzzleWorld(_v); pos[i * 6] = _v.x; pos[i * 6 + 1] = _v.y; pos[i * 6 + 2] = _v.z; }
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
  const B = props.arc; B.visible = !!W.beamOn;
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
const POWERS = { ammo: 'Max ammo', kill: 'Insta-kill', double: 'Double points', nuke: 'Detonation', cash: 'Bonus points', core: 'Fusion core' };
// host or solo only; everyone else hears about it
function dropPower(x, y, z, kind) {
  if (!kind) { const kinds = ['ammo', 'ammo', 'kill', 'kill', 'double', 'double', 'nuke', 'cash', 'cash']; kind = kinds[(Math.random() * kinds.length) | 0]; }
  const id = ++S.dropId, f = nav.floorAt(x, y + 0.3, z);
  addDrop(id, kind, x, (f >= 0 ? f : y) + 0.8, z);
  if (net.host) net.broadcast({ k: 'drop', id, kind, p: [x, (f >= 0 ? f : y) + 0.8, z] });
}
function addDrop(id, kind, x, y, z) {
  const mesh = powerupModel(kind); mesh.position.set(x, y, z); if (kind === 'core') mesh.scale.setScalar(1.6);
  gfx.scene.add(mesh); drops.set(id, { id, kind, mesh, x, y, z, t: 0, asked: 0 });
}
function removeDrop(id) { const d = drops.get(id); if (!d) return null; gfx.scene.remove(d.mesh); drops.delete(id); return d; }
function dropsStep(dt) {
  for (const d of [...drops.values()]) {
    d.t += dt;
    d.mesh.rotation.y += dt * 2; d.mesh.position.y = d.y + Math.sin(d.t * 2.4) * 0.1;
    d.mesh.visible = d.kind === 'core' || d.t < 20 || ((d.t * 7) | 0) % 2 === 0;
    const near = Math.hypot(d.x - player.x, d.z - player.z) < 1.3 && Math.abs(d.y - player.y - 0.8) < 1.6 && !player.dead && state === 'play';
    if (near) { if (net.client) { if (performance.now() - d.asked > 800) { d.asked = performance.now(); net.send({ k: 'take', id: d.id }); } } else takeDrop(d.id, net.id); }
    else if (d.t > 26 && d.kind !== 'core' && !net.client) { removeDrop(d.id); if (net.host) net.broadcast({ k: 'taken', id: d.id }); }
  }
  if (!net.client) { if (S.double > 0) S.double = Math.max(0, S.double - dt); if (S.insta > 0) S.insta = Math.max(0, S.insta - dt); }
  hud.power('double', 'Double points', S.double); hud.power('kill', 'Insta-kill', S.insta);
}
function takeDrop(id, by) {
  const d = removeDrop(id); if (!d) return;
  if (net.host) net.broadcast({ k: 'taken', id, kind: d.kind, by });
  usePower(d.kind, by);
}
// runs on every machine
function usePower(kind, by) {
  audio.power(); if (kind !== 'core') hud.banner(POWERS[kind], by && by !== net.id ? `picked up by ${nameOf(by)}` : '', 2);
  if (kind === 'ammo') { for (const s of S.slots) refill(s); if (S.nades < 4) S.nades = 4; }
  else if (kind === 'kill') S.insta = 30;
  else if (kind === 'double') S.double = 30;
  else if (kind === 'cash') addPoints(500, 'flat');
  else if (kind === 'core') { S.charged = true; restat(); announce('charged'); }
  else if (kind === 'nuke') {
    fx.shake = 0.6; gfx.blastFlash(player.x, player.y + 6, player.z, 0xfff0c0); audio.explosion(12, 1.5); addPoints(400, 'flat');
    if (!net.client) for (const zb of horde.list.slice()) if (zb.type !== 'boss') horde.kill(zb, { explosive: true, dy: 1, by: 'nuke', pts: 0, quiet: true });
  }
}
function nameOf(id) { if (id === net.id) return S.name; if (id === 'h') return S.hostName || 'the host'; return net.names.get(id) || remotes.map.get(id)?.name || 'a teammate'; }

/* ================================================================== rounds */
function startRound(n) {
  S.round = n; S.phase = 'fight'; S.drops = 0;
  S.toSpawn = Math.round(6 + n * 2.6 + Math.max(0, n - 5) * 2) + 3 * S.peers.size; S.spawnT = 1.5;
  roundBanner(n);
}
function roundBanner(n) {
  hud.banner(`Round ${n}`, n === 1 ? 'Hold the safehouse' : 'Here they come', 3); audio.round(true);
  if (player.dead) respawn();
}
function zombieHp(n) { return n < 10 ? 150 + 100 * (n - 1) : 1050 * 1.1 ** (n - 9); }
function spawnOne() {
  const cand = [], tg = targets().filter((t) => !t.dead);
  for (const zn of map.zones) if (S.opened.has(zn.id) && !zn.under) for (const sp of zn.spawns) {
    const d = Math.min(...tg.map((t) => Math.hypot(sp[0] - t.x, sp[1] - t.z)));
    if (d < 6 || world.boxSolid(sp[0] - 0.2, map.floorY + 0.3, sp[1] - 0.2, sp[0] + 0.2, map.floorY + 1.6, sp[1] + 0.2)) continue;
    cand.push({ sp, d, ok: nav.reachable(sp[0], map.floorY, sp[1]) && d < 34 });
  }
  const good = cand.filter((c) => c.ok), pool = good.length ? good : cand;
  if (!pool.length) return false;
  const c = pool[(Math.random() * pool.length) | 0], n = S.round;
  let sp = 1.2 + Math.random() * 0.35;
  if (Math.random() < Math.min(0.85, (n - 2) * 0.14)) sp = 3.1 + Math.random() * 0.8;
  if (n >= 8 && Math.random() < 0.25) sp = 4.3;
  const f = nav.floorAt(c.sp[0], map.floorY, c.sp[1]);
  return !!horde.spawn(c.sp[0] + rnd(0.3), c.sp[1] + rnd(0.3), zombieHp(n), sp, f >= 0 ? f : map.floorY);
}
function roundsStep(dt) {
  if (S.phase === 'break') { S.breakT -= dt; if (S.breakT <= 0) startRound(S.round + 1); return; }
  if (S.boss === 'fight') return; // the horde holds off while the Warden is up
  S.spawnT -= dt;
  const maxAlive = Math.min(24 + 4 * S.peers.size, 5 + S.round * 2 + 2 * S.peers.size);
  if (S.toSpawn > 0 && S.spawnT <= 0 && horde.list.length < maxAlive) { if (spawnOne()) S.toSpawn--; S.spawnT = Math.max(0.35, 2.1 - S.round * 0.15) * (0.6 + Math.random() * 0.8); }
  if (S.toSpawn === 0 && horde.list.length === 0) endRound();
}
function endRound() {
  S.phase = 'break'; S.breakT = 9; audio.round(false); hud.banner(`Round ${S.round} survived`, 'Next wave in 9 seconds', 3.5);
  S.best = Math.max(S.best, S.round); store.set('best', S.best);
}

/* =================================================================== run */
function resetWorld() {
  world.data.fill(0); map = buildMap(world); gfx.map = map;
  gfx.occUpdate([0, 0, 0, SX - 1, SY - 1, SZ - 1]); gfx.buildAll(); nav.rebuild(0, 0, 9999, 9999);
  for (const b of fx.bodies.slice()) fx.crumble(b);
  fx.chips.n = 0; fx.glow.n = 0; horde.clear();
  for (const p of projs) gfx.scene.remove(p.mesh); projs.length = 0;
  for (const id of [...drops.keys()]) removeDrop(id);
  props.core.visible = true; hideSpin();
}
function newRun(first) {
  if (!first) resetWorld();
  for (const s of S.slots || []) gfx.vmScene.remove(s.model);
  M.held = null; M.beam = 0; M.pending = 0;
  Object.assign(S, { phase: 'break', round: 0, breakT: 4, points: 500, earned: 0, kills: 0, heads: 0, toSpawn: 0, spawnT: 0, slots: [], cur: 0, nades: 0, double: 0, insta: 0,
    opened: new Set(['A']), deepest: 'A', plated: false, coreTaken: false, hurtFlash: 0, deadT: 0, crushCD: 0, best: store.get('best', 0),
    crate: { at: map.crates.findIndex((c) => c.zone === 'A'), state: 'idle', t: 0, uses: 0, pick: null, show: null },
    seq: 0, log: [], stoneNoted: false, boss: 'dormant', bossRock: null, charged: false, dropId: 0, peers: S.peers || new Map(), wipeT: 0, alive: 1, name: S.name, color: S.color ?? 0 });
  Object.assign(W, { flowT: 0, fireT: 0, reloadT: 0, swapT: 0, knifeT: 0, nadeT: 0, aimK: 0, kick: 0, aimToggle: false, noteAt: 0, flashT: 0, beamOn: false, autoReload: 0, target: null, netT: 0, btT: 0 });
  player.reset(); player.maxHp = 100; player.hp = 100;
  give('rook'); W.swapT = 0;
  hud.reset(); nav.flow(targets());
  props.matter.visible = true;
}

function zonesStep() {
  const zn = zoneAt(map, player.x, player.z, player.y);
  if (zn && !S.opened.has(zn.id)) openZone(zn.id, net.id);
  S.zoneName = zn ? zn.name : S.zoneName;
  let h = map.hints[S.deepest] || '';
  if (S.deepest === 'E') h = S.coreTaken ? map.hints.E : 'Take the vault core from the pedestal, then the stairs down';
  if (S.boss === 'dead' && !S.opened.has('G')) h = S.charged ? 'Fusion-charged: blast through the purple vault alloy' : 'Take the fusion core the Warden dropped';
  if (S.opened.has('G')) h = owns('matter') ? 'Swing things through zombies with the Matter Destroyer' : map.hints.G;
  hud.hint(S.round >= 1 ? `${S.zoneName || ''}  ·  ${h}` : '');
}
// a zone was entered for the first time, by me or (on the host) by anyone
function openZone(id, by) {
  if (S.opened.has(id)) return;
  S.opened.add(id);
  if (ZONE_ORDER.indexOf(id) > ZONE_ORDER.indexOf(S.deepest)) S.deepest = id;
  const zn = map.zones.find((z) => z.id === id);
  if (by === net.id) {
    audio.zone(); addPoints(id === 'E' ? 2500 : id === 'G' ? 5000 : 250, 'flat');
    if (id !== 'F' && id !== 'G') hud.banner(zn.name, id === 'E' ? 'Vault breached. Shoot the gold for points' : 'New area opened', 3.4);
    if (net.client) net.send({ k: 'zone', id });
  }
  if (!net.client) {
    if (id === 'F' && S.boss === 'dormant') startBoss();
    if (id === 'G') { S.charged = false; restat(); announce('vault'); }
  }
}

/* ================================================================ interact */
function interactStep() {
  camDir(_fwd);
  let best = null, bd = 9;
  for (const it of props.inter) {
    const dx = it.x - player.x, dz = it.z - player.z, d = Math.hypot(dx, dz), r = it.r || 1.5;
    if (d > r || Math.abs(player.y - (it.y ?? map.floorY)) > 0.8) continue;
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
const VM_OFF = { ramrod: [0.22, -0.16, -0.62], longbow: [0.16, -0.19, -0.5], hog: [0.17, -0.2, -0.46], matter: [0.17, -0.2, -0.46] };
let knifeModel = null;
function cameraStep(dt, live) {
  const cam = gfx.camera, slot = cur(), st = slot.st;
  const k = 0.0022 * sens * (1 - W.aimK * (st.zoom ? 0.75 : 0.35));
  if (live) { player.yaw -= input.lookX * k; player.pitch = Math.max(-1.52, Math.min(1.52, player.pitch - input.lookY * k)); }
  const bob = player.onGround ? Math.sin(player.bob * 2) * 0.035 * Math.min(1, player.speed / 4) * (1 - W.aimK * 0.8) : 0;
  cam.position.set(player.x, player.eyeY + bob, player.z);
  const sh = fx.shake * fx.shake;
  cam.rotation.set(player.pitch + rnd(sh * 0.05), player.yaw + rnd(sh * 0.05), rnd(sh * 0.03) + (player.dead ? 0.5 : 0));
  const scoped = st.zoom && W.aimK > 0.85;
  const fov = 78 - W.aimK * (st.zoom ? 78 - 78 / st.zoom : 16) + (player.sprinting ? 4 : 0);
  if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 18); cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld();
  // viewmodel
  for (const s of S.slots) s.model.visible = s === slot && !scoped && W.knifeT <= 0.05 && !player.dead;
  const m = slot.model, a = W.aimK;
  const vo = VM_OFF[slot.id]; m.position.lerpVectors(vo ? _v.set(...vo) : hip, ads, a);
  const t = player.bob * 2, mv = Math.min(1, player.speed / 4) * (1 - a * 0.85);
  m.position.x += Math.cos(t * 0.5) * 0.012 * mv; m.position.y += -Math.abs(Math.sin(t * 0.5)) * 0.014 * mv;
  m.position.z += W.kick * 0.06 * (1 - a * 0.5);
  W.swayX = (W.swayX || 0) * Math.exp(-10 * dt) + (live ? input.lookX : 0) * 0.00012; W.swayY = (W.swayY || 0) * Math.exp(-10 * dt) + (live ? input.lookY : 0) * 0.00012;
  let rx = W.kick * 0.18 * (1 - a * 0.6) - W.swayY, ry = W.swayX, rz = 0;
  if (W.reloadT > 0) { const p = 1 - W.reloadT / st.reload, s = Math.sin(Math.min(1, p * 1.15) * Math.PI); rx -= s * 0.45; rz += s * 0.4; m.position.y -= s * 0.1; }
  if (W.swapT > 0) { const s = W.swapT / 0.45; m.position.y -= s * 0.3; rx -= s * 0.6; }
  if (player.sprinting && W.reloadT <= 0 && !M.held) { ry += 0.55; rz += 0.25; m.position.x -= 0.04; m.position.y -= 0.03; }
  if (slot.id === 'matter') { const pulse = M.beam ? 0.006 * Math.sin(performance.now() / 20) : 0; m.position.x += pulse; rx += M.beam === 2 ? 0.08 : 0; }
  m.rotation.set(rx, ry, rz);
  m.updateMatrix();
  if (!knifeModel) { knifeModel = gunModel('knife'); gfx.vmScene.add(knifeModel); }
  knifeModel.visible = W.knifeT > 0;
  if (W.knifeT > 0) { const p = 1 - W.knifeT / 0.5, s = Math.sin(Math.min(1, p * 1.6) * Math.PI); knifeModel.position.set(0.2 - s * 0.22, -0.2 + s * 0.06, -0.3 - s * 0.18); knifeModel.rotation.set(-0.2, 0.9 - s * 1.4, -0.5 + s * 0.3); }
  if (W.flashT > 0 && (W.flashT -= dt) <= 0) props.flash.visible = false;
}

/* ==================================================================== HUD */
function hudStep(dt) {
  const slot = cur(), other = S.slots[1 - S.cur];
  S.hurtFlash = Math.max(0, S.hurtFlash - dt * 1.6);
  const left = S.phase === 'fight' ? (net.client ? S.left : S.toSpawn + horde.list.length) : 0;
  const inf = slot.st.kind === 'matter';
  hud.stats({
    round: S.round || 0, points: S.points, ammo: inf ? '∞' : slot.mag, reserve: inf ? '' : slot.reserve, wname: slot.st.name, wcls: slot.st.cls, other: other ? `${other.st.name}  [Q]` : '',
    hp: player.hp, maxHp: player.maxHp, nades: S.nades, lowAmmo: !inf && slot.mag <= Math.ceil(slot.st.mag * 0.25), hurtFlash: S.hurtFlash,
    gap: 5 + (slot.st.spread * 260 + (player.speed > 0.5 ? 6 : 0) + W.kick * 8) * (1 - W.aimK), scoped: !!slot.st.zoom && W.aimK > 0.85,
    left: S.boss === 'fight' ? 'Boss' : S.phase === 'fight' ? `${left} left` : S.round ? 'Break' : 'Get ready',
  });
  const boss = horde.boss;
  hud.boss(BOSS_NAME, boss ? (net.client ? boss.hpf ?? 1 : boss.hp / boss.maxHp) : null);
  hud.charge(!!S.charged);
  if (net.active) {
    const list = [{ name: S.name + ' (you)', hp: player.hp, mhp: player.maxHp, dead: player.dead, color: hexCol(S.color) }];
    for (const r of remotes.list) list.push({ name: r.name, hp: r.hp, mhp: r.mhp || 100, dead: r.dead, color: hexCol(r.c) });
    hud.team(list);
  }
  hud.update(dt);
}
const hexCol = (c) => '#' + COLORS[(c ?? 0) % COLORS.length].toString(16).padStart(6, '0');

/* ============================================================== co-op */
function netStep(dt) {
  if (!net.active) return;
  W.netT -= dt; W.btT -= dt;
  if (W.netT <= 0) {
    W.netT = net.host ? 1 / 15 : 1 / 20;
    if (net.client) net.send({ k: 'st', s: myState() });
    else {
      const p = [['h', myState()]]; for (const [id, s] of S.peers) p.push([id, s]);
      const b = horde.boss;
      net.broadcast({ k: 'snap', z: horde.snapshot(), p, r: { round: S.round, phase: S.phase, left: S.toSpawn + horde.list.length, opened: [...S.opened], boss: S.boss, charged: S.charged, double: r2(S.double), insta: r2(S.insta), name: S.name } });
    }
  }
  // stream the pieces I am moving
  if (W.btT <= 0) {
    W.btT = 1 / 20;
    const list = [];
    for (const b of fx.bodies) {
      const mine = b.owner === net.id || (b.owner === 'boss' && net.host);
      if (!mine || !b.net || b.remote || (b.asleep && !b.held)) continue;
      const p = b.group.position, q = b.group.quaternion;
      list.push([b.id, r2(p.x), r2(p.y), r2(p.z), r2(q.x), r2(q.y), r2(q.z), r2(q.w)]);
    }
    if (list.length) net.send({ k: 'bt', b: list, from: net.id });
  }
  // game over when everyone is down
  if (net.host) {
    const tg = targets(); S.alive = tg.filter((t) => !t.dead).length;
    if (state !== 'over' && S.alive === 0) { S.wipeT += dt; if (S.wipeT > 2.6) { net.broadcast({ k: 'over', round: S.round }); gameOver(); } } else S.wipeT = 0;
  }
}
function onBodyStream(list) {
  const now = performance.now();
  for (const [id, x, y, z, qx, qy, qz, qw] of list) {
    const b = fx.byId.get(id); if (!b || b.owner === net.id || M.held === b) continue;
    b.remote = now; b.asleep = false;
    (b.target ||= new THREE.Vector3()).set(x, y, z); (b.targetQ ||= new THREE.Quaternion()).set(qx, qy, qz, qw);
  }
}
function onShot(m) {
  const o = new THREE.Vector3(...m.o), d = new THREE.Vector3();
  for (const s of m.s || []) { d.set(s[0], s[1], s[2]).normalize(); tracer(o, d, s[3] || 40, false); }
  const dist = Math.hypot(o.x - player.x, o.z - player.z), W0 = WEAPONS[m.w];
  if (W0 && dist < 45) audio.shot(W0.snd, Math.max(0.12, 1 - dist / 45) ** 1.5);
}
// every message, on both sides
function onMessage(from, m) {
  if (!m || !m.k) return;
  const host = net.host;
  switch (m.k) {
    /* ---------- client → host ---------- */
    case 'st': if (host) { S.peers.set(from, m.s); remotes.set(from, m.s); } break;
    case 'edit': if (host) { m.e.by = from; edit(m.e); } break;
    case 'hit': if (host) { const zb = horde.byId.get(m.id); if (zb) { let dmg = m.dmg; if (S.insta > 0 && zb.type !== 'boss') dmg = 1e9; horde.damage(zb, dmg, { ...m.info, by: from }); } } break;
    case 'boom': if (host) explode(new THREE.Vector3(...m.p), m.st, from); break;
    case 'zone': if (host) openZone(m.id, from); break;
    case 'take': if (host) takeDrop(m.id, from); break;
    case 'zgrab': if (host) {
      const zb = horde.byId.get(m.id); if (!zb || zb.type === 'boss') break;
      const b = horde.asBody(zb, 'z' + zb.id); if (b) { b.owner = from; b.remote = performance.now(); b.net = true; }
      horde.kill(zb, { grab: true, by: from, quiet: true });
    } break;
    /* ---------- host → client ---------- */
    case 'welcome': net.id = m.id; S.color = m.c; S.hostName = m.host; S.joinLog = []; break;
    case 'log': for (const e of m.e) applyEdit(e, true); if (m.done) finishJoin(m); break;
    case 'w': if (!host) applyEdit(m.e); break;
    case 'snap': if (!host) applySnap(m); break;
    case 'kill': if (!host) {
      const zb = horde.byId.get(m.id), info = m.info;
      if (zb) {
        if (info.grab) { const b = horde.asBody(zb, 'z' + zb.id); if (b) { b.owner = info.by; b.net = true; if (info.by === net.id) attachHold(b, false); else b.remote = performance.now(); } }
        horde.kill(zb, info);
      } else if (info.by === net.id) onKill({ id: m.id }, info);
    } break;
    case 'pts': addPoints(m.n, m.kind || ''); break;
    case 'hurt': hurtMe(m.n); break;
    case 'drop': if (!host) addDrop(m.id, m.kind, m.p[0], m.p[1], m.p[2]); break;
    case 'taken': if (!host) { const d = removeDrop(m.id); if (d && m.kind) usePower(m.kind, m.by); } break;
    case 'say': if (!host) announce(m.kind, m.extra); break;
    case 'over': if (!host) { S.round = m.round; gameOver(); } break;
    case 'reset': if (!host) { newRun(false); hud.toast('The host started a new run'); if (state === 'over') play(); } break;
    /* ---------- both ways (the host relays) ---------- */
    case 'fx':
      if (host) net.broadcast(m, from);
      if (m.from === net.id) break;
      if (m.t === 'shot') onShot(m);
      else if (m.t === 'proj') launch(m.kind, m.kind === 'frag' ? FRAG : WEAPONS[m.kind === 'nade' ? 'thumper' : 'ramrod'], new THREE.Vector3(...m.p), new THREE.Vector3(...m.d), true);
      else if (m.t === 'boom') boomVisual(m.p[0], m.p[1], m.p[2], m.dig);
      else if (m.t === 'slam') slamVisual(m.p[0], m.p[1], m.p[2]);
      break;
    case 'bt': if (host) net.broadcast(m, from); if (m.from !== net.id) onBodyStream(m.b); break;
    case 'bgrab': if (host) net.broadcast(m, from); { const b = fx.byId.get(m.id); if (b && m.by !== net.id) { if (M.held === b) M.held = null; b.held = false; b.owner = m.by; b.remote = performance.now(); b.net = true; } } break;
    case 'bpop': if (host) net.broadcast(m, from); if (m.from !== net.id) { const b = fx.byId.get(m.id); if (b) fx.crumble(b, m.style); } break;
  }
}
function applySnap(m) {
  horde.applySnapshot(m.z);
  const seen = new Set();
  for (const [id, s] of m.p) { if (id === net.id) continue; seen.add(id); remotes.set(id, s); }
  for (const id of [...remotes.map.keys()]) if (!seen.has(id)) remotes.remove(id);
  const r = m.r;
  if (r.round !== S.round && r.phase === 'fight') { S.round = r.round; roundBanner(r.round); }
  if (S.phase === 'fight' && r.phase === 'break' && S.round) { audio.round(false); hud.banner(`Round ${S.round} survived`, 'Next wave in 9 seconds', 3.5); S.best = Math.max(S.best, S.round); store.set('best', S.best); }
  S.round = r.round; S.phase = r.phase; S.left = r.left; S.boss = r.boss; S.double = r.double; S.insta = r.insta; S.hostName = r.name;
  for (const id of r.opened) if (!S.opened.has(id)) { S.opened.add(id); if (ZONE_ORDER.indexOf(id) > ZONE_ORDER.indexOf(S.deepest)) S.deepest = id; }
  if (r.charged !== S.charged) { S.charged = r.charged; restat(); }
  S.alive = 1 + m.p.filter(([id, s]) => id !== net.id && !s.dead).length;
}

async function hostCoop() {
  const msg = $('coopMsg'); setCoopBusy(true); msg.textContent = 'Opening a room…';
  try {
    const code = await net.hostGame();
    net.onMsg = onMessage;
    net.onJoin = (id, name) => {
      const c = 1 + ((S.colorN = (S.colorN || 0) + 1) % (COLORS.length - 1));
      net.to(id, { k: 'welcome', id, c, host: S.name });
      for (let i = 0; i < S.log.length; i += 250) net.to(id, { k: 'log', e: S.log.slice(i, i + 250) });
      net.to(id, { k: 'log', e: [], done: true, drops: [...drops.values()].map((d) => ({ id: d.id, kind: d.kind, p: [d.x, d.y, d.z] })), boss: S.boss, charged: S.charged });
      S.peers.set(id, { x: map.spawn.x, y: map.floorY, z: map.spawn.z, yaw: 0, dead: false, name, c });
      announce('joined', name);
    };
    net.onLeave = (id, name) => { S.peers.delete(id); remotes.remove(id); announce('left', name || 'A player'); };
    hud.room(code); msg.textContent = '';
    hud.toast(`Room ${code}: friends join with this code`, 6);
    play();
  } catch (e) { msg.textContent = e.message; net.close(); }
  setCoopBusy(false);
}
async function joinCoop() {
  const msg = $('coopMsg'), code = $('codeIn').value;
  setCoopBusy(true); msg.textContent = 'Connecting…';
  try {
    net.onMsg = onMessage;
    net.onLeave = () => { hud.toast('The host left the game'); leaveCoop(); };
    newRun(false);
    S.joining = true;
    await net.joinGame(code, S.name);
    msg.textContent = 'Joined. Loading the host\'s world…';
  } catch (e) { msg.textContent = e.message; net.close(); S.joining = false; }
  setCoopBusy(false);
}
// the host's log has been replayed: rebuild the meshes once and drop in
function finishJoin(m) {
  gfx.occUpdate([0, 0, 0, SX - 1, SY - 1, SZ - 1]); gfx.buildAll(); nav.rebuild(0, 0, 9999, 9999);
  for (const d of m.drops || []) addDrop(d.id, d.kind, d.p[0], d.p[1], d.p[2]);
  S.boss = m.boss; S.charged = m.charged; restat();
  horde.replica = true; S.joining = false;
  hud.room(net.code); $('coopMsg').textContent = '';
  hud.toast(`Joined ${S.hostName || 'the host'}'s game`, 4);
  play();
}
function leaveCoop() {
  net.close(); horde.replica = false; remotes.clear(); S.peers.clear(); hud.room(null); hud.team([]);
  newRun(false); state = 'menu'; input.release(); showScreen('intro');
}
function setCoopBusy(b) { for (const id of ['hostBtn', 'joinBtn', 'startBtn']) $(id).disabled = b; }

/* ================================================================== loop */
let last = performance.now(), fpsAcc = 0, fpsN = 0;
function step(dt, live) {
  player.update(dt, live ? input : NULL_INPUT, false);
  if (player.y < -2) player.reset();
  if (live) weaponsStep(dt);
  matterStep(dt, live);
  horde.listener.copy(gfx.camera.position);
  horde.update(dt, targets(), { inArena });
  if (!net.client) bossStepHost(dt);
  remotes.update(dt);
  projStep(dt); dropsStep(dt); crateStep(dt);
  if (!net.client) roundsStep(dt);
  zonesStep();
  if (live) interactStep(); else hud.prompt(null);
  S.crushCD = Math.max(0, S.crushCD - dt);
  if (!net.active && player.dead) { S.deadT += dt; if (S.deadT > 2.6) gameOver(); }
  netStep(dt);
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (state === 'boot') return;
  input.poll();
  if (input.hit('Escape') && (state === 'play') && (input.touch || input.lockFailed || !input.locked)) pause();
  // a co-op game keeps running behind the pause menu
  const running = state === 'play' || (state === 'pause' && net.active) || (state === 'over' && net.active);
  if (running) step(dt, state === 'play');
  if (state === 'play' || state === 'over' || (state === 'pause' && net.active)) cameraStep(dt, state === 'play');
  else if (state === 'menu') {
    const t = now / 1000, c = gfx.camera, fy = map.floorY;
    c.position.set(20.5 + Math.sin(t * 0.13) * 1.2, fy + 1.55 + Math.sin(t * 0.2) * 0.2, 9.6 + Math.cos(t * 0.11) * 0.8);
    c.lookAt(15, fy + 0.85, 6.6); c.updateMatrixWorld();
    for (const s of S.slots) s.model.visible = false;
  }
  if (state !== 'pause' || net.active) {
    fx.listener.copy(gfx.camera.position);
    fx.update(dt);
    tracersStep(dt);
    const b = gfx.flush(dt);
    if (b) { nav.rebuildVoxBox(b); W.flowT = 0; }
    if ((W.flowT -= dt) <= 0 && running && !net.client) { nav.flow(targets().filter((t) => !t.dead)); W.flowT = 0.25; }
    gfx.updateLamps(gfx.camera.position.x, gfx.camera.position.y, gfx.camera.position.z, dt);
    props.core.rotation.y += dt; props.core.rotation.x += dt * 0.6;
    props.matter.rotation.y += dt * 0.8; props.matter.position.y = map.matter.y + Math.sin(now / 600) * 0.06;
  }
  if (state === 'play' || (net.active && state !== 'menu')) hudStep(dt);
  $('touch').hidden = !(input.touch && state === 'play');
  gfx.resize();
  gfx.render();
  input.endFrame();
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { $('fps').textContent = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
}

/* ================================================================ screens */
const screens = ['intro', 'pause', 'over'];
function showScreen(id) { for (const s of screens) $(s).hidden = s !== id; hud.show(state === 'play' || state === 'over' || (state === 'pause' && net.active)); }
async function play() {
  audio.start(); state = 'play'; showScreen(null); hud.show(true);
  const ok = await input.capture();
  if (!ok && !input.touch && !input.locked) hud.toast('Mouse capture is not available here: hold the mouse button and drag to look', 5);
  canvas.focus();
}
function pause() {
  if (state !== 'play') return; state = 'pause'; audio.arc(false); audio.matter(0); input.release(); showScreen('pause');
  $('pauseRoom').hidden = !net.active; if (net.active) $('pauseRoom').innerHTML = `Co-op room <b>${net.code}</b> · ${1 + remotes.map.size} playing${net.client ? '' : ' · the game keeps running while paused'}`;
  $('leaveBtn').hidden = !net.active; $('restartBtn').hidden = net.client;
}
function gameOver() {
  state = 'over'; input.release(); audio.arc(false); audio.matter(0);
  S.best = Math.max(S.best, S.round); store.set('best', S.best);
  $('overRound').textContent = S.round; $('overKills').textContent = fmt(S.kills); $('overPoints').textContent = fmt(S.earned);
  $('overBest').textContent = S.best; $('overZone').textContent = map.zones.find((z) => z.id === S.deepest).name;
  $('overTitle').textContent = S.boss === 'dead' ? 'The Warden fell' : S.round >= 10 ? 'You held out' : 'Overrun';
  $('againBtn').disabled = net.client; $('againBtn').textContent = net.client ? 'Waiting for the host' : 'Play again';
  showScreen('over');
}
function restart() {
  if (net.client) return;
  newRun(false);
  if (net.host) { net.broadcast({ k: 'reset' }); for (const p of S.peers.values()) p.dead = false; }
  play();
}

function controlsTabs() {
  const sets = {
    keyboard: [['W A S D', 'Move'], ['Mouse', 'Aim · left click fires'], ['Right mouse', 'Aim down sights'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['R', 'Reload'], ['Q · wheel · 1 2', 'Swap weapon'], ['G', 'Throw frag'], ['V', 'Knife'], ['E', 'Buy · use · take'], ['Esc', 'Pause']],
    gamepad: [['Left stick', 'Move · click to sprint'], ['Right stick', 'Look'], ['RT · LT', 'Fire · aim'], ['A', 'Jump'], ['X', 'Buy and use, or reload'], ['Y', 'Swap weapon'], ['RB', 'Throw frag'], ['LB · R3', 'Knife'], ['Menu', 'Pause']],
    touch: [['Left thumb', 'Move · push to the top to sprint'], ['Right thumb', 'Look'], ['Fire', 'Hold to shoot, drag to aim'], ['Aim', 'Toggle sights'], ['Use', 'Buy · take'], ['Frag · Knife · Swap', 'Top row of buttons'], ['Reload · Jump', 'Beside Fire']],
    matter: [['Hold left', 'Grab a zombie, a loose piece, or a chunk of wall'], ['Swing the mouse', 'Swing what you hold'], ['Let go', 'Throw it'], ['Hold right', 'Disintegrate · or crush what you hold']],
  };
  for (const box of document.querySelectorAll('[data-ctl]')) {
    const panel = box.querySelector('[data-panel]'), tabs = box.querySelectorAll('.tab');
    const set = (k) => { tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === k))); panel.innerHTML = '<dl class="keys">' + sets[k].map(([a, b]) => `<dt>${a.split(' · ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</dt><dd>${b}</dd>`).join('') + '</dl>'; };
    tabs.forEach((t) => t.addEventListener('click', () => set(t.dataset.tab)));
    set(matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard');
  }
}

function setLoad(k, t) { $('loadFill').style.width = `${Math.round(k * 100)}%`; $('loadText').textContent = t; }
const NAMES = ['Rook', 'Brick', 'Sledge', 'Ember', 'Gauge', 'Ratchet', 'Moss', 'Flint', 'Vesper', 'Torque'];

async function boot() {
  controlsTabs();
  setLoad(0.08, 'Pouring the block and the rock under it…'); await nextFrame();
  world = new World(SX, SY, SZ); map = buildMap(world);
  setLoad(0.3, 'Lighting the block…'); await nextFrame();
  try { gfx = new Gfx(canvas, world, map, qi); }
  catch (e) { setLoad(0, 'WebGL 2 is not available in this browser, so the game cannot start.'); console.error(e); return; }
  setLoad(0.45, 'Meshing 576 chunks…'); await nextFrame();
  gfx.buildAll();
  setLoad(0.75, 'Routing the horde…'); await nextFrame();
  audio = new Audio(); audio.setOn(store.get('sound', true));
  nav = new Nav(world); fx = new Fx(gfx, world, audio); horde = new Horde(gfx, world, nav, fx, audio);
  player = new Player(world, map); input = new Input(canvas, $('touch')); hud = new Hud(); remotes = new Remotes(gfx);
  try { await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]); } catch { /* fonts optional */ }
  buildProps();
  horde.onKill = onKill;
  horde.onLost = () => { if (!net.client) S.toSpawn++; };
  horde.onAttack = (zb, t, dmg) => hurtPlayer(t.id, dmg);
  horde.onRemoteHit = (zb, dmg, info) => net.send({ k: 'hit', id: zb.id, dmg, info: { part: info.part, head: info.head, dx: r2(info.dx || 0), dy: r2(info.dy || 0), dz: r2(info.dz || 0), explosive: info.explosive, vapor: info.vapor, dis: info.dis, speed: info.speed, knife: info.knife, crush: info.crush, quiet: info.quiet } });
  horde.carve = (x, y, z, r, tier, o) => edit({ t: 'blast', x, y, z, r, tier, o, by: 'z' });
  horde.onBoss = bossEvent;
  fx.onMove = bodySweep; fx.onImpact = bodyImpact;
  fx.onCrush = (b) => {
    const p = b.group.position, r = b.rad * 0.75;
    if (!net.client && !b.held && !b.danger) for (const zb of horde.list.slice()) if (zb.type !== 'boss' && Math.hypot(zb.x - p.x, zb.z - p.z) < r && zb.y < p.y && zb.y + 2 > p.y - b.rad) horde.damage(zb, 1e9, { crush: true, dx: b.vel.x * 0.2, dy: 0.3, dz: b.vel.z * 0.2, by: b.owner || 'world' });
    if (S.crushCD <= 0 && !b.held && b.vel.y < -3 && Math.hypot(player.x - p.x, player.z - p.z) < r && player.y < p.y && player.y + 1.9 > p.y - b.rad) { S.crushCD = 1; hurtMe(35); }
  };
  input.onLockChange = (locked) => { if (!locked && state === 'play' && !input.touch && !input.lockFailed) pause(); };
  canvas.addEventListener('mousedown', () => { if (state === 'play' && !input.locked && !input.lockFailed && !input.touch) input.capture(); });
  S.name = store.get('name', NAMES[(Math.random() * NAMES.length) | 0]); S.color = 0;
  newRun(true);
  // settings
  const qs = $('qualSel'); qs.value = String(qi); qs.addEventListener('change', () => { qi = +qs.value; store.set('quality', qi); gfx.setQuality(qi); });
  const ss = $('sndSel'); ss.value = audio.on ? '1' : '0'; ss.addEventListener('change', () => { audio.setOn(ss.value === '1'); store.set('sound', ss.value === '1'); });
  const sr = $('sensRange'); sr.value = String(sens); $('sensOut').textContent = sens.toFixed(2);
  sr.addEventListener('input', () => { sens = +sr.value; $('sensOut').textContent = sens.toFixed(2); store.set('sens', sens); });
  const ni = $('nameIn'); ni.value = S.name; ni.addEventListener('input', () => { S.name = ni.value.trim().slice(0, 16) || 'Player'; store.set('name', S.name); });
  $('codeIn').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5); });
  $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinCoop(); });
  if (!Net.supported()) { $('hostBtn').disabled = $('joinBtn').disabled = $('codeIn').disabled = true; $('coopMsg').textContent = 'Co-op needs direct browser connections, which this page cannot make. Open the hosted copy of the game to play with friends.'; }
  $('startBtn').addEventListener('click', play);
  $('hostBtn').addEventListener('click', hostCoop);
  $('joinBtn').addEventListener('click', joinCoop);
  $('resumeBtn').addEventListener('click', play);
  $('restartBtn').addEventListener('click', restart);
  $('leaveBtn').addEventListener('click', leaveCoop);
  $('againBtn').addEventListener('click', restart);
  $('pauseBtn').addEventListener('click', pause);
  addEventListener('keydown', (e) => { if (e.code === 'KeyM' && audio && e.target.tagName !== 'INPUT') { audio.setOn(!audio.on); store.set('sound', audio.on); hud.toast(audio.on ? 'Sound on' : 'Sound off'); } });
  $('bestRound').textContent = store.get('best', 0) ? `Best: round ${store.get('best', 0)}` : '';
  setLoad(1, 'Ready');
  $('load').hidden = true; $('startBtn').disabled = false; $('intro').classList.remove('boot');
  state = 'menu';
  window.__bf = { S, W, M, net, get player() { return player; }, get horde() { return horde; }, get world() { return world; }, get map() { return map; }, get gfx() { return gfx; }, get fx() { return fx; }, get remotes() { return remotes; },
    give, startRound, play, explode, stats, fireOnce, newRun, edit, hitZombie, tryGrab, releaseHold, openZone, takeDrop, dropPower, hostCoop, joinCoop, get state() { return state; } };
}

requestAnimationFrame(frame);
boot();
