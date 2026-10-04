/* Simulation loop (port of sim.py v2 simulate()), logging, outcome classification and summary.
   SH.simulate(settings) -> result {log, events, summary, outcome, p}.  Always terminates (time & step caps, NaN guard). */
(function (SH) {
  "use strict";
  const { CENTRE, INNER } = SH, E = SH.ENG;
  const clip = SH.clip, wrap = SH.wrap, G0 = SH.G0, D2R = Math.PI / 180;
  const PHASES = ["FLIP", "BOOSTBACK", "COAST", "ENTRYBURN", "GLIDE", "LANDING13", "LANDING3", "CAUGHT"];
  SH.PHASES = PHASES;
  const LOGK = ["t", "x", "y", "xb", "yb", "vx", "vy", "th", "thc", "m", "n", "thr", "thr_cmd", "T", "q", "M", "g_load",
    "arm_gap", "phase", "Fc", "gimbal", "fin", "aoa", "heat", "wind_mean", "wind_turb_u", "wind_turb_w", "wind_gust",
    "wind_x", "airspeed", "lox_psi1", "lox_psi2", "ch4_psi1", "ch4_psi2", "lox_wave", "ch4_wave", "lox_qs", "ch4_qs",
    "lox_F", "ch4_F", "lox_zp", "ch4_zp", "lox_h", "ch4_h", "lox_f1", "ch4_f1", "lox_zeta", "ch4_zeta",
    "lox_settled", "ch4_settled", "lox_m", "ch4_m", "ullage", "tau_asym", "tau_aero", "tau_slosh", "xpred",
    "cg", "Iyy", "loxL_m", "ch4L_m", "loxL_psi1", "ch4L_psi1", "loxL_wave", "ch4L_wave", "loxL_h", "ch4L_h", "loxL_zp", "ch4L_zp",
    "lox_geff", "vent_o", "vent_f", "F_vent", "feed", "isolated", "lox_ms", "ch4_ms"];
  SH.LOGK = LOGK;

  SH.simulate = function (settings, opts) {
    opts = opts || {};
    const p = SH.buildParams(settings);
    const M = SH.makeModel(p);
    const L = M.L, D = M.D; let LCG = M.LCG; const V3 = !!p.v3;
    const dt = 0.005, log_dt = 0.05, T_MAX = 900;
    const rng = new SH.RNG(p.turb_seed), rng_turb = new SH.RNG(p.turb_seed + 1);
    const s = { p, M, events: [[0.0, "Hot staging / separation, flip on 3 centre engines"]], ign: {} };
    s.m = p.m_dry_kg + p.m_prop_stage_kg;
    s.lox = new SH.Tank(M, "LOX", p.m_prop_stage_kg * M.F_LOX, p.rho_lox, p.nu_lox, p.lox_tank_bottom_m, p.lox_tank_top_m);
    s.ch4 = new SH.Tank(M, "CH4", p.m_prop_stage_kg * (1 - M.F_LOX), p.rho_ch4, p.nu_ch4, p.ch4_tank_bottom_m, p.ch4_tank_top_m);
    s.tanks = [s.lox, s.ch4];
    // ---- v3: Block 3 internals -- LOX landing tank + CH4 transfer-tube landing column, domed main tanks, CG shift
    const zDry = (p.m_dry_kg - p.m_eng_total_kg) * L / 2, m_rod = p.m_dry_kg - p.m_eng_total_kg;
    s.isolated = false; s.feed = 0; s.vent_o = 0; s.vent_f = 0; s.F_vent = 0; s.vent_left_o = 0; s.vent_left_f = 0; s.ingest_t = 0;
    const mainNames = { lox: "LOX", ch4: "CH4" };
    if (V3) {
      const TL = s.layout = SH.makeTankLayout(p);
      const mO = p.m_prop_stage_kg * M.F_LOX, mF = p.m_prop_stage_kg * (1 - M.F_LOX);
      const lO = p.landing_tanks ? Math.min(TL.loxLand.Vcap * p.rho_lox * 0.999, mO) : 0;
      const lF = p.landing_tanks ? Math.min(TL.ch4Land.Vcap * p.rho_ch4 * 0.999, mF) : 0;
      s.lox = new SH.Tank(M, "LOX", mO - lO, p.rho_lox, p.nu_lox, TL.loxMain.zb, TL.loxMain.zt, TL.loxMain);
      s.ch4 = new SH.Tank(M, "CH4", mF - lF, p.rho_ch4, p.nu_ch4, TL.ch4Main.zb, TL.ch4Main.zt, TL.ch4Main);
      s.loxL = new SH.Tank(M, "LOXL", lO, p.rho_lox, p.nu_lox, TL.loxLand.zb, TL.loxLand.zt, TL.loxLand);
      s.ch4L = new SH.Tank(M, "CH4L", lF, p.rho_ch4, p.nu_ch4, TL.ch4Land.zb, TL.ch4Land.zt, TL.ch4Land);
      s.tanks = [s.lox, s.ch4, s.loxL, s.ch4L];
    }
    // mass properties (v3): CG station and pitch inertia about the CG from dry structure + every liquid
    const massProps = () => {
      let m = p.m_dry_kg, mz = zDry + p.m_eng_total_kg * p.z_eng_m;
      const parts = [];
      for (const tk of s.tanks) { const [zc, Izz] = tk.geom.mass_props(tk.m / tk.rho); const z = zc + tk.zp; parts.push([tk.m, z, Izz]); m += tk.m; mz += tk.m * z; }
      const cg = mz / m;
      let I = m_rod * (L * L / 12 + (L / 2 - cg) ** 2) + p.m_eng_total_kg * (p.z_eng_m - cg) ** 2;
      for (const [mi, z, Izz] of parts) I += mi * ((z - cg) ** 2 + Izz + p.R_tank_m ** 2 / 4 * 0.5);
      return [cg, I];
    };
    if (V3) { const [cg0, I0] = massProps(); LCG = M.LCG = cg0; s.I = I0; }
    const eng = s.eng = new SH.Engines(M, rng);
    s.th = Math.atan2(p.vx0_mps, p.vy0_mps); let om = 0.0, omd_prev = 0.0;
    s.x = p.x0_m + LCG * Math.sin(s.th); s.y = p.y0_m + LCG * Math.cos(s.th);
    s.vx = p.vx0_mps; s.vy = p.vy0_mps;
    s.t = 0.0; s.phase = "FLIP"; s.thr_cmd = 0.5; let thr_slew = 0.5, thr = 0.5; s.th_cmd = s.th;
    s.aoa_cmd = 0.0; s.x_pred = NaN; s.next_pred = 0.0;
    s.arm_gap = p.arm_gap_open_m; s.arm_t0 = null; s.caught = false; s.contact = null; s.missed = false;
    s.y_stop_pred = p.arm_top_m - p.l_pins_m; s.end_time = null;
    s.t_lag = M.spool_lag_equiv + p.stagger_landing_s * 4 / 13;
    s.ign.t_lag_equiv_s = s.t_lag; s.ign.lag_comp = p.lag_comp;
    let tu = 0, tw1 = 0, tw2 = 0, att_int = 0; s.gust_t0 = null;
    let a_x_prev = (0.5 * 3 * M.thrust_one(0.0)) / s.m, a_n_prev = 0.0;
    s.ullage = false; s.F_req = 0;
    const k_arm = p.k_arm_N_per_m;
    const log = {}; for (const k of LOGK) log[k] = [];
    const spoolLog = [], stateLog = [];
    let next_log = 0.0;
    let prop_out_t = null, g_fail = null, max_g = 0, max_Fc = 0, max_tilt_low = 0, nan = false, timeout = false;
    let steps = 0;
    // ---- v3 feed logic: which tank each propellant comes from, switch-overs, gas-ingestion risk
    const mainOK = tk => tk.m > 1 && tk.settled && (tk.h - Math.abs(tk.wave)) > p.ingest_h_crit_m;
    const fedFrom = { LOX: null, CH4: null };
    function feed(used, phase, t, nlit) {
      if (used <= 0) return;
      const landing = phase === "LANDING13" || phase === "LANDING3";
      const srcs = [[s.lox, s.loxL, used * M.F_LOX, "LOX"], [s.ch4, s.ch4L, used * (1 - M.F_LOX), "CH4"]];
      let code = 0, risky = false;
      for (const [mainT, landT, need, nm] of srcs) {
        let order;
        if (!s.isolated) order = mainOK(mainT) || landT.m <= 1 ? [mainT, landT] : [landT, mainT];      // landing tank stays topped off
        else if (landing) order = landT.m > 1 ? [landT, mainT] : [mainT];
        else order = mainOK(mainT) || landT.m <= 1 ? [mainT, landT] : [landT, mainT];                    // entry burn: residuals first
        let rem = need;
        for (const tk of order) { const d = Math.min(rem, tk.m); tk.m -= d; rem -= d; if (d > 0 && tk === order[0]) { /* primary */ } if (rem <= 1e-9) break; }
        const primary = order.find(tk => tk.m > 0) || order[0];
        const isLand = primary === landT;
        if (isLand) code |= nm === "LOX" ? 1 : 2;
        const key = isLand ? "landing" : "main";
        if (fedFrom[nm] !== key) {
          if ((fedFrom[nm] !== null || isLand) && phase !== "COAST" && phase !== "CAUGHT" && phase !== "GLIDE") s.events.push([t, isLand ? `${nm} feed: ${nm === "LOX" ? "LOX landing tank" : "CH4 transfer-tube column"}${!s.isolated ? " (main tank low - eating landing reserve)" : ""}` : `${nm} feed switched to MAIN tank${landing ? " (landing reserve exhausted - ingestion risk)" : ""}`]);
          fedFrom[nm] = key;
        }
        if (!isLand && !mainOK(mainT) && nlit > 0) risky = true;
      }
      s.feed = code;
      if (risky) s.ingest_t += dt; else s.ingest_t = Math.max(s.ingest_t - dt, 0);
      if (s.ingest_t > p.ingest_t_crit_s && !s.ingested) {
        s.ingested = true;
        const lit = []; for (let i = 0; i < 33; i++) if (eng.state[i] === E.STARTING || eng.state[i] === E.RUNNING) lit.push(i);
        for (const i of lit) { eng.dead[i] = 1; eng.start_bad[i] = 1; }
        eng.command_stop(lit, t);
        s.events.push([t, `GAS INGESTION: main-tank level/slosh uncovered the outlet - ${lit.length} engine(s) flamed out`]);
      }
    }

    let _pk = 0;
    while (true) {
      if (opts.onProgress && ++_pk % 4000 === 0) opts.onProgress(s.t);   // UI progress only; no effect on the integration
      if (V3) {   // CG migrates as propellant drains / moves: keep the body continuous, move the CG inside it
        const [cg, I3] = massProps(); const d = cg - LCG;
        s.x += d * Math.sin(s.th); s.y += d * Math.cos(s.th); LCG = M.LCG = cg; s.I = I3;
      }
      const t = s.t, th = s.th;
      const a0 = Math.sin(th), a1 = Math.cos(th), n0 = Math.cos(th), n1 = -Math.sin(th);
      const x = s.x, y = s.y, vx = s.vx, vy = s.vy;
      s.xb = x - LCG * a0; s.yb = y - LCG * a1;
      s.xp = x + (p.l_pins_m - LCG) * a0; const yp = y + (p.l_pins_m - LCG) * a1;
      s.hp = yp - p.arm_top_m;
      const [rho, pr, a_snd] = SH.atmosphere(s.yb); s.a_snd = a_snd;
      s.g = SH.gravity(y);
      const m = s.m, m_prop = s.lox.m + s.ch4.m;
      s.Tmax1 = M.thrust_one(pr);
      // ---- wind
      const h_w = Math.max(y, 0.5);
      const Um = h_w < 85000 ? M.wind_mean(h_w) : 0.0; s.Um = Um;
      const Vr_prev = Math.max(Math.hypot(vx - Um - tu, vy - tw2), 10.0);
      let w_turb;
      if (h_w < 25000) {
        let [su, sw, Lu, Lw] = M.dryden(h_w);
        Lw = Math.max(Lw, 5.0); Lu = Math.max(Lu, 5.0);
        const tau_u = Lu / Vr_prev, tau_w = Lw / Vr_prev;
        tu += (-tu / tau_u) * dt + su * Math.sqrt(2 * dt / tau_u) * rng_turb.normal();
        const q_w = sw * sw * tau_w;
        const nw = Math.sqrt(q_w / dt) * rng_turb.normal();
        tw1 += (nw - tw1) / tau_w * dt;
        tw2 = tw2 + (tw1 - tw2) / tau_w * dt;
        w_turb = tw2 + Math.sqrt(3) * (tw1 - tw2);
      } else { tu *= 0.999; w_turb = 0.0; tw1 *= 0.999; tw2 *= 0.999; }
      let ug = 0.0;
      if (s.gust_t0 !== null && t - s.gust_t0 <= p.gust_dur_s)
        ug = 0.5 * p.gust_amp_mps * (1 - Math.cos(2 * Math.PI * (t - s.gust_t0) / p.gust_dur_s));
      const wx = Um + tu + ug, wy = w_turb;
      const vrx = vx - wx, vry = vy - wy;
      s.V = Math.hypot(vx, vy); const Vr = Math.hypot(vrx, vry);
      s.qdyn = 0.5 * rho * Vr * Vr; s.Mach = Vr / a_snd;
      const fa = M.aero(vx - Um, vy, th, rho, Math.hypot(vx - Um, vy) / a_snd, false);
      s.aero_ax = fa[0] / m;
      // ---- guidance
      const phPrev = s.phase;
      SH.guidanceStep(s);
      const phase = s.phase;
      if (V3 && !s.isolated && phPrev === "BOOSTBACK" && phase !== "BOOSTBACK") {
        s.isolated = true;
        const rO = s.lox.m, rF = s.ch4.m;
        s.events.push([t, p.landing_tanks ? `Landing tanks isolated: LOX landing tank ${(s.loxL.m / 1e3).toFixed(1)} t, CH4 tube column ${(s.ch4L.m / 1e3).toFixed(1)} t; main residuals LOX ${(rO / 1e3).toFixed(1)} t / CH4 ${(rF / 1e3).toFixed(1)} t`
          : `No landing tanks: landing burn will draw on main-tank residuals LOX ${(rO / 1e3).toFixed(1)} t / CH4 ${(rF / 1e3).toFixed(1)} t`]);
        const f = p.vent_mode === "vent all" ? 1 : p.vent_mode === "vent some" ? p.vent_pct / 100 : 0;
        if (!p.landing_tanks) { s.vent_left_o = 0; s.vent_left_f = 0; } else { s.vent_left_o = rO * f; s.vent_left_f = rF * f; }
        if (f > 0 && p.landing_tanks) s.events.push([t + 2, `Venting ${(100 * f).toFixed(0)}% of main-tank residuals (${((s.vent_left_o + s.vent_left_f) / 1e3).toFixed(1)} t)`]);
      }
      s.vent_o = s.vent_f = s.F_vent = 0; s.vent_ullage = false;
      if (V3 && s.isolated && (s.vent_left_o > 1 || s.vent_left_f > 1) && t > (s.vent_t0 = s.vent_t0 ?? t + 2)) {
        const settled = s.lox.settled && s.ch4.settled && s.lox.geff > 0.05;
        s.vent_ullage = !settled && phase === "COAST";           // settle with the cold-gas thrusters so liquid, not gas, goes out
        const k = settled ? 1 : 0.08;                            // unsettled: mostly ullage gas leaves
        s.vent_o = Math.min(p.vent_rate_lox * k, s.vent_left_o / dt, s.lox.m / dt);
        s.vent_f = Math.min(p.vent_rate_ch4 * k, s.vent_left_f / dt, s.ch4.m / dt);
        s.F_vent = (s.vent_o + s.vent_f) * p.vent_ve_mps;
        if (s.vent_left_o - s.vent_o * dt <= 1 && s.vent_left_f - s.vent_f * dt <= 1) s.events.push([t, "Main-tank vent complete"]);
      }
      // ---- throttle allocation over producing engines
      let T_unit = 0.0;
      for (let i = 0; i < 33; i++) { const st = eng.state[i]; if (st === E.STARTING || st === E.RUNNING || st === E.STOPPING) T_unit += eng.disp[i] * eng.spool[i]; }
      T_unit *= s.Tmax1;
      const landing = phase === "LANDING13" || phase === "LANDING3";
      if (landing) s.thr_cmd = T_unit > 1e3 ? s.F_req / T_unit : 1.0;
      const offPh = phase === "COAST" || phase === "GLIDE" || phase === "CAUGHT";
      s.thr_cmd = !offPh ? clip(s.thr_cmd, p.throttle_min, p.throttle_max) : Math.max(s.thr_cmd, 0.0);
      const thr_cmd_log = s.thr_cmd;
      if (offPh) s.thr_cmd = Math.max(thr_slew, p.throttle_min);
      const dmax = p.throttle_rate_per_s * dt;
      thr_slew += clip(s.thr_cmd - thr_slew, -dmax, dmax);
      thr += (thr_slew - thr) * Math.min(dt / p.throttle_tau_s, 1.0);
      const start_loss = eng.step(t, dt);
      for (const e of eng.log_events) s.events.push(e);
      eng.log_events = [];
      if (V3 ? (s.lox.m + s.loxL.m <= 1 || s.ch4.m + s.ch4L.m <= 1) : m_prop <= 0) {
        eng.command_stop(Array.from({ length: 33 }, (_, i) => i), t);
        s.prop_out = true;
        if (prop_out_t === null) { prop_out_t = t; s.events.push([t, "PROP OUT"]); }
      }
      let T = 0, Tg = 0, tau_asym = 0, nlit = 0;
      for (let i = 0; i < 33; i++) {
        const Ti = s.Tmax1 * eng.disp[i] * eng.spool[i] * thr;
        T += Ti; if (i < 13) Tg += Ti; tau_asym -= eng.u[i] * Ti;
        if (eng.spool[i] > 0.05) nlit++;
      }
      // ---- attitude
      let ms_act = 0; for (const tk of s.tanks) ms_act += tk.ms_active;
      const m_r = m - ms_act;
      const I = V3 ? s.I : m * (L * L / 12 + (L / 2 - LCG) ** 2);
      const err = wrap(s.th_cmd - th);
      const wmax = (landing ? 15 : (phase === "FLIP" || phase === "COAST" ? 12 : 8)) * D2R;
      const [kw, kt] = phase === "LANDING13" ? [2.0, 5.0] : phase === "LANDING3" ? [1.2, 2.5] : [1.0, 2.0];
      const tau_g_max = Tg * Math.sin(p.gimbal_max_deg * D2R) * LCG;
      const tau_f_max = s.qdyn * p.fin_area_m2 * 0.6 * (p.l_fins_m - LCG) * p.fin_authority;
      const alpha_av = 0.6 * (tau_g_max + tau_f_max + p.tau_rcs_Nm) / I;
      const w_brake = Math.sqrt(2 * alpha_av * Math.abs(err));
      const om_des = Math.sign(err) * Math.min(kw * Math.abs(err), wmax, w_brake) || 0;
      const tau_ff = phase !== "CAUGHT" ? -M.aero(vx - Um, vy, th, rho, Math.hypot(vx - Um, vy) / a_snd, true)[2] : 0.0;
      if (phase === "GLIDE" || landing || phase === "BOOSTBACK" || phase === "COAST" || phase === "ENTRYBURN") att_int = clip(att_int + err * dt, -0.05, 0.05);
      else att_int = 0.0;
      const tau_des = I * kt * (om_des - om) + tau_ff + I * 0.6 * att_int;
      let tau_g = clip(tau_des, -tau_g_max, tau_g_max);
      const rem = tau_des - tau_g;
      let tau_fin = clip(rem, -tau_f_max, tau_f_max);
      let tau_rcs = clip(rem - tau_fin, -p.tau_rcs_Nm, p.tau_rcs_Nm);
      if (phase === "CAUGHT") tau_g = tau_fin = tau_rcs = 0.0;
      let sin_d = Tg > 1 ? tau_g / (Tg * LCG) : 0.0;
      sin_d = Math.max(-1.0, Math.min(1.0, sin_d));
      const gimbal = Math.asin(sin_d) / D2R;
      // ---- forces
      const cos_d = Math.sqrt(Math.max(0.0, 1 - sin_d * sin_d));
      let F_ax = (T - Tg) + Tg * cos_d, F_n = -Tg * sin_d;
      const [Fa_x, Fa_y, tau_aero] = M.aero(vrx, vry, th, rho, s.Mach, true);
      F_ax += Fa_x * a0 + Fa_y * a1;
      F_n += Fa_x * n0 + Fa_y * n1;
      F_n += tau_fin / (p.l_fins_m - LCG);
      if (s.ullage || s.vent_ullage) F_ax += p.F_ullage_N;
      if (s.F_vent > 0) { F_ax += 0.3 * s.F_vent; F_n += 0.05 * s.F_vent; }   // vent ports: mostly cancelling side pairs (estimate)
      let Fc = 0, tau_c = 0, Fcx = 0, Fcy = 0;
      if (s.arm_t0 !== null) {
        let frac = Math.min((t - s.arm_t0) / p.arm_close_time_s, 1.0);
        frac = 0.5 - 0.5 * Math.cos(Math.PI * frac);
        s.arm_gap = p.arm_gap_open_m + (p.arm_gap_closed_m - p.arm_gap_open_m) * frac;
      }
      if (s.arm_t0 !== null && s.yb < p.arm_top_m && p.arm_top_m < s.yb + L * Math.cos(th)) {
        const lev = p.arm_top_m - y;
        const x_at = x + lev * Math.tan(th);
        const pen = Math.abs(x_at) + D / 2 - s.arm_gap;
        // bumper contact only when the booster is actually between the arms (not beside / outside them)
        if (pen > 0 && Math.abs(x_at) - D / 2 < s.arm_gap + 1.0) {
          const kb = 1.5e6, cb = 2 * 1.5 * Math.sqrt(kb * m);
          const F_bump = -Math.sign(x_at) * kb * pen - cb * (vx + om * lev);
          Fcx += F_bump; tau_c += F_bump * lev;
        }
      }
      if (s.hp < 0 && Math.abs(s.xp) < 3.0 && s.caught) {
        const vyp = vy - om * (p.l_pins_m - LCG) * Math.sin(th);
        const c = 2 * p.zeta_arm * Math.sqrt(k_arm * m);
        Fc = Math.max(0.0, -k_arm * s.hp - c * vyp);
        Fcy += Fc;
        const dx = s.xp, slack = s.arm_gap - D / 2;
        if (Math.abs(dx) > slack) Fcx += -k_arm * (dx - Math.sign(dx) * slack);
        Fcx += -2 * 0.5 * Math.sqrt(k_arm * m) * vx * 0.2;
        const kth = k_arm * 64.0;
        tau_c += -kth * wrap(th) - 2 * 0.5 * Math.sqrt(kth * I) * om;
      }
      F_ax += Fcx * a0 + Fcy * a1;
      F_n += Fcx * n0 + Fcy * n1;
      const ex_sign = om >= 0 ? 1.0 : -1.0;
      for (const tk of s.tanks) tk.step(t, dt, a_x_prev, a_n_prev, om, omd_prev, ex_sign);
      let F_s = 0, tau_s = 0; for (const tk of s.tanks) { F_s += tk.F; tau_s += tk.tau; }
      const a_x_sp = F_ax / m, a_n_sp = (F_n + F_s) / m_r;
      const ax = a_x_sp * a0 + a_n_sp * n0;
      const ay = a_x_sp * a1 + a_n_sp * n1 - s.g;
      const g_load = Math.hypot(ax, ay + s.g) / G0;
      // ---- outcome monitors
      if (!s.caught && t > 0.5) {
        if (g_load > max_g) max_g = g_load;
        if (g_load > p.lim_g && g_fail === null) {
          g_fail = { t, g: g_load }; s.events.push([t, `STRUCTURAL FAILURE: ${g_load.toFixed(1)} g exceeds ${p.lim_g} g limit`]);
          s.end_time = t + 1.0;
        }
      }
      if (Fc > max_Fc) max_Fc = Fc;
      if (s.yb < 3000 && (landing || phase === "GLIDE")) max_tilt_low = Math.max(max_tilt_low, Math.abs(wrap(th)) / D2R);
      if (phase !== "CAUGHT" && s.yb < 0 && !s.caught) {
        if (s.end_time === null || s.end_time > t) s.events.push([t, "GROUND IMPACT"]);
        s.end_time = t;
      }
      let I_r;
      if (V3) { let dI = 0; for (const tk of s.tanks) dI += tk.ms_active * (tk.zc + tk.zp - LCG) ** 2; I_r = Math.max(I - dI, 0.5 * I); }
      else I_r = Math.max(I - (s.lox.ms_active * (s.lox.zb - LCG) ** 2 + s.ch4.ms_active * (s.ch4.zb + 1 - LCG) ** 2), 0.5 * I);
      const omd = (tau_g + tau_fin + tau_rcs + tau_c + tau_aero + tau_asym + tau_s) / I_r;
      // ---- log
      if (t >= next_log - 1e-9) {
        const row = {
          t, x, y, xb: s.xb, yb: s.yb, vx, vy, th, thc: s.th_cmd, m, n: nlit, thr, thr_cmd: thr_cmd_log, T,
          q: s.qdyn, M: s.Mach, g_load, arm_gap: s.arm_gap, phase: PHASES.indexOf(phase), Fc, gimbal,
          fin: Math.abs(tau_fin) > 0 ? (tau_f_max > 1 ? tau_fin / tau_f_max : 0) : tau_rcs / p.tau_rcs_Nm * 0.3,
          aoa: Vr > 1 ? wrap(th - Math.atan2(-vrx, -vry)) : 0, heat: Math.sqrt(rho) * Vr ** 3,
          wind_mean: Um, wind_turb_u: tu, wind_turb_w: w_turb, wind_gust: ug, wind_x: wx, airspeed: Vr,
          lox_psi1: s.lox.psi[0], lox_psi2: s.lox.psi[1], ch4_psi1: s.ch4.psi[0], ch4_psi2: s.ch4.psi[1],
          lox_wave: s.lox.wave, ch4_wave: s.ch4.wave, lox_qs: s.lox.qs, ch4_qs: s.ch4.qs, lox_F: s.lox.F, ch4_F: s.ch4.F,
          lox_zp: s.lox.zp, ch4_zp: s.ch4.zp, lox_h: s.lox.h, ch4_h: s.ch4.h, lox_f1: s.lox.f1, ch4_f1: s.ch4.f1,
          lox_zeta: s.lox.zeta, ch4_zeta: s.ch4.zeta, lox_settled: +s.lox.settled, ch4_settled: +s.ch4.settled,
          lox_m: s.lox.m, ch4_m: s.ch4.m, ullage: +s.ullage, tau_asym, tau_aero, tau_slosh: tau_s, xpred: s.x_pred,
          cg: LCG, Iyy: I, loxL_m: V3 ? s.loxL.m : 0, ch4L_m: V3 ? s.ch4L.m : 0, loxL_psi1: V3 ? s.loxL.psi[0] : 0, ch4L_psi1: V3 ? s.ch4L.psi[0] : 0,
          loxL_wave: V3 ? s.loxL.wave : 0, ch4L_wave: V3 ? s.ch4L.wave : 0, loxL_h: V3 ? s.loxL.h : 0, ch4L_h: V3 ? s.ch4L.h : 0,
          loxL_zp: V3 ? s.loxL.zp : 0, ch4L_zp: V3 ? s.ch4L.zp : 0, lox_geff: s.lox.geff, vent_o: s.vent_o, vent_f: s.vent_f, F_vent: s.F_vent,
          feed: s.feed, isolated: +s.isolated, lox_ms: s.lox.ms_active, ch4_ms: s.ch4.ms_active,
        };
        for (const k of LOGK) log[k].push(row[k]);
        spoolLog.push(Float32Array.from(eng.spool)); stateLog.push(Int8Array.from(eng.state));
        next_log += log_dt;
      }
      if (s.end_time !== null && t >= s.end_time) break;
      if (t > T_MAX || ++steps > 400000) { timeout = true; s.events.push([t, "TIMEOUT"]); break; }
      // ---- integrate (semi-implicit Euler)
      s.vx += ax * dt; s.vy += ay * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      om += omd * dt; s.th += om * dt;
      let sumsp = 0; for (let i = 0; i < 33; i++) sumsp += eng.disp[i] * eng.spool[i];
      const used = M.MDOT_ENG * sumsp * thr * dt + start_loss;
      if (V3) {
        feed(used, phase, t, nlit);
        if (s.vent_o + s.vent_f > 0) s.vented = (s.vented || 0) + (s.vent_o + s.vent_f) * dt;
        if (s.vent_o > 0) { s.lox.m = Math.max(s.lox.m - s.vent_o * dt, 0); s.vent_left_o -= s.vent_o * dt; }
        if (s.vent_f > 0) { s.ch4.m = Math.max(s.ch4.m - s.vent_f * dt, 0); s.vent_left_f -= s.vent_f * dt; }
        s.m = p.m_dry_kg; for (const tk of s.tanks) s.m += tk.m;
      } else {
        s.lox.m = Math.max(s.lox.m - used * M.F_LOX, 0.0); s.ch4.m = Math.max(s.ch4.m - used * (1 - M.F_LOX), 0.0);
        s.m = p.m_dry_kg + s.lox.m + s.ch4.m;
      }
      a_x_prev = a_x_sp; a_n_prev = a_n_sp; omd_prev = omd;
      s.t = t + dt;
      if (!isFinite(s.x + s.y + s.vx + s.vy + s.th + om)) { nan = true; s.events.push([t, "NUMERICAL ERROR"]); break; }
    }
    // ---- pack log
    const out = {};
    for (const k of LOGK) out[k] = Float64Array.from(log[k]);
    out.spool = spoolLog; out.state = stateLog;
    s.events.sort((a, b) => a[0] - b[0]);
    const flags = { prop_out_t, g_fail, max_g, max_Fc, max_tilt_low, nan, timeout };
    const outcome = classify(s, out, flags);
    const summary = summarize(s, out, flags);
    return { log: out, events: s.events, outcome, summary, p, settings: Object.assign({}, SH.DEFAULTS, settings || {}), eng_starts: eng.starts, disp: Array.from(eng.disp) };
  };

  function classify(s, log, f) {
    const p = s.p, n = log.t.length;
    const last = i => log[i][n - 1];
    if (f.nan) return { ok: false, code: "NUMERICAL", title: "NUMERICAL ERROR", reason: "The integration diverged (non-finite state)." };
    if (f.g_fail) return { ok: false, code: "G_LIMIT", title: "STRUCTURAL G LIMIT EXCEEDED", reason: `${f.g_fail.g.toFixed(1)} g at T+${f.g_fail.t.toFixed(1)} s exceeds the ${p.lim_g} g limit.` };
    if (s.caught) {
      const c = s.contact, tilt = Math.abs(wrap(c.th * D2R)) / D2R;
      if (Math.abs(c.vy) > p.lim_vy) return { ok: false, code: "TOO_FAST", title: "TOO FAST ONTO THE ARMS", reason: `Pins hit the rails at ${Math.abs(c.vy).toFixed(2)} m/s (limit ${p.lim_vy} m/s); peak arm load ${(f.max_Fc / 1e6).toFixed(2)} MN.` };
      if (tilt > p.lim_tilt) return { ok: false, code: "TIPPED", title: "TIPPED OVER AT CONTACT", reason: `Tilt ${tilt.toFixed(1)}° at contact exceeds ${p.lim_tilt}°.` };
      if (f.max_Fc > p.lim_arm) return { ok: false, code: "ARM_LOAD", title: "ARM LOAD LIMIT EXCEEDED", reason: `Peak arm load ${(f.max_Fc / 1e6).toFixed(2)} MN exceeds ${(p.lim_arm / 1e6).toFixed(1)} MN.` };
      return { ok: true, code: "CAUGHT", title: "CAUGHT", reason: "Booster caught by the chopsticks." };
    }
    if (f.prop_out_t !== null) return { ok: false, code: "PROP_OUT", title: "OUT OF PROPELLANT", reason: `Tanks ran dry at T+${f.prop_out_t.toFixed(1)} s, ${Math.max(last("yb"), 0).toFixed(0)} m above the pad.` };
    if (s.ingested && !s.caught) { const e = s.events.find(e => e[1].startsWith("GAS INGESTION")); return { ok: false, code: "FLAMEOUT", title: "ENGINE FLAMEOUT (GAS INGESTION)", reason: `Sloshing main-tank residuals uncovered the outlet at T+${e[0].toFixed(1)} s; engines ingested gas and shut down.` }; }
    if (s.missed) {
      const mi = s.miss_info;
      const why = mi.arm_gap > 6 ? `arms still ${mi.arm_gap.toFixed(1)} m open` : `pins ${Math.abs(mi.x).toFixed(1)} m off the tower axis`;
      return { ok: false, code: "MISSED", title: "MISSED THE ARMS", reason: `Reached rail height at T+${mi.t.toFixed(1)} s with ${why}${mi.onArm ? " and struck the arm structure" : ""}.` };
    }
    if (f.timeout) return { ok: false, code: "TIMEOUT", title: "TIMEOUT", reason: "Simulation hit the time limit without an outcome." };
    if (f.max_tilt_low > 35) return { ok: false, code: "TIPPED", title: "TIPPED OVER / LOSS OF CONTROL", reason: `Attitude reached ${f.max_tilt_low.toFixed(0)}° from vertical during the final descent.` };
    const xi = last("xb");
    if (s.ign.t_cmd === undefined) return { ok: false, code: "CRASHED", title: "CRASHED", reason: `No landing burn; impact ${(Math.abs(xi) / 1000).toFixed(2)} km ${xi > 0 ? "offshore" : "inland"} at ${Math.hypot(last("vx"), last("vy")).toFixed(0)} m/s.` };
    return { ok: false, code: "CRASHED", title: "CRASHED", reason: `Ground impact at ${Math.hypot(last("vx"), last("vy")).toFixed(0)} m/s, ${Math.abs(xi).toFixed(0)} m from the tower.` };
  }

  function summarize(s, log, f) {
    const t = log.t, n = t.length;
    let iApo = 0; for (let i = 0; i < n; i++) if (log.yb[i] > log.yb[iApo]) iApo = i;
    let iQ = iApo; for (let i = iApo; i < n; i++) if (log.q[i] > log.q[iQ]) iQ = i;
    const tc = s.contact ? s.contact.t : t[n - 1];
    let iG = 0; for (let i = 0; i < n && t[i] <= tc + 1e-9; i++) if (log.g_load[i] > log.g_load[iG]) iG = i;
    let gArms = null; if (s.contact) for (let i = 0; i < n; i++) if (t[i] > tc) gArms = Math.max(gArms || 0, log.g_load[i]);
    const ev = Object.fromEntries(s.events.map(e => [e[1], e[0]]));
    const evStart = s.events.find(e => e[1].startsWith("Boostback burn start")), evCut = s.events.find(e => e[1] === "Boostback cutoff");
    const pk = (k, upto) => { let a = 0; for (let i = 0; i < n && t[i] <= upto; i++) a = Math.max(a, Math.abs(log[k][i])); return a; };
    const c = s.contact || {};
    return {
      caught: !!s.caught,
      catch_time_from_staging_s: s.contact ? c.t : null,
      catch_vertical_speed_mps: s.contact ? c.vy : null, catch_horizontal_speed_mps: s.contact ? c.vx : null,
      catch_offset_m: s.contact ? c.x : null, catch_tilt_deg: s.contact ? wrap(c.th * D2R) / D2R : null,
      propellant_at_catch_kg: s.contact ? c.m_prop : null,
      propellant_end_kg: log.lox_m[n - 1] + log.ch4_m[n - 1] + log.loxL_m[n - 1] + log.ch4L_m[n - 1],
      cg_staging_m: log.cg[0], cg_catch_m: log.cg[n - 1], cg_min_m: Math.min(...log.cg), cg_max_m: Math.max(...log.cg),
      peak_loxL_slosh_deg: pk("loxL_psi1", tc) / D2R, vented_kg: s.vented || 0,
      flight_time_s: tc,
      apogee_km: log.yb[iApo] / 1e3, apogee_t_s: t[iApo],
      max_q_entry_kPa: log.q[iQ] / 1e3, max_q_t_s: t[iQ], max_q_alt_km: log.yb[iQ] / 1e3, max_q_mach: log.M[iQ],
      peak_g_flight: log.g_load[iG], peak_g_t_s: t[iG], peak_g_catch_arms: gArms,
      max_arm_load_MN: f.max_Fc / 1e6,
      landing_burn_cmd_t_s: s.ign.t_cmd ?? null, landing_burn_cmd_alt_m: s.ign.alt_cmd ?? null, landing_burn_cmd_speed_mps: s.ign.v_cmd ?? null,
      landing_burn_90pct_thrust_t_s: s.ign.t_full ?? null, landing_burn_90pct_thrust_alt_m: s.ign.alt_full ?? null,
      spool_lag_equivalent_s: s.ign.t_lag_equiv_s,
      boostback_duration_s: evStart && evCut ? evCut[0] - evStart[0] : null,
      engine_starts: s.eng.starts,
      peak_lox_slosh_deg: pk("lox_psi1", tc) / D2R, peak_ch4_slosh_deg: pk("ch4_psi1", tc) / D2R,
      peak_lox_wave_m: pk("lox_wave", tc), peak_ch4_wave_m: pk("ch4_wave", tc),
      max_ch4_migration_m: pk("ch4_zp", tc),
      peak_wind_mean_mps: pk("wind_mean", 1e9), peak_gust_mps: pk("wind_gust", 1e9),
      ullage_burn_used: log.ullage.some(v => v > 0),
      impact_x_m: s.contact ? null : log.xb[n - 1],
    };
  }
})(window.SH = window.SH || {});
