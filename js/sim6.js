/* v4: 6-DOF rigid-body simulation of the Super Heavy return + catch.
   World frame: x = downrange (+ offshore), y = up, z = crossrange (right-handed).  Body frame: Y = booster axis (nose),
   X = catch-pin axis (side grid fins A at +X, C at -X), Z = belly grid fin B.  State: CG position r, velocity v,
   attitude quaternion q (body->world), body rates w.  Mass properties (CG vector + full inertia tensor) are rebuilt
   every step from dry structure + engines + every liquid (incl. the side-mounted LOX landing tank at body -Z).
   Re-uses the v3 sub-models (engines, atmosphere, Dryden, aero coefficients, domed tank geometry, slosh modes, feed
   logic) so that a planar 6-DOF run reproduces the 2D v3 model (see tools/validate6.js).
   SH.simulate6(settings, opts) -> same result shape as SH.simulate plus 3D log keys. */
(function (SH) {
  "use strict";
  const { CENTRE, INNER, OUTER } = SH, E = SH.ENG;
  const clip = SH.clip, wrap = SH.wrap, G0 = SH.G0, D2R = Math.PI / 180;
  const ALL = Array.from({ length: 33 }, (_, i) => i);
  // ---------------- small vector / quaternion helpers (arrays)
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const sc = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]), unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  const qrot = (q, v) => { const u = [q[1], q[2], q[3]], t = sc(cross(u, v), 2); return add(add(v, sc(t, q[0])), cross(u, t)); };
  const qinv = q => [q[0], -q[1], -q[2], -q[3]];
  const qnorm = q => { const l = Math.hypot(q[0], q[1], q[2], q[3]); return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
  const qaxis = (ax, a) => { const s = Math.sin(a / 2); return [Math.cos(a / 2), ax[0] * s, ax[1] * s, ax[2] * s]; };
  function qfromBasis(X, Y, Z) {   // rotation matrix with columns X,Y,Z -> quaternion
    const m00 = X[0], m11 = Y[1], m22 = Z[2], tr = m00 + m11 + m22; let q;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [0.25 * s, (Y[2] - Z[1]) / s, (Z[0] - X[2]) / s, (X[1] - Y[0]) / s]; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [(Y[2] - Z[1]) / s, 0.25 * s, (Y[0] + X[1]) / s, (Z[0] + X[2]) / s]; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(Z[0] - X[2]) / s, (Y[0] + X[1]) / s, 0.25 * s, (Z[1] + Y[2]) / s]; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(X[1] - Y[0]) / s, (Z[0] + X[2]) / s, (Z[1] + Y[2]) / s, 0.25 * s]; }
    return qnorm(q);
  }
  const rotvec = q => { let w = q[0], v = [q[1], q[2], q[3]]; if (w < 0) { w = -w; v = sc(v, -1); } const s = len(v); if (s < 1e-12) return sc(v, 2); const a = 2 * Math.atan2(s, w); return sc(v, a / s); };
  function inv3(m) {   // 3x3 inverse, row-major [xx,xy,xz, yx,yy,yz, zx,zy,zz]
    const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  const mv3 = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  function solve(A, b) {   // tiny Gaussian elimination (n<=3)
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  SH.V3 = { add, sub, sc, dot, cross, len, unit, qmul, qrot, qinv, qnorm, qaxis, rotvec };

  const LOGK6 = ["z", "zb", "vz", "q0", "q1", "q2", "q3", "wx", "wy", "wz", "roll_err", "tilt", "fin0", "fin1", "fin2", "gx", "gz", "groll",
    "wind_z", "wind_vx", "wind_vz", "cgx", "cgz", "Ixx", "Iyy", "Izz", "lox_psi1b", "ch4_psi1b", "loxL_psi1b", "ch4L_psi1b",
    "xp", "zp", "yp", "zpred", "dc", "de", "tau_roll", "fin_rate", "p_amb", "arm_close", "srp", "CT"];
  SH.LOGK6 = LOGK6;
  const FIN_AZ = [0, Math.PI / 2, Math.PI];   // A (+X), B (+Z belly), C (-X)
  const FIN_R = 7.6;                         // radius of the fin centre of pressure from the axis [m] (geometry estimate)
  const FIN_DMAX = 20 * D2R;

  SH.simulate6 = function (settings, opts) {
    opts = opts || {};
    const planar = !!opts.planar;
    const p = SH.buildParams(Object.assign({}, settings, { physics_model: "v4" }));
    p.v3 = true;                                   // all v3 internals on
    if (opts.pover) Object.assign(p, opts.pover);
    if (planar) { p.z0_m = 0; p.roll0 = 0; p.wind_dir = 0; p.gust_dir = 0; p.tower_z = 0; p.tower_hdg = 0; p.lox_land_xoff_m = 0; p.fin_fail = -1; p.eng_fail = []; p.srp = false; }
    const M = SH.makeModel(p);
    const L = M.L, D = M.D; const R0 = p.R_tank_m;
    const dt = 0.005, log_dt = 0.05, T_MAX = 900;
    const rng = new SH.RNG(p.turb_seed), rng_turb = new SH.RNG(p.turb_seed + 1), rng_lat = new SH.RNG(p.turb_seed + 3);
    const s = { p, M, events: [[0.0, "Hot staging / separation, flip on 3 centre engines (6-DOF model)"]], ign: {} };
    // ---- tanks (identical construction to v3)
    const TL = s.layout = SH.makeTankLayout(p);
    const mO = p.m_prop_stage_kg * M.F_LOX, mF = p.m_prop_stage_kg * (1 - M.F_LOX);
    const lO = p.landing_tanks ? Math.min(TL.loxLand.Vcap * p.rho_lox * 0.999, mO) : 0;
    const lF = p.landing_tanks ? Math.min(TL.ch4Land.Vcap * p.rho_ch4 * 0.999, mF) : 0;
    s.lox = new SH.Tank(M, "LOX", mO - lO, p.rho_lox, p.nu_lox, TL.loxMain.zb, TL.loxMain.zt, TL.loxMain);
    s.ch4 = new SH.Tank(M, "CH4", mF - lF, p.rho_ch4, p.nu_ch4, TL.ch4Main.zb, TL.ch4Main.zt, TL.ch4Main);
    s.loxL = new SH.Tank(M, "LOXL", lO, p.rho_lox, p.nu_lox, TL.loxLand.zb, TL.loxLand.zt, TL.loxLand);
    s.ch4L = new SH.Tank(M, "CH4L", lF, p.rho_ch4, p.nu_ch4, TL.ch4Land.zb, TL.ch4Land.zt, TL.ch4Land);
    s.tanks = [s.lox, s.ch4, s.loxL, s.ch4L];
    const toff = new Map([[s.lox, [0, 0]], [s.ch4, [0, 0]], [s.loxL, [0, -p.lox_land_xoff_m]], [s.ch4L, [0, 0]]]);  // lateral (x,z) body offsets
    for (const tk of s.tanks) { tk.psiB = [0, 0]; tk.psidB = [0, 0]; tk.FB = 0; tk.tauB = 0; tk.msB = 0; tk.waveB = 0; }
    s.isolated = false; s.feed = 0; s.vent_o = 0; s.vent_f = 0; s.F_vent = 0; s.vent_left_o = 0; s.vent_left_f = 0; s.ingest_t = 0;
    // ---- engines geometry (same ring layout as SH.Engines) + mass properties
    const EP = [], EPHI = [];
    for (let i = 0; i < 33; i++) {
      let ang, rad;
      if (i < 3) { ang = [90, 198, -18][i] * D2R; rad = Math.max(p.r_eng_centre_m, 0.82); }   // Block 3 centre clocking 108/108/144 deg
      else if (i < 13) { ang = (i - 3) * 2 * Math.PI / 10; rad = p.r_eng_inner_m; }
      else { ang = (i - 13) * 2 * Math.PI / 20 + Math.PI / 20; rad = p.r_eng_outer_m; }
      EP.push([rad * Math.cos(ang), 0, rad * Math.sin(ang)]); EPHI.push(ang);
    }
    const m_rod = p.m_dry_kg - p.m_eng_total_kg, zDry = m_rod * L / 2;
    let Ieng_roll = 0; for (let i = 0; i < 33; i++) Ieng_roll += (p.m_eng_total_kg / 33) * (EP[i][0] ** 2 + EP[i][2] ** 2);
    const tpos = new Map();
    function massProps() {
      let m = p.m_dry_kg, my = zDry + p.m_eng_total_kg * p.z_eng_m, mx = 0, mz = 0;
      const parts = [];
      for (const tk of s.tanks) {
        const [zc, Izz] = tk.geom.mass_props(tk.m / tk.rho); const z = zc + tk.zp, o = toff.get(tk);
        parts.push([tk, tk.m, o[0], z, o[1], Izz]); m += tk.m; my += tk.m * z; mx += tk.m * o[0]; mz += tk.m * o[1];
      }
      const c = [mx / m, my / m, mz / m];
      const I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      const pt = (mm, d, lxx, lyy, lzz) => {
        I[0] += mm * (d[1] * d[1] + d[2] * d[2]) + lxx; I[4] += mm * (d[0] * d[0] + d[2] * d[2]) + lyy; I[8] += mm * (d[0] * d[0] + d[1] * d[1]) + lzz;
        I[1] -= mm * d[0] * d[1]; I[2] -= mm * d[0] * d[2]; I[5] -= mm * d[1] * d[2];
      };
      pt(m_rod, [-c[0], L / 2 - c[1], -c[2]], m_rod * L * L / 12, m_rod * R0 * R0, m_rod * L * L / 12);
      pt(p.m_eng_total_kg, [-c[0], p.z_eng_m - c[1], -c[2]], 0, Ieng_roll, 0);
      for (const [tk, mi, ox, z, oz, Izz] of parts) {
        const lt = mi * (Izz + R0 * R0 / 4 * 0.5), rw = tk.geom.Rwall;
        pt(mi, [ox - c[0], z - c[1], oz - c[2]], lt, 0.1 * mi * rw * rw / 2, lt);
        tpos.set(tk, [ox, oz]);
      }
      I[3] = I[1]; I[6] = I[2]; I[7] = I[5];
      return [c, I];
    }
    let [c, I] = massProps(); M.LCG = c[1];
    const eng = s.eng = new SH.Engines(M, rng);
    // ---- initial state
    const th0 = Math.atan2(p.vx0_mps, p.vy0_mps);
    let q = qmul(qaxis([0, 0, 1], -th0), qaxis([0, 1, 0], p.roll0 || 0));
    const Yb0 = qrot(q, [0, 1, 0]);
    s.r = [p.x0_m + c[1] * Yb0[0], p.y0_m + c[1] * Yb0[1], (p.z0_m || 0) + c[1] * Yb0[2]];
    s.v = [p.vx0_mps, p.vy0_mps, 0];
    let w = [0, 0, 0], wd_prev = [0, 0, 0];
    s.t = 0; s.phase = "FLIP"; s.thr_cmd = 0.5; let thr_slew = 0.5, thr = 0.5;
    s.a_des = Yb0; s.aoa_cmd = 0; s.aoa_z = 0; s.x_pred = NaN; s.z_pred = NaN; s.next_pred = 0;
    s.arm_gap = p.arm_gap_open_m; s.arm_t0 = null; s.caught = false; s.contact = null; s.missed = false; s.end_time = null;
    // targets: catch point + tower frame (c = arm closing axis, e = arm extension), ocean target
    const hd = p.tower_hdg || 0;
    s.cax = [Math.cos(hd), 0, -Math.sin(hd)]; s.eax = [Math.sin(hd), 0, Math.cos(hd)];
    s.target = { x: p.tower_x || 0, z: p.tower_z || 0, ocean: p.mission === "ocean" };
    if (s.target.ocean) { s.target.x = p.ocean_x_m; s.target.z = p.tower_z || 0; }
    s.y_stop_pred = s.target.ocean ? 0 : p.arm_top_m - p.l_pins_m;
    s.t_lag = M.spool_lag_equiv + p.stagger_landing_s * 4 / 13;
    s.ign.t_lag_equiv_s = s.t_lag; s.ign.lag_comp = p.lag_comp;
    let tu = 0, tv = 0, tw1 = 0, tw2 = 0; const att_int = [0, 0, 0]; s.gust_t0 = null;
    let a_ax_prev = (0.5 * 3 * M.thrust_one(0.0)) / (p.m_dry_kg + p.m_prop_stage_kg), a_nx_prev = 0, a_nz_prev = 0;
    s.ullage = false; s.F_req = 0; s.m = p.m_dry_kg + p.m_prop_stage_kg;
    const k_arm = p.k_arm_N_per_m;
    const log = {}; const KEYS = SH.LOGK.concat(LOGK6); for (const k of KEYS) log[k] = [];
    const spoolLog = [], stateLog = [];
    let next_log = 0;
    let prop_out_t = null, g_fail = null, q_fail = null, max_g = 0, max_Fc = 0, max_tilt_low = 0, nan = false, timeout = false, max_roll_rate = 0;
    let steps = 0;
    // ---- per-engine failure modes + grid-fin failure
    const thrScale = new Float64Array(33).fill(1), stuckG = new Map(), hardAt = new Map(), prevState = Int8Array.from(eng.state);
    for (const f of (p.eng_fail || [])) {
      if (f.mode === "out") eng.failAt.set(f.i, f.t);
      else if (f.mode === "hard") hardAt.set(f.i, f.t);
    }
    const finStuck = [null, null, null]; const finDelta = [0, 0, 0]; let finPrev = [0, 0, 0];
    // ---- v3 feed logic (unchanged)
    const mainOK = tk => tk.m > 1 && tk.settled && (tk.h - Math.abs(tk.wave)) > p.ingest_h_crit_m;
    const fedFrom = { LOX: null, CH4: null };
    function feed(used, phase, t, nlit) {
      if (used <= 0) return;
      const landing = phase === "LANDING13" || phase === "LANDING3";
      const srcs = [[s.lox, s.loxL, used * M.F_LOX, "LOX"], [s.ch4, s.ch4L, used * (1 - M.F_LOX), "CH4"]];
      let code = 0, risky = false;
      for (const [mainT, landT, need, nm] of srcs) {
        let order;
        if (!s.isolated) order = mainOK(mainT) || landT.m <= 1 ? [mainT, landT] : [landT, mainT];
        else if (landing) order = landT.m > 1 ? [landT, mainT] : [mainT];
        else order = mainOK(mainT) || landT.m <= 1 ? [mainT, landT] : [landT, mainT];
        let rem = need;
        for (const tk of order) { const d = Math.min(rem, tk.m); tk.m -= d; rem -= d; if (rem <= 1e-9) break; }
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
    // second lateral slosh axis (body Z), same modes as the axis computed by Tank.step
    function sloshB(tk, a_lat, alpha_x) {
      tk.FB = 0; tk.tauB = 0; tk.msB = 0; tk.waveB = 0;
      const md = tk.modes;
      if (!md || tk.m <= 1e-3 || md[0][0] <= 0) { tk.psiB = [0, 0]; tk.psidB = [0, 0]; return; }
      if (tk.settled && tk.geff > 2e-3 * G0) {
        for (let n = 0; n < 2; n++) {
          const [mn, Ln, zn, wn, zt] = md[n];
          const r_h = tk.zb + tk.zp + zn + Ln - c[1];
          const a_hn = a_lat + r_h * alpha_x;
          const psidd = -wn * wn * tk.psiB[n] - 2 * zt * wn * tk.psidB[n] - a_hn / Ln;
          tk.psidB[n] += psidd * dt; tk.psiB[n] += tk.psidB[n] * dt;
          const lim = Math.min(0.9 * tk.RTs / Ln, 0.6);
          if (Math.abs(tk.psiB[n]) > lim) { tk.psiB[n] = Math.sign(tk.psiB[n]) * lim; tk.psidB[n] *= -0.3; }
          const Fn = mn * (tk.geff * tk.psiB[n] + 2 * zt * wn * Ln * tk.psidB[n]);
          tk.FB += Fn; tk.tauB += r_h * Fn; tk.msB += mn;
        }
        const RT = tk.RTs, J1 = [0.581865, -0.346126], J2 = [0.316028, -0.064922], XI = [1.841184, 5.331443];
        for (let n = 0; n < 2; n++) tk.waveB += md[n][0] * md[n][1] * tk.psiB[n] * J1[n] * XI[n] / (tk.rho * Math.PI * RT ** 3 * J2[n]);
        tk.waveB = clip(tk.waveB, -0.9 * RT, 0.9 * RT);
      } else { const k = Math.exp(-dt / 3.0); for (let n = 0; n < 2; n++) { tk.psiB[n] *= k; tk.psidB[n] *= k; } }
    }
    const windDir = [Math.cos(p.wind_dir || 0), 0, Math.sin(p.wind_dir || 0)], windLat = [-windDir[2], 0, windDir[0]];
    const gustDir = [Math.cos(p.gust_dir || 0), 0, Math.sin(p.gust_dir || 0)];
    // aero forces/moments in the body frame for body-relative air velocity vb
    function aeroB(vb, rho, Mach) {
      const va = vb[1], vn = [vb[0], 0, vb[2]], vnl = Math.hypot(vb[0], vb[2]);
      if (Math.hypot(va, vnl) < 0.05) return [[0, 0, 0], [0, 0, 0]];
      const Cd = M.cd(Mach), ka = 0.5 * rho * Cd * M.A_END * Math.abs(va), kb = 0.5 * rho * Cd * M.A_SIDE * vnl, kf = 0.5 * rho * p.fin_passive_CA_m2 * vnl;
      const Fb = sc(vn, -kb), Ff = sc(vn, -kf);
      const F = [Fb[0] + Ff[0], -ka * va, Fb[2] + Ff[2]];
      const tq = add(cross(sub([0, p.l_cp_body_m, 0], c), Fb), cross(sub([0, p.l_fins_m, 0], c), Ff));
      return [F, tq];
    }
    // 3D impact predictor (planar case identical to M.predict_impact)
    function predict3(x, y, z, vx, vy, vz, m, y_stop) {
      const aoa = p.aoa_nom, dtp = 0.5;
      for (let k = 0; k < 4000; k++) {
        const [rho, , a] = SH.atmosphere(y);
        const Um = y < 85000 ? M.wind_mean(y) : 0.0;
        const vrx = vx - Um * windDir[0], vrz = vz - Um * windDir[2], vry = vy;
        const vh = Math.hypot(vrx, vrz), sx = vrx < 0 ? -1 : 1, vxe = sx * vh;
        const V = Math.hypot(vh, vry);
        const th = Math.atan2(-vxe, -vry) + (vy < 0 ? aoa : 0.0);
        const F = M.aero(vxe, vry, th, rho, V / a, false);
        const ux = vh > 1e-9 ? vrx / vh : 1, uz = vh > 1e-9 ? vrz / vh : 0;
        vx += F[0] * sx * ux / m * dtp; vz += F[0] * sx * uz / m * dtp;
        vy += (F[1] / m - SH.gravity(y)) * dtp;
        const xn = x + vx * dtp, yn = y + vy * dtp, zn = z + vz * dtp;
        if (yn <= y_stop && vy < 0) { const f = (y - y_stop) / (y - yn); return [x + f * (xn - x), z + f * (zn - z)]; }
        x = xn; y = yn; z = zn;
      }
      return [x, z];
    }
    s.predict3 = predict3; s.windDir = windDir;
    const cpts = new Map();   // scratch

    let _pk = 0;
    while (true) {
      if (opts.onProgress && ++_pk % 4000 === 0) opts.onProgress(s.t);
      // ---- mass properties; keep the body continuous while the CG migrates inside it
      { const [c2, I2] = massProps(); const dcv = sub(c2, c); s.r = add(s.r, qrot(q, dcv)); c = c2; I = I2; M.LCG = c[1]; }
      const t = s.t;
      const Xb = qrot(q, [1, 0, 0]), Yb = qrot(q, [0, 1, 0]), Zb = qrot(q, [0, 0, 1]);
      const r = s.r, v = s.v;
      const base = sub(r, qrot(q, c));
      s.x = r[0]; s.y = r[1]; s.z = r[2]; s.vx = v[0]; s.vy = v[1]; s.vz = v[2];
      s.xb = base[0]; s.yb = base[1]; s.zb = base[2];
      { const off = qrot(q, [c[0], 0, c[2]]); s.axX = r[0] - off[0]; s.axZ = r[2] - off[2]; }   // axis point at CG height (CG lateral offset removed, no tilt coupling)
      s.th = Math.atan2(Yb[0], Yb[1]);                     // planar (x-y) pitch angle, for logs + 2D renderer
      const pins = add(base, sc(Yb, p.l_pins_m)); s.pins = pins;
      s.xp = pins[0] - s.target.x; s.zp = pins[2] - s.target.z;
      const dh = [pins[0] - s.target.x, 0, pins[2] - s.target.z];
      s.dc = dot(dh, s.cax); s.de = dot(dh, s.eax); s.dhor = Math.hypot(dh[0], dh[2]);
      s.hp = s.target.ocean ? s.yb : pins[1] - p.arm_top_m;
      s.tiltNow = Math.acos(clip(Yb[1], -1, 1)) / D2R;
      { const Xh0 = unit([Xb[0], 0, Xb[2]]); s.roll_err = Math.acos(clip(Math.abs(dot(Xh0, s.cax)), 0, 1)) / D2R; }
      const [rho, pr, a_snd] = SH.atmosphere(s.yb); s.a_snd = a_snd; s.pr = pr;
      s.g = SH.gravity(r[1]);
      const m = s.m;
      s.Tmax1 = M.thrust_one(pr);
      // ---- 3-axis wind: mean profile (direction), Dryden u (along mean), v (lateral, own RNG), w (vertical), 1-cos gust
      const h_w = Math.max(r[1], 0.5);
      const Um = h_w < 85000 ? M.wind_mean(h_w) : 0.0; s.Um = Um;
      const Wm = sc(windDir, Um);
      const Vr_prev = Math.max(len(sub(v, add(add(sc(windDir, Um + tu), sc(windLat, tv)), [0, tw2, 0]))), 10.0);
      let w_turb;
      if (h_w < 25000) {
        let [su, sw, Lu, Lw] = M.dryden(h_w);
        Lw = Math.max(Lw, 5.0); Lu = Math.max(Lu, 5.0);
        const tau_u = Lu / Vr_prev, tau_w = Lw / Vr_prev;
        tu += (-tu / tau_u) * dt + su * Math.sqrt(2 * dt / tau_u) * rng_turb.normal();
        const q_w = sw * sw * tau_w, nw = Math.sqrt(q_w / dt) * rng_turb.normal();
        tw1 += (nw - tw1) / tau_w * dt; tw2 = tw2 + (tw1 - tw2) / tau_w * dt;
        w_turb = tw2 + Math.sqrt(3) * (tw1 - tw2);
        const tau_v = 0.5 * Lu / Vr_prev;
        const nv = rng_lat.normal();
        if (!planar) tv += (-tv / tau_v) * dt + su * Math.sqrt(2 * dt / tau_v) * nv;
      } else { tu *= 0.999; tv *= 0.999; w_turb = 0.0; tw1 *= 0.999; tw2 *= 0.999; }
      let ug = 0.0;
      if (s.gust_t0 !== null && t - s.gust_t0 <= p.gust_dur_s) ug = 0.5 * p.gust_amp_mps * (1 - Math.cos(2 * Math.PI * (t - s.gust_t0) / p.gust_dur_s));
      const W = add(add(add(sc(windDir, Um + tu), sc(windLat, tv)), sc(gustDir, ug)), [0, w_turb, 0]);
      const vr = sub(v, W);
      s.V = Math.hypot(v[0], v[1], v[2]); const Vr = len(vr);
      s.qdyn = 0.5 * rho * Vr * Vr; s.Mach = Vr / a_snd;
      // guidance aid: aero acceleration with mean wind only (world)
      const vbm = qrot(qinv(q), sub(v, Wm));
      { const [Fm] = aeroB(vbm, rho, Math.hypot(...sub(v, Wm)) / a_snd); const Fw = qrot(q, Fm); s.aero_ax = Fw[0] / m; s.aero_az = Fw[2] / m; }
      // ---- guidance
      const phPrev = s.phase;
      SH.guidance6(s);
      const phase = s.phase;
      if (!s.isolated && phPrev === "BOOSTBACK" && phase !== "BOOSTBACK") {
        s.isolated = true;
        const rO = s.lox.m, rF = s.ch4.m;
        s.events.push([t, p.landing_tanks ? `Landing tanks isolated: LOX landing tank ${(s.loxL.m / 1e3).toFixed(1)} t, CH4 tube column ${(s.ch4L.m / 1e3).toFixed(1)} t; main residuals LOX ${(rO / 1e3).toFixed(1)} t / CH4 ${(rF / 1e3).toFixed(1)} t`
          : `No landing tanks: landing burn will draw on main-tank residuals LOX ${(rO / 1e3).toFixed(1)} t / CH4 ${(rF / 1e3).toFixed(1)} t`]);
        const f = p.vent_mode === "vent all" ? 1 : p.vent_mode === "vent some" ? p.vent_pct / 100 : 0;
        if (!p.landing_tanks) { s.vent_left_o = 0; s.vent_left_f = 0; } else { s.vent_left_o = rO * f; s.vent_left_f = rF * f; }
        s.vent_rate_o = p.vent_rate_lox; s.vent_rate_f = p.vent_rate_ch4;
        if (p.vent_dur_s > 0) { s.vent_rate_o = Math.min(p.vent_rate_lox, s.vent_left_o / p.vent_dur_s); s.vent_rate_f = Math.min(p.vent_rate_ch4, s.vent_left_f / p.vent_dur_s); }
        if (f > 0 && p.landing_tanks) s.events.push([t + 2, `Venting ${(100 * f).toFixed(0)}% of main-tank residuals (${((s.vent_left_o + s.vent_left_f) / 1e3).toFixed(1)} t${p.vent_dur_s > 0 ? ` over ~${p.vent_dur_s.toFixed(0)} s` : ""})`]);
      }
      s.vent_o = s.vent_f = s.F_vent = 0; s.vent_ullage = false;
      if (s.isolated && (s.vent_left_o > 1 || s.vent_left_f > 1) && t > (s.vent_t0 = s.vent_t0 ?? t + 2)) {
        const settled = s.lox.settled && s.ch4.settled && s.lox.geff > 0.05;
        s.vent_ullage = !settled && phase === "COAST";
        const k = settled ? 1 : 0.08;
        s.vent_o = Math.min(s.vent_rate_o * k, s.vent_left_o / dt, s.lox.m / dt);
        s.vent_f = Math.min(s.vent_rate_f * k, s.vent_left_f / dt, s.ch4.m / dt);
        s.F_vent = (s.vent_o + s.vent_f) * p.vent_ve_mps;
        if (s.vent_left_o - s.vent_o * dt <= 1 && s.vent_left_f - s.vent_f * dt <= 1) s.events.push([t, "Main-tank vent complete"]);
      }
      // ---- throttle
      let T_unit = 0.0;
      for (let i = 0; i < 33; i++) { const st = eng.state[i]; if (st === E.STARTING || st === E.RUNNING || st === E.STOPPING) T_unit += eng.disp[i] * eng.spool[i] * thrScale[i]; }
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
      // ---- per-engine failure modes
      for (const f of (p.eng_fail || [])) {
        if (t < f.t || f.done) continue;
        const lit = eng.state[f.i] === E.STARTING || eng.state[f.i] === E.RUNNING;
        if (f.mode === "thrust" && lit) { thrScale[f.i] = Math.max(0, 1 - f.val / 100); f.done = true; s.events.push([t, `ENGINE ${f.i + 1} THRUST LOSS ${f.val.toFixed(0)}% (${SH.ringOf(f.i)} ring)`]); }
        if (f.mode === "gimbal" && lit) { stuckG.set(f.i, Math.sin(f.val * D2R)); f.done = true; s.events.push([t, f.i < 13 ? `ENGINE ${f.i + 1} GIMBAL STUCK at ${f.val.toFixed(1)}°` : `Engine ${f.i + 1} gimbal stuck (outer engines are fixed - no effect)`]); }
      }
      for (let i = 0; i < 33; i++) {
        if (hardAt.has(i) && t >= hardAt.get(i) && prevState[i] !== E.STARTING && eng.state[i] === E.STARTING) {
          hardAt.delete(i); eng.start_bad[i] = 1; eng.dead[i] = 1; eng.state[i] = E.STOPPING; eng.t0[i] = t; eng.spool_at_stop[i] = eng.spool[i];
          let nb = -1, dmin = 1e9; for (let j = 0; j < 33; j++) if (j !== i && !eng.dead[j]) { const dd = Math.hypot(EP[i][0] - EP[j][0], EP[i][2] - EP[j][2]); if (dd < dmin) { dmin = dd; nb = j; } }
          if (nb >= 0) { eng.dead[nb] = 1; eng.start_bad[nb] = 1; if (eng.state[nb] === E.STARTING || eng.state[nb] === E.RUNNING) { eng.state[nb] = E.STOPPING; eng.t0[nb] = t; eng.spool_at_stop[nb] = eng.spool[nb]; } }
          s.events.push([t, `HARD START engine ${i + 1}: engine lost${nb >= 0 ? `, shrapnel disables neighbour ${nb + 1}` : ""}`]);
        }
        prevState[i] = eng.state[i];
      }
      if (s.lox.m + s.loxL.m <= 1 || s.ch4.m + s.ch4L.m <= 1) {
        eng.command_stop(ALL, t); s.prop_out = true;
        if (prop_out_t === null) { prop_out_t = t; s.events.push([t, "PROP OUT"]); }
      }
      const Ti = new Float64Array(33); let T = 0, Tg = 0, nlit = 0, Tg_r = 0;
      for (let i = 0; i < 33; i++) {
        Ti[i] = s.Tmax1 * eng.disp[i] * eng.spool[i] * thr * thrScale[i]; T += Ti[i];
        if (i < 13 && !stuckG.has(i)) { Tg += Ti[i]; Tg_r += Ti[i] * Math.hypot(EP[i][0], EP[i][2]); }
        if (eng.spool[i] > 0.05) nlit++;
      }
      // ---- attitude: desired orientation from guidance axis + roll reference
      // thrust-line trim: the thrust must pass through the (laterally offset) CG, so point the CG-to-thrust-centroid line
      // (not the geometric axis) along the guidance command; zero correction for a symmetric, on-axis case (planar validation)
      let aD = s.a_des;
      if (T > 1 && phase !== "CAUGHT") {
        let px = 0, pz = 0; for (let i = 0; i < 33; i++) if (Ti[i] > 0) { px += Ti[i] * EP[i][0]; pz += Ti[i] * EP[i][2]; }
        px /= T; pz /= T;
        const dB = unit([c[0] - px, c[1] - EP[0][1], c[2] - pz]);
        const dW = qrot(q, dB);
        if (Math.abs(dB[0]) + Math.abs(dB[2]) > 1e-9) aD = unit(sub(aD, sub(dW, Yb)));
      }
      let Zref;
      const rollActive = p.roll_ctrl && (phase === "GLIDE" || landing || phase === "CAUGHT") && !s.target.ocean;
      if (rollActive && Math.abs(dot(s.eax, aD)) < 0.95) { Zref = unit(sub(s.eax, sc(aD, dot(s.eax, aD)))); if (dot(Zref, Zb) < 0) Zref = sc(Zref, -1); }
      else { Zref = sub(Zb, sc(aD, dot(Zb, aD))); if (len(Zref) < 1e-6) Zref = Zb; Zref = unit(Zref); }
      const Xref = unit(cross(aD, Zref));
      const qD = qfromBasis(Xref, aD, cross(Xref, aD));
      const e_b = rotvec(qmul(qinv(q), qD));          // body-frame rotation vector q -> desired
      const lcg = c[1], lf = p.l_fins_m - lcg;
      const G = p.gain || 1;
      const wmax = (landing ? (phase === "LANDING3" && s.arm_gap < 7 ? 6 : 15) : (phase === "FLIP" || phase === "COAST" ? 12 : 8)) * D2R;
      const [kw0, kt0] = phase === "LANDING13" ? [2.0, 5.0] : phase === "LANDING3" ? [1.2, 2.5] : [1.0, 2.0];
      const kw = kw0 * G, kt = kt0 * Math.sqrt(G);
      const sinG = Math.sin(p.gimbal_max_deg * D2R);
      const tau_g_max = Tg * sinG * lcg;
      const Fmax = s.qdyn * p.fin_area_m2 * 0.6 * p.fin_authority;   // per-fin max force (pitch authority = v3 lumped fins)
      const tau_f_max = Fmax * lf;
      const Ixx = I[0], Iyy = I[4], Izz = I[8];
      const tau_ff_v = phase !== "CAUGHT" ? sc(aeroB(vbm, rho, Math.hypot(...sub(v, Wm)) / a_snd)[1], -1) : [0, 0, 0];
      const integ = phase === "GLIDE" || landing || phase === "BOOSTBACK" || phase === "COAST" || phase === "ENTRYBURN";
      const tau_des = [0, 0, 0];
      for (const k of [0, 2]) {
        const Ik = k === 0 ? Ixx : Izz;
        const alpha_av = 0.6 * (tau_g_max + tau_f_max * (k === 0 ? 2 : 1) + p.tau_rcs_Nm) / Ik;
        const err = e_b[k], w_brake = Math.sqrt(2 * alpha_av * Math.abs(err));
        const om_des = Math.sign(err) * Math.min(kw * Math.abs(err), wmax, w_brake) || 0;
        if (integ) att_int[k] = clip(att_int[k] + err * dt, -0.05, 0.05); else att_int[k] = 0;
        tau_des[k] = Ik * kt * (om_des - w[k]) + tau_ff_v[k] + Ik * 0.6 * att_int[k];
      }
      { // roll: align the catch pins with the arm closing axis (or hold)
        const alpha_av = 0.6 * (3 * Fmax * FIN_R + p.tau_rcs_Nm + 0.3 * Tg_r * sinG) / Iyy;
        const err = e_b[1], w_brake = Math.sqrt(2 * alpha_av * Math.abs(err));
        const om_des = rollActive ? Math.sign(err) * Math.min(0.8 * G * Math.abs(err), 6 * D2R, w_brake) || 0 : 0;
        tau_des[1] = Iyy * 1.5 * (om_des - w[1]) + tau_ff_v[1];
      }
      // allocation: gimbal (2-axis + differential roll) -> 3 grid fins (weighted least squares, stuck fins honoured) -> RCS
      const tg = [clip(tau_des[0], -tau_g_max, tau_g_max), 0, clip(tau_des[2], -tau_g_max, tau_g_max)];
      tg[1] = clip(tau_des[1], -0.3 * Tg_r * sinG, 0.3 * Tg_r * sinG);
      const rem = sub(tau_des, tg);
      if (p.fin_fail >= 0 && t >= p.fin_fail_t && !finStuck[p.fin_fail]) { finStuck[p.fin_fail] = p.fin_stuck; s.events.push([t, `GRID FIN ${"ABC"[p.fin_fail]} STUCK at ${(p.fin_stuck / D2R).toFixed(1)}° - re-allocating to the other fins + RCS`]); }
      const colB = FIN_AZ.map(az => [-lf * Math.cos(az), FIN_R, -lf * Math.sin(az)]);
      const Ff = [0, 0, 0];
      const finOn = Fmax > 1 && phase !== "CAUGHT";
      if (finOn) {
        let tgt = rem.slice();
        const free = [];
        for (let i = 0; i < 3; i++) { if (finStuck[i] !== null) { Ff[i] = Fmax * finStuck[i] / FIN_DMAX; tgt = sub(tgt, sc(colB[i], Ff[i])); } else free.push(i); }
        const Wt = finStuck.some(x => x !== null) ? [1, 2.5, 1] : [1, 0.35, 1];   // a stuck fin mostly disturbs roll -> weight roll up
        if (free.length) {
          const A = free.map(a => free.map(b => colB[a][0] * colB[b][0] * Wt[0] + colB[a][1] * colB[b][1] * Wt[1] + colB[a][2] * colB[b][2] * Wt[2]));
          const bb = free.map(a => colB[a][0] * tgt[0] * Wt[0] + colB[a][1] * tgt[1] * Wt[1] + colB[a][2] * tgt[2] * Wt[2]);
          const sol = solve(A, bb) || free.map(() => 0);
          const smax = Math.max(1e-9, ...sol.map(Math.abs)), ksc = smax > Fmax ? Fmax / smax : 1;   // direction-preserving saturation (no spurious roll)
          free.forEach((iF, k) => { Ff[iF] = sol[k] * ksc; });
        }
      }
      for (let i = 0; i < 3; i++) { const dl = finOn ? Ff[i] / Fmax * FIN_DMAX : (finStuck[i] ?? finDelta[i] * 0.98); finDelta[i] = clip(dl, -FIN_DMAX * 1.2, FIN_DMAX * 1.2); }
      let tfin = [0, 0, 0]; for (let i = 0; i < 3; i++) tfin = add(tfin, sc(colB[i], Ff[i]));
      const rem2 = sub(rem, tfin);
      let trcs = [clip(rem2[0], -p.tau_rcs_Nm, p.tau_rcs_Nm), clip(rem2[1], -p.tau_rcs_Nm, p.tau_rcs_Nm), clip(rem2[2], -p.tau_rcs_Nm, p.tau_rcs_Nm)];
      let gx = 0, gz = 0, groll = 0;
      if (phase === "CAUGHT") { tg[0] = tg[1] = tg[2] = 0; trcs = [0, 0, 0]; Ff[0] = Ff[1] = Ff[2] = 0; }
      if (Tg > 1) { gx = clip(-tg[2] / (Tg * lcg), -1, 1); gz = clip(tg[0] / (Tg * lcg), -1, 1); }
      if (Tg_r > 1) {   // differential (roll) gimbal only uses the authority left after pitch/yaw; the rest goes to RCS
        const gr_lim = Math.max(0, sinG - Math.hypot(gx, gz)) * 0.8;
        groll = clip(tg[1] / Tg_r, -gr_lim, gr_lim);
        trcs[1] = clip(trcs[1] + (tg[1] - groll * Tg_r), -p.tau_rcs_Nm, p.tau_rcs_Nm);
      }
      // ---- forces & torques (body frame, about the CG)
      let Fb = [0, 0, 0], Tb = [0, 0, 0];
      for (let i = 0; i < 33; i++) {
        if (Ti[i] <= 0) continue;
        let sx = 0, sz = 0;
        if (i < 13) {
          if (stuckG.has(i)) sx = stuckG.get(i);
          else { sx = gx - groll * Math.sin(EPHI[i]); sz = gz + groll * Math.cos(EPHI[i]); const gm = Math.hypot(sx, sz); if (gm > sinG) { sx *= sinG / gm; sz *= sinG / gm; } }
        }
        const Fi = [-Ti[i] * sx, Ti[i] * Math.sqrt(Math.max(0, 1 - sx * sx - sz * sz)), -Ti[i] * sz];
        Fb = add(Fb, Fi); Tb = add(Tb, cross(sub(EP[i], c), Fi));
      }
      const vb = qrot(qinv(q), vr);
      const [Fa, Ta] = aeroB(vb, rho, s.Mach);
      // supersonic retro-propulsion (SRP): when the engines face the oncoming flow the plume pushes the bow shock off
      // the base and the forebody drag largely vanishes.  Simple correlation on the thrust coefficient C_T = T/(q A):
      // axial drag x 1/(1 + 1.5 C_T), floored at 10 % (Mars-EDL SRP wind-tunnel trend, central-nozzle-like cluster).
      s.srp = 1; s.CT = 0;
      if (p.srp && T > 1 && vb[1] > 1 && s.qdyn > 50) {
        s.CT = T / (s.qdyn * M.A_END); s.srp = Math.max(0.1, 1 / (1 + 1.5 * s.CT));
        Fa[1] *= s.srp;
      }
      Fb = add(Fb, Fa); Tb = add(Tb, Ta);
      for (let i = 0; i < 3; i++) {   // grid-fin control forces at their centres of pressure
        if (!Ff[i]) continue;
        const az = FIN_AZ[i], tdir = [Math.sin(az), 0, -Math.cos(az)], pos = [FIN_R * Math.cos(az), p.l_fins_m, FIN_R * Math.sin(az)];
        const Fi = sc(tdir, Ff[i]); Fb = add(Fb, Fi); Tb = add(Tb, cross(sub(pos, c), Fi));
      }
      Tb = add(Tb, trcs);
      // aerodynamic roll damping of the three grid fins (fin incidence change w_y R / V on each fin)
      if (phase !== "CAUGHT" && Fmax > 1 && Vr > 30) Tb[1] -= 3 * (Fmax / FIN_DMAX) * FIN_R * FIN_R * w[1] / Vr;
      if (s.ullage || s.vent_ullage) Fb[1] += p.F_ullage_N;
      if (s.F_vent > 0) { Fb[1] += 0.3 * s.F_vent; Fb[0] += 0.05 * s.F_vent; }
      // ---- chopsticks
      let Fc = 0;
      if (s.arm_t0 !== null) { let frac = Math.min((t - s.arm_t0) / p.arm_close_time_s, 1.0); frac = 0.5 - 0.5 * Math.cos(Math.PI * frac); s.arm_gap = p.arm_gap_open_m + (p.arm_gap_closed_m - p.arm_gap_open_m) * frac; }
      const wW = qrot(q, w);
      let Fw = [0, 0, 0], Tw = [0, 0, 0];
      if (!s.target.ocean && s.arm_t0 !== null && Yb[1] > 0.2) {
        const sa = (p.arm_top_m - base[1]) / Yb[1];
        if (sa > 0 && sa < L) {
          const Pa = add(base, sc(Yb, sa)), dcA = dot([Pa[0] - s.target.x, 0, Pa[2] - s.target.z], s.cax);
          const pen = Math.abs(dcA) + D / 2 - s.arm_gap;
          if (pen > 0 && Math.abs(dcA) - D / 2 < s.arm_gap + 1.0) {
            const kb = 1.5e6, cb = 2 * 1.5 * Math.sqrt(kb * m), velP = add(v, cross(wW, sub(Pa, r)));
            const F = sc(s.cax, -Math.sign(dcA) * kb * pen - cb * dot(velP, s.cax));
            Fw = add(Fw, F); Tw = add(Tw, cross(sub(Pa, r), F));
          }
        }
      }
      if (!s.target.ocean && s.hp < 0 && Math.abs(s.dc) < s.arm_gap + 2.0 && Math.abs(s.de) < 10.0 && s.caught) {
        const velP = add(v, cross(wW, sub(pins, r)));
        const cdmp = 2 * p.zeta_arm * Math.sqrt(k_arm * m);
        Fc = Math.max(0.0, -k_arm * s.hp - cdmp * velP[1]);
        let F = [0, Fc, 0];
        const slack = s.arm_gap - D / 2;
        if (Math.abs(s.dc) > slack) F = add(F, sc(s.cax, -k_arm * (s.dc - Math.sign(s.dc) * slack)));
        F = add(F, [-2 * 0.5 * Math.sqrt(k_arm * m) * v[0] * 0.2, 0, -2 * 0.5 * Math.sqrt(k_arm * m) * v[2] * 0.2]);
        Fw = add(Fw, F); Tw = add(Tw, cross(sub(pins, r), F));
        const kth = k_arm * 64.0, Imax = Math.max(Ixx, Izz);
        Tw = add(Tw, sub(sc(cross(Yb, [0, 1, 0]), kth), sc([wW[0], 0, wW[2]], 2 * 0.5 * Math.sqrt(kth * Imax))));
        Tw = add(Tw, sc(Yb, -2 * 0.5 * Math.sqrt(kth * Iyy) * dot(wW, Yb)));
      }
      Fb = add(Fb, qrot(qinv(q), Fw)); Tb = add(Tb, qrot(qinv(q), Tw));
      // ---- slosh: axis X via Tank.step (v3), axis Z via sloshB; torques incl. lateral offset of the landing tank
      const ex_sign = -w[2] >= 0 ? 1.0 : -1.0;
      for (const tk of s.tanks) { tk.step(t, dt, a_ax_prev, a_nx_prev, -w[2], -wd_prev[2], ex_sign); sloshB(tk, a_nz_prev, wd_prev[0]); }
      let Fs1 = 0, Fs2 = 0, msA = 0, msB = 0, dIz = 0, dIx = 0; const Ts = [0, 0, 0];
      for (const tk of s.tanks) {
        Fs1 += tk.F; Fs2 += tk.FB; msA += tk.ms_active; msB += tk.msB;
        const o = tpos.get(tk) || [0, 0], dzl = o[1] - c[2], dxl = o[0] - c[0];
        Ts[2] += -tk.tau; Ts[0] += tk.tauB; Ts[1] += dzl * tk.F - dxl * tk.FB;
        const rr = (tk.zc + tk.zp - c[1]) ** 2; dIz += tk.ms_active * rr; dIx += tk.msB * rr;
      }
      Tb = add(Tb, Ts);
      const m_r1 = m - msA, m_r2 = m - msB;
      const a_b = [(Fb[0] + Fs1) / m_r1, Fb[1] / m, (Fb[2] + Fs2) / m_r2];
      const aw = qrot(q, a_b); aw[1] -= s.g;
      const g_load = Math.hypot(aw[0], aw[1] + s.g, aw[2]) / G0;
      // ---- monitors
      if (!s.caught && t > 0.5) {
        if (g_load > max_g) max_g = g_load;
        if (g_load > p.lim_g && g_fail === null) { g_fail = { t, g: g_load }; s.events.push([t, `STRUCTURAL FAILURE: ${g_load.toFixed(1)} g exceeds ${p.lim_g} g limit`]); s.end_time = t + 1.0; }
        if (s.qdyn > p.lim_q && q_fail === null) { q_fail = { t, q: s.qdyn }; s.events.push([t, `STRUCTURAL FAILURE: q = ${(s.qdyn / 1e3).toFixed(0)} kPa exceeds ${(p.lim_q / 1e3).toFixed(0)} kPa`]); s.end_time = t + 1.0; }
      }
      if (Fc > max_Fc) max_Fc = Fc;
      const tilt = Math.acos(clip(Yb[1], -1, 1)) / D2R;
      if (s.yb < 3000 && (landing || phase === "GLIDE")) max_tilt_low = Math.max(max_tilt_low, tilt);
      if (Math.abs(w[1]) > max_roll_rate && phase !== "CAUGHT") max_roll_rate = Math.abs(w[1]);
      if (phase !== "CAUGHT" && s.yb < 0 && !s.caught && !s.splashed) { if (s.end_time === null || s.end_time > t) s.events.push([t, s.target.ocean ? "WATER IMPACT" : "GROUND IMPACT"]); s.end_time = t; }
      // pin/arm roll misalignment (deg, modulo 180 since the pins are symmetric)
      // ---- angular acceleration with slosh-reduced rigid inertia
      const Ir = I.slice(); Ir[8] = Math.max(I[8] - dIz, 0.5 * I[8]); Ir[0] = Math.max(I[0] - dIx, 0.5 * I[0]);
      const Iw = mv3(I, w), wd = mv3(inv3(Ir), sub(Tb, cross(w, Iw)));
      // ---- log
      if (t >= next_log - 1e-9) {
        const finRate = Math.max(...finDelta.map((d, i) => Math.abs(d - finPrev[i]))) / log_dt; finPrev = finDelta.slice();
        const row = {
          t, x: r[0], y: r[1], xb: s.xb, yb: s.yb, vx: v[0], vy: v[1], th: s.th, thc: Math.atan2(aD[0], aD[1]), m, n: nlit, thr, thr_cmd: thr_cmd_log, T,
          q: s.qdyn, M: s.Mach, g_load, arm_gap: s.arm_gap, phase: SH.PHASES.indexOf(phase), Fc, gimbal: Math.asin(clip(gx, -1, 1)) / D2R,
          fin: finDelta[1] / FIN_DMAX, aoa: Vr > 1 ? Math.acos(clip(-dot(Yb, vr) / Vr, -1, 1)) * (dot(Xb, vr) > 0 ? -1 : 1) : 0, heat: Math.sqrt(rho) * Vr ** 3,
          wind_mean: Um, wind_turb_u: tu, wind_turb_w: w_turb, wind_gust: ug, wind_x: W[0], airspeed: Vr,
          lox_psi1: s.lox.psi[0], lox_psi2: s.lox.psi[1], ch4_psi1: s.ch4.psi[0], ch4_psi2: s.ch4.psi[1],
          lox_wave: s.lox.wave, ch4_wave: s.ch4.wave, lox_qs: s.lox.qs, ch4_qs: s.ch4.qs, lox_F: s.lox.F, ch4_F: s.ch4.F,
          lox_zp: s.lox.zp, ch4_zp: s.ch4.zp, lox_h: s.lox.h, ch4_h: s.ch4.h, lox_f1: s.lox.f1, ch4_f1: s.ch4.f1,
          lox_zeta: s.lox.zeta, ch4_zeta: s.ch4.zeta, lox_settled: +s.lox.settled, ch4_settled: +s.ch4.settled,
          lox_m: s.lox.m, ch4_m: s.ch4.m, ullage: +s.ullage, tau_asym: 0, tau_aero: Ta[2], tau_slosh: Ts[2], xpred: s.x_pred,
          cg: c[1], Iyy: Izz, loxL_m: s.loxL.m, ch4L_m: s.ch4L.m, loxL_psi1: s.loxL.psi[0], ch4L_psi1: s.ch4L.psi[0],
          loxL_wave: s.loxL.wave, ch4L_wave: s.ch4L.wave, loxL_h: s.loxL.h, ch4L_h: s.ch4L.h, loxL_zp: s.loxL.zp, ch4L_zp: s.ch4L.zp,
          lox_geff: s.lox.geff, vent_o: s.vent_o, vent_f: s.vent_f, F_vent: s.F_vent, feed: s.feed, isolated: +s.isolated, lox_ms: s.lox.ms_active, ch4_ms: s.ch4.ms_active,
          z: r[2], zb: s.zb, vz: v[2], q0: q[0], q1: q[1], q2: q[2], q3: q[3], wx: w[0], wy: w[1], wz: w[2], roll_err: s.roll_err, tilt,
          fin0: finDelta[0] / D2R, fin1: finDelta[1] / D2R, fin2: finDelta[2] / D2R, gx: Math.asin(clip(gx, -1, 1)) / D2R, gz: Math.asin(clip(gz, -1, 1)) / D2R, groll: Math.asin(groll) / D2R,
          wind_z: W[2], wind_vx: W[0], wind_vz: W[2], cgx: c[0], cgz: c[2], Ixx, Iyy: Izz, Izz, lox_psi1b: s.lox.psiB[0], ch4_psi1b: s.ch4.psiB[0],
          loxL_psi1b: s.loxL.psiB[0], ch4L_psi1b: s.ch4L.psiB[0], xp: pins[0], zp: pins[2], yp: pins[1], zpred: s.z_pred, dc: s.dc, de: s.de, tau_roll: tau_des[1], srp: s.srp, CT: s.CT,
          fin_rate: finRate, p_amb: pr, arm_close: s.arm_t0 !== null ? 1 : 0,
        };
        row.Iroll = Iyy;
        for (const k of KEYS) log[k].push(row[k]);
        spoolLog.push(Float32Array.from(eng.spool)); stateLog.push(Int8Array.from(eng.state));
        next_log += log_dt;
      }
      if (s.end_time !== null && t >= s.end_time) break;
      if (t > T_MAX || ++steps > 400000) { timeout = true; s.events.push([t, "TIMEOUT"]); break; }
      // ---- integrate (semi-implicit Euler; quaternion exponential map)
      s.v = add(v, sc(aw, dt)); s.r = add(r, sc(s.v, dt));
      w = add(w, sc(wd, dt));
      const wl = len(w); if (wl > 1e-12) q = qnorm(qmul(q, qaxis(sc(w, 1 / wl), wl * dt)));
      let sumsp = 0; for (let i = 0; i < 33; i++) sumsp += eng.disp[i] * eng.spool[i] * thrScale[i];
      const used = M.MDOT_ENG * sumsp * thr * dt + start_loss;
      feed(used, phase, t, nlit);
      if (s.vent_o + s.vent_f > 0) s.vented = (s.vented || 0) + (s.vent_o + s.vent_f) * dt;
      if (s.vent_o > 0) { s.lox.m = Math.max(s.lox.m - s.vent_o * dt, 0); s.vent_left_o -= s.vent_o * dt; }
      if (s.vent_f > 0) { s.ch4.m = Math.max(s.ch4.m - s.vent_f * dt, 0); s.vent_left_f -= s.vent_f * dt; }
      s.m = p.m_dry_kg; for (const tk of s.tanks) s.m += tk.m;
      a_ax_prev = a_b[1]; a_nx_prev = a_b[0]; a_nz_prev = a_b[2]; wd_prev = wd;
      s.t = t + dt;
      if (!isFinite(s.r[0] + s.r[1] + s.r[2] + s.v[0] + s.v[1] + s.v[2] + q[0] + w[0] + w[1] + w[2])) { nan = true; s.events.push([t, "NUMERICAL ERROR"]); break; }
    }
    const out = {};
    for (const k of KEYS) out[k] = Float64Array.from(log[k]);
    out.spool = spoolLog; out.state = stateLog;
    s.events.sort((a, b) => a[0] - b[0]);
    const flags = { prop_out_t, g_fail, q_fail, max_g, max_Fc, max_tilt_low, nan, timeout };
    const outcome = classify6(s, out, flags);
    const summary = SH._summarize(s, out, flags);
    const n = out.t.length;
    Object.assign(summary, {
      model: "v4 6-DOF", catch_offset_c_m: s.contact ? s.contact.dc : null, catch_offset_e_m: s.contact ? s.contact.de : null,
      catch_roll_err_deg: s.contact ? s.contact.roll_err : null, catch_vz_mps: s.contact ? s.contact.vz : null,
      impact_z_m: s.contact ? null : out.zb[n - 1], peak_roll_rate_dps: max_roll_rate / D2R,
      peak_fin_deg: Math.max(...["fin0", "fin1", "fin2"].map(k => Math.max(...Array.from(out[k], Math.abs)))),
      crossrange_staging_m: p.z0_m || 0, Ixx_catch: out.Ixx[n - 1], Iroll_catch: null, cgz_catch_m: out.cgz[n - 1],
      splash: s.splash || null,
    });
    if (s.contact) { summary.catch_offset_m = s.contact.x; }
    return { log: out, events: s.events, outcome, summary, p, settings: Object.assign({}, SH.DEFAULTS, settings || {}), eng_starts: eng.starts, disp: Array.from(eng.disp), v4: true,
      tower: { x: s.target.x, z: s.target.z, hdg: p.tower_hdg || 0, ocean: s.target.ocean, cax: s.cax, eax: s.eax } };
  };

  function classify6(s, log, f) {
    const p = s.p;
    if (f.q_fail && !f.nan) return { ok: false, code: "Q_LIMIT", title: "STRUCTURAL MAX-Q EXCEEDED", reason: `q = ${(f.q_fail.q / 1e3).toFixed(0)} kPa at T+${f.q_fail.t.toFixed(1)} s exceeds the ${(p.lim_q / 1e3).toFixed(0)} kPa limit.` };
    if (s.target.ocean && s.splashed && !f.nan && !f.g_fail) {
      const sp = s.splash;
      if (Math.abs(sp.vy) <= 6 && sp.tilt <= 10) return { ok: true, code: "SPLASHDOWN", title: "SOFT SPLASHDOWN", reason: `Touched the water at ${Math.abs(sp.vy).toFixed(1)} m/s, tilt ${sp.tilt.toFixed(1)}°, ${(Math.hypot(sp.dx, sp.dz)).toFixed(0)} m from the target${s.aborted ? " (abort divert)" : ""}.` };
      return { ok: false, code: "HARD_SPLASH", title: "HARD SPLASHDOWN", reason: `Hit the water at ${Math.abs(sp.vy).toFixed(1)} m/s, tilt ${sp.tilt.toFixed(1)}°.` };
    }
    if (s.caught && s.contact && s.contact.roll_err > p.lim_roll) return { ok: false, code: "ROLL", title: "PINS NOT ALIGNED WITH ARMS", reason: `Roll misalignment ${s.contact.roll_err.toFixed(1)}° at contact exceeds ${p.lim_roll}° - pins miss the rails.` };
    return SH._classify(s, log, f);
  }

  // ---------------- 3D guidance (port of guidance.js with crossrange channels, roll handled in the attitude loop)
  const FAIL_ORDER = { centre: [0, 1, 2], inner: [6, 11, 4, 9, 3, 8, 5, 10, 7, 12], outer: [13, 23, 18, 28, 15, 25, 20, 30] };
  function bbSet(n) { return n === 3 ? CENTRE.slice() : n === 33 ? ALL.slice() : CENTRE.concat(INNER); }
  function scheduleFailures(s, ring, n, tFail, candidates, label) {
    if (n <= 0) return;
    const lit = new Set(candidates);
    const pick = FAIL_ORDER[ring].filter(i => lit.has(i) && !s.eng.dead[i]).slice(0, n);
    if (pick.length < n) s.events.push([s.t, `${label}: only ${pick.length} of ${n} requested ${ring}-ring engines are lit`]);
    for (const i of pick) s.eng.failAt.set(i, tFail);
  }
  const rotZ = (a, ang) => { const c = Math.cos(ang), s_ = Math.sin(ang); return [a[0] * c - a[1] * s_, a[0] * s_ + a[1] * c, a[2]]; };
  function aimX(s) { return s.target.ocean ? s.target.x : s.target.x + s.p.x_aim_offshore_m; }
  function bbAxis(s) {   // boostback thrust axis: 2D -88 deg, horizontal heading steered to null crossrange
    const ex = isFinite(s.x_pred) ? Math.max(s.x_pred - aimX(s), 0) : 1e5, ez = isFinite(s.z_pred) ? s.target.z - s.z_pred : 0;
    const k = clip(3 * ez / Math.max(ex, 2000), -0.45, 0.45), hl = Math.hypot(1, k);
    const sn = Math.sin(88 * D2R), cs = Math.cos(88 * D2R);
    return [-sn / hl, cs, sn * k / hl];
  }
  SH.guidance6 = function (s) {
    const p = s.p, M = s.M, eng = s.eng, t = s.t, G = p.gain || 1;
    const pred = () => { const r = s.predict3(s.x, s.y, s.z, s.vx, s.vy, s.vz, s.m, s.y_stop_pred); s.x_pred = r[0]; s.z_pred = r[1]; };
    if (s.phase === "FLIP") {
      s.thr_cmd = 0.5;
      if (t >= s.next_pred) { pred(); s.next_pred = t + 0.5; }
      s.a_des = bbAxis(s);
      if (Math.abs(wrap(Math.atan2(s.a_des[0], s.a_des[1]) - s.th)) < 25 * D2R) {
        s.phase = "BOOSTBACK"; s.t_bb = t; s.bbSet = bbSet(p.bb_engines);
        s.events.push([t, `Boostback burn start (${p.bb_engines} engines, staggered)`]);
        if (p.bb_engines >= 13) { eng.command_start(INNER.slice(0, 5), t, 0.0); eng.command_start(INNER.slice(5), t, p.stagger_boostback_s); }
        if (p.bb_engines === 33) { eng.command_start(OUTER.slice(0, 10), t, 2 * p.stagger_boostback_s); eng.command_start(OUTER.slice(10), t, 3 * p.stagger_boostback_s); }
        scheduleFailures(s, p.bb_fail_ring, p.bb_fail_n, t + p.bb_fail_t, s.bbSet, "Boostback failure");
        s.next_pred = 0;
      }
    }
    if (s.phase === "BOOSTBACK") {
      const nB = s.bbSet.length, n_av = Math.max(eng.available(s.bbSet).length, 1);
      const thr_cap = p.boostback_g_max * SH.G0 * s.m / (nB * s.Tmax1);
      if (p.mission === "rtls_abort" && !s.aborted) {
        const lost = s.bbSet.filter(i => eng.dead[i]).length;
        if (lost >= 2) { s.aborted = true; s.target.ocean = true; s.target.x = p.ocean_x_m * 0.6; s.y_stop_pred = 0; s.events.push([t, `ABORT: ${lost} boostback engines lost - diverting to an ocean splashdown ${(s.target.x / 1e3).toFixed(0)} km offshore`]); }
      }
      let cut = false;
      if (p.bb_cutoff === "fixed duration") {
        s.thr_cmd = Math.min(thr_cap, 1.0) * nB / n_av;
        if (t >= s.next_pred) { pred(); s.next_pred = t + 0.5; }
        cut = t - s.t_bb >= p.bb_fixed_s;
      } else {
        if (t >= s.next_pred) { pred(); const e0 = s.x_pred - aimX(s); s.next_pred = t + (e0 > 20e3 ? 0.5 : 0.0); }
        const err = s.x_pred - aimX(s);
        s.thr_cmd = Math.min(thr_cap, err > 15e3 ? 1.0 : Math.max(p.throttle_min, err / 15e3)) * nB / n_av;
        cut = err <= 0;
        if (t - s.t_bb > 240) cut = true;
      }
      s.a_des = bbAxis(s);
      if (eng.available(s.bbSet).length === 0) cut = true;
      if (cut) { s.phase = "COAST"; eng.command_stop(s.bbSet, t); for (const tk of s.tanks) tk.zpd += p.cutoff_rebound_mps; s.events.push([t, "Boostback cutoff"]); }
    }
    const Wm = [s.Um * s.windDir[0], 0, s.Um * s.windDir[2]];
    const retro = SH.V3.unit([-(s.vx - Wm[0]), -s.vy, -(s.vz - Wm[2])]);
    if (s.phase === "COAST" && p.entry_burn && !s.entry_done && s.vy < 0 && s.yb < p.entry_burn_alt_m) {
      if (s.tanks.every(tk => tk.settled)) { s.phase = "ENTRYBURN"; s.ullage = false; s.v_entry0 = s.V; eng.command_start(CENTRE, t, 0.0); s.events.push([t, `Entry burn start (3 centre engines, target Δv ${p.entry_burn_dv.toFixed(0)} m/s)`]); }
      else { s.ullage = true; if (!s.ullage_logged_entry) { s.events.push([t, "Propellant unsettled: RCS ullage settling burn before entry-burn relight"]); s.ullage_logged_entry = true; } }
    }
    if (s.phase === "ENTRYBURN") {
      s.a_des = s.V > 1 ? retro : [0, 1, 0]; s.thr_cmd = 1.0;
      if (s.V <= s.v_entry0 - p.entry_burn_dv || s.yb < 12000 || eng.available(CENTRE).length === 0) { eng.command_stop(CENTRE, t); s.entry_done = true; s.phase = "COAST"; s.events.push([t, `Entry burn cutoff (Δv ${(s.v_entry0 - s.V).toFixed(0)} m/s)`]); }
    }
    if (s.phase === "COAST" || s.phase === "GLIDE") {
      s.thr_cmd = 0.0;
      if (s.phase === "COAST" && s.vy < 0 && s.qdyn > 1000) { s.phase = "GLIDE"; s.events.push([t, "Entry: grid-fin glide (q > 1 kPa)"]); }
      if (t >= s.next_pred) { pred(); s.next_pred = t + 1.0; }
      let a = s.V > 1 ? retro : [0, 1, 0];
      if (s.phase === "GLIDE") {
        s.aoa_cmd = p.aoa_nom + clip(-6 * D2R * G * (aimX(s) - s.x_pred) / 400.0, -8 * D2R, 8 * D2R);
        s.aoa_z = clip(-20 * D2R * G * (s.target.z - s.z_pred) / 400.0, -10 * D2R, 10 * D2R);
        a = rotZ(a, -s.aoa_cmd);
        if (s.aoa_z) a = SH.V3.unit(SH.V3.add(a, [0, 0, Math.tan(s.aoa_z)]));
        // ---- landing-burn ignition (as v3)
        const vg = p.v_gate_mps, hpg = vg * vg / (2 * p.landing_decel_B);
        let hq = s.hp, vq = s.vy, vxq = s.vx;
        if (p.lag_comp) {
          const nstep = 10, dtq = s.t_lag / nstep;
          for (let k = 0; k < nstep; k++) {
            const [rq, , aq] = SH.atmosphere(Math.max(s.yb + (hq - s.hp), 0));
            const Fq = M.aero(vxq - s.Um * s.windDir[0], vq, s.th, rq, Math.hypot(vxq - s.Um * s.windDir[0], vq) / aq, false);
            vq += (Fq[1] / s.m - s.g) * dtq; vxq += Fq[0] / s.m * dtq; hq += vq * dtq;
          }
        }
        const dh = hq - hpg, n13 = Math.max(eng.healthy(CENTRE.concat(INNER)).length, 1);
        let ignite = false;
        if (dh > 1 && vq < -vg) {
          const a_req = (vq * vq - vg * vg) / (2 * dh), rq = SH.atmosphere(Math.max(s.yb + (hq - s.hp), 0))[0];
          const a_drag = 0.5 * rq * vq * vq * M.cd(Math.abs(vq) / s.a_snd) * M.A_END / s.m;
          ignite = s.m * (a_req + s.g - 0.3 * a_drag) / (n13 * s.Tmax1) >= p.ign_need_threshold;
        } else if (dh <= 1 && s.vy < -1) ignite = true;
        if (ignite) {
          if (s.tanks.every(tk => tk.settled)) {
            s.phase = "LANDING13"; s.ullage = false;
            const forced = [3, 8, 5, 10, 7, 12, 0, 1, 2].filter(i => !eng.dead[i]).slice(0, p.relight_fail_n);
            for (const i of forced) eng.forced_bad[i] = 1;
            eng.command_start(CENTRE, t, 0.0); eng.command_start(INNER.slice(0, 5), t, p.stagger_landing_s); eng.command_start(INNER.slice(5), t, 2 * p.stagger_landing_s);
            s.events.push([t, `Landing burn start command (${eng.healthy(CENTRE.concat(INNER)).length} engines, staggered)`]);
            Object.assign(s.ign, { t_cmd: t, alt_cmd: s.yb, v_cmd: s.V, hp_pred: hq, vy_pred: vq });
            scheduleFailures(s, p.lb_fail_ring, p.lb_fail_n, t + p.lb_fail_t, eng.healthy(CENTRE.concat(INNER)), "Landing-burn failure");
          } else { s.ullage = true; if (!s.settle_wait_logged) { s.events.push([t, "Propellant unsettled: RCS ullage settling burn before relight"]); s.settle_wait_logged = true; } }
        }
      }
      s.a_des = a;
    }
    let dX = s.x - s.target.x, dZ = s.z - s.target.z;
    const setAxis = (ax, ay, az) => { s.a_des = SH.V3.unit([ax, Math.max(ay, 0.1), az]); };
    if (s.phase === "LANDING13") {
      const vg = p.v_gate_mps, hpg = vg * vg / (2 * p.landing_decel_B), dh = Math.max(s.hp - hpg, 1.0);
      const a_req = Math.max((s.vy * s.vy - vg * vg) / (2 * dh), 0.0);
      const tgo = 2 * Math.max(s.hp - hpg, 0.0) / (Math.max(-s.vy, 1.0) + vg) + Math.sqrt(2 * hpg / p.landing_decel_B);
      const dXp = s.axX - s.target.x, dZp = s.axZ - s.target.z;   // axis-referenced (landing-tank CG offset removed)
      const vx_des = -dXp / Math.max(0.6 * tgo / G, 3.0), vz_des = -dZp / Math.max(0.6 * tgo / G, 3.0);
      let ax_c = (vx_des - s.vx) / 2.0 - s.aero_ax, az_c = (vz_des - s.vz) / 2.0 - s.aero_az;
      const ay_c = Math.max(a_req + s.g - 0.5 * s.qdyn * M.cd(s.Mach) * M.A_END / s.m, 0.3 * s.g);
      const lim = ay_c * Math.tan(25 * D2R), ah = Math.hypot(ax_c, az_c); if (ah > lim) { ax_c *= lim / ah; az_c *= lim / ah; }
      setAxis(ax_c, ay_c, az_c); s.F_req = s.m * Math.hypot(ax_c, ay_c, az_c);
      if (s.ign.t_full === undefined) { let sp = 0; for (let i = 0; i < 13; i++) sp += eng.spool[i]; if (sp >= 0.9 * Math.max(eng.healthy(CENTRE.concat(INNER)).length, 1)) Object.assign(s.ign, { t_full: t, alt_full: s.yb, v_full: s.V }); }
      if (-s.vy <= Math.sqrt(2 * p.landing_decel_B * Math.max(s.hp, 0)) + 0.5 || s.hp < hpg) {
        s.phase = "LANDING3";
        const keep = eng.available(CENTRE);
        const subs = eng.available(INNER).filter(i => !s.p.eng_fail.some(f => f.i === i && f.mode === "gimbal")).sort((a, b) => Math.abs(eng.u[a]) - Math.abs(eng.u[b])).slice(0, Math.max(0, 3 - keep.length));
        s.subs = subs; eng.command_stop(INNER.filter(i => !subs.includes(i)), t);
        s.events.push([t, subs.length ? `Shutdown to 3 engines (hover-slam; ${subs.length} inner engine(s) replace failed centre)` : "Shutdown to 3 centre engines (hover-slam)"]);
      }
    }
    if (s.phase === "LANDING3") {
      const set3 = CENTRE.concat(s.subs || []);
      if (eng.available(set3).length < 3 && s.hp > 5 && !s.prop_out && !s.shed_any) {
        const cand = INNER.filter(i => !eng.dead[i] && !set3.includes(i) && (eng.state[i] === SH.ENG.OFF || eng.state[i] === SH.ENG.STOPPING));
        const need = 3 - eng.available(set3).length - set3.filter(i => eng.state[i] === SH.ENG.STARTING && !eng.start_bad[i]).length;
        if (need > 0 && cand.length) { const pick = cand.slice(0, need); s.subs = (s.subs || []).concat(pick); eng.command_start(pick, t, 0.0); s.events.push([t, `Relighting inner engine(s) ${pick.map(i => i + 1).join(", ")} to restore 3-engine hover`]); }
      }
      const aB = p.landing_decel_B, hpc = Math.max(s.hp, 0.0);
      let v_cmd = -(0.3 + Math.min(Math.sqrt(2 * aB * hpc), 0.6 * hpc));
      let a_ff = Math.sqrt(2 * aB * hpc) < 0.6 * hpc ? aB : 0.6 * 0.6 * hpc;
      if (!s.target.ocean && s.arm_t0 === null && s.hp < 30 && (s.dhor > 4.0 || Math.abs(s.de) > 2.5 || Math.abs(s.vx * s.eax[0] + s.vz * s.eax[2]) > 1.2)) {
        const vh = s.hp > 8 ? -1.0 : 0.0;
        if (v_cmd < vh) { v_cmd = vh; a_ff = 0; }
        if (!s.hover_hold_logged) { s.hover_hold_logged = true; s.events.push([t, `Hover-hold: ${s.dhor.toFixed(1)} m off axis, translating before closing arms`]); }
      }
      const ay_c = Math.max(s.g + a_ff + 2.0 * (v_cmd - s.vy) - s.qdyn * M.cd(s.Mach) * M.A_END / s.m, 0.3 * s.g);
      // lateral errors measured at the catch pins (the side-mounted landing tank shifts the CG off the axis)
      dX = s.axX - s.target.x; dZ = s.axZ - s.target.z;
      const dXY = Math.hypot(dX, dZ);
      const vmax = dXY < 40 ? 5.0 : Math.min(5.0 + (dXY - 40) / 8, 25.0);
      let vx_des = -dX / 4.0 * G, vz_des = -dZ / 4.0 * G; const vd = Math.hypot(vx_des, vz_des); if (vd > vmax) { vx_des *= vmax / vd; vz_des *= vmax / vd; }
      const tauV = 3.0;   // firmer velocity tracking in the last 120 m (arrive slow along the arms)
      let ax_c = (vx_des - s.vx) / tauV - s.aero_ax, az_c = (vz_des - s.vz) / tauV - s.aero_az;
      if (s.arm_gap < 7.0) {   // arms closing: stop pushing along the closing axis (bumpers centre it), keep damping along the arms
        const ac = ax_c * s.cax[0] + az_c * s.cax[2]; ax_c -= ac * s.cax[0]; az_c -= ac * s.cax[2];
        const ve = s.vx * s.eax[0] + s.vz * s.eax[2], ae = clip((clip(-((s.axX - s.target.x) * s.eax[0] + (s.axZ - s.target.z) * s.eax[2]) / 4.0, -1.0, 1.0) - ve) / 2.0, -0.6, 0.6) - (s.aero_ax * s.eax[0] + s.aero_az * s.eax[2]) - (ax_c * s.eax[0] + az_c * s.eax[2]);
        ax_c += ae * s.eax[0]; az_c += ae * s.eax[2];
      }
      const lim = ay_c * Math.tan((vmax > 5 ? 15 : s.hp < 10 ? 2.5 + 0.55 * Math.max(s.hp, 0) : 8) * D2R), ah = Math.hypot(ax_c, az_c);   // stand up straight for the last metres
      if (ah > lim) { ax_c *= lim / ah; az_c *= lim / ah; }
      setAxis(ax_c, ay_c, az_c); s.F_req = s.m * Math.hypot(ax_c, ay_c, az_c);
      const runN = eng.available(set3).filter(i => eng.state[i] === SH.ENG.RUNNING);
      let Tmin = 0; for (const i of runN) Tmin += eng.disp[i] * s.Tmax1 * p.throttle_min;
      if (runN.length > 2 && s.hp < 40 && s.F_req < 0.92 * Tmin && !p.no_shed) {
        s.shed_t = (s.shed_t || 0) + 0.005;
        if (s.shed_t > 1.0) { const off = runN.sort((a, b) => Math.abs(eng.u[b]) - Math.abs(eng.u[a]))[0]; eng.command_stop([off], t); s.shed_t = 0; s.shed_any = true; s.events.push([t, `Throttle floor above demand: engine ${off + 1} shut down (2-engine hover)`]); }
      } else s.shed_t = 0;
      if (s.gust_t0 === null && s.hp < p.gust_trigger_hp_m) { s.gust_t0 = t; s.events.push([t, `Discrete 1-cosine gust ${Math.abs(p.gust_amp_mps).toFixed(0)} m/s`]); }
      if (s.target.ocean) {
        if (s.hp <= 0 && !s.splashed) {
          s.splashed = true; s.phase = "CAUGHT"; s.caught = false;
          s.splash = { t, vy: s.vy, vx: s.vx, dx: dX, dz: dZ, tilt: s.tiltNow };
          s.events.push([t, `Splashdown at ${Math.abs(s.vy).toFixed(1)} m/s - engines cut`]); eng.command_stop(ALL, t); s.end_time = t + 3.0;
        }
        return;
      }
      if (s.arm_t0 === null && s.hp < p.arm_close_hp) {
        if (s.dhor < 6.0 && Math.abs(s.de) < 3.0 && Math.hypot(s.vx, s.vz) < 4.0 && Math.abs(s.vx * s.eax[0] + s.vz * s.eax[2] + 0.5 * Math.sign(s.de) * Math.min(Math.abs(s.de), 2)) < 0.9) { s.arm_t0 = t; s.events.push([t, "Chopsticks closing"]); }
        else if (!s.arm_hold_logged) { s.arm_hold_logged = true; s.events.push([t, `Arms held open: booster ${s.dhor.toFixed(1)} m off axis`]); }
      }
      const offC = Math.abs(s.dc), offE = Math.abs(s.de);
      if (s.hp <= 0.0 && (offC > s.arm_gap - M.D / 2 + 0.5 || s.arm_gap > 6.0 || offE > 8.0)) {
        if (!s.missed) {
          s.missed = true; s.miss_info = { t, x: offE > 8 ? s.de : s.dc, arm_gap: s.arm_gap, vy: s.vy };
          const onArm = offC < s.arm_gap + 30 + M.D / 2; s.miss_info.onArm = onArm;
          s.events.push([t, onArm ? "MISS - booster strikes the chopstick arms" : "MISS"]); s.end_time = t + (onArm ? 0.5 : 3.0);
        }
      } else if (s.hp <= 0.0 && !s.missed) {
        s.phase = "CAUGHT"; s.caught = true;
        s.contact = { t, vy: s.vy, vx: s.vx, vz: s.vz, x: s.dhor * Math.sign(s.dc || 1), dc: s.dc, de: s.de, th: (s.tiltNow || 0) * Math.sign(s.th || 1), m_prop: s.tanks.reduce((a, tk) => a + tk.m, 0), arm_gap: s.arm_gap, roll_err: s.roll_err };
        s.events.push([t, `Catch pins contact arms - engine cutoff (roll alignment ${s.roll_err.toFixed(1)}°)`]);
        eng.command_stop(ALL, t); s.end_time = t + 6.0;
      }
    }
  };
})(window.SH = window.SH || {});
