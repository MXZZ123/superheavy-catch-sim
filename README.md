# Super Heavy RTLS + chopstick catch simulator (web app)

This is a static, client-side web app. The physics, guidance, rendering and UI all run in the browser, with no server and no build step.

* **Run locally:** open `index.html` directly (it works over `file://` because it only uses classic `<script>` tags, no modules, workers or fetch).
  You can also serve the folder: `python3 -m http.server 8765` and browse to `http://localhost:8765/`.
* **Workflow:** set the pre-flight configuration on the left, then press **LAUNCH**. The flight is simulated fresh (about 1 s), then played back.

## Pre-flight only: no in-flight tinkering
* Every tweakable is a pre-flight setting. Pressing LAUNCH locks the whole settings panel (it is greyed out, ignores pointer input, and Launch, Presets, Reset and Monte Carlo are disabled) for the length of the flight.
  Playback controls stay live: pause, scrub, speed, camera, transparency and sound.
* The panel unlocks when playback reaches the end or when you press **END FLIGHT**. If you change any setting after a run, a banner warns that the results shown belong to the previous configuration until you launch a new run.
* Every run is a full re-simulation from T+0 using the chosen configuration. Nothing is patched mid-run.

## Architecture (modular)
| file | role |
|---|---|
| `js/params.js` | Parameter schema: fixed constants, tweakables (range/default/unit), presets, `buildParams` |
| `js/physics.js` | Atmosphere, gravity, wind + Dryden turbulence, drag/aero moments, Raptor 3 engine bank with start/stop transients, **tank geometry (`TankGeom`)**, SP-106 slosh tanks (generalised to arbitrary geometry) |
| `js/guidance.js` | Flip, boostback (impact predictor), coast and ullage, entry burn, AoA glide, 13→3 landing burn, divert, hover-hold, engine-out logic, arm closing |
| `js/sim.js` | Integration loop, **v3 mass properties (CG/inertia), feed logic, landing-tank isolation, venting, gas ingestion**, logging, outcome classification, summary |
| `js/render.js` | Canvas renderer (sky, ground, tower, booster, plume, vent jets, wind streaks, transparency internals, HUD) |
| `js/charts.js` | uPlot charts with a playback cursor and a reference-run overlay |
| `js/audio.js` | Procedural WebAudio |
| `js/ui.js` | Panel, lock, presets, share URL, launch, playback, outcome card, compare, Monte Carlo |
| `tools/` | Node and Playwright tooling (see Testing) |

### Physics models
* **v3 (default):** Block 3 style internals, which add a LOX landing tank, a CH4 transfer-tube landing column, domed tank bottoms, CG shift with variable inertia, low-fill slosh, venting and gas ingestion. Everything else is unchanged from v2.
* **v2:** the original model, kept bit-exact with the Python reference `sim.py`. The port is validated against it (below).

## Physics added in v3
1. **CG shift and variable inertia.** The CG station is recomputed every 5 ms step from three parts: the dry structure (a uniform shell plus 33 × 1.6 t of engines at 1.6 m) and every liquid mass at its actual centroid, including when it floats in coast. Pitch inertia is computed about the moving CG, including each liquid's own axial spread. The body stays continuous while the CG moves inside it. Aero moments, gimbal and fin lever arms, slosh hinge arms and pin/arm geometry all use the live CG.
   Baseline CG: 19.8 m above the base at staging and 28.5 m at catch.
2. **Domed tanks.** Tank geometry is a tabulated area function A(z) on a 2 cm grid, giving V(h), centroid, second moment and free-surface radius.
   * The LOX main tank has an ellipsoidal aft-dome bowl (1.6 m deep) and an annular cross-section around the transfer tube. The volume of the landing tank is subtracted.
   * The CH4 main tank sits on the common-dome bowl (1.4 m deep) and drains through the upper part of the transfer tube.
3. **Low-fill slosh.** Each tank uses an equivalent cylinder whose radius is the actual free-surface radius and whose depth is V/A_surface. At low fill in a dome, the frequency therefore rises, the sloshing-mass fraction approaches 1, and an extra contact-line damping term applies (estimated). Free-surface wall-wave amplitude uses the local surface radius.
   * A completely full tank has no free surface, so its slosh is zero. This applies to the landing tanks until they start draining.
   * The mode-1 pendulum angle is still capped at 0.6 rad for linear validity. It reaches that cap briefly during the flip and boostback cut-off transients, so the panel's "peak slosh" often reads 34.4°.
4. **Landing tanks with their own mass, level, slosh and feed logic.** These are covered in the next section.
5. **Main-tank residuals after boostback** (option: *vent all*, *vent some* with a percentage, or *don't vent*). At boostback cut-off the landing tanks are isolated, and whatever is left in the main tanks is the residual.
   * Venting is a mass flow (LOX 1.5 t/s, CH4 0.6 t/s, estimated) that only dumps liquid while the propellant is settled. In coast the cold-gas settling thrust fires to settle it. Unsettled, mostly gas leaves, at 8 % of the rate.
   * Vent thrust is mass flow × 30 m/s. 30 % of it acts axially and 5 % laterally (side-pair vents mostly cancel; estimated).
   * Vent jets are drawn on the vehicle, and vent rate is logged and charted.
   * Unvented residuals stay in the domed main tanks as mass. They shift the CG and inertia, and they slosh with a large free surface in the shallow dome during entry and the landing-burn translation. Their slosh forces and moments act on the vehicle.
6. **Gas ingestion.** When an engine draws from a main tank, the feed is "at risk" if the propellant is unsettled or the outlet head (level − |wall wave|) falls below 0.30 m. If that persists for 0.35 s, all lit engines flame out. This gives the outcome **ENGINE FLAMEOUT (GAS INGESTION)**.
7. **Best-effort guidance additions (v3).**
   * **Hover-hold:** if the booster is more than 4 m off the tower axis below 30 m pin height, it slows to a hover and translates before closing the arms.
   * **Throttle-floor engine shed:** if 3 engines at minimum throttle still exceed the thrust demand (a light booster near the end), one engine is shut down.
   * **Relight guard:** no hover relight attempts after prop-out.
   * In v2 mode these are disabled, to keep parity with Python.

## Landing (header) tanks: research summary
**Why they exist.** Dedicated landing tanks keep a small, full, well-insulated and separately pressurised volume of propellant for the relight. The engines then get settled, bubble-free liquid regardless of what the nearly empty main tanks are doing.
* A residual in a 9 m diameter main tank sloshes, migrates in low g and can uncover the outlet. That causes vortexing and gas ingestion, which can flame out the turbopumps.
* A small full tank has almost no free surface, so it barely sloshes.
* There is no need to keep the whole main tank pressurised until landing.
* The tanks can be placed to help the CG.

Musk (2017 AMA) described Starship's header tanks as holding the landing propellant: *"separate in order to have greater insulation and minimize boil-off, avoid sloshing on entry and not have to press up the whole main tank"* [5].
Header pressurisation matters. SN8 was lost because *"fuel header tank pressure was low during landing burn"* [6]. The fix was a helium/COPV pressurisation backup.

**What they look like and where they sit on Super Heavy.**
* **Block 1/2 boosters.** The DLR feed-system reconstruction [3] has two parts:
  * A **LOX header tank inside the main LOX tank**, above a **CH4 reservoir at the base of the LOX tank**.
  * CH4 comes down a **central downcomer / transfer tube** through the LOX tank. Every engine is fed from the main LOX tank, and the **inner 13 also get secondary LOX lines from the header tank**.
* **Block 3 (V3).**
  * SpaceX says the **fuel transfer tube is completely redesigned, "roughly the size of a Falcon 9 first stage"**, and allows simultaneous start of all 33 engines and faster, more reliable flips [1][2].
  * Community and secondary reporting says the **LOX landing tank moved from around the transfer tube to the side of the LOX tank** (as on Booster 5) and **feeds the inner 13 engines**, with extra COPVs to pressurise it [8][9][10].
  * Some low-quality reports instead claim V3 "replaced header tanks with the big downcomer" [11]. **This is conflicting and unverified.** We model the side-mounted LOX landing tank.
* **Transfer-tube structural loads matter.** Flight 9's booster (B14-2) broke up early in its landing burn. SpaceX's most probable cause is that the high-AoA descent loaded the fuel transfer tube beyond its capability. The tube failed, mixing CH4 and LOX, which ignited [1]. That motivated the V3 redesign.
* For Ship, SpaceX/FAA documentation says that during entry *"the fuel main tank is isolated from the transfer tube"*, so residual fuel stays contained in the transfer tube [7]. **We assume the analogous isolation on the booster. This is speculative.**

**How they operate (as modelled; speculative where marked).**
* **Fill and top-off.** The landing tanks are full at staging. During flip and boostback the engines draw from the main tanks, and the landing tanks are kept topped off from them.
  * If a main tank runs low (outlet head under the margin) before isolation, the feed switches to the landing tank. The event log says "eating landing reserve".
* **Isolation at boostback cut-off** (speculative timing). The LOX landing tank and the lower transfer-tube CH4 column are valved off. Main-tank residuals can then be vented.
* **Landing burn.** The inner 13 engines draw only from the landing tanks: LOX landing tank plus CH4 column.
  * If a landing tank runs dry, the feed switches back to the main tank, with the gas-ingestion check.
  * The entry burn (optional) uses settled main-tank residuals first, then the landing tanks.
* **Pressurisation.** In reality this is autogenous (heated GOX/GCH4 tapped from the Raptors) plus COPV backup [4][10]. **It is not modelled dynamically.** Tank pressure is assumed adequate, and there is no pressure-collapse failure mode yet.
* **Modelled sizes (estimates; public figures do not exist).**
  * LOX landing tank: Ø3.2 m × 7.0 m capsule, about 54 m³ (64.6 t LOX), side-mounted at 2.6 m off-axis, z = 5–12 m. It is drawn to scale.
    The off-axis mass is assumed to lie out of the 2-D plane, so it does not create a pitch moment.
  * CH4 landing column: the lower 17.4 m (z = 2.6–20 m) of a Ø1.8 m transfer tube, about 44 m³ (19.5 t CH4).
    The tube diameter is an estimate. SpaceX's "Falcon 9 sized" may refer mostly to its length.
  * Both are sized to cover the baseline landing burn (about 68 t at O/F 3.6) with roughly 15 % margin.
  * The landing tanks get 6 % extra damping from internal baffles (estimated). Their small radius gives high-frequency, low-mass slosh, so they are near-bulletproof.

**Sources** (accessed Oct 2026)
1. SpaceX, *Updates*: Flight 9 booster mishap cause (transfer tube), and the Super Heavy V3 changes (transfer tube, 3 grid fins with catch points, integrated hot stage, aft redesign). https://www.spacex.com/updates
2. SpaceX on X, 9 Jul 2025 (transfer tube installation, "roughly the same size as the first stage of a Falcon 9"), quoted in NextBigFuture: https://www.nextbigfuture.com/2025/07/spacex-redesigns-key-starship-fuel-transfer-tube.html
3. DLR (CEAS Space Journal 2025), *Comparison of SpaceX's Starship with winged heavy-lift launcher options for Europe*, Super Heavy tank and feed model: https://elib.dlr.de/214509/1/s12567-025-00625-8.pdf
4. DLR (HiSST 2022), *Critical Analysis of SpaceX's Next Generation Space Transportation System*, which gives header-tank volumes of about 19 m³ LOX and 17 m³ CH4 for Ship: https://elib.dlr.de/188531/
5. Space StackExchange, *What are SpaceX's Starship's header tanks?* (Musk 2017 AMA quote): https://space.stackexchange.com/questions/39259
6. Space StackExchange, *Are Starship header tanks used during ascent?* (SN8 header pressure): https://space.stackexchange.com/questions/50907
7. SpaceX/FAA figure, *Starship internal structure* (transfer-tube isolation during entry; Ship): https://commons.wikimedia.org/wiki/File:Starship_internal_structure.jpg
8. Starship SpaceX Wiki (community), *Super Heavy Booster*, Block 3 section: https://starship-spacex.fandom.com/wiki/Super_Heavy_Booster *(community source: uncertain)*
9. OVEX News, *Starship V3: SpaceX Reveals Revolutionary Engine Feed System*: https://news.ovexro.com/starship-v3-spacex-reveals-revolutionary-engine-feed-system/ *(secondary: uncertain)*
10. Inter Space Sky Way, *Tremendous Heavy Block 3*: https://interspaceskyway.com/2026/05/18/tremendous-heavy-block-3-the-booster-of-the-future/ *(machine-rewritten repost: low reliability, used only for "COPVs pressurise the side landing tank")*
11. ElonBuzz, Flight 12 / V3 slosh article: https://elonbuzz.com/spacexs-new-upgrades-to-fix-starship-booster-v3-problem-get-ready-for-flight-13/ *(unverified, contradicts 8–10; noted, not used for the model)*

## Graphics
* **Booster (Block 3 style)**
  * Brushed-stainless shell with cylindrical shading, 1.83 m ring weld lines, staggered vertical panel seams, and stringer hints when zoomed in.
  * Side chines.
  * Three Block 3 grid fins drawn to scale in pseudo-3D (see *Grid fins* below), with catch hardpoints.
  * Open hot-staging crown: V struts and a thin top ring, with the forward dome visible through it.
  * Aft skirt with hex metallic heat-shield tiles.
  * 33 bells (outer fixed, inner 13 gimbal) glowing with spool.
  * Frost bands outside wherever cryogenic liquid sits inside, driven by the live levels (main, landing tank, CH4). They fade with entry heating.
  * Soot that builds up after the burns.
  * Plume that widens in thin air, with shock diamonds low down.
  * Ground dust and steam.
  * Vent jets.
* **Tower**
  * Lattice with 4 legs, K- and X-bracing, secondary members and platforms when zoomed, elevator shaft.
  * Carriage rails, carriage with actuators, truss chopstick arms with catch rails, bumpers and actuators.
  * Stowed ship QD arm, top crown and antennas.
  * Orbital launch mount: legs, table, clamp ring, BQD, deflector.
  * Blinking aviation lights and floodlight glows.
* **Transparency mode** (the *Transparent* checkbox; pair it with the *Tanks (internals)* camera). The steel becomes see-through and shows:
  * The main LOX and CH4 tanks with aft, common and forward domes, plus baffle rings.
  * The transfer tube and isolation valve (green open, red isolated).
  * The CH4 landing column and the side-mounted LOX landing tank.
  * Feedlines with flow animation for whichever source is feeding, and the CG marker.
  * **Liquids** (LOX pale blue, CH4 amber) whose levels, tilt (from the slosh wall-wave), free-surface ripples, floating blobs in coast (from the propellant-migration state), vent flow and landing-tank drawdown all come from the sim log.

## Grid fins (Block 3): references and how they are drawn
**What the real fins look like.** These are taken from the user's two reference photos (booster on the pad at the tower, and a StarshipGazer close-up) plus the public sources below:
* **Count and layout:** 3 fins instead of 4, in a T layout. Two side fins sit opposite each other and the third is on one side between them, roughly 90/90/180° [1][3].
* **Size and mass:** SpaceX says they are "50% larger and higher strength" [5]. Estimates are about 7.5 × 3.75 m [1], or about 7 × 3 m from the 2019 renders [6]. Each fin weighs about 3 t [3].
* **Planform:** chunky, roughly hexagonal (cropped corners at both root and tip). They look more squarish than the slim Block 1/2 fins [1][2].
* **Lattice:** deep egg-crate cells with arched/scalloped walls. About 8–10 cells across in the close-up photo.
* **Finish:** welded stainless steel, but it looks charcoal/black in the photos. Edge-on they read as thick dark ridged slabs.
* **Mounting and position:** a stubby steel hinge/actuator block with a wedge fairing on the hull, a few metres below the open hot-stage crown (V struts plus a top ring). They are lower on the vehicle than on Block 1/2. The shaft and actuator now sit inside the CH4 tank [1][3].
* **Catch:** the chopstick arms come up under the fins and lift on hardpoints just below the side fins [3][9].
* **Belly fin:** the fin between the two side fins is reportedly built differently, with its plates slightly canted to offset the asymmetry [3][9].

**How it's drawn** (`drawFins` and `_fin` in `js/render.js`):
* **Geometry, in metres:**
  * radial span 4.6 + 0.8 m hinge block
  * width 4.4 m (3.0 m root edge, 3.1 m tip edge, hexagonal)
  * depth 1.2 m
  * cell pitch 0.52 m, frame 0.2 m
  * hinge axis at body z = 67.2 m
  * hardpoint underside at 66.0 m, which is the physics catch station `l_pins_m`
* **Projection:** oblique pseudo-3D with a 13° view from below.
  * The side fins point ±x, so they are seen nearly edge-on (dark ridged slab plus a sliver of the lattice underside).
  * The belly fin points at the camera, so its whole hexagonal underside lattice and the tip plate are visible.
  * Each fin rotates about its own radial hinge axis.
* **Deflection (visual only):** belly fin = `fin` × 20°, side fins = 0.6 of that. The 2-D sim only computes the net fin moment and does not log a per-fin angle.
* **Shading:** dark volume, then the lit scalloped wall in each cell and a dark pocket. A thick projected frame, a ridged edge plate with a toothed rim, and a faint bronze→blue heat sheen that grows through entry.
* **Transparency mode** adds the shaft and actuator inside the tank.
* **Wide shot:** fins are drawn as an exaggerated high-contrast icon.
* **Shot tools:** `node tools/finshots.js <prefix>` writes close-ups. `screenshots/compare_fins_photo_vs_render.png` shows the reference photos next to the renders.

**Uncertain:**
* Exact dimensions, depth, cell count and pitch.
* Exact hinge height relative to the crown. The photos suggest about 3 m below the barrel top; we use about 1.6 m so that the 66.0 m catch station stays under the fins.
* The crown height: drawn at 3.1 m, while NSF says "nearly four-meter".
* Belly-fin cant angle (8° assumed).
* The heat tint is artistic.

Sources:
1. Tesla Oracle (2025-08-16): https://www.teslaoracle.com/2025/08/16/spacex-reveals-grid-fins-of-the-next-gen-starship-super-heavy-booster/
2. NextBigFuture: https://www.nextbigfuture.com/2025/08/spacex-starship-has-built-new-grid-fins-for-the-super-heavy-booster.html
3. Wikipedia, Super Heavy: https://en.wikipedia.org/wiki/Super_Heavy_(booster_rocket)
4. NSF, Pad 2 / Block 3 preparations: https://www.nasaspaceflight.com/2025/09/spacex-prepare-pad-2-block-3-starbase/
5. SpaceX Starship V3 video: https://www.youtube.com/watch?v=9PY447GiUR4
6. Teslarati, steel grid fins: https://www.teslarati.com/spacex-starship-super-heavy-grid-fins-titanium-to-steel/
7. Teslarati, B5 grid fin installation: https://www.teslarati.com/spacex-super-heavy-booster-5-grid-fin-installation/
8. Space.com, Flight 11 coverage
9. "Booster 19 Lift Off" video: https://www.youtube.com/watch?v=RIwGDCfhAJY

## Phones, GitHub Pages and PWA
* **Responsive layout (≤820 px):**
  * The canvas spans the full width. Settings live in a bottom-sheet drawer (⚙ Setup), or a side drawer in landscape.
  * LAUNCH is also in the playback bar.
  * Charts are stacked one per row, with touch targets of 40 px or more.
  * Nothing is hover-only.
  * The HUD scales down and drops the wind panel on narrow screens.
* **Touch:**
  * Drag horizontally on the canvas to scrub. Tap to play/pause.
  * Vertical drags still scroll the page.
* **Performance:**
  * The simulation runs in a Web Worker (`js/simworker.js`), with a progress bar showing simulated T+. Monte Carlo uses it too.
  * Over `file://` it falls back to the main thread.
  * Canvas DPR is capped at 2, or 1.75 on phones, and the canvas resizes via ResizeObserver and orientationchange.
  * Phones draw fewer stars and wind streaks.
* **Audio:** WebAudio starts only after the Sound toggle is tapped, and is resumed on touch for iOS.
* **Paths:** all relative, so the app works under a sub-path like `/<repo>/`.
* **PWA:** `manifest.webmanifest` plus the icons in `icons/` (favicon.svg, 192/512 PNG, apple-touch-icon). There is no service worker, so it does not work offline.
* **Deploy:**
  * `python3 tools/build_dist.py` writes `../site/` (the static site with `index.html` at its root, plus `.nojekyll` and `404.html`) and `../webapp_dist.zip`.
  * Push `site/` to a repo and enable Pages for that branch/folder.
* **Mobile test:** `node tools/mobileshots.js [baseURL]` runs Playwright in iPhone 13 and Pixel 7 emulation (portrait and landscape) and writes `screenshots/mobile_*.png`.

## Tweakables (all pre-flight)
* **Model & propellant management:** physics model v3/v2, landing tanks on/off, residual handling (vent all / vent some / don't vent), vent %.
* **Engine failures:** engines out in boostback (count, ring, time), engines out in the landing burn (count, ring, time), forced relight start failures, random start-failure probability.
* **Re-entry:** glide AoA bias, grid-fin authority, entry burn on/off with altitude and Δv.
* **Boostback:** aim-point offset, engine count 3/13/33, cut-off logic (predictor or fixed) and duration.
* **Landing burn:** spool-lag look-ahead, 13→3 handover height, throttle min/max, throttle rate limit.
* **Vehicle:** dry mass, propellant at staging, Raptor thrust 230–300 tf, Isp SL/vac, Cd scale.
* **Environment:** surface wind, jet-stream peak, turbulence ×, gust amplitude, duration and trigger, seed.
* **Tower:** arm close time, rail stiffness and damping.
* **Outcome limits:** vy, tilt, g and arm load.

Presets include Baseline v3, Don't vent, No landing tanks, the v2 model, engine-out cases, high-AoA, windy, 250 tf, heavy, low propellant, no lag compensation and sluggish arms.
**Extras:**
* Share link (settings encoded in the URL hash).
* Pin-as-reference comparison (charts overlay plus side-by-side table).
* Monte Carlo (10/20/50 runs with seed and environment dispersions).
* Procedural sound (Raptor roar scaled by engines, throttle and ambient pressure; ignition pops; triple sonic boom; aero rush; vent hiss; arm clank).

## Port validation (v2 model vs Python `sim.py`, same portable RNG)
`python webapp/tools/validate.py` gives identical results to 4 decimals in all 3 cases (baseline, no lag compensation, engine-out). Examples from the baseline:
* catch vy −0.3670 m/s, vx −0.0182 m/s
* offset −0.4302 m
* propellant 23 543.3 kg
* flight time 253.35 s
* max-Q 179.33 kPa, peak g 9.728

Details are in `tools/validation.json`.

## Testing
* `node tools/scenarios.js`: about 30 scenarios headless, about 2 s each.
* `node tools/v3check.js '{"vent_mode":"don\'t vent"}' "190,232,240"`: event log plus state probes.
* `node tools/shots.js [url]`: Playwright at 1280×800. It runs baseline / 2-engines-out / high-AoA / don't-vent / no-landing-tanks, the lock test, compare, the share URL and Monte Carlo, and writes `screenshots/*.png` and `screenshots/results.json`.

## Known limitations / not modelled
* The model is 2-D (pitch plane only). Out-of-plane effects are not modelled: the side-mounted landing tank's lateral CG, roll, and the third grid fin's role.
* Tank pressurisation, autogenous pressure collapse, boil-off and geysering are not modelled. Gas ingestion uses a simple level/slosh criterion.
* Landing-tank sizes, isolation-valve placement and timing, vent rates and vent thrust are estimates. Treat them as plausible, not as SpaceX data.
* The slosh model is an equivalent-pendulum (SP-106 / Dodge) approximation applied to domed and annular geometry. It is not CFD.
