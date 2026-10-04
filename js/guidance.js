/* Guidance & control logic (port of sim.py v2 + web-app extensions: configurable boostback engine set and cutoff,
   engine-failure injection and compensation, centre-engine substitution in the hover-slam, optional entry burn).
   Operates on the mutable sim state object `s` built in sim.js. */
(function (SH) {
  "use strict";
  const { CENTRE, INNER, OUTER } = SH;
  const clip = SH.clip, wrap = SH.wrap, D2R = Math.PI / 180;
  const ALL = Array.from({ length: 33 }, (_, i) => i);
  const FAIL_ORDER = { centre: [0, 1, 2], inner: [6, 11, 4, 9, 3, 8, 5, 10, 7, 12], outer: [13, 23, 18, 28, 15, 25, 20, 30] };

  function bbSet(n) { return n === 3 ? CENTRE.slice() : n === 33 ? ALL.slice() : CENTRE.concat(INNER); }

  function scheduleFailures(s, ring, n, tFail, candidates, label) {
    if (n <= 0) return;
    const lit = new Set(candidates);
    const pick = FAIL_ORDER[ring].filter(i => lit.has(i) && !s.eng.dead[i]).slice(0, n);
    if (pick.length < n) s.events.push([s.t, `${label}: only ${pick.length} of ${n} requested ${ring}-ring engines are lit`]);
    for (const i of pick) s.eng.failAt.set(i, tFail);
  }

  SH.guidanceStep = function (s) {
    const p = s.p, M = s.M, eng = s.eng, t = s.t;
    // ---------------- FLIP
    if (s.phase === "FLIP") {
      s.thr_cmd = 0.5; s.th_cmd = -88 * D2R;
      if (Math.abs(wrap(s.th_cmd - s.th)) < 25 * D2R) {
        s.phase = "BOOSTBACK"; s.t_bb = t;
        s.bbSet = bbSet(p.bb_engines);
        s.events.push([t, `Boostback burn start (${p.bb_engines} engines, staggered)`]);
        if (p.bb_engines >= 13) { eng.command_start(INNER.slice(0, 5), t, 0.0); eng.command_start(INNER.slice(5), t, p.stagger_boostback_s); }
        if (p.bb_engines === 33) { eng.command_start(OUTER.slice(0, 10), t, 2 * p.stagger_boostback_s); eng.command_start(OUTER.slice(10), t, 3 * p.stagger_boostback_s); }
        scheduleFailures(s, p.bb_fail_ring, p.bb_fail_n, t + p.bb_fail_t, s.bbSet, "Boostback failure");
      }
    }
    // ---------------- BOOSTBACK
    if (s.phase === "BOOSTBACK") {
      s.th_cmd = -88 * D2R;
      const nB = s.bbSet.length;
      const n_av = Math.max(eng.available(s.bbSet).length, 1);
      const thr_cap = p.boostback_g_max * SH.G0 * s.m / (nB * s.Tmax1);
      let cut = false;
      if (p.bb_cutoff === "fixed duration") {
        s.thr_cmd = Math.min(thr_cap, 1.0) * nB / n_av;
        if (t >= s.next_pred) { s.x_pred = M.predict_impact(s.x, s.y, s.vx, s.vy, s.m, s.y_stop_pred); s.next_pred = t + 0.5; }
        cut = t - s.t_bb >= p.bb_fixed_s;
      } else {
        if (t >= s.next_pred) {
          s.x_pred = M.predict_impact(s.x, s.y, s.vx, s.vy, s.m, s.y_stop_pred);
          const e0 = s.x_pred - p.x_aim_offshore_m;
          s.next_pred = t + (e0 > 20e3 ? 0.5 : 0.0);
        }
        const err = s.x_pred - p.x_aim_offshore_m;
        s.thr_cmd = Math.min(thr_cap, err > 15e3 ? 1.0 : Math.max(p.throttle_min, err / 15e3)) * nB / n_av;
        cut = err <= 0;
        if (t - s.t_bb > 240) cut = true;                       // safety: never burn forever
      }
      if (eng.available(s.bbSet).length === 0) cut = true;
      if (cut) {
        s.phase = "COAST";
        eng.command_stop(s.bbSet, t);
        for (const tk of s.tanks) tk.zpd += p.cutoff_rebound_mps;
        s.events.push([t, "Boostback cutoff"]);
      }
    }
    // ---------------- ENTRY BURN (optional)
    if (s.phase === "COAST" && p.entry_burn && !s.entry_done && s.vy < 0 && s.yb < p.entry_burn_alt_m) {
      if (s.tanks.every(tk => tk.settled)) {
        s.phase = "ENTRYBURN"; s.ullage = false; s.v_entry0 = s.V;
        eng.command_start(CENTRE, t, 0.0);
        s.events.push([t, `Entry burn start (3 centre engines, target Δv ${p.entry_burn_dv.toFixed(0)} m/s)`]);
      } else {
        s.ullage = true;
        if (!s.ullage_logged_entry) { s.events.push([t, "Propellant unsettled: RCS ullage settling burn before entry-burn relight"]); s.ullage_logged_entry = true; }
      }
    }
    if (s.phase === "ENTRYBURN") {
      s.th_cmd = s.V > 1 ? Math.atan2(-(s.vx - s.Um), -s.vy) : 0.0;
      s.thr_cmd = 1.0;
      const done = s.V <= s.v_entry0 - p.entry_burn_dv || s.yb < 12000 || eng.available(CENTRE).length === 0;
      if (done) {
        eng.command_stop(CENTRE, t); s.entry_done = true; s.phase = "COAST";
        s.events.push([t, `Entry burn cutoff (Δv ${(s.v_entry0 - s.V).toFixed(0)} m/s)`]);
      }
    }
    // ---------------- COAST / GLIDE
    if (s.phase === "COAST" || s.phase === "GLIDE") {
      s.thr_cmd = 0.0;
      s.th_cmd = s.V > 1 ? Math.atan2(-(s.vx - s.Um), -s.vy) : 0.0;
      if (s.phase === "GLIDE") s.th_cmd += s.aoa_cmd;
      if (s.phase === "COAST" && s.vy < 0 && s.qdyn > 1000) { s.phase = "GLIDE"; s.events.push([t, "Entry: grid-fin glide (q > 1 kPa)"]); }
      if (t >= s.next_pred) { s.x_pred = M.predict_impact(s.x, s.y, s.vx, s.vy, s.m, s.y_stop_pred); s.next_pred = t + 1.0; }
      if (s.phase === "GLIDE") {
        s.aoa_cmd = p.aoa_nom + clip(-6 * D2R * (p.x_aim_offshore_m - s.x_pred) / 400.0, -8 * D2R, 8 * D2R);
        const vg = p.v_gate_mps, hpg = vg * vg / (2 * p.landing_decel_B);
        let hq = s.hp, vq = s.vy, vxq = s.vx;
        if (p.lag_comp) {
          const nstep = 10, dtq = s.t_lag / nstep;
          for (let k = 0; k < nstep; k++) {
            const [rq, , aq] = SH.atmosphere(Math.max(s.yb + (hq - s.hp), 0));
            const Fq = M.aero(vxq - s.Um, vq, s.th, rq, Math.hypot(vxq - s.Um, vq) / aq, false);
            vq += (Fq[1] / s.m - s.g) * dtq; vxq += Fq[0] / s.m * dtq;
            hq += vq * dtq;
          }
        }
        const dh = hq - hpg;
        const n13 = Math.max(eng.healthy(CENTRE.concat(INNER)).length, 1);
        let ignite = false;
        if (dh > 1 && vq < -vg) {
          const a_req = (vq * vq - vg * vg) / (2 * dh);
          const rq = SH.atmosphere(Math.max(s.yb + (hq - s.hp), 0))[0];
          const a_drag = 0.5 * rq * vq * vq * M.cd(Math.abs(vq) / s.a_snd) * M.A_END / s.m;
          const need = s.m * (a_req + s.g - 0.3 * a_drag) / (n13 * s.Tmax1);
          ignite = need >= p.ign_need_threshold;
        } else if (dh <= 1 && s.vy < -1) ignite = true;              // late: light immediately (best effort)
        if (ignite) {
          if (s.tanks.every(tk => tk.settled)) {
            s.phase = "LANDING13"; s.ullage = false;
            // forced relight failures (spread across the inner ring, then centre)
            const forced = [3, 8, 5, 10, 7, 12, 0, 1, 2].filter(i => !eng.dead[i]).slice(0, p.relight_fail_n);
            for (const i of forced) eng.forced_bad[i] = 1;
            eng.command_start(CENTRE, t, 0.0);
            eng.command_start(INNER.slice(0, 5), t, p.stagger_landing_s);
            eng.command_start(INNER.slice(5), t, 2 * p.stagger_landing_s);
            const lit = eng.healthy(CENTRE.concat(INNER)).length;
            s.events.push([t, `Landing burn start command (${lit} engines, staggered)`]);
            Object.assign(s.ign, { t_cmd: t, alt_cmd: s.yb, v_cmd: s.V, hp_pred: hq, vy_pred: vq });
            scheduleFailures(s, p.lb_fail_ring, p.lb_fail_n, t + p.lb_fail_t, eng.healthy(CENTRE.concat(INNER)), "Landing-burn failure");
          } else {
            s.ullage = true;
            if (!s.settle_wait_logged) { s.events.push([t, "Propellant unsettled: RCS ullage settling burn before relight"]); s.settle_wait_logged = true; }
          }
        }
      }
    }
    // ---------------- LANDING (13 engines)
    if (s.phase === "LANDING13") {
      const vg = p.v_gate_mps, hpg = vg * vg / (2 * p.landing_decel_B);
      const dh = Math.max(s.hp - hpg, 1.0);
      const a_req = Math.max((s.vy * s.vy - vg * vg) / (2 * dh), 0.0);
      const tgo = 2 * Math.max(s.hp - hpg, 0.0) / (Math.max(-s.vy, 1.0) + vg) + Math.sqrt(2 * hpg / p.landing_decel_B);
      const vx_des = -s.x / Math.max(0.6 * tgo, 3.0);
      let ax_c = (vx_des - s.vx) / 2.0 - s.aero_ax;
      const ay_c = Math.max(a_req + s.g - 0.5 * s.qdyn * M.cd(s.Mach) * M.A_END / s.m, 0.3 * s.g);
      const tl = Math.tan(25 * D2R);
      ax_c = clip(ax_c, -ay_c * tl, ay_c * tl);
      s.th_cmd = Math.atan2(ax_c, ay_c);
      s.F_req = s.m * Math.hypot(ax_c, ay_c);
      if (s.ign.t_full === undefined) {
        let sp = 0; for (let i = 0; i < 13; i++) sp += eng.spool[i];
        const nh = Math.max(eng.healthy(CENTRE.concat(INNER)).length, 1);
        if (sp >= 0.9 * nh) Object.assign(s.ign, { t_full: t, alt_full: s.yb, v_full: s.V });
      }
      if (-s.vy <= Math.sqrt(2 * p.landing_decel_B * Math.max(s.hp, 0)) + 0.5 || s.hp < hpg) {
        s.phase = "LANDING3";
        // keep 3 healthy engines: centre first, substitute healthy inner engines for failed centre ones
        const keep = eng.available(CENTRE);
        const subs = eng.available(INNER).sort((a, b) => Math.abs(eng.u[a]) - Math.abs(eng.u[b])).slice(0, Math.max(0, 3 - keep.length));
        s.subs = subs;
        eng.command_stop(INNER.filter(i => !subs.includes(i)), t);
        s.events.push([t, subs.length ? `Shutdown to 3 engines (hover-slam; ${subs.length} inner engine(s) replace failed centre)` : "Shutdown to 3 centre engines (hover-slam)"]);
      }
    }
    // ---------------- LANDING (3 engines, hover-slam) + catch
    if (s.phase === "LANDING3") {
      const set3 = CENTRE.concat(s.subs || []);
      if (eng.available(set3).length < 3 && s.hp > 5 && !s.prop_out && !s.shed_any) {        // a hover engine died: relight a healthy inner engine
        const cand = INNER.filter(i => !eng.dead[i] && !set3.includes(i) && (eng.state[i] === SH.ENG.OFF || eng.state[i] === SH.ENG.STOPPING));
        const need = 3 - eng.available(set3).length - set3.filter(i => eng.state[i] === SH.ENG.STARTING && !eng.start_bad[i]).length;
        if (need > 0 && cand.length) {
          const pick = cand.slice(0, need);
          s.subs = (s.subs || []).concat(pick);
          eng.command_start(pick, t, 0.0);
          s.events.push([t, `Relighting inner engine(s) ${pick.map(i => i + 1).join(", ")} to restore 3-engine hover`]);
        }
      }
      const aB = p.landing_decel_B, hpc = Math.max(s.hp, 0.0);
      let v_cmd = -(0.3 + Math.min(Math.sqrt(2 * aB * hpc), 0.6 * hpc));
      let a_ff = Math.sqrt(2 * aB * hpc) < 0.6 * hpc ? aB : 0.6 * 0.6 * hpc;
      // best effort: if still badly off-axis near the rails, slow to a hover above them and translate first
      if (p.v3 && s.arm_t0 === null && s.hp < 30 && Math.abs(s.xp) > 4.0) {
        const vh = s.hp > 8 ? -1.0 : 0.0;
        if (v_cmd < vh) { v_cmd = vh; a_ff = 0; }
        if (!s.hover_hold_logged) { s.hover_hold_logged = true; s.events.push([t, `Hover-hold: ${Math.abs(s.xp).toFixed(1)} m off axis, translating before closing arms`]); }
      }
      const ay_c = Math.max(s.g + a_ff + 2.0 * (v_cmd - s.vy) - s.qdyn * M.cd(s.Mach) * M.A_END / s.m, 0.3 * s.g);
      // best effort: allow a faster divert when far off the tower axis (baseline |x| < 40 m keeps the v2 law)
      const vmax = Math.abs(s.x) < 40 ? 5.0 : Math.min(5.0 + (Math.abs(s.x) - 40) / 8, 25.0);
      const vx_des = clip(-s.x / 4.0, -vmax, vmax);
      let ax_c = (vx_des - s.vx) / 3.0 - s.aero_ax;
      if (s.arm_gap < 7.0) ax_c = 0.0;
      const lim = ay_c * Math.tan((vmax > 5 ? 15 : 8) * D2R);
      ax_c = clip(ax_c, -lim, lim);
      s.th_cmd = Math.atan2(ax_c, Math.max(ay_c, 0.1));
      s.F_req = s.m * Math.hypot(ax_c, ay_c);
      // best effort: if the 3-engine throttle floor exceeds what is needed (light booster hovering), shed one engine
      const runN = eng.available(set3).filter(i => eng.state[i] === SH.ENG.RUNNING);
      let Tmin = 0; for (const i of runN) Tmin += eng.disp[i] * s.Tmax1 * p.throttle_min;
      if (p.v3 && runN.length > 2 && s.hp < 40 && s.F_req < 0.92 * Tmin) {
        s.shed_t = (s.shed_t || 0) + 0.005;
        if (s.shed_t > 1.0) {
          const off = runN.sort((a, b) => Math.abs(eng.u[b]) - Math.abs(eng.u[a]))[0];
          eng.command_stop([off], t); s.shed_t = 0; s.shed_any = true;
          s.events.push([t, `Throttle floor above demand: engine ${off + 1} shut down (2-engine hover)`]);
        }
      } else s.shed_t = 0;
      if (s.gust_t0 === null && s.hp < p.gust_trigger_hp_m) {
        s.gust_t0 = t; s.events.push([t, `Discrete 1-cosine gust ${Math.abs(p.gust_amp_mps).toFixed(0)} m/s`]);
      }
      if (s.arm_t0 === null && s.hp < 18.0) {
        if (!p.v3 || Math.abs(s.xp) < 6.0) { s.arm_t0 = t; s.events.push([t, "Chopsticks closing"]); }
        else if (!s.arm_hold_logged) { s.arm_hold_logged = true; s.events.push([t, `Arms held open: booster ${Math.abs(s.xp).toFixed(1)} m off axis`]); }
      }
      if (s.hp <= 0.0 && (Math.abs(s.xp) > s.arm_gap - M.D / 2 + 0.5 || s.arm_gap > 6.0)) {
        if (!s.missed) {
          s.missed = true; s.miss_info = { t, x: s.xp, arm_gap: s.arm_gap, vy: s.vy };
          const onArm = Math.abs(s.xp) < s.arm_gap + 30 + M.D / 2;
          s.miss_info.onArm = onArm;
          s.events.push([t, onArm ? "MISS - booster strikes the chopstick arms" : "MISS"]);
          s.end_time = t + (onArm ? 0.5 : 3.0);
        }
      } else if (s.hp <= 0.0 && !s.missed) {
        s.phase = "CAUGHT"; s.caught = true;
        s.contact = { t, vy: s.vy, vx: s.vx, x: s.x, th: s.th * 180 / Math.PI, m_prop: s.tanks.reduce((a, tk) => a + tk.m, 0), arm_gap: s.arm_gap };
        s.events.push([t, "Catch pins contact arms - engine cutoff"]);
        eng.command_stop(ALL, t);
        s.end_time = t + 6.0;
      }
    }
  };
})(window.SH = window.SH || {});
