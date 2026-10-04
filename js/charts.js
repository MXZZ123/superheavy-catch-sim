/* Charts (uPlot): altitude, velocity, g, q, throttle/engines, propellant, slosh, wind, CG.
   A playback cursor line is drawn at the current time; an optional reference run is overlaid dashed. */
(function (SH) {
  "use strict";
  const D2R = Math.PI / 180;
  const DEFS = [
    { id: "alt", title: "Altitude [km]", s: [["alt", "#4fc3f7", L => L.yb.map(v => v / 1000)]] },
    { id: "vel", title: "Velocity [m/s]", s: [["|V|", "#ffd54f", L => L.vx.map((v, i) => Math.hypot(v, L.vy[i]))], ["vy", "#ff8a65", L => Array.from(L.vy)]] },
    { id: "g", title: "g-load [g]", s: [["g", "#ef5350", L => Array.from(L.g_load)]] },
    { id: "q", title: "Dynamic pressure [kPa]", s: [["q", "#ab47bc", L => L.q.map(v => v / 1000)]] },
    { id: "thr", title: "Throttle [%] · engines lit", s: [["throttle %", "#ffa726", L => L.thr.map(v => v * 100)], ["engines", "#e0e0e0", L => Array.from(L.n)]] },
    { id: "prop", title: "Propellant [t]", s: [["LOX main", "#96d6ff", L => L.lox_m.map(v => v / 1000)], ["CH4 main", "#ffaa50", L => L.ch4_m.map(v => v / 1000)], ["LOX landing", "#4a9eff", L => L.loxL_m.map(v => v / 1000)], ["CH4 column", "#ff7a1a", L => L.ch4L_m.map(v => v / 1000)]] },
    { id: "slosh", title: "Slosh angle mode 1 [deg] (main · landing)", s: [["LOX main", "#96d6ff", L => L.lox_psi1.map(v => v / D2R)], ["CH4 main", "#ffaa50", L => L.ch4_psi1.map(v => v / D2R)], ["LOX landing", "#4a9eff", L => L.loxL_psi1.map(v => v / D2R)]] },
    { id: "wind", title: "Wind at vehicle [m/s]", s: [["total", "#80cbc4", L => Array.from(L.wind_x)], ["mean", "#26a69a", L => Array.from(L.wind_mean)], ["gust", "#ffee58", L => Array.from(L.wind_gust)]] },
    { id: "cg", title: "CG station from base [m] · vent [t/s]", s: [["CG", "#e1bee7", L => Array.from(L.cg)], ["vent t/s", "#fff59d", L => L.vent_o.map((v, i) => (v + L.vent_f[i]) / 1000)]] },
  ];
  class Charts {
    constructor(el) { this.el = el; this.plots = []; this.t = 0; }
    build(run, ref) {
      this.el.innerHTML = ""; this.plots = [];
      const L = run.log, x = Array.from(L.t);
      for (const d of DEFS) {
        const box = document.createElement("div"); box.className = "chart"; this.el.appendChild(box);
        const series = [{}], data = [x];
        for (const [nm, col, fn] of d.s) { series.push({ label: nm, stroke: col, width: 1.4, points: { show: false } }); data.push(fn(L)); }
        if (ref) {   // reference run resampled onto this run's time base
          const RL = ref.log, rt = RL.t;
          for (const [nm, col, fn] of d.s.slice(0, 2)) {
            const ry = fn(RL), out = new Array(x.length);
            let j = 0; for (let i = 0; i < x.length; i++) { while (j < rt.length - 2 && rt[j + 1] < x[i]) j++; out[i] = x[i] > rt[rt.length - 1] ? null : ry[j]; }
            series.push({ label: nm + " (ref)", stroke: col, width: 1, dash: [5, 4], points: { show: false } }); data.push(out);
          }
        }
        const self = this;
        const opts = {
          title: d.title, width: 300, height: 150, series, legend: { show: true, live: false },
          axes: [{ stroke: "#8ea6c4", grid: { stroke: "rgba(255,255,255,0.06)" }, ticks: { stroke: "rgba(255,255,255,0.1)" }, size: 26 },
                 { stroke: "#8ea6c4", grid: { stroke: "rgba(255,255,255,0.06)" }, ticks: { stroke: "rgba(255,255,255,0.1)" }, size: 52 }],
          scales: { x: { time: false } }, cursor: { drag: { x: false, y: false } },
          hooks: { draw: [u => { const X = u.valToPos(self.t, "x", true); const c = u.ctx; c.save(); c.strokeStyle = "rgba(255,255,255,0.75)"; c.lineWidth = 1; c.beginPath(); c.moveTo(X, u.bbox.top); c.lineTo(X, u.bbox.top + u.bbox.height); c.stroke(); c.restore(); }] },
        };
        const u = new uPlot(opts, data, box); this.plots.push(u);
      }
      this.resize();
    }
    resize() {
      const w = this.el.clientWidth; if (!w) return;
      const cols = w > 1500 ? 5 : w > 1100 ? 4 : w > 860 ? 3 : w > 560 ? 2 : 1, cw = Math.floor((w - (cols - 1) * 8) / cols) - 8;
      const hh = cols === 1 ? 170 : 150; for (const u of this.plots) u.setSize({ width: cw, height: hh });
    }
    setTime(t) { this.t = t; for (const u of this.plots) u.redraw(false, false); }
  }
  SH.Charts = Charts;
})(window.SH = window.SH || {});
