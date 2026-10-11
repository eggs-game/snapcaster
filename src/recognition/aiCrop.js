export function aiCropEnabled() {
  return new URLSearchParams(globalThis.location?.search || "").get("aiCrop") !== "0"
    && typeof Worker === "function" && typeof OffscreenCanvas === "function"
    && typeof createImageBitmap === "function";
}

let worker;
let disabled;
let sequence = 0;
let miloDisabled, miloWarmup;

export function miloEnabled() {
  return aiCropEnabled() && new URLSearchParams(globalThis.location?.search || "").get("milo") !== "0";
}

function runMilo(type, images = []) {
  if (!miloEnabled()) return Promise.resolve({ rows: [], diagnostic: { status: "off" } });
  if (miloDisabled || disabled) return Promise.resolve({ rows: [], diagnostic: miloDisabled || disabled });
  return new Promise(resolve => {
    const id = ++sequence, started = performance.now(); let settled = false;
    const finish = (result, fatal = false) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (result.diagnostic?.status !== "ready") miloDisabled = result.diagnostic;
      if (fatal) { worker?.terminate(); worker = null; }
      resolve(result);
    };
    // A cold model download must never hold up an uncertain click. Warm it in
    // the lobby; slow/unavailable inference falls back for the page lifetime.
    const timer = setTimeout(() => finish({ rows: [], diagnostic: { model: "milo1", status: "timeout", ms: Math.round(performance.now() - started) } }, true), type === "milo-warmup" ? 30000 : 2500);
    try {
      if (!worker) worker = new Worker(new URL("./aiCropWorker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => { if (data.id === id) finish(data); };
      worker.onerror = () => finish({ rows: [], diagnostic: { model: "milo1", status: "failed", error: "AI lookup worker failed" } }, true);
      worker.postMessage({ id, type, images });
    } catch (error) { finish({ rows: [], diagnostic: { model: "milo1", status: "failed", error: String(error?.message || error) } }, true); }
  });
}

async function runProposal(bitmap, point, retry = false) {
  if (!aiCropEnabled()) return { quads: [], diagnostic: { status: "off" } };
  if (disabled) return { quads: [], diagnostic: disabled };
  let copy;
  try { copy = await createImageBitmap(bitmap); } catch {
    return { quads: [], diagnostic: { status: "failed", proposals: 0, error: "Could not copy the capture for AI cropping" } };
  }
  return new Promise((resolve) => {
    const id = ++sequence;
    const started = performance.now();
    let settled = false;
    const finish = (result, fatal = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (fatal) {
        disabled = result.diagnostic;
        worker?.terminate();
        worker = null;
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ quads: [], diagnostic: {
      status: "timeout", proposals: 0, ms: Math.round(performance.now() - started),
    } }, true), 15000);
    try {
      if (!worker) worker = new Worker(new URL("./aiCropWorker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        if (data.id !== id) return;
        finish(data, data.diagnostic?.status === "failed");
      };
      worker.onerror = () => finish({ quads: [], diagnostic: { status: "failed", proposals: 0, error: "AI crop worker failed" } }, true);
      worker.postMessage({ id, bmp: copy, point, retry }, [copy]);
    } catch (error) {
      copy.close();
      finish({ quads: [], diagnostic: { status: "failed", proposals: 0, error: String(error?.message || error) } }, true);
    }
  });
}

// Warmup and scans share one model worker; callbacks cannot overlap or replace
// an active scan. Recognition keeps its own newest-click queue above this.
let proposalQueue = Promise.resolve();
export function proposeAiCrops(bitmap, point, retry = false) {
  const job = proposalQueue.then(() => runProposal(bitmap, point, retry));
  proposalQueue = job.catch(() => {});
  return job;
}
export function lookupAiCrops(images) {
  const job = proposalQueue.then(() => runMilo("milo-lookup", images));
  proposalQueue = job.catch(() => {});
  return job;
}
export function preloadMilo() {
  if (!miloEnabled()) return Promise.resolve();
  if (!miloWarmup) {
    miloWarmup = proposalQueue.then(() => runMilo("milo-warmup"));
    proposalQueue = miloWarmup.catch(() => {});
  }
  return miloWarmup;
}
let warmupPromise;
export function preloadAiCrop() {
  if (!aiCropEnabled()) return Promise.resolve();
  if (!warmupPromise) warmupPromise = (async () => {
    const canvas = new OffscreenCanvas(2, 2);
    const bitmap = canvas.transferToImageBitmap();
    try { return await proposeAiCrops(bitmap, { nx: 0.5, ny: 0.5 }); }
    finally { bitmap.close(); }
  })().catch(() => {});
  return warmupPromise;
}
