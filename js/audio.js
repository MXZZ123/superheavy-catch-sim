/* Procedural WebAudio driven by the playback state: Raptor roar (filtered noise + rumble + crackle) scaled by
   engines lit, throttle and ambient pressure; ignition pops; aero rush with q; sonic triple-boom on Mach 1;
   vent hiss; arm clank at catch; quiet ambient bed.  Created only after a user gesture (autoplay policy). */
(function (SH) {
  "use strict";
  class Audio {
    constructor() { this.ctx = null; this.on = false; this.prev = null; }
    _noise(sec, brown) {
      const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      let last = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
      return b;
    }
    _loop(buf, filt, f, q) {
      const c = this.ctx, s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = filt; fl.frequency.value = f; fl.Q.value = q || 0.7;
      const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.master); s.start();
      return { s, fl, g };
    }
    enable() {
      if (!this.ctx) {
        const C = window.AudioContext || window.webkitAudioContext; if (!C) return false;
        this.ctx = new C(); const c = this.ctx;
        const comp = c.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.connect(c.destination);
        this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(comp);
        const wn = this._noise(4, false), bn = this._noise(4, true);
        this.roar = this._loop(bn, "lowpass", 400, 0.8);
        this.roarHi = this._loop(wn, "bandpass", 900, 0.6);
        this.crackle = this._loop(wn, "highpass", 2500, 0.5);
        this.aero = this._loop(wn, "bandpass", 600, 0.4);
        this.vent = this._loop(wn, "highpass", 4000, 0.7);
        this.amb = this._loop(bn, "lowpass", 180, 0.5);
        this.crackLfo = 0;
      }
      this.ctx.resume(); this.on = true; return true;
    }
    disable() { this.on = false; if (this.ctx) this.ctx.suspend(); }
    _set(node, v, tc) { node.g.gain.setTargetAtTime(v, this.ctx.currentTime, tc || 0.05); }
    _burst(dur, f, gain, type, delay) {
      const c = this.ctx, s = c.createBufferSource(); s.buffer = this._noise(dur + 0.05, type === "brown");
      const fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = f;
      const g = c.createGain(); const t0 = c.currentTime + (delay || 0);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      s.connect(fl); fl.connect(g); g.connect(this.master); s.start(t0); s.stop(t0 + dur + 0.1);
    }
    _clank(delay) {
      const c = this.ctx, t0 = c.currentTime + (delay || 0);
      for (const f of [180, 263, 410, 637, 1220]) {
        const o = c.createOscillator(), g = c.createGain(); o.type = "triangle"; o.frequency.value = f * (0.98 + Math.random() * 0.04);
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.18, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 1.6 * 300 / f);
        o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 2);
      }
      this._burst(0.25, 3000, 0.3, "white", delay);
    }
    // called each frame with the sampled state; `playing` false -> fade to silence
    update(S, playing, speed) {
      if (!this.on || !this.ctx) return;
      const lit = playing ? S.n : 0, thr = playing ? S.thr : 0, pr = Math.min(Math.max(S.pr, 0), 1);
      const eng = Math.sqrt(lit / 33) * thr;
      const loud = eng * (0.25 + 0.75 * pr);
      this._set(this.roar, 0.9 * loud); this.roar.fl.frequency.setTargetAtTime(160 + 500 * pr * eng + 80 * eng, this.ctx.currentTime, 0.1);
      this._set(this.roarHi, 0.35 * loud * pr);
      this.crackLfo += 0.37; this._set(this.crackle, (0.12 + 0.12 * Math.abs(Math.sin(this.crackLfo * 7.1))) * loud * pr * pr, 0.01);
      const qn = playing ? Math.min(S.q / 120e3, 1.2) : 0;
      this._set(this.aero, 0.45 * qn + 0.05 * Math.min(Math.abs(S.wind_gust) / 10, 1) * playing);
      this.aero.fl.frequency.setTargetAtTime(300 + 900 * qn, this.ctx.currentTime, 0.2);
      this._set(this.vent, playing && S.vent_o + S.vent_f > 1 ? 0.12 * pr + 0.05 : 0, 0.2);
      this._set(this.amb, playing ? 0.05 + 0.08 * pr : 0, 0.5);
      if (playing && this.prev && speed < 30) {
        const P = this.prev;
        // engine ignitions: count new STARTING engines -> pops
        let starts = 0; if (S.state && P.state) for (let i = 0; i < 33; i++) if (S.state[i] === 1 && P.state[i] !== 1) starts++;
        if (starts) this._burst(0.35, 900, Math.min(0.15 + 0.05 * starts, 0.6) * (0.3 + 0.7 * pr), "brown");
        // sonic boom when descending through Mach 1 (low altitude => audible on the ground), triple N-wave
        if (P.M > 1 && S.M <= 1 && S.vy < 0) { this._burst(0.18, 700, 0.9, "white", 0.0); this._burst(0.18, 700, 0.7, "white", 0.35); this._burst(0.18, 700, 0.55, "white", 0.62); }
        // catch: arms clank and pins on rails
        if (P.phase !== "CAUGHT" && S.phase === "CAUGHT") { this._clank(0); this._clank(0.45); }
        if (P.arm_gap > S.arm_gap + 0.02 && !(this.armMoving)) { this.armMoving = true; this._burst(1.2, 220, 0.25, "brown"); }
        if (P.arm_gap <= S.arm_gap) this.armMoving = false;
      }
      this.prev = { state: S.state ? Int8Array.from(S.state) : null, M: S.M, phase: S.phase, arm_gap: S.arm_gap };
    }
  }
  SH.Audio = Audio;
})(window.SH = window.SH || {});
