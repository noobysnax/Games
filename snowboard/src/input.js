// One input state from three sources: keyboard, a standard-mapping gamepad (Xbox layout), and touch.
// state = { steer -1..1 (right +), pitch -1..1 (forward -, back +), roll, jump, boost, brake 0..1, grab 0..8 }

import { clamp } from './util.js';

const DEAD = 0.16;

/** 8-way grab from a direction (x right/toe side, y up/nose). 0 = none. */
export function grabFromDir(x, y) {
  if (Math.hypot(x, y) < 0.5) return 0;
  const a = Math.atan2(y, x), oct = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  // E, NE, N, NW, W, SW, S, SE  ->  Indy, Mute, Nose, Method, Melon, Stalefish, Tail, Japan
  return [1, 2, 5, 7, 3, 4, 6, 8][oct];
}

export function createInput({ canvas, touchRoot, onAction, onDevice }) {
  const state = { steer: 0, pitch: 0, roll: 0, jump: false, boost: false, brake: 0, grab: 0 };
  const keys = new Set();
  const touch = { x: 0, y: 0, jump: false, boost: false, gx: 0, gy: 0, grab: false };
  let device = matchMedia('(hover:none) and (pointer:coarse)').matches ? 'touch' : 'keyboard';
  let padIndex = -1, padName = '', prevButtons = [];
  const setDevice = (d) => { if (d !== device) { device = d; onDevice(d); } };

  /* keyboard */
  const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'];
  addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (GAME_KEYS.includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    setDevice('keyboard');
    const act = { Escape: 'pause', KeyP: 'pause', KeyR: 'restart', Enter: 'confirm', KeyM: 'mute', KeyH: 'hud', KeyG: 'quality', KeyT: 'timelapse',
      Digit1: 'tod1', Digit2: 'tod2', Digit3: 'tod3', Digit4: 'tod4' }[e.code];
    if (act) onAction(act);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  /* gamepad */
  addEventListener('gamepadconnected', (e) => { padIndex = e.gamepad.index; padName = e.gamepad.id; onAction('padConnected', padLabel()); setDevice('gamepad'); });
  addEventListener('gamepaddisconnected', (e) => { if (e.gamepad.index === padIndex) { padIndex = -1; onAction('padDisconnected'); if (device === 'gamepad') setDevice('keyboard'); } });
  function padLabel() {
    const n = padName.replace(/\(.*?\)/g, '').trim();
    return /xbox|xinput|045e/i.test(padName) ? 'Xbox controller' : n.length > 28 ? 'Controller' : n || 'Controller';
  }
  function getPad() {
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (_) { return null; }
    if (padIndex >= 0 && pads[padIndex] && pads[padIndex].connected) return pads[padIndex];
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { padIndex = p.index; padName = p.id; onAction('padConnected', padLabel()); return p; }
    for (const p of pads) if (p && p.connected && p.buttons.length >= 10) { padIndex = p.index; padName = p.id; onAction('padConnected', padLabel()); return p; }
    return null;
  }
  const stick = (x, y) => {
    const m = Math.hypot(x, y);
    if (m < DEAD) return [0, 0];
    const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
    return [x * k, y * k];
  };
  const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.35);
  function rumble(strong, weak, ms) {
    const p = padIndex >= 0 ? getPad() : null;
    try { if (p && p.vibrationActuator && p.vibrationActuator.playEffect) p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {}); } catch (_) { /* no rumble */ }
  }

  /* touch: left stick, right buttons, a grab pad you can drag for direction */
  if (touchRoot) {
    const $ = (id) => touchRoot.querySelector('#' + id);
    const stickEl = $('stick'), nub = $('nub'), grabEl = $('tGrab'), grabNub = $('grabNub');
    let stickId = null, sc = null;
    const moveStick = (t) => {
      const dx = t.clientX - sc[0], dy = t.clientY - sc[1], m = Math.min(1, Math.hypot(dx, dy) / 54), a = Math.atan2(dy, dx);
      touch.x = Math.cos(a) * m; touch.y = Math.sin(a) * m;
      nub.style.transform = `translate(${Math.cos(a) * m * 42}px,${Math.sin(a) * m * 42}px)`;
    };
    const zone = $('stickZone');
    zone.addEventListener('touchstart', (e) => {
      setDevice('touch');
      for (const t of e.changedTouches) if (stickId === null) {
        stickId = t.identifier;
        // the stick re-centres under the thumb, so there is no need to look down for it
        const r = zone.getBoundingClientRect();
        const cx = clamp(t.clientX, r.left + 64, r.right - 64), cy = clamp(t.clientY, r.top + 64, r.bottom - 64);
        stickEl.style.left = cx - r.left - 60 + 'px'; stickEl.style.top = cy - r.top - 60 + 'px'; stickEl.style.bottom = 'auto';
        sc = [cx, cy]; moveStick(t);
      }
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === stickId) moveStick(t); e.preventDefault(); }, { passive: false });
    const endStick = (e) => { for (const t of e.changedTouches) if (t.identifier === stickId) { stickId = null; touch.x = touch.y = 0; nub.style.transform = ''; } };
    zone.addEventListener('touchend', endStick); zone.addEventListener('touchcancel', endStick);

    const hold = (id, on, off) => {
      const b = $(id);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); setDevice('touch'); try { b.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } on(e); b.classList.add('on'); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { off(); b.classList.remove('on'); });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    hold('tJump', () => (touch.jump = true), () => (touch.jump = false));
    hold('tBoost', () => (touch.boost = true), () => (touch.boost = false));
    let gc = null;
    hold('tGrab', (e) => { touch.grab = true; touch.gx = touch.gy = 0; gc = [e.clientX, e.clientY]; }, () => { touch.grab = false; touch.gx = touch.gy = 0; grabNub.style.transform = ''; });
    grabEl.addEventListener('pointermove', (e) => {
      if (!touch.grab || !gc) return;
      const dx = e.clientX - gc[0], dy = e.clientY - gc[1], m = Math.min(1, Math.hypot(dx, dy) / 34), a = Math.atan2(dy, dx);
      touch.gx = Math.cos(a) * m; touch.gy = -Math.sin(a) * m;
      grabNub.style.transform = `translate(${Math.cos(a) * m * 20}px,${Math.sin(a) * m * 20}px)`;
    });
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // a finger anywhere switches to the touch layout (covers touch-screen laptops too)
  addEventListener('touchstart', () => setDevice('touch'), { passive: true });

  /** Read every device and merge. Call once per frame. */
  function poll() {
    const k = (c) => (keys.has(c) ? 1 : 0);
    let steer = k('KeyD') - k('KeyA'), pitch = k('KeyS') - k('KeyW'), roll = k('KeyE') - k('KeyQ');
    let jump = keys.has('Space'), boost = keys.has('ShiftLeft') || keys.has('ShiftRight'), brake = 0;
    let gx = k('ArrowRight') + k('KeyL') - k('ArrowLeft') - k('KeyJ'), gy = k('ArrowUp') + k('KeyI') - k('ArrowDown') - k('KeyK');
    let grab = grabFromDir(clamp(gx, -1, 1), clamp(gy, -1, 1));

    const p = getPad();
    if (p) {
      const b = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      const [lx, ly] = stick(p.axes[0] || 0, p.axes[1] || 0), [rx, ry] = stick(p.axes[2] || 0, p.axes[3] || 0);
      const dx = b(15) - b(14), dy = b(13) - b(12);
      const active = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.2 || p.buttons.some((x) => x.pressed);
      if (active) setDevice('gamepad');
      steer += curve(lx) + dx; pitch += ly + dy; roll += b(5) - b(4);
      jump = jump || b(0) > 0.5; boost = boost || b(7) > 0.25; brake = Math.max(brake, b(6));
      const g = grabFromDir(rx, -ry) || (b(1) > 0.5 ? 1 : b(2) > 0.5 ? 3 : b(3) > 0.5 ? 7 : 0);
      if (g) grab = g;
      // menu buttons on press
      const edge = (i) => b(i) > 0.5 && !(prevButtons[i] > 0.5);
      if (edge(9)) onAction('pause');
      if (edge(8)) onAction('restart');
      if (edge(0)) onAction('confirm');
      prevButtons = p.buttons.map((x) => x.value || (x.pressed ? 1 : 0));
    }
    steer += curve(touch.x); pitch += touch.y;
    jump = jump || touch.jump; boost = boost || touch.boost;
    if (touch.grab) grab = grabFromDir(touch.gx, touch.gy) || 1;

    state.steer = clamp(steer, -1, 1); state.pitch = clamp(pitch, -1, 1); state.roll = clamp(roll, -1, 1);
    state.jump = jump; state.boost = boost; state.brake = brake; state.grab = grab;
    return state;
  }

  return { state, poll, rumble, get device() { return device; }, get hasPad() { return padIndex >= 0; }, padLabel };
}
