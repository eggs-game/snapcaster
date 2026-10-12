// Actual compiled worker under production CSP. Run separately from benchmarks:
// current faces, GPU/CPU row parity, detector isolation and owned-memory tails.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const [base, dist, output] = process.argv.slice(2);
if (!base || !dist || !output) throw new Error("usage: BASE DIST OUTPUT");
const origin = new URL(base).origin;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Use a loopback compiled preview");
const asset = (await readdir(path.join(dist, "assets"))).find(x => /^aiCropWorker-.*\.js$/.test(x));
assert.ok(asset, "compiled AI worker missing");
const config = JSON.parse(await readFile("vercel.json", "utf8"));
const csp = config.headers.flatMap(h => h.headers).find(h => h.key.toLowerCase() === "content-security-policy")?.value;
assert.ok(csp, "Use the current production CSP without relaxing it");
await mkdir(path.join(dist, "experimental"), { recursive: true });
// Wrapper owns only test instrumentation and its private worker's devices.
await writeFile(path.join(dist, "experimental/milo-memory.js"), [
  "const allocations=[], devices=[], violations=[]; let deviceHook=false;",
  "WebAssembly.Memory=new Proxy(WebAssembly.Memory,{construct(target,args){const memory=Reflect.construct(target,args);allocations.push(memory);return memory;}});",
  "try{const proto=self.GPUAdapter?.prototype,original=proto?.requestDevice;if(original){proto.requestDevice=async function(...args){const device=await original.apply(this,args);devices.push(device);return device;};deviceHook=true;}}catch{}",
  "self.addEventListener('securitypolicyviolation',e=>violations.push({directive:e.violatedDirective,blocked:String(e.blockedURI).slice(0,160)}));",
  "const send=self.postMessage.bind(self);self.postMessage=(message,...args)=>send({...message,testWasmBytes:allocations.map(m=>m.buffer.byteLength),testCspViolations:[...violations],testGpuDevices:devices.length,testDeviceHook:deviceHook},...args);",
  "await import(" + JSON.stringify("../assets/" + asset) + ");",
  "const handle=self.onmessage;self.onmessage=async e=>{if(e.data?.testDestroyGpu){for(const device of devices)device.destroy();await Promise.all(devices.map(device=>device.lost));self.postMessage({id:e.data.id,destroyed:devices.length});return;}return handle(e);};",
].join("\n"));
const testWrapper = await readFile(path.join(dist, "experimental/milo-memory.js"), "utf8");
const cards = JSON.parse(await readFile("public/carddata/cards.json", "utf8"));
const cardsSha256 = createHash("sha256").update(await readFile("public/carddata/cards.json")).digest("hex");
const saved = JSON.parse(await readFile("snaptest/runs/2026-10-10-card-index/cases.json", "utf8"));
const inputs = saved.newFaces || saved.cases || saved;
assert.ok(Array.isArray(inputs) && inputs.length > 1, "saved new-face cases required");
for (const item of inputs) assert.ok(cards.some(row => row[0] === item.name && row[3] === (item.id || item.scryfall_id) && row[4] === (item.face || 0)),
  "Saved new face must exist in the current exact catalog: " + item.name);
const frozen = JSON.parse(await readFile("public/snaptest/regressions/manifest.json", "utf8"));
const control = frozen.fixtures[0];
const result = {
  scope: "Compiled actual model worker, exact public JPEG bytes replayed across CPU/default/blocked-GPU arms under the current production CSP. Retrieval and lifecycle checks, not full recognition accuracy or click latency. WASM allocations are observable; GPU memory usage is not.",
  csp, assets: { worker: asset, workerSha256: createHash("sha256").update(await readFile(path.join(dist, "assets", asset))).digest("hex") },
  catalog: { count: cards.length, sha256: cardsSha256 }, arms: {}, parity: [], errors: [], cspViolations: [], blockedWrites: [],
};
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });

async function contextFor({ blockGpu = false, blockCatalog = false } = {}) {
  const context = await browser.newContext();
  const blockedGpu = [], gpuReads = [];
  await context.addInitScript(() => {
    window.__miloCspViolations = [];
    document.addEventListener("securitypolicyviolation", e => window.__miloCspViolations.push({
      directive: e.violatedDirective, blocked: String(e.blockedURI).slice(0, 160),
    }));
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      result.blockedWrites.push({ method: request.method(), host: url.hostname }); return route.abort();
    }
    // Frozen preview servers deliberately reject /experimental/. Admit only
    // this exact test-generated wrapper, under the unchanged worker CSP.
    if (url.origin === origin && url.pathname === "/experimental/milo-memory.js") return route.fulfill({
      status: 200, body: testWrapper, headers: { "content-type": "text/javascript", "content-security-policy": csp },
    });
    if (url.origin === origin && url.pathname.startsWith("/vendor/vision/ort-webgpu-1.30.0/")) {
      gpuReads.push(url.pathname);
      if (blockGpu) { blockedGpu.push(url.pathname); return route.abort(); }
    }
    if (blockCatalog && url.origin === origin && url.pathname === "/carddata/milo/manifest.json") return route.abort();
    if (/^https?:$/.test(url.protocol) && url.origin !== origin && url.hostname !== "cards.scryfall.io") return route.abort();
    if (url.origin === origin) {
      const response = await route.fetch();
      return route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
    }
    return route.continue();
  });
  return { context, blockedGpu, gpuReads };
}

async function workerArm(page, sources, miloGpu, repeats = 30, loseGpu = false) {
  return page.evaluate(async ({ sources, miloGpu, repeats, loseGpu }) => {
    const worker = new Worker("/experimental/milo-memory.js", { type: "module" });
    let seq = 0;
    const request = message => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { worker.onmessage = null; reject(new Error("worker timed out")); }, 45000);
      worker.onmessage = ({ data }) => {
        if (data.id !== id) return;
        clearTimeout(timer); worker.onmessage = null;
        data.error ? reject(new Error(data.error)) : resolve(data);
      };
      worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
      worker.postMessage({ ...message, id });
    });
    const image = async source => {
      const response = await fetch("data:image/jpeg;base64," + source.base64);
      const bmp = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      try {
        canvas.width = bmp.width; canvas.height = bmp.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0); return ctx.getImageData(0, 0, canvas.width, canvas.height);
      } finally { bmp.close(); canvas.width = canvas.height = 0; }
    };
    const observed = [], memory = [], diagnostics = [], cspViolations = [];
    const remember = reply => {
      observed.push(reply); memory.push(reply.testWasmBytes);
      if (reply.diagnostic) diagnostics.push({ ...reply.diagnostic });
      cspViolations.push(...(reply.testCspViolations || []));
      return reply;
    };
    const corners = async pixels => {
      const canvas = document.createElement("canvas");
      canvas.width = pixels.width; canvas.height = pixels.height;
      canvas.getContext("2d").putImageData(pixels, 0, 0);
      const bmp = await createImageBitmap(canvas);
      try { return remember(await request({ bmp, point: sources.corner.point })); }
      finally { bmp.close(); canvas.width = canvas.height = 0; }
    };
    const lookup = async pixels => remember(await request({ type: "milo-lookup", images: [pixels], miloGpu }));
    try {
      const cornerImage = await image(sources.corner), first = await image(sources.faces[0]), second = await image(sources.faces[1]);
      const cornerBefore = await corners(cornerImage);
      const warm = remember(await request({ type: "milo-warmup", miloGpu }));
      const records = [];
      for (let index = 0; index < sources.faces.length; index++) {
        const source = sources.faces[index], pixels = index === 0 ? first : index === 1 ? second : await image(source);
        const reply = await lookup(pixels);
        records.push({ name: source.name, id: source.id, face: source.face, sha256: source.sha256,
          rows: reply.rows, diagnostic: reply.diagnostic });
      }
      const tail = [];
      for (let iteration = 0; iteration < repeats; iteration++) {
        if (iteration % 5 === 0) await corners(cornerImage);
        tail.push((await lookup(iteration % 2 ? second : first)).testWasmBytes);
      }
      const cornerAfter = await corners(cornerImage);
      const mainMemory = memory.map(entry => entry?.slice());
      let gpuLoss = { tested: false, reason: warm.diagnostic?.backend === "webgpu" ? "disabled" : "GPU not adopted" };
      if (loseGpu && warm.diagnostic?.backend === "webgpu") {
        if (!warm.testDeviceHook || !warm.testGpuDevices) throw new Error("Cannot observe owned GPU device; do not claim real device-loss validation");
        const lost = remember(await request({ testDestroyGpu: true }));
        const recovered = await lookup(first), lossTail = [];
        for (let iteration = 0; iteration < 8; iteration++) lossTail.push((await lookup(iteration % 2 ? second : first)).testWasmBytes);
        gpuLoss = { tested: true, destroyed: lost.destroyed, recovered: recovered.diagnostic,
          rows: recovered.rows, memory: recovered.testWasmBytes, tail: lossTail, corners: await corners(cornerImage) };
      }
      return { warm: warm.diagnostic, catalog: { count: warm.count, sha256: warm.cards_sha256 }, records, diagnostics, memory: mainMemory, tail,
        cornerBefore: { quads: cornerBefore.quads, diagnostic: cornerBefore.diagnostic },
        cornerAfter: { quads: cornerAfter.quads, diagnostic: cornerAfter.diagnostic },
        gpuLoss, cspViolations, queries: records.length + repeats };
    } finally { worker.terminate(); }
  }, { sources, miloGpu, repeats, loseGpu });
}

function quadResult(value) {
  return { quads: value.quads, model: value.diagnostic?.model, status: value.diagnostic?.status,
    proposals: value.diagnostic?.proposals, probes: value.diagnostic?.probes };
}
function validateArm(arm, label) {
  assert.equal(arm.warm?.status, "ready", label + " warmup");
  assert.deepEqual(arm.catalog, result.catalog, label + " uses the current checksum-matched gallery");
  assert.ok(["wasm", "webgpu"].includes(arm.warm.backend), label + " must label its actual backend");
  assert.ok(arm.cornerBefore.quads.length > 0, "Detector isolation requires a real nonempty corner result");
  assert.deepEqual(quadResult(arm.cornerAfter), quadResult(arm.cornerBefore), label + " Milo must not change the original CPU corner detector");
  for (const record of arm.records) {
    assert.equal(record.diagnostic?.status, "ready");
    record.got = cards[record.rows[0]?.row]?.[0]; record.ok = record.got === record.name;
    assert.equal(record.got, record.name, label + " new face " + record.name);
    assert.ok(record.rows.length >= 6 && record.rows.length <= 12, label + " bounded printing shortlist");
    assert.equal(new Set(record.rows.map(row => row.row)).size, record.rows.length, "printing rows remain unique");
    const counts = new Map();
    for (const { row, score } of record.rows) {
      assert.ok(Number.isInteger(row) && cards[row] && Number.isFinite(score), "valid scored catalog row");
      const name = cards[row][0]; counts.set(name, (counts.get(name) || 0) + 1);
    }
    assert.equal(counts.size, 6, "retain six distinct identities");
    assert.ok([...counts.values()].every(count => count <= 2), "at most two printings per identity");
    assert.equal(record.diagnostic.backend, arm.warm.backend);
    assert.equal(record.diagnostic.gpuRecovered, false);
  }
  assert.ok(arm.memory[0]?.length > 0, "WASM allocations must actually be observable");
  assert.deepEqual(arm.memory.at(-1), arm.memory[1], label + " allocations must plateau after model warmup");
  assert.ok(arm.tail.every(snapshot => JSON.stringify(snapshot) === JSON.stringify(arm.tail[0])), label + " alternating queries must not grow retained WASM");
  assert.deepEqual(arm.cspViolations, [], label + " worker CSP");
}
const rows = record => record.rows.map(entry => entry.row);
try {
  // Download each public reference once; both engines receive identical JPEG
  // bytes, even if the CDN changes an image during this test.
  const setup = await contextFor(), page = await setup.context.newPage();
  page.on("pageerror", error => result.errors.push(String(error)));
  const response = await page.goto(origin + "/snaptest?aiCrop=0&milo=0");
  assert.equal(response.headers()["content-security-policy"], csp);
  result.capability = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return { gpu: !!navigator.gpu, adapter: !!adapter, fallback: !!(adapter?.isFallbackAdapter || adapter?.info?.isFallbackAdapter) };
  });
  const publicCases = inputs.map(item => ({ name: item.name, id: item.id || item.scryfall_id, face: item.face || 0 }));
  const sources = await page.evaluate(async ({ inputs, control }) => {
    const fetchBytes = async source => {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error("reference unavailable");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
      let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
      return { ...source, sha256, base64: btoa(binary) };
    };
    const faces = [];
    for (const item of inputs) faces.push(await fetchBytes({ ...item, url: "https://cards.scryfall.io/normal/" + (item.face ? "back" : "front") + "/" + item.id[0] + "/" + item.id[1] + "/" + item.id + ".jpg" }));
    return { faces, corner: await fetchBytes({ name: control.name, point: control.point, url: "/snaptest/regressions/" + control.file }) };
  }, { inputs: publicCases, control });
  result.inputs = sources.faces.map(({ base64, ...source }) => source);
  await setup.context.close();

  for (const [name, miloGpu, blockGpu] of [["cpu", false, false], ["default", true, false], ["blockedGpu", true, true]]) {
    const fixture = await contextFor({ blockGpu }), page = await fixture.context.newPage();
    page.on("pageerror", error => result.errors.push(String(error)));
    try {
      await page.goto(origin + "/snaptest?aiCrop=0&milo=0");
      const arm = await workerArm(page, sources, miloGpu, 30, name === "default");
      arm.gpuReads = fixture.gpuReads; arm.blockedGpu = fixture.blockedGpu;
      result.arms[name] = arm; validateArm(arm, name);
      result.cspViolations.push(...await page.evaluate(() => window.__miloCspViolations));
      if (name !== "default") assert.equal(arm.warm.backend, "wasm", name + " must use CPU");
      if (name === "cpu") assert.deepEqual(fixture.gpuReads, [], "forced CPU never imports GPU assets");
      if (name === "blockedGpu" && result.capability.adapter && !result.capability.fallback) assert.ok(fixture.blockedGpu.length > 0, "GPU asset blocking must exercise the real initialization fallback");
      if (name === "default" && arm.warm.backend === "webgpu") {
        assert.ok(result.capability.adapter && !result.capability.fallback, "GPU adoption requires an actual hardware adapter");
        assert.ok(arm.gpuLoss.tested && arm.gpuLoss.destroyed > 0);
        assert.equal(arm.gpuLoss.recovered.backend, "wasm");
        assert.equal(arm.gpuLoss.recovered.gpuRecovered, true);
        assert.deepEqual(quadResult(arm.gpuLoss.corners), quadResult(arm.cornerBefore));
        assert.ok(arm.gpuLoss.tail.every(memory => JSON.stringify(memory) === JSON.stringify(arm.gpuLoss.tail[0])), "recovered CPU allocations stay bounded");
      }
    } finally { await fixture.context.close(); }
  }
  for (const name of ["default", "blockedGpu"]) {
    const arm = result.arms[name];
    for (let index = 0; index < arm.records.length; index++) {
      assert.deepEqual(rows(arm.records[index]), rows(result.arms.cpu.records[index]), name + " preserves the complete CPU row-index shortlist for " + arm.records[index].name);
      result.parity.push({ arm: name, name: arm.records[index].name, sha256: arm.records[index].sha256, rows: rows(arm.records[index]), equal: true });
    }
  }
  if (result.arms.default.gpuLoss.tested) assert.deepEqual(result.arms.default.gpuLoss.rows.map(r => r.row), rows(result.arms.cpu.records[0]), "GPU loss retries the exact same query on CPU");
  result.gpuTested = result.arms.default.warm.backend === "webgpu";
  result.defaultBackend = result.arms.default.warm.backend;
  result.gpuFallback = result.gpuTested ? null : { labeled: true, backend: "wasm", hardwareAvailable: result.capability.adapter && !result.capability.fallback,
    note: "GPU was not adopted; these rows establish CPU fallback, not GPU parity." };
  // Preserve the existing missing-catalog regression through the actual app.
  const fallback = await contextFor({ blockCatalog: true }), failed = await fallback.context.newPage();
  failed.on("pageerror", error => result.errors.push(String(error)));
  try {
    await failed.goto(origin + "/snaptest");
    await failed.waitForFunction(() => window.__SNAP_RECOGNITION_WARMUP?.status === "ready", null, { timeout: 90000 });
    await failed.waitForFunction(() => window.__SNAP_MILO_WARMUP?.status && window.__SNAP_MILO_WARMUP.status !== "loading", null, { timeout: 90000 });
    result.fallback = await failed.evaluate(() => ({ lookup: window.__SNAP_MILO_WARMUP, recognition: window.__SNAP_RECOGNITION_WARMUP }));
    assert.notEqual(result.fallback.lookup?.status, "ready", "missing catalog cannot be ready");
    result.fallback.scan = await failed.evaluate(async control => {
      const r = await window.__scIdentifyUrl("/snaptest/regressions/" + control.file, control.point);
      return { got: r.matches[0]?.name, ok: r.matches[0]?.name === control.name, crop: r.ai_crop, lookup: r.milo };
    }, control);
    assert.ok(result.fallback.scan.ok && result.fallback.scan.crop?.status === "ready", "missing Milo preserves corner detection and established recognition");
    result.cspViolations.push(...await failed.evaluate(() => window.__miloCspViolations));
  } finally { await fallback.context.close(); }
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.cspViolations, []);
  assert.deepEqual(result.blockedWrites, []);
  result.records = result.arms.default.records; result.memory = result.arms.default.memory;
  result.warm = result.arms.default.warm; result.queries = result.arms.default.queries;
  result.ok = true;
} catch (error) {
  result.ok = false; result.failure = { message: String(error.message || error), stack: String(error.stack || "") };
  throw error;
} finally {
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  await browser.close();
}
console.log(JSON.stringify({ newFaces: result.records.length, parity: result.parity.length, gpuTested: result.gpuTested,
  backend: result.defaultBackend, memory: result.memory[1], recovered: result.arms.default.gpuLoss.recovered,
  blockedGpu: result.arms.blockedGpu.blockedGpu.length, fallback: result.fallback, ok: result.ok }));
