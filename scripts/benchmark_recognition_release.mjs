#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const flags = Object.fromEntries(process.argv.slice(2).map(arg => { const [k,...v] = arg.replace(/^--/, "").split("="); return [k,v.join("=")]; }));
const modes = (flags.modes || "realLife,tableauEdh10,tableauVegasEdh20,tableauEdhDice10,random200,edh200,recentHint20,arcaneMedium").split(",");
const output = flags.output || ".cache/recognition-release";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: flags.chrome || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
try {
  for (const mode of modes) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", e => console.error(mode, e.message));
    await page.goto(`${flags.url || "http://127.0.0.1:5173"}/snaptest?aiCrop=${flags.ai || "1"}`, { waitUntil: "domcontentloaded" });
    await page.locator("select").selectOption(mode);
    await page.getByRole("button", { name: "▶ Run", exact: true }).click({ timeout: 90000 });
    const started = Date.now();
    console.log(`${mode}: started`);
    while (true) {
      await page.waitForTimeout(15000);
      const result = await page.evaluate(() => window.__SNAPTEST_LAST_RESULT || null);
      if (result) {
        await writeFile(path.join(output, `${mode}.json`), JSON.stringify(result, null, 2) + "\n");
        console.log(`${mode}: completed ${JSON.stringify(result.summary)}`);
        break;
      }
      console.log(`${mode}: ${Math.round((Date.now() - started)/1000)}s ${await page.locator("body").innerText().then(s => s.match(/\d+\s*\/\s*\d+ scanned[\s\S]*?live accuracy\s*[\d.]+%/)?.[0]?.replace(/\s+/g, " ") || s.slice(-200))}`);
      if (Date.now() - started > 90 * 60 * 1000) throw new Error(`${mode}: exceeded 90-minute benchmark limit`);
    }
    await context.close();
  }
} finally { await browser.close(); }
