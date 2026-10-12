import assert from "node:assert/strict";
import { chromium } from "playwright";

// Use the existing credential-safe app diagnostic. Credentials and candidate
// addresses stay inside the browser; output contains only counts/protocols.
const browser = await chromium.launch({
  headless: true,
  ...(process.env.SNAPCAST_CHROME_PATH ? { executablePath: process.env.SNAPCAST_CHROME_PATH } : {}),
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("https://www.snapcast.app/turntest", { waitUntil: "domcontentloaded" });
  await page.getByTestId("turn-result").waitFor();
  await page.waitForFunction(() => {
    try { return JSON.parse(document.querySelector('[data-testid="turn-result"]').textContent).status !== "testing"; }
    catch { return false; }
  }, null, { timeout: 30000 });
  const diagnostic = JSON.parse(await page.getByTestId("turn-result").textContent());
  const result = { status: diagnostic.status, relayCandidates: diagnostic.relayCandidates, protocols: diagnostic.protocols || [] };
  console.log(JSON.stringify(result));
  assert.deepEqual(errors, [], "Production relay diagnostic must not throw page errors");
  assert.equal(result.status, "ready", "Production browser must gather a TURN relay candidate");
  assert.ok(result.relayCandidates > 0);
} finally {
  await browser.close();
}
