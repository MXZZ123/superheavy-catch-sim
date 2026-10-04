/* UI controller: pre-flight settings panel (locked during a flight), presets, reset, share URL, launch,
   playback (play/pause/scrub/speed/camera/transparency/sound), outcome card, charts, compare, Monte Carlo. */
(function (SH) {
  "use strict";
  const $ = id => document.getElementById(id);
  const APP = window.APP = { settings: Object.assign({}, SH.DEFAULTS), run: null, ref: null, t: 0, playing: false, locked: false, speed: "auto" };
  const renderer = new SH.Renderer($("view")), charts = new SH.Charts($("charts")), audio = new SH.Audio();
  APP.renderer = renderer;
  const V3_ONLY = ["landing_tanks", "vent_mode", "vent_pct"];

  // ---------------- settings panel
  const fmtVal = (tw, v) => tw.type === "check" ? (v ? "on" : "off") : tw.type === "select" ? v : (typeof v === "number" ? v.toFixed(tw.fmt ?? (tw.step < 1 ? (tw.step < 0.1 ? 2 : 1) : 0)) : v) + (tw.unit ? " " + tw.unit : "");
  function buildPanel() {
    const panel = $("panel"); panel.innerHTML = "";
    const groups = {};
    for (const tw of SH.TWEAKS) {
      if (!groups[tw.group]) { const d = document.createElement("details"); d.open = ["Model & propellant management", "Engine failures", "Re-entry"].includes(tw.group); d.innerHTML = `<summary>${tw.group}</summary>`; panel.appendChild(d); groups[tw.group] = d; }
      const box = document.createElement("div"); box.className = "ctl"; box.dataset.key = tw.key;
      let inp;
      if (tw.type === "range") { inp = document.createElement("input"); inp.type = "range"; inp.min = tw.min; inp.max = tw.max; inp.step = tw.step; }
      else if (tw.type === "select") { inp = document.createElement("select"); for (const o of tw.options) { const op = document.createElement("option"); op.value = o; op.textContent = tw.labels && tw.labels[o] ? tw.labels[o] : o; inp.appendChild(op); } }
      else if (tw.type === "check") { inp = document.createElement("input"); inp.type = "checkbox"; }
      else { inp = document.createElement("input"); inp.type = "number"; inp.min = tw.min; inp.max = tw.max; inp.step = tw.step; }
      inp.id = "s_" + tw.key;
      const lab = document.createElement("label"); lab.innerHTML = `<span>${tw.label}</span><span class="val"></span>`;
      if (tw.type === "check") { lab.prepend(inp); box.appendChild(lab); } else { box.appendChild(lab); box.appendChild(inp); }
      if (tw.help) { const h = document.createElement("div"); h.className = "help"; h.textContent = tw.help; box.appendChild(h); }
      const onChange = () => {
        let v = tw.type === "check" ? inp.checked : tw.type === "select" ? inp.value : +inp.value;
        if (tw.type === "select" && tw.options.every(o => typeof o === "number")) v = +v;
        APP.settings[tw.key] = v; refreshPanel(); markStale();
      };
      inp.addEventListener("input", onChange); inp.addEventListener("change", onChange);
      groups[tw.group].appendChild(box);
    }
    refreshPanel();
  }
  function refreshPanel() {
    for (const tw of SH.TWEAKS) {
      const inp = $("s_" + tw.key), v = APP.settings[tw.key], box = inp.closest(".ctl");
      if (tw.type === "check") inp.checked = !!v; else if (String(inp.value) !== String(v)) inp.value = v;
      box.querySelector(".val").textContent = tw.type === "check" ? "" : fmtVal(tw, v);
      box.classList.toggle("changed", String(v) !== String(tw.def));
      let dis = false;
      if (tw.key === "vent_pct") dis = APP.settings.vent_mode !== "vent some";
      if (V3_ONLY.includes(tw.key) && APP.settings.physics_model === "v2") dis = true;
      if (tw.key === "bb_fixed_s") dis = APP.settings.bb_cutoff !== "fixed duration";
      if (tw.key.startsWith("entry_burn_")) dis = !APP.settings.entry_burn;
      box.classList.toggle("dis", dis); inp.disabled = dis;
    }
    $("modelTag").textContent = APP.settings.physics_model === "v2" ? "physics v2 (Python-validated)" : "physics v3 · landing tanks · CG shift";
  }
  function setSettings(obj) { APP.settings = Object.assign({}, SH.DEFAULTS, obj || {}); refreshPanel(); markStale(); }
  APP.setSettings = setSettings;
  const same = (a, b) => SH.TWEAKS.every(tw => String(a[tw.key]) === String(b[tw.key]));
  function markStale() { $("staleBanner").classList.toggle("hidden", !APP.run || same(APP.settings, APP.run.settings)); }

  // presets / reset / share
  for (const name of Object.keys(SH.PRESETS)) { const o = document.createElement("option"); o.value = name; o.textContent = name; $("preset").appendChild(o); }
  $("preset").addEventListener("change", e => { if (APP.locked) return; if (e.target.value) setSettings(SH.PRESETS[e.target.value]); e.target.value = ""; });
  $("btnReset").addEventListener("click", () => { if (!APP.locked) setSettings({}); });
  function encodeSettings(s) {
    const q = new URLSearchParams();
    for (const tw of SH.TWEAKS) if (String(s[tw.key]) !== String(tw.def)) q.set(tw.key, s[tw.key]);
    return q.toString();
  }
  function decodeSettings(str) {
    const q = new URLSearchParams(str), out = {};
    for (const tw of SH.TWEAKS) if (q.has(tw.key)) {
      const r = q.get(tw.key);
      out[tw.key] = tw.type === "check" ? r === "true" : tw.type === "select" ? (tw.options.every(o => typeof o === "number") ? +r : r) : +r;
    }
    return out;
  }
  APP.encodeSettings = encodeSettings;
  $("btnShare").addEventListener("click", async () => {
    const h = encodeSettings(APP.settings); history.replaceState(null, "", "#" + h);
    try { await navigator.clipboard.writeText(location.href); $("btnShare").textContent = "Link copied ✓"; } catch (e) { $("btnShare").textContent = "Link in address bar ✓"; }
    setTimeout(() => $("btnShare").textContent = "Copy share link", 1800);
  });

  // ---------------- lock / launch
  function lock(on) {
    APP.locked = on;
    $("panel").classList.toggle("locked", on); $("lockBanner").classList.toggle("hidden", !on);
    for (const id of ["preset", "btnReset", "btnLaunch", "btnLaunch2", "btnMC", "mcN", "btnPin"]) $(id).disabled = on || (id === "btnPin" && !APP.run);
    $("btnEnd").classList.toggle("hidden", !on);
  }
  function busy(on, txt) { $("busy").classList.toggle("hidden", !on); if (txt) $("busyTxt").textContent = txt; }
  // ---- run SH.simulate in a Web Worker (relative URL -> works under any sub-path); falls back to the main thread
  // (e.g. file:// where browsers block workers).  Progress callback gets simulated flight time.
  let worker = null, workerOK = location.protocol !== "file:" && typeof Worker !== "undefined", jobId = 0;
  function simulateAsync(settings, onProg) {
    if (workerOK) {
      try { if (!worker) worker = new Worker("js/simworker.js"); } catch (e) { workerOK = false; }
    }
    if (!workerOK) return new Promise((res, rej) => setTimeout(() => { try { res(SH.simulate(settings)); } catch (e) { rej(e); } }, 30));
    const id = ++jobId;
    return new Promise((res, rej) => {
      const onMsg = (e) => {
        const m = e.data; if (m.id !== id) return;
        if (m.type === "progress") { onProg && onProg(m.t); return; }
        worker.removeEventListener("message", onMsg); worker.removeEventListener("error", onErr);
        if (m.type === "done") res(m.run); else rej(new Error(m.message));
      };
      const onErr = (ev) => {   // worker failed to load: fall back permanently to main thread
        ev.preventDefault && ev.preventDefault();
        worker.removeEventListener("message", onMsg); worker.removeEventListener("error", onErr);
        workerOK = false; try { worker.terminate(); } catch (_) {} worker = null;
        setTimeout(() => { try { res(SH.simulate(settings)); } catch (e2) { rej(e2); } }, 30);
      };
      worker.addEventListener("message", onMsg); worker.addEventListener("error", onErr);
      worker.postMessage({ id, settings });
    });
  }
  SH.simulateAsync = simulateAsync;
  function launch() {
    if (APP.locked) return;
    lock(true); busy(true, "Simulating flight…"); $("intro").classList.add("hidden"); $("outcome").classList.add("hidden");
    setProgress(0);
    closeDrawer();
    history.replaceState(null, "", "#" + encodeSettings(APP.settings));
    const settings = Object.assign({}, APP.settings);
    return simulateAsync(settings, t => { setProgress(Math.min(t / 260, 0.99)); $("busyTxt").textContent = `Simulating flight… T+${t.toFixed(0)} s`; })
      .then(run => {
        run.settings = settings;
        APP.run = run; APP.t = 0; APP.tEnd = run.log.t[run.log.t.length - 1];
        renderer.setRun(run, APP.ref); charts.build(run, APP.ref); summaryTable();
        $("btnPlay").disabled = false; $("scrub").disabled = false; markStale();
        busy(false); APP.playing = true; APP.ended = false; $("btnPlay").textContent = "❚❚";
        return run;
      })
      .catch(e => { console.error(e); busy(false); lock(false); alert("Simulation error: " + e.message); return null; });
  }
  function setProgress(f) { const b = $("busyBar"); if (b) b.style.width = (100 * f).toFixed(0) + "%"; }
  APP.launch = launch;
  function endFlight() { APP.t = APP.tEnd; APP.playing = false; finish(); }
  function finish() {
    APP.ended = true; showOutcome(); lock(false); $("btnPlay").textContent = "▶";
  }
  $("btnLaunch").addEventListener("click", launch);
  $("btnLaunch2").addEventListener("click", launch);
  $("btnEnd").addEventListener("click", endFlight);

  // ---------------- outcome card + summary
  const f = (v, d = 1, u = "") => v === null || v === undefined || Number.isNaN(v) ? "—" : (+v).toFixed(d) + u;
  function showOutcome() {
    const r = APP.run; if (!r) return;
    const o = r.outcome, S = r.summary, el = $("outcome");
    el.className = o.ok ? "ok" : "bad";
    const kv = o.ok ? [
      ["vertical speed", f(S.catch_vertical_speed_mps, 2, " m/s")], ["horizontal speed", f(S.catch_horizontal_speed_mps, 2, " m/s")],
      ["offset from axis", f(S.catch_offset_m, 2, " m")], ["tilt", f(S.catch_tilt_deg, 2, "°")],
      ["propellant left", f(S.propellant_at_catch_kg / 1000, 1, " t")], ["flight time", f(S.flight_time_s, 1, " s")],
      ["peak g (flight)", f(S.peak_g_flight, 2, " g")], ["peak arm load", f(S.max_arm_load_MN, 2, " MN")],
    ] : [
      ["flight time", f(S.flight_time_s, 1, " s")], ["propellant left", f(S.propellant_end_kg / 1000, 1, " t")],
      ["peak g", f(S.peak_g_flight, 2, " g")], ["max-Q", f(S.max_q_entry_kPa, 0, " kPa")],
      ["impact x", S.impact_x_m == null ? "—" : f(S.impact_x_m, 0, " m")], ["engine starts", S.engine_starts],
      ["peak LOX slosh", f(S.peak_lox_slosh_deg, 1, "°")], ["CG shift", f(S.cg_catch_m - S.cg_staging_m, 1, " m")],
    ];
    el.innerHTML = `<span class="x" title="hide">✕</span><h2>${o.title}</h2><div class="reason">${o.reason}</div><div class="kv">${kv.map(([a, b]) => `<div><span>${a}</span>${b}</div>`).join("")}</div>`;
    el.querySelector(".x").onclick = () => el.classList.add("hidden");
  }
  function summaryTable() {
    const r = APP.run, S = r.summary, R = APP.ref ? APP.ref.summary : null;
    const rows = [["Outcome", r.outcome.title, APP.ref ? APP.ref.outcome.title : null],
      ["Catch vy / vx [m/s]", `${f(S.catch_vertical_speed_mps, 2)} / ${f(S.catch_horizontal_speed_mps, 2)}`, R && `${f(R.catch_vertical_speed_mps, 2)} / ${f(R.catch_horizontal_speed_mps, 2)}`],
      ["Offset [m]", f(S.catch_offset_m, 2), R && f(R.catch_offset_m, 2)],
      ["Propellant at end [t]", f(S.propellant_end_kg / 1000, 1), R && f(R.propellant_end_kg / 1000, 1)],
      ["Flight time [s]", f(S.flight_time_s, 1), R && f(R.flight_time_s, 1)],
      ["Peak g / max-Q [kPa]", `${f(S.peak_g_flight, 2)} / ${f(S.max_q_entry_kPa, 0)}`, R && `${f(R.peak_g_flight, 2)} / ${f(R.max_q_entry_kPa, 0)}`],
      ["Landing ignition alt [m]", f(S.landing_burn_cmd_alt_m, 0), R && f(R.landing_burn_cmd_alt_m, 0)],
      ["CG staging → end [m]", `${f(S.cg_staging_m, 2)} → ${f(S.cg_catch_m, 2)}`, R && `${f(R.cg_staging_m, 2)} → ${f(R.cg_catch_m, 2)}`],
      ["Vented [t]", f((S.vented_kg || 0) / 1000, 1), R && f((R.vented_kg || 0) / 1000, 1)],
      ["Peak slosh LOX / CH4 [°]", `${f(S.peak_lox_slosh_deg, 1)} / ${f(S.peak_ch4_slosh_deg, 1)}`, R && `${f(R.peak_lox_slosh_deg, 1)} / ${f(R.peak_ch4_slosh_deg, 1)}`]];
    $("summary").innerHTML = `<table><tr><th></th><th>This run</th>${R ? "<th>Reference (pinned)</th>" : ""}</tr>${rows.map(r => `<tr><th>${r[0]}</th><td>${r[1]}</td>${R ? `<td>${r[2]}</td>` : ""}</tr>`).join("")}</table>`;
  }
  $("btnPin").addEventListener("click", () => { if (!APP.run) return; APP.ref = APP.run; renderer.ref = APP.ref; summaryTable(); charts.build(APP.run, APP.ref); $("btnPin").textContent = "Reference pinned ✓"; setTimeout(() => $("btnPin").textContent = "Pin as reference", 1500); });

  // ---------------- playback
  $("btnPlay").addEventListener("click", () => { if (!APP.run) return; if (APP.t >= APP.tEnd) APP.t = 0; APP.playing = !APP.playing; $("btnPlay").textContent = APP.playing ? "❚❚" : "▶"; });
  $("scrub").addEventListener("input", e => { if (!APP.run) return; APP.t = +e.target.value / 1000 * APP.tEnd; APP.snap = true; });
  $("speed").addEventListener("change", e => APP.speed = e.target.value);
  $("camera").addEventListener("change", e => { renderer.mode = e.target.value; APP.snap = true; });
  $("transp").addEventListener("change", e => renderer.transparent = e.target.checked);
  $("sound").addEventListener("change", e => { if (e.target.checked) audio.enable(); else audio.disable(); });
  APP.seek = t => { APP.t = t; APP.snap = true; };
  function autoSpeed(S) {
    if (!S) return 1;
    if (S.phase === "COAST") return 12;
    if (S.yb > 20000) return 6;
    if (S.yb > 4000) return 3;
    if (S.phase === "FLIP" || S.phase === "BOOSTBACK") return 4;
    return 1;
  }
  let last = performance.now(), chartT = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (APP.run) {
      const sp = APP.speed === "auto" ? autoSpeed(renderer.S) : +APP.speed;
      if (APP.playing) {
        APP.t += dt * sp;
        if (APP.t >= APP.tEnd) { APP.t = APP.tEnd; APP.playing = false; if (APP.locked || !APP.ended) finish(); }
      }
      renderer.draw(APP.t, dt, APP.snap); APP.snap = false;
      audio.update(renderer.S, APP.playing, sp);
      $("scrub").value = Math.round(APP.t / APP.tEnd * 1000); $("tlabel").textContent = `T+${APP.t.toFixed(1)} s`;
      if (now - chartT > 120) { charts.setTime(APP.t); chartT = now; }
    } else drawIdle();
    requestAnimationFrame(frame);
  }
  function drawIdle() {
    const c = $("view").getContext("2d"), cv = $("view");
    if (!renderer.W) renderer.resize();
    c.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, renderer.H); g.addColorStop(0, "#1a3c78"); g.addColorStop(1, "#d79a86"); c.fillStyle = g; c.fillRect(0, 0, renderer.W, renderer.H);
  }
  const onResize = () => { renderer.resize(); charts.resize(); };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => setTimeout(onResize, 250));
  if (window.ResizeObserver) new ResizeObserver(onResize).observe($("viewWrap"));

  // ---------------- touch / pointer scrubbing on the canvas: drag horizontally to scrub (pinch-free, one finger)
  (function () {
    const cv = $("view"); let sx = null, st = 0, moved = false, wasPlaying = false;
    cv.addEventListener("pointerdown", e => { if (!APP.run) return; sx = e.clientX; st = APP.t; moved = false; wasPlaying = APP.playing; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", e => {
      if (sx === null || !APP.run) return;
      const dx = e.clientX - sx; if (!moved && Math.abs(dx) < 8) return;
      if (!moved) { moved = true; APP.playing = false; }
      APP.t = clamp01(st + dx / cv.clientWidth * APP.tEnd * 0.6) ; APP.snap = true;
    });
    const up = () => { if (sx === null) return; sx = null; if (!moved && APP.run) { $("btnPlay").click(); } else if (moved) { APP.playing = false; $("btnPlay").textContent = "▶"; } };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", () => { sx = null; });
    function clamp01(t) { return Math.max(0, Math.min(APP.tEnd, t)); }
    void wasPlaying;
  })();

  // ---------------- mobile settings drawer (bottom sheet)
  const mq = window.matchMedia("(max-width: 820px)");
  function openDrawer() { document.body.classList.add("drawer-open"); }
  function closeDrawer() { document.body.classList.remove("drawer-open"); }
  APP.openDrawer = openDrawer; APP.closeDrawer = closeDrawer;
  $("btnDrawer").addEventListener("click", () => document.body.classList.toggle("drawer-open"));
  $("drawerClose").addEventListener("click", closeDrawer);
  $("scrim").addEventListener("click", closeDrawer);
  $("introSetup").addEventListener("click", openDrawer);
  void mq;
  // iOS/Android: (re)resume WebAudio inside a user gesture
  document.addEventListener("touchend", () => { if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume(); }, { passive: true });

  // ---------------- Monte Carlo (seed + environment dispersions), run in chunks to keep the UI alive
  $("btnMC").addEventListener("click", () => runMC(+$("mcN").value));
  function runMC(N) {
    if (APP.locked) return Promise.resolve(null);
    lock(true); const base = Object.assign({}, APP.settings), res = [];
    const rng = new SH.RNG((base.seed | 0) + 7777);
    const el = $("mc"); el.classList.remove("hidden");
    return new Promise(done => {
      const step = () => {
        if (res.length >= N) { lock(false); busy(false); drawMC(res, base); done(res); return; }
        const i = res.length;
        const s = Object.assign({}, base, {
          seed: (base.seed | 0) + 101 * (i + 1),
          U10_wind_mps: base.U10_wind_mps + 3 * rng.normal(), jet_peak_mps: base.jet_peak_mps + 8 * rng.normal(),
          gust_amp_mps: base.gust_amp_mps + 4 * rng.normal(), thrust_tf: base.thrust_tf * (1 + 0.01 * rng.normal()),
          cd_scale: base.cd_scale * (1 + 0.05 * rng.normal()), m_dry_t: base.m_dry_t + 3 * rng.normal(),
        });
        busy(true, `Monte Carlo ${i + 1} / ${N}…`);
        setProgress(i / N); simulateAsync(s).catch(() => ({ outcome: { ok: false, code: "ERROR", title: "ERROR" }, summary: {} })).then(r => { res.push({ s, o: r.outcome, S: r.summary }); el.innerHTML = `<h3>Monte Carlo — running ${res.length}/${N}</h3><div class="bar"><div style="width:${100 * res.length / N}%"></div></div>`; step(); });
      };
      step();
    });
  }
  APP.runMC = runMC;
  function drawMC(res, base) {
    const el = $("mc"), N = res.length, ok = res.filter(r => r.o.ok).length;
    const by = {}; for (const r of res) by[r.o.title] = (by[r.o.title] || 0) + 1;
    el.innerHTML = `<h3>Monte Carlo — ${N} runs · catch rate ${(100 * ok / N).toFixed(0)}%</h3>
      <div style="display:flex;gap:16px;flex-wrap:wrap"><canvas id="mcScatter" width="360" height="220"></canvas>
      <div><table>${Object.entries(by).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
      <p style="color:#8ea6c4;max-width:420px">Dispersions per run: random seed (turbulence, engine thrust dispersion, start failures), surface wind σ3 m/s, jet σ8 m/s, gust σ4 m/s, thrust σ1%, Cd σ5%, dry mass σ3 t. Scatter: catch offset vs vertical speed (green = caught, red = failed, plotted at the limits).</p></div></div>`;
    const cv = $("mcScatter"), c = cv.getContext("2d"), W = cv.width, H = cv.height;
    c.strokeStyle = "#2a3f62"; c.strokeRect(30, 10, W - 40, H - 40);
    const X = x => 30 + (x + 3) / 6 * (W - 40), Y = v => 10 + (H - 40) * (1 - v / 3);
    c.fillStyle = "#8ea6c4"; c.font = "10px sans-serif"; c.fillText("offset [m] (−3…3)", W / 2 - 40, H - 8); c.save(); c.translate(10, H / 2 + 40); c.rotate(-Math.PI / 2); c.fillText("|vy| at contact [m/s]", 0, 0); c.restore();
    c.strokeStyle = "rgba(255,82,82,0.5)"; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(30, Y(base.lim_vy_mps)); c.lineTo(W - 10, Y(base.lim_vy_mps)); c.stroke(); c.setLineDash([]);
    for (const r of res) {
      const x = r.S.catch_offset_m ?? 2.9, v = r.S.catch_vertical_speed_mps != null ? Math.abs(r.S.catch_vertical_speed_mps) : 2.9;
      c.fillStyle = r.o.ok ? "#69f0ae" : "#ff5252"; c.beginPath(); c.arc(X(Math.max(-2.95, Math.min(2.95, x))), Y(Math.min(v, 2.95)), 3.5, 0, 7); c.fill();
    }
  }

  // ---------------- init
  buildPanel();
  if (location.hash.length > 1) setSettings(decodeSettings(location.hash.slice(1)));
  renderer.resize();
  requestAnimationFrame(frame);
})(window.SH = window.SH || {});
