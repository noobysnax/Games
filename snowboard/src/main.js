// Boot, fixed-step loop with render interpolation, chase camera, HUD and menus.

import * as THREE from 'three';
import { createGfx, REDUCED } from './gfx.js';
import { buildCourse, sectionAt, SECTIONS, SURF } from './course.js';
import { Rider, STEP } from './physics.js';
import { buildWorld } from './world.js';
import { createRider } from './riderRig.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { clamp, lerp, smooth, damp, wrapPi } from './util.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const gfx = createGfx(canvas);
const { scene, camera, renderer } = gfx;
const audio = createAudio();

let course, rider, rig, fx, input;
let mode = 'intro'; // intro | play | paused
let time = 0, acc = 0, last = performance.now(), hudTimer = 0, fpsAvg = 60, slowFrames = 0, frameCount = 0;
let jumpGuard = false, timeLapse = false, hudHidden = false, finishShown = false, finishAt = 0, freeRide = false;
const prevPos = new THREE.Vector3(), curPos = new THREE.Vector3(), pos = new THREE.Vector3();
const prevQ = new THREE.Quaternion(), curQ = new THREE.Quaternion(), quat = new THREE.Quaternion();
const cam = { yaw: 0, tan: 0.2, pos: new THREE.Vector3(), look: new THREE.Vector3(), shake: 0, fov: 68, rush: 0, side: 0, init: false };
const S = { h: 0, gx: 0, gz: 0 };
const debug = { freeze: false };

/* ------------------------------------------------------------------ controls reference */
const CONTROLS = {
  keyboard: [
    ['<kbd>A</kbd> <kbd>D</kbd>', 'Carve left and right. In the air: spin'],
    ['<kbd>W</kbd>', 'Push off and tuck. In the air: front flip'],
    ['<kbd>S</kbd>', 'Brake. In the air: back flip'],
    ['<kbd>Space</kbd>', 'Hold to crouch, release to jump'],
    ['<kbd>Shift</kbd>', 'Speed boost'],
    ['<kbd>Q</kbd> <kbd>E</kbd>', 'Barrel roll in the air'],
    ['<kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd>', 'Grabs: nose, tail, melon, indy. Combine two for more'],
    ['<kbd>R</kbd> <kbd>Esc</kbd>', 'Restart run, pause'],
  ],
  gamepad: [
    ['<kbd>Left stick</kbd>', 'Carve. Up to push and tuck, down to brake. In the air: spin and flip'],
    ['<kbd>A</kbd>', 'Hold to crouch, release to jump'],
    ['<kbd>RT</kbd> <kbd>LT</kbd>', 'Speed boost, brake'],
    ['<kbd>Right stick</kbd>', 'Grabs, eight directions. <kbd>B</kbd> <kbd>X</kbd> <kbd>Y</kbd> are indy, melon, method'],
    ['<kbd>LB</kbd> <kbd>RB</kbd>', 'Barrel roll in the air'],
    ['<kbd>Menu</kbd> <kbd>View</kbd>', 'Pause, restart run'],
  ],
  touch: [
    ['<kbd>Left thumb</kbd>', 'Stick: carve, up to push and tuck, down to brake. In the air: spin and flip'],
    ['<kbd>Jump</kbd>', 'Hold to crouch, release to jump'],
    ['<kbd>Boost</kbd>', 'Hold for a speed boost'],
    ['<kbd>Grab</kbd>', 'Hold in the air. Drag while holding to pick the grab'],
  ],
};
const NOTES = {
  keyboard: 'On a rail, A and D swing the board between a 50-50 and a boardslide. Land with the board flat and pointing down the hill.',
  gamepad: 'Plug in or pair an Xbox controller and press any button. If it is not picked up, open the game in its own browser tab. On a rail, steer to swing between a 50-50 and a boardslide.',
  touch: 'Works best in landscape. The stick appears wherever your left thumb lands. On a rail, steer to swing between a 50-50 and a boardslide.',
};
function showControls(which) {
  for (const box of document.querySelectorAll('[data-ctl]')) {
    for (const t of box.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === which));
    box.querySelector('[data-panel]').innerHTML = `<dl class="keys">${CONTROLS[which].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl><p class="note">${NOTES[which]}</p>`;
  }
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showControls(t.dataset.tab));
const HINTS = {
  keyboard: '<span><kbd>A</kbd><kbd>D</kbd> carve</span><span><kbd>W</kbd> tuck</span><span><kbd>S</kbd> brake</span><span><kbd>Space</kbd> jump</span><span><kbd>Shift</kbd> boost</span><span><kbd>Arrows</kbd> grab</span><span><kbd>Q</kbd><kbd>E</kbd> roll</span><span><kbd>R</kbd> restart</span><span><kbd>Esc</kbd> menu</span>',
  gamepad: '<span><kbd>LS</kbd> carve / spin / flip</span><span><kbd>A</kbd> jump</span><span><kbd>RT</kbd> boost</span><span><kbd>LT</kbd> brake</span><span><kbd>RS</kbd> grab</span><span><kbd>LB</kbd><kbd>RB</kbd> roll</span><span><kbd>Menu</kbd> pause</span>',
  touch: '',
};
function setHints(d) {
  $('hints').innerHTML = HINTS[d]; $('hints').classList.remove('fade');
  clearTimeout(setHints._t); setHints._t = setTimeout(() => $('hints').classList.add('fade'), 14000);
  $('touch').hidden = !(d === 'touch' && mode === 'play');
}

/* ------------------------------------------------------------------ HUD helpers */
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200); }
const fmtRun = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
function callout(big, pts, names, bad) {
  const c = $('callout');
  c.querySelector('.big').textContent = big; c.querySelector('.pts').textContent = pts || ''; c.querySelector('.names').textContent = names || '';
  c.classList.toggle('bad', !!bad); c.classList.add('show');
  clearTimeout(callout._t); callout._t = setTimeout(() => c.classList.remove('show'), bad ? 1300 : 2100);
}
let bestStored = 0;
try { bestStored = +localStorage.getItem('lvs-best') || 0; } catch (_) { /* storage unavailable */ }

/* ------------------------------------------------------------------ game events */
function handleEvents() {
  for (const e of rider.events) {
    switch (e.type) {
      case 'jump': audio.sfx.jump(e.power); fx.burst(rider.pos, rider.vel, 0.05 + e.power * 0.2); break;
      case 'land': {
        const k = clamp(e.impact / 14, 0, 1);
        audio.sfx.land(e.impact); fx.burst(rider.pos, rider.vel, 0.15 + k * 0.85);
        cam.shake = Math.max(cam.shake, 0.1 + k * 0.5); input.rumble(0.3 + k * 0.7, 0.2 + k * 0.5, 120 + k * 160);
        if (e.quality === 'sketchy' && !rider.combo.length) callout('Sketchy', '', '', true);
        break;
      }
      case 'score': {
        const head = e.quality === 'perfect' ? 'Perfect' : e.quality === 'sketchy' ? 'Sketchy' : e.names.length > 1 ? 'Combo' : 'Clean';
        if (e.points >= 100 || e.quality === 'sketchy') {
          callout(head, `+${fmtNum(e.points)}${e.mult > 1 ? `  ×${e.mult} combo` : ''}`, e.names.join('  →  '), e.quality === 'sketchy');
          audio.sfx.score(e.quality);
        }
        break;
      }
      case 'crash': audio.sfx.crash(); fx.burst(rider.pos, rider.vel, 1); cam.shake = 0.9; input.rumble(1, 0.8, 380); callout(e.reason === 'Bail' ? 'Bail' : e.reason, '', 'Combo lost', true); break;
      case 'railStart': audio.sfx.railOn(); input.rumble(0.15, 0.5, 90); break;
      case 'boost': audio.sfx.boost(); input.rumble(0.1, 0.4, 160); break;
      case 'bump': audio.sfx.bump(); input.rumble(0.5, 0.3, 90); cam.shake = Math.max(cam.shake, 0.25); break;
      case 'finish': {
        audio.sfx.finish(); finishAt = time + 1.6; finishShown = false;
        if (e.score > bestStored) { bestStored = e.score; try { localStorage.setItem('lvs-best', String(e.score)); } catch (_) { /* fine */ } }
        $('finTime').textContent = fmtRun(e.time); $('finScore').textContent = fmtNum(e.score); $('finBest').textContent = fmtNum(bestStored);
        $('finTitle').textContent = e.score > 0 && e.score >= bestStored ? 'New best run' : 'Run complete';
        break;
      }
      default: break;
    }
  }
  rider.events.length = 0;
}

/* ------------------------------------------------------------------ flow control */
function snapState() {
  curPos.set(rider.pos.x, rider.pos.y, rider.pos.z); prevPos.copy(curPos);
  curQ.set(rider.quat.x, rider.quat.y, rider.quat.z, rider.quat.w); prevQ.copy(curQ);
  cam.init = false; acc = 0;
}
function restart(d = 3) {
  rider.reset(d); rider.best = bestStored;
  fx.clearTrail(); snapState();
  finishShown = false; finishAt = 0; freeRide = false; $('finish').hidden = true;
  $('callout').classList.remove('show');
}
function play() {
  mode = 'play'; jumpGuard = true;
  $('intro').hidden = true; $('pause').hidden = true; $('hud').hidden = false;
  if (!$('finish').hidden) $('finish').hidden = true;
  $('touch').hidden = input.device !== 'touch';
  audio.init(); canvas.focus(); last = performance.now();
  // keep the screen awake while riding with a controller or touch; fine if the browser says no
  try { if (navigator.wakeLock && !play.lock) navigator.wakeLock.request('screen').then((l) => { play.lock = l; l.addEventListener('release', () => { play.lock = null; }); }).catch(() => {}); } catch (_) { /* optional */ }
  setHints(input.device);
}
function pause() {
  if (mode !== 'play') return;
  mode = 'paused';
  $('pause').hidden = false; $('touch').hidden = true;
  $('todRange').value = gfx.tod.t.toFixed(2); $('todOut').textContent = gfx.fmtTime(gfx.tod.t);
  showControls(input.device);
  setTimeout(() => $('resumeBtn').focus(), 0);
}
function setQuality(i, announce) {
  const Q = gfx.applyQuality(i);
  $('qualSel').value = String(gfx.quality);
  if (announce) toast(`Quality: ${Q.name}`);
}
function setSound(v) { audio.setOn(v); $('sndSel').value = v ? '1' : '0'; }
function setTime(t, label) { gfx.setTOD(t); timeLapse = false; if (label) toast(label); }

function onAction(a, arg) {
  if (a === 'padConnected') { toast(`${arg} connected`); showControls('gamepad'); return; }
  if (a === 'padDisconnected') { toast('Controller disconnected'); if (mode === 'play') pause(); return; }
  if (mode === 'intro') { if (a === 'confirm' && !$('startBtn').disabled) play(); return; }
  if (a === 'pause') { if (mode === 'play') pause(); else if (mode === 'paused') play(); return; }
  if (mode === 'paused') { if (a === 'confirm') play(); if (a === 'restart') { restart(); play(); } return; }
  switch (a) {
    case 'restart': restart(); toast('Back to the summit'); break;
    case 'confirm': if (finishShown) { restart(); play(); } break;
    case 'mute': setSound(!audio.on); toast(audio.on ? 'Sound on' : 'Sound off'); break;
    case 'hud': hudHidden = !hudHidden; $('hud').classList.toggle('off', hudHidden); break;
    case 'quality': setQuality((gfx.quality + 1) % 3, true); break;
    case 'timelapse': timeLapse = !timeLapse; toast(timeLapse ? 'Time-lapse on' : 'Time-lapse off'); break;
    case 'tod1': setTime(6.9, 'First light'); break;
    case 'tod2': setTime(12.5, 'Midday'); break;
    case 'tod3': setTime(16.9, 'Golden hour'); break;
    case 'tod4': setTime(22.6, 'Night ride'); break;
    default: break;
  }
}

/* ------------------------------------------------------------------ camera */
const _f = new THREE.Vector3(), _des = new THREE.Vector3(), _lk = new THREE.Vector3();
function updateCamera(dt) {
  const r = rider, hs = Math.hypot(r.vel.x, r.vel.z);
  const boardYaw = r.yaw + (r.sw < 0 ? Math.PI : 0);
  const target = r.mode === 'crash' ? cam.yaw : hs > 2.5 ? Math.atan2(-r.vel.x, -r.vel.z) : r.mode === 'ground' ? boardYaw : cam.yaw;
  const kYaw = r.mode === 'air' ? 1.6 : 2.6 + Math.min(hs, 25) * 0.1;
  cam.yaw += wrapPi(target - cam.yaw) * (1 - Math.exp(-kYaw * dt));
  const fx_ = -Math.sin(cam.yaw), fz_ = -Math.cos(cam.yaw);
  course.sample(pos.x, pos.z, S);
  const height = pos.y - S.h;
  cam.tan = damp(cam.tan, clamp(-(S.gx * fx_ + S.gz * fz_), -0.25, 0.75), 2.5, dt);
  const airK = smooth(1, 7, height);
  const dist = 4.6 + r.speed * 0.085 + airK * 2.2, up = 1.9 + r.speed * 0.018 + airK * 0.8;
  cam.side = damp(cam.side, r.mode === 'rail' ? 1.5 : 0, 3, dt);   // step aside on rails so the rail itself is in view
  _des.set(pos.x - fx_ * dist - fz_ * cam.side, pos.y + up + dist * cam.tan * 0.8, pos.z - fz_ * dist + fx_ * cam.side);
  const ahead = 3 + r.speed * 0.12;
  _lk.set(pos.x + fx_ * ahead, pos.y + 0.9 - ahead * cam.tan * 0.55 - airK * 1.2, pos.z + fz_ * ahead);
  if (!cam.init) { cam.pos.copy(_des); cam.look.copy(_lk); cam.init = true; cam.yaw = target; }
  const k = 1 - Math.exp(-7.5 * dt), ky = 1 - Math.exp(-5.5 * dt);
  cam.pos.x += (_des.x - cam.pos.x) * k; cam.pos.z += (_des.z - cam.pos.z) * k; cam.pos.y += (_des.y - cam.pos.y) * ky;
  const floor = course.heightAt(cam.pos.x, cam.pos.z) + 1.25;
  if (cam.pos.y < floor) cam.pos.y = floor;
  cam.look.lerp(_lk, 1 - Math.exp(-11 * dt));
  camera.position.copy(cam.pos);
  cam.shake = damp(cam.shake, 0, 5, dt);
  if (cam.shake > 0.005 && !REDUCED) {
    camera.position.x += (Math.sin(time * 61) + Math.sin(time * 37.7)) * 0.07 * cam.shake;
    camera.position.y += (Math.sin(time * 53) + Math.cos(time * 41.3)) * 0.09 * cam.shake;
  }
  camera.lookAt(cam.look);
  if (!REDUCED) camera.rotateZ(clamp(-r.turnRate * 0.035, -0.09, 0.09) * (r.mode === 'ground' ? 1 : 0));
  cam.rush = damp(cam.rush, r.boosting ? 1 : smooth(24, 34, r.speed) * 0.6, 4, dt);
  const fovT = REDUCED ? 68 : 66 + smooth(5, 30, r.speed) * 15 + cam.rush * 5;
  cam.fov = damp(cam.fov, fovT, 3.5, dt);
  camera.fov = cam.fov; camera.updateProjectionMatrix();
}
function introCamera(dt) {
  // parked behind the rider at the summit, looking down the whole run
  const sway = REDUCED ? 0 : Math.sin(time * 0.16);
  _des.set(pos.x - 3.6 + sway * 1.2, pos.y + 2.4 + Math.sin(time * 0.23) * 0.25, pos.z + 6.4);
  const floor = course.heightAt(_des.x, _des.z) + 1.3;
  if (_des.y < floor) _des.y = floor;
  if (!cam.init) camera.position.copy(_des); else camera.position.lerp(_des, 1 - Math.exp(-2 * dt));
  _lk.set(pos.x + 4.5, pos.y - 2.4, pos.z - 18);   // rider sits right of centre, clear of the title panel
  camera.lookAt(_lk); camera.fov = 64; camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ per-frame effects */
function emitFx(dt) {
  const r = rider;
  if (r.mode === 'ground' && r.speed > 2) {
    const hs = Math.hypot(r.vel.x, r.vel.z) || 1, tx = r.vel.x / hs, tz = r.vel.z / hs;
    const rx = -tz, rz = tx; // right of travel
    const powder = r.surf === SURF.POWDER ? 0.5 : r.surf === SURF.ICE ? 0 : 0.1;
    const amt = (r.carve * 1.1 + r.skid * 1.5 + powder * clamp(r.speed / 14, 0, 1)) * dt * 60;
    if (amt > 0.02) {
      const sgn = r.turnRate > 0 ? 1 : -1, fwd = r.brake * 0.8;
      fx.spray(pos, r.vel, rx * sgn + tx * fwd, rz * sgn + tz * fwd, amt, r.speed);
    }
    fx.track(pos.x, pos.z, 0.34 + r.skid * 1.0 + Math.abs(r.lean) * 0.25, r.surf !== SURF.ICE && r.surf !== SURF.ROCK);
  } else fx.track(0, 0, 0, false);
  if (r.mode === 'rail') fx.spark(pos, r.vel);
  if (r.mode === 'crash' && r.speed > 3 && r.height < 0.3) fx.spray(pos, r.vel, 0, 0, 0.5 * dt * 60, r.speed);
}

/* ------------------------------------------------------------------ HUD */
function updateHud() {
  const r = rider;
  $('spd').textContent = Math.round(r.speed * 3.6);
  $('score').textContent = fmtNum(r.score);
  $('flow').textContent = '×' + r.flow.toFixed(1);
  $('best').textContent = fmtNum(Math.max(bestStored, r.score));
  $('boostFill').style.width = (r.boost * 100).toFixed(0) + '%';
  $('boostWrap').classList.toggle('on', r.boosting);
  $('runInfo').textContent = `${fmtRun(r.finished ? r.finishTime : r.runTime)} · ${sectionAt(-r.pos.z).name}`;
  $('fps').textContent = fpsAvg.toFixed(0);
  const live = r.liveTrick(), chain = r.combo.map((c) => c.name);
  if (live) chain.push(live);
  $('trick').textContent = chain.join('  →  ');
  const pr = $('prompt');
  if (r.holding && mode === 'play') {
    pr.hidden = false;
    pr.textContent = input.device === 'gamepad' ? 'Push the left stick up to drop in' : input.device === 'touch' ? 'Push the stick up to drop in' : 'Hold W to drop in';
  } else if (r.finished && !finishShown && freeRide && r.speed < 1) { pr.hidden = false; pr.textContent = input.device === 'gamepad' ? 'Press View to ride again' : input.device === 'touch' ? 'Pause to ride again' : 'Press R to ride again'; }
  else pr.hidden = true;
  audio.update(r, mode === 'play');
}

/* ------------------------------------------------------------------ loop */
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
  last = now;
  const inp = input.poll();
  // the press that started or resumed the game must not also count as a jump
  if (jumpGuard) { if (inp.jump) inp.jump = false; else jumpGuard = false; }
  if (mode === 'play' && debug.freeze) { time += dt; acc = 0; }
  else if (mode === 'play') {
    time += dt; acc += dt;
    let n = 0;
    while (acc >= STEP && n < 10) {
      prevPos.copy(curPos); prevQ.copy(curQ);
      rider.step(inp, STEP);
      curPos.set(rider.pos.x, rider.pos.y, rider.pos.z); curQ.set(rider.quat.x, rider.quat.y, rider.quat.z, rider.quat.w);
      if (rider.events.length) handleEvents();
      acc -= STEP; n++;
    }
    if (n === 10) acc = 0;
    if (timeLapse) gfx.setTOD(gfx.tod.t + dt * 0.4);
    if (finishAt && time > finishAt && !finishShown && !freeRide) { finishShown = true; $('finish').hidden = false; $('touch').hidden = true; setTimeout(() => $('againBtn').focus(), 0); }
  } else if (mode === 'intro') time += dt;
  const alpha = clamp(acc / STEP, 0, 1);
  pos.lerpVectors(prevPos, curPos, alpha); quat.slerpQuaternions(prevQ, curQ, alpha);
  course.sample(pos.x, pos.z, S);
  const lift = rider.mode === 'rail' ? 0 : 0.5 * (Math.abs(S.gx) + Math.abs(S.gz)) * clamp(1 - (pos.y - S.h) * 4, 0, 1) + 0.015;
  rig.update(rider, pos, quat, lift, dt, time);
  if (mode === 'intro') introCamera(dt); else if (mode === 'play') { updateCamera(dt); emitFx(dt); }
  fx.update(mode === 'paused' ? 0 : dt, camera, renderer, pos);
  gfx.render(dt, time, pos, mode === 'play' ? cam.rush : 0);

  frameCount++; fpsAvg = lerp(fpsAvg, 1 / dt, 0.05);
  if (mode === 'play' && frameCount > 240) {
    if (fpsAvg < 30) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 150 && gfx.quality > 0) { setQuality(gfx.quality - 1, false); toast(`Switched to ${gfx.QUALITY[gfx.quality].name} quality for a smoother ride`); slowFrames = 0; }
  }
  hudTimer += dt;
  if (hudTimer > 0.08 && mode !== 'intro') { hudTimer = 0; updateHud(); }
}

/* ------------------------------------------------------------------ boot */
const tick = () => new Promise((r) => setTimeout(r, 0));
async function progress(f, label) { $('loadFill').style.width = (f * 100).toFixed(0) + '%'; if (label) $('loadText').textContent = label; await tick(); }

async function boot() {
  await progress(0.03, 'Shaping the mountain…');
  course = await buildCourse((p) => progress(0.03 + p * 0.32));
  await progress(0.36, 'Stacking snow…');
  const world = await buildWorld(gfx, course, (p) => progress(0.36 + p * 0.54, p > 0.6 ? 'Raising the far ranges…' : 'Stacking snow…'));
  rider = new Rider(course);
  rig = createRider(gfx); scene.add(rig.root);
  fx = createFx(gfx, world.smoke);
  input = createInput({ canvas, touchRoot: $('touch'), onAction, onDevice: (d) => { setHints(d); if (mode !== 'play') showControls(d); } });
  await progress(0.94, 'Lighting lanterns…');
  gfx.setTOD(16.9);
  const coarse = matchMedia('(hover:none) and (pointer:coarse)').matches;
  setQuality(coarse || innerWidth * innerHeight * (devicePixelRatio || 1) > 2.6e6 ? 1 : 2, false);
  if (!coarse && (navigator.hardwareConcurrency || 8) <= 4) setQuality(1, false);
  const forced = new URLSearchParams(location.search).get('q');   // ?q=0..2 pins the quality (used by the dev harness)
  if (forced !== null) { setQuality(+forced, false); slowFrames = -1e9; }
  restart(3);
  for (const s of SECTIONS) { const o = document.createElement('option'); o.value = String(s.d < 3 ? 3 : s.d + 4); o.textContent = s.name; $('warpSel').appendChild(o); }
  showControls(input.device);
  introCamera(0.016);
  try { renderer.compile(scene, camera); } catch (_) { /* compile is only a warm-up */ }
  await progress(1, 'Ready.');
  $('intro').classList.remove('boot'); $('load').hidden = true; $('startBtn').disabled = false; $('startBtn').focus();
  requestAnimationFrame(frame);
}

$('startBtn').addEventListener('click', play);
$('resumeBtn').addEventListener('click', play);
$('restartBtn').addEventListener('click', () => { restart(); play(); });
$('againBtn').addEventListener('click', () => { restart(); play(); });
$('freeBtn').addEventListener('click', () => { freeRide = true; finishShown = false; $('finish').hidden = true; play(); });
$('pauseBtn').addEventListener('click', pause);
$('warpSel').addEventListener('change', (e) => { restart(+e.target.value); play(); });
$('todRange').addEventListener('input', (e) => { setTime(+e.target.value); $('todOut').textContent = gfx.fmtTime(gfx.tod.t); });
$('qualSel').addEventListener('change', (e) => setQuality(+e.target.value, false));
$('sndSel').addEventListener('change', (e) => setSound(e.target.value === '1'));
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('blur', () => { if (mode === 'play' && input && input.device === 'keyboard') pause(); });

gfx.resize();
boot().catch((err) => { console.error(err); $('loadText').textContent = 'This device could not start WebGL 2. Try a recent browser.'; });

// handy for tuning from the console
window.__game = { debug, snapState, get fx() { return fx; }, get rider() { return rider; }, get course() { return course; }, gfx, restart, play, pause, get mode() { return mode; }, get input() { return input; }, cam };
