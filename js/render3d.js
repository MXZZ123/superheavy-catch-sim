/* 3D renderer (three.js): Starbase scene, booster (booster3d.js), plumes (plume3d.js), steam/dust, re-entry plasma,
   catch tower with closing chopsticks / carriage / QD arm / launch mount, sky + sea + ground with time of day, bloom +
   ACES tone mapping, cameras (orbit, follow, chase, onboard, tower, ground, from below, fin close-up) with touch, HUD
   overlay (shared with the 2D renderer).  Same interface as SH.Renderer: setRun / resize / draw(t, dt, snap) / S /
   mode / transparent.  World frame = sim frame: x downrange (east, toward the sea), y up, z crossrange.            */
(function (SH) {
  "use strict";
  const T = window.THREE;
  const D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  SH.webglOK = (function () { try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl"))); } catch (e) { return false; } })();
  const QUALITY = {
    low: { dpr: 1.0, aa: false, bloom: false, shadows: false, particles: 160, towerDetail: 0 },
    medium: { dpr: 1.5, aa: true, bloom: true, shadows: false, particles: 420, towerDetail: 1 },
    high: { dpr: 2.0, aa: true, bloom: true, shadows: true, particles: 900, towerDetail: 1 },
  };
  SH.autoQuality = () => (window.matchMedia && (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 820px)").matches)) ? "low" : "medium";
  const TOD = { day: { elev: 50, az: 120, tod: 1.0 }, morning: { elev: 14, az: 95, tod: 0.65 }, sunset: { elev: 3, az: 255, tod: 0.3 }, night: { elev: -12, az: 300, tod: 0.0 } };

  // ---------------------------------------------------------------- tower, chopsticks, OLM
  function lattice(H, w, sec, detail, merge) {
    const gs = [], leg = 1.1, br = 0.35;
    const box = (sx, sy, sz, x, y, z) => { const g = new T.BoxGeometry(sx, sy, sz); g.translate(x, y, z); return g; };
    const bar = (a, b, r) => { const va = new T.Vector3(...a), vb = new T.Vector3(...b), d = vb.clone().sub(va), L = d.length(); const g = new T.BoxGeometry(r, L, r); g.translate(0, L / 2, 0); g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize())); g.translate(va.x, va.y, va.z); return g; };
    const h = w / 2;
    for (const [x, z] of [[-h, -h], [h, -h], [h, h], [-h, h]]) gs.push(box(leg, H, leg, x, H / 2, z));
    for (let y = 0; y < H; y += sec) {
      const y1 = Math.min(y + sec, H);
      const C = [[-h, -h], [h, -h], [h, h], [-h, h]];
      for (let k = 0; k < 4; k++) {
        const [ax, az] = C[k], [bx, bz] = C[(k + 1) % 4];
        gs.push(bar([ax, y1, az], [bx, y1, bz], br * 1.4));
        if (detail) { gs.push(bar([ax, y, az], [bx, y1, bz], br)); gs.push(bar([bx, y, bz], [ax, y1, az], br)); }
        else gs.push(bar([ax, y, az], [bx, y1, bz], br));
      }
    }
    return merge(gs);
  }
  function truss(Lx, Hy, Wz, n, merge) {    // box truss along +X (chopstick arm)
    const gs = [], r = 0.3, bar = (a, b) => { const va = new T.Vector3(...a), vb = new T.Vector3(...b), d = vb.clone().sub(va), L = d.length(); const g = new T.BoxGeometry(r, L, r); g.translate(0, L / 2, 0); g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize())); g.translate(va.x, va.y, va.z); return g; };
    for (const y of [0, Hy]) for (const z of [-Wz / 2, Wz / 2]) gs.push(bar([0, y, z], [Lx, y, z]));
    for (let i = 0; i <= n; i++) { const x = i / n * Lx; gs.push(bar([x, 0, -Wz / 2], [x, Hy, -Wz / 2]), bar([x, 0, Wz / 2], [x, Hy, Wz / 2]), bar([x, Hy, -Wz / 2], [x, Hy, Wz / 2]), bar([x, 0, -Wz / 2], [x, 0, Wz / 2])); if (i < n) { const x2 = (i + 1) / n * Lx; gs.push(bar([x, 0, -Wz / 2], [x2, Hy, -Wz / 2]), bar([x, 0, Wz / 2], [x2, Hy, Wz / 2])); } }
    const rail = new T.BoxGeometry(Lx * 0.55, 0.5, 1.0); rail.translate(Lx * 0.7, Hy + 0.25, 0); gs.push(rail);   // catch rail on top
    return merge(gs);
  }

  class Renderer3D {
    constructor(wrap, quality) {
      this.wrap = wrap; this.mode = "follow"; this.transparent = false; this.run = null; this.ref = null; this.tod = "day";
      this.quality = quality || SH.autoQuality(); this.Q = QUALITY[this.quality];
      const cv = this.cv = document.createElement("canvas"); cv.id = "view3d"; wrap.insertBefore(cv, wrap.firstChild);
      const hud = this.hudCv = document.createElement("canvas"); hud.id = "hud3d"; wrap.insertBefore(hud, cv.nextSibling);
      this.ok = false;
      try {
        this.r = new T.WebGLRenderer({ canvas: cv, antialias: this.Q.aa, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
        this.ok = true;
      } catch (e) { console.warn("WebGL unavailable", e); return; }
      const r = this.r; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.0; r.outputColorSpace = T.SRGBColorSpace; r.localClippingEnabled = true;
      r.shadowMap.enabled = this.Q.shadows; r.shadowMap.type = T.PCFSoftShadowMap;
      this.scene = new T.Scene();
      this.cam = new T.PerspectiveCamera(45, 1, 0.5, 4e6);
      this.controls = new T.OrbitControls(this.cam, cv); this.controls.enabled = false; this.controls.enableDamping = true; this.controls.minDistance = 8; this.controls.maxDistance = 30000;
      this.controls.addEventListener("start", () => { this.userOrbit = true; });
      cv.addEventListener("pointerdown", () => { if (this.mode !== "orbit" && this.mode !== "fins" && this.onRequestOrbit) this.onRequestOrbit(); });
      this.hud = Object.create(SH.Renderer.prototype); this.hud.ctx = hud.getContext("2d"); this.hud.transparent = false;
      this.buildWorld();
      this.resize();
    }
    setQuality(q) { if (q === this.quality) return; this.quality = q; this.Q = QUALITY[q]; this.r.shadowMap.enabled = this.Q.shadows; this.sun.castShadow = this.Q.shadows; this.resize(); this._setupComposer(); if (this.run) this.setRun(this.run, this.ref); }
    setTimeOfDay(k) { this.tod = k; this._applyTod(); }
    _applyTod() {
      const o = TOD[this.tod] || TOD.day, el = o.elev * D2R, az = o.az * D2R;
      const dir = new T.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
      this.sunDir = dir; this.sun.position.copy(dir).multiplyScalar(500);
      const warm = 1 - clamp(o.elev / 25, 0, 1);
      this.sun.color.setRGB(1, 0.92 - 0.35 * warm, 0.82 - 0.5 * warm); this.sun.intensity = o.elev > 0 ? 2.4 : 0.15;
      this.hemi.intensity = 0.25 + 0.5 * o.tod;
      this.skyMat.uniforms.sunDir.value.copy(dir); this.skyMat.uniforms.tod.value = o.tod;
      if (this.envTex) this.envTex.dispose();
      this.envTex = SH.makeEnvMap(this.r, { sunDir: dir, tod: o.tod }); this.scene.environment = this.envTex;
      this.r.toneMappingExposure = o.elev > 0 ? 1.0 : 1.6;
      this.stars.material.opacity = o.tod < 0.2 ? 0.9 : 0;
    }
    buildWorld() {
      const S = this.scene, merge = SH.merge3;
      // lights
      this.sun = new T.DirectionalLight(0xffffff, 1.7); this.sun.castShadow = this.Q.shadows; this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera; sc.left = sc.bottom = -60; sc.right = sc.top = 60; sc.near = 10; sc.far = 1200; this.sun.shadow.bias = -0.0005;
      S.add(this.sun, this.sun.target);
      this.hemi = new T.HemisphereLight(0xcfe0ff, 0x6a5c48, 0.6); S.add(this.hemi);
      // sky dome (follows the camera; fades to black space with altitude) + stars
      this.skyMat = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false, uniforms: { sunDir: { value: new T.Vector3(0, 1, 0) }, tod: { value: 1 }, space: { value: 0 } },
        vertexShader: "#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 v; void main(){ v=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);\n#include <logdepthbuf_vertex>\n}",
        fragmentShader: `#include <common>
          #include <logdepthbuf_pars_fragment>
          varying vec3 v; uniform vec3 sunDir; uniform float tod; uniform float space;
          void main(){
            #include <logdepthbuf_fragment>
            vec3 d=normalize(v); float h=d.y;
            vec3 zen=mix(vec3(0.02,0.03,0.08), vec3(0.18,0.38,0.75), tod);
            vec3 hor=mix(vec3(0.9,0.45,0.3), vec3(0.78,0.84,0.92), smoothstep(0.15,0.6,tod)); hor = mix(vec3(0.05,0.06,0.1), hor, smoothstep(0.0,0.2,tod));
            float hh = h + 0.04*space;
            vec3 c=mix(hor, zen, pow(clamp(hh,0.0,1.0),0.5));
            c = h < 0.0 ? mix(hor*0.85, vec3(0.1,0.12,0.15)*tod, clamp(-h*8.0,0.0,1.0)) : c;
            c = mix(c, vec3(0.0,0.0,0.01), space * smoothstep(-0.12, 0.10, h));   // thin bright limb, black above
            float s=max(dot(d,normalize(sunDir)),0.0); c += vec3(1.0,0.9,0.75)*(pow(s,900.0)*25.0 + pow(s,8.0)*0.25*tod*(1.0-space));
            gl_FragColor=vec4(c,1.0);
          }` });
      this.sky = new T.Mesh(new T.SphereGeometry(1.5e6, 48, 24), this.skyMat); this.sky.frustumCulled = false; this.sky.renderOrder = -10; S.add(this.sky);
      { const n = 1500, p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u); p.set([s * Math.cos(a) * 1.2e6, Math.abs(u) * 1.2e6, s * Math.sin(a) * 1.2e6], i * 3); }
        const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(p, 3));
        this.stars = new T.Points(g, new T.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false })); this.stars.frustumCulled = false; S.add(this.stars); }
      // ground (sand + concrete pad) and sea (east of the coastline x = 650 m)
      const cv = document.createElement("canvas"); cv.width = cv.height = 512; const g = cv.getContext("2d");
      g.fillStyle = "#b9a67f"; g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 9000; i++) { const v = 150 + Math.random() * 60; g.fillStyle = `rgba(${v},${v * 0.9},${v * 0.68},0.35)`; g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 6, 2 + Math.random() * 6); }
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(90,110,60,${0.15 + Math.random() * 0.25})`; g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, 3 + Math.random() * 14, 0, 7); g.fill(); }
      const gt = new T.CanvasTexture(cv); gt.wrapS = gt.wrapT = T.RepeatWrapping; gt.repeat.set(400, 400); gt.colorSpace = T.SRGBColorSpace; gt.anisotropy = 8;
      const ground = new T.Mesh(new T.PlaneGeometry(60000, 80000), new T.MeshStandardMaterial({ map: gt, roughness: 0.95 }));
      ground.rotation.x = -Math.PI / 2; ground.position.set(650 - 30000, 0, 0); ground.receiveShadow = true; S.add(ground);
      const wcv = document.createElement("canvas"); wcv.width = wcv.height = 256; const wg = wcv.getContext("2d"); wg.fillStyle = "rgb(128,128,255)"; wg.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1600; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 2 + Math.random() * 10; const gr = wg.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${100 + Math.random() * 56},${100 + Math.random() * 56},255,0.5)`); gr.addColorStop(1, "rgba(128,128,255,0)"); wg.fillStyle = gr; wg.fillRect(x - r, y - r, 2 * r, 2 * r); }
      const wt = new T.CanvasTexture(wcv); wt.wrapS = wt.wrapT = T.RepeatWrapping; wt.repeat.set(15000, 15000); this.waterTex = wt;
      const sea = new T.Mesh(new T.PlaneGeometry(4e6, 4e6), new T.MeshStandardMaterial({ color: 0x1d4f63, roughness: 0.12, metalness: 0.1, normalMap: wt, normalScale: new T.Vector2(0.6, 0.6) }));
      sea.rotation.x = -Math.PI / 2; sea.position.set(650 + 2e6, -0.3, 0); S.add(sea);
      // far land beyond the detailed ground (seen from altitude)
      const far = new T.Mesh(new T.PlaneGeometry(4e6, 4e6), new T.MeshStandardMaterial({ color: 0x8f8566, roughness: 1 })); far.rotation.x = -Math.PI / 2; far.position.set(650 - 2e6, -0.6, 0); S.add(far);
      // surf line + beach
      const beach = new T.Mesh(new T.PlaneGeometry(90, 80000), new T.MeshStandardMaterial({ color: 0xd8cba6, roughness: 0.9 })); beach.rotation.x = -Math.PI / 2; beach.position.set(605, 0.02, 0); S.add(beach);
      const surf = new T.Mesh(new T.PlaneGeometry(14, 80000), new T.MeshBasicMaterial({ color: 0xf2f6f8, transparent: true, opacity: 0.6 })); surf.rotation.x = -Math.PI / 2; surf.position.set(660, 0.05, 0); S.add(surf); this.surf = surf;
      S.fog = new T.FogExp2(0xc8d4e0, 1 / 25000);
      // tower assembly (positioned per run)
      const tw = this.tower = new T.Group(); S.add(tw);
      const steel = new T.MeshStandardMaterial({ color: 0x5f656c, metalness: 0.75, roughness: 0.55 });
      const steelL = new T.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.8, roughness: 0.45 });
      const concrete = new T.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.9 });
      const latt = new T.Mesh(lattice(146, 10, 9, this.Q.towerDetail, merge), steel); latt.castShadow = true; tw.add(latt); this.towerLatt = latt;
      const top = new T.Mesh(new T.BoxGeometry(12, 3, 12), steel); top.position.y = 147.5; tw.add(top);
      const pad = new T.Mesh(new T.CylinderGeometry(70, 70, 0.4, 48), concrete); pad.position.y = 0.2; pad.receiveShadow = true; this.scene.add(pad); this.pad = pad;
      // carriage + chopsticks (arms pivot about vertical hinges on the tower face, extend toward +X = tower e-axis)
      const car = this.carriage = new T.Group(); tw.add(car);
      const carBox = new T.Mesh(new T.BoxGeometry(13, 9, 13), steelL); carBox.position.y = -4; car.add(carBox);
      const armG = truss(38, 4.0, 2.6, 10, merge); this.arms = [];
      for (const s of [-1, 1]) { const hinge = new T.Group(); hinge.position.set(5.2, -4.2, s * 4.6); const arm = new T.Mesh(armG, steelL); arm.castShadow = true; arm.position.set(0, 0, 0); hinge.add(arm); car.add(hinge); this.arms.push({ hinge, s }); }
      // ship QD arm (retracted) near the top, booster QD + launch mount at the catch axis
      const qd = new T.Mesh(truss(22, 3, 3, 6, merge), steel); qd.position.set(5, 130, -2); qd.rotation.y = 1.2; tw.add(qd);
      const olm = this.olm = new T.Group(); S.add(olm);
      const ring = new T.Mesh(new T.CylinderGeometry(8.5, 8.5, 3.2, 40, 1, true), steelL); ring.position.y = 20; olm.add(ring);
      const deck = new T.Mesh(new T.RingGeometry(5.2, 9.5, 40), steel); deck.rotation.x = -Math.PI / 2; deck.position.y = 21.6; olm.add(deck);
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const leg = new T.Mesh(new T.BoxGeometry(2.2, 20, 2.2), concrete); leg.position.set(9 * Math.cos(a), 10, 9 * Math.sin(a)); leg.castShadow = true; olm.add(leg); }
      const bqd = new T.Mesh(new T.BoxGeometry(6, 3, 3), steel); bqd.position.set(-8, 24, 0); olm.add(bqd);
      // trail
      this.trailGeo = new T.BufferGeometry(); this.trailGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(3 * 4000), 3));
      this.trail = new T.Line(this.trailGeo, new T.LineBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.55 })); this.trail.frustumCulled = false; S.add(this.trail);
      // re-entry plasma sheath (additive fresnel shell around the leading aft end)
      this.plasmaMat = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, uniforms: { uI: { value: 0 }, uTime: { value: 0 } },
        vertexShader: "#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 vN; varying vec3 vP; varying float vY; void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vP=mv.xyz; vY=position.y; gl_Position=projectionMatrix*mv;\n#include <logdepthbuf_vertex>\n}",
        fragmentShader: "#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform float uI; uniform float uTime; varying vec3 vN; varying vec3 vP; varying float vY; void main(){\n#include <logdepthbuf_fragment>\n float f=1.0-abs(dot(normalize(vN),normalize(-vP))); float a=uI*pow(f,1.5)*(0.75+0.25*sin(vY*3.0+uTime*30.0))*smoothstep(1.0,0.0,vY); gl_FragColor=vec4(vec3(1.0,0.45,0.75)*a + vec3(1.0,0.7,0.4)*a*0.5, a);}" });
      const pg = new T.SphereGeometry(1, 32, 16, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65); pg.translate(0, 0.35, 0); pg.scale(6.5, 22, 6.5); pg.translate(0, 0, 0);
      this.plasmaGeoY = pg; this.plasma = new T.Mesh(pg, this.plasmaMat); this.plasma.frustumCulled = false;
      // normalize plasma vY to 0..1 over the shell height
      { const pos = pg.attributes.position; let ymin = 1e9, ymax = -1e9; for (let i = 0; i < pos.count; i++) { ymin = Math.min(ymin, pos.getY(i)); ymax = Math.max(ymax, pos.getY(i)); } this.plasmaYr = [ymin, ymax]; }
      // steam / dust particles
      this._buildParticles();
      this._applyTod();
      this._setupComposer();
    }
    _buildParticles() {
      if (this.parts) { this.scene.remove(this.parts); this.parts.geometry.dispose(); }
      const n = this.Q.particles, g = new T.BufferGeometry();
      this.pp = { n, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), age: new Float32Array(n).fill(1e9), life: new Float32Array(n), size: new Float32Array(n), col: new Float32Array(n * 4), next: 0 };
      g.setAttribute("position", new T.BufferAttribute(this.pp.pos, 3)); g.setAttribute("aSize", new T.BufferAttribute(this.pp.size, 1)); g.setAttribute("aCol", new T.BufferAttribute(this.pp.col, 4));
      const m = new T.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } },
        vertexShader: "#include <common>\n#include <logdepthbuf_pars_vertex>\nattribute float aSize; attribute vec4 aCol; varying vec4 vC; uniform float uScale; void main(){ vC=aCol; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=clamp(aSize*uScale/max(-mv.z,1.0), 0.0, 256.0); gl_Position=projectionMatrix*mv;\n#include <logdepthbuf_vertex>\n}",
        fragmentShader: "#include <common>\n#include <logdepthbuf_pars_fragment>\nvarying vec4 vC; void main(){\n#include <logdepthbuf_fragment>\n vec2 d=gl_PointCoord-0.5; float r=dot(d,d)*4.0; if(r>1.0) discard; gl_FragColor=vec4(vC.rgb, vC.a*(1.0-r)*(1.0-r));}" });
      this.parts = new T.Points(g, m); this.parts.frustumCulled = false; this.scene.add(this.parts);
    }
    _setupComposer() {
      if (!this.ok) return;
      this.composer = null;
      if (!this.Q.bloom) return;
      const c = this.composer = new T.EffectComposer(this.r);
      c.addPass(new T.RenderPass(this.scene, this.cam));
      this.bloom = new T.UnrealBloomPass(new T.Vector2(256, 256), 0.5, 0.5, 0.93); c.addPass(this.bloom);
      c.addPass(new T.OutputPass());
      this.resize();
    }
    setRun(run, ref) {
      this.run = run; this.ref = ref || null; this._camInit = false; this.hud.run = run; this.userOrbit = false;
      if (this.idle) { this.scene.remove(this.idle.group); this.idle = null; }
      this.trail.visible = true;
      if (this.booster) { this.scene.remove(this.booster.group); this.scene.remove(this.plasma); }
      const p = run.p, B = this.booster = new SH.Booster3D(this.quality, p);
      B.group.traverse(o => { if (o.isMesh) { o.castShadow = this.Q.shadows; } });
      this.scene.add(B.group); B.group.add(this.plasma); this.plasma.position.y = -3;
      if (!this.plumes) this.plumes = new SH.Plumes(this.scene, this.quality);
      B.setTransparent(this.transparent);
      this._placeTower(p, run.v4);
      // trail from the log (base position every ~0.5 s)
      const L = run.log, arr = this.trailGeo.attributes.position.array; let k = 0; this.trailT = [];
      for (let i = 0; i < L.t.length && k < 4000; i += 10) { arr.set([L.xb[i], L.yb[i], L.zb ? L.zb[i] : 0], k * 3); this.trailT.push(L.t[i]); k++; }
      this.trailGeo.attributes.position.needsUpdate = true; this.trailN = k;
      let hmax = 1; for (let i = 0; i < L.t.length; i++) if (L.heat[i] > hmax) hmax = L.heat[i]; this.heatMax = hmax;
      for (let i = 0; i < this.pp.n; i++) this.pp.age[i] = 1e9;
      this.lastT = null;
    }
    // tower placement: catch axis at (tx, tz); closing axis c, extension axis e (arms extend from the tower along +e)
    _placeTower(p, v4) {
      const hd = v4 ? (p.tower_hdg || 0) : 0, ex = [Math.sin(hd), 0, Math.cos(hd)];
      const tx = v4 ? (p.tower_x_m || 0) : 0, tz = v4 ? (p.tower_z_m || 0) : 0;
      this.towerAxis = new T.Vector3(tx, 0, tz);
      const back = 22;
      this.tower.position.set(tx - ex[0] * back, 0, tz - ex[2] * back);
      this.tower.rotation.y = Math.atan2(-ex[2], ex[0]);   // local +X -> e
      this.carriage.position.y = p.arm_top_m || 125;
      this.olm.position.set(tx, 0, tz); this.pad.position.set(tx, 0.2, tz);
    }
    // pre-launch preview: booster resting on the closed chopsticks, slow orbit (drag to look around)
    drawIdle(tSec, settings) {
      if (!this.ok) return;
      if (!this.idle) {
        const p = SH.buildParams(settings || {}); this.idleP = p;
        this.idle = new SH.Booster3D(this.quality, p); this.scene.add(this.idle.group);
        this._placeTower(p, true);
        const S0 = { fin0: 0, fin1: 0, fin2: 0, gx: 0, gz: 0, spool: new Array(33).fill(0), thr: 0, lox_h: 0, ch4_h: 0, loxL_h: 0, q: 0 };
        this.idle.update(S0, 0); this.idle.group.position.set(this.towerAxis.x, (p.arm_top_m || 125) - (p.l_pins_m || 66), this.towerAxis.z);
        this.idle.group.rotation.y = -(p.tower_hdg || 0);
        this.arms.forEach(a => { a.hinge.rotation.y = -a.s * Math.atan2(4.9 + 1.3 - 4.6, 16.8); });
        this.idleCamA = 0;
      }
      if (this.booster) this.booster.group.visible = false;
      this.trail.visible = false; this.plasma.visible = false;
      const c = this.idle.group.position, tgt = new T.Vector3(c.x, c.y + 40, c.z);
      if (!this.userOrbit) { this.idleCamA = tSec * 0.06; this.cam.position.set(tgt.x - Math.sin(this.idleCamA) * 230, 45, tgt.z - Math.cos(this.idleCamA) * 230); this.controls.target.copy(tgt); this.cam.lookAt(tgt); this.cam.fov = 40; this.cam.updateProjectionMatrix(); }
      this.controls.enabled = true; this.controls.update();
      this.skyMat.uniforms.space.value = 0; this.sky.position.copy(this.cam.position); this.stars.position.copy(this.cam.position);
      if (this.composer) this.composer.render(); else this.r.render(this.scene, this.cam);
      const h = this.hud, cx = h.ctx; cx.setTransform(h.dpr, 0, 0, h.dpr, 0, 0); cx.clearRect(0, 0, h.W, h.H);
    }
    resize() {
      if (!this.ok) return;
      const rc = this.wrap.getBoundingClientRect(); if (!rc.width || !rc.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, this.Q.dpr);
      this.r.setPixelRatio(dpr); this.r.setSize(rc.width, rc.height, false);
      this.cam.aspect = rc.width / rc.height; this.cam.updateProjectionMatrix();
      if (this.composer) { this.composer.setPixelRatio(dpr); this.composer.setSize(rc.width, rc.height); }
      const hd = Math.min(window.devicePixelRatio || 1, 2); this.hudCv.width = Math.round(rc.width * hd); this.hudCv.height = Math.round(rc.height * hd);
      this.hud.W = rc.width; this.hud.H = rc.height; this.hud.dpr = hd; this.W = rc.width; this.H = rc.height;
      this.parts && (this.parts.material.uniforms.uScale.value = rc.height * dpr * 0.9);
    }
    sample(t) {
      const S = SH.Renderer.prototype.sample.call(this, t), L = this.run.log;
      if (SH.LOGK6 && L.q0) { const lo = S.i, hi = Math.min(lo + 1, L.t.length - 1), f = S.f; for (const k of SH.LOGK6) { const a = L[k]; if (a) S[k] = a[lo] + (a[hi] - a[lo]) * f; } }
      return S;
    }
    setTransparent(on) { this.transparent = on; this.hud.transparent = on; if (this.booster) this.booster.setTransparent(on); }
    // ---------------------------------------------------------------- per frame
    draw(t, dtReal, snap) {
      if (!this.ok || !this.run) return;
      const S = this.sample(t); this.S = S; const B = this.booster, G = B.group;
      // pose: base position + attitude quaternion (sim q = [w,x,y,z], body->world). 2D runs: rotation about z from th.
      G.position.set(S.xb, S.yb, S.zb || 0);
      if (S.q0 !== undefined) G.quaternion.set(S.q1, S.q2, S.q3, S.q0).normalize(); else G.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), -S.th);
      B.update(S, t);
      const dt = this.lastT === null || snap ? 0 : clamp(t - this.lastT, 0, 0.5); this.lastT = t;
      const po = this.plumes.update(B, S, t, dt);
      this._chopsticks(S);
      this._plasma(S, t);
      this._particles(S, po, dt, t);
      // trail draw range up to t
      let n = 0; while (n < this.trailN && this.trailT[n] <= t) n++; this.trailGeo.setDrawRange(0, n);
      this.waterTex.offset.set(t * 0.002, t * 0.0013);
      this._camera(S, dtReal || 0.016, snap);
      // sky/space + fog with camera altitude
      const alt = Math.max(this.cam.position.y, 0), space = clamp((alt - 8000) / 42000, 0, 1);
      this.skyMat.uniforms.space.value = space; this.sky.position.copy(this.cam.position); this.stars.position.copy(this.cam.position);
      this.stars.material.opacity = Math.max(space * 0.9, (TOD[this.tod] || TOD.day).tod < 0.2 ? 0.9 : 0);
      this.scene.fog.density = (1 / 25000) * Math.exp(-alt / 8000);
      // shadow camera follows the booster near the ground
      if (this.Q.shadows) { const c = G.position; this.sun.target.position.set(c.x, Math.max(c.y, 0) + 30, c.z); this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 600); }
      if (this.composer) this.composer.render(); else this.r.render(this.scene, this.cam);
      this._hud(S, t);
    }
    _chopsticks(S) {
      // gap = sim arm_gap (distance from the catch axis to each arm's inner face); arms hinge 4.6 m off the tower centreline
      const de0 = 22 - 5.2, w = 2.6, gap = S.arm_gap || 14;
      for (const a of this.arms) { const ang = Math.atan2(gap + w / 2 - 4.6, de0); a.hinge.rotation.y = -a.s * ang; }
    }
    _plasma(S, t) {
      const hN = clamp((S.heat || 0) / this.heatMax, 0, 1), on = S.vy < 0 && (S.M || 0) > 1.2 && S.yb > 8000;
      const I = on ? Math.pow(hN, 1.5) * 1.4 : 0;
      this.plasma.visible = I > 0.02; this.plasmaMat.uniforms.uI.value = I; this.plasmaMat.uniforms.uTime.value = t;
    }
    _particles(S, po, dt, t) {
      const P = this.pp, B = this.booster;
      // plume impingement point on the ground / OLM deck / water
      if (dt > 0 && po.n > 0 && po.Lmax > 0) {
        const Yb = po.Yb, exitW = new T.Vector3(0, -4.3, 0).applyMatrix4(B.group.matrixWorld), dir = Yb.clone().negate();
        const nearOLM = Math.hypot(exitW.x - this.towerAxis.x, exitW.z - this.towerAxis.z) < 9.5;
        const gy = nearOLM ? 21.6 : (exitW.x > 650 ? -0.3 : 0);
        if (dir.y < -0.2) {
          const dist = (exitW.y - gy) / -dir.y;
          if (dist < po.Lmax * 1.6 + 25) {
            const hit = exitW.clone().addScaledVector(dir, dist), strength = clamp(1 - dist / (po.Lmax * 1.6 + 25), 0.1, 1) * clamp(po.n / 3, 0.3, 3) * (0.4 + po.fAvg);
            const water = !nearOLM && exitW.x > 650, rate = strength * (this.quality === "low" ? 60 : 160);
            this._emitAcc = (this._emitAcc || 0) + rate * dt;
            while (this._emitAcc > 1) {
              this._emitAcc -= 1; const i = P.next; P.next = (P.next + 1) % P.n;
              const a = Math.random() * 6.283, sp = 15 + Math.random() * 35 * strength;
              P.pos.set([hit.x + Math.cos(a) * 3, hit.y + 0.5, hit.z + Math.sin(a) * 3], i * 3);
              P.vel.set([Math.cos(a) * sp, 2 + Math.random() * 6, Math.sin(a) * sp], i * 3);
              P.age[i] = 0; P.life[i] = 3 + Math.random() * 4; P.size[i] = 4 + Math.random() * 4;
              const c = water || nearOLM ? [0.95, 0.96, 0.97] : [0.78, 0.7, 0.56]; P.col.set([c[0], c[1], c[2], 0], i * 4);
            }
          }
        }
      }
      const sun = 0.55 + 0.45 * (TOD[this.tod] || TOD.day).tod;
      for (let i = 0; i < P.n; i++) {
        if (P.age[i] > P.life[i]) { P.col[i * 4 + 3] = 0; continue; }
        P.age[i] += dt; const k = i * 3, drag = Math.exp(-dt * 0.9);
        P.vel[k] *= drag; P.vel[k + 2] *= drag; P.vel[k + 1] = P.vel[k + 1] * drag + 1.5 * dt;
        P.pos[k] += P.vel[k] * dt; P.pos[k + 1] += P.vel[k + 1] * dt; P.pos[k + 2] += P.vel[k + 2] * dt;
        const f = P.age[i] / P.life[i]; P.size[i] += dt * 9;
        P.col[i * 4 + 3] = 0.55 * sun * Math.sin(Math.PI * Math.min(f * 1.4, 1)) * (1 - f);
      }
      const g = this.parts.geometry; g.attributes.position.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aCol.needsUpdate = true;
    }
    // ---------------------------------------------------------------- cameras
    _camera(S, dt, snap) {
      const B = this.booster.group, cam = this.cam, M = this.mode, ctl = this.controls;
      const Yb = new T.Vector3(0, 1, 0).applyQuaternion(B.quaternion);
      const mid = B.position.clone().addScaledVector(Yb, 34), alt = Math.max(S.yb, 0);
      const k = snap || !this._camInit ? 1 : 1 - Math.exp(-dt * 4);
      ctl.enabled = M === "orbit" || M === "fins";
      if (ctl.enabled) {
        const tgt = M === "fins" ? B.position.clone().addScaledVector(Yb, 66).add(new T.Vector3(4.5, 0, 0).applyQuaternion(B.quaternion)) : mid;
        if (!this._orbitInit || this._orbitMode !== M) { this._orbitInit = true; this._orbitMode = M; ctl.target.copy(tgt); cam.position.copy(tgt).add(M === "fins" ? new T.Vector3(10, 7, 14) : new T.Vector3(-120, 30, 150)); cam.fov = 45; }
        const d = tgt.clone().sub(ctl.target); ctl.target.add(d); cam.position.add(d);
        ctl.update(); this._camInit = true; cam.near = 0.5; cam.updateProjectionMatrix(); return;
      }
      this._orbitInit = false;
      let pos, look = mid, fov = 45, up = new T.Vector3(0, 1, 0);
      if (M === "follow") {
        const dist = alt < 2000 ? 210 : Math.min(210 + (alt - 2000) * 0.012, 900);
        pos = mid.clone().add(new T.Vector3(-0.35, 0.12, -1).normalize().multiplyScalar(dist));
      } else if (M === "chase") {
        const v = new T.Vector3(S.vx, S.vy, S.vz || 0); const vh = v.lengthSq() > 4 ? v.normalize() : new T.Vector3(0, -1, 0);
        pos = mid.clone().addScaledVector(vh, -170).add(new T.Vector3(0, 25, 0)).add(new T.Vector3(-vh.z, 0, vh.x).multiplyScalar(40));
      } else if (M === "onboard") {   // hull camera near the top, looking down the side at fins/engines/plume
        pos = new T.Vector3(1.6, 62, 4.5 + 1.6).applyMatrix4(B.matrixWorld);
        look = new T.Vector3(0.8, 0, 4.5 + 4.5).applyMatrix4(B.matrixWorld); fov = 70; up = Yb.clone();
      } else if (M === "tower") {
        const tp = this.tower.position; pos = new T.Vector3(tp.x, 152, tp.z);
        const d = pos.distanceTo(mid); fov = clamp(2 * Math.atan(55 / d) / D2R, 2, 60);
      } else if (M === "ground") {   // beach-side spectator ~2.6 km from the catch axis (audio uses true distance/343 delays)
        pos = new T.Vector3(this.towerAxis.x - 1200, 2.0, this.towerAxis.z - 2300);
        const d = pos.distanceTo(mid); fov = clamp(2 * Math.atan(60 / d) / D2R, 0.6, 55);
      } else if (M === "below") {    // from below / behind the engines (the "33 glowing engines" view)
        const side = new T.Vector3(1, 0, 0).applyQuaternion(B.quaternion);
        pos = B.position.clone().addScaledVector(Yb, -140).addScaledVector(side, 45); look = B.position.clone().addScaledVector(Yb, 20); fov = 40;
      } else { pos = mid.clone().add(new T.Vector3(0, 20, -260)); }
      if (pos.y < 1.5) pos.y = 1.5;
      if (M === "onboard" || snap || !this._camInit) cam.position.copy(pos); else cam.position.lerp(pos, k);
      this._look = (this._look && !snap && M !== "onboard" && this._camInit) ? this._look.lerp(look, k) : look.clone();
      cam.up.copy(up); cam.lookAt(this._look); cam.fov = fov; cam.near = M === "ground" || M === "tower" ? 2 : 0.3; cam.updateProjectionMatrix();
      this._camInit = true;
    }
    _hud(S, t) {
      const h = this.hud, c = h.ctx; c.setTransform(h.dpr, 0, 0, h.dpr, 0, 0); c.clearRect(0, 0, h.W, h.H);
      if (this.hideHud) return;
      h.drawHUD(S, t);
      c.save(); c.font = "600 11px Rajdhani, sans-serif"; c.fillStyle = "rgba(200,220,240,0.75)"; c.textAlign = "center";
      c.fillText(`3D · ${this.mode.toUpperCase()} · ${this.quality}`, h.W / 2, 8); c.restore();
    }
  }
  SH.Renderer3D = Renderer3D;
})(window.SH = window.SH || {});
