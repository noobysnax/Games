// All sound is synthesised: filtered noise for shots, blasts and rubble, a few oscillators for the rest.

export class Audio {
  constructor() { this.ctx = null; this.on = true; this.vol = 0.8; }
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.on ? this.vol : 0;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 2, buf = this.noiseBuf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // wind bed
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 0.4;
    const g = c.createGain(); g.gain.value = 0.035; src.connect(f); f.connect(g); g.connect(this.master); src.start();
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 160; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
  }
  setOn(on) { this.on = on; if (this.master) this.master.gain.value = on ? this.vol : 0; }
  far(d, max = 45) { return Math.max(0, 1 - d / max) ** 1.6; }

  noise(dur, vol, type, f0, f1, q = 0.8, delay = 0) {
    const c = this.ctx; if (!c || vol <= 0.002) return;
    const t = c.currentTime + delay, s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  tone(type, f0, f1, dur, vol, delay = 0) {
    const c = this.ctx; if (!c || vol <= 0.002) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  shot(kind, k = 1) {
    const S = { pistol: [0.14, 0.5, 2600, 500, 190], smg: [0.1, 0.4, 3200, 700, 230], rifle: [0.17, 0.55, 2200, 380, 150], lmg: [0.19, 0.6, 1800, 300, 120],
      shotgun: [0.34, 0.85, 1500, 160, 80], sniper: [0.5, 0.95, 1900, 140, 70], thump: [0.22, 0.5, 500, 90, 110], rocket: [0.55, 0.7, 900, 120, 60] }[kind];
    if (!S) return;
    this.noise(S[0], S[1] * k, 'lowpass', S[2] * (0.5 + k * 0.5), S[3], 0.7); this.tone('triangle', S[4], S[4] * 0.35, S[0] * 0.8, S[1] * 0.7 * k);
    if (kind === 'sniper' || kind === 'shotgun') this.noise(0.8, 0.12 * k, 'bandpass', 900, 300, 0.5, 0.05);
  }
  arc(on) {
    const c = this.ctx; if (!c) return;
    if (on && !this.arcN) {
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = 86; o2.type = 'square'; o2.frequency.value = 1290;
      const g2 = c.createGain(); g2.gain.value = 0.04; g.gain.value = 0.14; o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.master); o.start(); o2.start(); this.arcN = { o, o2, g };
    } else if (!on && this.arcN) { const a = this.arcN; this.arcN = null; a.g.gain.setTargetAtTime(0, c.currentTime, 0.03); a.o.stop(c.currentTime + 0.2); a.o2.stop(c.currentTime + 0.2); }
  }
  explosion(d, size = 1) {
    const v = this.far(d, 70) * (0.5 + size * 0.5);
    this.noise(1.3, v, 'lowpass', 1400, 60, 0.5); this.tone('sine', 90, 28, 0.9, v); this.noise(0.25, v * 0.8, 'highpass', 800, 3000, 0.4);
    this.noise(1.8, v * 0.25, 'bandpass', 500, 200, 0.6, 0.15);
  }
  rumble(size, d) { const v = this.far(d) * (0.25 + size * 0.5); this.noise(0.9 + size, v, 'lowpass', 420, 70, 0.6); this.noise(0.5, v * 0.4, 'bandpass', 1800, 600, 1.2, 0.1); }
  thud(size, d, impact) { const v = this.far(d) * Math.min(1, 0.2 + size * 0.7) * Math.min(1, impact / 8 + 0.3); this.tone('sine', 70 + 40 * (1 - size), 30, 0.3, v); this.noise(0.35, v * 0.8, 'lowpass', 900, 120, 0.7); }
  impact(d, hard) { const v = this.far(d, 30) * 0.22; if (hard) this.tone('square', 2400 + Math.random() * 1600, 900, 0.07, v * 0.5); else this.noise(0.09, v, 'bandpass', 1400 + Math.random() * 900, 500, 1.5); }
  flesh() { this.noise(0.07, 0.2, 'lowpass', 700, 200, 1); }
  hitmark(head) { this.tone('square', head ? 1700 : 1150, head ? 1900 : 1000, 0.045, 0.06); }
  kill() { this.noise(0.22, 0.2, 'lowpass', 600, 90, 1); this.tone('sine', 150, 50, 0.2, 0.12); }
  reload(step) { this.noise(0.05, 0.16, 'bandpass', step ? 2600 : 1700, 1200, 3); this.tone('square', step ? 320 : 210, 120, 0.04, 0.05); }
  dry() { this.tone('square', 900, 700, 0.03, 0.06); }
  swap() { this.noise(0.09, 0.1, 'bandpass', 1200, 500, 1.4); }
  buy() { this.tone('triangle', 880, 880, 0.09, 0.14); this.tone('triangle', 1320, 1320, 0.16, 0.14, 0.09); this.noise(0.08, 0.08, 'highpass', 5000, 7000, 1, 0.09); }
  deny() { this.tone('sawtooth', 150, 110, 0.18, 0.1); }
  hurt() { this.noise(0.18, 0.4, 'lowpass', 500, 120, 1); this.tone('sawtooth', 180, 70, 0.22, 0.14); }
  knife() { this.noise(0.12, 0.2, 'highpass', 2500, 6000, 0.8); }
  groan(d, pitch = 1) {
    const c = this.ctx, v = this.far(d, 26) * 0.2; if (!c || v < 0.004) return;
    const t = c.currentTime, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(), dur = 0.6 + Math.random() * 0.7;
    o.type = 'sawtooth'; o.frequency.setValueAtTime((70 + Math.random() * 30) * pitch, t); o.frequency.linearRampToValueAtTime((48 + Math.random() * 20) * pitch, t + dur);
    f.type = 'bandpass'; f.Q.value = 4; f.frequency.setValueAtTime(500 + Math.random() * 300, t); f.frequency.linearRampToValueAtTime(260, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  round(start) {
    const n = start ? [110, 164.8, 207.6] : [220, 277.2, 329.6, 440];
    n.forEach((f, i) => { this.tone('sawtooth', f, f * (start ? 0.97 : 1.0), start ? 2.2 : 0.9, 0.05, start ? 0 : i * 0.12); this.tone('sine', f / 2, f / 2, start ? 2.4 : 1, 0.07, start ? 0 : i * 0.12); });
    if (start) this.noise(2.2, 0.08, 'lowpass', 200, 60, 0.5);
  }
  crateTick(i) { const s = [523, 659, 784, 988, 784, 659]; this.tone('triangle', s[i % 6], s[i % 6], 0.11, 0.09); }
  crateDone() { [784, 988, 1175, 1568].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.11, i * 0.07)); }
  power() { [392, 523, 659, 784].forEach((f, i) => this.tone('square', f, f, 0.16, 0.06, i * 0.06)); }
  upgrade() { this.tone('sawtooth', 110, 880, 1.1, 0.1); this.noise(1.1, 0.12, 'bandpass', 400, 4000, 2); [880, 1320, 1760].forEach((f, i) => this.tone('triangle', f, f, 0.3, 0.1, 1.1 + i * 0.08)); }
  roar(d) {
    const c = this.ctx, v = this.far(d, 60) * 0.5; if (!c || v < 0.004) return;
    const t = c.currentTime, o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(42, t + 1.8); o2.frequency.setValueAtTime(53, t); o2.frequency.linearRampToValueAtTime(36, t + 1.8);
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(300, t + 1.8);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0008, t + 2.0);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master); o.start(t); o2.start(t); o.stop(t + 2.1); o2.stop(t + 2.1);
    this.noise(1.6, v * 0.5, 'bandpass', 600, 200, 0.8);
  }
  matter(mode) {
    const c = this.ctx; if (!c) return;
    if (mode && !this.mat) {
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o2.type = 'sine';
      o.frequency.value = mode === 2 ? 70 : 140; o2.frequency.value = mode === 2 ? 211 : 420; g.gain.value = 0.0001; g.gain.setTargetAtTime(0.1, c.currentTime, 0.05);
      o.connect(g); o2.connect(g); g.connect(this.master); o.start(); o2.start(); this.mat = { o, o2, g, mode };
    } else if (this.mat && (!mode || mode !== this.mat.mode)) {
      const m = this.mat; this.mat = null; m.g.gain.setTargetAtTime(0, c.currentTime, 0.04); m.o.stop(c.currentTime + 0.25); m.o2.stop(c.currentTime + 0.25);
      if (mode) this.matter(mode);
    }
  }
  whoosh(speed) { this.noise(0.25, Math.min(0.3, speed / 60), 'bandpass', 300 + speed * 40, 200, 1.2); }
  zone() { [196, 294, 392].forEach((f, i) => this.tone('triangle', f, f, 0.5, 0.1, i * 0.1)); }
}
