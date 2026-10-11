#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { chromium } from "playwright";

const staleCamera = "snapcast-test-camera-no-longer-connected";
const staleMicrophone = "snapcast-test-microphone-no-longer-connected";
const fixture = JSON.parse(await readFile("scripts/fixtures/accessibility-mock-data.json", "utf8"));
fixture.account.preferences.preferred_camera_id = staleCamera;
fixture.account.preferences.preferred_microphone_id = staleMicrophone;
const output = path.resolve(process.env.SNAPCAST_MEDIA_SETUP_OUTPUT || ".cache/media-setup");
await mkdir(output, { recursive: true });
const report = { ok: false, passed: [], errors: [], blockedWrites: [], scenarios: [], limitations: ["Chrome fake media devices exercise native constraints and real tracks without accessing physical hardware.", "Only setup previews are exercised; no public room is created and no production service writes are allowed."] };
let server;
let browser;
let activePage;
try {
  let base = process.env.SNAPCAST_MEDIA_SETUP_URL;
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
  assert.ok(["localhost", "127.0.0.1", "[::1]", "::1"].includes(origin.hostname), "Media test refuses non-loopback URLs");
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch { /* preview starting */ }
    if (attempt === 99) throw new Error("Compiled loopback preview did not start.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    ...(process.env.SNAPCAST_CHROME_PATH ? { executablePath: process.env.SNAPCAST_CHROME_PATH } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15_000);
  await context.grantPermissions(["camera", "microphone"], { origin: origin.origin });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin.origin && url.pathname === "/mock-data.local.json") return route.fulfill({ json: fixture });
    if (/\.supabase\.(co|net)$/.test(url.hostname) || /^\/api\/(turn-credentials|account-delete|decks|commanders|maintenance)/.test(url.pathname) || !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      report.blockedWrites.push({ method: request.method(), path: `${url.origin}${url.pathname}` });
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  await context.addInitScript(() => {
    localStorage.setItem("sc-name", "Zach");
    window.__scNativeMediaRequests = [];
    window.__scNativeMediaStreams = [];
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const request = { constraints: structuredClone(constraints) };
      window.__scNativeMediaRequests.push(request);
      try {
        const stream = await nativeGetUserMedia(constraints);
        window.__scNativeMediaStreams.push(stream);
        request.tracks = stream.getTracks().map((track) => ({ kind: track.kind, label: track.label, settings: track.getSettings(), readyState: track.readyState }));
        return stream;
      } catch (error) {
        request.error = { name: error.name, constraint: error.constraint, message: error.message };
        throw error;
      }
    };
  });
  const newPage = async () => {
    const page = await context.newPage();
    activePage = page;
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator(".site-account-button").filter({ hasText: "Zach" }).waitFor();
    return page;
  };
  const selectedDevice = async (page, label, track) => {
    assert.ok(track.settings.deviceId && ![staleCamera, staleMicrophone].includes(track.settings.deviceId), `${label} must resolve a real fake-device ID`);
    const deviceLabel = await page.evaluate(async ({ kind, id }) => (await navigator.mediaDevices.enumerateDevices()).find((device) => device.kind === kind && device.deviceId === id)?.label, { kind: `${track.kind}input`, id: track.settings.deviceId });
    assert.ok(deviceLabel, `${label} track must correspond to an enumerated device`);
    await page.getByRole("button", { name: label, exact: true }).click();
    const selected = page.getByRole("listbox", { name: label, exact: true }).locator('[role="option"][aria-selected="true"]');
    assert.equal(await selected.count(), 1, `${label} selector must hold the resolved device ID`);
    assert.equal((await selected.innerText()).trim(), deviceLabel);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("listbox", { name: label, exact: true }).count(), 0);
    assert.equal(await page.getByRole("dialog").count(), 1, "Escape from a device picker must leave setup open");
  };
  const captureScenario = async (page, label) => {
    const requests = await page.evaluate(() => window.__scNativeMediaRequests);
    report.scenarios.push({ label, requests });
    assert.ok(requests.length >= 2 && requests.length <= 5, `${label} must use a bounded native constraints retry`);
    assert.equal(requests[0].error?.name, "OverconstrainedError", `${label} must reproduce the native stale-device error`);
    assert.equal(requests[0].constraints.audio.deviceId.exact, staleMicrophone);
    assert.equal(await page.locator(".media-error").count(), 0, `${label} must recover without showing a media error`);
    const success = requests.findLast((request) => request.tracks?.length);
    assert.ok(success, `${label} must obtain native media tracks after recovery`);
    assert.ok(success.tracks.every((track) => track.readyState === "live"));
    return { requests, success };
  };

  const playerPage = await newPage();
  await playerPage.getByRole("button", { name: "Make game", exact: true }).click();
  await playerPage.getByPlaceholder("Friday night Commander", { exact: true }).fill("Stale-device setup test");
  await playerPage.getByRole("dialog").getByRole("button", { name: "Create game", exact: true }).click();
  await playerPage.waitForFunction(() => document.querySelector(".media-preview video")?.videoWidth > 0, null, { timeout: 15_000 });
  const player = await captureScenario(playerPage, "Player create setup");
  assert.equal(player.requests[0].constraints.video.deviceId.exact, staleCamera);
  assert.deepEqual(player.success.tracks.map((track) => track.kind).sort(), ["audio", "video"]);
  await selectedDevice(playerPage, "Camera", player.success.tracks.find((track) => track.kind === "video"));
  await selectedDevice(playerPage, "Microphone", player.success.tracks.find((track) => track.kind === "audio"));
  await playerPage.screenshot({ path: path.join(output, "player-preview-ready.png"), fullPage: true });
  await playerPage.getByRole("button", { name: "Back", exact: true }).click();
  assert.equal(await playerPage.evaluate(() => window.__scNativeMediaStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended"))), true);
  report.passed.push("Player setup reproduces native stale camera/microphone failure, recovers decoded preview and resolved selectors, and stops tracks on Back");
  await playerPage.close();

  const visitorPage = await newPage();
  await visitorPage.locator(".home-header-join").click();
  await visitorPage.getByRole("textbox", { name: "Six-character game code", exact: true }).fill("NOPE01");
  await visitorPage.getByRole("button", { name: /^Visitor/ }).click();
  await visitorPage.getByRole("button", { name: "Continue", exact: true }).click();
  await visitorPage.waitForFunction(() => window.__scNativeMediaRequests.some((request) => request.tracks?.length), null, { timeout: 15_000 });
  const visitor = await captureScenario(visitorPage, "Visitor audio-only setup");
  assert.ok(visitor.requests.every((request) => request.constraints.video === false));
  assert.deepEqual(visitor.success.tracks.map((track) => track.kind), ["audio"]);
  assert.equal(await visitorPage.getByRole("button", { name: "Camera", exact: true }).count(), 0);
  await selectedDevice(visitorPage, "Microphone", visitor.success.tracks[0]);
  await visitorPage.screenshot({ path: path.join(output, "visitor-audio-ready.png"), fullPage: true });
  await visitorPage.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await visitorPage.evaluate(() => window.__scNativeMediaStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended"))), true);
  report.passed.push("Visitor setup recovers a stale microphone without requesting video and stops tracks on Cancel");
  assert.deepEqual(report.blockedWrites, [], "Media setup must never attempt production service writes");
  assert.deepEqual(report.errors, [], "Media setup must not produce uncaught JavaScript errors");
  report.ok = true;
  process.stdout.write(`Native media setup passed: ${report.passed.length} scenarios, stale exact IDs reproduce OverconstrainedError, real fake tracks and resolved selectors recover.\n`);
} catch (error) {
  report.failure = error.stack || String(error);
  if (activePage && !activePage.isClosed()) {
    report.failureView = await activePage.locator("body").innerText().catch(() => "");
    report.failureRequests = await activePage.evaluate(() => window.__scNativeMediaRequests).catch(() => []);
    await activePage.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  server?.kill("SIGTERM");
  process.stdout.write(`Native media setup report: ${path.join(output, "report.json")}\n`);
}
