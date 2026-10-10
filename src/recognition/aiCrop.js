export function aiCropEnabled() {
  return new URLSearchParams(globalThis.location?.search || "").get("aiCrop") !== "0"
    && typeof Worker === "function" && typeof OffscreenCanvas === "function"
    && typeof createImageBitmap === "function";
}

let worker;
let disabled;
let sequence = 0;

async function runProposal(bitmap, point) {
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
      worker.postMessage({ id, bmp: copy, point }, [copy]);
    } catch (error) {
      copy.close();
      finish({ quads: [], diagnostic: { status: "failed", proposals: 0, error: String(error?.message || error) } }, true);
    }
  });
}

// Warmup and scans share one model worker; callbacks cannot overlap or replace
// an active scan. Recognition keeps its own newest-click queue above this.
let proposalQueue = Promise.resolve();
export function proposeAiCrops(bitmap, point) {
  const job = proposalQueue.then(() => runProposal(bitmap, point));
  proposalQueue = job.catch(() => {});
  return job;
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
