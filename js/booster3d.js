/* Super Heavy Block 3 booster as real 3D geometry (three.js, window.THREE).
   Proportions are taken from an orthographic side elevation (12.55 px/m; 72.3 m hull + crown, 9 m diameter):
     hull 0 -> 69.2 m, open hot-stage crown 69.2 -> 72.3 m, grid-fin hinge line ~66.6 m, ribbed vent band 47.5 -> 48.9 m,
     two aero chines on the side-fin azimuths from ~1.0 m to ~28.3 m (angled tops), black aft skirt -0.6 -> 1.8 m with a
     ring of vent panels and a triangular access-hatch emblem, 33 black Raptor 3 bells protruding ~3.7 m below the skirt,
     a raceway down the belly-fin side from the vent band to the skirt, small SpaceX "X" near the bottom.
   Detail pass from close-up photos: tubular silver V-strut crown with black forked clamp feet and a thin top ring over a
     dimpled grey dome; round port rings below the crown; very dark grid fins with deep scalloped teeth on round hinge
     bosses (two side fins high, belly fin ~4.3 m lower); a pointed cylindrical pod + clamped conduit on the -Z face;
     faceted quilted chines with pointed tops and wedge fairings into the black aft band; black triangular plate with the
     red/white hazard placard under a large access-port ring; charcoal Raptor 3 bells with light rims, white numbers and
     a dense black plumbing ring; rivet dots, short seams and heat discolouration in the hull textures.
   Local frame = sim body frame: +Y along the axis from the base, +X = side fin A (catch-pin axis), -X = fin C, +Z = belly
   fin B / raceway side; the LOX landing tank sits toward -Z inside.  Everything is built once; per-frame updates only
   touch transforms, material uniforms and a few scales (fins, gimbals, frost, liquids).                                   */
(function (SH) {
  "use strict";
  const T = window.THREE;
  const R = 4.5, H_HULL = 69.2, H_TOP = 72.3, FIN_Y = 66.6;
  SH.B3 = { R, H_HULL, H_TOP, FIN_Y };

  // ---------------------------------------------------------------- procedural textures
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; }
  function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  // hull: roughness (brushed vertical streaks + ring-weld heat tint) and bump (ring welds every 1.83 m, staggered vertical seams)
  function hullTextures(q) {
    const W = q === "low" ? 512 : 1024, Hh = q === "low" ? 1024 : 2048, pxm = Hh / H_HULL, rr = rnd(7);
    const [cr, gr] = canvas(W, Hh), [cb, gb] = canvas(W, Hh), [cc, gc] = canvas(W, Hh);
    gr.fillStyle = "rgb(70,70,70)"; gr.fillRect(0, 0, W, Hh);
    gc.fillStyle = "rgb(206,209,212)"; gc.fillRect(0, 0, W, Hh);
    for (let i = 0; i < W * 6; i++) {           // vertical brushing streaks
      const x = rr() * W, y = rr() * Hh, l = 20 + rr() * 260, v = 50 + rr() * 50;
      gr.fillStyle = `rgba(${v},${v},${v},0.35)`; gr.fillRect(x, y, 1, l);
    }
    for (let i = 0; i < 260; i++) {             // larger mottled panels (slightly different sheet finish)
      const x = rr() * W, y = rr() * Hh, w = 30 + rr() * 140, h = 40 + rr() * 200, v = 185 + rr() * 45;
      gc.fillStyle = `rgba(${v},${v},${v + 2},0.25)`; gc.fillRect(x, y, w, h);
    }
    gb.fillStyle = "rgb(128,128,128)"; gb.fillRect(0, 0, W, Hh);
    const ring = 1.83;
    for (let k = 0; k * ring < H_HULL; k++) {
      const y = Hh - k * ring * pxm;
      gb.fillStyle = "rgb(95,95,95)"; gb.fillRect(0, y - 2, W, 4);     // weld bead groove
      gb.fillStyle = "rgb(165,165,165)"; gb.fillRect(0, y - 1, W, 1);
      gr.fillStyle = "rgba(150,150,150,0.8)"; gr.fillRect(0, y - 2, W, 4);
      gc.fillStyle = "rgba(160,156,150,0.45)"; gc.fillRect(0, y - 1, W, 2);   // dark weld line
      const nseam = 6, off = (k % 2) * 0.5 / nseam;
      for (let s = 0; s < nseam; s++) {          // faint staggered vertical seams
        const x = ((s / nseam + off + 0.07 * (k % 3)) % 1) * W, y1 = Hh - (k + 1) * ring * pxm;
        gb.fillStyle = "rgb(112,112,112)"; gb.fillRect(x - 1, y1, 2, ring * pxm);
        gc.fillStyle = "rgba(170,170,170,0.35)"; gc.fillRect(x - 0.5, y1, 1, ring * pxm);
      }
    }
    // rivet / fastener dots: rows just above each weld and sparse columns
    for (let k = 0; k * ring < H_HULL; k++) {
      const y = Hh - k * ring * pxm - 5;
      for (let x = rr() * 9; x < W; x += 9 + rr() * 4) { if (rr() < 0.55) { gb.fillStyle = "rgb(150,150,150)"; gb.fillRect(x, y, 2, 2); gc.fillStyle = "rgba(120,122,126,0.5)"; gc.fillRect(x, y, 2, 2); } }
    }
    for (let i = 0; i < 900; i++) { const x = rr() * W, y = rr() * Hh; gb.fillStyle = "rgb(145,145,145)"; gb.fillRect(x, y, 2, 2); gc.fillStyle = "rgba(110,112,116,0.45)"; gc.fillRect(x, y, 2, 2); }
    // heat discolouration: straw/bronze tint low on the hull (engine bay radiant heating) + soot streaks under the fins
    { const gg = gc.createLinearGradient(0, Hh, 0, Hh - 9 * pxm); gg.addColorStop(0, "rgba(176,120,70,0.35)"); gg.addColorStop(0.5, "rgba(170,140,100,0.15)"); gg.addColorStop(1, "rgba(170,150,120,0)"); gc.fillStyle = gg; gc.fillRect(0, Hh - 9 * pxm, W, 9 * pxm); }
    for (let i = 0; i < 40; i++) { const x = rr() * W, y = Hh - rr() * 6 * pxm; gc.fillStyle = `rgba(${150 + rr() * 40},${100 + rr() * 30},${60 + rr() * 30},0.18)`; gc.fillRect(x, y, 20 + rr() * 80, 10 + rr() * 60); }
    // (u = 0 is +Z: fin B lower; u = 0.25 / 0.75 are the side fins A / C)
    for (const [fx, fy] of [[0.25, 66.0], [0.75, 66.0], [0, 61.7]]) { const x = fx * W, y0 = Hh - fy * pxm; const gs = gc.createLinearGradient(0, y0, 0, y0 + 3.5 * pxm); gs.addColorStop(0, "rgba(40,38,36,0.38)"); gs.addColorStop(1, "rgba(40,38,36,0)"); gc.fillStyle = gs; gc.fillRect(x - 18, y0, 36, 3.5 * pxm); }
    const mk = (c, srgb) => { const t = new T.CanvasTexture(c); t.wrapS = T.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = T.SRGBColorSpace; return t; };
    return { rough: mk(cr), bump: mk(cb), color: mk(cc, true) };
  }
  function frostTexture() {
    const [c, g] = canvas(256, 256), rr = rnd(3);
    g.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { const a = 0.15 + rr() * 0.5; g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(rr() * 256, rr() * 256, 1 + rr() * 5, 1 + rr() * 3); }
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(250,252,255,${0.2 + rr() * 0.3})`; g.beginPath(); g.ellipse(rr() * 256, rr() * 256, 4 + rr() * 16, 2 + rr() * 6, 0, 0, 7); g.fill(); }
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(6, 8); return t;
  }
  // quilted / dimpled thermal-protection texture of the chines: bump + colour
  function quiltTextures() {
    const [cb, gb] = canvas(256, 512), [cc, gc] = canvas(256, 512), rr = rnd(11);
    gb.fillStyle = "rgb(110,110,110)"; gb.fillRect(0, 0, 256, 512); gc.fillStyle = "rgb(196,198,201)"; gc.fillRect(0, 0, 256, 512);
    const cw = 32, ch = 26;
    for (let y = 0; y < 512; y += ch) for (let x = 0; x < 256; x += cw) {
      const gr = gb.createRadialGradient(x + cw / 2, y + ch / 2, 1, x + cw / 2, y + ch / 2, cw * 0.62);
      gr.addColorStop(0, "rgb(200,200,200)"); gr.addColorStop(0.75, "rgb(120,120,120)"); gr.addColorStop(1, "rgb(70,70,70)");
      gb.fillStyle = gr; gb.fillRect(x, y, cw, ch);
      const v = 170 + rr() * 50; gc.fillStyle = `rgba(${v},${v},${v + 3},0.5)`; gc.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      gc.fillStyle = "rgba(90,92,96,0.5)"; gc.fillRect(x, y, cw, 1); gc.fillRect(x, y, 1, ch);
    }
    const mk = (c, srgb) => { const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; if (srgb) t.colorSpace = T.SRGBColorSpace; return t; };
    return { bump: mk(cb), color: mk(cc, true) };
  }
  // round access port: dark centre, raised ring of bolt dots
  function portTexture() {
    const [c, g] = canvas(256, 256); g.clearRect(0, 0, 256, 256);
    g.fillStyle = "rgba(150,152,156,1)"; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
    g.fillStyle = "rgba(70,72,76,1)"; g.beginPath(); g.arc(128, 128, 104, 0, 7); g.fill();
    g.fillStyle = "rgba(190,192,196,1)"; g.beginPath(); g.arc(128, 128, 96, 0, 7); g.fill();
    g.fillStyle = "rgba(28,29,32,1)"; g.beginPath(); g.arc(128, 128, 62, 0, 7); g.fill();
    g.fillStyle = "rgba(40,40,44,1)"; for (let k = 0; k < 40; k++) { const a = k / 40 * 6.283; g.beginPath(); g.arc(128 + 114 * Math.cos(a), 128 + 114 * Math.sin(a), 4, 0, 7); g.fill(); }
    g.fillStyle = "rgba(60,60,64,1)"; for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283; g.beginPath(); g.arc(128 + 80 * Math.cos(a), 128 + 80 * Math.sin(a), 3, 0, 7); g.fill(); }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }
  // black triangular plate with the red / white hazard placard
  function placardTexture() {
    const [c, g] = canvas(256, 256); g.fillStyle = "#121315"; g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#f2f2f0"; g.beginPath(); g.moveTo(128, 60); g.lineTo(200, 190); g.lineTo(56, 190); g.closePath(); g.fill();
    g.fillStyle = "#c81e1e"; g.beginPath(); g.moveTo(128, 82); g.lineTo(184, 182); g.lineTo(72, 182); g.closePath(); g.fill();
    g.fillStyle = "#f2f2f0"; g.fillRect(108, 112, 40, 46); g.fillStyle = "#c81e1e"; for (const [x, y] of [[100, 150], [156, 150], [128, 168], [116, 128], [140, 128]]) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); }
    g.fillStyle = "#111"; g.font = "bold 18px sans-serif"; g.fillText("! ", 122, 140);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }
  function numberTexture(n) {
    const [c, g] = canvas(128, 64); g.clearRect(0, 0, 128, 64); g.fillStyle = "rgba(235,235,232,0.92)"; g.font = "bold 40px sans-serif"; g.textAlign = "center"; g.fillText(String(n), 64, 48);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }
  function domeBump() {
    const [c, g] = canvas(512, 128); g.fillStyle = "rgb(128,128,128)"; g.fillRect(0, 0, 512, 128);
    for (let y = 4; y < 128; y += 8) for (let x = (y % 16) ? 4 : 8; x < 512; x += 8) { const gr = g.createRadialGradient(x, y, 0, x, y, 4); gr.addColorStop(0, "rgb(70,70,70)"); gr.addColorStop(1, "rgb(128,128,128)"); g.fillStyle = gr; g.fillRect(x - 4, y - 4, 8, 8); }
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; return t;
  }
  function logoTexture() {
    const [c, g] = canvas(512, 256);
    g.clearRect(0, 0, 512, 256); g.fillStyle = "rgba(25,27,30,0.95)";
    // stylised SpaceX "X": two crossing strokes, the long one sweeping up to the right
    g.beginPath(); g.moveTo(150, 60); g.lineTo(195, 60); g.lineTo(330, 200); g.lineTo(285, 200); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(150, 200); g.lineTo(195, 200); g.lineTo(240, 152); g.lineTo(218, 130); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(262, 108); g.lineTo(420, 30); g.lineTo(300, 125); g.closePath(); g.fill();
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }

  // ---------------------------------------------------------------- materials
  function materials(q, env) {
    const tx = hullTextures(q);
    const steel = new T.MeshPhysicalMaterial({
      color: 0xd9dde1, map: tx.color, metalness: 1.0, roughness: 0.3, roughnessMap: tx.rough, bumpMap: tx.bump, bumpScale: 2.2,
      envMapIntensity: 1.5, anisotropy: q === "low" ? 0 : 0.8, anisotropyRotation: Math.PI / 2, side: T.FrontSide,
    });
    const steelPlain = new T.MeshPhysicalMaterial({ color: 0xc4c8cc, metalness: 1.0, roughness: 0.38, envMapIntensity: 1.0, roughnessMap: tx.rough });
    const steelDark = new T.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.95, roughness: 0.42 });
    const qt = quiltTextures();
    const quilt = new T.MeshPhysicalMaterial({ color: 0xc8ccd0, map: qt.color, bumpMap: qt.bump, bumpScale: 4.0, metalness: 1.0, roughness: 0.3, envMapIntensity: 1.3 });
    const tube = new T.MeshStandardMaterial({ color: 0xb9bdc2, metalness: 1.0, roughness: 0.32 });
    const domeM = new T.MeshStandardMaterial({ color: 0x9a9da1, metalness: 0.8, roughness: 0.5, bumpMap: domeBump(), bumpScale: 1.5 });
    const bell = new T.MeshStandardMaterial({ color: 0x303236, metalness: 0.7, roughness: 0.42, side: T.DoubleSide });
    const rim = new T.MeshStandardMaterial({ color: 0xc4c7cb, metalness: 0.6, roughness: 0.35 });
    const plumbing = new T.MeshStandardMaterial({ color: 0x101113, metalness: 0.5, roughness: 0.55 });
    const port = new T.MeshStandardMaterial({ map: portTexture(), transparent: true, metalness: 0.6, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -3 });
    const placard = new T.MeshStandardMaterial({ map: placardTexture(), metalness: 0.2, roughness: 0.6 });
    const black = new T.MeshStandardMaterial({ color: 0x141517, metalness: 0.35, roughness: 0.62 });
    const charcoal = new T.MeshStandardMaterial({ color: 0x17181a, metalness: 0.45, roughness: 0.6 });
    const engine = new T.MeshStandardMaterial({ color: 0x18191b, metalness: 0.6, roughness: 0.45 });
    const vent = new T.MeshStandardMaterial({ color: 0x5d636a, metalness: 0.7, roughness: 0.4 });
    const slot = new T.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0.2, roughness: 0.8 });
    const frost = new T.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.95, metalness: 0, transparent: true, alphaMap: frostTexture(), opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const logo = new T.MeshStandardMaterial({ map: logoTexture(), transparent: true, roughness: 0.6, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -3 });
    const glowNozzle = new T.MeshBasicMaterial({ color: 0xfff2e0, side: T.DoubleSide, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
    return { steel, steelPlain, steelDark, black, charcoal, engine, vent, slot, frost, logo, glowNozzle, tx, quilt, tube, domeM, bell, rim, plumbing, port, placard };
  }

  const merge = (gs) => T.mergeGeometries(gs.map(g => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute("uv", new T.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    n.clearGroups(); return n;
  }), false);
  SH.merge3 = merge;
  function boxAt(w, h, d, x, y, z, ry, rz, rx) { const g = new T.BoxGeometry(w, h, d); const m = new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0, "YZX")), new T.Vector3(1, 1, 1)); g.applyMatrix4(m); return g; }
  function strut(a, b, r, seg) {   // cylinder between two points
    const va = new T.Vector3(...a), vb = new T.Vector3(...b), d = vb.clone().sub(va), L = d.length();
    const g = new T.CylinderGeometry(r, r, L, seg || 6, 1, true); g.translate(0, L / 2, 0);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize())); g.translate(va.x, va.y, va.z); return g;
  }

  // ---------------------------------------------------------------- grid fin (hexagonal egg-crate lattice)
  // fin local frame: +X radial outward from the hinge, Z = chord (tangential), Y = thickness (axis direction)
  function finGeometry(q) {
    const span = 4.3, th = 1.2, r0 = 0.25;
    // chunky hexagonal planform with cropped root/tip corners (top view: x radial, z chord)
    const P = [[r0, -1.25], [r0 + 1.0, -1.65], [span - 1.0, -1.65], [span, -1.05], [span, 1.05], [span - 1.0, 1.65], [r0 + 1.0, 1.65], [r0, 1.25]];
    const shape = new T.Shape(); P.forEach(([x, z], i) => i ? shape.lineTo(x, z) : shape.moveTo(x, z));
    const inset = 0.22, cx = (r0 + span) / 2;
    const hole = new T.Path(); P.slice().reverse().forEach(([x, z], i) => { const xx = cx + (x - cx) * (1 - inset / ((span - r0) / 2)), zz = z * (1 - inset / 1.65); i ? hole.lineTo(xx, zz) : hole.moveTo(xx, zz); });
    shape.holes.push(hole);
    const frame = new T.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false, curveSegments: 1 });
    frame.rotateX(Math.PI / 2); frame.translate(0, th / 2, 0);   // shape XY -> XZ plane, thickness along Y
    // diagonal egg-crate walls clipped to the (inset) convex polygon
    const poly = P.map(([x, z]) => [cx + (x - cx) * (1 - inset / ((span - r0) / 2)), z * (1 - inset / 1.65)]);
    const walls = [], pitch = q === "low" ? 0.62 : 0.46, wt = 0.07;
    for (const ang of [Math.PI / 4, -Math.PI / 4]) {
      const dx = Math.cos(ang), dz = Math.sin(ang), nx = -dz, nz = dx;
      for (let o = -6; o <= 6; o += pitch) {
        // line: p = o*n + t*d ; clip against polygon edges
        let t0 = -1e9, t1 = 1e9;
        for (let i = 0; i < poly.length; i++) {
          const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
          const ex = bx - ax, ez = bz - az, inx = -ez, inz = ex;   // inward normal for CW/CCW: test with centroid
          const sgn = ((cx - ax) * inx + (0 - az) * inz) > 0 ? 1 : -1;
          const px = o * nx + (cx) - ax, pz = o * nz - az;       // offset origin at (cx,0)
          const num = sgn * (px * inx + pz * inz), den = sgn * (dx * inx + dz * inz);
          if (Math.abs(den) < 1e-9) { if (num < 0) { t0 = 1; t1 = 0; } continue; }
          const tt = -num / den; if (den > 0) t0 = Math.max(t0, tt); else t1 = Math.min(t1, tt);
        }
        if (t1 - t0 < 0.08) continue;
        const L = t1 - t0, tm = (t0 + t1) / 2, mx = cx + o * nx + tm * dx, mz = o * nz + tm * dz;
        walls.push(boxAt(L, th * 0.96, wt, mx, 0, mz, -ang));
      }
    }
    // scalloped "teeth" along the two long edges (visible edge-on as a toothed slab)
    // deep scalloped teeth hanging from every outer edge (the cell walls are cut in arches between the nodes)
    const teeth = [], tw = q === "low" ? 0.6 : 0.46, td = 0.55;
    const tsh = new T.Shape(); tsh.moveTo(-tw / 2, 0); tsh.lineTo(tw / 2, 0); tsh.quadraticCurveTo(tw * 0.08, -td * 0.25, 0, -td); tsh.quadraticCurveTo(-tw * 0.08, -td * 0.25, -tw / 2, 0);
    const tooth = new T.ExtrudeGeometry(tsh, { depth: 0.12, bevelEnabled: false, curveSegments: 3 }); tooth.translate(0, 0, -0.035);
    for (let i = 0; i < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / tw));
      if (i === P.length - 1) continue;   // root edge sits against the hinge
      const ang = Math.atan2(bz - az, bx - ax);
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n, g = tooth.clone();
        g.rotateY(-ang); g.translate(ax + (bx - ax) * f, -th / 2 + 0.02, az + (bz - az) * f); teeth.push(g);
      }
    }
    return merge([frame, ...walls, ...teeth]);
  }
  function hingeGeometry() {
    const blk = boxAt(0.9, 1.0, 1.0, 0.25, 0, 0);
    const disc = new T.CylinderGeometry(0.42, 0.42, 0.3, 20); disc.rotateZ(Math.PI / 2); disc.translate(0.75, 0, 0);
    const boss = new T.CylinderGeometry(0.85, 0.95, 0.35, 28); boss.rotateZ(Math.PI / 2); boss.translate(0.05, 0, 0);   // round hinge boss on the hull
    // wedge fairing down the hull below the hinge (triangular prism, thick at the hinge, fading into the hull)
    const sh = new T.Shape(); sh.moveTo(0, 0); sh.lineTo(0.45, 0); sh.lineTo(0, -1.4); sh.closePath();
    const wedge = new T.ExtrudeGeometry(sh, { depth: 0.7, bevelEnabled: false }); wedge.translate(-0.1, -0.45, -0.35);
    return merge([blk, disc, boss, wedge].map(g => g.toNonIndexed ? g.toNonIndexed() : g));
  }

  // ---------------------------------------------------------------- Raptor 3 engine (lathe) — local: pivot at origin, bell pointing -Y
  function engineGeometry(q) {
    const seg = q === "low" ? 14 : 24;
    const prof = [[0.0, 0.25], [0.42, 0.25], [0.48, 0.05], [0.46, -0.45], [0.34, -0.85], [0.26, -1.05], [0.3, -1.25], [0.42, -1.75], [0.52, -2.4], [0.6, -3.05], [0.645, -3.55], [0.62, -3.56], [0.58, -3.08], [0.5, -2.42], [0.4, -1.78], [0.28, -1.26]];
    const g = new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(r, y)), seg);
    const dome = new T.SphereGeometry(0.42, seg, 6, 0, Math.PI * 2, 0, Math.PI / 2); dome.translate(0, 0.25, 0);
    const pump = new T.CylinderGeometry(0.16, 0.16, 0.7, 8); pump.translate(0.38, -0.3, 0.1);
    const pump2 = new T.CylinderGeometry(0.13, 0.13, 0.6, 8); pump2.translate(-0.34, -0.35, -0.12);
    return merge([g.toNonIndexed(), dome.toNonIndexed(), pump.toNonIndexed(), pump2.toNonIndexed()]);
  }
  function rimGeometry(q) { const t = new T.TorusGeometry(0.635, 0.035, 4, q === "low" ? 14 : 28); t.rotateX(Math.PI / 2); t.translate(0, -3.55, 0); return t; }
  SH.ENGINE_POS = (function () {
    const out = [];
    for (let i = 0; i < 33; i++) {
      let a, r; if (i < 3) { a = Math.PI / 2 + i * 2 * Math.PI / 3; r = 0.75; } else if (i < 13) { a = (i - 3) * 2 * Math.PI / 10; r = 2.1; } else { a = (i - 13) * 2 * Math.PI / 20 + Math.PI / 20; r = 3.95; }
      out.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return out;
  })();

  // ---------------------------------------------------------------- the booster
  class Booster3D {
    constructor(quality, p) {
      this.q = quality || "medium"; this.p = p || {};
      const q = this.q, M = this.mat = materials(q);
      const g = this.group = new T.Group(); g.name = "booster";
      const seg = q === "low" ? 48 : 96;
      // hull
      const hull = new T.Mesh(new T.CylinderGeometry(R, R, H_HULL, seg, 1, true), M.steel); hull.position.y = H_HULL / 2; g.add(hull); this.hull = hull;
      // forward dome (visible inside the open crown) + inner crown ring
      const dome = new T.Mesh(new T.SphereGeometry(R * 0.985, seg, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.domeM); dome.scale.y = 0.42; dome.position.y = H_HULL - 0.1; g.add(dome);
      // hot-stage crown: bottom ring, top ring, zigzag V struts, tabs/brackets at the base
      const crown = [];
      const ringBot = new T.TorusGeometry(R + 0.02, 0.16, 6, seg); ringBot.rotateX(Math.PI / 2); ringBot.translate(0, H_HULL + 0.12, 0); crown.push(ringBot);
      const ringTop = new T.CylinderGeometry(R - 0.05, R - 0.05, 0.16, seg, 1, true); ringTop.translate(0, H_TOP - 0.08, 0); crown.push(ringTop);
      const ringTop2 = new T.TorusGeometry(R - 0.05, 0.06, 4, seg); ringTop2.rotateX(Math.PI / 2); ringTop2.translate(0, H_TOP - 0.16, 0); crown.push(ringTop2);
      const NV = q === "low" ? 16 : 20;
      for (let k = 0; k < NV; k++) {
        const a0 = k / NV * Math.PI * 2, a1 = (k + 0.5) / NV * Math.PI * 2, a2 = (k + 1) / NV * Math.PI * 2, rb = R - 0.05, rt = R - 0.08;
        const P0 = [rb * Math.cos(a0), H_HULL + 0.2, rb * Math.sin(a0)], P1 = [rt * Math.cos(a1), H_TOP - 0.25, rt * Math.sin(a1)], P2 = [rb * Math.cos(a2), H_HULL + 0.2, rb * Math.sin(a2)];
        // tubular V: two struts from a common foot (slightly apart) up to the top ring
        const Pa = [rb * Math.cos(a0 - 0.012), H_HULL + 0.2, rb * Math.sin(a0 - 0.012)], Pb = [rb * Math.cos(a0 + 0.012), H_HULL + 0.2, rb * Math.sin(a0 + 0.012)];
        const Tl = [rt * Math.cos(a0 - 0.5 / NV * Math.PI * 2 * 0.9), H_TOP - 0.2, rt * Math.sin(a0 - 0.5 / NV * Math.PI * 2 * 0.9)], Tr = [rt * Math.cos(a0 + 0.5 / NV * Math.PI * 2 * 0.9), H_TOP - 0.2, rt * Math.sin(a0 + 0.5 / NV * Math.PI * 2 * 0.9)];
        crown.push(strut(Pa, Tl, 0.13, 8), strut(Pb, Tr, 0.13, 8));
      }
      const crownMesh = new T.Mesh(merge(crown.map(x => x.index ? x.toNonIndexed() : x)), M.tube); g.add(crownMesh);
      // black forked clamp feet on the hull under each V
      const tabs = [];
      for (let k = 0; k < NV; k++) {
        const a = k / NV * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), tx = -s, tz = c, rr = R + 0.12;
        for (const o of [-0.13, 0.13]) tabs.push(boxAt(0.12, 0.95, 0.16, rr * c + tx * o, H_HULL - 0.35, rr * s + tz * o, -a));
        tabs.push(boxAt(0.18, 0.28, 0.46, rr * c, H_HULL + 0.05, rr * s, -a));
      }
      g.add(new T.Mesh(merge(tabs), M.black));
      // small round port rings just below the crown and the big access port above the aft placard
      { const ports2 = [];
        for (const [a, y, d] of [[-Math.PI / 2 - 0.55, 67.9, 0.9], [-Math.PI / 2 + 0.35, 67.9, 0.9], [-Math.PI / 2 + 0.75, 67.6, 0.75], [Math.PI / 2 + 0.6, 67.9, 0.9], [Math.PI / 2 - 0.7, 67.7, 0.8], [0.6, 67.9, 0.8], [Math.PI - 0.6, 67.9, 0.8], [-Math.PI / 2, 4.15, 2.0]]) {
          const pl = new T.PlaneGeometry(d, d, 6, 1), ps = pl.attributes.position;
          for (let i = 0; i < ps.count; i++) { const x = ps.getX(i), aa = x / R; ps.setXYZ(i, (R + 0.02) * Math.sin(aa), ps.getY(i), (R + 0.02) * Math.cos(aa)); }
          pl.computeVertexNormals(); pl.rotateY(Math.PI / 2 - a); pl.translate(0, y, 0); ports2.push(pl);
        }
        g.add(new T.Mesh(merge(ports2), M.port)); }
      // long cylindrical pod with a pointed top on the -Z face between the side fins, feeding a clamped conduit
      { const pod = [], az = -Math.PI / 2 + 0.28, pc = Math.cos(az), ps = Math.sin(az), pr = 0.42, rr = R + pr + 0.05;
        const cylp = new T.CylinderGeometry(pr, pr * 0.8, 8.5, 16); cylp.translate(rr * pc, 60.9, rr * ps); pod.push(cylp);
        const cone = new T.ConeGeometry(pr, 2.2, 16); cone.translate(rr * pc, 66.25, rr * ps); pod.push(cone);
        const cone2 = new T.ConeGeometry(pr * 0.8, 1.6, 16); cone2.rotateX(Math.PI); cone2.translate(rr * pc, 55.85, rr * ps); pod.push(cone2);
        g.add(new T.Mesh(merge(pod), M.steelPlain));
        const az2 = az + 0.13, c2 = Math.cos(az2), s2 = Math.sin(az2), rc = R + 0.2, cd = [];
        const pipe = new T.CylinderGeometry(0.11, 0.11, 64.5, 8, 1, true); pipe.translate(rc * c2, 1.8 + 32.25, rc * s2); cd.push(pipe);
        for (let y = 2.6; y < 66; y += 1.83) cd.push(boxAt(0.3, 0.16, 0.36, (R + 0.12) * c2, y, (R + 0.12) * s2, -az2));
        g.add(new T.Mesh(merge(cd), M.steelDark)); }
      // ribbed vent band (common-dome level) with vertical slots
      const band = [];
      const b0 = 47.5, b1 = 48.9;
      const bandCyl = new T.CylinderGeometry(R + 0.05, R + 0.05, b1 - b0, seg, 1, true); bandCyl.translate(0, (b0 + b1) / 2, 0);
      g.add(new T.Mesh(bandCyl, M.steelDark));
      for (const yy of [b0, b1]) { const t = new T.TorusGeometry(R + 0.07, 0.07, 4, seg); t.rotateX(Math.PI / 2); t.translate(0, yy, 0); band.push(t.toNonIndexed()); }
      g.add(new T.Mesh(merge(band), M.steelPlain));
      const slots = [], NS = q === "low" ? 40 : 72;
      for (let k = 0; k < NS; k++) { const a = k / NS * Math.PI * 2; slots.push(boxAt(0.08, (b1 - b0) * 0.72, 0.16, (R + 0.07) * Math.cos(a), (b0 + b1) / 2, (R + 0.07) * Math.sin(a), -a)); }
      g.add(new T.Mesh(merge(slots), M.slot));
      // chines: tall flat faceted strakes on the side-fin azimuths (+X / -X) with pointed angled tops, quilted / dimpled
      // standoff panels, and faceted wedge fairings at the bottom running down into the black aft band
      const cy0 = -0.4, cy1 = 28.3, rb0 = R - 0.15;
      const chS = new T.Shape(); [[rb0, -0.75], [R + 0.75, -0.7], [R + 1.4, -0.36], [R + 1.4, 0.36], [R + 0.75, 0.7], [rb0, 0.75]].forEach(([x, y], i) => i ? chS.lineTo(x, y) : chS.moveTo(x, y)); chS.closePath();
      M.quilt.map.repeat.set(0.45, 0.45); M.quilt.bumpMap.repeat.set(0.45, 0.45);
      for (const s of [1, -1]) {
        const cg = new T.ExtrudeGeometry(chS, { depth: cy1 - cy0, steps: 40, bevelEnabled: false }); cg.rotateX(-Math.PI / 2); cg.translate(0, cy0, 0);
        const ps = cg.attributes.position;
        for (let i = 0; i < ps.count; i++) {
          const x = ps.getX(i), y = ps.getY(i), z = ps.getZ(i);
          const tTop = Math.min(Math.max((y - (cy1 - 4.2)) / 4.2, 0), 1);            // pointed top: depth and width -> 0
          const tBot = Math.min(Math.max((cy0 + 2.6 - y) / 2.6, 0), 1);              // bottom wedge fairing: angled facets
          const kd = (1 - tTop) * (1 - 0.72 * tBot), kw = (1 - 0.85 * tTop) * (1 - 0.25 * tBot);
          ps.setXYZ(i, rb0 + (x - rb0) * kd, y, z * kw);
        }
        cg.computeVertexNormals();
        if (s < 0) cg.rotateY(Math.PI);
        g.add(new T.Mesh(cg, M.quilt));
      }
      // raceway down the +Z side (belly-fin side) from the vent band to the skirt, with clamps
      const rw = [boxAt(0.26, 45.5, 0.2, 0, 1.8 + 22.75, R + 0.08)];
      for (let y = 3; y < 47; y += 1.83) rw.push(boxAt(0.4, 0.1, 0.28, 0, y, R + 0.1));
      g.add(new T.Mesh(merge(rw), M.vent));
      // small round ports
      const ports = [];
      for (const [a, y, r] of [[0.35, 44.3, 0.32], [Math.PI + 0.5, 31.0, 0.28], [-0.9, 58.5, 0.25], [2.4, 12.0, 0.3]]) { const c = new T.CylinderGeometry(r, r, 0.12, 16); c.rotateZ(Math.PI / 2); c.rotateY(-a); c.translate((R + 0.02) * Math.cos(a), y, (R + 0.02) * Math.sin(a)); ports.push(c.toNonIndexed()); }
      g.add(new T.Mesh(merge(ports), M.slot));
      // SpaceX logo decal near the bottom on the +Z side (slightly curved plane)
      const lg = new T.PlaneGeometry(2.2, 1.1, 8, 1); const pos = lg.attributes.position;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), a = x / R; pos.setXYZ(i, (R + 0.015) * Math.sin(a), pos.getY(i), (R + 0.015) * Math.cos(a)); }
      lg.computeVertexNormals(); const logo = new T.Mesh(lg, M.logo); logo.position.y = 2.75; logo.rotation.y = -0.18; g.add(logo);
      // black aft skirt with scalloped tabs reaching up between the chines, vent panel ring and the access-hatch emblem
      const sk = new T.CylinderGeometry(R + 0.06, R + 0.12, 2.4, seg, 1, true); sk.translate(0, 0.6, 0);
      g.add(new T.Mesh(sk, M.black));
      const bot = new T.Mesh(new T.CircleGeometry(R + 0.1, seg), M.black); bot.rotation.x = Math.PI / 2; bot.position.y = -0.6; g.add(bot);
      const skTabs = [];
      for (let k = 0; k < 6; k++) {
        if (k === 4) continue;   // -Z: hazard placard plate instead
        const a = k / 6 * Math.PI * 2 + Math.PI / 6;
        const sh = new T.Shape(); sh.moveTo(-1.1, 0); sh.lineTo(1.1, 0); sh.lineTo(0.35, 0.8); sh.lineTo(-0.35, 0.8); sh.closePath();
        const tg = new T.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false }); tg.translate(0, 1.75, R + 0.02); tg.rotateY(Math.PI / 2 - a); skTabs.push(tg.toNonIndexed());
      }
      g.add(new T.Mesh(merge(skTabs), M.black));
      const vents = [], NVt = q === "low" ? 28 : 44;
      for (let k = 0; k < NVt; k++) { const a = k / NVt * Math.PI * 2; vents.push(boxAt(0.12, 0.42, 0.42, (R + 0.13) * Math.cos(a), 0.55, (R + 0.13) * Math.sin(a), -a)); }
      g.add(new T.Mesh(merge(vents), M.charcoal));
      // black triangular plate with the red / white hazard placard on the -Z face between the chines (below the access port)
      const hz = new T.Shape(); hz.moveTo(-1.25, 0); hz.lineTo(1.25, 0); hz.lineTo(0, 2.1); hz.closePath();
      const hatch = new T.ExtrudeGeometry(hz, { depth: 0.08, bevelEnabled: false });
      M.placard.map.repeat.set(1 / 2.5, 1 / 2.1); M.placard.map.offset.set(0.5, 0);
      const hm = new T.Mesh(hatch, [M.placard, M.black]); hm.rotation.y = Math.PI; hm.position.set(0, 0.55, -(R + 0.14)); g.add(hm);
      // engines: 20 outer fixed, 13 inner gimballed (pivot at y = -0.75)
      const eg = engineGeometry(q), rg = rimGeometry(q); this.engines = [];
      const numbered = { 13: 15, 15: 19, 17: 1, 19: 5, 21: 200, 24: 30, 26: 18, 29: 387, 31: 9, 8: 22, 5: 11 };
      // thrust-section plumbing: dense black manifold rings, valve blocks and drop pipes above the engines
      { const pl = [];
        for (const [rr, y, tr] of [[4.3, -0.72, 0.16], [4.22, -0.98, 0.13], [4.12, -1.22, 0.12], [4.0, -1.45, 0.1], [4.35, -1.62, 0.08], [3.05, -0.8, 0.11], [2.95, -1.05, 0.09], [2.85, -1.3, 0.08], [1.45, -0.85, 0.09], [1.35, -1.1, 0.07]]) { const t = new T.TorusGeometry(rr, tr, 5, seg); t.rotateX(Math.PI / 2); t.translate(0, y, 0); pl.push(t); }
        const NB = q === "low" ? 24 : 44;
        for (let k = 0; k < NB; k++) {
          const a = k / NB * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          pl.push(boxAt(0.34, 0.42, 0.3, 4.38 * c, -0.92, 4.38 * s, -a));                       // valve / manifold blocks
          if (k % 2 === 0) pl.push(boxAt(0.22, 0.26, 0.36, 4.3 * c, -1.36, 4.3 * s, -a));         // clamps
          if (q !== "low") {
            pl.push(strut([4.2 * Math.cos(a + 0.05), -0.62, 4.2 * Math.sin(a + 0.05)], [3.9 * Math.cos(a + 0.05), -1.75, 3.9 * Math.sin(a + 0.05)], 0.055, 5));   // drop pipes
            pl.push(strut([4.25 * Math.cos(a - 0.04), -1.0, 4.25 * Math.sin(a - 0.04)], [3.3 * Math.cos(a - 0.02), -1.5, 3.3 * Math.sin(a - 0.02)], 0.045, 5));  // feed lines inward
          }
        }
        const NI = q === "low" ? 10 : 20;
        for (let k = 0; k < NI; k++) { const a = k / NI * Math.PI * 2 + 0.1; pl.push(boxAt(0.26, 0.32, 0.24, 3.0 * Math.cos(a), -0.95, 3.0 * Math.sin(a), -a)); }
        g.add(new T.Mesh(merge(pl), M.plumbing)); }
      const nozGlow = new T.CircleGeometry(0.6, 20);
      for (let i = 0; i < 33; i++) {
        const [ex, ez] = SH.ENGINE_POS[i]; const piv = new T.Group(); piv.position.set(ex, -0.75, ez);
        const m = new T.Mesh(eg, M.bell); piv.add(m); piv.add(new T.Mesh(rg, M.rim));
        if (numbered[i] !== undefined && q !== "low") {
          const phi = Math.atan2(ez, ex), nm = new T.Mesh(new T.PlaneGeometry(0.62, 0.31), new T.MeshBasicMaterial({ map: numberTexture(numbered[i]), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
          nm.position.set(0.555 * Math.cos(phi), -2.55, 0.555 * Math.sin(phi)); nm.rotation.set(0, Math.PI / 2 - phi, 0); nm.rotateX(-0.12); piv.add(nm);
        }
        const gl = new T.Mesh(nozGlow, M.glowNozzle.clone()); gl.rotation.x = Math.PI / 2; gl.position.y = -3.3; piv.add(gl);   // hot throat seen from below
        g.add(piv); this.engines.push({ piv, glow: gl });
      }
      // grid fins (A +X, B +Z, C -X) on hinge blocks; fin pivots about its radial hinge axis
      const fg = finGeometry(q), hg = hingeGeometry(); this.fins = [];
      for (const az of [0, Math.PI / 2, Math.PI]) {
        // the two side fins sit high under the crown, the third (B, belly side) ~4.3 m lower (reference photos)
        const root = new T.Group(); root.rotation.y = -az; root.position.y = az === Math.PI / 2 ? FIN_Y - 4.3 : FIN_Y; g.add(root);
        const hb = new T.Mesh(hg, M.steelDark); hb.position.x = R - 0.1; root.add(hb);
        const droop = new T.Group(); droop.position.x = R + 0.55; droop.rotation.z = -0.06; root.add(droop);   // fins droop slightly at rest
        const pv = new T.Group(); droop.add(pv);
        const fm = new T.Mesh(fg, M.charcoal); pv.add(fm);
        this.fins.push(pv);
      }
      // frost overlays (scaled each frame from live liquid levels)
      this.frost = {};
      const fr = (name) => { const m = new T.Mesh(new T.CylinderGeometry(R + 0.03, R + 0.03, 1, seg, 1, true), M.frost); m.visible = false; m.renderOrder = 2; g.add(m); this.frost[name] = m; };
      fr("lox"); fr("ch4");
      const fl = new T.Mesh(new T.CylinderGeometry(R + 0.035, R + 0.035, 1, 16, 1, true, -Math.PI / 2 - 0.45, 0.9), M.frost); fl.visible = false; g.add(fl); this.frost.loxL = fl;
      this.buildInternals();
      this.setTransparent(false);
    }
    // ---- internals for the transparency mode: tank shells + clipped liquid volumes with sloshing free surfaces
    buildInternals() {
      const p = this.p, I = this.internals = new T.Group(); I.visible = false; this.group.add(I);
      const shell = new T.MeshBasicMaterial({ color: 0xbfd6ff, wireframe: true, transparent: true, opacity: 0.18 });
      const mkLiquid = (col) => new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.82, side: T.DoubleSide, clippingPlanes: [new T.Plane()] });
      const zA = p.lox_tank_bottom_m || 4, zC = p.ch4_tank_bottom_m || 38, rT = p.tube_R_m || 0.9, lt = { x: p.lox_land_xoff_m || 2.6, r: p.lox_land_R_m || 1.6, zb: p.lox_land_zb_m || 5, h: p.lox_land_h_m || 7 };
      this.tk = { zA, zC, rT, lt, zTb: p.tube_zb_m || 2.6, zV: p.tube_valve_z_m || 20 };
      const cyl = (r, y0, y1, mat, x, z, seg) => { const m = new T.Mesh(new T.CylinderGeometry(r, r, y1 - y0, seg || 48, 1, false), mat); m.position.set(x || 0, (y0 + y1) / 2, z || 0); I.add(m); return m; };
      cyl(R - 0.05, zA, zC, shell); cyl(R - 0.05, zC, H_HULL, shell); cyl(rT, this.tk.zTb, zC, shell, 0, 0, 12); cyl(lt.r, lt.zb, lt.zb + lt.h, shell, 0, -lt.x, 16);
      const surf = (col) => { const m = new T.Mesh(new T.CircleGeometry(1, 40), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: T.DoubleSide })); I.add(m); return m; };
      this.liq = {
        lox: { m: cyl(R - 0.1, zA, zC, mkLiquid(0x6fb8ff)), s: surf(0xcfe8ff), r: R - 0.1 },
        ch4: { m: cyl(R - 0.1, zC, H_HULL - 0.5, mkLiquid(0xffa04a)), s: surf(0xffd9b0), r: R - 0.1 },
        loxL: { m: cyl(lt.r - 0.05, lt.zb, lt.zb + lt.h, mkLiquid(0x3f8cff), 0, -lt.x, 24), s: surf(0xbfe0ff), r: lt.r - 0.05 },
        ch4L: { m: cyl(rT - 0.05, this.tk.zTb, this.tk.zV, mkLiquid(0xff7a1a), 0, 0, 16), s: surf(0xffc890), r: rT - 0.05 },
      };
      // CG marker
      this.cgMark = new T.Mesh(new T.SphereGeometry(0.6, 16, 10), new T.MeshBasicMaterial({ color: 0xffffff })); I.add(this.cgMark);
    }
    setTransparent(on) {
      this.transparent = on; const M = this.mat;
      for (const m of [M.steel, M.steelPlain, M.steelDark, M.black]) { m.transparent = on; m.opacity = on ? 0.16 : 1; m.depthWrite = !on; m.needsUpdate = true; }
      this.internals.visible = on;
    }
    // per-frame update from the sampled sim state S (2D + 6-DOF log keys)
    update(S, t) {
      const p = this.p;
      // grid fin deflections (deg, positive = leading edge per sim convention) about each radial hinge
      const fd = [S.fin0, S.fin1, S.fin2];
      for (let i = 0; i < 3; i++) this.fins[i].rotation.x = ((fd[i] != null ? fd[i] : (S.fin || 0) * 20) * Math.PI / 180);
      // inner 13 gimbal: pitch/yaw from gx/gz (deg) plus differential roll gimbal
      const gx = (S.gx != null ? S.gx : S.gimbal || 0) * Math.PI / 180, gz = (S.gz || 0) * Math.PI / 180, gr = (S.groll || 0) * Math.PI / 180;
      for (let i = 0; i < 13; i++) {
        const e = this.engines[i], [ex, ez] = SH.ENGINE_POS[i], phi = Math.atan2(ez, ex);
        const sx = gx - gr * Math.sin(phi), sz = gz + gr * Math.cos(phi);
        e.piv.rotation.set(sz, 0, -sx);  // tilt bell so thrust gets the commanded lateral component
      }
      // throat glow per engine (spool)
      for (let i = 0; i < 33; i++) { const sp = S.spool ? S.spool[i] : 0; this.engines[i].glow.material.opacity = Math.min(1, sp * (0.4 + 0.6 * (S.thr || 0))); }
      // frost bands tied to the live liquid levels (melting back with aero heating)
      const heat = Math.min(Math.max((S.q || 0) / 120e3, 0), 1), tk = this.tk;
      const band = (m, y0, y1) => { if (y1 - y0 < 0.1) { m.visible = false; return; } m.visible = !this.transparent; m.scale.y = y1 - y0; m.position.y = (y0 + y1) / 2; };
      band(this.frost.lox, tk.zA, tk.zA + (S.lox_h || 0) + 0.4);
      const zch = (p.v3 ? tk.zV : tk.zC) + (S.ch4_h || 0);
      band(this.frost.ch4, tk.zC, S.ch4_m > 50 ? Math.min(zch + 0.3, H_HULL - 1) : tk.zC);
      band(this.frost.loxL, tk.lt.zb, tk.lt.zb + (S.loxL_h || 0));
      this.mat.frost.opacity = 0.85 * (1 - 0.8 * heat);
      if (this.transparent) this.updateLiquids(S, t);
    }
    updateLiquids(S, t) {
      const tk = this.tk, L = this.liq, G = this.group; G.updateMatrixWorld(true);
      const set = (o, level, psiA, psiB, cx, cz) => {
        if (!(level > 0.02)) { o.m.visible = o.s.visible = false; return; }
        o.m.visible = o.s.visible = true;
        // free surface normal in body frame: tilted by the two slosh angles (pendulum mode 1, axes X and Z) + ripple
        const a = (psiA || 0) + 0.02 * Math.sin(t * 3.1), b = (psiB || 0) + 0.02 * Math.sin(t * 2.3 + 1);
        const n = new T.Vector3(-Math.sin(a), 1, -Math.sin(b)).normalize();   // -> liquid lags the lateral acceleration
        const pt = new T.Vector3(cx, level, cz);
        const nW = n.clone().transformDirection(G.matrixWorld), pW = pt.clone().applyMatrix4(G.matrixWorld);
        o.m.material.clippingPlanes[0].setFromNormalAndCoplanarPoint(nW.negate(), pW);
        o.s.position.copy(pt); o.s.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), n); o.s.scale.setScalar(o.r);
      };
      set(L.lox, tk.zA + (S.lox_h || 0) + (S.lox_zp || 0), S.lox_psi1, S.lox_psi1b, 0, 0);
      const zch = (this.p.v3 ? tk.zV : tk.zC) + (S.ch4_h || 0);
      set(L.ch4, S.ch4_m > 20 && zch > tk.zC ? zch + (S.ch4_zp || 0) : 0, S.ch4_psi1, S.ch4_psi1b, 0, 0);
      set(L.loxL, S.loxL_m > 5 ? tk.lt.zb + (S.loxL_h || 0) + (S.loxL_zp || 0) : 0, S.loxL_psi1, S.loxL_psi1b, 0, -tk.lt.x);
      set(L.ch4L, S.ch4L_m > 5 ? tk.zTb + (S.ch4L_h || 0) : 0, S.ch4L_psi1, 0, 0, 0);
      this.cgMark.position.set(S.cgx || 0, S.cg || 24, S.cgz || 0);
    }
  }
  SH.Booster3D = Booster3D;
})(window.SH = window.SH || {});
