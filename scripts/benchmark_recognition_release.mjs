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
    await page.goto(`${flags.url || "http://127.0.0.1:5173"}/snaptest?aiCrop=${flags.ai || "1"}&milo=${flags.milo || "1"}`, { waitUntil: "domcontentloaded" });
    await page.locator("select").selectOption(mode);
    await page.getByRole("button", { name: "▶ Run", exact: true }).click({ timeout: 90000 });
    const started = Date.now();
    let previousPoll = started;
    console.log(`${mode}: started`);
    while (true) {
      await page.waitForTimeout(15000);
      const pollNow = Date.now();
      if (pollNow - previousPoll > 60000) throw new Error(`${mode}: scheduling stalled for ${Math.round((pollNow - previousPoll)/1000)}s; discard this incomplete timing run`);
      previousPoll = pollNow;
      const result = await page.evaluate(() => window.__SNAPTEST_LAST_RESULT || null);
      if (result) {
        await writeFile(path.join(output, `${mode}.json`), JSON.stringify(result, null, 2) + "\n");
        // Preserve the actual failed pixels before closing the context. The
        // random suites cannot recreate a specific failure from names alone.
        const images = await page.locator('img[title="what we scanned"]').evaluateAll(nodes => nodes.map(n => n.currentSrc || n.src));
        const captureDir = path.join(output,"captures",mode); await mkdir(captureDir,{recursive:true});
        const captures = [];
        for (let i = 0; i < images.length; i++) {
          const match = /^data:image\/(jpeg|png);base64,(.*)$/.exec(images[i]);
          if (!match) continue;
          const file = `${String(i).padStart(3,"0")}.${match[1] === "jpeg" ? "jpg" : "png"}`;
          await writeFile(path.join(captureDir,file),Buffer.from(match[2],"base64"));
          captures.push({ file, ...result.misses[i], point: result.misses[i]?.capturePoint || null,
            pointNote: result.misses[i]?.capturePoint ? "Exact normalized point supplied to identifyCard." : "Original normalized capture point is not exported; retain geometry/click metadata rather than invent an exact point." });
        }
        await writeFile(path.join(captureDir,"manifest.json"),JSON.stringify(captures,null,2)+"\n");
        console.log(`${mode}: completed ${JSON.stringify(result.summary)}`);
        break;
      }
      console.log(`${mode}: ${Math.round((Date.now() - started)/1000)}s ${await page.locator("body").innerText().then(s => s.match(/\d+\s*\/\s*\d+ scanned[\s\S]*?live accuracy\s*[\d.]+%/)?.[0]?.replace(/\s+/g, " ") || s.slice(-200))}`);
      if (Date.now() - started > 90 * 60 * 1000) throw new Error(`${mode}: exceeded 90-minute benchmark limit`);
    }
    await context.close();
  }
} finally { await browser.close(); }
