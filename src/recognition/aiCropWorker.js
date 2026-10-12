import { AI_CROP_MAX_QUADS, AI_CROP_MODEL, aiCropWindows, sameAiQuad, validateAiQuad } from "./aiCropGeometry.js";
import { lookupMilo, miloCatalog } from "./miloLookup.js";

const BASE = new URL("/vendor/vision/cornelius-2.12-ort-1.30.0/", self.location.origin).href;
const SIZE = 384;
let sessionPromise;
let ort;
const miloOptions = { loadGpuRuntime: async () => {
  if (!self.navigator?.gpu) return null;
  const adapter = await self.navigator.gpu.requestAdapter();
  if (!adapter || adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter) return null;
  const base = new URL("/vendor/vision/ort-webgpu-1.30.0/", self.location.origin).href;
  const runtime = await import(/* @vite-ignore */ base + "ort.webgpu.min.mjs");
  runtime.env.wasm.wasmPaths = base;
  runtime.env.wasm.numThreads = 1;
  runtime.env.wasm.proxy = false;
  return runtime;
} };

function session() {
  if (!sessionPromise) sessionPromise = (async () => {
    ort = await import(/* @vite-ignore */ BASE + "ort.wasm.min.mjs");
    ort.env.wasm.wasmPaths = BASE;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    return ort.InferenceSession.create(BASE + "corners.onnx", { executionProviders: ["wasm"] });
  })();
  return sessionPromise;
}

self.onmessage = async ({ data: { id, bmp, point, type, images, retry, miloGpu } }) => {
  const started = performance.now();
  try {
    const model = await session();
    // Corner detection stays on its original WASM runtime. Milo may use GPU;
    // callbacks and all model jobs still share the serialized adapter queue.
    if (type === "milo-warmup") {
      const catalog = await miloCatalog(ort, miloGpu === false ? {} : { ...miloOptions, gpuBudgetMs: 5000 });
      self.postMessage({ id, ...catalog, diagnostic: { model: "milo1", status: "ready", backend: catalog.backend, ms: Math.round(performance.now() - started) } });
      return;
    }
    if (type === "milo-lookup") {
      self.postMessage({ id, ...await lookupMilo(images || [], ort, miloGpu === false ? {} : { ...miloOptions, gpuBudgetMs: 800 }) });
      return;
    }
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const quads = [], probes = [];
    for (const window of aiCropWindows(bmp.width, bmp.height, point, retry)) {
      ctx.drawImage(bmp, window.x, window.y, window.w, window.h, 0, 0, SIZE, SIZE);
      const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
      const tensor = new Float32Array(3 * SIZE * SIZE);
      const means = [0.485, 0.456, 0.406], stds = [0.229, 0.224, 0.225];
      for (let i = 0; i < SIZE * SIZE; i++) {
        for (let c = 0; c < 3; c++) tensor[c * SIZE * SIZE + i] = (pixels[i * 4 + c] / 255 - means[c]) / stds[c];
      }
      const input = new ort.Tensor("float32", tensor, [1, 3, SIZE, SIZE]);
      let output;
      try {
        output = await model.run({ image: input });
        const sharpness = Number(output.sharpness?.data[0]);
        const coords = output.corners?.data;
        const points = coords?.length === 8 ? Array.from({ length: 4 }, (_, i) => ({
          x: window.x + coords[i * 2] * window.w, y: window.y + coords[i * 2 + 1] * window.h,
        })) : [];
        const quad = sharpness > 0.02 ? validateAiQuad(points, bmp.width, bmp.height, point) : null;
        const duplicate = quad && quads.some((other) => sameAiQuad(quad, other, bmp.width, bmp.height));
        probes.push({ sharpness, accepted: !!quad && !duplicate, reason: sharpness <= 0.02 ? "weak" : !quad ? "geometry-or-click" : duplicate ? "duplicate" : "accepted" });
        if (quad && !duplicate && quads.length < AI_CROP_MAX_QUADS) quads.push(quad);
      } finally {
        input.dispose();
        if (output) for (const value of Object.values(output)) value.dispose();
      }
    }
    canvas.width = canvas.height = 0;
    self.postMessage({ id, quads, diagnostic: { model: AI_CROP_MODEL, status: "ready", proposals: quads.length, probes, ms: Math.round(performance.now() - started) } });
  } catch (error) {
    self.postMessage({ id, quads: [], rows: [], diagnostic: { model: type?.startsWith("milo-") ? "milo1" : AI_CROP_MODEL, status: "failed", proposals: 0, ms: Math.round(performance.now() - started), error: String(error?.message || error) } });
  } finally {
    bmp?.close();
  }
};
