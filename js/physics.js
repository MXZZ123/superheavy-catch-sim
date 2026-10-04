/* Physics models (port of sim.py v2): RNG, atmosphere, gravity, wind + Dryden, drag, aero with moments,
   impact predictor, Raptor 3 engine bank with transients, SP-106 slosh tanks. Pure functions / classes, no DOM. */
(function (SH) {
  "use strict";
  const G0 = SH.G0, R_EARTH = 6371e3, R_AIR = 287.053;

  // ---------- portable RNG (mulberry32 + Box-Muller). Bit-identical Python twin in sim.py (PortableRNG).
  class RNG {
    constructor(seed) { this.s = seed >>> 0; this.spare = null; }
    nextU32() {
      this.s = (this.s + 0x6D2B79F5) >>> 0;
      let t = this.s;
      t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
      t = (t ^ (t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0))) >>> 0;
      return (t ^ (t >>> 14)) >>> 0;
    }
    random() { return this.nextU32() / 4294967296; }
    normal() {
      if (this.spare !== null) { const z = this.spare; this.spare = null; return z; }
      const u1 = 1.0 - this.random(), u2 = this.random();
      const r = Math.sqrt(-2.0 * Math.log(u1)), a = 2.0 * Math.PI * u2;
      this.spare = r * Math.sin(a);
      return r * Math.cos(a);
    }
  }
  SH.RNG = RNG;

  // numpy.interp-compatible
  function interp(x, xp, fp) {
    const n = xp.length;
    if (x <= xp[0]) return fp[0];
    if (x >= xp[n - 1]) return fp[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xp[mid] <= x) lo = mid; else hi = mid; }
    const slope = (fp[lo + 1] - fp[lo]) / (xp[lo + 1] - xp[lo]);
    return slope * (x - xp[lo]) + fp[lo];
  }
  SH.interp = interp;
  const clip = (v, a, b) => (v < a ? a : v > b ? b : v);
  SH.clip = clip;
  const wrap = a => { let r = (a + Math.PI) % (2 * Math.PI); if (r < 0) r += 2 * Math.PI; return r - Math.PI; };
  SH.wrap = wrap;

  // ---------- atmosphere (US Std 1976 to 86 km, isothermal above)
  const LAYERS = [[0, 288.15, -0.0065, 101325.0], [11000, 216.65, 0.0, 22632.06], [20000, 216.65, 0.001, 5474.889],
    [32000, 228.65, 0.0028, 868.0187], [47000, 270.65, 0.0, 110.9063], [51000, 270.65, -0.0028, 66.93887],
    [71000, 214.65, -0.002, 3.956420], [86000, 186.87, 0.0, 0.3734]];
  function atmosphere(h) {
    h = Math.max(h, 0.0);
    let i;
    for (i = LAYERS.length - 1; i >= 0; i--) if (h >= LAYERS[i][0]) break;
    const [hb, Tb, lb, pb] = LAYERS[i];
    let T, pr;
    if (i === LAYERS.length - 1 || lb === 0.0) { T = Tb; pr = pb * Math.exp(-G0 * (h - hb) / (R_AIR * Tb)); }
    else { T = Tb + lb * (h - hb); pr = pb * Math.pow(T / Tb, -G0 / (lb * R_AIR)); }
    return [pr / (R_AIR * T), pr, Math.sqrt(1.4 * R_AIR * T)];
  }
  SH.atmosphere = atmosphere;
  const gravity = h => G0 * Math.pow(R_EARTH / (R_EARTH + Math.max(h, 0)), 2);
  SH.gravity = gravity;

  // ---------- environment model bound to a parameter set
  const WH = [300, 1000, 2000, 4000, 7000, 10000, 11500, 13500, 16000, 20000, 25000, 30000, 40000, 60000, 85000];
  const WU = [0, -6.0, -1.0, 6.0, 14.0, 24.0, 28.0, 24.0, 14.0, 5.0, 2.0, 0.0, -3.0, 5.0, 0.0];
  const TH = [610, 1500, 3000, 6000, 9000, 12000, 15000, 18000, 21000, 24000, 25000];
  const TS = [2.6, 2.6, 2.4, 2.3, 2.3, 2.2, 1.8, 1.2, 0.7, 0.3, 0.0];
  const CD_M = [0.0, 0.6, 0.9, 1.05, 1.2, 1.5, 2.0, 3.0, 5.0, 10.0];
  const CD_V = [1.45, 1.50, 1.75, 2.15, 2.25, 2.20, 2.05, 1.95, 1.85, 1.80];

  SH.makeModel = function (p) {
    const M = { p };
    const L = p.L_booster_m, D = p.D_booster_m, LCG = p.l_cg_m;
    M.L = L; M.D = D; M.LCG = LCG;
    M.A_END = Math.PI * D * D / 4; M.A_SIDE = L * D;
    M.T_SL = p.T_sl_N; M.T_VAC = p.T_sl_N * p.Isp_vac_s / p.Isp_sl_s;
    M.A_EXIT = (M.T_VAC - M.T_SL) / 101325.0;
    M.MDOT_ENG = M.T_VAC / (p.Isp_vac_s * G0);
    M.F_LOX = p.mixture_ratio_OF / (1 + p.mixture_ratio_OF);
    M.RT = p.R_tank_m; M.A_TANK = Math.PI * M.RT * M.RT;
    const tab = WU.slice(); tab[0] = p.U10_wind_mps * Math.pow(300 / 10, p.wind_shear_alpha); tab[6] = p.jet_peak_mps;
    M.windTab = tab;
    M.wind_mean = function (h) {
      h = Math.max(h, 0.5);
      if (h < 300) return p.U10_wind_mps * Math.pow(h / 10, p.wind_shear_alpha);
      return interp(h, WH, tab);
    };
    const TSs = TS.map(v => v * p.turb_scale);
    M.dryden = function (h) {
      const hf = Math.max(h, 3.0) / 0.3048;
      const low = hf_ => {
        const sw = 0.1 * p.W20_mps;
        const su = sw / Math.pow(0.177 + 0.000823 * hf_, 0.4);
        const Lu = hf_ / Math.pow(0.177 + 0.000823 * hf_, 1.2) * 0.3048;
        return [su, sw, Lu, hf_ * 0.3048];
      };
      if (hf <= 1000) return low(hf);
      const s_hi = interp(h, TH, TSs), L_hi = 1750 * 0.3048;
      if (hf >= 2000) return [s_hi, s_hi, L_hi, L_hi];
      const f = (hf - 1000) / 1000, a = low(1000);
      return [a[0] + f * (s_hi - a[0]), a[1] + f * (s_hi - a[1]), a[2] + f * (L_hi - a[2]), a[3] + f * (L_hi - a[3])];
    };
    M.cd = Mach => interp(Mach, CD_M, CD_V) * p.cd_scale;
    M.thrust_one = pamb => Math.max(M.T_VAC - pamb * M.A_EXIT, 0.0);
    // aero: returns [Fx, Fy, tau]
    M.aero = function (vrx, vry, th, rho, Mach, withMoment) {
      const V = Math.hypot(vrx, vry);
      if (V < 0.05) return [0, 0, 0];
      const ax_ = Math.sin(th), ay_ = Math.cos(th);
      const Cd = M.cd(Mach);
      const vax = vrx * ax_ + vry * ay_;
      const vnx = vrx - vax * ax_, vny = vry - vax * ay_;
      const vn = Math.hypot(vnx, vny);
      const ka = 0.5 * rho * Cd * M.A_END * Math.abs(vax);
      const kb = 0.5 * rho * Cd * 1.0 * M.A_SIDE * vn;
      const kf = 0.5 * rho * p.fin_passive_CA_m2 * vn;
      const Fbx = -kb * vnx, Fby = -kb * vny, Ffx = -kf * vnx, Ffy = -kf * vny;
      const Fx = -ka * vax * ax_ + Fbx + Ffx, Fy = -ka * vax * ay_ + Fby + Ffy;
      let tau = 0.0;
      if (withMoment) tau = -((p.l_cp_body_m - M.LCG) * (ax_ * Fby - ay_ * Fbx) + (p.l_fins_m - M.LCG) * (ax_ * Ffy - ay_ * Ffx));
      return [Fx, Fy, tau];
    };
    M.predict_impact = function (x, y, vx, vy, m, y_stop) {
      const aoa = p.aoa_nom, dt = 0.5;
      for (let k = 0; k < 4000; k++) {
        const [rho, , a] = atmosphere(y);
        const wx = y < 85000 ? M.wind_mean(y) : 0.0;
        const vrx = vx - wx, vry = vy;
        const V = Math.hypot(vrx, vry);
        const th = Math.atan2(-vrx, -vry) + (vy < 0 ? aoa : 0.0);
        const F = M.aero(vrx, vry, th, rho, V / a, false);
        vx += F[0] / m * dt;
        vy += (F[1] / m - gravity(y)) * dt;
        const xn = x + vx * dt, yn = y + vy * dt;
        if (yn <= y_stop && vy < 0) { const f = (y - y_stop) / (y - yn); return x + f * (xn - x); }
        x = xn; y = yn;
      }
      return x;
    };
    // spool-up S-curve
    M.spool_curve = function (tau) {
      const t = tau - p.eng_ign_delay_s;
      if (t <= 0) return 0.0;
      const wn = p.eng_spool_wn, z = p.eng_spool_zeta, wd = wn * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * wn * t) * (Math.cos(wd * t) + z / Math.sqrt(1 - z * z) * Math.sin(wd * t));
    };
    let s = 0; for (let i = 0; i < 12000; i++) s += 1 - M.spool_curve(i * 0.001);
    M.spool_lag_equiv = s * 0.001;
    return M;
  };

  // ---------- engines
  const OFF = 0, STARTING = 1, RUNNING = 2, STOPPING = 3, FAILED = 4;
  SH.ENG = { OFF, STARTING, RUNNING, STOPPING, FAILED };
  SH.CENTRE = [0, 1, 2]; SH.INNER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  SH.OUTER = Array.from({ length: 20 }, (_, i) => 13 + i);
  SH.ringOf = i => (i < 3 ? "centre" : i < 13 ? "inner" : "outer");

  class Engines {
    constructor(M, rng) {
      const p = M.p; this.M = M; this.p = p; this.rng = rng;
      const n = 33;
      this.u = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let ang, rad;
        if (i < 3) { ang = Math.PI / 2 + i * 2 * Math.PI / 3; rad = p.r_eng_centre_m; }
        else if (i < 13) { ang = (i - 3) * 2 * Math.PI / 10; rad = p.r_eng_inner_m; }
        else { ang = (i - 13) * 2 * Math.PI / 20 + Math.PI / 20; rad = p.r_eng_outer_m; }
        this.u[i] = rad * Math.cos(ang);
      }
      this.disp = new Float64Array(n);
      for (let i = 0; i < n; i++) this.disp[i] = 1 + clip(rng.normal() * p.eng_disp_sigma, -0.02, 0.02);
      this.state = new Int8Array(n); this.spool = new Float64Array(n); this.t0 = new Float64Array(n);
      this.spool_at_stop = new Float64Array(n); this.pending = new Map();
      this.start_bad = new Uint8Array(n); this.forced_bad = new Uint8Array(n); this.dead = new Uint8Array(n);
      this.failAt = new Map();           // engine -> scheduled in-flight failure time
      this.starts = 0; this.log_events = [];
      for (const i of SH.CENTRE) { this.state[i] = RUNNING; this.spool[i] = 1.0; }
    }
    command_start(idx, t, delay) {
      for (const i of idx) if (!this.dead[i] && (this.state[i] === OFF || this.state[i] === STOPPING)) this.pending.set(i, t + (delay || 0));
    }
    command_stop(idx, t) {
      for (const i of idx) {
        this.pending.delete(i);
        if (this.state[i] === STARTING || this.state[i] === RUNNING) {
          this.state[i] = STOPPING; this.t0[i] = t; this.spool_at_stop[i] = this.spool[i];
        }
      }
    }
    step(t, dt) {
      const p = this.p; let loss = 0.0;
      for (const [i, ts] of Array.from(this.pending.entries())) {
        if (t >= ts) {
          this.pending.delete(i);
          this.state[i] = STARTING; this.t0[i] = t; this.starts += 1;
          loss += p.eng_start_loss_kg;
          this.start_bad[i] = (this.rng.random() < p.eng_start_fail_p) || this.forced_bad[i] ? 1 : 0;
          this.forced_bad[i] = 0;
        }
      }
      for (let i = 0; i < 33; i++) {
        const st = this.state[i];
        if (st === STARTING) {
          const tau = t - this.t0[i];
          let s = this.M.spool_curve(tau);
          if (this.start_bad[i]) s = Math.min(s, 0.35);
          this.spool[i] = s;
          if (tau >= p.eng_check_time_s) {
            if (s < 0.9) {
              this.state[i] = STOPPING; this.t0[i] = t; this.spool_at_stop[i] = s;
              this.start_bad[i] = 1; this.dead[i] = 1;
              this.log_events.push([t, `Engine ${i + 1} failed start check - shut down`]);
            } else if (Math.abs(s - 1.0) < 0.015 || tau > 4.0) this.state[i] = RUNNING;
          }
        } else if (st === RUNNING) this.spool[i] = 1.0;
        else if (st === STOPPING) {
          const tauc = p.eng_tailoff_tau_s * (this.start_bad[i] ? 0.45 : 1.0);
          this.spool[i] = this.spool_at_stop[i] * Math.exp(-(t - this.t0[i]) / tauc);
          if (this.spool[i] < 0.005) { this.spool[i] = 0.0; this.state[i] = this.start_bad[i] ? FAILED : OFF; }
        }
        if (this.failAt.has(i) && t >= this.failAt.get(i) && (st === STARTING || st === RUNNING)) {
          this.failAt.delete(i);
          this.start_bad[i] = 1; this.dead[i] = 1;
          this.state[i] = STOPPING; this.t0[i] = t; this.spool_at_stop[i] = this.spool[i];
          this.log_events.push([t, `ENGINE ${i + 1} FAILURE (${SH.ringOf(i)} ring) - guidance compensating`]);
        }
      }
      return loss;
    }
    available(idx) {
      const out = [];
      for (const i of (idx || Array.from({ length: 33 }, (_, k) => k)))
        if ((this.state[i] === STARTING || this.state[i] === RUNNING) && !this.start_bad[i]) out.push(i);
      return out;
    }
    healthy(idx) { return idx.filter(i => !this.dead[i]); }
  }
  SH.Engines = Engines;

  // ---------- slosh tanks (flat-bottom cylinder, SP-106 / Dodge pendulum analog, 2 modes)
  const XI = [1.841184, 5.331443], J1X = [0.581865, -0.346126], J2X = [0.316028, -0.064922];
  function slosh_modes(M, m_liq, rho_l, nu, g_eff) {
    const p = M.p, RT = M.RT;
    const h = Math.max(m_liq / (rho_l * M.A_TANK), 0.01);
    const ge = Math.max(g_eff, 1e-4);
    const zw = 0.79 * Math.sqrt(nu / Math.sqrt(Math.max(ge, 0.1) * RT ** 3)) *
      (1 + 0.318 / Math.sinh(1.84 * h / RT) * (1 + (1 - h / RT) / Math.cosh(1.84 * h / RT)));
    let zb = 0.0;
    for (const zb_h of p.baffle_z_m) if (zb_h < h) {
      const d = Math.max(h - zb_h, 0.05 * RT);
      zb += 2.83 * Math.exp(-4.6 * d / RT) * Math.pow(p.baffle_w_over_R, 1.5);
    }
    const z1 = Math.min(zw + zb + p.zeta_hardware, 0.2);
    const modes = [];
    for (let n = 0; n < 2; n++) {
      const xi = XI[n], x = xi * h / RT, th_ = Math.tanh(x);
      const mn = m_liq * 2 * th_ / (xi * (xi * xi - 1) * h / RT);
      const Ln = RT / (xi * th_);
      const zn = h - (2 * RT / xi) * Math.tanh(x / 2);
      const wn = Math.sqrt(ge * xi * th_ / RT);
      modes.push([mn, Ln, zn, wn, z1 * (n === 0 ? 1 : p.zeta_mode2_factor)]);
    }
    return [h, modes, z1];
  }
  const wall_wave_r = (RT, mn, Ln, psi, rho_l, n) => mn * Ln * psi * J1X[n] * XI[n] / (rho_l * Math.PI * RT ** 3 * J2X[n]);
  const wall_wave = (M, mn, Ln, psi, rho_l, n) => mn * Ln * psi * J1X[n] * XI[n] / (rho_l * Math.PI * M.RT ** 3 * J2X[n]);

  // ---------- v3: arbitrary axisymmetric tank geometry from an area function A(z) (domes, annulus around the
  // transfer tube, narrow tube columns).  Pre-integrated on a 2 cm grid: V(h), centroid, surface radius.
  class TankGeom {
    constructor(name, zb, zt, areaFn, opts) {
      opts = opts || {};
      const dz = 0.02, n = Math.max(2, Math.ceil((zt - zb) / dz));
      this.name = name; this.zb = zb; this.zt = zt; this.dz = (zt - zb) / n; this.n = n;
      this.A = new Float64Array(n + 1); this.V = new Float64Array(n + 1); this.Mz = new Float64Array(n + 1); this.Iz = new Float64Array(n + 1);
      for (let i = 0; i <= n; i++) this.A[i] = Math.max(areaFn(zb + i * this.dz), 0);
      for (let i = 1; i <= n; i++) {
        const z = zb + (i - 0.5) * this.dz, dv = 0.5 * (this.A[i] + this.A[i - 1]) * this.dz;
        this.V[i] = this.V[i - 1] + dv; this.Mz[i] = this.Mz[i - 1] + dv * z; this.Iz[i] = this.Iz[i - 1] + dv * z * z;
      }
      this.Vcap = this.V[n]; this.baffles = opts.baffles || []; this.zeta_extra = opts.zeta_extra || 0;
      this.Rwall = opts.Rwall || Math.sqrt(Math.max(...this.A) / Math.PI);
      this.areaFn = areaFn; this.xoff = opts.xoff || 0;
    }
    idx(V) {                                   // fractional grid index for volume V
      if (V <= 0) return 0; if (V >= this.Vcap) return this.n;
      let lo = 0, hi = this.n;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.V[mid] < V) lo = mid; else hi = mid; }
      return lo + (V - this.V[lo]) / Math.max(this.V[hi] - this.V[lo], 1e-12);
    }
    level(V) { return this.idx(V) * this.dz; }  // liquid height above zb
    lerp(arr, f) { const i = Math.min(Math.floor(f), this.n - 1); return arr[i] + (arr[i + 1] - arr[i]) * (f - i); }
    // centroid z and second moment about centroid (axial) of a settled liquid volume V
    mass_props(V) {
      if (V <= 1e-9) return [this.zb, 0];
      const f = this.idx(V), Vv = Math.max(this.lerp(this.V, f), 1e-9);
      const zc = this.lerp(this.Mz, f) / Vv, Izz = this.lerp(this.Iz, f) / Vv - zc * zc;
      return [zc, Math.max(Izz, 0)];
    }
    surfA(V) { return this.lerp(this.A, this.idx(V)); }
  }
  SH.TankGeom = TankGeom;

  // Block 3 style internal layout (sources + uncertainty in README).  Station z measured from the booster base.
  SH.makeTankLayout = function (p) {
    const R = p.R_tank_m, hdA = p.aft_dome_depth_m, hdC = p.common_dome_depth_m, rT = p.tube_R_m;
    const bowl = (u, hd, r) => u <= 0 ? 0 : u >= hd ? Math.PI * r * r : Math.PI * r * r * (2 * u / hd - (u / hd) ** 2);
    const zA = p.lox_tank_bottom_m, zC = p.ch4_tank_bottom_m;
    const lt = { zb: p.lox_land_zb_m, h: p.lox_land_h_m, r: p.lox_land_R_m, cap: 0.45 };
    const capA = (z, t) => { // hemispheroid-capped cylinder area
      const u = z - t.zb, H = t.h; if (u < 0 || u > H) return 0;
      const c = Math.min(u, H - u); return c >= t.cap ? Math.PI * t.r * t.r : Math.PI * t.r * t.r * (2 * c / t.cap - (c / t.cap) ** 2);
    };
    const loxMain = new TankGeom("LOX main", zA, p.lox_tank_top_m, z =>
      bowl(z - zA, hdA, R) - (z > p.tube_zb_m ? Math.PI * rT * rT : 0) - capA(z, lt), { baffles: p.baffle_z_m.map(b => zA + b), Rwall: R });
    const ch4Main = new TankGeom("CH4 main", p.tube_valve_z_m, p.ch4_tank_top_m, z =>
      z < zC ? Math.PI * rT * rT : bowl(z - zC, hdC, R), { baffles: p.baffle_z_m.map(b => zC + b), Rwall: R });
    const loxLand = new TankGeom("LOX landing", lt.zb, lt.zb + lt.h, z => capA(z, lt), { zeta_extra: p.land_tank_zeta, Rwall: lt.r, xoff: p.lox_land_xoff_m });
    const ch4Land = new TankGeom("CH4 landing (transfer-tube column)", p.tube_zb_m, p.tube_valve_z_m, () => Math.PI * rT * rT, { zeta_extra: p.land_tank_zeta, Rwall: rT });
    return { loxMain, ch4Main, loxLand, ch4Land, lt };
  };

  // generalised modes for a geometric tank: equivalent cylinder of the free-surface radius and mean depth
  function slosh_modes_geom(M, G, m_liq, rho_l, nu, g_eff) {
    const p = M.p, V = Math.max(m_liq / rho_l, 1e-6);
    const h = G.level(V), As = Math.max(G.surfA(V), 1e-4);
    const RT = Math.sqrt(As / Math.PI);
    const he = clip(V / As, 0.02, 4 * RT);
    const ge = Math.max(g_eff, 1e-4);
    const full = V >= 0.995 * G.Vcap;
    const zw = 0.79 * Math.sqrt(nu / Math.sqrt(Math.max(ge, 0.1) * RT ** 3)) *
      (1 + 0.318 / Math.sinh(1.84 * he / RT) * (1 + (1 - he / RT) / Math.cosh(1.84 * he / RT)));
    let zb = 0.0;
    for (const zbz of G.baffles) { const bh = zbz - G.zb; if (bh < h) { const d = Math.max(h - bh, 0.05 * RT); zb += 2.83 * Math.exp(-4.6 * d / RT) * Math.pow(p.baffle_w_over_R, 1.5); } }
    // shallow pool in a dome: extra viscous/contact-line damping (estimate, grows as depth/radius -> 0)
    const shallow = he < 0.3 * RT ? 0.04 * (1 - he / (0.3 * RT)) : 0;
    const z1 = Math.min(zw + zb + p.zeta_hardware + G.zeta_extra + shallow, 0.3);
    const modes = [];
    for (let n = 0; n < 2; n++) {
      const xi = XI[n], x = xi * he / RT, th_ = Math.tanh(x);
      const mn = full ? 0 : Math.min(m_liq * 2 * th_ / (xi * (xi * xi - 1) * he / RT), m_liq * (n === 0 ? 0.92 : 0.06));
      const Ln = RT / (xi * th_);
      const zn = h - (2 * RT / xi) * Math.tanh(x / 2);
      const wn = Math.sqrt(ge * xi * th_ / RT);
      modes.push([mn, Ln, zn, wn, z1 * (n === 0 ? 1 : p.zeta_mode2_factor)]);
    }
    return [h, modes, z1, RT];
  }

  class Tank {
    constructor(M, name, m, rho_l, nu, z_bot, z_top, geom) {
      Object.assign(this, { M, p: M.p, name, m, rho: rho_l, nu, zb: z_bot, zt: z_top, geom: geom || null });
      this.zc = z_bot; this.Izz = 0; this.RTs = M.RT;
      this.psi = [0, 0]; this.psid = [0, 0]; this.zp = 0; this.zpd = 0; this.settled = true;
      this.F = 0; this.tau = 0; this.ms_active = 0; this.wave = 0; this.geff = 0; this.h = 0; this.f1 = 0; this.zeta = 0;
      this.impacts = []; this.floating = false; this.qs = 0;
    }
    step(t, dt, a_x, a_n, om, omd, ex_sign) {
      const p = this.p, M = this.M, LCG = M.LCG, G = this.geom;
      let h, modes, z1, z_liq, RTs = M.RT;
      if (G) {
        [this.zc, this.Izz] = G.mass_props(this.m / this.rho);
        z_liq = this.zc + this.zp;
      } else {
        [h, modes, z1] = slosh_modes(M, this.m, this.rho, this.nu, 1.0);
        z_liq = this.zb + this.zp + h / 2;
      }
      const g_eff = a_x - om * om * (z_liq - LCG);
      this.geff = g_eff;
      if (G) [h, modes, z1, RTs] = slosh_modes_geom(M, G, this.m, this.rho, this.nu, g_eff);
      else [h, modes, z1] = slosh_modes(M, this.m, this.rho, this.nu, g_eff);
      this.h = h; this.zeta = z1; this.RTs = RTs;
      if (this.m <= 1e-3) { this.F = 0; this.tau = 0; this.ms_active = 0; this.wave = 0; this.qs = 0; this.settled = true; this.zp = 0; this.zpd = 0; return; }
      this.zpd += -g_eff * dt;
      this.zp += this.zpd * dt;
      const top = Math.max(this.zt - this.zb - h, 0.0);
      if (this.zp <= 0.0) {
        if (this.zpd < 0) {
          const v_imp = -this.zpd;
          this.zpd = this.floating ? -this.zpd * p.resettle_restitution : 0.0;
          if (v_imp > 0.25 && this.floating) {
            this.impacts.push([t, v_imp]);
            const L0 = modes[0][1];
            const kick = Math.min(p.resettle_excite_k * v_imp / Math.sqrt(Math.max(g_eff, 0.05) * L0), 0.25);
            this.psi[0] += ex_sign * kick;
          }
        }
        this.zp = 0.0;
      } else if (this.zp >= top) {
        this.zp = top;
        if (this.zpd > 0) this.zpd = -this.zpd * p.resettle_restitution;
      }
      if (this.zp > p.settle_gap_m) this.floating = true; else if (this.zp <= 0.0) this.floating = false;
      this.settled = this.zp < p.settle_gap_m && g_eff > 0;
      this.F = 0; this.tau = 0; this.ms_active = 0; this.wave = 0; this.qs = 0;
      this.f1 = g_eff > 0 ? modes[0][3] / (2 * Math.PI) : 0.0;
      if (G && modes[0][0] <= 0) {                    // completely full (no free surface): nothing to slosh
        this.psi = [0, 0]; this.psid = [0, 0];
        this.f1 = 0; return;
      }
      if (this.settled && g_eff > 2e-3 * G0) {
        for (let n = 0; n < 2; n++) {
          const [mn, Ln, zn, wn, zt] = modes[n];
          const r_h = this.zb + this.zp + zn + Ln - LCG;
          const a_hn = a_n + r_h * omd;
          if (n === 0) this.qs = clip(-a_hn / (wn * wn * Ln), -0.6, 0.6);
          const psidd = -wn * wn * this.psi[n] - 2 * zt * wn * this.psid[n] - a_hn / Ln;
          this.psid[n] += psidd * dt;
          this.psi[n] += this.psid[n] * dt;
          const lim = Math.min(0.9 * (G ? RTs : M.RT) / Ln, 0.6);
          if (Math.abs(this.psi[n]) > lim) { this.psi[n] = Math.sign(this.psi[n]) * lim; this.psid[n] *= -0.3; }
          const Fn = mn * (g_eff * this.psi[n] + 2 * zt * wn * Ln * this.psid[n]);
          this.F += Fn; this.tau += r_h * Fn; this.ms_active += mn;
        }
        this.wave = G ? wall_wave_r(RTs, modes[0][0], modes[0][1], this.psi[0], this.rho, 0) + wall_wave_r(RTs, modes[1][0], modes[1][1], this.psi[1], this.rho, 1)
          : wall_wave(M, modes[0][0], modes[0][1], this.psi[0], this.rho, 0) + wall_wave(M, modes[1][0], modes[1][1], this.psi[1], this.rho, 1);
        if (G) this.wave = clip(this.wave, -0.9 * RTs, 0.9 * RTs);
      } else {
        const k = Math.exp(-dt / 3.0);
        for (let n = 0; n < 2; n++) { this.psi[n] *= k; this.psid[n] *= k; }
      }
    }
  }
  SH.Tank = Tank;
})(window.SH = window.SH || {});
