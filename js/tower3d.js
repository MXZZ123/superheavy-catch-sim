/* Mechazilla (OLIT-1 / Pad 1 Starbase) — high-density visual rebuild.
   Dense tubular lattice chopsticks, mechanical carriage, weathered OLIT, ship QD.
   Hitch kinematics (SH.MECH) unchanged so 6-DOF catch stays aligned.
   Geometry is merged per-material (few draw calls); tube segs kept low for SwiftShader. */
(function (SH) {
  "use strict";
  const T = window.THREE;
  const D2R = Math.PI / 180;
  const HINGE_X = 5.2, HINGE_Y = -4.2, HINGE_Z = 4.6, ARM_W = 2.6, TOWER_BACK = 22, ARM_LEN = 36.0;
  SH.MECH = { HINGE_X, HINGE_Y, HINGE_Z, ARM_W, TOWER_BACK, ARM_LEN, TOWER_H: 146.3, ARM_TOP: 125 };

  function merge(gs) {
    if (!gs.length) return new T.BufferGeometry();
    if (SH.merge3) return SH.merge3(gs);
    return T.mergeGeometries(gs.map(g => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(k)) n.deleteAttribute(k);
      if (!n.attributes.uv) n.setAttribute("uv", new T.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
      n.clearGroups(); return n;
    }), false);
  }
  // Shared low-seg cylinder prototypes → clone + matrix (cheap)
  const _cylCache = new Map();
  function cylProto(r, seg) {
    const k = r.toFixed(3) + ":" + seg;
    if (!_cylCache.has(k)) _cylCache.set(k, new T.CylinderGeometry(r, r, 1, seg, 1, false));
    return _cylCache.get(k);
  }
  function tube(a, b, r, seg) {
    const va = new T.Vector3(a[0], a[1], a[2]), vb = new T.Vector3(b[0], b[1], b[2]);
    const d = vb.clone().sub(va), L = d.length();
    if (L < 1e-4) return new T.BoxGeometry(0.01, 0.01, 0.01);
    const g = cylProto(r, seg || 6).clone();
    g.scale(1, L, 1); g.translate(0, L / 2, 0);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()));
    g.translate(va.x, va.y, va.z); return g;
  }
  function box(w, h, d, x, y, z, ry) {
    const g = new T.BoxGeometry(w, h, d);
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(0, ry || 0, 0)), new T.Vector3(1, 1, 1)));
    return g;
  }
  function cyl(r, h, x, y, z, rx, ry, rz, seg) {
    const g = cylProto(r, seg || 8).clone(); g.scale(1, h, 1);
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0, "YZX")), new T.Vector3(1, 1, 1)));
    return g;
  }

  function materials() {
    // Dark nearly-black arm steel with enough metal response to catch rim light (tip/night photos)
    const arm = new T.MeshStandardMaterial({ color: 0x1c1f24, metalness: 0.72, roughness: 0.42, envMapIntensity: 1.05 });
    const armHi = new T.MeshStandardMaterial({ color: 0x32363c, metalness: 0.55, roughness: 0.42, envMapIntensity: 1.0 });
    // Weathered OLIT grey — NOT bright white; photos show medium-dark matte steel
    const tower = new T.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.48, roughness: 0.62, envMapIntensity: 0.7 });
    const towerDk = new T.MeshStandardMaterial({ color: 0x484e56, metalness: 0.45, roughness: 0.68, envMapIntensity: 0.65 });
    const rail = new T.MeshStandardMaterial({ color: 0xb8bec6, metalness: 0.7, roughness: 0.32, envMapIntensity: 1.1 });
    const pin = new T.MeshStandardMaterial({ color: 0xf4f7fc, metalness: 0.98, roughness: 0.15, envMapIntensity: 1.8, emissive: 0x334455, emissiveIntensity: 0.15 });
    const blue = new T.MeshStandardMaterial({ color: 0x2f6aa3, metalness: 0.15, roughness: 0.65 });
    const concrete = new T.MeshStandardMaterial({ color: 0x95938d, roughness: 0.92 });
    const deck = new T.MeshStandardMaterial({ color: 0x5c626a, metalness: 0.45, roughness: 0.7 });
    const whitePad = new T.MeshStandardMaterial({ color: 0xe6eaee, metalness: 0.08, roughness: 0.82 });
    const grate = new T.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.5, roughness: 0.55, envMapIntensity: 0.9 });
    const hyd = new T.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.35, roughness: 0.55 });
    const cable = new T.MeshStandardMaterial({ color: 0x0e0f11, metalness: 0.2, roughness: 0.7 });
    return { arm, armHi, tower, towerDk, rail, pin, blue, concrete, deck, whitePad, grate, hyd, cable };
  }

  // ============================================================ OLIT lattice — heavy weathered grey
  function buildTowerLattice(detail, M) {
    const H = 146.3, w = 10.4, bay = 6.8, legR = 0.72, brR = 0.32, secR = 0.155;
    const gs = [], dark = [], h = w / 2;
    const C = [[-h, -h], [h, -h], [h, h], [-h, h]];
    // Corner legs — thick
    for (const [x, z] of C) gs.push(cyl(legR, H, x, H / 2, z, 0, 0, 0, 8));
    // Intermediate verticals on each face (reads as massive, not a fragile cage)
    for (const [x, z] of [[0, -h], [h, 0], [0, h], [-h, 0]]) gs.push(cyl(legR * 0.7, H, x, H / 2, z, 0, 0, 0, 7));
    for (let y = 0; y < H - 0.05; y += bay) {
      const y1 = Math.min(y + bay, H), ym = (y + y1) / 2;
      for (let k = 0; k < 4; k++) {
        const [ax, az] = C[k], [bx, bz] = C[(k + 1) % 4];
        // chord rings
        gs.push(tube([ax, y1, az], [bx, y1, bz], brR * 1.25, 6));
        gs.push(tube([ax, y, az], [bx, y, bz], brR * 1.1, 6));
        // primary X bracing
        gs.push(tube([ax, y, az], [bx, y1, bz], brR, 5));
        gs.push(tube([bx, y, bz], [ax, y1, az], brR, 5));
        if (detail) {
          // secondary mid-bay horizontal + K braces
          gs.push(tube([ax, ym, az], [bx, ym, bz], secR * 1.2, 5));
          const mx = (ax + bx) / 2, mz = (az + bz) / 2;
          gs.push(tube([ax, y, az], [mx, ym, mz], secR, 5));
          gs.push(tube([bx, y, bz], [mx, ym, mz], secR, 5));
          gs.push(tube([ax, y1, az], [mx, ym, mz], secR, 5));
          gs.push(tube([bx, y1, bz], [mx, ym, mz], secR, 5));
          // gusset plates at corners
          dark.push(box(0.85, 0.55, 0.12, ax * 0.92, ym, az * 0.92, Math.atan2(az, ax)));
        }
      }
      // work platforms every other bay
      if (detail && (Math.floor(y / bay) % 2 === 0) && y > 15 && y < H - 20) {
        for (const [x, z, ry] of [[0, -h - 0.9, 0], [h + 0.9, 0, Math.PI / 2], [0, h + 0.9, 0], [-h - 0.9, 0, Math.PI / 2]]) {
          dark.push(box(w * 0.55, 0.12, 1.6, x, y + 0.3, z, ry));
          // railing stubs
          for (const o of [-0.5, 0.5]) dark.push(cyl(0.04, 1.0, x + (ry ? 0 : o * 2), y + 0.85, z + (ry ? o * 2 : 0), 0, 0, 0, 5));
        }
      }
    }
    // Face rails (carriage tracks) — three heavy rails on +X face
    for (const z of [-4.6, 0, 4.6]) {
      gs.push(box(0.28, H - 16, 0.42, h + 0.32, (H + 16) / 2, z));
      // rail flanges
      if (detail) gs.push(box(0.5, H - 16, 0.12, h + 0.2, (H + 16) / 2, z));
    }
    // Vertical commodity conduits up one corner
    for (const [x, z, rr] of [[-h + 1.2, -h - 0.55, 0.22], [-h + 1.2, -h - 0.95, 0.16], [h + 0.55, -h + 1.4, 0.18]]) {
      dark.push(cyl(rr, H - 10, x, (H + 10) / 2, z, 0, 0, 0, 7));
    }
    // Cable trays
    for (let y = 20; y < H - 10; y += 18) dark.push(box(0.5, 0.2, w - 1, 0, y, -h - 0.7));

    // Hex crown with equipment clutter
    const crown = [], cy = H + 1.5, Rh = 7.4;
    crown.push(box(12.5, 1.8, 12.5, 0, H + 0.6, 0));
    for (let i = 0; i < 6; i++) {
      const a0 = i / 6 * Math.PI * 2 + Math.PI / 6, a1 = (i + 1) / 6 * Math.PI * 2 + Math.PI / 6;
      crown.push(tube([Rh * Math.cos(a0), cy, Rh * Math.sin(a0)], [Rh * Math.cos(a1), cy, Rh * Math.sin(a1)], 0.22, 6));
      crown.push(cyl(0.09, 1.2, Rh * Math.cos(a0), cy + 0.7, Rh * Math.sin(a0), 0, 0, 0, 5));
      crown.push(tube([Rh * Math.cos(a0), cy + 1.15, Rh * Math.sin(a0)], [Rh * Math.cos(a1), cy + 1.15, Rh * Math.sin(a1)], 0.06, 5));
    }
    // drawworks / pulley house + winch drums + antennas / lightning
    crown.push(box(7.2, 4.8, 6.0, -1.2, H + 3.8, 0));
    crown.push(box(3.5, 2.2, 3.0, 3.0, H + 3.0, 2.5));
    for (const z of [-1.8, 1.8]) crown.push(cyl(0.65, 1.6, 2.5, H + 4.8, z, 0, 0, Math.PI / 2, 10));
    crown.push(cyl(0.16, 9, 3.2, H + 6.5, 1.5));
    crown.push(cyl(0.1, 6, -3.0, H + 5.0, -2.0));
    crown.push(cyl(0.08, 4.5, 1.0, H + 4.5, -3.5));
    // dish / sensor boxes
    crown.push(box(1.2, 0.8, 1.2, -4, H + 2.2, 4));
    crown.push(cyl(0.7, 0.35, 4.5, H + 2.0, -3.5, Math.PI / 2, 0, 0, 10));

    return {
      lattice: new T.Mesh(merge(gs), M.tower),
      dark: dark.length ? new T.Mesh(merge(dark), M.towerDk) : null,
      crown: new T.Mesh(merge(crown), M.towerDk)
    };
  }

  // ============================================================ Carriage — mechanical, not a solid block
  function buildCarriage(detail, M) {
    const g = new T.Group();
    const frame = [], packs = [], skates = [], plat = [];
    // Open beam spine wrapping three sides (Teslarati: "spine and ribcage")
    // Top & bottom frames
    frame.push(box(9.5, 0.55, 13.2, 1.2, 1.4, 0));
    frame.push(box(9.5, 0.55, 13.2, 1.2, -9.2, 0));
    // Vertical posts
    for (const z of [-5.9, -2.0, 2.0, 5.9]) for (const x of [-2.5, 1.5, 4.5]) {
      frame.push(cyl(0.22, 10.6, x, -3.9, z, 0, 0, 0, 6));
    }
    // Front face lattice (open, not solid)
    for (let i = 0; i < 5; i++) {
      const y = -8.5 + i * 2.4;
      frame.push(tube([4.8, y, -5.9], [4.8, y, 5.9], 0.16, 5));
      if (i < 4) {
        frame.push(tube([4.8, y, -5.9], [4.8, y + 2.4, 5.9], 0.12, 5));
        frame.push(tube([4.8, y, 5.9], [4.8, y + 2.4, -5.9], 0.12, 5));
      }
    }
    // Side cheeks — open truss
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const y = -8 + i * 2.8;
        frame.push(tube([-2.8, y, s * 6.2], [5.0, y, s * 6.2], 0.14, 5));
        if (i < 3) {
          frame.push(tube([-2.8, y, s * 6.2], [5.0, y + 2.8, s * 6.2], 0.11, 5));
          frame.push(tube([5.0, y, s * 6.2], [-2.8, y + 2.8, s * 6.2], 0.11, 5));
        }
      }
      // Diagonal brace to tower
      frame.push(tube([-3.0, 1.0, s * 5.5], [4.5, -8.5, s * 5.5], 0.18, 6));
    }
    // Shared pivot pins (upper + lower) through both arms
    frame.push(cyl(0.42, 12.2, HINGE_X, 0.55, 0, Math.PI / 2, 0, 0, 12));
    frame.push(cyl(0.48, 12.2, HINGE_X, HINGE_Y, 0, Math.PI / 2, 0, 0, 12));
    // Pin collars / bearing housings
    for (const y of [0.55, HINGE_Y]) for (const z of [-5.5, -2.5, 2.5, 5.5]) {
      frame.push(cyl(0.7, 0.55, HINGE_X, y, z, Math.PI / 2, 0, 0, 10));
    }
    g.add(new T.Mesh(merge(frame), M.arm));

    // Hydraulic packs / valve blocks / reservoirs (clutter)
    for (const s of [-1, 1]) {
      packs.push(box(2.6, 3.4, 2.2, 4.2, -2.2, s * 3.0));
      packs.push(box(1.8, 2.2, 1.6, 4.6, -5.8, s * 3.2));
      packs.push(cyl(0.55, 2.4, 3.6, -2.0, s * 4.4, 0, 0, 0, 8));   // accumulator
      packs.push(cyl(0.35, 1.8, 5.0, -6.2, s * 4.0, 0, 0, 0, 8));
      // hose runs
      packs.push(tube([4.2, -3.5, s * 3.0], [6.5, -4.0, s * 2.2], 0.08, 5));
      packs.push(tube([4.6, -6.5, s * 3.2], [7.0, -4.5, s * 2.5], 0.07, 5));
    }
    g.add(new T.Mesh(merge(packs), M.hyd));

    // 12 skates (3 pairs × top/bottom) — chunky roller assemblies that READ from below
    for (const y of [0.8, -3.9, -8.6]) for (const z of [-4.6, 0, 4.6]) {
      skates.push(box(1.35, 1.7, 1.4, 5.55, y, z));
      skates.push(box(0.7, 1.4, 1.05, 6.35, y, z));
      for (const dy of [-0.5, -0.15, 0.2, 0.5]) skates.push(cyl(0.26, 0.7, 6.6, y + dy, z, 0, 0, Math.PI / 2, 8));
      skates.push(box(0.85, 0.45, 1.15, 5.35, y + 0.95, z));
      skates.push(box(0.85, 0.45, 1.15, 5.35, y - 0.95, z));
      skates.push(cyl(0.11, 0.85, 5.7, y, z + 0.8, Math.PI / 2, 0, 0, 6));
      skates.push(cyl(0.11, 0.85, 5.7, y, z - 0.8, Math.PI / 2, 0, 0, 6));
      // guide flanges hugging the rail
      skates.push(box(0.25, 1.5, 1.55, 6.85, y, z));
    }
    g.add(new T.Mesh(merge(skates), M.armHi));

    // Work platforms / scaffolding decks on carriage
    plat.push(box(8.5, 0.12, 4.5, 1.0, 1.75, 0));
    plat.push(box(3.5, 0.12, 10, 4.0, -0.5, 0));
    for (const z of [-5.5, 5.5]) {
      for (let x = -2; x <= 5; x += 1.4) plat.push(cyl(0.045, 1.05, x, 2.3, z, 0, 0, 0, 5));
      plat.push(tube([-2, 2.75, z], [5.2, 2.75, z], 0.04, 5));
    }
    // Cable carrier / energy chain hint
    for (let i = 0; i < 8; i++) plat.push(box(0.5, 0.35, 0.4, -3.2, -7 + i * 1.1, 0));
    // Main arm actuators (large pistons)
    for (const s of [-1, 1]) {
      plat.push(cyl(0.42, 7.5, 7.8, -4.0, s * 2.6, 0, s * 0.4, Math.PI / 2, 10));
      plat.push(cyl(0.25, 4.5, 11.2, -4.0, s * 1.5, 0, s * 0.4, Math.PI / 2, 8));
      plat.push(box(1.2, 1.2, 1.2, 6.5, -4.0, s * 3.2));
    }
    // Drawworks cable attachment at upper pin
    plat.push(cyl(0.35, 1.2, HINGE_X + 0.3, 1.5, 0, 0, 0, 0, 8));
    for (const s of [-1, 1]) plat.push(tube([HINGE_X, 1.8, s * 0.8], [HINGE_X - 2, 8, s * 0.3], 0.06, 5));
    g.add(new T.Mesh(merge(plat), M.armHi));

    // Scaffolding hint around upper carriage (photo 3fea)
    if (detail) {
      const scaf = [];
      for (let y = -1; y < 4; y += 1.6) for (const z of [-6.5, 6.5]) {
        scaf.push(tube([5.5, y, z], [7.5, y, z], 0.035, 4));
        scaf.push(tube([5.5, y, z], [5.5, y + 1.6, z], 0.035, 4));
        scaf.push(tube([7.5, y, z], [7.5, y + 1.6, z], 0.035, 4));
      }
      g.add(new T.Mesh(merge(scaf), M.rail));
    }
    return g;
  }

  // ============================================================ Chopstick arm — DENSE lattice-within-lattice
  // Cross-section from tip/night photos: flat top (walkway), roughly triangular/trapezoid, apex lower-outboard.
  // Dense: ~20 bays, X+K bracing every face, secondary longitudinals, gussets, cable trays, hydraulics.
  function buildArm(detail, M, side) {
    const L = ARM_LEN, nBay = detail ? 26 : 14;
    const armG = [], blueG = [], railG = [], tipG = [], pinG = [], grateG = [], hydG = [], cableG = [], whiteG = [];

    function sect(t) {
      // t∈[0,1]; returns chords: ti (top-inner/catch), to (top-outer), bi (bot-inner), bo (bot-outer)
      // Trapezoid that tapers — matches tip photo better than pure triangle
      const k = 1 - 0.38 * t;
      const halfTop = (ARM_W * 0.55) * k, halfBot = (ARM_W * 0.35) * k;
      const Ht = 5.2 * (1 - 0.28 * t), Hb = 0.15 * k;
      const x = t * L;
      // bias: inner face closer to z=0 (catch side)
      return {
        ti: [x, Ht, -halfTop * 0.05],
        to: [x, Ht, halfTop],
        bi: [x, Hb, halfBot * 0.15],
        bo: [x, Hb * 0.3, halfBot * 0.85],
        Ht, halfTop
      };
    }

    const rMain = 0.38, rSec = 0.18, rBrace = 0.13, rFine = 0.09;
    const root = sect(0), tip = sect(1);

    // ---- longitudinal chords (4) + secondary mid-face longitudinals
    for (const key of ["ti", "to", "bi", "bo"]) armG.push(tube(root[key], tip[key], rMain, 12));
    // secondary longitudinals mid-height on each long face
    for (let i = 0; i <= nBay; i++) {
      /* built in bay loop */
    }
    // Precompute sections
    const S = [];
    for (let i = 0; i <= nBay; i++) S.push(sect(i / nBay));

    for (let i = 0; i <= nBay; i++) {
      const s = S[i];
      // bay rings (cross-section frame)
      armG.push(tube(s.ti, s.to, rSec, 6));
      armG.push(tube(s.to, s.bo, rSec, 6));
      armG.push(tube(s.bo, s.bi, rSec, 6));
      armG.push(tube(s.bi, s.ti, rSec, 6));
      // mid-height secondary nodes
      const midL = [(s.ti[0]), (s.ti[1] + s.bi[1]) / 2, (s.ti[2] + s.bi[2]) / 2];
      const midR = [(s.to[0]), (s.to[1] + s.bo[1]) / 2, (s.to[2] + s.bo[2]) / 2];
      const midT = [(s.ti[0]), s.ti[1], (s.ti[2] + s.to[2]) / 2];
      const midB = [(s.bi[0]), s.bi[1], (s.bi[2] + s.bo[2]) / 2];
      if (detail) {
        armG.push(tube(midL, midR, rFine, 5));
        armG.push(tube(midT, midB, rFine, 5));
      }
      if (i < nBay) {
        const s2 = S[i + 1];
        // Face X bracing (all 4 faces) — dense
        armG.push(tube(s.ti, s2.to, rBrace, 5));
        armG.push(tube(s.to, s2.ti, rBrace, 5));
        armG.push(tube(s.to, s2.bo, rBrace, 5));
        armG.push(tube(s.bo, s2.to, rBrace, 5));
        armG.push(tube(s.bo, s2.bi, rBrace, 5));
        armG.push(tube(s.bi, s2.bo, rBrace, 5));
        armG.push(tube(s.bi, s2.ti, rBrace, 5));
        armG.push(tube(s.ti, s2.bi, rBrace, 5));
        if (detail) {
          // second set of finer diagonals (lattice-within-lattice)
          const sm = sect((i + 0.5) / nBay);
          armG.push(tube(s.ti, [sm.to[0], sm.to[1], sm.to[2]], rFine, 5));
          armG.push(tube(s.to, [sm.ti[0], sm.ti[1], sm.ti[2]], rFine, 5));
          armG.push(tube(s.bi, [sm.bo[0], sm.bo[1], sm.bo[2]], rFine, 5));
          armG.push(tube(s.bo, [sm.bi[0], sm.bi[1], sm.bi[2]], rFine, 5));
          // verticals at mid-bay
          armG.push(tube([sm.ti[0], sm.ti[1], sm.ti[2]], [sm.bi[0], sm.bi[1], sm.bi[2]], rFine, 5));
          armG.push(tube([sm.to[0], sm.to[1], sm.to[2]], [sm.bo[0], sm.bo[1], sm.bo[2]], rFine, 5));
          // tertiary K / zig-zag (lattice-within-lattice clutter)
          armG.push(tube(s.ti, [sm.bi[0], sm.bi[1], sm.bi[2]], rFine * 0.9, 4));
          armG.push(tube(s.bi, [sm.ti[0], sm.ti[1], sm.ti[2]], rFine * 0.9, 4));
          armG.push(tube(s.to, [sm.bo[0], sm.bo[1], sm.bo[2]], rFine * 0.9, 4));
          armG.push(tube(s.bo, [sm.to[0], sm.to[1], sm.to[2]], rFine * 0.9, 4));
          armG.push(tube([sm.ti[0], sm.ti[1], sm.ti[2]], s2.bo, rFine * 0.85, 4));
          armG.push(tube([sm.to[0], sm.to[1], sm.to[2]], s2.bi, rFine * 0.85, 4));
          // gusset plates at chord nodes
          if (i % 2 === 0) {
            armG.push(box(0.35, 0.28, 0.08, s.ti[0], s.ti[1], s.ti[2]));
            armG.push(box(0.35, 0.28, 0.08, s.to[0], s.to[1], s.to[2]));
            armG.push(box(0.3, 0.25, 0.08, s.bo[0], s.bo[1], s.bo[2]));
          }
          // blue joint wraps at real junction density (~every 2–3 bays on main chords)
          if (i % 2 === 1) {
            blueG.push(cyl(rMain + 0.05, 0.28, s.ti[0], s.ti[1], s.ti[2], 0, 0, Math.PI / 2, 8));
            blueG.push(cyl(rMain + 0.05, 0.28, s.to[0], s.to[1], s.to[2], 0, 0, Math.PI / 2, 8));
            if (i % 4 === 1) blueG.push(cyl(rMain + 0.05, 0.28, s.bo[0], s.bo[1], s.bo[2], 0, 0, Math.PI / 2, 8));
          }
        }
      }
    }
    // Secondary longitudinals (mid-face) full length
    const midL0 = [(root.ti[0]), (root.ti[1] + root.bi[1]) / 2, (root.ti[2] + root.bi[2]) / 2];
    const midL1 = [(tip.ti[0]), (tip.ti[1] + tip.bi[1]) / 2, (tip.ti[2] + tip.bi[2]) / 2];
    const midR0 = [(root.to[0]), (root.to[1] + root.bo[1]) / 2, (root.to[2] + root.bo[2]) / 2];
    const midR1 = [(tip.to[0]), (tip.to[1] + tip.bo[1]) / 2, (tip.to[2] + tip.bo[2]) / 2];
    armG.push(tube(midL0, midL1, rSec * 0.85, 6));
    armG.push(tube(midR0, midR1, rSec * 0.85, 6));

    // Hinge root — thick gusseted end
    armG.push(box(1.8, 5.8, 3.2, 0.5, 2.5, 0.5));
    armG.push(box(1.2, 4.5, 2.4, 1.4, 2.5, 0.4));
    armG.push(cyl(0.62, 3.1, 0.15, HINGE_Y + 4.2, 0, Math.PI / 2, 0, 0, 12));
    armG.push(cyl(0.55, 3.1, 0.15, 4.9, 0, Math.PI / 2, 0, 0, 12));
    // Root bracing fan
    for (let i = 0; i < 5; i++) {
      const s = S[Math.min(2, nBay)];
      const keys = ["ti", "to", "bi", "bo"];
      armG.push(tube([0.3, 2.5, 0.3], s[keys[i % 4]], rBrace, 5));
    }

    // ---- Walkway grating + dense railings
    for (let i = 0; i < nBay; i++) {
      const a = S[i], b = S[i + 1];
      const mx = (a.ti[0] + b.ti[0]) / 2, my = (a.ti[1] + b.ti[1]) / 2 + 0.05;
      const mz = (a.ti[2] + a.to[2]) / 2;
      const ww = Math.abs(a.to[2] - a.ti[2]) * 0.9, wl = L / nBay;
      grateG.push(box(wl * 0.96, 0.06, ww, mx, my, mz));
      // grating ribs
      if (detail) for (let k = 0; k < 3; k++) grateG.push(box(wl * 0.96, 0.03, 0.04, mx, my + 0.04, mz - ww / 2 + (k + 1) * ww / 4));
    }
    // Railings — posts every bay + double rails
    for (const sideZ of [0, 1]) {
      for (let i = 0; i <= nBay; i++) {
        const s = S[i], z = sideZ ? s.to[2] : s.ti[2];
        grateG.push(cyl(0.035, 1.1, s.ti[0], s.ti[1] + 0.58, z, 0, 0, 0, 5));
      }
      for (let i = 0; i < nBay; i++) {
        const a = S[i], b = S[i + 1];
        const za = sideZ ? a.to[2] : a.ti[2], zb = sideZ ? b.to[2] : b.ti[2];
        grateG.push(tube([a.ti[0], a.ti[1] + 1.1, za], [b.ti[0], b.ti[1] + 1.1, zb], 0.03, 5));
        grateG.push(tube([a.ti[0], a.ti[1] + 0.55, za], [b.ti[0], b.ti[1] + 0.55, zb], 0.028, 5));
      }
    }

    // ---- Upper lift / landing rail (Ryan Hansen: ~0.5 m × ~20 m, parallel-motion linkages)
    // Must read clearly from low tip angle — raised above top chord, with visible linkages + foam pads
    const railLen = 24.0, railStart = 10.0;
    const rY = root.ti[1] + 0.85, rZ = -0.18;
    // Dark steel lift rail (photo: matte charcoal, NOT bright white)
    armG.push(box(railLen, 0.42, 0.62, railStart + railLen / 2, rY, rZ));
    armG.push(box(railLen * 0.98, 0.26, 0.32, railStart + railLen / 2, rY - 0.3, rZ));
    armG.push(box(railLen * 0.96, 0.08, 0.58, railStart + railLen / 2, rY + 0.24, rZ)); // wear strip
    // Parallel-motion linkages (4-bar look) — every ~2.5 m
    for (let i = 0; i < 8; i++) {
      const x = railStart + 1.2 + i * 2.4;
      const s = sect(x / L);
      armG.push(tube([x, s.ti[1] + 0.05, rZ + 0.25], [x, rY - 0.15, rZ], 0.08, 6));
      armG.push(tube([x + 0.85, s.ti[1] + 0.05, rZ + 0.25], [x, rY - 0.15, rZ], 0.07, 5));
      armG.push(tube([x - 0.85, s.ti[1] + 0.05, rZ + 0.25], [x, rY - 0.15, rZ], 0.07, 5));
      armG.push(box(0.4, 0.28, 0.35, x, s.ti[1] + 0.15, rZ + 0.3));
    }
    for (const x of [railStart + 5.5, railStart + 11.5, railStart + 16.5]) {
      armG.push(cyl(0.17, 1.2, x, rY - 0.75, rZ + 0.4, 0, 0, 0, 8));
      pinG.push(cyl(0.1, 0.55, x, rY - 0.12, rZ + 0.4, 0, 0, 0, 6)); // chrome rod
    }
    // Foam bumper pads on inner face (metal-encased) — dark casing + light pad face
    for (let i = 0; i < 10; i++) {
      const x = railStart + 1.0 + i * 1.9;
      armG.push(box(1.6, 0.7, 0.22, x, rY - 0.15, rZ - 0.4));
      grateG.push(box(1.45, 0.58, 0.1, x, rY - 0.15, rZ - 0.52));
    }

    // ---- Tip vertical stabilizer (hanging pole + diagonal brace) — photo cbb4fb54 callout
    // Must READ from low tip angle: long dark pole hanging well below bottom chord
    const tx = L - 0.5, ty = tip.ti[1], tz = tip.ti[2] + 0.2;
    // Hang from LOWER chord so it reads below the truss silhouette (labeled tip photo)
    const stabTopY = tip.bi[1] + 0.35;
    tipG.push(cyl(0.2, 7.2, tx, stabTopY - 3.4, tz, 0, 0, 0, 10));              // main stabilizer pole
    tipG.push(cyl(0.26, 0.6, tx, stabTopY, tz, 0, 0, 0, 10));                   // upper collar at bottom chord
    tipG.push(box(0.85, 0.5, 1.45, tx, stabTopY - 6.9, tz));                    // foot / pad
    tipG.push(box(0.55, 0.35, 0.55, tx, stabTopY - 0.35, tz));
    tipG.push(tube([tx, stabTopY, tz], [tx - 3.6, tip.to[1] - 0.5, tip.to[2]], 0.13, 7)); // diagonal up into truss
    tipG.push(tube([tx, stabTopY - 2.4, tz], [tx - 2.4, tip.bo[1] + 0.5, tip.bo[2]], 0.1, 6));
    tipG.push(tube([tx, stabTopY - 4.2, tz], [tx - 1.6, tip.bo[1] + 0.2, tip.bo[2] * 0.6], 0.08, 5));
    tipG.push(box(0.95, 0.5, 0.7, tx - 0.15, tip.ti[1] + 0.1, tz));             // tip mount plate on top
    tipG.push(box(0.4, 0.4, 0.4, tx, tip.ti[1] + 0.45, tz));
    // light tip chord caps (NOT a solid slab that buries the stabilizer)
    tipG.push(cyl(rMain * 1.15, 0.55, L + 0.05, tip.ti[1], tip.ti[2], 0, 0, Math.PI / 2, 8));
    tipG.push(cyl(rMain * 1.15, 0.55, L + 0.05, tip.to[1], tip.to[2], 0, 0, Math.PI / 2, 8));
    tipG.push(cyl(rMain * 1.05, 0.45, L + 0.05, tip.bo[1], tip.bo[2], 0, 0, Math.PI / 2, 8));
    tipG.push(tube(tip.ti, tip.to, rSec, 6));
    tipG.push(tube(tip.to, tip.bo, rSec, 6));
    // white protective wraps near tip (photo cbb4fb54)
    whiteG.push(cyl(rMain + 0.1, 0.55, L - 1.2, tip.ti[1], tip.ti[2], 0, 0, Math.PI / 2, 8));
    whiteG.push(cyl(rMain + 0.1, 0.55, L - 1.2, tip.to[1], tip.to[2], 0, 0, Math.PI / 2, 8));
    whiteG.push(cyl(rMain + 0.1, 0.4, L - 2.6, tip.ti[1], tip.ti[2], 0, 0, Math.PI / 2, 8));
    whiteG.push(box(1.2, 0.35, 0.5, L - 0.8, tip.ti[1] + 0.35, tip.ti[2] - 0.1));
    // extra tip bay clutter: short stubs / hose nipples
    for (let k = 0; k < 4; k++) {
      tipG.push(cyl(0.05, 0.7, L - 1.8 - k * 0.6, tip.ti[1] - 0.8 - k * 0.15, tip.ti[2] + 0.4, 0.4, 0, 0.2, 5));
    }

    // ---- Lower load-point pin (silver cylinder + locking pin on tension rod) — photo inset
    // Larger + outboard so it reads at tip-photo distance
    const px = L - 1.8, py = 1.7, pz = tip.ti[2] - 0.55;
    pinG.push(cyl(0.26, 1.55, px, py, pz, 0, 0, Math.PI / 2, 16));              // silver main pin (reads from tip photo)
    pinG.push(cyl(0.28, 0.18, px - 0.55, py, pz, 0, 0, Math.PI / 2, 12));       // flange
    pinG.push(cyl(0.28, 0.18, px + 0.55, py, pz, 0, 0, Math.PI / 2, 12));
    pinG.push(cyl(0.09, 0.75, px, py + 0.4, pz, 0, 0, 0, 8));                   // locking pin through eye
    pinG.push(box(1.0, 0.7, 0.75, px - 0.35, py, pz + 0.35));                   // bracket
    // tension rod with turnbuckle
    pinG.push(tube([px - 0.7, py, pz], [px - 5.0, py + 1.3, pz + 0.7], 0.065, 6));
    pinG.push(cyl(0.14, 0.55, px - 2.8, py + 0.65, pz + 0.35, 0.35, 0, 0.45, 10));
    pinG.push(box(0.55, 0.4, 0.4, px - 5.0, py + 1.3, pz + 0.7));

    // Tip-zone clutter: extra hydraulic runs + small boxes near load pin / stabilizer
    for (let i = 0; i < 6; i++) {
      const x = L - 8 + i * 1.2;
      const s = sect(x / L);
      hydG.push(tube([x, s.ti[1] - 0.9, s.ti[2] + 0.45], [x + 1.1, s.bi[1] + 0.8, s.bi[2] + 0.2], 0.045, 5));
      if (i % 2 === 0) hydG.push(box(0.45, 0.35, 0.35, x, s.ti[1] - 0.55, s.ti[2] + 0.6));
    }
    // ---- Hydraulic lines / cable trays along inner top (night photo clutter)
    for (let i = 0; i < nBay; i++) {
      const a = S[i], b = S[i + 1];
      cableG.push(tube(
        [a.ti[0], a.ti[1] - 0.35, a.ti[2] + 0.35],
        [b.ti[0], b.ti[1] - 0.35, b.ti[2] + 0.35], 0.055, 5));
      cableG.push(tube(
        [a.ti[0], a.ti[1] - 0.55, a.ti[2] + 0.5],
        [b.ti[0], b.ti[1] - 0.55, b.ti[2] + 0.5], 0.04, 5));
    }
    // Cable tray box
    for (let i = 0; i < nBay; i += 2) {
      const a = S[i];
      cableG.push(box(L / nBay * 1.8, 0.12, 0.35, a.ti[0] + L / nBay, a.ti[1] - 0.7, a.ti[2] + 0.55));
    }
    // Hydraulic cylinders near vehicle interface (night photo)
    for (let i = 0; i < 5; i++) {
      const x = 9 + i * 5.0;
      const s = sect(x / L);
      hydG.push(cyl(0.1, 2.0, x, s.ti[1] - 1.1, s.ti[2] + 0.55, 0.5, 0, 0.25, 6));
      hydG.push(box(0.55, 0.4, 0.45, x, s.ti[1] - 0.25, s.ti[2] + 0.55));
      hydG.push(tube([x, s.ti[1] - 0.3, s.ti[2] + 0.55], [x + 1.5, s.ti[1] - 1.5, s.ti[2] + 0.3], 0.05, 5));
    }

    const rootG = new T.Group();
    rootG.add(new T.Mesh(merge(armG), M.arm));
    if (blueG.length) rootG.add(new T.Mesh(merge(blueG), M.blue));
    rootG.add(new T.Mesh(merge(grateG), M.grate));
    if (railG.length) rootG.add(new T.Mesh(merge(railG), M.rail));
    rootG.add(new T.Mesh(merge(tipG), M.arm));
    rootG.add(new T.Mesh(merge(pinG), M.pin));
    if (hydG.length) rootG.add(new T.Mesh(merge(hydG), M.hyd));
    if (cableG.length) rootG.add(new T.Mesh(merge(cableG), M.cable));
    if (whiteG.length) rootG.add(new T.Mesh(merge(whiteG), M.whitePad));
    if (side < 0) rootG.scale.z = -1;
    return rootG;
  }

  // ============================================================ Ship QD — proper lattice boom
  function buildShipQD(detail, M) {
    const g = new T.Group();
    const yoke = [];
    yoke.push(box(4.0, 5.0, 4.5, 5.8, 0, 0));
    yoke.push(cyl(0.45, 4.8, 5.8, 0, 0, Math.PI / 2, 0, 0, 10));
    yoke.push(box(2.5, 2.0, 3.0, 4.0, -2.5, 0));
    g.add(new T.Mesh(merge(yoke), M.arm));

    const BL = 26, bw = 2.8, bh = 3.2, n = detail ? 14 : 7;
    const boom = [], tip = [], pads = [], pipes = [];
    const corners = (x, k = 1) => {
      const w = bw * k, h = bh * k;
      return [[x, h / 2, -w / 2], [x, h / 2, w / 2], [x, -h / 2, w / 2], [x, -h / 2, -w / 2]];
    };
    // Tapering lattice boom
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = t * BL, k = 1 - 0.25 * t, c = corners(x, k);
      for (let j = 0; j < 4; j++) boom.push(tube(c[j], c[(j + 1) % 4], 0.12, 5));
      if (i < n) {
        const c2 = corners((i + 1) / n * BL, 1 - 0.25 * (i + 1) / n);
        for (let j = 0; j < 4; j++) {
          boom.push(tube(c[j], c2[j], 0.16, 6));
          boom.push(tube(c[j], c2[(j + 1) % 4], 0.1, 5));
          boom.push(tube(c[(j + 1) % 4], c2[j], 0.1, 5));
        }
        // mid-bay ring + fine diagonals
        const cm = corners((i + 0.5) / n * BL, 1 - 0.25 * (i + 0.5) / n);
        for (let j = 0; j < 4; j++) {
          boom.push(tube(cm[j], cm[(j + 1) % 4], 0.07, 4));
          boom.push(tube(c[j], cm[(j + 1) % 4], 0.065, 4));
        }
      }
    }
    const boomG = new T.Group();
    boomG.add(new T.Mesh(merge(boom), M.arm));

    // Tip: platform, QD hood/plate, white pads, claws, piping cluster
    tip.push(box(2.8, 0.35, 5.2, BL + 1.0, -0.15, 0));
    tip.push(box(2.0, 2.8, 2.4, BL + 2.0, 1.2, 0));          // QD hood stack
    tip.push(box(1.2, 1.8, 1.8, BL + 2.9, 1.1, 0));          // QD face
    tip.push(box(0.8, 1.4, 1.4, BL + 3.5, 1.0, 0));
    // Piping cluster into QD
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      pipes.push(cyl(0.08, 2.5, BL + 1.5 + 0.3 * Math.cos(a), 0.5 + 0.4 * Math.sin(a), 0.4 * Math.sin(a), 0, 0, Math.PI / 2, 5));
    }
    pipes.push(box(1.5, 0.8, 1.0, BL + 0.5, 1.5, 1.2));      // valve block
    pipes.push(box(1.2, 0.6, 0.8, BL + 0.5, 1.3, -1.2));
    for (const s of [-1, 1]) {
      tip.push(box(1.0, 0.18, 1.8, BL + 0.7, -0.4, s * 1.7));
      tip.push(box(0.45, 1.4, 0.4, BL + 0.35, -1.1, s * 2.2));   // claw arm
      tip.push(box(0.85, 0.28, 0.3, BL + 0.6, -1.7, s * 2.2));   // gripper
      tip.push(cyl(0.12, 0.5, BL + 0.9, -1.7, s * 2.2, 0, 0, Math.PI / 2, 8));
      pads.push(box(0.85, 0.12, 1.5, BL + 0.7, -0.52, s * 1.7));
    }
    boomG.add(new T.Mesh(merge(tip), M.armHi));
    boomG.add(new T.Mesh(merge(pipes), M.hyd));
    boomG.add(new T.Mesh(merge(pads), M.whitePad));
    boomG.position.set(5.8, 0, 0);
    boomG.rotation.y = -52 * D2R;
    g.add(boomG);
    g.position.set(0, 106, 0);
    return g;
  }

  // ============================================================ OLM + BQD
  function buildOLM(detail, M) {
    const g = new T.Group();
    const legs = [];
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      legs.push(box(2.5, 20, 2.5, 9.3 * Math.cos(a), 10, 9.3 * Math.sin(a)));
      if (detail) legs.push(box(1.2, 20, 0.4, 8.2 * Math.cos(a), 10, 8.2 * Math.sin(a), -a));
    }
    g.add(new T.Mesh(merge(legs), M.concrete));
    const ring = new T.Mesh(new T.CylinderGeometry(8.7, 8.7, 3.5, 48, 1, true), M.deck); ring.position.y = 20; g.add(ring);
    const deck = new T.Mesh(new T.RingGeometry(4.9, 9.7, 48), M.deck); deck.rotation.x = -Math.PI / 2; deck.position.y = 21.75; g.add(deck);
    const clamps = [];
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2;
      clamps.push(box(0.55, 1.35, 0.75, 7.7 * Math.cos(a), 22.4, 7.7 * Math.sin(a), -a));
    }
    g.add(new T.Mesh(merge(clamps), M.armHi));
    const bqd = [];
    bqd.push(box(5.8, 4.5, 4.2, -10.8, 24.6, 0));
    bqd.push(box(2.8, 3.2, 3.4, -13.5, 24.1, 0));
    bqd.push(box(1.4, 2.4, 2.6, -14.8, 23.9, 0));
    bqd.push(cyl(0.3, 3, -12, 26.5, 1.5, 0, 0, Math.PI / 2, 6));
    g.add(new T.Mesh(merge(bqd), M.arm));
    const defl = new T.Mesh(new T.CylinderGeometry(11, 14, 4, 32, 1, true), M.concrete); defl.position.y = 2; g.add(defl);
    return g;
  }

  SH.buildMechazilla = function (detail) {
    _cylCache.clear();
    const M = materials();
    const root = new T.Group(); root.name = "mechazilla";
    const tw = buildTowerLattice(!!detail, M);
    tw.lattice.castShadow = true; root.add(tw.lattice);
    if (tw.dark) root.add(tw.dark);
    root.add(tw.crown);
    const carriage = buildCarriage(!!detail, M); root.add(carriage);
    const arms = [];
    for (const s of [-1, 1]) {
      const hinge = new T.Group(); hinge.position.set(HINGE_X, HINGE_Y, s * HINGE_Z);
      hinge.add(buildArm(!!detail, M, s));
      carriage.add(hinge); arms.push({ hinge, s });
    }
    const qd = buildShipQD(!!detail, M); root.add(qd);
    return { root, carriage, arms, qd, materials: M, HINGE_X, HINGE_Y, HINGE_Z, ARM_W, TOWER_BACK, ARM_LEN };
  };
  SH.buildOLM = function (detail) { return buildOLM(!!detail, materials()); };
})(window.SH = window.SH || {});
