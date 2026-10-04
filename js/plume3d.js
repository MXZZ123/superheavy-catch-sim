/* Raptor methalox plumes driven by the simulation (three.js).
   Physics per lit engine i (from the sampled sim state; see SH.plumePhys):
     thrust fraction  f = spool_i * throttle   (start / shutdown transients come straight from the sim's spool model)
     exit pressure    p_e = 0.8 bar * f        (scales with chamber pressure); ambient p_a from the 1976 atmosphere
     pressure ratio   n = p_e / p_a  (<1 over-expanded at sea level, >>1 under-expanded at altitude)
     confinement      a forward-flying plume is bounded by p_a + 0.6 q (free-stream momentum), not p_a alone
     plume boundary   the jet expands until its pressure matches ambient: r_eq = R_e * n^(1/2.4) (area ~ n^(1/gamma)),
                      approached over ~1.5 r_eq, then a slow 2.5-3.5 deg spreading -> narrow/collimated at sea level,
                      ballooning (and dimming ~ (R_e/r)^2) at altitude
     shock diamonds   Prandtl-Pack spacing s = 1.1 D_e sqrt(n) (n clamped >= 0.25); visible for 0.15 < n < ~6, fading
                      downstream; above that a single barrel shock / Mach disk then a smooth plume
     visible length   L = (36 + 44 f)(1 + 0.5 log10(1+n)) m (afterburning luminous region), bright core D_e (5 + 6 f)
     retro-propulsion with the engines facing the flow (boostback at altitude, entry and landing burns) the plume's
                      terminal shock stands off where the jet momentum flux ~ free-stream dynamic pressure:
                      L_eff = L / (1 + q / (8 kPa f)); the end is flattened and folded back around the vehicle.
                      The sim (sim6.js) uses the matching thrust coefficient C_T = T / (q A) for its SRP drag model.
     merging          neighbouring jets (1.6 m pitch) touch at x_m = (pitch - D_e) / (2 tan theta); with many lit engines
                      a combined cluster plume (base radius 4.5 m) carries most of the light
     base heating     recirculation glow under the base at altitude ~ (n_lit/33) f (1 - p_a/p0)^2
   Rendering: instanced additive cone layers (white-yellow core, pink -> magenta -> violet methalox afterglow, mauve far
   trail) with view-dependent volume thickness, fbm turbulence noise that streams downstream, diamonds, start (orange
   rich) / shutdown (green, copper-rich) flashes, per-engine exit flares (the "33 white points" seen from below),
   a combined plume and a base-heating disc. Log-depth aware; bloom comes from the renderer. */
(function (SH) {
  "use strict";
  const T = window.THREE;
  const DE = 1.3, RE = 0.64, P0 = 101325, RC = 4.5;
  const NOISE = `
    float h3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
    float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 4; k++) { s += a * n3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }`;
  const VERT = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec4 aP0; attribute vec4 aP1; attribute vec4 aP2;
    uniform float uR0;
    varying float vV; varying float vX; varying float vR; varying vec3 vN; varying vec3 vPos; varying vec3 vLoc; varying vec4 vP0; varying vec4 vP1; varying vec4 vP2;
    void main(){
      float L = max(aP0.x, 0.01), tn = aP0.y, flare = aP1.y, rEq = max(aP2.x, uR0), kE = max(aP2.y, 0.3);
      float v = clamp(-position.y, 0.0, 1.0); float x = v * L;
      float r = uR0 + (rEq - uR0) * (1.0 - exp(-x / kE)) + tn * x;
      float fo = flare * smoothstep(0.45, 1.0, v);
      r += fo * (3.0 + 0.6 * L);              // retro: flattened end spreads sideways ...
      float y = -x + fo * fo * L * 0.55;      // ... and is folded back toward the vehicle
      vec3 p = vec3(position.x * r, y, position.z * r);
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      vN = normalize(normalMatrix * mat3(instanceMatrix) * vec3(position.x, (rEq - uR0) / kE * exp(-x / kE) * 0.5 + tn, position.z));
      vPos = mv.xyz; vV = v; vX = x; vR = r; vLoc = p; vP0 = aP0; vP1 = aP1; vP2 = aP2;
      gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`;
  const FRAG = `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform float uTime; uniform float uCore; uniform float uGain; uniform float uR0; uniform float uNoise;
    varying float vV; varying float vX; varying float vR; varying vec3 vN; varying vec3 vPos; varying vec3 vLoc; varying vec4 vP0; varying vec4 vP1; varying vec4 vP2;
    ${NOISE}
    void main(){
      #include <logdepthbuf_fragment>
      float bright = vP0.w; if (bright < 0.003) discard;
      float s = max(vP0.z, 0.2), amp = vP1.x, flash = vP1.z, seed = vP1.w, coreL = max(vP2.z, 0.5), smoke = vP2.w;
      float facing = abs(dot(normalize(vN), normalize(-vPos)));
      float vol = uCore > 0.5 ? pow(facing, 3.0) : pow(facing, 1.6);           // optical thickness of a soft cylinder
      // dilution: the same light spread over a wider plume (under-expanded jets get fainter as they balloon)
      float dil = clamp(pow(uR0 * 1.6 / vR, 0.8), 0.12, 1.0);   // surface brightness ~ emissivity x path ~ 1/r
      float along = uCore > 0.5 ? exp(-vX / coreL) : smoothstep(0.0, 0.03, vV) * (1.0 - smoothstep(0.5, 1.0, vV)) * (1.0 - 0.3 * vV);
      // turbulence streaming downstream (scale follows the local plume radius)
      float sc = 1.0 / max(vR * 0.55, 0.4);
      float tb = fbm(vec3(vLoc.x * sc, (vLoc.y + uTime * (30.0 + 4.0 * vR)) * sc * 0.45, vLoc.z * sc) + seed);
      float nz = mix(1.0, 0.05 + 1.9 * tb * tb * 1.6, uNoise * (0.35 + 0.65 * smoothstep(0.05, 0.6, vV)));
      // shock diamonds (bright Mach disks / reflection nodes), decaying downstream
      float dia = 1.0 + amp * pow(0.5 + 0.5 * cos(6.2832 * vX / s), 12.0) * exp(-vX / (6.0 * s)) * 2.2;
      float fl = 0.92 + 0.08 * sin(uTime * 41.0 + seed) * sin(uTime * 23.0 + seed * 3.0);
      vec3 hot = vec3(1.0, 0.93, 0.80), pinkHot = vec3(1.0, 0.52, 0.84), pink = vec3(0.95, 0.36, 0.80), violet = vec3(0.58, 0.38, 1.0), mauve = vec3(0.56, 0.42, 0.66);
      vec3 col;
      if (uCore > 0.5) col = mix(hot, pinkHot, smoothstep(0.3, 1.0, vX / (coreL * 2.5)));
      else {
        float u = vX / max(vP0.x, 1.0);
        col = mix(pinkHot, pink, smoothstep(0.0, 0.1, u));
        col = mix(col, violet, smoothstep(0.25, 0.85, u));
        col = mix(col, mauve, smoke * smoothstep(0.1, 0.6, u));            // far trail at altitude: dusky mauve
      }
      if (flash > 0.0) col = mix(col, vec3(1.0, 0.72, 0.35), clamp(flash, 0.0, 1.0));
      if (flash < 0.0) col = mix(col, vec3(0.45, 1.0, 0.55), clamp(-flash, 0.0, 1.0));
      float a = bright * vol * along * dia * fl * nz * dil * uGain * (1.0 + abs(flash) * 1.5);
      gl_FragColor = vec4(col * a, a);
    }`;
  // camera-facing exit flares (instanced quads)
  const FL_VERT = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec2 aF; varying vec2 vUv; varying float vB;
    void main(){
      vUv = position.xy; vB = aF.y;
      vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      c.xy += position.xy * aF.x;
      gl_Position = projectionMatrix * c;
      #include <logdepthbuf_vertex>
    }`;
  const FL_FRAG = `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    varying vec2 vUv; varying float vB;
    void main(){
      #include <logdepthbuf_fragment>
      if (vB < 0.003) discard;
      float r = length(vUv) * 2.0; float a = (exp(-r * r * 6.0) * 1.6 + exp(-r * 3.5) * 0.35) * vB;
      gl_FragColor = vec4(vec3(1.0, 0.95, 0.88) * a, a);
    }`;
  function layer(n, core, segs, R0) {
    const g = new T.CylinderGeometry(1, 1, 1, segs, core ? 24 : 40, true); g.translate(0, -0.5, 0);
    const ig = new T.InstancedBufferGeometry(); ig.index = g.index; ig.attributes.position = g.attributes.position; ig.attributes.normal = g.attributes.normal;
    for (const k of ["aP0", "aP1", "aP2"]) ig.setAttribute(k, new T.InstancedBufferAttribute(new Float32Array(n * 4), 4));
    const m = new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      uniforms: { uTime: { value: 0 }, uCore: { value: core ? 1 : 0 }, uGain: { value: core ? 0.9 : 1.2 }, uR0: { value: R0 }, uNoise: { value: core ? 0.25 : 1.0 } } });
    const mesh = new T.InstancedMesh(ig, m, n); mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    return mesh;
  }
  function radialTex(stops) {
    const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new T.CanvasTexture(c);
  }
  // plume physics for one jet (or the cluster with Re = RC): exported for tests / README
  function plumePhys(f, pa, q, retro, Re) {
    Re = Re || RE;
    // the free stream confines a forward-flying plume (boundary pressure ~ p_a + 0.3 q), so it never balloons fully
    const pe = 0.8e5 * Math.max(f, 0.05), n = pe / Math.max(pa + (retro ? 0 : 0.6 * (q || 0)), 1e-3);
    const rEq = Re * Math.max(1, Math.min(Math.pow(n, 1 / 2.4), 60));
    const tanFar = Math.tan((2.5 + 1.0 * Math.min(1, Math.log10(1 + n))) * Math.PI / 180);
    let L = (36 + 44 * f) * (1 + 0.5 * Math.log10(1 + n)) * Re / RE * (Re > 1 ? 0.45 : 1);
    let Lc = DE * (5 + 6 * f) * (n > 1 ? Math.pow(n, 0.12) : 1);
    let flare = 0, k = 1;
    if (retro && q > 50) { k = 1 + q / (8000 * Math.max(f, 0.1)); L /= k; Lc = Math.min(Lc, L * 0.7); flare = Math.min(1 - 1 / k, 0.92); }
    const s = 1.1 * 2 * Re * Math.sqrt(Math.max(n, 0.25));
    const amp = n < 0.15 ? 0 : Math.max(0, 1 - n / 6) * (retro ? 0.4 : 1);
    const theta0 = Math.atan((rEq - Re) / (1.5 * rEq) + tanFar);
    return { n, pe, rEq, kE: 1.5 * rEq, tanFar, L, Lc, flare, k, s, amp, theta0, xMerge: Math.max(0, (1.6 - DE) / (2 * Math.tan(Math.max(theta0, 0.01)))) };
  }
  SH.plumePhys = plumePhys;
  class Plumes {
    constructor(scene, quality) {
      this.q = quality; const segs = quality === "low" ? 10 : 18;
      this.core = layer(33, true, segs, RE * 0.6); this.glow = layer(33, false, segs, RE); this.combo = layer(1, false, quality === "low" ? 18 : 32, RC);
      this.combo.material.uniforms.uGain.value = 1.8;
      if (quality === "low") for (const m of [this.core, this.glow, this.combo]) m.material.uniforms.uNoise.value *= 0.5;
      // exit flares
      const qg = new T.PlaneGeometry(1, 1), fg = new T.InstancedBufferGeometry(); fg.index = qg.index; fg.attributes.position = qg.attributes.position;
      fg.setAttribute("aF", new T.InstancedBufferAttribute(new Float32Array(33 * 2), 2));
      this.flares = new T.InstancedMesh(fg, new T.ShaderMaterial({ vertexShader: FL_VERT, fragmentShader: FL_FRAG, transparent: true, depthWrite: false, blending: T.AdditiveBlending }), 33);
      this.flares.frustumCulled = false; this.flares.instanceMatrix.setUsage(T.DynamicDrawUsage);
      scene.add(this.glow, this.combo, this.core, this.flares);
      this.base = new T.Mesh(new T.CircleGeometry(1, 48), new T.MeshBasicMaterial({ map: radialTex([[0, "rgba(255,236,220,1)"], [0.3, "rgba(255,170,205,0.6)"], [0.65, "rgba(200,110,220,0.22)"], [1, "rgba(120,60,200,0)"]]), transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
      scene.add(this.base);
      this.prevSpool = new Float32Array(33); this.flash = new Float32Array(33);
      this.m4 = new T.Matrix4(); this.tmp = new T.Matrix4(); this.out = { n: 0, Lmax: 0, impact: null };
    }
    // booster: SH.Booster3D; S: sampled sim state (S.pr = p_a / p0); returns summary used by steam / audio
    update(booster, S, t, dt) {
      const pa = Math.max((S.pr || 0) * P0, 1e-3), thr = S.thr || 0, q = S.q || 0;
      const G = booster.group; G.updateMatrixWorld(true);
      const Yb = new T.Vector3(0, 1, 0).transformDirection(G.matrixWorld);
      // retro-propulsion: engines face the oncoming flow when the air-relative velocity points along -axis
      const v = new T.Vector3((S.vx || 0) - (S.wind_vx || 0), S.vy || 0, (S.vz || 0) - (S.wind_vz || 0)), V = v.length();
      const retro = V > 30 && v.dot(Yb) < -0.3 * V;
      let nlit = 0, ftot = 0;
      for (let i = 0; i < 33; i++) { const sp = S.spool ? S.spool[i] : 0; if (sp > 0.05) { nlit++; ftot += sp; } }
      const fAvg = nlit ? ftot / nlit * thr : 0;
      const PC = plumePhys(fAvg, pa, q, retro, RC);
      // merged fraction: jets touch within a few metres when theta is large (altitude) or when many neighbours are lit
      const mergeW = nlit < 4 ? 0 : Math.min(1, ((nlit - 3) / 20) * (0.6 + 0.4 * Math.min(1, 6 / Math.max(PC.xMerge, 0.5))));
      const cA = this.core.geometry.attributes, gA = this.glow.geometry.attributes, fA = this.flares.geometry.attributes.aF.array;
      let Lmax = 0;
      const smoke = Math.min(1, Math.max(0, Math.log10(Math.max(PC.n, 1)) / 2));
      for (let i = 0; i < 33; i++) {
        const sp = S.spool ? S.spool[i] : 0, st = S.state ? S.state[i] : 0, f = sp * thr;
        // transients: TEA-TEB green / rich orange start flash while spooling up; copper-green puff on shutdown
        const dsp = sp - this.prevSpool[i]; this.prevSpool[i] = sp;
        if (st === 1 && sp > 0.02 && sp < 0.5) this.flash[i] = Math.max(this.flash[i], 1.0 - sp * 1.6);
        if (st === 3 && dsp < 0 && sp > 0.05) this.flash[i] = Math.min(this.flash[i], -0.7);
        this.flash[i] *= Math.exp(-dt * 6);
        const P = plumePhys(f, pa, q, retro, RE);
        let L = P.L, Lc = P.Lc;
        if (mergeW > 0) L = L * (1 - mergeW) + Math.min(L, Math.max(Lc * 1.6, P.xMerge * 2)) * mergeW;
        const bright = sp > 0.05 ? Math.min(1, 0.25 + 0.75 * f) * Math.min(sp * 1.5, 1) : 0;
        const piv = booster.engines[i].piv; piv.updateMatrixWorld(true);
        this.m4.copy(piv.matrixWorld).multiply(this.tmp.makeTranslation(0, -3.5, 0));
        this.core.setMatrixAt(i, this.m4); this.glow.setMatrixAt(i, this.m4);
        cA.aP0.array.set([Lc, P.tanFar * 0.5, P.s, bright], i * 4); cA.aP1.array.set([P.amp, P.flare * 0.5, this.flash[i], i * 1.7], i * 4);
        cA.aP2.array.set([RE * 0.6 * Math.min(Math.sqrt(P.rEq / RE), 2.5), P.kE * 0.6, Lc * 0.45, 0], i * 4);
        gA.aP0.array.set([L, P.tanFar, P.s, bright * (1 - 0.45 * mergeW)], i * 4); gA.aP1.array.set([P.amp * 0.6, P.flare, this.flash[i], i * 2.3], i * 4);
        gA.aP2.array.set([Math.min(P.rEq, 6), P.kE, Lc, smoke], i * 4);
        this.m4.multiply(this.tmp.makeTranslation(0, -0.35, 0)); this.flares.setMatrixAt(i, this.m4);
        fA[i * 2] = DE * (0.95 + 0.45 * f) * (1 + Math.abs(this.flash[i])); fA[i * 2 + 1] = bright * (0.6 + 0.4 * f) * (1 + Math.abs(this.flash[i]) * 0.8);
        if (bright > 0) Lmax = Math.max(Lmax, L);
      }
      for (const m of [this.core, this.glow]) { m.instanceMatrix.needsUpdate = true; for (const k of ["aP0", "aP1", "aP2"]) m.geometry.attributes[k].needsUpdate = true; }
      this.flares.instanceMatrix.needsUpdate = true; this.flares.geometry.attributes.aF.needsUpdate = true;
      // combined cluster plume
      this.m4.copy(G.matrixWorld).multiply(this.tmp.makeTranslation(0, -4.3, 0)); this.combo.setMatrixAt(0, this.m4); this.combo.instanceMatrix.needsUpdate = true;
      const cb = this.combo.geometry.attributes;
      cb.aP0.array.set([PC.L, PC.tanFar * 0.5, PC.s, mergeW * Math.min(1, 0.3 + fAvg)]);
      cb.aP1.array.set([PC.amp * 0.3, PC.flare, 0, 0.3]);
      cb.aP2.array.set([Math.min(PC.rEq, 2.6 * RC), PC.kE, PC.Lc * 3, smoke]);
      for (const k of ["aP0", "aP1", "aP2"]) cb[k].needsUpdate = true;
      // base heating / recirculation glow (altitude, many engines)
      const bh = (nlit / 33) * thr * Math.pow(Math.max(0, 1 - pa / P0), 2);
      this.base.visible = bh > 0.02; this.base.material.opacity = Math.min(0.7, bh * 0.8);
      this.base.position.copy(new T.Vector3(0, -3.2, 0).applyMatrix4(G.matrixWorld)); this.base.quaternion.copy(G.quaternion).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2));
      this.base.scale.setScalar(5.0 + 2.5 * bh);
      for (const m of [this.core.material, this.glow.material, this.combo.material]) m.uniforms.uTime.value = t;
      this.out.n = nlit; this.out.Lmax = Math.max(Lmax, mergeW > 0.2 ? PC.L : 0); this.out.fAvg = fAvg; this.out.retro = retro; this.out.Yb = Yb; this.out.phys = PC;
      return this.out;
    }
  }
  SH.Plumes = Plumes;
})(window.SH = window.SH || {});
