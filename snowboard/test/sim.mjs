// Headless ride-throughs: a bot follows the piste so we can check the course is rideable and tune the feel.
import { buildCourse, centerX, FINISH, KICKERS, halfWidth } from '../src/course.js';
import { Rider, STEP, TUNE } from '../src/physics.js';

const course = await buildCourse();
const fmt = (n, d = 1) => n.toFixed(d);

function run(name, policy, { start = 3, maxT = 120, log = true } = {}) {
  const r = new Rider(course);
  r.reset(start);
  const inp = { steer: 0, pitch: 0, roll: 0, jump: false, boost: false, brake: 0, grab: 0 };
  let t = 0, vmax = 0, airs = [], airStart = null, crashes = 0, rails = [], scores = [], marks = {}, modePrev = 'ground';
  const speedAt = {};
  while (t < maxT) {
    const d = -r.pos.z;
    // follow the centreline
    const look = d + 10 + r.speed * 0.5;
    const tx = centerX(look) + (policy.offset ? policy.offset(d) : 0), ty = Math.atan2(-(tx - r.pos.x), look - d);
    const travel = r.speed > 1 ? Math.atan2(-r.vel.x, -r.vel.z) : r.yaw;
    const boardYaw = r.sw > 0 ? r.yaw : r.yaw + Math.PI;
    let err = Math.atan2(Math.sin(ty - boardYaw), Math.cos(ty - boardYaw));
    inp.steer = r.mode === 'ground' ? Math.max(-1, Math.min(1, -err * 3)) : 0;
    inp.pitch = r.mode === 'ground' ? -1 : 0; inp.boost = false; inp.jump = false; inp.grab = 0; inp.roll = 0; inp.brake = 0;
    policy.act && policy.act(r, inp, d, t);
    r.step(inp, STEP);
    t += STEP;
    vmax = Math.max(vmax, r.speed);
    for (const k of [20, 60, 100, 140, 149, 200, 250, 300, 340, 390, 440, 451, 500, 560, 600]) if (!(k in speedAt) && d >= k) speedAt[k] = r.speed;
    if (r.mode === 'air' && modePrev !== 'air') airStart = { d, t, v: r.speed, vy: r.vel.y, hmax: 0 };
    if (r.mode === 'air' && airStart) airStart.hmax = Math.max(airStart.hmax, r.height);
    if (r.mode !== 'air' && modePrev === 'air' && airStart) { if (t - airStart.t > 0.25) airs.push({ ...airStart, dur: t - airStart.t, len: d - airStart.d, to: r.mode }); airStart = null; }
    modePrev = r.mode;
    for (const e of r.events) {
      if (e.type === 'crash') { crashes++; if (log) console.log(`   crash @d=${fmt(d)} ${e.reason} v=${fmt(r.speed)}`); }
      if (e.type === 'railStart') rails.push({ name: e.name, d });
      if (e.type === 'score') scores.push(e);
      if (e.type === 'land' && log && e.quality !== 'clean' && e.quality !== 'perfect') console.log(`   land ${e.quality} @d=${fmt(d)} impact=${fmt(e.impact)}`);
      if (e.type === 'land' && policy.verbose) console.log(`   land ${e.quality} @d=${fmt(d)} impact=${fmt(e.impact)} air=${fmt(e.air || 0, 2)}`);
    }
    r.events.length = 0;
    if (r.finished && r.speed < 0.5) break;
    if (Number.isNaN(r.pos.x + r.pos.y + r.pos.z)) { console.log('NaN!'); break; }
  }
  if (log) {
    console.log(`\n== ${name}: finished=${r.finished} time=${fmt(r.finishTime, 2)}s total=${fmt(t)}s vmax=${fmt(vmax)} (${fmt(vmax * 3.6, 0)} km/h) crashes=${crashes} score=${r.score} endD=${fmt(-r.pos.z)}`);
    console.log('   speed@d:', Object.entries(speedAt).map(([k, v]) => `${k}:${fmt(v)}`).join(' '));
    for (const a of airs) console.log(`   air d=${fmt(a.d)} v=${fmt(a.v)} dur=${fmt(a.dur, 2)}s len=${fmt(a.len)}m hmax=${fmt(a.hmax)}m -> ${a.to}`);
    for (const s of scores) console.log(`   +${s.points} ${s.names.join(' | ')} [${s.quality}] x${s.mult}`);
    if (rails.length) console.log('   rails:', rails.map((x) => `${x.name}@${fmt(x.d)}`).join(', '));
  }
  return { r, t, vmax, airs, crashes, rails, scores };
}

const which = process.argv[2] || 'all';
const checks = [];
const check = (name, ok) => { checks.push([name, ok]); if (!ok) process.exitCode = 1; };
if (which === 'all' || which === 'cruise') run('cruise (tuck, no tricks)', {});
if (which === 'all' || which === 'coast') {
  const c = run('coast (no tuck after start)', { act: (r, inp, d) => { inp.pitch = d < 14 ? -1 : 0; } });
  check('a rider who only steers reaches the lodge', c.r.finished);
  check('...without crashing', c.crashes === 0);
  check('...in 30 to 55 seconds', c.r.finishTime > 30 && c.r.finishTime < 55);
  check('...and the first kicker gives 1.5 to 2.6 s of air', c.airs.some((a) => a.d > 145 && a.d < 153 && a.dur > 1.5 && a.dur < 2.6));
  check('...and the big kicker gives 1.8 to 3 s of air', c.airs.some((a) => a.d > 448 && a.d < 455 && a.dur > 1.8 && a.dur < 3));
  check('...and rides onto a rail', c.rails.length > 0);
}
if (which === 'all' || which === 'boost') run('boost everywhere', { act: (r, inp) => { inp.boost = true; } });
if (which === 'all' || which === 'tricks') { const t = run('tricks', {
  verbose: true,
  act: (r, inp, d) => {
    if (r.mode === 'ground') inp.jump = (d > 140 && d < 149.6) || (d > 440 && d < 451.6) || (d > 50 && d < 62);
    if (r.mode === 'air') {
      if (d > 440) { inp.pitch = r.airTime < 1.9 ? 1 : 0; inp.grab = r.airTime > 0.3 && r.airTime < 1.6 ? 7 : 0; }
      else if (d > 140) { inp.steer = r.airTime < 1.25 ? -1 : 0; inp.pitch = 0; inp.grab = r.airTime > 0.3 && r.airTime < 1.2 ? 1 : 0; }
      else { inp.steer = r.airTime < 0.6 ? 1 : 0; inp.pitch = 0; }
    }
  },
});
  check('spins, flips and grabs score', t.scores.some((s) => /Backflip/.test(s.names.join())) && t.scores.some((s) => /(FS|BS) \d+/.test(s.names.join())) && t.scores.some((s) => /Indy|Method/.test(s.names.join())));
}
if (which === 'all' || which === 'rails') run('rails', {
  offset: (d) => (d > 300 && d < 348 ? -9 : d >= 348 && d < 378 ? 0 : d > 540 && d < 580 ? 0 : 0),
  act: (r, inp, d) => { if (r.mode === 'rail') { inp.steer = r.railTime > 0.3 && r.railTime < 0.6 ? 1 : 0; } },
});
if (which === 'all' || which === 'stand') {
  // a rider who never touches the controls after dropping in should still get down the hill
  run('hands-off after drop-in', { act: (r, inp, d) => { inp.pitch = d < 14 ? -1 : 0; inp.steer = d < 14 ? inp.steer : 0; } }, { maxT: 150 });
}

if (checks.length) { console.log('\nChecks:'); for (const [n, ok] of checks) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}`); }
