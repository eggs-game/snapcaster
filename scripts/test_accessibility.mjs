#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, copyFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import process from "node:process";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const ownsServer = !process.env.SNAPCAST_A11Y_URL;
const port = ownsServer ? await findOpenPort() : null;
const baseUrl = process.env.SNAPCAST_A11Y_URL || `http://127.0.0.1:${port}`;
let server;
let serverOutput = "";
let addedMockFixture = false;

async function findOpenPort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch { /* preview is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${baseUrl}${serverOutput ? `\n${serverOutput}` : ""}`);
}

function formatViolations(label, violations) {
  return violations.map((violation) => {
    const nodes = violation.nodes.slice(0, 4).map((node) => (
      `    ${node.target.join(" ")} — ${node.failureSummary || node.html}`
    )).join("\n");
    return `${label}: ${violation.id} (${violation.impact || "unknown"}) — ${violation.help}\n${nodes}`;
  }).join("\n");
}

async function assertAccessible(page, label, include) {
  let builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  if (result.violations.length) {
    throw new Error(formatViolations(label, result.violations));
  }
  process.stdout.write(`accessibility passed: ${label}\n`);
}

async function setTheme(page, theme) {
  await page.addInitScript((preference) => {
    localStorage.setItem("theme-preference", preference);
  }, theme);
}

async function joinMockGame(page) {
  await page.goto(`${baseUrl}/?code=MOCK01`, { waitUntil: "networkidle" });
  const continueButton = page.getByRole("button", { name: "Continue", exact: true });
  const joinGameButton = page.getByRole("button", { name: "Join game", exact: true });
  await continueButton.or(joinGameButton).first().waitFor();
  if (await continueButton.isVisible()) await continueButton.click();
  await joinGameButton.click();
  const settingsButton = page.getByRole("button", { name: "Open settings" });
  try {
    await settingsButton.waitFor({ timeout: 10_000 });
  } catch {
    const visibleText = (await page.locator("body").innerText()).slice(0, 1_500);
    throw new Error(`Mock game did not finish joining at ${page.url()}\n${visibleText}`);
  }
}

try {
  if (ownsServer) {
    try {
      await access("dist/mock-data.local.json");
    } catch {
      await copyFile("public/mock-data.local.json", "dist/mock-data.local.json");
      addedMockFixture = true;
    }
    server = spawn(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    server.stdout.on("data", (chunk) => { serverOutput += chunk; });
    server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  }
  await waitForServer();

  const browser = await chromium.launch({ headless: true });
  try {
    for (const theme of ["dark", "light"]) {
      const context = await browser.newContext({ viewport: { width: 1375, height: 998 } });
      const page = await context.newPage();
      await setTheme(page, theme);
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await assertAccessible(page, `home (${theme})`, "main");
      await context.close();
    }

    const profileContext = await browser.newContext({ viewport: { width: 1375, height: 998 } });
    const profilePage = await profileContext.newPage();
    await setTheme(profilePage, "dark");
    await profilePage.goto(`${baseUrl}/profile?id=11000000-0000-4000-8000-000000000001`, { waitUntil: "networkidle" });
    await assertAccessible(profilePage, "public profile", "main");
    await profileContext.close();

    const gameContext = await browser.newContext({ viewport: { width: 1375, height: 998 } });
    const gamePage = await gameContext.newPage();
    await setTheme(gamePage, "dark");
    await joinMockGame(gamePage);
    await gamePage.getByRole("button", { name: "Open game management" }).click();
    await gamePage.getByRole("button", { name: "Restart table", exact: true }).click();
    await gamePage.getByRole("alertdialog").waitFor();
    await assertAccessible(gamePage, "shared confirmation dialog", ".confirmation-dialog");
    await gamePage.getByRole("button", { name: "Cancel", exact: true }).click();
    await gamePage.getByRole("button", { name: "Open settings" }).click();
    await assertAccessible(gamePage, "game settings panel", ".sidebar");
    await gameContext.close();
  } finally {
    await browser.close();
  }
} finally {
  if (server && !server.killed) server.kill("SIGTERM");
  if (addedMockFixture) await rm("dist/mock-data.local.json", { force: true });
}
