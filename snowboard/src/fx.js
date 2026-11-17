// Snow spray, rail sparks, drifting snowfall, chimney smoke, and the board's track in the snow.

import * as THREE from 'three';
import { clamp } from './util.js';

export function createFx(gfx, smokeOrigins) {
  const { scene, commonU, tod } = gfx;
  const pointScale = { value: 500 };

  /* CPU particle pool drawn as square, pixel-sized points (keeps the voxel look) */
  function pool(n, additive) {
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), dat = new Float32Array(n * 2), life = new Float32Array(n), max = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aDat', new THREE.BufferAttribute(dat, 2).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: pointScale, uCol: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: `attribute vec2 aDat; uniform float uScale; varying float vA;
        void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(aDat.x*uScale/-mv.z,1.0,26.0);vA=aDat.y;}`,
      fragmentShader: `uniform vec3 uCol; varying float vA; void main(){if(vA<0.01)discard;gl_FragColor=vec4(uCol*${additive ? 'vA' : '1.0'},vA);}`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.layers.set(1); scene.add(pts);
    let head = 0;
    return {
      mat,
      emit(x, y, z, vx, vy, vz, size, ttl) {
        const i = head; head = (head + 1) % n;
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
        dat[i * 2] = size; life[i] = ttl; max[i] = ttl;
      },
      update(dt, grav, dragK, alpha) {
        for (let i = 0; i < n; i++) {
          if (life[i] <= 0) { dat[i * 2 + 1] = 0; continue; }
          life[i] -= dt;
          const k = 1 - dragK * dt;
          vel[i * 3] *= k; vel[i * 3 + 1] = vel[i * 3 + 1] * k - grav * dt; vel[i * 3 + 2] *= k;
          pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
          const t = clamp(life[i] / max[i], 0, 1);
          dat[i * 2 + 1] = alpha * Math.min(1, t * 2.2);
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.aDat.needsUpdate = true;
      },
    };
  }
  const snow = pool(700, false), sparks = pool(160, true);
  sparks.mat.uniforms.uCol.value.setRGB(3.2, 1.3, 0.3);

  /* snowfall: a wrapped box of flakes around the camera */
  const flakes = (() => {
    const n = 1400, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = Math.random() * 60; pos[i * 3 + 1] = Math.random() * 40; pos[i * 3 + 2] = Math.random() * 60; seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: commonU.uTime, uScale: pointScale, uCam: { value: new THREE.Vector3() }, uCol: { value: new THREE.Color(1, 1, 1) }, uAmt: { value: 1 } },
      vertexShader: `attribute float aSeed; uniform float uTime; uniform float uScale; uniform vec3 uCam; varying float vA;
        void main(){vec3 p=position+vec3(sin(uTime*0.6+aSeed*40.0)*0.8+uTime*1.3,-uTime*(1.6+aSeed*1.4),cos(uTime*0.5+aSeed*29.0)*0.8);
          p=mod(p-uCam+vec3(30.0,20.0,30.0),vec3(60.0,40.0,60.0))-vec3(30.0,20.0,30.0)+uCam; float dc=length(p-uCam);
          vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((0.035+aSeed*0.03)*uScale/-mv.z,1.0,6.0);
          vA=(1.0-smoothstep(18.0,30.0,dc))*smoothstep(1.0,3.0,dc)*(0.35+0.5*aSeed);}`,
      fragmentShader: `uniform vec3 uCol; uniform float uAmt; varying float vA; void main(){float a=vA*uAmt;if(a<0.01)discard;gl_FragColor=vec4(uCol,a);}`,
      transparent: true, depthWrite: false,
    });
    const p = new THREE.Points(g, m); p.frustumCulled = false; p.layers.set(1); scene.add(p);
    return m;
  })();

  /* chimney smoke */
  let smoke = null;
  if (smokeOrigins.length) {
    const per = 40, n = smokeOrigins.length * per, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos.set(smokeOrigins[(i / per) | 0], i * 3); seed[i] = (i % per) / per + Math.random() * 0.02; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    smoke = new THREE.ShaderMaterial({
      uniforms: { uTime: commonU.uTime, uScale: pointScale, uCol: { value: new THREE.Color() } },
      vertexShader: `attribute float aSeed; uniform float uTime; uniform float uScale; varying float vA;
        void main(){float life=fract(uTime*0.06+aSeed);vec3 p=position;p.y+=life*15.0;
          p.x+=sin(aSeed*40.0+uTime*0.5)*life*1.4+life*life*7.0;p.z+=cos(aSeed*23.0+uTime*0.4)*life*1.2+life*life*2.5;
          vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=min((0.6+life*3.8)*uScale/-mv.z,200.0);
          vA=smoothstep(0.0,0.1,life)*(1.0-life)*0.4;}`,
      fragmentShader: `uniform vec3 uCol; varying float vA; void main(){vec2 c=gl_PointCoord-0.5;float a=smoothstep(0.5,0.05,length(c))*vA;if(a<0.004)discard;gl_FragColor=vec4(uCol,a);}`,
      transparent: true, depthWrite: false,
    });
    const p = new THREE.Points(g, smoke); p.frustumCulled = false; scene.add(p);
  }

  gfx.extras.onTOD.push((t) => {
    const P = t.P, amb = 0.35 + P.li * 0.24;
    snow.mat.uniforms.uCol.value.copy(P.light).lerp(new THREE.Color(0.8, 0.88, 1), 0.55).multiplyScalar(amb * 1.15);
    flakes.uniforms.uCol.value.copy(P.light).lerp(new THREE.Color(0.85, 0.9, 1), 0.5).multiplyScalar(amb);
    if (smoke) smoke.uniforms.uCol.value.copy(P.cs).lerp(P.light, 0.35).multiplyScalar(0.45 + P.li * 0.18);
  });

  /* board track: a 32 m window of snow around the rider, redrawn from the recent path each frame */
  const TS = 256, WIN = 32, PX = TS / WIN;
  const cv = document.createElement('canvas'); cv.width = cv.height = TS;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.NoColorSpace;
  commonU.uTrail.value = tex; commonU.uTrailSize.value = WIN;
  const TN = 420, trail = new Float32Array(TN * 4);  // x, z, width, break
  let th = 0, tcount = 0, lastX = 1e9, lastZ = 1e9, pen = false;
  function track(x, z, width, down) {
    if (!down) { pen = false; return; }
    if (pen && Math.hypot(x - lastX, z - lastZ) < 0.25) return;
    const i = th * 4; trail[i] = x; trail[i + 1] = z; trail[i + 2] = width; trail[i + 3] = pen ? 0 : 1;
    th = (th + 1) % TN; tcount = Math.min(TN, tcount + 1); lastX = x; lastZ = z; pen = true;
  }
  function drawTrail(cx, cz) {
    const ox = Math.round((cx - WIN / 2) * PX) / PX, oz = Math.round((cz - WIN / 2) * PX) / PX;
    commonU.uTrailOrigin.value.set(ox, oz);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, TS, TS);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#fff';
    let open = false, w = 0;
    for (let k = 0; k < tcount; k++) {
      const i = ((th - tcount + k + TN) % TN) * 4, px = (trail[i] - ox) * PX, py = (trail[i + 1] - oz) * PX;
      if (trail[i + 3] || !open || Math.abs(trail[i + 2] - w) > 0.15) {
        if (open) ctx.stroke();
        ctx.beginPath(); w = trail[i + 2]; ctx.lineWidth = Math.max(2, w * PX);
        if (trail[i + 3] || !open) ctx.moveTo(px, py); else { const j = ((th - tcount + k - 1 + TN) % TN) * 4; ctx.moveTo((trail[j] - ox) * PX, (trail[j + 1] - oz) * PX); ctx.lineTo(px, py); }
        open = true;
      } else ctx.lineTo(px, py);
    }
    if (open) ctx.stroke();
    tex.needsUpdate = true;
  }
  function clearTrail() { tcount = 0; th = 0; pen = false; }

  const _r = { x: 0, z: 0 };
  /** Throw snow from the board. dir = unit travel direction, side = which way the spray goes (±1), amt 0..1 */
  function spray(p, vel, sideX, sideZ, amt, speed) {
    const n = Math.min(14, Math.floor(amt * 9 + Math.random()));
    for (let i = 0; i < n; i++) {
      const a = 0.35 + Math.random() * 0.9, up = 1.2 + Math.random() * (2 + speed * 0.12);
      snow.emit(p.x + (Math.random() - 0.5) * 0.7, p.y + 0.05, p.z + (Math.random() - 0.5) * 0.7,
        vel.x * 0.35 + sideX * a * (2 + speed * 0.16) + (Math.random() - 0.5) * 1.5, up, vel.z * 0.35 + sideZ * a * (2 + speed * 0.16) + (Math.random() - 0.5) * 1.5,
        0.07 + Math.random() * 0.1, 0.45 + Math.random() * 0.5);
    }
  }
  function burst(p, vel, power) {
    const n = Math.floor(18 + power * 46);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (1.5 + Math.random() * 4.5) * (0.5 + power);
      snow.emit(p.x, p.y + 0.1, p.z, vel.x * 0.3 + Math.cos(a) * s, 1 + Math.random() * 3.5 * (0.5 + power), vel.z * 0.3 + Math.sin(a) * s, 0.08 + Math.random() * 0.14, 0.5 + Math.random() * 0.7);
    }
  }
  function spark(p, vel) {
    for (let i = 0; i < 2; i++) sparks.emit(p.x, p.y + 0.02, p.z, -vel.x * 0.12 + (Math.random() - 0.5) * 3, 0.6 + Math.random() * 2.2, -vel.z * 0.12 + (Math.random() - 0.5) * 3, 0.025 + Math.random() * 0.025, 0.25 + Math.random() * 0.3);
  }

  function update(dt, camera, renderer, riderPos) {
    pointScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    snow.update(dt, 9, 1.6, 0.9); sparks.update(dt, 7, 0.8, 1);
    flakes.uniforms.uCam.value.copy(camera.position);
    flakes.uniforms.uAmt.value = 0.55 + tod.P.night * 0.3;
    drawTrail(riderPos.x, riderPos.z);
  }
  void _r;
  const debugTrail = () => { const d = ctx.getImageData(0, 0, TS, TS).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 128) n++; return { tcount, lit: n, origin: commonU.uTrailOrigin.value.toArray() }; };
  return { update, spray, burst, spark, track, clearTrail, debugTrail };
}
