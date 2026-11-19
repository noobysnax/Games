// DOM heads-up display. The game calls these; nothing here knows about three.js.

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = { hud: $('hud'), round: $('round'), points: $('points'), ammo: $('ammo'), reserve: $('reserve'), wname: $('wname'), wcls: $('wcls'), hp: $('hpFill'), hpNum: $('hpNum'), nades: $('nades'),
      prompt: $('prompt'), hint: $('hint'), banner: $('banner'), pops: $('pops'), cross: $('cross'), hit: $('hitmark'), hurt: $('hurt'), powers: $('powers'), toast: $('toast'), scope: $('scope'), left: $('left'), other: $('other') };
    this.cache = {}; this.bannerT = 0; this.toastT = 0; this.hitT = 0; this.powerEls = {};
  }
  show(on) { this.el.hud.hidden = !on; }
  txt(key, v) { if (this.cache[key] !== v) { this.cache[key] = v; this.el[key].textContent = v; } }
  stats(s) {
    this.txt('round', String(s.round).padStart(2, '0')); this.txt('points', s.points.toLocaleString('en-US'));
    this.txt('ammo', s.ammo); this.txt('reserve', s.reserve); this.txt('wname', s.wname); this.txt('wcls', s.wcls); this.txt('other', s.other);
    this.txt('hpNum', String(Math.ceil(s.hp))); this.txt('left', s.left);
    const k = Math.max(0, s.hp / s.maxHp); this.el.hp.style.transform = `scaleX(${k.toFixed(3)})`;
    this.el.hp.classList.toggle('low', k < 0.35); this.el.hp.classList.toggle('plated', s.maxHp > 100);
    if (this.cache.n !== s.nades) { this.cache.n = s.nades; this.el.nades.innerHTML = '<i></i>'.repeat(s.nades) + '<i class="off"></i>'.repeat(Math.max(0, 4 - s.nades)); }
    this.el.ammo.classList.toggle('low', s.lowAmmo);
    const hurt = Math.max(0, 1 - k * 1.25) * 0.75 + s.hurtFlash;
    this.el.hurt.style.opacity = Math.min(1, hurt).toFixed(2);
    this.el.cross.style.setProperty('--gap', `${s.gap.toFixed(1)}px`); this.el.cross.hidden = s.scoped;
    this.el.scope.hidden = !s.scoped;
  }
  prompt(t) { if (this.cache.prompt === t) return; this.cache.prompt = t; this.el.prompt.hidden = !t; if (t) this.el.prompt.innerHTML = t; }
  hint(t) { if (this.cache.hint === t) return; this.cache.hint = t; this.el.hint.textContent = t || ''; this.el.hint.hidden = !t; }
  banner(title, sub = '', secs = 3.2) { this.el.banner.innerHTML = `<b>${title}</b><span>${sub}</span>`; this.el.banner.classList.add('show'); this.bannerT = secs; }
  toast(t, secs = 2.4) { this.el.toast.textContent = t; this.el.toast.classList.add('show'); this.toastT = secs; }
  pop(n, kind = '') {
    const e = document.createElement('div'); e.className = `pop ${kind}`; e.textContent = (n > 0 ? '+' : '') + n;
    e.style.setProperty('--dx', `${(Math.random() * 40 - 60).toFixed(0)}px`); e.style.setProperty('--dy', `${(-20 - Math.random() * 46).toFixed(0)}px`);
    this.el.pops.appendChild(e); setTimeout(() => e.remove(), 900);
    while (this.el.pops.children.length > 10) this.el.pops.firstChild.remove();
  }
  hitmark(kind) { const h = this.el.hit; h.className = `show ${kind}`; this.hitT = kind === 'kill' ? 0.22 : 0.12; }
  power(kind, label, t) {
    let e = this.powerEls[kind];
    if (t <= 0) { if (e) { e.remove(); delete this.powerEls[kind]; } return; }
    if (!e) { e = this.powerEls[kind] = document.createElement('div'); e.className = `power ${kind}`; e.innerHTML = `<b>${label}</b><span></span>`; this.el.powers.appendChild(e); }
    const s = String(Math.ceil(t)); if (e.dataset.s !== s) { e.dataset.s = s; e.lastChild.textContent = `${s}s`; }
  }
  update(dt) {
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.el.banner.classList.remove('show');
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) this.el.toast.classList.remove('show');
    if (this.hitT > 0 && (this.hitT -= dt) <= 0) this.el.hit.className = '';
  }
  reset() { for (const k in this.powerEls) this.powerEls[k].remove(); this.powerEls = {}; this.el.pops.innerHTML = ''; this.el.banner.classList.remove('show'); this.cache = {}; this.prompt(null); }
}
