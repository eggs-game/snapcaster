#!/usr/bin/env node
// Serve existing frozen compiled native Game bundles. The source camera and
// signaling are test adapters; Game, capture sampling, RTC and matching are real.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flags = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const output = path.resolve(flags.output || path.join(root, ".cache/native-valid-hints"));
const fixture = path.resolve(flags.sceneFixtures || path.join(root, ".cache/native-delivery-control/scenes"));
const sourceProofPath = path.resolve(flags.sourceProof || path.join(root, ".cache/native-delivery-opaque-control/report.json"));
const sourceProof = JSON.parse(await readFile(sourceProofPath, "utf8"));
const allowHintMiss = flags.allowHintMiss === "1";
// These four source cards hit the frozen control's existing verified-hint
// tiers. Overlapped Voja was tried separately and misses those control tiers;
// retain that case as fallback evidence rather than a positive fast-hint test.
const indices = (flags.indices || "0,6,24,79").split(",").map(Number);
const cases = indices.map(index => sourceProof.rows[index]);
assert.ok(cases.every(row => row?.fresh.correct), "Only predeclared correctly recognized source cards can test valid hints");
const report = { ok: false, sourceProofPath, sceneFixtures: fixture, scope: allowHintMiss ? "same-card stored-hint miss retains complete learned fallback" : "verified fast-hint positive controls", cases: cases.map(({ scene, index, name, rotation, coverage, layout }) => ({ scene, index, name, rotation, coverage, layout })), arms: {}, errors: [], blockedWrites: [], limitations: [
  "Warmed actual compiled Game pointer clicks, native three-frame production JPEG capture, native loopback RTC and real matcher/sidebar. Source media and signaling are simulated; no physical devices, real room, STUN, TURN or production writes.",
  "Each arm runs in a separate private browser sequentially. Each card is clicked with hints cleared, then immediately repeated using the production Game's verified room hint. Models/index are warmed; initial reference downloads and physical screen scanout are not generalized from this small targeted set.",
] };
await mkdir(output, { recursive: true });
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".bin": "application/octet-stream", ".onnx": "application/octet-stream", ".wasm": "application/wasm" };

function timingHooks() {
  localStorage.setItem("theme-preference", "dark");
  localStorage.setItem("snapcast-video-layout", "follow");
  window.__nativeSamples = [];
  let sample = null, timings = [];
  Object.defineProperty(window, "__SNAP_RECOGNITION_TIMINGS", { configurable: true, get: () => timings, set(values) {
    timings = values;
    if (sample && values.at(-1)) { sample.resultAt = performance.now(); sample.timing = values.at(-1); }
  } });
  document.addEventListener("click", event => {
    if (event.target.closest?.(".tile .video-wrap")) {
      sample = { at: performance.now(), images: [] };
      window.__nativeSamples.push(sample);
    }
  }, true);
  const inspect = async image => {
    if (!(image instanceof HTMLImageElement) || !image.closest(".card-hit-image") || !sample) return;
    const active = sample, src = image.currentSrc || image.src;
    if (active.images.some(value => value.src === src)) return;
    try { await image.decode(); } catch { return; }
    if (sample !== active || !image.isConnected) return;
    let opacity = 1;
    for (let node = image; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    const record = { src, kind: image.classList.contains("card-result-preview") ? "preview" : "normal", decodedAt: performance.now(), width: image.naturalWidth, height: image.naturalHeight, opacity };
    active.images.push(record);
    await new Promise(requestAnimationFrame);
    if (image.isConnected && opacity === 1) record.paintAt = performance.now();
  };
  document.addEventListener("load", event => inspect(event.target), true);
  document.addEventListener("DOMContentLoaded", () => new MutationObserver(() => {
    if (sample?.resultAt && !sample.titleAt && document.querySelector(".card-hit .card-meta > b")) sample.titleAt = performance.now();
    for (const image of document.querySelectorAll(".card-hit-image img")) if (image.complete && image.naturalWidth) inspect(image);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true }), { once: true });
}

async function runArm(name, directory) {
  const compiled = path.resolve(directory);
  const metadata = JSON.parse(await readFile(path.join(compiled, "../report.json"), "utf8"));
  assert.equal(metadata.ok, true, "Use a completed frozen native benchmark bundle");
  assert.deepEqual(metadata.catalogDigests, sourceProof.catalogDigests);
  const arm = report.arms[name] = { build: metadata.build, sourceDigests: metadata.sourceDigests, catalogDigests: metadata.catalogDigests, rows: [] };
  for (const [file, sha] of Object.entries(metadata.catalogDigests)) assert.equal(createHash("sha256").update(await readFile(path.join(root, file))).digest("hex"), sha);
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
      assert.ok(!pathname.includes(".."));
      let file = /^\/__native-scene-fixture\/(manifest\.json|\d{2}\.png)$/.test(pathname)
        ? path.join(fixture, path.basename(pathname)) : path.join(compiled, pathname === "/" ? "index.html" : pathname);
      try { await stat(file); } catch { file = path.join(root, "public", pathname); }
      res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
      res.end(await readFile(file));
    } catch { res.statusCode = 404; res.end("Not found"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: flags.chrome || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
    const context = await browser.newContext({ viewport: { width: 1920, height: 900 } });
    await context.grantPermissions(["camera", "microphone"], { origin: base });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (/\.supabase\.(co|net)$/.test(url.hostname) || url.pathname.startsWith("/api/") || !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        report.blockedWrites.push({ arm: name, method: request.method(), url: `${url.origin}${url.pathname}` });
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    await context.addInitScript(timingHooks);
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push({ arm: name, error: error.message }));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__nativeViewer?.peers.get("native-source")?.dc?.readyState === "open" && document.querySelector(".tile video")?.videoWidth === 1920, null, { timeout: 30000 });
    await page.waitForFunction(() => window.__SNAP_RECOGNITION_WARMUP?.status === "ready" && window.__SNAP_MILO_WARMUP?.status === "ready", null, { timeout: 120000 });
    for (const item of cases) {
      await page.evaluate(scene => window.__nativeSetScene(scene), item.scene);
      await page.waitForTimeout(180);
      await page.evaluate(() => window.__nativeClearHints());
      const row = { name: item.name, scene: item.scene, index: item.index, rotation: item.rotation };
      arm.rows.push(row);
      for (const mode of ["fresh", "repeat"]) {
        await page.waitForFunction(() => { const p = window.__nativeOwner.peers.get("native-viewer"); return Math.min(4, (p.capTokens ?? 4) + (Date.now() - (p.capTokensAt || 0)) / 1200) >= 1.02; }, null, { timeout: 15000 });
        const before = await page.evaluate(() => window.__nativeSamples.length);
        const hintsBefore = await page.evaluate(() => window.__nativeReadHints());
        const point = await page.locator(".tile video").evaluate((video, p) => {
          const r = video.getBoundingClientRect(), scale = getComputedStyle(video).objectFit === "contain" ? Math.min(r.width / video.videoWidth, r.height / video.videoHeight) : Math.max(r.width / video.videoWidth, r.height / video.videoHeight);
          const x = (r.width - video.videoWidth * scale) / 2 + p.nx * video.videoWidth * scale, y = (r.height - video.videoHeight * scale) / 2 + p.ny * video.videoHeight * scale;
          return { x: r.left + x, y: r.top + y, visible: x >= 0 && x <= r.width && y >= 0 && y <= r.height };
        }, item);
        assert.equal(point.visible, true, "Actual rendered card point must be visible");
        await page.mouse.click(point.x, point.y);
        await page.waitForFunction(n => window.__nativeSamples.length === n + 1 && window.__nativeSamples.at(-1)?.timing && window.__nativeSamples.at(-1).images.some(image => image.paintAt), before, { timeout: 90000 });
        row[mode] = await page.evaluate(() => {
          const s = window.__nativeSamples.at(-1), image = s.images.find(v => v.kind === "preview" && v.paintAt) || s.images.find(v => v.paintAt);
          const hit = document.querySelector(".card-hit"), normal = hit?.querySelector(".card-result-normal"), data = window.__nativeMatcherData;
          const winner = data?.at >= s.at ? data.matches?.find(value => value.image === normal?.src) : null;
          const capture = { ...window.__nativeCaptureRecords.at(-1) }; delete capture.jpegBase64;
          return { got: hit?.querySelector(".card-meta > b")?.textContent, by: winner?.identified_by, confidence: winner?.confidence, winner: winner ? { id: winner.scryfall_id, face: winner.face || 0 } : null, aiCrop: data?.ai_crop, timing: s.timing, capture, displayMs: Math.round(image.paintAt - s.at), previewMs: Math.round(image.paintAt - s.resultAt), image: { width: image.width, height: image.height, opacity: image.opacity, kind: image.kind }, hints: window.__nativeReadHints(), identifyHints: window.__nativeIdentifyHints };
        });
        row[mode].hintsBefore = hintsBefore;
        assert.equal(row[mode].got, item.name);
        assert.equal(row[mode].capture.sha256, item.fresh.capture.sha256);
        assert.deepEqual(row[mode].capture.geometry, item.fresh.capture.geometry);
        assert.equal(row[mode].image.opacity, 1);
        if (mode === "fresh") assert.equal(row[mode].timing.hintHit, false);
        else {
          assert.ok(hintsBefore.some(hint => hint.card?.scryfall_id === row.fresh.winner.id && hint.card?.face === row.fresh.winner.face), "Repeat must start with its actual verified printing/face hint");
          assert.ok(row[mode].identifyHints.some(hint => hint.scryfall_id === row.fresh.winner.id && hint.face === row.fresh.winner.face), "The real Game lookup must receive that verified hint");
          if (!allowHintMiss) assert.equal(row[mode].timing.hintHit, true, "Repeated positive controls must use the verified hint");
        }
        console.log(`${name} ${item.name} ${mode}: ${row[mode].displayMs} ms; hint ${row[mode].timing.hintHit}`);
      }
      if (!allowHintMiss) assert.equal(row.repeat.winner.id, row.fresh.winner.id);
      assert.equal(row.repeat.winner.face, row.fresh.winner.face);
    }
    arm.nativeErrors = await page.evaluate(() => window.__nativeErrors);
    assert.deepEqual(arm.nativeErrors, []);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  }
}
try {
  await runArm("control", flags.control || path.join(root, ".cache/stale-hints/native-20/compiled"));
  await runArm("candidate", flags.candidate || path.join(root, ".cache/stale-hints/native-34/compiled"));
  for (let index = 0; index < cases.length; index++) {
    const a = report.arms.control.rows[index].repeat, b = report.arms.candidate.rows[index].repeat;
    assert.deepEqual(b.winner, a.winner);
    assert.equal(b.by, a.by);
    assert.equal(b.confidence, a.confidence);
    assert.equal(b.capture.sha256, a.capture.sha256);
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blockedWrites, []);
  const p50 = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  report.summary = Object.fromEntries(Object.entries(report.arms).map(([name, arm]) => [name, { n: arm.rows.length, correct: arm.rows.length, hintHits: arm.rows.filter(row => row.repeat.timing.hintHit).length, repeatDisplayP50: p50(arm.rows.map(row => row.repeat.displayMs)), repeatRecognitionP50: p50(arm.rows.map(row => row.repeat.timing.recognitionMs)), repeatUnder1s: arm.rows.filter(row => row.repeat.displayMs < 1000).length }]));
  report.ok = true;
  console.log(JSON.stringify(report.summary));
} catch (error) { report.failure = error.stack || String(error); throw error; }
finally { await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
