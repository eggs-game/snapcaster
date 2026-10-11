// Production-CSP checks for current-face retrieval, retained WASM allocation,
// and unavailable-model fallback. Run separately from latency benchmarks.
import { chromium } from "playwright";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
const [base, dist, output] = process.argv.slice(2);
if (!base || !dist || !output) throw new Error("usage: BASE DIST OUTPUT");
const asset = (await readdir(path.join(dist, "assets"))).find(x => /^aiCropWorker-.*\.js$/.test(x));
if (!asset) throw new Error("compiled AI worker missing");
await mkdir(path.join(dist, "experimental"), { recursive: true });
// Instrument the real worker in a test-only wrapper, never production source.
await writeFile(path.join(dist, "experimental/milo-memory.js"), `
const allocations = [];
WebAssembly.Memory = new Proxy(WebAssembly.Memory, { construct(target, args) {
  const memory = Reflect.construct(target, args); allocations.push(memory); return memory;
}});
const send = self.postMessage.bind(self);
self.postMessage = (message, ...args) => send({ ...message, testWasmBytes: allocations.map(m => m.buffer.byteLength) }, ...args);
await import("../assets/${asset}");
`);
const cards = JSON.parse(await readFile("public/carddata/cards.json", "utf8"));
const cases = JSON.parse(await readFile("snaptest/runs/2026-10-10-card-index/cases.json", "utf8"));
const inputs = cases.newFaces || cases.cases || cases;
if (!Array.isArray(inputs)) throw new Error("unexpected catalog case format");
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
try {
  const page = await browser.newPage(); await page.goto(base + "/snaptest?aiCrop=0&milo=0");
  const result = await page.evaluate(async ({ inputs, cards }) => {
    const worker = new Worker("/experimental/milo-memory.js", { type: "module" });
    let id = 0;
    const request = message => new Promise((resolve, reject) => {
      const current = ++id, timer = setTimeout(() => reject(new Error("worker timed out")), 45000);
      worker.onmessage = e => { if (e.data.id === current) { clearTimeout(timer); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data); } };
      worker.onerror = e => { clearTimeout(timer); reject(new Error(e.message)); };
      worker.postMessage({ ...message, id: current });
    });
    try {
      const corners = async image => {
        const canvas = document.createElement("canvas"); canvas.width = image?.width || 384; canvas.height = image?.height || 384;
        if (image) canvas.getContext("2d").putImageData(image,0,0);
        const bmp = await createImageBitmap(canvas);
        try { return await request({ bmp, point: { nx: .5, ny: .5 } }); }
        finally { bmp.close(); canvas.width = canvas.height = 0; }
      };
      await corners();
      const warm = await request({ type: "milo-warmup" }), records = [], memory = [warm.testWasmBytes];
      let first;
      for (const item of inputs) {
        const id = item.id || item.scryfall_id, face = item.face || 0;
        const response = await fetch(`https://cards.scryfall.io/normal/${face ? "back" : "front"}/${id[0]}/${id[1]}/${id}.jpg`);
        if (!response.ok) throw new Error("reference unavailable");
        const bmp = await createImageBitmap(await response.blob());
        const canvas = document.createElement("canvas"); canvas.width = bmp.width; canvas.height = bmp.height;
        const ctx = canvas.getContext("2d"); ctx.drawImage(bmp, 0, 0); bmp.close();
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height); canvas.width = canvas.height = 0;
        first ||= image;
        const r = await request({ type: "milo-lookup", images: [image] });
        const got = cards[r.rows[0]?.row]?.[0];
        records.push({ name: item.name, id, face, got, ok: got === item.name, diagnostic: r.diagnostic }); memory.push(r.testWasmBytes);
      }
      for (let i = 0; i < 30; i++) {
        if (i % 5 === 0) memory.push((await corners(first)).testWasmBytes);
        memory.push((await request({ type: "milo-lookup", images: [first] })).testWasmBytes);
      }
      return { warm: warm.diagnostic, records, memory, queries: records.length + 30 };
    } finally { worker.terminate(); }
  }, { inputs, cards });
  if (!result.records.every(r => r.ok)) throw new Error("new-face Milo retrieval failed: " + JSON.stringify(result.records.filter(r => !r.ok)));
  if (!result.memory[0]?.length) throw new Error("no WASM allocation captured; cannot claim retained memory validation");
  if (JSON.stringify(result.memory[0]) !== JSON.stringify(result.memory.at(-1))) throw new Error("WASM allocation grew after warmup");
  const fallback = await browser.newContext();
  await fallback.route("**/carddata/milo/manifest.json", route => route.abort());
  const failed = await fallback.newPage(); await failed.goto(base + "/snaptest");
  await failed.waitForFunction(() => window.__SNAP_RECOGNITION_WARMUP?.status === "ready", null, { timeout: 90000 });
  result.fallback = await failed.evaluate(() => ({ lookup: window.__SNAP_MILO_WARMUP, recognition: window.__SNAP_RECOGNITION_WARMUP }));
  if (result.fallback.lookup?.status === "ready") throw new Error("missing catalog unexpectedly marked ready");
  const frozen = JSON.parse(await readFile("public/snaptest/regressions/manifest.json", "utf8"));
  const control = frozen.fixtures[0];
  const source = "/snaptest/regressions/" + control.file;
  result.fallback.scan = await failed.evaluate(async ({ source, control }) => {
    const r = await window.__scIdentifyUrl(source, control.point);
    return { got: r.matches[0]?.name, ok: r.matches[0]?.name === control.name, crop: r.ai_crop, lookup: r.milo };
  }, { source, control });
  if (!result.fallback.scan.ok || result.fallback.scan.crop?.status !== "ready") throw new Error("missing Milo disrupted the corner detector or established recognition");
  await fallback.close();
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ newFaces: result.records.length, queries: result.queries, wasmBytes: result.memory[0], fallback: result.fallback }));
} finally { await browser.close(); }
