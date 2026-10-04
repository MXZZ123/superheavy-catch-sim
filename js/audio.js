/* Spatial procedural WebAudio driven by the playback state and the 3D camera.
   Graph: sources -> [group gain] -> DelayNode (propagation, distance/343 s scaled by playback speed) -> PannerNode
   (HRTF on desktop, equal-power on phones; inverse-distance attenuation) -> bus (engines / aero / mech / events) ->
   master -> compressor -> out.  Because the propagation delay follows the source-listener distance continuously,
   Doppler shift falls out of the variable delay line exactly; on the ground / tower cameras everything (including
   sonic booms) arrives late by distance/343.
   Sounds: three engine groups (centre / inner / outer ring) each with rumble + roar + crackle (crackle ~ throttle x
   ambient-pressure^0.7, i.e. shock-noise at low altitude), ignition pops, aero rush ~ q, wind at the listener, vent
   hiss, grid-fin hydraulic whine ~ fin rate, slosh thumps, structure creaks under g, chopstick hydraulics + catch clank,
   sonic boom (triple N-wave) at the transonic crossing.  Created only after a user gesture (autoplay policy).        */
(function (SH) {
  "use strict";
  const C_SND = 343;
  const mobile = () => !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  class Audio {
    constructor() { this.ctx = null; this.on = false; this.prev = null; this.vol = { master: 0.8, engines: 1, aero: 1, mech: 1, events: 1 }; this.lastThump = 0; this.lastCreak = 0; }
    _noise(sec, kind) {
      const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else if (kind === "crackle") { d[i] = Math.random() < 0.0016 ? (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random()) : 0; if (i > 0) d[i] += d[i - 1] * 0.55; }
        else d[i] = w;
      }
      return b;
    }
    _spatial(bus) {   // delay + panner chain; returns input node
      const c = this.ctx, dl = c.createDelay(25), pn = c.createPanner();
      pn.panningModel = mobile() ? "equalpower" : "HRTF"; pn.distanceModel = "inverse"; pn.refDistance = 120; pn.rolloffFactor = 1.0; pn.maxDistance = 2e5;
      dl.connect(pn); pn.connect(bus); return { in: dl, dl, pn };
    }
    _loop(buf, filt, f, q, dest) {
      const c = this.ctx, s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random() * 0.5;
      const fl = c.createBiquadFilter(); fl.type = filt; fl.frequency.value = f; fl.Q.value = q || 0.7;
      const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(dest); s.start();
      return { s, fl, g };
    }
    enable() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
        const c = this.ctx = new AC();
        const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.connect(c.destination);
        this.master = c.createGain(); this.master.gain.value = this.vol.master; this.master.connect(comp);
        this.bus = {}; for (const k of ["engines", "aero", "mech", "events"]) { const g = c.createGain(); g.gain.value = this.vol[k]; g.connect(this.master); this.bus[k] = g; }
        const wn = this._noise(4, "white"), bn = this._noise(4, "brown"), cr = this._noise(3, "crackle");
        this.wn = wn; this.bn = bn;
        // engine groups: centre (3), inner (10), outer (20)
        this.groups = [0, 1, 2].map(() => {
          const sp = this._spatial(this.bus.engines);
          return { sp, rumble: this._loop(bn, "lowpass", 220, 0.8, sp.in), roar: this._loop(wn, "bandpass", 700, 0.5, sp.in), crackle: this._loop(cr, "highpass", 900, 0.4, sp.in) };
        });
        // aero rush + vents + fin hydraulics at the booster
        this.boosterSp = this._spatial(this.bus.aero);
        this.aero = this._loop(wn, "bandpass", 600, 0.4, this.boosterSp.in);
        this.vent = this._loop(wn, "highpass", 3500, 0.7, this.boosterSp.in);
        this.mechSp = this._spatial(this.bus.mech);
        const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = 420; const of = c.createBiquadFilter(); of.type = "bandpass"; of.frequency.value = 900; of.Q.value = 3;
        const og = c.createGain(); og.gain.value = 0; o.connect(of); of.connect(og); og.connect(this.mechSp.in); o.start(); this.finWhine = { o, g: og, f: of };
        // chopsticks hydraulics at the tower arms
        this.towerSp = this._spatial(this.bus.mech);
        const ho = c.createOscillator(); ho.type = "sawtooth"; ho.frequency.value = 118; const hf = c.createBiquadFilter(); hf.type = "lowpass"; hf.frequency.value = 600;
        const hg = c.createGain(); hg.gain.value = 0; ho.connect(hf); hf.connect(hg); hg.connect(this.towerSp.in); ho.start(); this.armHyd = { o: ho, g: hg };
        this.armHiss = this._loop(wn, "bandpass", 1800, 1.5, this.towerSp.in);
        // wind at the listener (non-spatial)
        this.wind = this._loop(bn, "lowpass", 380, 0.6, this.bus.aero);
        this.windHi = this._loop(wn, "bandpass", 1200, 0.3, this.bus.aero);
      }
      this.ctx.resume(); this.on = true; return true;
    }
    disable() { this.on = false; if (this.ctx) this.ctx.suspend(); }
    setVolume(k, v) { this.vol[k] = v; if (!this.ctx) return; const n = k === "master" ? this.master : this.bus[k]; if (n) n.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
    _set(param, v, tc) { param.setTargetAtTime(v, this.ctx.currentTime, tc || 0.05); }
    _place(sp, pos, L, speed) {   // world position of the source; L = listener info
      const c = this.ctx, t = c.currentTime, dx = pos[0] - L.cam[0], dy = pos[1] - L.cam[1], dz = pos[2] - L.cam[2];
      const d = Math.hypot(dx, dy, dz), delay = L.mode === "onboard" ? 0 : Math.min(d / C_SND / Math.max(speed, 0.25), 24);
      sp.dl.delayTime.setTargetAtTime(delay, t, 0.35);
      // panner position relative to the listener (listener kept at the origin to avoid float issues at 100 km)
      if (sp.pn.positionX) { sp.pn.positionX.setTargetAtTime(dx, t, 0.05); sp.pn.positionY.setTargetAtTime(dy, t, 0.05); sp.pn.positionZ.setTargetAtTime(dz, t, 0.05); } else sp.pn.setPosition(dx, dy, dz);
      return d;
    }
    _oneShot(pos, L, speed, build, busName) {   // event source with its own delay/panner snapshot (arrives late on far cameras)
      const sp = this._spatial(this.bus[busName || "events"]); const d = this._place(sp, pos, L, speed);
      sp.dl.delayTime.value = L.mode === "onboard" ? 0 : Math.min(d / C_SND / Math.max(speed, 0.25), 24);
      build(sp.in); setTimeout(() => { try { sp.pn.disconnect(); } catch (e) {} }, 30000);
    }
    _burst(dest, dur, f, gain, kind, delay) {
      const c = this.ctx, s = c.createBufferSource(); s.buffer = kind === "brown" ? this.bn : this.wn; const off = Math.random() * 2;
      const fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = f;
      const g = c.createGain(); const t0 = c.currentTime + (delay || 0);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      s.connect(fl); fl.connect(g); g.connect(dest); s.start(t0, off); s.stop(t0 + dur + 0.1);
    }
    _tone(dest, f, dur, gain, type, delay, fEnd) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + (delay || 0); o.type = type || "sine"; o.frequency.setValueAtTime(f, t0); if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur); o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
    }
    _clank(dest, delay) {
      for (const f of [180, 263, 410, 637, 1220]) this._tone(dest, f * (0.98 + Math.random() * 0.04), 1.6 * 300 / f, 0.2, "triangle", delay);
      this._burst(dest, 0.25, 3000, 0.35, "white", delay);
    }
    // per frame. S = sampled sim state, L = listener/camera info from the renderer
    update(S, playing, speed, L) {
      if (!this.on || !this.ctx || !L) return;
      const c = this.ctx, tc = c.currentTime;
      if (c.listener.positionX) { c.listener.positionX.value = 0; c.listener.positionY.value = 0; c.listener.positionZ.value = 0; c.listener.forwardX.setTargetAtTime(L.fwd[0], tc, 0.05); c.listener.forwardY.setTargetAtTime(L.fwd[1], tc, 0.05); c.listener.forwardZ.setTargetAtTime(L.fwd[2], tc, 0.05); c.listener.upX.setTargetAtTime(L.up[0], tc, 0.05); c.listener.upY.setTargetAtTime(L.up[1], tc, 0.05); c.listener.upZ.setTargetAtTime(L.up[2], tc, 0.05); }
      else if (c.listener.setOrientation) c.listener.setOrientation(L.fwd[0], L.fwd[1], L.fwd[2], L.up[0], L.up[1], L.up[2]);
      const pr = Math.min(Math.max(S.pr || 0, 0), 1), thr = playing ? (S.thr || 0) : 0, sp = S.spool || [];
      // engine groups
      const ranges = [[0, 3], [3, 13], [13, 33]];
      let dist = 0;
      ranges.forEach(([a, b], k) => {
        let lit = 0; for (let i = a; i < b; i++) lit += sp[i] || 0;
        const G = this.groups[k], e = playing ? Math.sqrt(lit / 3) * thr : 0;
        dist = this._place(G.sp, L.src, L, speed);
        const loud = e * (0.3 + 0.7 * pr) * (k === 2 ? 0.9 : 1);
        this._set(G.rumble.g.gain, 0.9 * loud); G.rumble.fl.frequency.setTargetAtTime(140 + 300 * pr * e, tc, 0.1);
        this._set(G.roar.g.gain, 0.35 * loud * (0.3 + 0.7 * pr));
        this._set(G.crackle.g.gain, 1.6 * e * Math.pow(pr, 0.7) * thr, 0.03);   // crackle: throttle x ambient pressure
      });
      // air absorption: far sources lose highs
      const hiCut = Math.max(600, 16000 * Math.exp(-dist / 1800));
      for (const G of this.groups) G.roar.fl.frequency.setTargetAtTime(Math.min(700 + 300 * pr, hiCut), tc, 0.2);
      this._place(this.boosterSp, L.src, L, speed); this._place(this.mechSp, L.src, L, speed);
      const tw = L.tower ? [L.tower.x, 125, L.tower.z] : [0, 125, 0]; this._place(this.towerSp, tw, L, speed);
      const qn = playing ? Math.min((S.q || 0) / 120e3, 1.3) : 0;
      this._set(this.aero.g.gain, 0.5 * qn); this.aero.fl.frequency.setTargetAtTime(300 + 900 * qn, tc, 0.2);
      this._set(this.vent.g.gain, playing && (S.vent_o + S.vent_f) > 1 ? Math.min(0.3, 0.05 + (S.vent_o + S.vent_f) / 6000) : 0, 0.2);
      const fr = playing ? Math.min((S.fin_rate || 0) / 25, 1) : 0;
      this._set(this.finWhine.g.gain, 0.12 * fr, 0.05); this.finWhine.o.frequency.setTargetAtTime(380 + 500 * fr, tc, 0.05);
      // wind at the listener: ground/tower cameras feel the surface wind, onboard feels the airspeed
      const w = L.mode === "onboard" ? Math.min((S.airspeed || 0) / 300, 1.5) * (0.3 + 0.7 * pr) : Math.min(Math.abs(S.wind_mean || 0) / 20 + (L.mode === "ground" || L.mode === "tower" ? 0.25 : 0.05), 1);
      this._set(this.wind.g.gain, 0.08 * w, 0.4); this._set(this.windHi.g.gain, 0.03 * w, 0.4);
      if (playing && this.prev && speed < 30) {
        const P = this.prev;
        let starts = 0; if (S.state && P.state) for (let i = 0; i < 33; i++) if (S.state[i] === 1 && P.state[i] !== 1) starts++;
        if (starts) this._oneShot(L.src, L, speed, d => this._burst(d, 0.35, 900, Math.min(0.2 + 0.06 * starts, 0.7) * (0.3 + 0.7 * pr), "brown"), "engines");
        // sonic boom: decelerating through Mach 1 -> the N-wave reaches the listener after distance/343
        if (P.M > 1.02 && S.M <= 1.02 && S.vy < 0) this._oneShot(L.src, L, speed, d => { this._burst(d, 0.16, 800, 1.0, "white", 0); this._burst(d, 0.16, 800, 0.8, "white", 0.32); this._burst(d, 0.16, 700, 0.6, "white", 0.6); this._tone(d, 55, 0.6, 0.6, "sine", 0); });
        // slosh thumps: large slosh angle reversing
        const ps = S.lox_psi1 || 0, pp = P.psi || 0, now = tc;
        if (Math.abs(pp) > 0.2 && Math.sign(ps - pp) !== Math.sign(P.dpsi || 0) && now - this.lastThump > 0.6) { this.lastThump = now; this._oneShot(L.src, L, speed, d => this._tone(d, 48 + Math.random() * 15, 0.5, Math.min(0.6, Math.abs(pp)), "sine", 0, 32), "mech"); }
        // structure creaks under g
        if ((S.g_load || 0) > 3 && now - this.lastCreak > 0.4 && Math.random() < (S.g_load - 3) * 0.05) { this.lastCreak = now; this._oneShot(L.src, L, speed, d => { const o = this.ctx.createBiquadFilter(); o.type = "bandpass"; o.Q.value = 12; o.frequency.setValueAtTime(220 + Math.random() * 200, this.ctx.currentTime); o.frequency.linearRampToValueAtTime(520, this.ctx.currentTime + 0.5); o.connect(d); this._burst(o, 0.55, 3000, 0.6, "white"); }, "mech"); }
        // chopsticks hydraulics while the arms move, clank on catch
        const moving = P.arm_gap > S.arm_gap + 0.01;
        this._set(this.armHyd.g.gain, moving ? 0.25 : 0, 0.15); this._set(this.armHiss.g.gain, moving ? 0.12 : 0, 0.15);
        if (P.phase !== "CAUGHT" && S.phase === "CAUGHT") this._oneShot(tw, L, speed, d => { this._clank(d, 0); this._clank(d, 0.45); this._tone(d, 70, 1.2, 0.7, "sine", 0); });
        this.prev.dpsi = ps - pp;
      } else { this._set(this.armHyd.g.gain, 0); this._set(this.armHiss.g.gain, 0); }
      this.prev = Object.assign(this.prev || {}, { state: S.state ? Int8Array.from(S.state) : null, M: S.M, phase: S.phase, arm_gap: S.arm_gap, psi: S.lox_psi1 || 0 });
    }
  }
  SH.Audio = Audio;
})(window.SH = window.SH || {});
