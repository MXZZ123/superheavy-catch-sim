/* Web Worker: runs SH.simulate off the main thread so the UI (and phone browsers) never freeze.
   Loaded with a relative URL, so it works under any GitHub Pages sub-path. */
self.window = self;
importScripts("params.js", "physics.js", "guidance.js", "sim.js");
self.onmessage = (e) => {
  const { id, settings } = e.data;
  try {
    const run = SH.simulate(settings, { onProgress: (t) => self.postMessage({ id, type: "progress", t }) });
    self.postMessage({ id, type: "done", run });
  } catch (err) {
    self.postMessage({ id, type: "error", message: String(err && err.message || err) });
  }
};
