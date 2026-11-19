// Keyboard + mouse (pointer lock, with a drag-to-look fallback where the page cannot capture the mouse),
// touch (left thumb moves, right thumb looks, buttons) and a gamepad, merged into one state object.

export class Input {
  constructor(canvas, touchRoot) {
    this.canvas = canvas;
    this.keys = new Set(); this.pressed = new Set();
    this.moveX = 0; this.moveZ = 0; this.lookX = 0; this.lookY = 0;
    this.fire = false; this.aim = false; this.sprint = false; this.use = false;
    this.locked = false; this.lockFailed = false; this.touch = false; this.mouseDown = [false, false, false];
    this.sens = 1; this.wheel = 0;
    this.onLockChange = null;
    this.t = { stick: null, look: null, sx: 0, sy: 0, mx: 0, mz: 0, fire: false, btn: new Set() };
    this.padPrev = [];

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = [false, false, false]; });
    canvas.addEventListener('mousedown', (e) => { this.mouseDown[e.button] = true; if (e.button === 0) this.pressed.add('Mouse0'); e.preventDefault(); });
    addEventListener('mouseup', (e) => { this.mouseDown[e.button] = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (this.locked || (this.lockFailed && (this.mouseDown[0] || this.mouseDown[2]))) { this.lookX += e.movementX || 0; this.lookY += e.movementY || 0; }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (this.locked) this.everLocked = true; this.onLockChange?.(this.locked); });
    document.addEventListener('pointerlockerror', () => { if (!this.everLocked) this.lockFailed = true; this.onLockChange?.(false); });
    if (touchRoot) this._touch(touchRoot);
  }
  // ask for the mouse; resolves to false where the page is not allowed to capture it
  async capture() {
    if (this.touch) return false;
    try { const p = this.canvas.requestPointerLock?.(); if (p && p.then) await p; if (!this.canvas.requestPointerLock) this.lockFailed = true; }
    catch { if (!this.everLocked) this.lockFailed = true; }
    return !this.lockFailed;
  }
  release() { if (document.pointerLockElement) document.exitPointerLock(); }

  _touch(root) {
    const stickZone = root.querySelector('#stickZone'), lookZone = root.querySelector('#lookZone'), nub = root.querySelector('#nub'), stick = root.querySelector('#stick');
    const t = this.t;
    addEventListener('touchstart', () => { if (!this.touch) { this.touch = true; root.hidden = false; this.onLockChange?.(false); } }, { passive: true, once: true });
    stickZone.addEventListener('pointerdown', (e) => {
      if (t.stick !== null) return; t.stick = e.pointerId; t.sx = e.clientX; t.sy = e.clientY; stickZone.setPointerCapture(e.pointerId);
      const r = stickZone.getBoundingClientRect(); stick.style.left = `${e.clientX - r.left - 60}px`; stick.style.top = `${e.clientY - r.top - 60}px`; stick.style.bottom = 'auto';
    });
    stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== t.stick) return;
      let dx = (e.clientX - t.sx) / 48, dy = (e.clientY - t.sy) / 48; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      t.mx = dx; t.mz = dy; nub.style.transform = `translate(${dx * 36}px, ${dy * 36}px)`;
    });
    const endStick = (e) => { if (e.pointerId !== t.stick) return; t.stick = null; t.mx = t.mz = 0; nub.style.transform = ''; };
    stickZone.addEventListener('pointerup', endStick); stickZone.addEventListener('pointercancel', endStick);
    const look = (el) => {
      el.addEventListener('pointerdown', (e) => { if (t.look !== null) return; t.look = e.pointerId; t.lx = e.clientX; t.ly = e.clientY; el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', (e) => { if (e.pointerId !== t.look) return; this.lookX += (e.clientX - t.lx) * 2.4; this.lookY += (e.clientY - t.ly) * 2.4; t.lx = e.clientX; t.ly = e.clientY; });
      const end = (e) => { if (e.pointerId === t.look) t.look = null; };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    };
    look(lookZone);
    for (const b of root.querySelectorAll('button[data-act]')) {
      const act = b.dataset.act;
      if (act === 'fire') look(b); // the fire button also aims while it is held
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('on'); t.btn.add(act); this.pressed.add('T:' + act); });
      const up = () => { b.classList.remove('on'); t.btn.delete(act); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    }
  }

  // call once per frame before reading
  poll() {
    const k = this.keys, t = this.t;
    let mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + t.mx, mz = (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0) + t.mz;
    // arrow keys turn, for the no-mouse-capture fallback
    this.lookX += ((k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)) * 14; this.lookY += ((k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)) * 9;
    this.fire = (this.mouseDown[0] && (this.locked || this.lockFailed)) || t.btn.has('fire');
    this.aim = this.mouseDown[2] && this.locked;
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || (this.touch && Math.hypot(t.mx, t.mz) > 0.92 && t.mz < -0.6);
    this.use = k.has('KeyE') || k.has('KeyF') || t.btn.has('use');
    const pad = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected && g.mapping === 'standard') : null;
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.16 ? 0 : v), b = (i) => pad.buttons[i]?.pressed, edge = (i, name) => { if (b(i) && !this.padPrev[i]) this.pressed.add(name); };
      mx += dz(pad.axes[0]); mz += dz(pad.axes[1]);
      this.lookX += dz(pad.axes[2]) * Math.abs(pad.axes[2]) * 26; this.lookY += dz(pad.axes[3]) * Math.abs(pad.axes[3]) * 18;
      if (pad.buttons[7]?.value > 0.3) { if (!this.padPrev[7]) this.pressed.add('Mouse0'); this.fire = true; }
      this.aim = this.aim || pad.buttons[6]?.value > 0.3; this.sprint = this.sprint || b(10); this.pad = true;
      edge(0, 'Space'); edge(2, 'PadX'); edge(3, 'KeyQ'); edge(4, 'KeyV'); edge(5, 'KeyG'); edge(11, 'KeyV'); edge(9, 'Escape');
      for (let i = 0; i < 12; i++) this.padPrev[i] = i === 7 ? pad.buttons[7]?.value > 0.3 : b(i);
    }
    const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    this.moveX = mx; this.moveZ = mz;
  }
  hit(...codes) { for (const c of codes) if (this.pressed.has(c)) return true; return false; }
  endFrame() { this.pressed.clear(); this.lookX = 0; this.lookY = 0; this.wheel = 0; }
}
