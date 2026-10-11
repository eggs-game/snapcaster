// Supplemental frozen hard-case probe; the complete paired suites remain required.
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const [base = "http://127.0.0.1:4185", output = ".cache/milo/regions-pilot.json", selected = ""] = process.argv.slice(2);
const old = JSON.parse(await readFile("snaptest/runs/2026-10-10-milo-release/paired-realLife.json", "utf8"));
const frozen = JSON.parse(await readFile(".cache/ai-lookup/crops/manifest.json", "utf8"));
const indices = [...new Set([0, 15, 167, ...old.records.filter(r => !r.ai.ok).map(r => r.i)])];
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const records = [];
try {
  const page = await browser.newPage(); await page.goto(base + "/snaptest");
  await page.waitForFunction(() => window.__SNAP_RECOGNITION_WARMUP?.status === "ready", null, { timeout: 90000 });
  for (const i of selected ? selected.split(",").map(Number) : indices) {
    const item = frozen.records.find(r => r.i === i);
    const source = "data:image/png;base64," + (await readFile(".cache/ai-lookup/crops/" + item.crops.find(c => c.kind === "capture").file)).toString("base64");
    const result = await page.evaluate(async ({ item, source }) => {
      const t = performance.now(), r = await window.__scIdentifyUrl(source, item.point);
      const best = r.matches[0];
      return { i: item.i, name: item.name, build: window.__SNAP_BUILD, got: best?.name, ok: best?.name === item.name, by: best?.identified_by,
        regionalProof: !!best?.regional_proof, artBest: r.art_best, milo: r.milo, miloChecked: r.milo_verification,
        aiCrop: r.ai_crop, stages: r.stage_ms,
        ms: Math.round(performance.now() - t) };
    }, { item, source });
    records.push(result);
    console.log(`${i}: ${item.name}: ${result.ok} ${result.by || "unknown"} region=${result.regionalProof} ${result.ms}ms`);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ scope: "frozen prior research captures, milo-rescue-7 misses plus rotation controls; supplemental, not a release gate", records }, null, 2));
  }
} finally { await browser.close(); }
