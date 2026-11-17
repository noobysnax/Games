// Procedural sound: wind tied to speed, edge hiss when carving, rail ring, thumps and chimes. No samples.

export function createAudio() {
  let ctx = null, master, wind, windF, carve, carveF, rail, railF, on = true;
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = on ? 0.7 : 0; master.connect(ctx.destination);
      const len = ctx.sampleRate * 3, brown = ctx.createBuffer(1, len, ctx.sampleRate), white = ctx.createBuffer(1, len, ctx.sampleRate);
      const b = brown.getChannelData(0), w = white.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const x = Math.random() * 2 - 1; w[i] = x; last = (last + 0.02 * x) / 1.02; b[i] = last * 3.5; }
      const loop = (buf, type, f, q) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(flt).connect(g).connect(master); src.start();
        return [g, flt];
      };
      [wind, windF] = loop(brown, 'lowpass', 380, 0.5);
      [carve, carveF] = loop(white, 'bandpass', 2400, 0.8);
      [rail, railF] = loop(white, 'bandpass', 3300, 9);
    } catch (_) { ctx = null; }
  }
  function setOn(v) { on = v; if (master) master.gain.setTargetAtTime(v ? 0.7 : 0, ctx.currentTime, 0.15); }
  function tone(f0, f1, dur, vol, type = 'sine', delay = 0) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function noise(dur, vol, freq, q = 0.7) {
    if (!ctx) return;
    const t0 = ctx.currentTime, n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = vol;
    s.connect(f).connect(g).connect(master); s.start(t0);
  }
  const sfx = {
    jump: (p) => { noise(0.12, 0.25, 1800); tone(180, 320 + p * 120, 0.12, 0.12, 'triangle'); },
    land: (impact) => { const k = Math.min(1, impact / 14); tone(120, 42, 0.22, 0.25 + k * 0.4); noise(0.25, 0.2 + k * 0.35, 900, 0.5); },
    crash: () => { tone(160, 38, 0.4, 0.6); noise(0.5, 0.6, 500, 0.4); },
    railOn: () => { tone(1900, 1500, 0.25, 0.1, 'square'); noise(0.08, 0.3, 4000, 2); },
    boost: () => { noise(0.5, 0.3, 700, 0.6); tone(220, 660, 0.4, 0.1, 'sawtooth'); },
    bump: () => { tone(140, 60, 0.12, 0.3); },
    score: (q) => { const base = q === 'perfect' ? 880 : 660; tone(base, base, 0.14, 0.12, 'triangle'); tone(base * 1.5, base * 1.5, 0.2, 0.12, 'triangle', 0.09); if (q === 'perfect') tone(base * 2, base * 2, 0.3, 0.1, 'triangle', 0.18); },
    finish: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.3, 0.14, 'triangle', i * 0.12)); },
  };
  /** Continuous layers, called a few times a second. */
  function update(r, active) {
    if (!ctx || !wind) return;
    const t = ctx.currentTime, s = active ? r.speed : 0, grounded = r.mode === 'ground';
    wind.gain.setTargetAtTime(0.025 + s * 0.006 + (r.mode === 'air' ? 0.03 : 0), t, 0.2);
    windF.frequency.setTargetAtTime(240 + s * 26, t, 0.2);
    const edge = active && grounded ? Math.min(1, 0.12 * Math.min(1, s / 8) + r.carve * 0.55 + r.skid * 0.9) : 0;
    carve.gain.setTargetAtTime(edge * 0.11, t, 0.06);
    carveF.frequency.setTargetAtTime(1500 + r.skid * 1200 + s * 40, t, 0.1);
    rail.gain.setTargetAtTime(active && r.mode === 'rail' ? 0.16 : 0, t, 0.03);
    railF.frequency.setTargetAtTime(2600 + s * 60, t, 0.1);
  }
  return { init, setOn, sfx, update, get on() { return on; } };
}
