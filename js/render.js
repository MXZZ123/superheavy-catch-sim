/* Canvas renderer: sky/ground, Starbase-style catch tower, detailed Block 3 Super Heavy, plumes, vent jets,
   wind streaks, transparency (internals) mode and HUD.  Pure view code: reads only the run log (sim state). */
(function (SH) {
  "use strict";
  const D2R = Math.PI / 180, TOWER_H = 146, ARM_LEN = 30;
  const LOX_C = [120, 196, 255], CH4_C = [255, 170, 80];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, f) => a + (b - a) * f;
  const PH_LABEL = { FLIP: "STAGE SEP · FLIP", BOOSTBACK: "BOOSTBACK BURN", COAST: "COAST", ENTRYBURN: "ENTRY BURN", GLIDE: "GRID-FIN GLIDE", LANDING13: "LANDING BURN · 13", LANDING3: "HOVER-SLAM · 3", CAUGHT: "CAUGHT" };
  const PH_COL = { FLIP: "#b39ddb", BOOSTBACK: "#ffa726", COAST: "#90a4ae", ENTRYBURN: "#ff7043", GLIDE: "#42a5f5", LANDING13: "#ff5252", LANDING3: "#ff8a80", CAUGHT: "#69f0ae" };
  const SKY_ALT = [0, 600, 2500, 9000, 22000, 45000, 75000, 120000];
  const SKY = [[246, 179, 122], [215, 154, 134], [127, 163, 209], [62, 111, 180], [26, 60, 120], [10, 22, 52], [4, 8, 22], [2, 3, 10]];
  function skyCol(alt, k) {
    let i = 0; while (i < SKY_ALT.length - 2 && alt > SKY_ALT[i + 1]) i++;
    const f = clamp((alt - SKY_ALT[i]) / (SKY_ALT[i + 1] - SKY_ALT[i]), 0, 1);
    const c = SKY[i].map((v, j) => Math.round(lerp(v, SKY[i + 1][j], f) * (k || 1)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  // deterministic pseudo-random for static details
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // engine layout (same as physics): centre 3, inner 10, outer 20 -> (x, depth)
  const ENG = []; for (let i = 0; i < 33; i++) {
    let a, r; if (i < 3) { a = Math.PI / 2 + i * 2 * Math.PI / 3; r = 0.75; } else if (i < 13) { a = (i - 3) * 2 * Math.PI / 10; r = 2.1; } else { a = (i - 13) * 2 * Math.PI / 20 + Math.PI / 20; r = 3.95; }
    ENG.push({ x: r * Math.cos(a), d: r * Math.sin(a), ring: i < 3 ? 0 : i < 13 ? 1 : 2 });
  }
  const ENG_ORDER = ENG.map((e, i) => i).sort((a, b) => ENG[b].d - ENG[a].d);   // far first

  class Renderer {
    constructor(canvas) {
      this.cv = canvas; this.ctx = canvas.getContext("2d");
      this.cam = { x: 0, y: 100, vh: 300 }; this.mode = "follow"; this.transparent = false; this.run = null; this.ref = null;
      // low-power path for phones/tablets: capped DPR, fewer stars/streaks, simplified fin lattice
      this.lowPower = !!(window.matchMedia && (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 820px)").matches));
      const nStars = this.lowPower ? 160 : 360, nStreaks = this.lowPower ? 50 : 110;
      this.stars = Array.from({ length: nStars }, (_, i) => [hash(i), hash(i + 1000), 0.3 + hash(i + 2000) * 1.2, hash(i + 3000) * 6.28]);
      this.streaks = Array.from({ length: nStreaks }, (_, i) => [hash(i + 50), hash(i + 60), 0.6 + hash(i + 70) * 0.8, hash(i + 80)]);
      this.steel = this._steelPattern(); this.tiles = this._tilePattern();
      this.smooth = true;
    }
    _steelPattern() {
      const c = document.createElement("canvas"); c.width = 256; c.height = 256; const g = c.getContext("2d");
      g.fillStyle = "#8d969f"; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) { const y = Math.random() * 256, l = 20 + Math.random() * 120, a = Math.random() * 0.10; g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; g.fillRect(Math.random() * 256, y, 0.6, l); }
      return this.ctx.createPattern(c, "repeat");
    }
    _tilePattern() {
      const c = document.createElement("canvas"); c.width = 24; c.height = 21; const g = c.getContext("2d");
      g.fillStyle = "#23272c"; g.fillRect(0, 0, 24, 21); g.strokeStyle = "#3a4048"; g.lineWidth = 1;
      const hex = (cx, cy) => { g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.lineTo(cx + 6.5 * Math.cos(a), cy + 6.5 * Math.sin(a)); } g.closePath(); g.stroke(); };
      hex(6, 5); hex(18, 15.5); hex(18, -5.5); hex(-6, 15.5); hex(30, 15.5);
      return this.ctx.createPattern(c, "repeat");
    }
    setRun(run, ref) { this.run = run; this.ref = ref || null; this.t = 0; this._camInit = false; this.lastStart = new Float64Array(33).fill(-99); }
    resize() {
      const r = this.cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.75 : 2);
      if (!r.width || !r.height) return;
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (w !== this.cv.width || h !== this.cv.height) { this.cv.width = w; this.cv.height = h; }
      this.dpr = dpr; this.W = r.width; this.H = r.height;
    }
    // ---------- log sampling
    sample(t) {
      const L = this.run.log, T = L.t, n = T.length;
      let lo = 0, hi = n - 1;
      if (t <= T[0]) hi = 0; else if (t >= T[n - 1]) lo = hi = n - 1;
      else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
      const f = hi > lo ? (t - T[lo]) / (T[hi] - T[lo]) : 0;
      const S = { i: lo, f };
      for (const k of SH.LOGK) { const a = L[k]; if (a) S[k] = a[lo] + (a[hi] - a[lo]) * f; }
      S.phase = SH.PHASES[L.phase[f < 0.5 ? lo : hi]]; S.n = L.n[lo]; S.feed = L.feed[lo]; S.isolated = L.isolated[lo];
      S.spool = L.spool[lo]; S.state = L.state[lo]; S.t = t;
      const p = this.run.p; S.p = p;
      // pressure ratio (thin air -> wide plume)
      S.pr = SH.atmosphere(Math.max(S.yb, 0))[1] / 101325;
      return S;
    }
    // ---------- camera
    updateCamera(S, dtReal, snap) {
      const M = this.mode, alt = Math.max(S.yb, 0), L = 72.3;
      let tx, ty, vh;
      const mid = [S.xb + Math.sin(S.th) * L * 0.5, S.yb + Math.cos(S.th) * L * 0.5];
      if (M === "close") { vh = 92; tx = mid[0]; ty = mid[1]; }
      else if (M === "fins") { vh = 22; const zc = 67.6, xo = 5.0; tx = S.xb + Math.sin(S.th) * zc + Math.cos(S.th) * xo; ty = S.yb + Math.cos(S.th) * zc - Math.sin(S.th) * xo; }
      else if (M === "tanks") { vh = 44; const zc = 19; tx = S.xb + Math.sin(S.th) * zc; ty = S.yb + Math.cos(S.th) * zc; }
      else if (M === "wide") {
        vh = Math.max(380, alt * 2.3 + Math.abs(S.xb) * 0.9);
        tx = S.xb * 0.5; ty = vh * 0.42;
      } else { vh = alt < 1500 ? 280 : Math.min(280 + (alt - 1500) * 0.02, 600); tx = mid[0]; ty = mid[1] + vh * 0.06; }
      const asp = this.W / this.H;
      if (ty - vh / 2 < -vh * 0.06 && M !== "close" && M !== "tanks" && M !== "fins") ty = vh / 2 - vh * 0.06;
      if ((M === "close" || M === "tanks" || M === "fins") && ty - vh / 2 < -8) ty = vh / 2 - 8;
      const k = snap || !this._camInit ? 1 : 1 - Math.exp(-dtReal * 6);
      this.cam.x = lerp(this.cam.x, tx, k); this.cam.y = lerp(this.cam.y, ty, k);
      this.cam.vh = Math.exp(lerp(Math.log(this.cam.vh), Math.log(vh), k)); this._camInit = true;
      this.k = this.H / this.cam.vh; this.asp = asp;
    }
    sx(x) { return this.W / 2 + (x - this.cam.x) * this.k; }
    sy(y) { return this.H / 2 - (y - this.cam.y) * this.k; }

    draw(t, dtReal, snap) {
      const c = this.ctx; if (!this.run) return;
      if (!this.W) this.resize();
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const S = this.sample(t); this.S = S;
      this.updateCamera(S, dtReal || 0.016, snap);
      this.drawSky(S); this.drawGround(S); this.drawTrail(S);
      this.drawTower(S, t, false);
      this.drawWindStreaks(S, t);
      this.drawVehicle(S, t);
      this.drawTower(S, t, true);              // arms in front of the booster
      if (!this.hideHud) this.drawHUD(S, t);
    }
    // ---------- background
    drawSky(S) {
      const c = this.ctx, W = this.W, H = this.H;
      const yTop = this.cam.y + this.cam.vh / 2, yBot = this.cam.y - this.cam.vh / 2;
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, skyCol(Math.max(yTop, 0))); g.addColorStop(1, skyCol(Math.max(yBot, 0)));
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      const night = clamp((S.yb - 15000) / 40000, 0, 1);
      if (night > 0) for (const [u, v, r, ph] of this.stars) {
        c.fillStyle = `rgba(255,255,255,${night * (0.45 + 0.4 * Math.sin(ph + S.t * 0.7))})`;
        c.fillRect(u * W, v * H, r, r);
      }
      // low sun glow on the western horizon (dusk)
      const hy = this.sy(0);
      if (hy < H * 1.6) {
        const sg = c.createRadialGradient(W * 0.12, hy, 0, W * 0.12, hy, H * 0.9);
        sg.addColorStop(0, "rgba(255,210,150,0.35)"); sg.addColorStop(1, "rgba(255,210,150,0)");
        c.fillStyle = sg; c.fillRect(0, 0, W, H);
      }
    }
    drawGround(S) {
      const c = this.ctx, W = this.W, H = this.H, gy = this.sy(0);
      if (gy > H + 5) return;
      // land (west) and Gulf (east, +x offshore)
      const beach = this.sx(2600);
      let g = c.createLinearGradient(0, gy, 0, H);
      g.addColorStop(0, "#5e5a46"); g.addColorStop(1, "#2e2c22");
      c.fillStyle = g; c.fillRect(0, gy, Math.min(Math.max(beach, 0), W), H - gy);
      if (beach < W) {
        g = c.createLinearGradient(0, gy, 0, H); g.addColorStop(0, "#3f6f8f"); g.addColorStop(1, "#1d3546");
        c.fillStyle = g; c.fillRect(Math.max(beach, 0), gy, W - Math.max(beach, 0), H - gy);
        c.fillStyle = "#d8c79a"; c.fillRect(Math.max(beach - 60 * this.k, 0), gy, 60 * this.k, Math.max(2, 2 * this.k));
        c.strokeStyle = "rgba(255,255,255,0.25)"; c.lineWidth = 1;
        for (let i = 0; i < 6; i++) { const yy = gy + 3 + i * i * 3; if (yy > H) break; c.beginPath(); c.moveTo(Math.max(beach, 0), yy); c.lineTo(W, yy); c.stroke(); }
      }
      // pad apron and Mega Bays in the distance
      c.fillStyle = "#6b6a63"; c.fillRect(this.sx(-80), gy, 160 * this.k, Math.max(1, 1.2 * this.k));
      c.fillStyle = "rgba(40,50,66,0.85)";
      for (const [bx, bw, bh] of [[-1650, 110, 95], [-1500, 80, 80], [-1380, 60, 55], [-1900, 140, 60], [-700, 40, 30], [-520, 25, 70]])
        c.fillRect(this.sx(bx), this.sy(bh), bw * this.k, bh * this.k);
      // horizon haze
      const hz = c.createLinearGradient(0, gy - 30, 0, gy + 4); hz.addColorStop(0, "rgba(255,220,190,0)"); hz.addColorStop(1, "rgba(255,220,190,0.25)");
      c.fillStyle = hz; c.fillRect(0, gy - 30, W, 34);
    }
    drawTrail(S) {
      const c = this.ctx, L = this.run.log; if (this.mode === "close") return;
      const tr = (log, col, dash) => {
        c.strokeStyle = col; c.lineWidth = 1.5; c.setLineDash(dash || []); c.beginPath();
        let started = false;
        for (let i = 0; i < log.t.length && log.t[i] <= S.t; i += 2) { const X = this.sx(log.xb[i]), Y = this.sy(log.yb[i]); if (!started) { c.moveTo(X, Y); started = true; } else c.lineTo(X, Y); }
        c.stroke(); c.setLineDash([]);
      };
      if (this.ref) tr(this.ref.log, "rgba(255,255,255,0.35)", [6, 5]);
      tr(L, "rgba(120,200,255,0.55)");
    }
    // ---------- tower (behind: lattice, rails, carriage, QD arm, launch mount; front: chopstick arms)
    drawTower(S, t, front) {
      const c = this.ctx, k = this.k, p = this.run.p, X = x => this.sx(x), Y = y => this.sy(y);
      if (X(-40) > this.W + 50 || X(40) < -50 || Y(TOWER_H + 25) > this.H + 50) return;
      const lw = clamp(0.25 * k, 0.4, 3), armTop = p.arm_top_m, gap = S.arm_gap;
      if (!front) {
        const x0 = -9, x1 = 9;
        // tower body silhouette & lattice
        c.fillStyle = "rgba(12,16,22,0.93)"; c.fillRect(X(x0), Y(TOWER_H), (x1 - x0) * k, TOWER_H * k);
        const bay = 9;
        c.lineWidth = lw * 1.6; c.strokeStyle = "#566273";
        for (const xx of [x0, x0 + 0.8, x1 - 0.8, x1]) { c.beginPath(); c.moveTo(X(xx), Y(0)); c.lineTo(X(xx), Y(TOWER_H)); c.stroke(); }
        c.lineWidth = lw; c.strokeStyle = "#3b4554";
        for (let y = 0; y < TOWER_H; y += bay) {
          c.beginPath(); c.moveTo(X(x0), Y(y)); c.lineTo(X(x1), Y(y)); c.stroke();
          // K-bracing and X-bracing alternate
          c.beginPath();
          if ((y / bay) % 2 === 0) { c.moveTo(X(x0), Y(y)); c.lineTo(X(0), Y(y + bay / 2)); c.lineTo(X(x0), Y(y + bay)); c.moveTo(X(x1), Y(y)); c.lineTo(X(0), Y(y + bay / 2)); c.lineTo(X(x1), Y(y + bay)); }
          else { c.moveTo(X(x0), Y(y)); c.lineTo(X(x1), Y(y + bay)); c.moveTo(X(x1), Y(y)); c.lineTo(X(x0), Y(y + bay)); }
          c.stroke();
          if (k > 2.5) { // secondary members, platforms, cable trays
            c.strokeStyle = "#2c3440"; c.lineWidth = lw * 0.6;
            c.beginPath(); c.moveTo(X(x0), Y(y + bay / 2)); c.lineTo(X(x1), Y(y + bay / 2)); c.stroke();
            c.fillStyle = "#1e252e"; c.fillRect(X(x0 - 1.4), Y(y + 0.4), 1.4 * k, 0.4 * k);
            c.strokeStyle = "#3b4554"; c.lineWidth = lw;
          }
        }
        // elevator shaft + cable trays
        c.fillStyle = "rgba(60,70,84,0.55)"; c.fillRect(X(-2.2), Y(TOWER_H - 6), 4.4 * k, (TOWER_H - 6) * k);
        // rails on the tower face (carriage tracks)
        c.strokeStyle = "#aab6c4"; c.lineWidth = lw * 1.8;
        for (const xx of [-6.2, 6.2]) { c.beginPath(); c.moveTo(X(xx), Y(20)); c.lineTo(X(xx), Y(TOWER_H - 4)); c.stroke(); }
        // tower top: crown, crane/pulley house, antennas
        c.fillStyle = "#2a323e"; c.fillRect(X(x0 - 1.5), Y(TOWER_H + 4), (x1 - x0 + 3) * k, 4 * k);
        c.fillStyle = "#363f4c"; c.fillRect(X(-5), Y(TOWER_H + 9), 10 * k, 5 * k);
        c.strokeStyle = "#7d8896"; c.lineWidth = lw; c.beginPath(); c.moveTo(X(3), Y(TOWER_H + 9)); c.lineTo(X(3), Y(TOWER_H + 22)); c.moveTo(X(-3), Y(TOWER_H + 9)); c.lineTo(X(-3), Y(TOWER_H + 16)); c.stroke();
        // ship quick-disconnect (QD) arm, stowed alongside the tower at ~106 m
        const qy = 106;
        c.fillStyle = "#313a47"; c.beginPath(); c.moveTo(X(x1), Y(qy)); c.lineTo(X(x1 + 22), Y(qy + 1)); c.lineTo(X(x1 + 22), Y(qy + 4)); c.lineTo(X(x1), Y(qy + 6)); c.closePath(); c.fill();
        c.strokeStyle = "#5c6878"; c.lineWidth = lw * 0.8; c.beginPath();
        for (let i = 0; i <= 8; i++) { const xx = x1 + i * 2.75; c.moveTo(X(xx), Y(qy + 0.2 + i * 0.12)); c.lineTo(X(xx + 2.75), Y(qy + 5.8 - i * 0.22)); }
        c.stroke(); c.fillStyle = "#4a5565"; c.fillRect(X(x1 + 20), Y(qy + 6), 3 * k, 7 * k);
        // carriage (rides the rails) at arm height
        c.fillStyle = "#2f3946"; c.fillRect(X(x0 - 1.5), Y(armTop + 3), (x1 - x0 + 3) * k, 12 * k);
        if (k > 2) { c.fillStyle = "#566273"; for (const xx of [-7.2, 5.6]) c.fillRect(X(xx), Y(armTop + 2), 1.6 * k, 10 * k); c.fillStyle = "#c9a227"; c.fillRect(X(-1), Y(armTop + 1.5), 2 * k, 2.4 * k); }
        // orbital launch mount: legs, table, ring with clamps, booster QD, flame deflector
        c.fillStyle = "#3a4350";
        for (const xx of [-11.5, -4.5, 4.5, 11.5]) c.fillRect(X(xx - 1.6), Y(20), 3.2 * k, 20 * k);
        c.fillStyle = "#4b5564"; c.fillRect(X(-13.5), Y(24.5), 27 * k, 4.5 * k);
        c.fillStyle = "#5b6574"; c.fillRect(X(-7), Y(27.5), 14 * k, 3 * k);
        c.fillStyle = "#8f9aa8"; for (let i = -5; i <= 5; i++) c.fillRect(X(i * 1.25 - 0.3), Y(28.6), 0.6 * k, 1.1 * k);
        c.fillStyle = "#3b4350"; c.fillRect(X(13.5), Y(27), 5 * k, 5 * k);   // BQD
        c.fillStyle = "#59636f"; c.beginPath(); c.moveTo(X(-10), Y(0)); c.lineTo(X(0), Y(5)); c.lineTo(X(10), Y(0)); c.closePath(); c.fill();
        // lighting: aviation lights (blink), floodlights with glow
        const blink = (Math.floor(t * 1.5) % 2) === 0;
        const glow = (x, y, r, col) => { const g = c.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r); g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = g; c.beginPath(); c.arc(X(x), Y(y), r, 0, 7); c.fill(); };
        c.globalCompositeOperation = "lighter";
        if (blink) for (const yy of [TOWER_H + 22, 100, 60]) glow(yy > TOWER_H ? 3 : x1, yy, Math.max(4, 1.6 * k), "rgba(255,40,30,0.95)");
        for (const [xx, yy] of [[x0, 40], [x1, 40], [x0, 88], [x1, 88], [x0, TOWER_H], [x1, TOWER_H], [-13.5, 29], [13.5, 29]]) glow(xx, yy, Math.max(5, 3.5 * k), "rgba(255,244,214,0.75)");
        c.globalCompositeOperation = "source-over";
      } else {
        // chopstick arms: truss box beams with catch rails, bumpers and actuators
        const armH = 5;
        for (const sg of [-1, 1]) {
          const xi = sg * gap, xo = sg * (gap + ARM_LEN), xa = Math.min(xi, xo), xb2 = Math.max(xi, xo);
          c.fillStyle = "rgba(48,58,72,0.96)"; c.fillRect(X(xa), Y(armTop), (xb2 - xa) * k, armH * k);
          c.strokeStyle = "#8795a7"; c.lineWidth = lw;
          c.beginPath(); const nb = 10;
          for (let i = 0; i < nb; i++) { const a = xi + (xo - xi) * i / nb, b = xi + (xo - xi) * (i + 1) / nb; c.moveTo(X(a), Y(armTop - armH)); c.lineTo(X(b), Y(armTop)); c.moveTo(X(b), Y(armTop - armH)); c.lineTo(X(b), Y(armTop)); }
          c.stroke();
          c.strokeStyle = "#d0d8e2"; c.lineWidth = lw * 2.2; c.beginPath(); c.moveTo(X(xi), Y(armTop)); c.lineTo(X(xo), Y(armTop)); c.stroke();   // catch rail
          c.strokeStyle = "#8795a7"; c.lineWidth = lw * 1.4; c.beginPath(); c.moveTo(X(xi), Y(armTop - armH)); c.lineTo(X(xo), Y(armTop - armH)); c.stroke();
          c.fillStyle = "#ffcc00"; c.fillRect(X(xi - sg * 0.6 - 0.6), Y(armTop + 0.5), 1.2 * k, (armH + 1.5) * k);   // bumper
          if (k > 2.5) { c.fillStyle = "#c9cfd6"; c.fillRect(X(xo - sg * 4 - 1), Y(armTop - armH - 0.5), 2 * k, 1 * k); }   // actuator
          if (k > 3) { c.fillStyle = "rgba(255,240,200,0.9)"; c.fillRect(X(xi + sg * 3), Y(armTop - armH + 0.3), 0.6 * k, 0.4 * k); }
        }
      }
    }
    // ---------- wind streaks (screen-space drift; exaggerated for visibility)
    drawWindStreaks(S, t) {
      const c = this.ctx, W = this.W, H = this.H, w = S.wind_x;
      if (S.yb > 30000 || Math.abs(w) < 0.5) return;
      const a = clamp(Math.abs(w) / 25, 0.08, 0.45);
      c.strokeStyle = `rgba(255,255,255,${a})`; c.lineWidth = 1;
      for (const [u, v, s, ph] of this.streaks) {
        const x = ((u * W + t * w * 18 * s) % W + W) % W, y = v * H, len = clamp(Math.abs(w) * 2.2 * s, 6, 70);
        c.beginPath(); c.moveTo(x, y); c.lineTo(x - Math.sign(w) * len, y); c.stroke();
      }
    }
    // ---------- vehicle
    drawVehicle(S, t) {
      const c = this.ctx, k = this.k, p = this.run.p;
      let scale = 1, pxH = 72.3 * k;
      if (pxH < 34) scale = 34 / pxH;      // wide view: enlarge icon so it stays visible
      c.save();
      c.translate(this.sx(S.xb), this.sy(S.yb)); c.rotate(S.th); c.scale(k * scale, -k * scale);   // body frame: x across, z up (metres)
      this.bodyScale = k * scale;
      this.drawPlume(S, t);
      this.drawVentJets(S, t);
      this.drawEngines(S, t);
      this.drawBody(S, t);
      if (this.transparent) this.drawInternals(S, t);
      this.drawFins(S, t);
      c.restore();
      if (scale > 1.01) { c.fillStyle = "rgba(255,255,255,0.7)"; c.font = "10px sans-serif"; c.fillText(`booster ×${scale.toFixed(0)}`, this.sx(S.xb) + 12, this.sy(S.yb) - 10); }
    }
    drawPlume(S, t) {
      const c = this.ctx, thr = S.thr, n = S.n; if (n <= 0 || thr < 0.03) return;
      const pr = clamp(S.pr, 0, 1), spread = 1 + (1 - pr) * 3.2;
      const len = (18 + 70 * thr) * (0.7 + 0.5 * Math.sqrt(n / 13)) * (1 + (1 - pr) * 1.5);
      const w0 = n >= 13 ? 7.6 : n >= 3 ? 3.0 : 1.6, w1 = w0 * spread * (1.4 + 0.6 * thr);
      const gim = (S.gimbal || 0) * D2R * 0.6;
      c.save(); c.rotate(-gim); c.globalCompositeOperation = "lighter";
      for (let layer = 0; layer < 3; layer++) {
        const L = len * [1.0, 0.7, 0.35][layer], wa = w1 * [1, 0.6, 0.3][layer];
        const g = c.createLinearGradient(0, -1, 0, -L);
        const cols = [["rgba(255,140,60,0.35)", "rgba(255,90,40,0)"], ["rgba(255,190,110,0.55)", "rgba(255,120,60,0)"], ["rgba(255,255,235,0.95)", "rgba(200,170,255,0)"]][layer];
        g.addColorStop(0, cols[0]); g.addColorStop(1, cols[1]);
        c.fillStyle = g; c.beginPath();
        const fl = 1 + 0.06 * Math.sin(t * 40 + layer * 2);
        c.moveTo(-w0 / 2, -1.5); c.quadraticCurveTo(-wa * 0.8, -L * 0.4, -wa / 2 * fl, -L); c.lineTo(wa / 2 * fl, -L); c.quadraticCurveTo(wa * 0.8, -L * 0.4, w0 / 2, -1.5); c.closePath(); c.fill();
      }
      if (pr > 0.5) {   // shock diamonds at low altitude
        c.fillStyle = "rgba(255,240,220,0.5)";
        for (let i = 1; i <= 5; i++) { const zz = -2 - i * 5.5 * (0.8 + thr * 0.4), ww = w0 * 0.35 * (1 - i * 0.12); c.beginPath(); c.moveTo(0, zz + 1.6); c.lineTo(ww, zz); c.lineTo(0, zz - 1.6); c.lineTo(-ww, zz); c.closePath(); c.fill(); }
      }
      c.restore();
      // ground interaction: dust/steam when low
      const h = S.yb;
      if (h < 90 && thr > 0.05) {
        c.save(); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        const gx = this.sx(S.xb), gy = this.sy(0), r = (90 - h) * 1.2 * this.k;
        const g = c.createRadialGradient(gx, gy, 0, gx, gy, r); g.addColorStop(0, "rgba(230,220,210,0.45)"); g.addColorStop(1, "rgba(230,220,210,0)");
        c.fillStyle = g; c.fillRect(gx - r, gy - r * 0.5, 2 * r, r * 0.5); c.restore();
      }
    }
    drawVentJets(S, t) {
      const c = this.ctx, F = S.F_vent || 0; if (F <= 1) return;
      c.save(); c.globalCompositeOperation = "source-over";
      const jets = [];
      if (S.vent_o > 1) jets.push([36.5, S.vent_o / 1500]);
      if (S.vent_f > 1) jets.push([64.5, S.vent_f / 600]);
      for (const [z, a] of jets) for (const sg of [-1, 1]) for (let i = 0; i < 14; i++) {
        const ph = (t * 3 + i / 14 + (sg > 0 ? 0.37 : 0)) % 1, d = 4.6 + ph * 14 * (0.6 + a), r = 0.3 + ph * 2.4;
        c.fillStyle = `rgba(235,245,255,${(1 - ph) * 0.55 * clamp(a, 0.3, 1)})`;
        c.beginPath(); c.arc(sg * d, z + ph * 3 + Math.sin(i * 7 + t * 5) * ph * 1.5, r, 0, 7); c.fill();
      }
      c.restore();
    }
    drawEngines(S, t) {
      const c = this.ctx, st = S.state, sp = S.spool, gim = (S.gimbal || 0) * D2R;
      for (const i of ENG_ORDER) {
        const e = ENG[i], x = e.x, sh = 0.75 + 0.25 * (e.d + 4) / 8;
        const g = e.ring < 2 ? gim : 0;
        c.save(); c.translate(x, 0.6); c.rotate(-g);
        const hot = sp ? sp[i] : 0;
        const col = st && st[i] === 4 ? [120, 50, 50] : [Math.round(90 * sh + 120 * hot), Math.round(90 * sh + 40 * hot), Math.round(96 * sh)];
        c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        const bw = e.ring === 2 ? 0.75 : 0.65, len = e.ring === 2 ? 2.6 : 2.9;
        c.beginPath(); c.moveTo(-0.28, 0); c.lineTo(-bw, -len); c.lineTo(bw, -len); c.lineTo(0.28, 0); c.closePath(); c.fill();
        if (hot > 0.05) { c.fillStyle = `rgba(255,160,90,${0.6 * hot})`; c.fillRect(-bw * 0.9, -len - 0.15, bw * 1.8, 0.35); }
        c.restore();
      }
    }
    drawBody(S, t) {
      const c = this.ctx, R = 4.5, L = 72.3, bs = this.bodyScale, alpha = this.transparent ? 0.16 : 1;
      c.save(); c.globalAlpha = alpha;
      // cylinder shading + brushed steel
      c.save(); c.beginPath(); c.rect(-R, 0, 2 * R, 69.2); c.clip();
      c.save(); c.scale(1 / 18, 1 / 18); c.fillStyle = this.steel; c.fillRect(-R * 18, 0, 2 * R * 18, 69.2 * 18); c.restore();
      const g = c.createLinearGradient(-R, 0, R, 0);
      g.addColorStop(0, "rgba(10,14,20,0.70)"); g.addColorStop(0.22, "rgba(255,255,255,0.10)"); g.addColorStop(0.36, "rgba(255,255,255,0.28)");
      g.addColorStop(0.55, "rgba(0,0,0,0.05)"); g.addColorStop(1, "rgba(10,14,20,0.78)");
      c.fillStyle = g; c.fillRect(-R, 0, 2 * R, 69.2);
      if (!this.transparent) this.drawFrost(S, R);
      // weld lines: 1.83 m rings; staggered vertical panel seams; stringer hints
      if (bs > 1.6) {
        c.lineWidth = Math.max(0.6 / bs, 0.025);
        for (let z = 1.83, j = 0; z < 69.1; z += 1.83, j++) {
          c.strokeStyle = "rgba(40,44,50,0.55)"; c.beginPath(); c.moveTo(-R, z); c.lineTo(R, z); c.stroke();
          c.strokeStyle = "rgba(255,255,255,0.12)"; c.beginPath(); c.moveTo(-R, z + 0.05); c.lineTo(R, z + 0.05); c.stroke();
          c.strokeStyle = "rgba(40,44,50,0.35)";
          for (const xs of (j % 2 ? [-2.6, 1.2, 3.9] : [-3.7, -0.4, 2.7])) { c.beginPath(); c.moveTo(xs, z - 1.83); c.lineTo(xs, z); c.stroke(); }
        }
        if (bs > 6) { c.strokeStyle = "rgba(30,34,40,0.45)"; c.lineWidth = 0.05; for (const xs of [-1.9, 0.15, 2.3]) for (let z = 58; z < 69; z += 3.66) { c.beginPath(); c.moveTo(xs, z); c.lineTo(xs, z + 1.2); c.stroke(); } }
        if (bs > 4) { c.strokeStyle = "rgba(0,0,0,0.08)"; for (let xs = -R + 0.45; xs < R; xs += 0.45) { c.beginPath(); c.moveTo(xs, 4); c.lineTo(xs, 66); c.stroke(); } }
      }
      // soot: heavier near the aft end, grows with burn history / entry heating
      const soot = clamp(0.15 + (S.t > 46 ? 0.25 : S.t / 46 * 0.25) + (S.phase === "LANDING13" || S.phase === "LANDING3" || S.phase === "CAUGHT" ? 0.25 : 0), 0, 0.7);
      const sg = c.createLinearGradient(0, 0, 0, 30); sg.addColorStop(0, `rgba(20,16,12,${soot + 0.2})`); sg.addColorStop(1, "rgba(20,16,12,0)");
      c.fillStyle = sg; c.fillRect(-R, 0, 2 * R, 30);
      for (let i = 0; i < 18; i++) { const x = -R + hash(i + 9) * 2 * R, h = 6 + hash(i + 19) * 18; c.fillStyle = `rgba(25,20,15,${soot * 0.35})`; c.fillRect(x, 0, 0.25 + hash(i) * 0.5, h); }
      c.restore();
      // chines (Block 3 side fairings housing COPVs / avionics)
      c.fillStyle = "#7c858f";
      for (const sg2 of [-1, 1]) { c.fillRect(sg2 > 0 ? R - 0.05 : -R - 0.45, 6, 0.5, 52); }
      // aft skirt with metallic heat-shield tiles
      c.save(); c.beginPath(); c.rect(-R, 0, 2 * R, 3.2); c.clip(); c.save(); c.scale(1 / 10, 1 / 10); c.fillStyle = this.tiles; c.fillRect(-R * 10, 0, 2 * R * 10, 32); c.restore();
      const ag = c.createLinearGradient(-R, 0, R, 0); ag.addColorStop(0, "rgba(0,0,0,0.6)"); ag.addColorStop(0.35, "rgba(255,255,255,0.08)"); ag.addColorStop(1, "rgba(0,0,0,0.6)"); c.fillStyle = ag; c.fillRect(-R, 0, 2 * R, 3.2); c.restore();
      // integrated hot-staging ring: open crown of V struts between the barrel top and a thin top ring; the forward
      // dome is visible through it (matches 2025-26 Block 3 photos; ~3.1 m tall here, NSF quotes "nearly four-meter")
      const zb0 = 69.2, zt0 = 72.3;
      { const dg = c.createLinearGradient(-R, 0, R, 0); dg.addColorStop(0, "#5d646d"); dg.addColorStop(0.35, "#e3e8ee"); dg.addColorStop(0.6, "#aab2bb"); dg.addColorStop(1, "#4f565e");
        c.fillStyle = dg; c.beginPath(); c.moveTo(-R + 0.1, zb0); c.ellipse(0, zb0, R - 0.1, 2.0, 0, Math.PI, 0, true); c.closePath(); c.fill();
        c.strokeStyle = "rgba(40,44,50,0.5)"; c.lineWidth = Math.max(0.6 / bs, 0.03); c.beginPath(); c.ellipse(0, zb0, R * 0.55, 1.2, 0, Math.PI, 0, true); c.stroke(); }
      const nV = 8, pw = 2 * R / nV;
      c.strokeStyle = "#a9b1ba"; c.lineWidth = 0.26; c.lineJoin = "bevel"; c.beginPath();
      for (let i = 0; i <= nV; i++) { const x = -R + i * pw; c[i ? "lineTo" : "moveTo"](x, zt0 - 0.35); if (i < nV) c.lineTo(x + pw / 2, zb0 + 0.25); }
      c.stroke();
      c.strokeStyle = "rgba(30,34,40,0.6)"; c.lineWidth = 0.07; c.stroke();
      c.fillStyle = "#8d959e"; for (let i = 0; i < nV; i++) c.fillRect(-R + i * pw + pw / 2 - 0.3, zb0, 0.6, 0.55);   // strut feet / brackets
      { const rg = c.createLinearGradient(-R, 0, R, 0); rg.addColorStop(0, "#666e77"); rg.addColorStop(0.35, "#eef2f6"); rg.addColorStop(1, "#5a616a"); c.fillStyle = rg; c.fillRect(-R, zt0 - 0.4, 2 * R, 0.4); }
      c.restore();
      // outline
      c.strokeStyle = this.transparent ? "rgba(200,220,240,0.6)" : "rgba(20,24,30,0.9)"; c.lineWidth = Math.max(1 / bs, 0.03);
      c.strokeRect(-R, 0, 2 * R, 69.2); void L;
    }
    drawFrost(S, R) {
      const c = this.ctx, p = this.run.p, L = S;
      const heat = clamp((S.q || 0) / 120e3, 0, 1);
      const bands = [];
      const zA = p.lox_tank_bottom_m;
      if (L.lox_h > 0.05) bands.push([zA, zA + L.lox_h + 0.4]);
      if (L.loxL_h > 0.05) bands.push([p.lox_land_zb_m, p.lox_land_zb_m + L.loxL_h]);
      const zch = p.v3 ? p.tube_valve_z_m + L.ch4_h : p.ch4_tank_bottom_m + L.ch4_h;
      if (L.ch4_m > 50 && zch > p.ch4_tank_bottom_m) bands.push([p.ch4_tank_bottom_m, zch + 0.3]);
      for (const [z0, z1] of bands) {
        if (z1 - z0 < 0.05) continue;
        const a = 0.55 * (1 - 0.8 * heat);
        c.fillStyle = `rgba(240,248,255,${a})`; c.fillRect(-R, z0, 2 * R, z1 - z0);
        for (let i = 0; i < 40; i++) { const x = -R + hash(i + z0) * 2 * R, z = z0 + hash(i * 3 + z1) * (z1 - z0); c.fillStyle = `rgba(255,255,255,${a * 0.6})`; c.fillRect(x, z, 0.3 + hash(i) * 0.8, 0.1 + hash(i + 5) * 0.5); }
        const tg = c.createLinearGradient(0, z1 - 0.6, 0, z1 + 0.6); tg.addColorStop(0, `rgba(255,255,255,${a * 0.8})`); tg.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = tg; c.fillRect(-R, z1 - 0.6, 2 * R, 1.2);
      }
    }
    // ---------- Block 3 grid fins (3 fins in a T: port + starboard side fins, one belly fin toward the camera).
    // Matched to 2025-26 photos of the new fins: dark/charcoal, chunky hexagonal planform (cropped root and tip corners),
    // deep egg-crate lattice with arched/scalloped cell walls, each on a stubby steel hinge/actuator block with a wedge
    // fairing on the hull, sitting a few metres below the open hot-stage crown.  Lattice faces are perpendicular to the
    // booster axis; a view-from-below elevation (E) shows the underside with correct foreshortening.  Each fin deflects
    // about its own radial hinge axis.
    finGeom() {
      return { zh: 67.2, S: 4.6, Wm: 4.4, Wr: 3.0, Wt: 3.1, cu0: 0.9, cu1: 1.0, d: 1.2, pod: 0.8, p: 0.52, frame: 0.2 };
    }
    drawFins(S, t) {
      const c = this.ctx, bs = this.bodyScale, R = 4.5, G = this.finGeom(), E = 13 * D2R, sinE = Math.sin(E);
      const tr = this.transparent;
      // deflection [rad] (visual): belly fin carries the in-plane pitch command, side fins follow at 0.6x. Max ±20 deg.
      const cmd = clamp(S.fin || 0, -1, 1), dB = cmd * 20 * D2R, dS = cmd * 12 * D2R;
      const icon = bs < 1.6;
      const heat = clamp(((S.t || 0) - 150) / 80, 0, 1) * 0.7 + 0.3;
      c.save(); c.globalAlpha = tr ? 0.8 : 1;
      if (!icon) this._hullPods(G, R, bs, tr);
      for (const sg of [-1, 1]) this._fin(G, R, sg, dS * sg, E, sinE, bs, icon, heat, tr);
      this._fin(G, R, 0, dB, E, sinE, bs, icon, heat, tr);
      if (!icon) {   // catch hardpoints under the side fins (chopstick arms lift here); underside = 66.0 m catch station
        for (const sg of [-1, 1]) {
          const xa = sg * R, xb = sg * (R + 1.25), x = Math.min(xa, xb), w = Math.abs(xb - xa);
          const ng = c.createLinearGradient(0, 66.0, 0, 66.6); ng.addColorStop(0, "#3c424a"); ng.addColorStop(0.45, "#d7dde3"); ng.addColorStop(1, "#80878f");
          c.fillStyle = ng; c.fillRect(x, 66.0, w, 0.5);
          c.strokeStyle = "rgba(20,22,26,0.85)"; c.lineWidth = Math.max(0.7 / bs, 0.02); c.strokeRect(x, 66.0, w, 0.5);
        }
      }
      c.restore();
    }
    _steelGrad(x0, y0, x1, y1, tr) {
      const g = this.ctx.createLinearGradient(x0, y0, x1, y1), a = tr ? 0.6 : 1;
      g.addColorStop(0, `rgba(88,95,104,${a})`); g.addColorStop(0.4, `rgba(226,231,236,${a})`); g.addColorStop(0.7, `rgba(150,158,167,${a})`); g.addColorStop(1, `rgba(72,78,86,${a})`);
      return g;
    }
    _hullPods(G, R, bs, tr) {
      const c = this.ctx, lw = Math.max(0.7 / bs, 0.025), zh = G.zh;
      c.strokeStyle = "rgba(20,24,30,0.8)"; c.lineWidth = lw;
      for (const sg of [-1, 1]) {   // side fins seen in profile: wedge fairing below a stubby steel hinge/actuator block
        const x0 = sg * R, x1 = sg * (R + G.pod);
        c.fillStyle = this._steelGrad(0, zh - 2.4, 0, zh - 0.5, tr);
        c.beginPath(); c.moveTo(x0, zh - 2.6); c.lineTo(sg * (R + G.pod * 0.85), zh - 0.55); c.lineTo(x0, zh - 0.55); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = this._steelGrad(0, zh - 0.6, 0, zh + 0.6, tr);
        c.beginPath(); c.rect(Math.min(x0, x1), zh - 0.6, G.pod, 1.2); c.fill(); c.stroke();
        c.fillStyle = "rgba(30,34,40,0.55)"; c.fillRect(Math.min(x0, x1) + 0.1, zh - 0.12, G.pod - 0.2, 0.08);   // bearing seam
      }
      // belly fin block seen head-on (wedge fairing below it) – drawn behind the fin
      c.fillStyle = this._steelGrad(-0.9, 0, 0.9, 0, tr);
      c.beginPath(); c.moveTo(-0.75, zh - 0.55); c.lineTo(0.75, zh - 0.55); c.lineTo(0.35, zh - 2.6); c.lineTo(-0.35, zh - 2.6); c.closePath(); c.fill(); c.stroke();
      this._rrect(-0.75, zh - 0.6, 1.5, 1.2, 0.15); c.fill(); c.stroke();
    }
    _rrect(x, y, w, h, r) { const c = this.ctx; c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath(); }
    // one fin: sg = -1/+1 side fin (radial ∓x, hinge axis along x), sg = 0 belly fin (radial toward viewer)
    _fin(G, R, sg, dl, E, sinE, bs, icon, heat, tr) {
      const c = this.ctx, cd = Math.cos(dl), sd = Math.sin(dl), r0 = R + G.pod;
      // fin-local (u radial from root, v tangential, w axial) -> body-frame screen (x, z); view from below: nearer = higher
      const P = (u, v, w) => {
        const vv = v * cd - w * sd, zz = G.zh + v * sd + w * cd;
        return sg ? [sg * (r0 + u), zz + vv * sinE] : [vv, zz + (G.pod + u) * sinE];
      };
      if (icon) {   // wide shot: exaggerated high-contrast silhouette (side fins only)
        if (!sg) return;
        const x0 = sg * R, x1 = sg * (R + 10), z0 = G.zh - 2.2, z1 = G.zh + 2.2;
        c.save(); c.translate(x0, G.zh); c.rotate(dl * sg); c.translate(-x0, -G.zh);
        c.fillStyle = "#e1e6eb"; c.fillRect(Math.min(x0, x1), z0, 10, z1 - z0);
        c.fillStyle = "#24282d"; c.fillRect(Math.min(x0, x1) + 0.9, z0 + 0.9, 10 - 1.8, z1 - z0 - 1.8);
        c.restore(); return;
      }
      const hw = G.Wm / 2;
      const outline = [[0, -G.Wr / 2], [G.cu0, -hw], [G.S - G.cu1, -hw], [G.S, -G.Wt / 2], [G.S, G.Wt / 2], [G.S - G.cu1, hw], [G.cu0, hw], [0, G.Wr / 2]];
      const path = pts => { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); };
      const face = w => outline.map(([u, v]) => P(u, v, w));
      const nearW = (sg ? Math.sin(dl + E) : cd * sinE) >= 0 ? -G.d / 2 : G.d / 2, farW = -nearW;
      const A = tr ? 0.75 : 1, dark = `rgba(18,20,23,${A})`;
      // 1) solid dark volume: far face + near face + side walls (deep cells: little sky shows through at this angle)
      c.fillStyle = dark; path(face(farW)); c.fill(); path(face(nearW)); c.fill();
      const nearEdge = sg ? [[0, G.Wr / 2], [G.cu0, hw], [G.S - G.cu1, hw], [G.S, G.Wt / 2]]
                          : [[G.S - G.cu1, -hw], [G.S, -G.Wt / 2], [G.S, G.Wt / 2], [G.S - G.cu1, hw]];
      for (let i = 0; i < nearEdge.length - 1; i++) { const [a, b] = [nearEdge[i], nearEdge[i + 1]]; path([P(a[0], a[1], -G.d / 2), P(b[0], b[1], -G.d / 2), P(b[0], b[1], G.d / 2), P(a[0], a[1], G.d / 2)]); c.fill(); }
      // 2) egg-crate lattice on the visible face: staggered cells, each a dark pocket with an arched (scalloped) lit wall
      c.save(); path(face(nearW)); c.clip();
      const o = P(0, 0, nearW), pu = P(1, 0, nearW), pv = P(0, 1, nearW);
      c.transform(pu[0] - o[0], pu[1] - o[1], pv[0] - o[0], pv[1] - o[1], o[0], o[1]);
      const p = G.p, rr = p * 0.5;
      const rim = tr ? "rgba(150,158,168,0.8)" : "#6f767e", lit = tr ? "rgba(205,212,220,0.8)" : "#a7aeb6", pocket = tr ? "rgba(10,11,13,0.8)" : "#0b0c0e";
      for (let i = 0, u = p * 0.5; u < G.S + p; i++, u += p * 0.87) {
        for (let v = -hw - p + (i % 2 ? p / 2 : 0); v < hw + p; v += p) {
          c.fillStyle = rim; c.beginPath(); c.arc(u, v, rr, 0, 7); c.fill();
          c.fillStyle = lit; c.beginPath(); c.arc(u - rr * 0.18, v, rr * 0.92, Math.PI * 0.6, Math.PI * 1.4); c.fill();
          c.fillStyle = pocket; c.beginPath(); c.arc(u + rr * 0.16, v, rr * 0.78, 0, 7); c.fill();
        }
      }
      c.restore();
      // heat sheen (bronze near the root -> faint blue toward the tip/leading edge)
      c.save(); path(face(nearW)); c.clip();
      const hg = c.createLinearGradient(o[0], o[1], P(G.S, 0, nearW)[0], P(G.S, 0, nearW)[1]);
      hg.addColorStop(0, `rgba(170,120,70,${0.10 * heat})`); hg.addColorStop(1, `rgba(80,95,160,${0.16 * heat})`);
      c.fillStyle = hg; path(face(nearW)); c.fill(); c.restore();
      // 3) thick outer frame (projected so it stays metres-thick) + root rib
      c.lineJoin = "round"; path(face(nearW));
      c.lineWidth = G.frame; c.strokeStyle = tr ? "rgba(40,44,50,0.85)" : "#262a2f"; c.stroke();
      c.lineWidth = G.frame * 0.3; c.strokeStyle = tr ? "rgba(200,208,216,0.6)" : "rgba(150,157,165,0.8)"; c.stroke();
      // 4) the edge plate facing the camera: dark ridged slab (cell-wall ends) with a scalloped/toothed rim
      for (let i = 0; i < nearEdge.length - 1; i++) {
        const [a, b] = [nearEdge[i], nearEdge[i + 1]], q = [P(a[0], a[1], -G.d / 2), P(b[0], b[1], -G.d / 2), P(b[0], b[1], G.d / 2), P(a[0], a[1], G.d / 2)];
        const g = c.createLinearGradient(q[0][0], q[0][1], q[3][0], q[3][1]);
        g.addColorStop(0, `rgba(12,13,15,${A})`); g.addColorStop(0.45, `rgba(48,52,58,${A})`); g.addColorStop(0.62, `rgba(32,35,39,${A})`); g.addColorStop(1, `rgba(12,13,16,${A})`);
        c.fillStyle = g; path(q); c.fill();
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / p));
        c.strokeStyle = tr ? "rgba(160,168,178,0.35)" : "rgba(95,101,108,0.4)"; c.lineWidth = 0.04; c.beginPath();
        for (let k = 0; k <= n; k++) { const f = k / n, uu = a[0] + (b[0] - a[0]) * f, vv = a[1] + (b[1] - a[1]) * f, p0 = P(uu, vv, -G.d / 2), p1 = P(uu, vv, G.d / 2); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); }
        c.stroke();
        c.fillStyle = `rgba(20,22,25,${A})`;
        for (let k = 0; k < n; k++) for (const ww of [-G.d / 2, G.d / 2]) {
          const f = (k + 0.5) / n, pt = P(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, ww);
          c.beginPath(); c.arc(pt[0], pt[1], p * 0.32, 0, 7); c.fill();
        }
        if (heat > 0.35) { c.fillStyle = `rgba(150,105,60,${0.08 * heat})`; path(q); c.fill(); }
      }
      // silhouette outline
      c.strokeStyle = tr ? "rgba(220,230,240,0.7)" : "rgba(8,9,11,0.9)"; c.lineWidth = Math.max(0.8 / bs, 0.025); path(face(nearW)); c.stroke();
      // root hinge shaft stub between block and fin
      const h0 = P(-0.15, 0, 0), h1 = P(0.35, 0, 0);
      if (sg) c.strokeStyle = tr ? "rgba(225,230,236,0.7)" : "#c9d0d7"; c.lineWidth = 0.45; if (sg) { c.beginPath(); c.moveTo(h0[0], h0[1]); c.lineTo(h1[0], h1[1]); c.stroke(); }
      // transparency: shaft + actuator inside the CH4 tank (SpaceX: moved inside the main fuel tank)
      if (tr) {
        c.strokeStyle = "rgba(255,210,120,0.9)"; c.lineWidth = 0.22; c.fillStyle = "rgba(255,190,90,0.75)";
        if (sg) { c.beginPath(); c.moveTo(sg * (R + 0.2), G.zh); c.lineTo(sg * (R - 1.4), G.zh); c.stroke(); c.fillRect(sg > 0 ? R - 2.3 : -R + 1.3, G.zh - 0.45, 1.0, 0.9); }
        else { c.beginPath(); c.arc(0, G.zh, 0.45, 0, 7); c.fill(); }
      }
    }
    // ---------- transparency mode: tanks, domes, tube, landing tank, liquids
    drawInternals(S, t) {
      const c = this.ctx, p = this.run.p, bs = this.bodyScale, R = 4.5;
      const v3 = !!p.v3, lw = Math.max(1 / bs, 0.03);
      const zA = p.lox_tank_bottom_m, hdA = v3 ? p.aft_dome_depth_m : 0.001, zC = p.ch4_tank_bottom_m, hdC = v3 ? p.common_dome_depth_m : 0.001;
      const bowl = (z0, hd) => x => z0 + hd * (1 - Math.sqrt(Math.max(0, 1 - (x / R) ** 2)));
      const aft = bowl(zA, hdA), com = bowl(zC, hdC), fwd = x => 66 + 1.3 * Math.sqrt(Math.max(0, 1 - (x / R) ** 2));
      const N = 40, xs = Array.from({ length: N + 1 }, (_, i) => -R + 2 * R * i / N);
      const path = (lower, upper) => { c.beginPath(); xs.forEach((x, i) => i ? c.lineTo(x, lower(x)) : c.moveTo(x, lower(x))); for (let i = N; i >= 0; i--) c.lineTo(xs[i], upper(xs[i])); c.closePath(); };
      const rT = v3 ? p.tube_R_m : 0.5, zTb = v3 ? p.tube_zb_m : 2.0, zV = v3 ? p.tube_valve_z_m : 20;
      const lt = v3 ? { x: p.lox_land_xoff_m, r: p.lox_land_R_m, zb: p.lox_land_zb_m, h: p.lox_land_h_m } : null;
      const capsule = (keep) => { const r = lt.r, x = lt.x, z0 = lt.zb, z1 = lt.zb + lt.h; if (!keep) c.beginPath(); c.moveTo(x - r, z0 + 0.45); c.quadraticCurveTo(x - r, z0, x, z0); c.quadraticCurveTo(x + r, z0, x + r, z0 + 0.45); c.lineTo(x + r, z1 - 0.45); c.quadraticCurveTo(x + r, z1, x, z1); c.quadraticCurveTo(x - r, z1, x - r, z1 - 0.45); c.closePath(); };
      // liquid fill helper: clip to region, fill below a tilted, rippled surface
      const liquid = (clipFn, zs, tilt, col, rip, float, ox, rr) => {
        c.save(); clipFn(); c.clip("evenodd");
        const amp = rip, wl = 2.2;
        if (float) {   // propellant floating / migrating in near-zero g: blobs drifting off the bottom
          for (let i = 0; i < 7; i++) {
            const bx = (ox || 0) + (hash(i + 3) - 0.5) * (rr || R) * 1.4 + Math.sin(t * 0.7 + i) * 0.6, bz = zs + (hash(i + 13) - 0.3) * 4 + Math.sin(t * 0.9 + i * 2) * 0.8;
            const r = (0.5 + hash(i + 23) * 1.2) * Math.min(1, (rr || R) / 3);
            c.fillStyle = rgba(col, 0.75); c.beginPath(); c.ellipse(bx, bz, r * (1 + 0.15 * Math.sin(t * 3 + i)), r * (1 - 0.15 * Math.sin(t * 3 + i)), 0, 0, 7); c.fill();
          }
          c.restore(); return;
        }
        const g = c.createLinearGradient(0, zs - 6, 0, zs + 1); g.addColorStop(0, rgba(col, 0.95)); g.addColorStop(1, rgba(col, 0.7));
        c.fillStyle = g; c.beginPath(); c.moveTo(-R - 1, -2);
        for (let i = 0; i <= 60; i++) { const x = -R - 1 + (2 * R + 2) * i / 60; c.lineTo(x, zs + Math.tan(tilt) * (x - (ox || 0)) + amp * Math.sin(x * 2 * Math.PI / wl - t * 4.0) + amp * 0.5 * Math.sin(x * 5.1 + t * 2.3)); }
        c.lineTo(R + 1, -2); c.closePath(); c.fill();
        c.strokeStyle = rgba([255, 255, 255], 0.75); c.lineWidth = lw * 1.2; c.beginPath();
        for (let i = 0; i <= 60; i++) { const x = -R - 1 + (2 * R + 2) * i / 60; const z = zs + Math.tan(tilt) * (x - (ox || 0)) + amp * Math.sin(x * 2 * Math.PI / wl - t * 4.0) + amp * 0.5 * Math.sin(x * 5.1 + t * 2.3); i ? c.lineTo(x, z) : c.moveTo(x, z); }
        c.stroke(); c.restore();
      };
      const tiltOf = (wave, RT) => Math.atan(clamp((wave || 0) / Math.max(RT, 0.3), -1.2, 1.2));
      const floating = (zp, settled) => zp > 0.15;
      // tank walls / domes
      c.fillStyle = "rgba(10,20,35,0.35)"; path(aft, com); c.fill(); path(com, fwd); c.fill();
      // main LOX liquid (clip: LOX tank minus tube minus landing tank)
      const loxClip = () => { path(aft, x => com(x) - 0.25); c.rect(-rT, zA, 2 * rT, zC - zA); if (lt) capsule(true); };
      const lh = S.lox_h, lzp = S.lox_zp;
      if (S.lox_m > 20) liquid(loxClip, zA + lh + lzp, tiltOf(S.lox_wave, R), LOX_C, clamp(0.05 + Math.abs(S.lox_wave) * 0.12, 0, 0.35), floating(lzp), 0, R);
      // main CH4: tank above the common dome (+ upper tube section in v3)
      const ch4Clip = () => { path(com, fwd); };
      const zch = v3 ? zV + S.ch4_h : zC + S.ch4_h;
      if (S.ch4_m > 20 && zch > zC) liquid(ch4Clip, zch + S.ch4_zp, tiltOf(S.ch4_wave, R), CH4_C, clamp(0.05 + Math.abs(S.ch4_wave) * 0.12, 0, 0.3), floating(S.ch4_zp), 0, R);
      // transfer tube / downcomer
      c.fillStyle = "rgba(20,30,45,0.6)"; c.fillRect(-rT, zTb, 2 * rT, zC - zTb);
      const tubeUpper = () => { c.beginPath(); c.rect(-rT, zV, 2 * rT, zC - zV + 0.5); };
      if (v3 && S.ch4_m > 20) liquid(tubeUpper, Math.min(zch, zC + 0.5), 0, CH4_C, 0.02, false, 0, rT);
      if (!v3 && S.ch4_m > 20) { c.fillStyle = rgba(CH4_C, 0.85); c.fillRect(-rT, zTb, 2 * rT, zC - zTb); }
      if (v3) {
        const tubeLower = () => { c.beginPath(); c.rect(-rT, zTb, 2 * rT, zV - zTb); };
        if (S.ch4L_m > 5) liquid(tubeLower, zTb + S.ch4L_h + S.ch4L_zp, tiltOf(S.ch4L_wave, rT), [255, 150, 60], 0.03, false, 0, rT);
        // isolation valve (speculative) at the top of the CH4 landing column
        c.fillStyle = S.isolated ? "#ff5252" : "#69f0ae"; c.beginPath(); c.moveTo(-rT - 0.3, zV - 0.35); c.lineTo(rT + 0.3, zV + 0.35); c.lineTo(rT + 0.3, zV - 0.35); c.lineTo(-rT - 0.3, zV + 0.35); c.closePath(); c.fill();
        // LOX landing tank (side-mounted)
        c.fillStyle = "rgba(10,20,35,0.6)"; capsule(); c.fill();
        if (S.loxL_m > 5) liquid(() => capsule(), lt.zb + S.loxL_h + S.loxL_zp, tiltOf(S.loxL_wave, lt.r), [120, 200, 255], 0.03, floating(S.loxL_zp), lt.x, lt.r);
        c.strokeStyle = "rgba(220,235,255,0.9)"; c.lineWidth = lw * 1.3; capsule(); c.stroke();
      }
      c.strokeStyle = "rgba(220,235,255,0.85)"; c.lineWidth = lw * 1.3; c.strokeRect(-rT, zTb, 2 * rT, zC - zTb);
      // domes outline
      c.strokeStyle = "rgba(220,235,255,0.95)"; c.lineWidth = lw * 1.6;
      for (const f of [aft, com, fwd]) { c.beginPath(); xs.forEach((x, i) => i ? c.lineTo(x, f(x)) : c.moveTo(x, f(x))); c.stroke(); }
      // baffle rings (main tanks)
      c.strokeStyle = "rgba(200,220,240,0.35)"; c.lineWidth = lw;
      for (const b of p.baffle_z_m) { const z = zA + b; if (z < zC - 1) { c.beginPath(); c.moveTo(-R, z); c.lineTo(-R + 0.45, z); c.moveTo(R, z); c.lineTo(R - 0.45, z); c.stroke(); } }
      // feedlines + flow animation
      const lit = S.n > 0 && S.thr > 0.03;
      const flowLine = (pts, col, active) => {
        c.strokeStyle = rgba(col, active ? 0.9 : 0.35); c.lineWidth = lw * 2.4; c.beginPath(); pts.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); c.stroke();
        if (active) { c.setLineDash([0.5, 0.7]); c.lineDashOffset = -t * 6; c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = lw * 1.2; c.beginPath(); pts.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); c.stroke(); c.setLineDash([]); }
      };
      const fL = S.feed & 1, fF = S.feed & 2;
      flowLine([[-2.8, zA + 0.6], [-2.8, 0.6]], LOX_C, lit && !fL);
      flowLine([[2.8 - 1.2, zA + 0.6], [3.4, 0.6]], LOX_C, lit && !fL);
      if (v3) flowLine([[lt.x, lt.zb + 0.1], [lt.x - 0.8, 1.6], [1.0, 0.6]], [120, 200, 255], lit && !!fL);
      flowLine([[0, zTb], [0, 0.6]], CH4_C, lit);
      if (v3 && !fF && lit) { /* CH4 from main through the full tube */ }
      // vent flow inside: arrows from surfaces to vent ports
      if (S.vent_o > 1) flowLine([[-3.6, zA + lh], [-4.3, 36.5]], LOX_C, true);
      if (S.vent_f > 1) flowLine([[3.6, zch], [4.3, 64.5]], CH4_C, true);
      // CG marker
      const cg = S.cg || p.l_cg_m;
      c.save(); c.translate(0, cg); const r = 0.9;
      c.fillStyle = "#fff"; c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill();
      c.fillStyle = "#111"; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, 0, Math.PI / 2); c.closePath(); c.fill(); c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, Math.PI, 1.5 * Math.PI); c.closePath(); c.fill();
      c.restore();
      if (bs > 3) {
        c.save(); c.scale(1, -1); c.fillStyle = "rgba(255,255,255,0.92)"; c.font = `600 ${(11 / bs).toFixed(3)}px sans-serif`;
        c.fillText(`CG ${cg.toFixed(1)} m`, 1.1, -cg + 0.3);
        c.fillText("LOX", -4.1, -(zA + 3.4)); c.fillText("CH4", -4.1, -(zC + 3));
        if (v3) { c.fillText("LOX landing tank", lt.x - 1.5, -(lt.zb + lt.h + 0.4)); c.fillText("CH4 transfer tube", rT + 0.2, -(zV + 9)); c.fillText("isolation valve", rT + 0.4, -(zV - 0.2)); c.fillText("CH4 landing column", rT + 0.2, -(zTb + 13)); }
        c.fillText("common dome", -1.6, -(zC - 0.6));
        c.restore();
      }
    }
    // ---------- HUD
    drawHUD(S, t) {
      // HUD is laid out for >= 640 px; on narrow (phone) canvases scale the whole overlay down so panels don't collide
      const hs = clamp(this.W / 640, 0.8, 1), c = this.ctx, W = this.W / hs, H = this.H / hs, p = this.run.p;
      c.save(); c.scale(hs, hs);
      c.font = "600 13px Rajdhani, 'Segoe UI', sans-serif"; c.textBaseline = "top";
      // top-left block
      const box = (x, y, w, h) => { c.fillStyle = "rgba(6,12,22,0.62)"; c.fillRect(x, y, w, h); c.strokeStyle = "rgba(120,170,230,0.25)"; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); };
      box(10, 10, 228, 158);
      c.fillStyle = PH_COL[S.phase] || "#fff"; c.font = "700 15px Rajdhani, 'Segoe UI', sans-serif"; c.fillText(PH_LABEL[S.phase] || S.phase, 18, 16);
      c.fillStyle = "#e8f1fb"; c.font = "600 13px Rajdhani, 'Segoe UI', sans-serif";
      const alt = S.yb, rows = [
        ["T+", `${S.t.toFixed(1)} s`], ["ALTITUDE", alt > 2000 ? `${(alt / 1000).toFixed(2)} km` : `${alt.toFixed(0)} m`],
        ["SPEED", `${Math.hypot(S.vx, S.vy).toFixed(0)} m/s  (M ${S.M.toFixed(2)})`], ["VERT / HORIZ", `${S.vy.toFixed(1)} / ${S.vx.toFixed(1)} m/s`],
        ["DYN. PRESSURE", `${(S.q / 1000).toFixed(1)} kPa`], ["G-LOAD", `${S.g_load.toFixed(2)} g`],
        ["THROTTLE · ENG", `${(S.thr * 100).toFixed(0)}% · ${S.n} lit`], ["DOWNRANGE", `${(S.xb / 1000).toFixed(2)} km`],
      ];
      rows.forEach(([a, b], i) => { c.fillStyle = "#8ea6c4"; c.fillText(a, 18, 36 + i * 16); c.fillStyle = "#e8f1fb"; c.fillText(b, 118, 36 + i * 16); });
      // engine ring (bottom-left)
      this.drawEngineRing(S, t, 70, H - 92, 50);
      // tanks panel (top-right)
      this.drawTankPanel(S, W - 238, 10, 228, p.v3 ? 186 : 120);
      // wind panel
      const wy = p.v3 ? 204 : 138;
      if (W < 560) { this._hudEvents(S, t, W, H); c.restore(); return; }   // phones: skip the wind panel
      box(W - 238, wy, 228, 58);
      c.fillStyle = "#8ea6c4"; c.fillText("WIND @ VEHICLE", W - 230, wy + 6);
      c.fillStyle = "#e8f1fb"; c.fillText(`${S.wind_x.toFixed(1)} m/s  (mean ${S.wind_mean.toFixed(1)}, gust ${S.wind_gust.toFixed(1)})`, W - 230, wy + 22);
      c.fillText(`airspeed ${S.airspeed.toFixed(0)} m/s · AoA ${(S.aoa / D2R).toFixed(1)}°`, W - 230, wy + 38);
      const ax = W - 30, ay = wy + 14, aw = clamp(S.wind_x * 0.8, -18, 18);
      c.strokeStyle = "#4fc3f7"; c.lineWidth = 2; c.beginPath(); c.moveTo(ax - aw, ay); c.lineTo(ax + aw, ay); c.lineTo(ax + aw - Math.sign(aw) * 5, ay - 4); c.moveTo(ax + aw, ay); c.lineTo(ax + aw - Math.sign(aw) * 5, ay + 4); c.stroke();
      this._hudEvents(S, t, W, H);
      c.restore();
    }
    _hudEvents(S, t, W, H) {
      const c = this.ctx, narrow = W < 560;
      const evs = this.run.events.filter(e => e[0] <= t).slice(narrow ? -2 : -4);
      c.font = "500 12px Rajdhani, 'Segoe UI', sans-serif";
      const mw = narrow ? W - 150 : W * 0.55;
      evs.forEach((e, i) => { const txt = `T+${e[0].toFixed(1)}  ${e[1]}`; const w = Math.min(c.measureText(txt).width, mw); c.fillStyle = "rgba(6,12,22,0.55)"; c.fillRect(W - w - 22, H - 22 - (evs.length - 1 - i) * 18, w + 12, 16); c.fillStyle = i === evs.length - 1 ? "#ffe082" : "#cfd8e3"; c.fillText(txt, W - w - 16, H - 20 - (evs.length - 1 - i) * 18, mw); });
      if (this.transparent) { c.fillStyle = "rgba(160,220,255,0.9)"; c.font = "700 12px Rajdhani, sans-serif"; if (W < 720) c.fillText("TRANSPARENCY MODE", 18, 174); else c.fillText("TRANSPARENCY MODE · internals driven by sim state", 250, 14); }
    }
    drawEngineRing(S, t, cx, cy, r) {
      const c = this.ctx, st = S.state, sp = S.spool;
      c.fillStyle = "rgba(6,12,22,0.62)"; c.beginPath(); c.arc(cx, cy, r + 10, 0, 7); c.fill();
      c.strokeStyle = "rgba(120,170,230,0.3)"; c.stroke();
      for (let i = 0; i < 33; i++) {
        const e = ENG[i], x = cx + e.x / 4.4 * r, y = cy - e.d / 4.4 * r, s = st ? st[i] : 0, v = sp ? sp[i] : 0;
        let col;
        if (s === 0) col = "rgba(90,100,115,0.6)";
        else if (s === 1) col = `rgba(255,${170 + Math.round(60 * Math.sin(t * 12))},40,${0.5 + 0.5 * v})`;
        else if (s === 2) col = "rgba(255,240,200,1)";
        else if (s === 3) col = `rgba(255,140,60,${0.25 + 0.7 * v})`;
        else col = "rgba(255,60,60,0.95)";
        c.fillStyle = col; c.beginPath(); c.arc(x, y, e.ring === 2 ? 4.6 : 4.2, 0, 7); c.fill();
        if (s === 4) { c.strokeStyle = "#fff"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x - 3, y - 3); c.lineTo(x + 3, y + 3); c.moveTo(x + 3, y - 3); c.lineTo(x - 3, y + 3); c.stroke(); }
      }
      c.fillStyle = "#8ea6c4"; c.font = "600 11px Rajdhani, sans-serif"; c.textAlign = "center"; c.fillText("RAPTOR 3 × 33", cx, cy + r + 13); c.textAlign = "left";
    }
    drawTankPanel(S, x, y, w, h) {
      const c = this.ctx, p = this.run.p;
      c.fillStyle = "rgba(6,12,22,0.62)"; c.fillRect(x, y, w, h); c.strokeStyle = "rgba(120,170,230,0.25)"; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      c.fillStyle = "#8ea6c4"; c.font = "600 12px Rajdhani, sans-serif"; c.fillText("PROPELLANT · SLOSH · CG", x + 8, y + 6);
      const bar = (yy, label, m, cap, col, psi, extra) => {
        c.fillStyle = "#cfd8e3"; c.fillText(label, x + 8, yy);
        c.fillStyle = "rgba(255,255,255,0.08)"; c.fillRect(x + 92, yy + 2, 80, 10);
        c.fillStyle = rgba(col, 0.9); c.fillRect(x + 92, yy + 2, 80 * clamp(m / cap, 0, 1), 10);
        c.fillStyle = "#e8f1fb"; c.fillText(`${(m / 1000).toFixed(1)} t`, x + 176, yy);
        if (psi !== null) { // tilt indicator
          const cx = x + 92 + 40, cy = yy + 7, a = psi; c.strokeStyle = "rgba(255,255,255,0.7)"; c.beginPath(); c.moveTo(cx - 12 * Math.cos(a), cy + 12 * Math.sin(a)); c.lineTo(cx + 12 * Math.cos(a), cy - 12 * Math.sin(a)); c.stroke();
        }
      };
      let yy = y + 24;
      bar(yy, "LOX main", S.lox_m, p.v3 ? 260e3 : 320e3, LOX_C, S.lox_psi1); yy += 18;
      bar(yy, "CH4 main", S.ch4_m, p.v3 ? 75e3 : 90e3, CH4_C, S.ch4_psi1); yy += 18;
      if (p.v3) {
        bar(yy, "LOX landing", S.loxL_m, 65e3, [120, 200, 255], null); yy += 18;
        bar(yy, "CH4 column", S.ch4L_m, 19e3, [255, 150, 60], null); yy += 18;
        c.fillStyle = "#8ea6c4"; c.fillText("FEED", x + 8, yy); c.fillStyle = "#e8f1fb";
        const fd = S.n > 0 && S.thr > 0.03 ? `${S.feed & 1 ? "LOX landing" : "LOX main"} · ${S.feed & 2 ? "CH4 column" : "CH4 main"}` : "—";
        c.fillText(fd, x + 50, yy); yy += 16;
        c.fillStyle = "#8ea6c4"; c.fillText("VENT", x + 8, yy); c.fillStyle = S.vent_o + S.vent_f > 1 ? "#ffe082" : "#e8f1fb";
        c.fillText(S.vent_o + S.vent_f > 1 ? `${(S.vent_o + S.vent_f).toFixed(0)} kg/s` : (S.isolated ? "closed" : "—"), x + 50, yy); yy += 16;
      }
      c.fillStyle = "#8ea6c4"; c.fillText("CG / SLOSH", x + 8, yy); c.fillStyle = "#e8f1fb";
      c.fillText(`${(S.cg || p.l_cg_m).toFixed(2)} m · LOX ${(S.lox_psi1 / D2R).toFixed(1)}° ${(S.lox_f1 || 0).toFixed(2)} Hz`, x + 84, yy); yy += 16;
      c.fillStyle = "#8ea6c4"; c.fillText("SETTLED", x + 8, yy); c.fillStyle = S.lox_settled > 0.5 ? "#69f0ae" : "#ff8a80";
      c.fillText(S.lox_settled > 0.5 ? "yes" : `floating (${S.lox_zp.toFixed(1)} m)`, x + 84, yy);
    }
  }
  SH.Renderer = Renderer;
})(window.SH = window.SH || {});
