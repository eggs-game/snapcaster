#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import { createFourPlayerFixture } from "./fixtures/four_player_simulation.mjs";

const fixture = createFourPlayerFixture(JSON.parse(await readFile("scripts/fixtures/accessibility-mock-data.json", "utf8")));
const firstCard = fixture.games[0].mock_simulation.cards[0];
assert.equal(firstCard.name, "Contagion");
const reportDir = path.resolve(process.env.SNAPCAST_GAME_CARD_OUTPUT || ".cache/game-card-delivery");
await mkdir(reportDir, { recursive: true });
const report = { ok: false, errors: [], blockedWrites: [], lookups: [], screenshots: [], limitations: ["Recognition, worker reference previews, Game state and the rendered sidebar are real compiled application code.", "Three opponents and remote capture are simulated: direct canvas JPEG capture has no native three-frame sampling, WebRTC RTT, TURN or physical-camera delay.", "Models/index are warmed before the first click. DOM normal-size image requests are deliberately delayed 750 ms to verify the preview appears independently.", "Two lookups of one supplied card verify delivery and verified room hints; this is not a 200-card accuracy or latency benchmark."] };
let server;
let browser;
let page;
try {
  let base = process.env.SNAPCAST_GAME_CARD_URL;
  if (!base) {
    const port = await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.on("error", reject);
      probe.listen(0, "127.0.0.1", () => { const value = probe.address().port; probe.close(() => resolve(value)); });
    });
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore" });
  }
  const origin = new URL(base);
  assert.ok(["localhost", "127.0.0.1", "[::1]", "::1"].includes(origin.hostname), "Card delivery test refuses non-loopback URLs");
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch { /* compiled preview starting */ }
    if (attempt === 99) throw new Error("Compiled preview did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.SNAPCAST_CHROME_PATH ? { executablePath: process.env.SNAPCAST_CHROME_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  context.setDefaultTimeout(20_000);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin.origin && url.pathname === "/mock-data.local.json") return route.fulfill({ json: fixture });
    if (/\.supabase\.(co|net)$/.test(url.hostname) || /^\/api\/(turn-credentials|account-delete|decks|commanders|maintenance)/.test(url.pathname) || !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      report.blockedWrites.push({ method: request.method(), path: `${url.origin}${url.pathname}` });
      return route.abort("blockedbyclient");
    }
    // Worker reference fetches remain untouched. Slow only the DOM's larger
    // image so a ready reference preview must paint before that request returns.
    if (request.resourceType() === "image" && url.hostname === "cards.scryfall.io" && url.pathname.startsWith("/normal/")) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    return route.continue();
  });
  await context.addInitScript(() => {
    localStorage.setItem("sc-name", "Zach");
    localStorage.setItem("theme-preference", "dark");
    localStorage.setItem("snapcast-video-layout", "tiles");
    window.__scDeliverySamples = [];
    window.__scDeliveryWorkerResults = [];
    let activeSample = null;
    let timingValues = [];
    Object.defineProperty(window, "__SNAP_RECOGNITION_TIMINGS", {
      configurable: true,
      get: () => timingValues,
      set: (values) => {
        timingValues = values;
        if (activeSample && values.at(-1)) {
          activeSample.resultAt = performance.now();
          activeSample.timing = { ...values.at(-1) };
        }
      },
    });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        if (!String(args[0]).includes("recognizer")) return;
        this.addEventListener("message", (event) => {
          const result = event.data;
          if (!Array.isArray(result?.matches) || !result.matches.length) return;
          window.__scDeliveryWorkerResults.push({ at: performance.now(), id: result.id, matches: result.matches.slice(0, 8), referencePreview: result.referencePreview || null, hintHit: !!result.hintHit });
          window.__scDeliveryWorkerResults = window.__scDeliveryWorkerResults.slice(-20);
        });
      }
    };
    document.addEventListener("click", (event) => {
      if (!event.target.closest?.(".tile .video-wrap")) return;
      activeSample = { clickAt: performance.now(), images: [] };
      window.__scDeliverySamples.push(activeSample);
    }, true);
    document.addEventListener("load", (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.closest(".card-hit-image") || !activeSample?.resultAt) return;
      const sample = activeSample;
      const kind = image.classList.contains("card-result-preview") ? "preview" : "normal";
      const src = image.currentSrc || image.src;
      const loadedAt = performance.now();
      image.decode().then(() => requestAnimationFrame(() => {
        const effectiveOpacity = () => {
          let opacity = 1;
          for (let node = image; node instanceof Element; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        };
        const record = { kind, src, loadedAt, decodedAt: performance.now(), width: image.naturalWidth, height: image.naturalHeight, connected: image.isConnected, effectiveOpacityAtDecode: effectiveOpacity() };
        sample.images.push(record);
        const visible = () => {
          if (!image.isConnected) return;
          if (effectiveOpacity() >= 0.99) { record.fullyVisibleAt = performance.now(); return; }
          if (performance.now() - record.decodedAt < 4000) requestAnimationFrame(visible);
        };
        visible();
      })).catch(() => {});
    }, true);
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver(() => {
        if (!activeSample?.resultAt || activeSample.titleAt) return;
        const title = document.querySelector(".card-hit .card-meta > b")?.textContent;
        if (title) { activeSample.title = title; activeSample.titleAt = performance.now(); }
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }, { once: true });
  });
  page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.goto(`${base}/?code=TEST04`, { waitUntil: "domcontentloaded" });
  const join = page.getByRole("button", { name: "Join game", exact: true });
  const next = page.getByRole("button", { name: "Continue", exact: true });
  await next.or(join).first().waitFor();
  if (await next.isVisible()) await next.click();
  await join.click();
  await page.getByRole("button", { name: "Open settings", exact: true }).waitFor();
  await page.waitForFunction(() => window.__scLocalGame?.snapshot().roster.length === 4 && [...document.querySelectorAll(".tile video")].every((video) => video.videoWidth > 0));
  await page.waitForFunction(() => ["ready", "failed"].includes(window.__SNAP_RECOGNITION_WARMUP?.status), null, { timeout: 120_000 });
  report.warmup = await page.evaluate(() => ({ core: window.__SNAP_RECOGNITION_WARMUP, milo: window.__SNAP_MILO_WARMUP, build: window.__SNAP_BUILD }));
  assert.equal(report.warmup.core.status, "ready", "Actual recognition core must be warm before measuring card delivery");
  const mayaVideo = page.locator(".tile").filter({ has: page.getByText("Maya", { exact: true }) }).locator("video");
  const clickCard = async () => {
    const point = await mayaVideo.evaluate((video, card) => {
      const rect = video.getBoundingClientRect();
      const scale = getComputedStyle(video).objectFit === "contain" ? Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight) : Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
      return { x: rect.x + (rect.width - video.videoWidth * scale) / 2 + card.x / 1280 * video.videoWidth * scale, y: rect.y + (rect.height - video.videoHeight * scale) / 2 + card.y / 720 * video.videoHeight * scale, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }, firstCard);
    assert.ok(point.x > point.rect.x && point.x < point.rect.x + point.rect.width && point.y > point.rect.y && point.y < point.rect.y + point.rect.height, "Contagion center must be visible for a genuine pointer click");
    await page.mouse.click(point.x, point.y);
  };
  const inspectLookup = async (number) => {
    await page.waitForFunction((count) => window.__scDeliverySamples.length === count && window.__scDeliverySamples.at(-1)?.timing && window.__scDeliverySamples.at(-1)?.images.some((image) => image.kind === "preview" && image.width > 0 && image.fullyVisibleAt), number, { timeout: 60_000 });
    await page.getByRole("button", { name: `Expand ${firstCard.name}`, exact: true }).waitFor();
    assert.equal(await page.locator(".card-hit .card-meta > b").innerText(), firstCard.name);
    const inspection = await page.evaluate(async () => {
      const sample = window.__scDeliverySamples.at(-1);
      const preview = document.querySelector(".card-hit-image .card-result-preview");
      const normal = document.querySelector(".card-hit-image .card-result-normal");
      const record = window.__scDeliveryWorkerResults.findLast((value) => value.at >= sample.clickAt && value.matches.some((match) => match.image === normal.src));
      const winner = record?.matches.find((match) => match.image === normal.src);
      const reference = record?.referencePreview;
      const digest = async (blob) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const source = preview?.currentSrc || preview?.src;
      const exactReference = source?.startsWith("blob:") ? {
        kind: "cached-worker-reference",
        id: reference?.scryfall_id,
        face: reference?.face || 0,
        referenceHash: reference?.blob instanceof Blob ? await digest(reference.blob) : null,
        renderedHash: await digest(await (await fetch(source)).blob()),
      } : { kind: "exact-printing-small-url", src: source, expected: winner?.image?.replace("/normal/", "/small/") };
      const decoded = sample.images.find((image) => image.kind === "preview");
      return { title: document.querySelector(".card-hit .card-meta > b")?.textContent, winner, timing: sample.timing, exactReference, preview: { src: source, width: preview?.naturalWidth, height: preview?.naturalHeight }, milliseconds: { capture: sample.timing.captureMs, recognition: sample.timing.recognitionMs, clickToTitle: Math.round(sample.titleAt - sample.clickAt), recognitionToPreviewDecode: Math.round(decoded.decodedAt - sample.resultAt), recognitionToPreviewFullyVisible: Math.round(decoded.fullyVisibleAt - sample.resultAt), clickToPreviewDecode: Math.round(decoded.decodedAt - sample.clickAt), clickToPreviewFullyVisible: Math.round(decoded.fullyVisibleAt - sample.clickAt) }, images: sample.images };
    });
    assert.equal(inspection.winner?.name, firstCard.name, "Displayed card must be the actual worker winner");
    assert.ok(inspection.preview.width > 0 && inspection.preview.height > 0, "The displayed preview must decode real image pixels");
    const decodedPreview = inspection.images.find((image) => image.kind === "preview");
    assert.equal(decodedPreview.effectiveOpacityAtDecode, 1, "The first decoded reference frame must appear at full opacity through every ancestor");
    if (inspection.exactReference.kind === "cached-worker-reference") {
      assert.equal(inspection.exactReference.id, inspection.winner.scryfall_id);
      assert.equal(inspection.exactReference.face, inspection.winner.face || 0);
      assert.ok(inspection.exactReference.referenceHash);
      assert.equal(inspection.exactReference.renderedHash, inspection.exactReference.referenceHash, "Rendered preview bytes must be the worker's exact winning reference");
    } else {
      assert.equal(inspection.exactReference.src, inspection.exactReference.expected, "Fallback preview must use the winning printing/face URL");
    }
    report.lookups.push(inspection);
    const screenshot = `lookup-${number}-contagion.png`;
    await page.screenshot({ path: path.join(reportDir, screenshot), fullPage: true });
    report.screenshots.push(screenshot);
    process.stdout.write(`Card delivery ${number}: ${JSON.stringify(inspection.milliseconds)}, hint=${inspection.timing.hintHit}, preview=${inspection.exactReference.kind}\n`);
  };
  await clickCard();
  await inspectLookup(1);
  assert.equal(report.lookups[0].timing.remote, true);
  assert.ok(await page.evaluate(() => window.__scLocalGame.snapshot().events.some((event) => event.type === "outgoing-recognition-hint" && event.hint?.ownerId === "mock-maya" && event.hint?.card?.name === "Contagion")), "The first verified result must publish a room hint");
  await page.waitForFunction(() => !window.__SNAP_RECOGNITION_QUEUE?.active);
  await clickCard();
  await inspectLookup(2);
  assert.equal(report.lookups[1].timing.hintHit, true, "A repeat click must verify and use the real nearby room hint");
  assert.equal(report.lookups[1].winner.scryfall_id, report.lookups[0].winner.scryfall_id, "Verified repeat lookup must retain the same winning printing");
  assert.deepEqual(report.blockedWrites, [], "Practice card lookup must never attempt production writes");
  assert.deepEqual(report.errors, [], "Card delivery must not produce uncaught JavaScript errors");
  report.ok = true;
  process.stdout.write("Compiled Game card delivery passed: real Contagion result, exact decoded reference preview and verified repeat hint.\n");
} catch (error) {
  report.failure = error.stack || String(error);
  if (page) {
    report.failureView = await page.locator("body").innerText().catch(() => "");
    report.failureState = await page.evaluate(() => ({ warmup: window.__SNAP_RECOGNITION_WARMUP, timing: window.__SNAP_RECOGNITION_TIMINGS, samples: window.__scDeliverySamples, workerResults: window.__scDeliveryWorkerResults.map((value) => ({ ...value, referencePreview: value.referencePreview ? { scryfall_id: value.referencePreview.scryfall_id, face: value.referencePreview.face, bytes: value.referencePreview.blob?.size } : null })) })).catch(() => null);
    await page.screenshot({ path: path.join(reportDir, "failure.png"), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(path.join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  server?.kill("SIGTERM");
  process.stdout.write(`Card delivery report: ${path.join(reportDir, "report.json")}\n`);
}
