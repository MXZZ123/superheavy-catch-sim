/* Super Heavy catch web app -- parameter schema, defaults (= Python v2 baseline), presets.
   Classic script (no modules) so index.html works when opened directly from disk. */
(function (SH) {
  "use strict";
  const G0 = 9.80665;
  SH.G0 = G0;

  // Fixed (non-tweakable) model constants, identical to sim.py v2 PARAMS.
  SH.FIXED = {
    L_booster_m: 72.3, D_booster_m: 9.0, l_cg_m: 24.0, l_pins_m: 66.0, l_fins_m: 68.0, l_cp_body_m: 36.15,
    mixture_ratio_OF: 3.6, throttle_tau_s: 0.08, gimbal_max_deg: 15.0,
    r_eng_centre_m: 0.75, r_eng_inner_m: 2.10, r_eng_outer_m: 3.95,
    eng_ign_delay_s: 0.40, eng_spool_wn: 2.6, eng_spool_zeta: 0.70, eng_tailoff_tau_s: 0.18,
    eng_start_loss_kg: 120.0, eng_disp_sigma: 0.0075, eng_check_time_s: 2.5,
    stagger_boostback_s: 0.30, stagger_landing_s: 0.25,
    fin_area_m2: 66.0, fin_passive_CA_m2: 36.0, tau_rcs_Nm: 2.5e6, F_ullage_N: 40e3,
    x0_m: 70e3, y0_m: 68e3, vx0_mps: 1330.0, vy0_mps: 640.0,
    R_tank_m: 4.5, lox_tank_bottom_m: 4.0, lox_tank_top_m: 38.0, ch4_tank_bottom_m: 38.6, ch4_tank_top_m: 66.0,
    rho_lox: 1200.0, rho_ch4: 440.0, nu_lox: 1.6e-7, nu_ch4: 2.6e-7, baffle_w_over_R: 0.10,
    baffle_z_m: [0.8, 2.5, 4.5, 7, 10, 14, 18, 23, 28], zeta_hardware: 0.004, zeta_mode2_factor: 1.5,
    cutoff_rebound_mps: 0.15, resettle_restitution: 0.05, resettle_excite_k: 0.25, settle_gap_m: 0.15,
    wind_shear_alpha: 0.14, arm_top_m: 125.0, arm_gap_open_m: 14.0, arm_gap_closed_m: 4.9,
    boostback_g_max: 6.0, landing_decel_B: 4.0, ign_need_threshold: 0.50,
    // ---- v3 internals (Block 3 layout; ESTIMATES unless noted -- see README "Landing tanks" for sources)
    m_eng_total_kg: 33 * 1600, z_eng_m: 1.6,                  // Raptor 3 ~1.6 t each incl. TVC (estimate)
    aft_dome_depth_m: 1.6, common_dome_depth_m: 1.4,           // dome depth ~0.35 R (estimate from imagery)
    tube_R_m: 0.9, tube_zb_m: 2.6, tube_valve_z_m: 20.0,       // CH4 transfer tube (radius estimate; isolated lower column = CH4 landing reserve, speculative)
    lox_land_zb_m: 5.0, lox_land_h_m: 7.0, lox_land_R_m: 1.6, lox_land_xoff_m: 2.6,  // side-mounted LOX landing tank ~50 m3 (estimate)
    land_tank_zeta: 0.06,                                      // internal anti-slosh baffling of the small landing tanks (estimate)
    ingest_h_crit_m: 0.30, ingest_t_crit_s: 0.35,              // outlet uncovering / vortex margin before gas ingestion (estimate)
    vent_rate_lox: 1500, vent_rate_ch4: 600, vent_ve_mps: 30,  // liquid dump through vent valves (estimate)
  };

  // Tweakables: key -> {group, label, min, max, step, def, unit, type, options, help}
  const T = [];
  const add = (group, key, label, def, min, max, step, unit, extra) =>
    T.push(Object.assign({ group, key, label, def, min, max, step, unit, type: "range" }, extra || {}));
  // Model
  add("Model & propellant management", "physics_model", "Physics model", "v4", 0, 0, 0, "", { type: "select", options: ["v4", "v3", "v2"], labels: { v4: "v4: 6-DOF 3D (quaternion, inertia tensor, 3 fins)", v3: "v3: 2D landing tanks, domed tanks, CG shift", v2: "v2: 2D Python-validated legacy" } });
  add("Mission", "mission", "Mission profile", "rtls", 0, 0, 0, "", { type: "select", options: ["rtls", "ocean", "rtls_abort"], labels: { rtls: "RTLS + chopstick catch", ocean: "Ocean splashdown (soft, offshore)", rtls_abort: "RTLS with auto-abort to ocean (≥2 boostback engine-outs)" }, v4: true });
  add("Mission", "ocean_x_km", "Ocean target downrange", 25, 3, 60, 0.5, "km", { v4: true });
  add("Staging conditions", "stage_alt_km", "Staging altitude", 68, 50, 85, 0.5, "km");
  add("Staging conditions", "stage_v_mps", "Staging velocity", Math.round(Math.hypot(1330, 640) * 100) / 100, 1100, 1800, 5, "m/s", { fmt: 0 });
  add("Staging conditions", "stage_fpa_deg", "Flight-path angle", Math.round(Math.atan2(640, 1330) * 180 / Math.PI * 100) / 100, 10, 45, 0.5, "°", { fmt: 1 });
  add("Staging conditions", "stage_downrange_km", "Downrange at staging", 70, 40, 100, 1, "km");
  add("Staging conditions", "stage_crossrange_km", "Crossrange at staging", 0, -10, 10, 0.25, "km", { v4: true });
  add("Staging conditions", "roll_offset_deg", "Booster roll offset (held until entry)", 0, -90, 90, 1, "°", { v4: true, help: "Roll control is off until the grid-fin glide; fins + RCS must roll the pins into line with the arms" });
  add("Model & propellant management", "landing_tanks", "Use landing (header) tanks", true, 0, 0, 0, "", { type: "check", help: "Off: the landing burn draws on main-tank residuals (slosh / gas-ingestion risk)" });
  add("Model & propellant management", "vent_mode", "Main-tank residuals after boostback", "vent all", 0, 0, 0, "", { type: "select", options: ["vent all", "vent some", "don't vent"] });
  add("Model & propellant management", "vent_pct", "Vent percentage (vent some)", 50, 0, 100, 5, "%");
  add("Model & propellant management", "vent_dur_s", "Vent duration (0 = max valve rate)", 0, 0, 120, 1, "s", { v4: true });
  add("Model & propellant management", "lox_land_scale", "LOX landing-tank size (× height)", 1.0, 0.5, 1.6, 0.05, "×", { fmt: 2, v4: true, help: "Changes landing-reserve capacity (~64.6 t at 1.0×)" });
  add("Model & propellant management", "header_p_bar", "Landing-tank / main ullage pressure", 3.0, 1.5, 6.0, 0.1, "bar", { fmt: 1, v4: true, help: "Higher pressure = smaller outlet-uncovering margin needed before gas ingestion (crude model)" });
  // Engine failures
  add("Engine failures", "bb_fail_n", "Engines out during boostback", 0, 0, 6, 1, "");
  add("Engine failures", "bb_fail_ring", "Boostback failure ring", "inner", 0, 0, 0, "", { type: "select", options: ["centre", "inner", "outer"] });
  add("Engine failures", "bb_fail_t", "Failure time into boostback", 10, 0, 30, 0.5, "s");
  add("Engine failures", "lb_fail_n", "Engines out during landing burn", 0, 0, 6, 1, "");
  add("Engine failures", "lb_fail_ring", "Landing failure ring", "inner", 0, 0, 0, "", { type: "select", options: ["centre", "inner"] });
  add("Engine failures", "lb_fail_t", "Failure time into landing burn", 3, 0, 20, 0.25, "s");
  add("Engine failures", "relight_fail_n", "Forced start-up failures at landing relight", 0, 0, 5, 1, "");
  add("Engine failures", "eng_fail", "Individual engine failures (tap the map)", "", 0, 0, 0, "", { type: "engines", v4: true });
  add("Engine failures", "eng_start_fail_p", "Random start failure probability", 0.004, 0, 0.2, 0.001, "", { fmt: 3 });
  // Re-entry
  add("Re-entry", "aoa_bias_deg", "Glide AoA bias", -6, -16, 4, 0.5, "°");
  add("Re-entry", "fin_authority", "Grid-fin authority (×)", 1.0, 0.1, 2.0, 0.05, "×");
  add("Grid fins", "fin_fail", "Grid-fin failure (stuck)", "none", 0, 0, 0, "", { type: "select", options: ["none", "A", "B", "C"], labels: { none: "none", A: "Fin A (+X side, catch pin)", B: "Fin B (belly)", C: "Fin C (−X side, catch pin)" }, v4: true });
  add("Grid fins", "fin_stuck_deg", "Stuck at angle", 10, -20, 20, 0.5, "°", { v4: true });
  add("Grid fins", "fin_fail_t", "Failure time (T+)", 185, 0, 260, 1, "s", { v4: true });
  add("Guidance", "gain_scale", "Guidance / control aggressiveness", 1.0, 0.5, 2.0, 0.05, "×", { fmt: 2, v4: true });
  add("Model & propellant management", "srp", "Retro-propulsion drag model (plume shields the base)", true, 0, 0, 0, "", { type: "check", v4: true, help: "Axial drag × 1/(1+1.5·C_T) while the engines face the flow (boostback / entry / landing burns)" });
  add("Guidance", "roll_ctrl", "Roll control (align pins with arms)", true, 0, 0, 0, "", { type: "check", v4: true });
  add("Re-entry", "entry_burn", "Entry burn (3 engines)", false, 0, 0, 0, "", { type: "check" });
  add("Re-entry", "entry_burn_alt_km", "Entry burn start altitude", 45, 20, 80, 1, "km");
  add("Re-entry", "entry_burn_dv", "Entry burn Δv", 250, 50, 600, 10, "m/s");
  // Boostback
  add("Boostback", "x_aim_offshore_m", "Aim point offset (predictor)", 100, -1500, 1500, 10, "m");
  add("Boostback", "bb_engines", "Boostback engine count", 13, 0, 0, 0, "", { type: "select", options: [3, 13, 33] });
  add("Boostback", "bb_cutoff", "Cutoff logic", "predictor", 0, 0, 0, "", { type: "select", options: ["predictor", "fixed duration"] });
  add("Boostback", "bb_fixed_s", "Fixed burn duration", 34, 10, 70, 0.5, "s");
  // Landing burn
  add("Landing burn", "lag_comp", "Spool-lag ignition look-ahead", true, 0, 0, 0, "", { type: "check" });
  add("Landing burn", "handover_alt_m", "13→3 handover (pin height above rails)", 253.125, 80, 700, 0.125, "m");
  add("Landing burn", "throttle_min", "Minimum throttle", 0.40, 0.20, 0.70, 0.01, "", { fmt: 2 });
  add("Landing burn", "throttle_max", "Maximum throttle", 1.00, 0.80, 1.10, 0.01, "", { fmt: 2 });
  add("Landing burn", "throttle_rate_per_s", "Throttle rate limit", 0.50, 0.10, 2.0, 0.05, "/s", { fmt: 2 });
  // Vehicle
  add("Vehicle", "m_dry_t", "Dry mass", 300, 240, 360, 1, "t");
  add("Vehicle", "m_prop_t", "Propellant at staging", 400, 250, 550, 5, "t");
  add("Vehicle", "thrust_tf", "Raptor 3 sea-level thrust", 280, 230, 300, 1, "tf", { help: "SpaceX May 2026 nominal 250 tf; 280 tf demonstrated" });
  add("Vehicle", "Isp_sl_s", "Isp sea level", 330, 300, 345, 1, "s");
  add("Vehicle", "Isp_vac_s", "Isp vacuum", 350, 330, 370, 1, "s");
  add("Vehicle", "cd_scale", "Drag coefficient scale", 1.0, 0.6, 1.5, 0.05, "×", { fmt: 2 });
  // Environment
  add("Environment", "U10_wind_mps", "Surface wind (10 m, + = to sea)", -5.5, -20, 20, 0.5, "m/s");
  add("Environment", "jet_peak_mps", "Jet stream peak (11.5 km)", 28, -10, 70, 1, "m/s");
  add("Environment", "wind_dir_deg", "Mean wind direction (blows toward, 0 = +downrange)", 0, -180, 180, 5, "°", { v4: true, help: "90° = blowing toward +crossrange (a pure crosswind)" });
  add("Environment", "turb_scale", "Turbulence intensity (×moderate)", 1.0, 0, 3, 0.1, "×");
  add("Environment", "gust_amp_mps", "1-cosine gust amplitude", -9, -25, 25, 0.5, "m/s");
  add("Environment", "gust_dir_deg", "Gust direction", 0, -180, 180, 5, "°", { v4: true });
  add("Environment", "gust_dur_s", "Gust duration", 3.5, 1, 10, 0.25, "s");
  add("Environment", "gust_trigger_hp_m", "Gust trigger (pin height)", 150, 10, 400, 5, "m");
  add("Environment", "seed", "Random seed", 20261004, 1, 99999999, 1, "", { type: "number" });
  // Tower
  add("Tower", "tower_x_m", "Catch point downrange (x)", 0, -300, 300, 5, "m", { v4: true });
  add("Tower", "tower_z_m", "Catch point crossrange (z)", 0, -300, 300, 5, "m", { v4: true });
  add("Tower", "tower_heading_deg", "Tower heading (arm direction)", 0, -180, 180, 5, "°", { v4: true, help: "Rotates the tower/arms about the catch point; roll control re-aligns the pins" });
  add("Tower", "arm_close_time_s", "Arm close time", 1.8, 0.6, 5, 0.1, "s");
  add("Tower", "arm_close_hp_m", "Arms start closing at pin height", 18, 5, 60, 1, "m", { v4: true });
  add("Tower", "k_arm_MN_per_m", "Rail stiffness", 30, 5, 120, 1, "MN/m");
  add("Tower", "zeta_arm", "Rail damping ratio", 0.35, 0.05, 1.0, 0.01, "", { fmt: 2 });
  // Limits (outcome judging)
  add("Outcome limits", "lim_vy_mps", "Max vertical speed onto rails", 2.0, 0.5, 6, 0.1, "m/s");
  add("Outcome limits", "lim_tilt_deg", "Max tilt at contact", 3.0, 0.5, 10, 0.5, "°");
  add("Outcome limits", "lim_g", "Structural g limit (flight)", 12, 6, 20, 0.5, "g");
  add("Outcome limits", "lim_arm_MN", "Arm load limit", 8, 2, 20, 0.5, "MN");
  add("Outcome limits", "lim_q_kPa", "Structural max-q limit", 260, 100, 400, 5, "kPa", { v4: true });
  add("Outcome limits", "lim_roll_deg", "Max pin/arm roll misalignment", 10, 2, 30, 0.5, "°", { v4: true });
  SH.TWEAKS = T;
  SH.DEFAULTS = Object.fromEntries(T.map(t => [t.key, t.def]));

  SH.PRESETS = {
    "Baseline (v3)": {},
    "Don't vent residuals": { vent_mode: "don't vent" },
    "No landing tanks (main-tank feed)": { landing_tanks: false, vent_mode: "don't vent" },
    "v2 model (Python-validated)": { physics_model: "v2" },
    "1 engine out in landing burn": { lb_fail_n: 1 },
    "2 engines out in landing burn": { lb_fail_n: 2 },
    "Centre engine fails in hover-slam": { lb_fail_n: 1, lb_fail_ring: "centre", lb_fail_t: 11 },
    "2 engines out in boostback": { bb_fail_n: 2 },
    "2 relight start failures": { relight_fail_n: 2 },
    "High-AoA entry (−12°)": { aoa_bias_deg: -12 },
    "Entry burn on": { entry_burn: true },
    "Windy day": { U10_wind_mps: -12, jet_peak_mps: 50, turb_scale: 2.0, gust_amp_mps: -15 },
    "Raptor 3 at 250 tf": { thrust_tf: 250 },
    "Heavy booster (+30 t dry)": { m_dry_t: 330 },
    "Low propellant (300 t)": { m_prop_t: 300 },
    "No lag compensation": { lag_comp: false },
    "Sluggish arms (4 s close)": { arm_close_time_s: 4.0 },
    "Stuck grid fin (belly, 10° at T+185)": { fin_fail: "B", fin_stuck_deg: 10, fin_fail_t: 185 },
    "Stuck side fin A (−15°)": { fin_fail: "A", fin_stuck_deg: -15, fin_fail_t: 180 },
    "Crosswind (90°, 12 m/s surface, 45 m/s jet)": { wind_dir_deg: 90, U10_wind_mps: 12, jet_peak_mps: 45, gust_dir_deg: 90, gust_amp_mps: 10 },
    "Wind from the north-west (135°)": { wind_dir_deg: 135, U10_wind_mps: 10, jet_peak_mps: 40 },
    "Roll offset 40° at entry": { roll_offset_deg: 40 },
    "Crossrange staging (+3 km)": { stage_crossrange_km: 3 },
    "Tower rotated 35°": { tower_heading_deg: 35 },
    "Ocean splashdown": { mission: "ocean" },
    "Boostback abort → ocean (3 out)": { mission: "rtls_abort", bb_fail_n: 3, bb_fail_t: 6 },
    "Hard start + gimbal stuck (map)": { eng_fail: "4:hard:228:0;7:gimbal:229:6" },
    "Small landing tank (0.7×)": { lox_land_scale: 0.7 },
  };
  SH.PRESETS["Baseline (v4 6-DOF)"] = {}; delete SH.PRESETS["Baseline (v3)"];
  SH.PRESETS = Object.assign({ "Baseline (v4 6-DOF)": {}, "v3 2D model": { physics_model: "v3" } }, SH.PRESETS);

  // Build the full internal parameter set p from UI settings s.
  const D2R = Math.PI / 180;
  // engine-failure map: "idx:mode:t:val;..."  idx 0-based, mode out|thrust|gimbal|hard, t = T+ s, val = % loss or gimbal deg
  SH.ENG_FAIL_MODES = { out: "shutdown", thrust: "thrust loss %", gimbal: "gimbal stuck (deg)", hard: "hard start (damages neighbour)" };
  SH.parseEngFail = function (str) {
    const out = [];
    for (const part of String(str || "").split(";")) {
      const [i, mode, t, val] = part.split(":"); const k = parseInt(i, 10);
      if (!(k >= 0 && k < 33) || !SH.ENG_FAIL_MODES[mode]) continue;
      out.push({ i: k, mode, t: +t || 0, val: +val || 0 });
    }
    return out;
  };
  SH.encodeEngFail = list => list.map(f => `${f.i}:${f.mode}:${(+f.t).toFixed(1)}:${(+f.val).toFixed(1)}`).join(";");
  SH.buildParams = function (s) {
    const u = Object.assign({}, SH.DEFAULTS, s || {});
    const p = Object.assign({}, SH.FIXED);
    p.m_dry_kg = u.m_dry_t * 1e3;
    p.m_prop_stage_kg = u.m_prop_t * 1e3;
    p.T_sl_N = u.thrust_tf * 1e3 * G0;
    p.Isp_sl_s = u.Isp_sl_s; p.Isp_vac_s = Math.max(u.Isp_vac_s, u.Isp_sl_s + 1);
    p.cd_scale = u.cd_scale;
    p.throttle_min = u.throttle_min; p.throttle_max = Math.max(u.throttle_max, u.throttle_min + 0.05);
    p.throttle_rate_per_s = u.throttle_rate_per_s;
    p.eng_start_fail_p = u.eng_start_fail_p;
    p.U10_wind_mps = u.U10_wind_mps; p.jet_peak_mps = u.jet_peak_mps;
    p.W20_mps = 15.0 * u.turb_scale; p.turb_scale = u.turb_scale;
    p.turb_seed = Math.round(u.seed);
    p.gust_amp_mps = u.gust_amp_mps; p.gust_dur_s = u.gust_dur_s; p.gust_trigger_hp_m = u.gust_trigger_hp_m;
    p.arm_close_time_s = u.arm_close_time_s; p.k_arm_N_per_m = u.k_arm_MN_per_m * 1e6; p.zeta_arm = u.zeta_arm;
    p.x_aim_offshore_m = u.x_aim_offshore_m;
    p.v_gate_mps = Math.sqrt(2 * p.landing_decel_B * u.handover_alt_m);
    p.aoa_nom = u.aoa_bias_deg * Math.PI / 180;
    p.fin_authority = u.fin_authority;
    p.lag_comp = !!u.lag_comp;
    p.bb_engines = +u.bb_engines; p.bb_cutoff = u.bb_cutoff; p.bb_fixed_s = u.bb_fixed_s;
    p.entry_burn = !!u.entry_burn; p.entry_burn_alt_m = u.entry_burn_alt_km * 1e3; p.entry_burn_dv = u.entry_burn_dv;
    p.bb_fail_n = u.bb_fail_n; p.bb_fail_ring = u.bb_fail_ring; p.bb_fail_t = u.bb_fail_t;
    p.lb_fail_n = u.lb_fail_n; p.lb_fail_ring = u.lb_fail_ring; p.lb_fail_t = u.lb_fail_t;
    p.relight_fail_n = u.relight_fail_n;
    p.lim_vy = u.lim_vy_mps; p.lim_tilt = u.lim_tilt_deg; p.lim_g = u.lim_g; p.lim_arm = u.lim_arm_MN * 1e6;
    p.v3 = u.physics_model !== "v2";
    p.v4 = u.physics_model === "v4";
    // staging conditions (only override the fixed v2 state when actually changed, so v2/v3 stay bit-exact by default)
    const V0 = Math.hypot(SH.FIXED.vx0_mps, SH.FIXED.vy0_mps), F0 = Math.atan2(SH.FIXED.vy0_mps, SH.FIXED.vx0_mps) / D2R;
    if (Math.abs(u.stage_v_mps - V0) > 0.02 || Math.abs(u.stage_fpa_deg - F0) > 0.006) { p.vx0_mps = u.stage_v_mps * Math.cos(u.stage_fpa_deg * D2R); p.vy0_mps = u.stage_v_mps * Math.sin(u.stage_fpa_deg * D2R); }
    if (Math.abs(u.stage_alt_km * 1e3 - SH.FIXED.y0_m) > 1) p.y0_m = u.stage_alt_km * 1e3;
    if (Math.abs(u.stage_downrange_km * 1e3 - SH.FIXED.x0_m) > 1) p.x0_m = u.stage_downrange_km * 1e3;
    p.z0_m = u.stage_crossrange_km * 1e3; p.roll0 = u.roll_offset_deg * D2R;
    p.mission = u.mission; p.ocean_x_m = u.ocean_x_km * 1e3;
    p.vent_dur_s = u.vent_dur_s; p.header_p_bar = u.header_p_bar;
    if (p.v4) {
      p.lox_land_h_m = SH.FIXED.lox_land_h_m * u.lox_land_scale;
      p.ingest_h_crit_m = SH.FIXED.ingest_h_crit_m * Math.sqrt(3.0 / u.header_p_bar);
    }
    p.eng_fail = SH.parseEngFail(u.eng_fail);
    p.fin_fail = { none: -1, A: 0, B: 1, C: 2 }[u.fin_fail] ?? -1; p.fin_stuck = u.fin_stuck_deg * D2R; p.fin_fail_t = u.fin_fail_t;
    p.gain = u.gain_scale; p.roll_ctrl = !!u.roll_ctrl; p.srp = u.srp !== false;
    p.wind_dir = u.wind_dir_deg * D2R; p.gust_dir = u.gust_dir_deg * D2R;
    p.tower_x = u.tower_x_m; p.tower_z = u.tower_z_m; p.tower_hdg = u.tower_heading_deg * D2R;
    p.arm_close_hp = u.arm_close_hp_m; p.lim_q = u.lim_q_kPa * 1e3; p.lim_roll = u.lim_roll_deg;
    p.landing_tanks = !!u.landing_tanks;
    p.vent_mode = u.vent_mode; p.vent_pct = u.vent_pct;
    return p;
  };
})(window.SH = window.SH || {});
