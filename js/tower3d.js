/* Mechazilla (OLIT-1 Pad 1 Starbase): tower lattice, carriage, chopsticks, ship QD arm, OLM.
   Visual fidelity matched to NSF / StarshipGazer / Ryan Hansen / Everyday Astronaut photo coverage and the
   six user reference photos.  Kinematics of the catch (hinge positions, arm_gap ↔ opening angle) are
   unchanged from the previous crude mesh so the 6-DOF catch physics stay aligned.

   Local tower frame: +Y up, +X toward the catch axis along the arm extension (e-axis), Z across the arms.
   Sources and remaining uncertainty are summarised in the README "v4.2" section.                                              */
(function (SH) {
  "use strict";
  const T = window.THREE;
  const D2R = Math.PI / 180;
  // Hitch points shared with the sim (must stay in sync with render3d._chopsticks)
  const HINGE_X = 5.2, HINGE_Y = -4.2, HINGE_Z = 4.6, ARM_W = 2.6, TOWER_BACK = 22, ARM_LEN = 36.0;
  SH.MECH = { HINGE_X, HINGE_Y, HINGE_Z, ARM_W, TOWER_BACK, ARM_LEN, TOWER_H: 146.3, ARM_TOP: 125 };

  function merge(gs) {
    if (SH.merge3) return SH.merge3(gs);
    // local fallback (same contract as booster3d.merge) so the module can load alone in the lab
    return T.mergeGeometries(gs.map(g => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(k)) n.deleteAttribute(k);
      if (!n.attributes.uv) n.setAttribute("uv", new T.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
      n.clearGroups(); return n;
    }), false);
  }
  function boxAt(w, h, d, x, y, z, ry) {
    const g = new T.BoxGeometry(w, h, d); const m = new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(0, ry || 0, 0)), new T.Vector3(1, 1, 1)); g.applyMatrix4(m); return g;
  }
  function cyl(r, h, x, y, z, rx, ry, rz, seg) {
    const g = new T.CylinderGeometry(r, r, h, seg || 8); const e = new T.Euler(rx || 0, ry || 0, rz || 0, "YZX");
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(e), new T.Vector3(1, 1, 1))); return g;
  }
  function bar(a, b, r, seg) {
    const va = new T.Vector3(...a), vb = new T.Vector3(...b), d = vb.clone().sub(va), L = d.length();
    if (L < 1e-4) return new T.BoxGeometry(0.01, 0.01, 0.01);
    const g = new T.CylinderGeometry(r, r, L, seg || 6); g.translate(0, L / 2, 0);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()));
    g.translate(va.x, va.y, va.z); return g;
  }

  function materials() {
    const tower = new T.MeshStandardMaterial({ color: 0xb8bec6, metalness: 0.55, roughness: 0.62 });          // light grey OLIT lattice
    const towerDark = new T.MeshStandardMaterial({ color: 0x8a9098, metalness: 0.6, roughness: 0.55 });
    const arm = new T.MeshStandardMaterial({ color: 0x2a2d32, metalness: 0.7, roughness: 0.48 });               // near-black chopsticks
    const armHi = new T.MeshStandardMaterial({ color: 0x3a3e45, metalness: 0.65, roughness: 0.42 });
    const rail = new T.MeshStandardMaterial({ color: 0xc9ced4, metalness: 0.75, roughness: 0.35 });              // lift / landing rail
    const pin = new T.MeshStandardMaterial({ color: 0xd4d8de, metalness: 0.85, roughness: 0.28 });
    const blue = new T.MeshStandardMaterial({ color: 0x3a6ea5, metalness: 0.2, roughness: 0.7 });             // joint wraps
    const concrete = new T.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.92 });
    const deck = new T.MeshStandardMaterial({ color: 0x6a7078, metalness: 0.5, roughness: 0.7 });
    const yellow = new T.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.4, roughness: 0.5 });
    const whitePad = new T.MeshStandardMaterial({ color: 0xe8ecef, metalness: 0.1, roughness: 0.8 });
    return { tower, towerDark, arm, armHi, rail, pin, blue, concrete, deck, yellow, whitePad };
  }

  // ---------------------------------------------------------------- OLIT lattice (light grey, ~10×10 m section, 146.3 m)
  function buildTowerLattice(detail, M) {
    const H = 146.3, w = 10.0, bay = 9.0, legR = 0.48, brR = 0.22, gs = [], h = w / 2;
    const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
    for (const [x, z] of corners) gs.push(cyl(legR, H, x, H / 2, z, 0, 0, 0, 8));
    for (let y = 0; y < H - 0.1; y += bay) {
      const y1 = Math.min(y + bay, H);
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
        gs.push(bar([ax, y1, az], [bx, y1, bz], brR * 1.35, 6));
        gs.push(bar([ax, y, az], [bx, y, bz], brR * 1.1, 6));
        if (detail) {
          gs.push(bar([ax, y, az], [bx, y1, bz], brR, 5));
          gs.push(bar([bx, y, bz], [ax, y1, az], brR, 5));
          // gusset-ish plates at mid-bay corners
          if (k % 2 === 0) gs.push(boxAt(0.9, 0.55, 0.12, (ax + bx) / 2, (y + y1) / 2, (az + bz) / 2, Math.atan2(bz - az, bx - ax)));
        } else gs.push(bar([ax, y, az], [bx, y1, bz], brR, 5));
      }
      // intermediate platform beams every other bay
      if (detail && (y / bay) % 2 === 0) {
        for (const [x, z] of [[-h + 0.6, 0], [h - 0.6, 0], [0, -h + 0.6], [0, h - 0.6]]) gs.push(boxAt(0.35, 0.2, w - 1.4, x, y + bay * 0.5, z));
      }
    }
    // face rails the carriage rides (three columns on the +X / catch face and sides)
    for (const z of [-h + 0.15, 0, h - 0.15]) {
      gs.push(boxAt(0.22, H - 18, 0.35, h + 0.25, (H + 18) / 2, z));
    }
    // hexagonal crown / top platform with railings
    const crown = [], cy = H + 1.4, Rhex = 7.2;
    for (let i = 0; i < 6; i++) {
      const a0 = i / 6 * Math.PI * 2 + Math.PI / 6, a1 = (i + 1) / 6 * Math.PI * 2 + Math.PI / 6;
      crown.push(bar([Rhex * Math.cos(a0), cy, Rhex * Math.sin(a0)], [Rhex * Math.cos(a1), cy, Rhex * Math.sin(a1)], 0.28, 6));
      crown.push(cyl(0.12, 1.15, Rhex * Math.cos(a0), cy + 0.7, Rhex * Math.sin(a0), 0, 0, 0, 6));
      crown.push(bar([Rhex * Math.cos(a0), cy + 1.15, Rhex * Math.sin(a0)], [Rhex * Math.cos(a1), cy + 1.15, Rhex * Math.sin(a1)], 0.08, 5));
    }
    crown.push(boxAt(11, 1.6, 11, 0, H + 0.5, 0));   // deck plate
    crown.push(cyl(0.18, 8, 2.5, H + 5.5, 2.0));      // lightning rod / antenna
    crown.push(cyl(0.12, 5, -2.0, H + 4.0, -1.5));
    // pulley / drawworks house on the top back
    crown.push(boxAt(6.5, 4.2, 5.5, -1.5, H + 3.5, 0));
    for (const z of [-1.6, 1.6]) crown.push(cyl(0.55, 1.4, 2.2, H + 4.6, z, 0, 0, Math.PI / 2, 10));   // winch drums
    return { lattice: new T.Mesh(merge(gs), M.tower), crown: new T.Mesh(merge(crown), M.towerDark) };
  }

  // ---------------------------------------------------------------- carriage (dark, wraps the tower face; 12 skates)
  function buildCarriage(detail, M) {
    const g = new T.Group();
    // main spine / ribcage wrapping three sides of the tower
    const body = [];
    body.push(boxAt(4.2, 11.5, 12.5, 3.6, -4.0, 0));                // front face plate
    body.push(boxAt(8.5, 2.0, 12.8, 1.0, 1.2, 0));                   // top frame
    body.push(boxAt(8.5, 2.0, 12.8, 1.0, -9.0, 0));                  // bottom frame
    for (const s of [-1, 1]) {
      body.push(boxAt(7.5, 11.5, 1.8, 1.5, -4.0, s * 5.8));          // side cheeks
      // hydraulic packs / valve blocks
      body.push(boxAt(2.4, 3.2, 2.0, 4.5, -2.5, s * 3.2));
      body.push(boxAt(1.6, 2.0, 1.4, 4.8, -6.0, s * 3.0));
    }
    // shared upper / lower pivot pins (through both arm hinges)
    body.push(cyl(0.38, 11.5, HINGE_X, 0.6, 0, Math.PI / 2, 0, 0, 12));
    body.push(cyl(0.42, 11.5, HINGE_X, HINGE_Y, 0, Math.PI / 2, 0, 0, 12));
    g.add(new T.Mesh(merge(body), M.arm));
    // 12 skates (3 pairs × top/bottom) riding the tower rails — Ryan Hansen
    const skates = [];
    for (const y of [0.4, -8.2]) for (const z of [-4.7, 0, 4.7]) for (const dx of [-0.15, 0.15]) {
      skates.push(boxAt(0.55, 1.1, 0.7, 5.15 + dx, y, z));
      if (detail) skates.push(cyl(0.18, 0.5, 5.45, y, z, 0, 0, Math.PI / 2, 8));
    }
    g.add(new T.Mesh(merge(skates), M.armHi));
    // main arm-open actuators (large pistons) — one per arm, mounted on carriage
    for (const s of [-1, 1]) {
      const act = new T.Group();
      act.add(new T.Mesh(cyl(0.38, 6.5, 0, 0, 0, 0, 0, Math.PI / 2, 10), M.armHi));
      act.add(new T.Mesh(cyl(0.22, 4.0, 3.5, 0, 0, 0, 0, Math.PI / 2, 8), M.rail));
      act.position.set(7.5, -4.0, s * 2.8); act.rotation.y = s * 0.35; g.add(act);
    }
    return g;
  }

  // ---------------------------------------------------------------- one chopstick arm: triangular tubular truss, tapering tip
  // Cross-section: flat top (walkway), apex below — matching tip / night photos.  Length ARM_LEN from hinge.
  // Inner face at local z = 0 (hinge side nearer catch axis is -s * ARM_W/2 in world after hinge rotation).
  function buildArm(detail, M, side) {
    // side = +1 (right / +Z hinge) or -1; geometry built for the +Z arm and mirrored
    const L = ARM_LEN, nBay = detail ? 12 : 8;
    const gs = [], blue = [];
    // chord radii
    const rMain = 0.32, rSec = 0.18, rBrace = 0.11;
    // taper: full size at root, ~55% at tip
    function sect(t) {
      // t in [0,1] along arm; returns {topInner, topOuter, bot} as [x,y,z] in arm local (x along arm, y up, z outboard)
      // Triangular: top width shrinks, height shrinks
      const k = 1 - 0.42 * t;
      const halfW = (ARM_W / 2) * k, Ht = 4.6 * k, x = t * L;
      // top-inner (catch side), top-outer, bottom-apex (slightly outboard of centre)
      return {
        ti: [x, Ht, -halfW * 0.15],
        to: [x, Ht, halfW],
        bo: [x, 0, halfW * 0.35]
      };
    }
    const root = sect(0), tip = sect(1);
    // longitudinal chords
    gs.push(bar(root.ti, tip.ti, rMain, 8));
    gs.push(bar(root.to, tip.to, rMain, 8));
    gs.push(bar(root.bo, tip.bo, rMain * 1.05, 8));
    // bays
    for (let i = 0; i <= nBay; i++) {
      const t = i / nBay, s = sect(t);
      gs.push(bar(s.ti, s.to, rSec, 6));
      gs.push(bar(s.ti, s.bo, rSec, 6));
      gs.push(bar(s.to, s.bo, rSec, 6));
      if (i < nBay) {
        const s2 = sect((i + 1) / nBay);
        gs.push(bar(s.ti, s2.to, rBrace, 5));
        gs.push(bar(s.to, s2.ti, rBrace, 5));
        gs.push(bar(s.bo, s2.ti, rBrace, 5));
        gs.push(bar(s.bo, s2.to, rBrace, 5));
        // blue joint wraps (maintenance / assembly marks visible in tip photo)
        if (detail && i % 3 === 1) {
          blue.push(cyl(rMain + 0.04, 0.35, s.ti[0], s.ti[1], s.ti[2], 0, 0, Math.PI / 2, 8));
          blue.push(cyl(rMain + 0.04, 0.35, s.to[0], s.to[1], s.to[2], 0, 0, Math.PI / 2, 8));
        }
      }
    }
    // hinge end plates / gussets (thick at the carriage pin)
    gs.push(boxAt(1.4, 5.2, 2.8, 0.4, 2.3, 0.4));
    gs.push(cyl(0.55, 2.9, 0.2, HINGE_Y + 4.2, 0, Math.PI / 2, 0, 0, 12));   // lower pin boss
    gs.push(cyl(0.48, 2.9, 0.2, 4.8, 0, Math.PI / 2, 0, 0, 12));             // upper pin boss

    // ---- walkway + railings on top (photos 5539, cef4, 3fea)
    const walk = [];
    for (let i = 0; i < nBay; i++) {
      const t0 = i / nBay, t1 = (i + 1) / nBay, a = sect(t0), b = sect(t1);
      const mx = (a.ti[0] + b.to[0]) / 2, my = (a.ti[1] + b.ti[1]) / 2 + 0.06;
      const mz = (a.ti[2] + a.to[2]) / 2, ww = Math.abs(a.to[2] - a.ti[2]) * 0.92, wl = L / nBay;
      walk.push(boxAt(wl * 0.95, 0.08, ww, mx, my, mz));
    }
    // railings
    for (const sideZ of [0, 1]) {
      for (let i = 0; i <= nBay; i++) {
        const s = sect(i / nBay), z = sideZ ? s.to[2] : s.ti[2];
        walk.push(cyl(0.04, 1.05, s.ti[0], s.ti[1] + 0.55, z, 0, 0, 0, 5));
      }
      for (let i = 0; i < nBay; i++) {
        const a = sect(i / nBay), b = sect((i + 1) / nBay);
        const za = sideZ ? a.to[2] : a.ti[2], zb = sideZ ? b.to[2] : b.ti[2];
        walk.push(bar([a.ti[0], a.ti[1] + 1.05, za], [b.ti[0], b.ti[1] + 1.05, zb], 0.035, 5));
        walk.push(bar([a.ti[0], a.ti[1] + 0.55, za], [b.ti[0], b.ti[1] + 0.55, zb], 0.03, 5));
      }
    }

    // ---- upper lift / landing rail (Ryan Hansen: ~0.5 m wide × ~20 m long, parallel-motion linkages)
    // sits on the INNER top edge; raised ~0.4 m above the top chord for the catch pose
    const railGs = [], railLen = 20.0, railStart = 8.0;   // biased toward tower (pistons nearer carriage)
    const rY = root.ti[1] + 0.72, rZ = -0.12;
    railGs.push(boxAt(railLen, 0.28, 0.55, railStart + railLen / 2, rY, rZ));          // flat landing surface (~0.5 m wide × 20 m, Ryan Hansen)
    railGs.push(boxAt(railLen * 0.98, 0.12, 0.18, railStart + railLen / 2, rY - 0.2, rZ)); // web
    // parallel-motion linkages (simplified — a few uprights + diagonal struts)
    for (let i = 0; i < 6; i++) {
      const x = railStart + 1.5 + i * 3.2;
      railGs.push(bar([x, root.ti[1] + 0.05, rZ + 0.15], [x, rY - 0.12, rZ], 0.07, 5));
      railGs.push(bar([x + 0.9, root.ti[1] + 0.05, rZ + 0.15], [x, rY - 0.12, rZ], 0.06, 5));
    }
    // two lift pistons under mid-rail (biased tower-side)
    for (const x of [railStart + 6, railStart + 11]) {
      railGs.push(cyl(0.14, 0.85, x, rY - 0.55, rZ + 0.25, 0, 0, 0, 8));
    }
    // foam bumper pads (dark metal-encased) on the inner face of the rail
    for (let i = 0; i < 8; i++) {
      const x = railStart + 1.2 + i * 2.3;
      railGs.push(boxAt(1.8, 0.55, 0.18, x, rY - 0.15, rZ - 0.32));
    }

    // ---- vertical stabilizer hanging from the tip (photo 1 callout)
    const stab = [];
    const tx = L - 0.8, ty = tip.ti[1];
    stab.push(boxAt(0.4, 4.2, 0.7, tx, ty - 1.9, tip.ti[2] + 0.15));
    stab.push(boxAt(0.35, 0.9, 1.3, tx, ty - 3.9, tip.ti[2] + 0.15));   // foot
    // triangular plate look
    stab.push(bar([tx, ty, tip.ti[2]], [tx, ty - 3.4, tip.ti[2] + 0.5], 0.08, 5));
    stab.push(bar([tx, ty, tip.ti[2]], [tx, ty - 3.4, tip.ti[2] - 0.3], 0.08, 5));

    // ---- lower load-point pin near tip, lower inner face (photo 1 inset: silver pin + locking pin)
    const pinGs = [];
    const px = L - 2.4, py = 1.1, pz = tip.ti[2] - 0.15;
    pinGs.push(cyl(0.12, 0.7, px, py, pz, 0, 0, Math.PI / 2, 12));           // main silver pin (arm socket for ~17 cm booster load-point cylinder)
    pinGs.push(cyl(0.055, 0.42, px, py + 0.22, pz, 0, 0, 0, 8));              // locking pin (photo 1 inset)
    pinGs.push(boxAt(0.65, 0.45, 0.5, px - 0.2, py, pz + 0.2));               // bracket

    // ---- secondary hydraulic linkages near the vehicle (night photo)
    const hyd = [];
    for (let i = 0; i < 4; i++) {
      const x = 10 + i * 5.5;
      const s = sect(x / L);
      hyd.push(cyl(0.09, 1.8, x, s.ti[1] - 1.0, s.ti[2] + 0.4, 0.4, 0, 0.3, 6));
      hyd.push(boxAt(0.6, 0.45, 0.5, x, s.ti[1] - 0.3, s.ti[2] + 0.5));
    }

    const rootG = new T.Group();
    rootG.add(new T.Mesh(merge(gs), M.arm));
    if (blue.length) rootG.add(new T.Mesh(merge(blue), M.blue));
    rootG.add(new T.Mesh(merge(walk), M.armHi));
    rootG.add(new T.Mesh(merge(railGs), M.rail));
    rootG.add(new T.Mesh(merge(stab), M.arm));
    rootG.add(new T.Mesh(merge(pinGs), M.pin));
    if (hyd.length) rootG.add(new T.Mesh(merge(hyd), M.armHi));
    // mirror for the −Z arm: reflect through XZ then flip so inner face still points inward
    if (side < 0) rootG.scale.z = -1;
    return rootG;
  }

  // ---------------------------------------------------------------- Ship Quick Disconnect arm (Pad 1 style, stowed swung out)
  // LunarCaveman / NSF: boom pivots ~60°, ~17 m clearance; claws + white pads + QD plate at tip.
  function buildShipQD(detail, M) {
    const g = new T.Group();
    // mount yoke on the tower (about ship stacking height when chopsticks are high; parked ~100–110 m)
    const yoke = [];
    yoke.push(boxAt(3.5, 4.5, 4.0, 5.5, 0, 0));
    yoke.push(cyl(0.4, 4.2, 5.5, 0, 0, Math.PI / 2, 0, 0, 10));
    g.add(new T.Mesh(merge(yoke), M.arm));
    // lattice boom — rectangular section, ~22 m reach
    const boom = [], BL = 22, bw = 2.4, bh = 2.8, n = detail ? 8 : 5;
    const corners = (x) => [[x, bh / 2, -bw / 2], [x, bh / 2, bw / 2], [x, -bh / 2, bw / 2], [x, -bh / 2, -bw / 2]];
    const c0 = corners(0), c1 = corners(BL);
    for (let k = 0; k < 4; k++) boom.push(bar(c0[k], c1[k], 0.16, 6));
    for (let i = 0; i <= n; i++) {
      const x = i / n * BL, c = corners(x);
      for (let k = 0; k < 4; k++) boom.push(bar(c[k], c[(k + 1) % 4], 0.1, 5));
      if (i < n) {
        const x2 = (i + 1) / n * BL, c2 = corners(x2);
        boom.push(bar(c[0], c2[1], 0.08, 5)); boom.push(bar(c[1], c2[0], 0.08, 5));
        boom.push(bar(c[2], c2[3], 0.08, 5)); boom.push(bar(c[3], c2[2], 0.08, 5));
      }
    }
    const boomG = new T.Group();
    boomG.add(new T.Mesh(merge(boom), M.arm));
    // tip: platform halves with white contact pads + QD plate hood + claws/grippers
    const tip = [];
    tip.push(boxAt(2.2, 0.3, 4.5, BL + 0.8, -0.2, 0));                 // platform
    tip.push(boxAt(1.6, 2.4, 2.0, BL + 1.6, 1.0, 0));                   // QD hood / plate stack
    tip.push(boxAt(0.9, 1.4, 1.4, BL + 2.3, 0.9, 0));                   // QD face
    for (const s of [-1, 1]) {
      tip.push(boxAt(0.8, 0.15, 1.6, BL + 0.6, -0.35, s * 1.5));       // pad plate
      tip.push(boxAt(0.7, 0.12, 1.3, BL + 0.6, -0.42, s * 1.5));       // white pad (separate mat below)
      // claw / gripper that can hold booster upper load pins during stacking
      tip.push(boxAt(0.35, 1.2, 0.35, BL + 0.3, -1.0, s * 2.0));
      tip.push(boxAt(0.7, 0.25, 0.25, BL + 0.5, -1.55, s * 2.0));
    }
    boomG.add(new T.Mesh(merge(tip), M.armHi));
    const pads = [];
    for (const s of [-1, 1]) pads.push(boxAt(0.7, 0.1, 1.3, BL + 0.6, -0.48, s * 1.5));
    boomG.add(new T.Mesh(merge(pads), M.whitePad));
    // stowed: swung ~50–60° off the catch axis (clear of the stack / open arms)
    boomG.position.set(5.5, 0, 0);
    boomG.rotation.y = -55 * D2R;
    g.add(boomG);
    g.position.set(0, 106, 0);   // roughly ship QD height on Pad 1
    return g;
  }

  // ---------------------------------------------------------------- OLM (Pad 1 donut) + booster QD hood
  function buildOLM(detail, M) {
    const g = new T.Group();
    const legs = [];
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      legs.push(boxAt(2.4, 20, 2.4, 9.2 * Math.cos(a), 10, 9.2 * Math.sin(a)));
    }
    g.add(new T.Mesh(merge(legs), M.concrete));
    const ring = new T.Mesh(new T.CylinderGeometry(8.6, 8.6, 3.4, 48, 1, true), M.deck); ring.position.y = 20; g.add(ring);
    const deck = new T.Mesh(new T.RingGeometry(5.0, 9.6, 48), M.deck); deck.rotation.x = -Math.PI / 2; deck.position.y = 21.7; g.add(deck);
    // hold-down clamps (simplified stubs)
    const clamps = [];
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2;
      clamps.push(boxAt(0.55, 1.3, 0.7, 7.6 * Math.cos(a), 22.3, 7.6 * Math.sin(a), -a));
    }
    g.add(new T.Mesh(merge(clamps), M.armHi));
    // Booster QD hood (Pad 1 single BQD) — tower-facing side of the mount
    const bqd = [];
    bqd.push(boxAt(5.5, 4.2, 4.0, -10.5, 24.5, 0));
    bqd.push(boxAt(2.5, 3.0, 3.2, -13.2, 24.0, 0));   // QD plate face
    bqd.push(boxAt(1.2, 2.2, 2.4, -14.5, 23.8, 0));
    g.add(new T.Mesh(merge(bqd), M.arm));
    // flame deflector / table underside hint
    const defl = new T.Mesh(new T.CylinderGeometry(11, 14, 4, 32, 1, true), M.concrete); defl.position.y = 2; g.add(defl);
    return g;
  }

  // ---------------------------------------------------------------- public builder
  SH.buildMechazilla = function (detail) {
    const M = materials();
    const root = new T.Group(); root.name = "mechazilla";
    const { lattice, crown } = buildTowerLattice(detail, M);
    lattice.castShadow = true; root.add(lattice); root.add(crown);
    // scaffolding hint (optional light detail around upper rails — photo 3fea)
    if (detail) {
      const scaff = [];
      for (let y = 118; y < 140; y += 2.2) for (const z of [-4.2, 4.2]) {
        scaff.push(bar([5.3, y, z], [5.3, y + 2.2, z], 0.04, 4));
        scaff.push(bar([5.3, y, z], [6.8, y, z], 0.035, 4));
      }
      root.add(new T.Mesh(merge(scaff), M.rail));
    }
    const carriage = buildCarriage(detail, M); root.add(carriage);
    const arms = [];
    for (const s of [-1, 1]) {
      const hinge = new T.Group(); hinge.position.set(HINGE_X, HINGE_Y, s * HINGE_Z);
      const arm = buildArm(detail, M, s); hinge.add(arm);
      carriage.add(hinge); arms.push({ hinge, s, arm });
    }
    const qd = buildShipQD(detail, M); root.add(qd);
    return { root, carriage, arms, qd, materials: M, HINGE_X, HINGE_Y, HINGE_Z, ARM_W, TOWER_BACK, ARM_LEN };
  };
  SH.buildOLM = function (detail) { return buildOLM(!!detail, materials()); };
})(window.SH = window.SH || {});
