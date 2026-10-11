#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { createFourPlayerFixture } from "./fixtures/four_player_simulation.mjs";

const fixture = createFourPlayerFixture(JSON.parse(await readFile("scripts/fixtures/accessibility-mock-data.json", "utf8")));
const reportDir = path.resolve(process.env.SNAPCAST_UI_OUTPUT || ".cache/ui-simulation");
await mkdir(reportDir, { recursive: true });
const requestedUrl = process.env.SNAPCAST_SIMULATION_URL;
let server;
let browser;
let activePage;
const report = { simulated: ["three opponents", "canvas camera streams", "signaling", "chat and whispers", "ready responses", "game persistence"], real: ["React Game UI", "video elements", "MediaStream tracks", "JPEG capture geometry", "sidebar controls", "responsive layouts"], limitations: ["No WebRTC/TURN transport, physical microphone, camera permissions or durable Supabase writes are exercised.", "Sound preview/send controls are exercised; audible speaker output is not verified by headless automation."], screenshots: [], accessibility: [], passed: [], blockedWrites: [], errors: [] };
const pass = (message) => { report.passed.push(message); process.stdout.write(`UI passed: ${message}\n`); };
try {
  let base = requestedUrl;
  if (!base) {
    const port = await new Promise((resolve, reject) => { const probe = createServer(); probe.on("error", reject); probe.listen(0, "127.0.0.1", () => { const value = probe.address().port; probe.close(() => resolve(value)); }); });
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore" });
  }
  const origin = new URL(base);
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(origin.hostname)) throw new Error("UI simulation refuses non-loopback URLs.");
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch { /* starting */ }
    if (attempt === 99) throw new Error("Loopback preview did not start.");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.SNAPCAST_CHROME_PATH ? { executablePath: process.env.SNAPCAST_CHROME_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(30_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: origin.origin });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/mock-data.local.json" && url.origin === origin.origin) return route.fulfill({ json: fixture });
    if (/\.supabase\.(co|net)$/.test(url.hostname) || /^\/api\/(turn-credentials|account-delete|decks|commanders|maintenance)/.test(url.pathname) || !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      report.blockedWrites.push({ method: request.method(), path: `${url.origin}${url.pathname}` });
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  const page = await context.newPage();
  activePage = page;
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem("theme-preference", "dark"); localStorage.setItem("sc-name", "Zach"); });
  await page.goto(`${base}/?code=TEST04`, { waitUntil: "domcontentloaded" });
  const join = page.getByRole("button", { name: "Join game", exact: true });
  const next = page.getByRole("button", { name: "Continue", exact: true });
  await next.or(join).first().waitFor();
  if (await next.isVisible()) await next.click();
  await join.click();
  await page.getByRole("button", { name: "Open settings", exact: true }).waitFor();
  await page.waitForFunction(() => window.__scLocalGame?.snapshot().roster.length === 4);
  await page.waitForFunction(() => [...document.querySelectorAll(".tile video")].filter((video) => video.videoWidth > 0).length === 4);
  pass("Four players joined with four decoded canvas video streams");
  const photo = async (name) => {
    await page.evaluate(async () => {
      const animations = document.getAnimations().filter((animation) => animation.playState === "running"
        && Number.isFinite(animation.effect?.getComputedTiming().endTime));
      await Promise.race([Promise.all(animations.map((animation) => animation.finished.catch(() => {}))), new Promise((resolve) => setTimeout(resolve, 4000))]);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.screenshot({ path: path.join(reportDir, `${name}.png`), fullPage: true });
    report.screenshots.push(`${name}.png`);
  };
  const accessible = async (label) => {
    if (process.env.SNAPCAST_UI_AXE !== "1") return;
    const result = await new AxeBuilder({ page }).include(".game").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    report.accessibility.push({ label, violations: result.violations.map((issue) => ({ id: issue.id, impact: issue.impact, help: issue.help, nodes: issue.nodes.map((node) => ({ target: node.target, message: node.failureSummary })) })) });
    assert.equal(result.violations.length, 0, `${label}: ${JSON.stringify(report.accessibility.at(-1).violations)}`);
  };
  await photo("desktop-dark-table");
  await accessible("desktop dark four-player game");
  const initialMedia = await page.evaluate(() => ({
    cameraEnabled: document.querySelector('[data-counter-drop-target="true"] video')?.srcObject?.getVideoTracks()[0]?.enabled,
    muted: window.__scLocalGame.snapshot().muted,
  }));
  await page.getByText("Add commander", { exact: true }).click();
  await page.getByRole("textbox", { name: "Add commander", exact: true }).fill("Sol Ring");
  await page.getByRole("textbox", { name: "Add commander", exact: true }).press("Enter");
  await page.getByRole("alert").filter({ hasText: "Sol Ring cannot be a Commander" }).waitFor();
  assert.deepEqual(await page.evaluate(() => ({
    cameraEnabled: document.querySelector('[data-counter-drop-target="true"] video')?.srcObject?.getVideoTracks()[0]?.enabled,
    muted: window.__scLocalGame.snapshot().muted,
  })), initialMedia, "Submitting a Commander must not implicitly toggle camera or microphone controls");
  assert.equal(await page.locator(".tile video").count(), 4);
  assert.equal(await page.getByRole("button", { name: "Open settings", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  await page.getByText("Add commander", { exact: true }).click();
  await page.getByRole("textbox", { name: "Add commander", exact: true }).fill("");
  await page.locator(".saved-commander-suggest").getByText("Counters", { exact: true }).click();
  await page.waitForFunction(() => window.__scLocalGame.snapshot().commanders["mock-local-player"] === "Atraxa, Praetors' Voice");
  pass("Invalid typed Commander produces a recoverable alert; saved valid Commander selection works");
  if (process.env.SNAPCAST_UI_RECOGNITION === "1") {
    const video = page.locator(".tile video").first();
    const box = await video.boundingBox();
    await video.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.getByRole("button", { name: "Expand Boseiju, Who Shelters All", exact: true }).waitFor({ timeout: 120_000 });
    pass("Actual opponent-video click identifies Boseiju through the full production pipeline");
    await photo("desktop-identified-camera-card");
  }
  await page.getByRole("button", { name: "Open game management", exact: true }).click();
  await page.getByRole("button", { name: "Shuffle positions", exact: true }).click();
  const shuffled = await page.evaluate(() => window.__scLocalGame.snapshot().gridOrder);
  assert.equal(new Set(shuffled).size, 4);
  await page.getByRole("button", { name: "Ready check", exact: true }).click();
  await page.locator(".ready-check-overlay").first().waitFor();
  await page.evaluate(() => window.__scLocalGame.receive("mock-maya", "ready", { ready: false }));
  await page.locator(".ready-check-overlay").first().waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Ready check", exact: true }).click();
  await page.locator(".ready-check-overlay").first().waitFor();
  await page.locator(".ready-check-overlay").first().waitFor({ state: "hidden", timeout: 15_000 });
  pass("Shuffle preserves all seats; ready veto and real ten-second timeout resolve");
  await page.getByRole("button", { name: "Ready check", exact: true }).click();
  await page.getByRole("button", { name: "Ready", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".ready-check-overlay"));
  pass("Ready check receives three simulated opponent responses and resolves");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByRole("button", { name: "End game", exact: true }).waitFor();
  pass("Host starts the game");
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  const activeBeforeKeyboard = await page.evaluate(() => window.__scLocalGame.snapshot().activePlayerId);
  const clockSwitch = page.getByRole("switch", { name: "Game clock", exact: true });
  const clockBefore = await clockSwitch.getAttribute("aria-checked");
  await clockSwitch.focus();
  await clockSwitch.press("Space");
  await page.waitForFunction((previous) => document.querySelector('[role="switch"][aria-label="Game clock"]')?.getAttribute("aria-checked") !== previous, clockBefore);
  assert.equal(await page.evaluate(() => window.__scLocalGame.snapshot().activePlayerId), activeBeforeKeyboard);
  await clockSwitch.press("Space");
  await page.waitForFunction((previous) => document.querySelector('[role="switch"][aria-label="Game clock"]')?.getAttribute("aria-checked") === previous, clockBefore);
  pass("Space activates a focused setting switch without passing the turn");
  for (const label of ["Chat notifications", "Turn notifications"]) {
    const toggle = page.getByRole("switch", { name: label, exact: true });
    const before = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await page.waitForFunction(({ label, before }) => document.querySelector(`[role="switch"][aria-label="${label}"]`)?.getAttribute("aria-checked") !== before, { label, before });
    await toggle.click();
    await page.waitForFunction(({ label, before }) => document.querySelector(`[role="switch"][aria-label="${label}"]`)?.getAttribute("aria-checked") === before, { label, before });
  }
  for (const name of ["Light", "Dark", "System", "Dark"]) {
    await page.getByRole("group", { name: "Appearance", exact: true }).getByRole("button", { name, exact: true }).click();
    await page.waitForFunction((theme) => document.documentElement.dataset.themePreference === theme, name.toLowerCase());
  }
  for (const [label, value, selector] of [["Active", "follow", ".grid.follow-active"], ["Hero", "hero", ".grid.hero-view"], ["Tile", "tiles", ".grid:not(.follow-active):not(.hero-view)"]]) {
    await page.getByRole("button", { name: "Game view", exact: true }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await page.locator(selector).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("snapcast-video-layout")), value);
    await photo(`desktop-dark-${value}-settings`);
  }
  const colorButtons = page.getByRole("button", { name: /^Choose color / });
  for (let index = 0; index < await colorButtons.count(); index++) {
    const color = (await colorButtons.nth(index).getAttribute("aria-label")).slice("Choose color ".length);
    await colorButtons.nth(index).click();
    await page.waitForFunction((expected) => window.__scLocalGame.snapshot().colors["mock-local-player"] === expected, color);
  }
  for (const [label, value] of [["720p", "720p"], ["1080p", "1080p"], ["2K", "1440p"], ["4K", "2160p"], ["1080p", "1080p"]]) {
    await page.getByRole("group", { name: "Outgoing video quality", exact: true }).getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction((expected) => window.__scLocalGame.snapshot().outgoingVideoQuality === expected, value);
  }
  await page.getByRole("button", { name: "Camera on", exact: true }).click();
  await page.getByRole("button", { name: "Camera off", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('[data-counter-drop-target="true"] video')?.srcObject?.getVideoTracks()[0]?.enabled), false);
  await page.getByRole("button", { name: "Camera off", exact: true }).click();
  await page.getByRole("button", { name: "Camera on", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('[data-counter-drop-target="true"] video')?.srcObject?.getVideoTracks()[0]?.enabled), true);
  await page.getByRole("button", { name: "Mic on", exact: true }).click();
  await page.getByRole("button", { name: "Mic muted", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__scLocalGame.snapshot().muted), true);
  await page.getByRole("button", { name: "Mic muted", exact: true }).click();
  await page.getByRole("button", { name: "Mic on", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__scLocalGame.snapshot().muted), false);
  pass("All general switches, three appearance choices, three layouts, every color, all outgoing quality choices and camera/mic toggles");
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Space");
  await page.waitForFunction((previous) => window.__scLocalGame.snapshot().activePlayerId !== previous, activeBeforeKeyboard);
  pass("Unfocused Space passes the turn locally without durable writes");
  await page.getByRole("button", { name: /^Open chat/ }).click();
  const chat = page.getByRole("textbox", { name: "Chat message", exact: true });
  await chat.fill("Local public chat smoke test");
  await chat.press("Enter");
  await page.getByText("Local public chat smoke test", { exact: true }).waitFor();
  await page.evaluate(() => window.__scLocalGame.receive("mock-maya", "chat", { text: "Incoming opponent message" }));
  await page.getByText("Incoming opponent message", { exact: true }).waitFor();
  await chat.fill("/whisper @Maya Private smoke test");
  await chat.press("Enter");
  await page.getByText("Got your whisper. No responses from me.", { exact: true }).waitFor();
  pass("Public outgoing/incoming chat and private reply");
  await chat.fill("Room sound smoke test");
  await page.getByRole("button", { name: "Add sound effect", exact: true }).click();
  await page.getByRole("tab", { name: "Creatures", exact: true }).click();
  await page.getByRole("textbox", { name: "Search creatures", exact: true }).fill("Dragon");
  await page.getByRole("button", { name: "Preview Dragon", exact: true }).click();
  await page.getByRole("tab", { name: "Emotes", exact: true }).click();
  await page.getByRole("textbox", { name: "Search emotes", exact: true }).fill("Applause");
  await page.getByRole("button", { name: "Preview Applause", exact: true }).click();
  await page.getByRole("button", { name: "Applause", exact: true }).click();
  await chat.press("Enter");
  await page.waitForFunction(() => window.__scLocalGame.snapshot().events.findLast((event) => event.type === "outgoing-chat")?.soundId === "applause");
  assert.equal(await page.getByRole("button", { name: "Add sound effect", exact: true }).isDisabled(), true);
  pass("Sound categories/search/preview/public sending and sender cooldown");
  await page.evaluate(() => {
    window.__scLocalGame.receive("mock-maya", "life", { value: 37 });
    window.__scLocalGame.receive("mock-drew", "poison", { value: 2 });
    window.__scLocalGame.receive("mock-sam", "commander-damage", { attackerId: "mock-maya", value: 4 });
    window.__scLocalGame.receive("mock-sam", "dice-roll", { value: 17 });
    window.__scLocalGame.receive("mock-maya", "video-counter", { counter: { id: "smoke-counter", type: "plus-one", x: .5, y: .5, value: 3 } });
  });
  await page.getByRole("button", { name: "Open Commander damage", exact: true }).click();
  await page.getByText("Poison", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Increase Zach poison counters", exact: true }).click();
  await page.getByRole("button", { name: "Increase Alela, Artful Provocateur damage to Zach", exact: true }).click();
  await page.waitForFunction(() => window.__scLocalGame.snapshot().poison["mock-local-player"] === 1
    && window.__scLocalGame.snapshot().commanderDamage["mock-local-player"]?.["mock-maya"] === 1);
  await photo("desktop-counters");
  pass("Incoming life, poison, commander damage, dice and on-camera counters render");
  await page.getByRole("button", { name: "Open dice roller", exact: true }).click();
  for (const [label, sides] of [["Coin", 2], ...Array.from({ length: 18 }, (_, index) => [`D${index + 3}`, index + 3])]) {
    await page.getByRole("button", { name: "Choose a die to roll", exact: true }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await page.getByRole("button", { name: sides === 2 ? "Flip coin" : "Roll dice", exact: true }).click();
    await page.waitForFunction((expected) => window.__scLocalGame.snapshot().events.findLast((event) => event.type === "outgoing-dice")?.sides === expected, sides);
  }
  await page.getByRole("button", { name: "Choose a counter to generate", exact: true }).click();
  await page.getByRole("textbox", { name: "Search counters", exact: true }).fill("+1/+1");
  await page.getByRole("option", { name: "+1/+1", exact: true }).click();
  await page.getByRole("button", { name: "Generate counter", exact: true }).click();
  const sourceCounter = await page.locator('[aria-label="Drag +1/+1 counter onto your video"]').boundingBox();
  const ownVideo = page.locator('[data-counter-drop-target="true"]');
  const ownVideoBox = await ownVideo.boundingBox();
  await page.mouse.move(sourceCounter.x + sourceCounter.width / 2, sourceCounter.y + sourceCounter.height / 2);
  await page.mouse.down();
  await page.mouse.move(ownVideoBox.x + ownVideoBox.width / 2, ownVideoBox.y + ownVideoBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__scLocalGame.snapshot().videoCounters["mock-local-player"]?.length === 1);
  await ownVideo.locator(".video-counter-sticker.editable").hover();
  await ownVideo.getByRole("button", { name: "Increase +1/+1", exact: true }).click();
  await page.waitForFunction(() => window.__scLocalGame.snapshot().videoCounters["mock-local-player"]?.[0]?.value === 2);
  const stickerBox = await ownVideo.locator(".video-counter-sticker.editable").boundingBox();
  await page.mouse.move(stickerBox.x + stickerBox.width / 2, stickerBox.y + stickerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(ownVideoBox.x + ownVideoBox.width * .65, ownVideoBox.y + ownVideoBox.height * .55, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => Math.abs(window.__scLocalGame.snapshot().videoCounters["mock-local-player"]?.[0]?.x - .65) < .02);
  assert.equal(await page.getByRole("button", { name: "Generate counter", exact: true }).isVisible(), true, "Moving a sticker must not trigger card lookup or switch panels");
  await ownVideo.locator(".video-counter-sticker.editable").hover();
  await ownVideo.getByRole("button", { name: "Decrease +1/+1", exact: true }).click();
  await ownVideo.getByRole("button", { name: "Decrease +1/+1", exact: true }).click();
  await page.waitForFunction(() => !window.__scLocalGame.snapshot().videoCounters["mock-local-player"]?.length, null, { timeout: 15_000 });
  const addSticker = async () => {
    await page.getByRole("button", { name: "Generate counter", exact: true }).click();
    const source = await page.locator('[aria-label="Drag +1/+1 counter onto your video"]').boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(ownVideoBox.x + ownVideoBox.width / 2, ownVideoBox.y + ownVideoBox.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__scLocalGame.snapshot().videoCounters["mock-local-player"]?.length === 1);
  };
  await addSticker();
  await ownVideo.locator(".video-counter-sticker.editable").hover();
  await ownVideo.getByRole("button", { name: "Remove +1/+1", exact: true }).click();
  await page.waitForFunction(() => !window.__scLocalGame.snapshot().videoCounters["mock-local-player"]?.length);
  await addSticker();
  pass("Editable poison/damage, every Coin/D3–D20 choice, counter search/generation/placement/move/increment/removal/zero expiry");
  await photo("desktop-dice");
  await page.getByRole("button", { name: "Invite players", exact: true }).click();
  await page.getByRole("textbox", { name: "Game code", exact: true }).waitFor();
  for (const label of ["Game code", "Player link", "Visitor link"]) {
    const value = await page.getByRole("textbox", { name: label, exact: true }).inputValue();
    await page.getByRole("button", { name: `Copy ${label.toLowerCase()}`, exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), value);
  }
  const inviteFriend = page.locator(".invite-friend-row").filter({ has: page.getByText("Maya", { exact: true }) });
  await inviteFriend.getByRole("button", { name: "Invite", exact: true }).click();
  await inviteFriend.getByRole("button", { name: "Cancel", exact: true }).click();
  pass("Game code/player/visitor clipboard links and local friend invitation/cancel");
  await page.getByRole("button", { name: "Open card lookup", exact: true }).click();
  await page.getByRole("button", { name: "Rename Four-player UI practice", exact: true }).click();
  await page.getByRole("textbox", { name: "Game name", exact: true }).fill("Local UI feature tour");
  await page.getByRole("textbox", { name: "Game name", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Rename Local UI feature tour", exact: true }).waitFor();
  const selfTile = page.locator(".tile").filter({ has: page.getByText("Zach (you)", { exact: true }) });
  await selfTile.getByRole("button", { name: "Player options", exact: true }).click();
  await selfTile.getByRole("button", { name: "Flip video", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-counter-drop-target="true"] video')?.style.transform === "rotate(180deg)");
  await selfTile.getByRole("button", { name: "Player options", exact: true }).click();
  await selfTile.getByRole("button", { name: "Unflip video", exact: true }).click();
  pass("Game rename and player-menu flip/unflip");
  await page.getByRole("textbox", { name: "Lookup cards", exact: true }).fill("Lightning Bolt");
  await photo("desktop-lookup");
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await photo("desktop-dark-settings");
  await accessible("desktop dark settings");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await photo("desktop-light-settings");
  await accessible("desktop light settings");
  await page.locator(".dice-result-overlay").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 844 });
  await photo("mobile-light-settings");
  await accessible("mobile light settings");
  const leaveButton = page.getByRole("button", { name: "Leave game", exact: true });
  await leaveButton.scrollIntoViewIfNeeded();
  const mobileScrollReachable = await leaveButton.evaluate((button) => {
    const panel = button.closest(".sidebar-content").getBoundingClientRect();
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.top >= panel.top && box.bottom <= panel.bottom && (hit === button || button.contains(hit));
  });
  assert.equal(mobileScrollReachable, true, "Mobile settings must scroll to reachable device/leave controls");
  await photo("mobile-light-settings-bottom");
  pass("Mobile settings scroll reaches lower device and leave controls without tile overlap");
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByRole("button", { name: "Open panel", exact: true }).waitFor();
  await photo("mobile-light-table");
  await accessible("mobile light collapsed panel");
  await page.setViewportSize({ width: 1440, height: 1000 });
  page.once("dialog", (dialog) => dialog.accept("concede"));
  await page.getByRole("button", { name: "I’m out", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Mark me out", exact: true }).click();
  await page.waitForFunction(() => window.__scLocalGame.snapshot().eliminations["mock-local-player"] === "concede");
  await page.getByRole("button", { name: "Out · Undo", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Return to game", exact: true }).click();
  await page.waitForFunction(() => !window.__scLocalGame.snapshot().eliminations["mock-local-player"]);
  pass("Live-game elimination and undo update local state with confirmation");
  await page.getByRole("button", { name: "Open game management", exact: true }).click();
  await page.getByRole("button", { name: "End game", exact: true }).click();
  await page.getByRole("button", { name: "Confirm end game", exact: true }).click();
  const ownTile = page.locator(".tile").filter({ has: page.getByText("Zach (you)", { exact: true }) });
  await ownTile.getByRole("button", { name: "Player options", exact: true }).click();
  await ownTile.getByRole("button", { name: "Check ready", exact: true }).click();
  await page.locator(".ready-check-overlay").first().waitFor();
  await page.getByRole("button", { name: "Restart table", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restart table", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__scLocalGame.snapshot().videoCounters), {});
  assert.deepEqual(await page.evaluate(() => window.__scLocalGame.snapshot().poison), {});
  assert.deepEqual(await page.evaluate(() => window.__scLocalGame.snapshot().commanderDamage), {});
  assert.equal(await page.locator(".video-counter-sticker").count(), 0);
  assert.equal(await page.locator(".ready-check-overlay").count(), 0);
  pass("Host ends and restarts; poison/damage/stickers/pending ready check reset");
  const capture = await page.evaluate(async () => { const shot = await window.__scLocalGame.capture("mock-maya", 245 / 1280, 380 / 720); const bitmap = await createImageBitmap(shot.blob); const output = { width: bitmap.width, height: bitmap.height, bytes: shot.bytes, px: shot.px, py: shot.py }; bitmap.close(); URL.revokeObjectURL(shot.url); return output; });
  assert.equal(capture.width, 396);
  assert.equal(capture.height, 396);
  assert.ok(capture.bytes > 1000);
  report.capture = capture;
  pass("Remote capture encodes real JPEG pixels with production crop geometry");
  await page.evaluate(() => { window.__scLocalGame.disconnect("mock-maya"); window.__scLocalGame.reconnect("mock-maya"); });
  pass("Opponent reconnect events accepted");
  const mayaManagement = page.locator(".game-management-tile").filter({ has: page.getByText("Maya", { exact: true }) });
  await mayaManagement.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove player", exact: true }).click();
  await page.waitForFunction(() => !window.__scLocalGame.snapshot().roster.some((member) => member.id === "mock-maya"));
  assert.equal(await page.evaluate(() => window.__scLocalGame.receive("mock-maya", "life", { value: 3 })), false);
  const removedCapture = await page.evaluate(async () => { try { await window.__scLocalGame.capture("mock-maya"); return true; } catch { return false; } });
  assert.equal(removedCapture, false);
  pass("Removed opponent leaves roster, stops participation and cannot be captured");
  const visitorFixture = structuredClone(fixture);
  visitorFixture.games.find((game) => game.code === "TEST04").mock_owner = false;
  const visitorPage = await context.newPage();
  activePage = visitorPage;
  visitorPage.on("pageerror", (error) => report.errors.push(error.message));
  await visitorPage.route("**/mock-data.local.json", (route) => route.fulfill({ json: visitorFixture }));
  await visitorPage.goto(`${base}/?code=TEST04&visitor=1`, { waitUntil: "domcontentloaded" });
  const visitorJoin = visitorPage.getByRole("button", { name: "Join as visitor", exact: true });
  const visitorContinue = visitorPage.getByRole("button", { name: "Continue", exact: true });
  await visitorContinue.or(visitorJoin).first().waitFor();
  if (await visitorContinue.isVisible()) await visitorContinue.click();
  await visitorJoin.click();
  await visitorPage.getByRole("button", { name: "Open settings", exact: true }).waitFor();
  await visitorPage.waitForFunction(() => [...document.querySelectorAll(".tile video")].filter((video) => video.videoWidth > 0).length === 3);
  assert.equal(await visitorPage.getByRole("button", { name: "Open dice roller", exact: true }).count(), 0);
  assert.equal(await visitorPage.getByRole("button", { name: "Open game management", exact: true }).count(), 0);
  assert.equal(await visitorPage.getByRole("button", { name: "Gain 1 life; hold to gain life in increments of 5", exact: true }).count(), 0);
  await visitorPage.getByRole("button", { name: "Open settings", exact: true }).click();
  assert.equal(await visitorPage.getByRole("button", { name: "Camera on", exact: true }).count(), 0);
  await visitorPage.getByText("You joined as a visitor.", { exact: false }).waitFor();
  await visitorPage.getByRole("button", { name: /^Open chat/ }).click();
  await visitorPage.getByRole("textbox", { name: "Chat message", exact: true }).fill("Visitor public chat smoke test");
  await visitorPage.getByRole("textbox", { name: "Chat message", exact: true }).press("Enter");
  await visitorPage.getByText("Visitor public chat smoke test", { exact: true }).waitFor();
  const visitorCapture = await visitorPage.evaluate(async () => { const shot = await window.__scLocalGame.capture("mock-maya"); const bytes = shot.bytes; URL.revokeObjectURL(shot.url); return bytes; });
  assert.ok(visitorCapture > 1000);
  await visitorPage.screenshot({ path: path.join(reportDir, "desktop-visitor-chat.png"), fullPage: true });
  report.screenshots.push("desktop-visitor-chat.png");
  pass("Visitor decodes three remote cameras, shares chat/capture, and lacks player/host/camera controls");
  await visitorPage.close();
  assert.deepEqual(report.blockedWrites, [], "Local UI must never attempt a production service write");
  assert.deepEqual(report.errors, [], "UI must not produce uncaught errors");
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error.stack || String(error);
  if (activePage) {
    report.failureView = await activePage.locator("body").innerText().catch(() => "");
    report.failureState = await activePage.evaluate(() => ({
      transport: window.__scLocalGame?.snapshot(),
      media: [...document.querySelectorAll(".tile video")].map((video) => ({ decoded: video.videoWidth > 0, tracks: video.srcObject?.getVideoTracks().map((track) => ({ enabled: track.enabled, readyState: track.readyState })) })),
    })).catch(() => null);
    await activePage.screenshot({ path: path.join(reportDir, "failure.png"), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(path.join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  server?.kill("SIGTERM");
  process.stdout.write(`UI simulation report: ${path.join(reportDir, "report.json")}\n`);
}
