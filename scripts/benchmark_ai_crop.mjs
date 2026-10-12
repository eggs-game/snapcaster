#!/usr/bin/env node
// Paired browser A/B: identical captures, separate fresh recognition workers,
// alternating arm order, and all records saved (not only the misses).
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const flags = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [name, value = "true"] = arg.replace(/^--/, "").split("=");
  return [name, value];
}));
const suite = flags.suite || "smoke";
if (!["smoke", "tableau", "vegas", "dice", "overlap", "arcane", "realLife"].includes(suite)) throw new Error("Unknown suite");
const base = flags.url || "http://127.0.0.1:5173";
const output = flags.output || `.cache/ai-crop/${suite}.json`;
const browser = await chromium.launch({
  headless: true,
  ...(flags.chrome ? { executablePath: flags.chrome } : {}),
  args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
const records = [];
const arms = {};
let generator;
try {
  for (const name of ["baseline", "ai"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    // A development HMR reload would invalidate a paired run halfway through.
    // Tests use a frozen server snapshot; make unexpected reloads explicit.
    page.on("pageerror", (err) => console.error(`[${name}] ${err.message}`));
    await page.goto(`${name === "baseline" ? flags.baselineUrl || base : base}/snaptest?aiCrop=1`, { waitUntil: "domcontentloaded" });
    if (flags.production) {
      await page.waitForFunction(() => window.__SNAP_RECOGNITION_WARMUP?.status === "ready", null, { timeout: 90000 });
    } else await page.evaluate(async () => {
      window.aiMatcher = await import("/src/recognition/matcher.js");
      await window.aiMatcher.preload();
    });
    console.log(`${name}: recognition ready`);
    arms[name] = page;
  }
  generator = arms.baseline;
  if (flags.generatorUrl) {
    generator = await browser.newPage();
    await generator.goto(`${flags.generatorUrl}/snaptest/cards.json`);
  }
  const batches = ["arcane", "realLife"].includes(suite) ? 20 : suite === "smoke" ? 2 : suite === "vegas" ? 20 : 10;
  const startScene = Number(flags.startScene || 0);
  for (let scene = startScene; scene < Math.min(batches, startScene + Number(flags.scenes || batches)); scene++) {
    const items = await generator.evaluate(async ({ scene, suite, severity }) => {
      if (suite === "arcane") {
        const manifest = await (await fetch("/snaptest/arcane/manifest.json")).json();
        return manifest[severity].slice(scene * 10, scene * 10 + 10).map((card) => ({
          ...card, source: `/snaptest/arcane/${severity}/${card.file}`,
          point: { nx: 0.5, ny: 0.5 }, scene,
        }));
      }
      const { buildScene, cropScene, perfectCrop, releaseScene } = await import("/src/snaptest/scene.js");
      // Frozen index sample, not used to train a model in this project. No fresh random draw
      // between arms; geometry comes from the actual SNAPTEST renderer.
      let cards;
      let options = {
        ...(suite === "vegas" || suite === "smoke" ? { playmat: "magic-con-vegas" } : {}),
        ...(suite === "dice" ? { dice: true } : {}),
        ...(suite === "overlap" || suite === "smoke" ? { layout: "overlapping" } : {}),
      };
      if (suite === "realLife") {
        if (!window.releaseDraw) {
          // Use the authoritative JSX's actual sampler and constants, not a
          // second card-draw implementation that can drift from SNAPTEST.
          const source = await (await fetch("/src/SnapTest.jsx")).text();
          const declaration = (marker, arrow = false) => {
            const start = source.indexOf(marker);
            if (start < 0) throw new Error(`Missing sampler declaration ${marker}`);
            const brace = source.indexOf("{", arrow ? source.indexOf("=>", start) : start);
            let depth = 0;
            for (let i = brace; i < source.length; i++) {
              if (source[i] === "{") depth++;
              if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
            }
            throw new Error(`Unclosed sampler declaration ${marker}`);
          };
          const matsStart = source.indexOf("const REAL_MATS =");
          const mats = source.slice(matsStart, source.indexOf("];", matsStart) + 2);
          const setup = `${declaration("function mulberry32(")}\n${declaration("const MODES =")} ;\n${mats}\nconst popularRef = { current: null }; const CLICK_MIX = { tokens: .25, basics: .05 };\n${declaration("const loadPopular =", true)};\n${declaration("const samplePopular =", true)};\nreturn { cards: await samplePopular(MODES.realLife.size, MODES.realLife.popular, { seed: MODES.realLife.seed }), mode: MODES.realLife, mats: REAL_MATS };`;
          window.releaseDraw = await eval(`(async () => { ${setup} })()`);
        }
        cards = window.releaseDraw.cards;
        const m = window.releaseDraw.mode;
        options = { dice: !!m.dice, layout: m.layout, perspective: !!m.perspective,
          playmat: m.playmat || window.releaseDraw.mats[scene % window.releaseDraw.mats.length] };
      } else cards = await (await fetch("/snaptest/cards.json")).json();
      const rendered = await buildScene(cards.slice(scene * 10, scene * 10 + 10), scene, 1920, 1080, options);
      if (rendered.failed.length) throw new Error(`Failed to load ${rendered.failed.length} scene images`);
      const captures = rendered.placed.map((p) => {
        const crop = cropScene(rendered.canvas, p.nx, p.ny);
        return { ...p.card, source: crop.url, perfectSource: suite === "realLife" ? perfectCrop(rendered.canvas, p, rendered.cardW, rendered.cardH) : undefined, occ: p.occ, point: { nx: crop.px, ny: crop.py }, scene,
          rotation: p.rotationClass, layout: p.layout, coverage: p.coverage, clipped: p.clipped };
      });
      releaseScene(rendered.canvas);
      return captures;
    }, { scene, suite, severity: flags.severity || "heavy" });
    for (const [itemIndex, item] of items.entries()) {
      if (flags.indices && !flags.indices.split(",").map(Number).includes(itemIndex)) continue;
      const rec = { ...item, source: undefined, perfectSource: undefined, i: records.length };
      const order = records.length % 2 ? ["ai", "baseline"] : ["baseline", "ai"];
      for (const name of order) {
        await arms[name].bringToFront();
        rec[name] = await arms[name].evaluate(async ({ item, name, production, baselineAi }) => {
          const start = performance.now();
          try {
            if (document.visibilityState !== "visible") throw new Error("Benchmark page is hidden");
            const scan = (source, point) => production
              ? window.__scIdentifyUrl(source, point, [], { aiCrop: name === "ai" || baselineAi })
              : window.aiMatcher.identify(source, point, { aiCrop: name === "ai" || baselineAi });
            const result = await scan(item.source, item.point);
            const best = result.matches[0];
            const rank = result.matches.findIndex((m) => m.name === item.name);
            const ms = Math.round(performance.now() - start);
            let perfectControl;
            if (best?.name !== item.name && item.perfectSource) {
              try {
                const control = await scan(item.perfectSource, { nx: .5, ny: .5 });
                perfectControl = { ok: control.matches[0]?.name === item.name, got: control.matches[0]?.name, by: control.matches[0]?.identified_by, dist: control.matches[0]?.distance };
              } catch (error) { perfectControl = { ok: false, error: String(error) }; }
            }
            return { build: window.__SNAP_BUILD, perfectControl, ok: best?.name === item.name, got: best?.name, by: best?.identified_by,
              strategy: best?.strategy, distance: best?.distance, trueRank: rank < 0 ? null : rank + 1,
              ms, stages: result.stage_ms,
              aiCrop: result.ai_crop, wasmHeapMB: result.wasm_heap_mb,
              artBest: result.art_best, blockedNames: result.blocked_names, top3: result.matches.slice(0, 3).map((m) => ({ name: m.name, distance: m.distance })) };
          } catch (error) { return { ok: false, ms: Math.round(performance.now() - start), error: String(error?.message || error) }; }
        }, { item, name, production: !!flags.production, baselineAi: flags.baselineAi === "1" });
      }
      records.push(rec);
      console.log(`${records.length}: ${item.name}: baseline=${rec.baseline.ok}/${rec.baseline.ms}ms ai=${rec.ai.ok}/${rec.ai.ms}ms fast=${!!rec.ai.aiCrop?.fastHit} proposals=${rec.ai.aiCrop?.proposals ?? 0} (${rec.ai.aiCrop?.status || "unknown"})`);
      if (rec.ai.aiCrop?.status === "failed" || rec.ai.aiCrop?.status === "timeout") throw new Error(`AI runtime failed: ${JSON.stringify(rec.ai.aiCrop)}`);
      await save(false);
    }
    await save();
  }
} finally {
  await save();
  await browser.close();
}

function summary(name) {
  const samples = records.map((r) => r[name]);
  const times = samples.map((r) => r.ms).sort((a, b) => a - b);
  const group = (key, bucket = value => value) => Object.fromEntries([...new Set(records.map((r) => bucket(r[key])).filter((v) => v != null))].map((value) => {
    const rows = records.filter((r) => bucket(r[key]) === value);
    return [value, { n: rows.length, ok: rows.filter((r) => r[name].ok).length, acc: +(rows.filter((r) => r[name].ok).length / rows.length).toFixed(3) }];
  }));
  const accepted = samples.filter((r) => ["art-match", "visual-exact"].includes(r.by));
  return { n: samples.length, accuracy: +(samples.filter(r => r.ok).length / (samples.length || 1)).toFixed(3), byOcclusion: group("occ"), byPool: group("pool"), byCoverage: group("coverage", value => value == null ? null : value === 0 ? "0 (clear)" : value < .15 ? "0-15%" : value < .3 ? "15-30%" : "30%+"), byClipped: group("clipped", value => value == null ? null : value < .05 ? "0-5% (whole)" : value < .15 ? "5-15%" : value < .3 ? "15-30%" : "30%+"), avgMs: Math.round(samples.reduce((sum,r)=>sum+r.ms,0)/(samples.length||1)), neighbourMisses: records.filter(r=>!r[name].ok && records.some(other=>other.scene===r.scene && other.name===r[name].got && other.name!==r.name)).map(r=>r.i), attempted: samples.length, correct: samples.filter((r) => r.ok).length,
    errors: samples.filter((r) => r.error).length, medianMs: times[Math.floor(times.length / 2)],
    p90Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.9))],
    accepted: { n: accepted.length, correct: accepted.filter((r) => r.ok).length },
    byPathway: Object.fromEntries([...new Set(samples.map(r => r.by || "(no match)"))].map(key => { const rows = samples.filter(r => (r.by || "(no match)") === key); return [key, { n: rows.length, ok: rows.filter(r => r.ok).length, acc: +(rows.filter(r => r.ok).length / rows.length).toFixed(3) }]; })),
    byRotation: group("rotation"), byLayout: group("layout"),
    absentMisses: samples.filter((r) => !r.ok && r.trueRank === null).length,
    firstHalf: samples.slice(0, Math.floor(samples.length / 2)).filter((r) => r.ok).length,
    secondHalf: samples.slice(Math.floor(samples.length / 2)).filter((r) => r.ok).length,
    wasmHeapMB: [samples[0]?.wasmHeapMB, samples.at(-1)?.wasmHeapMB] };
}

async function save(log = true) {
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  const payload = { build: records[0]?.ai?.build || "unknown", suite, severity: flags.severity,
    baselineAi: flags.baselineAi === "1",
    sample: suite === "realLife" ? "authoritative SNAPTEST realLife sampler, seed 20260803, identical production captures" : "frozen snaptest/cards.json", paired: true, completed: records.length,
    summary: { baseline: summary("baseline"), ai: summary("ai"),
      recovered: records.filter((r) => !r.baseline.ok && r.ai.ok).map((r) => r.i),
      regressed: records.filter((r) => r.baseline.ok && !r.ai.ok).map((r) => r.i),
      proposals: records.filter((r) => r.ai.aiCrop?.proposals > 0).length,
      fastHits: records.filter((r) => r.ai.aiCrop?.fastHit).length,
      recoveredNeighbours: records.filter(r=>!r.baseline.ok && r.ai.ok && records.some(other=>other.scene===r.scene && other.name===r.baseline.got && other.name!==r.name)).map(r=>r.i),
      fastPrecision: { n:records.filter(r=>r.ai.aiCrop?.fastHit).length, correct:records.filter(r=>r.ai.aiCrop?.fastHit && r.ai.ok).length } }, records };
  await writeFile(output, JSON.stringify(payload, null, 2) + "\n");
  if (suite === "realLife" && records.length === 200) {
    for (const [arm, directory] of [["ai", flags.releaseOutput], ["baseline", flags.controlOutput]]) {
      if (!directory) continue;
      const summary = payload.summary[arm];
      const controls = records.filter(r => !r[arm].ok).map(r => r[arm].perfectControl).filter(Boolean);
      summary.perfectCropControl = { n: controls.length, ok: controls.filter(r => r.ok).length, acc: +(controls.filter(r => r.ok).length / (controls.length || 1)).toFixed(3) };
      summary.wasmHeapStartMB = summary.wasmHeapMB[0]; summary.wasmHeapEndMB = summary.wasmHeapMB[1];
      summary.firstHalfAcc = summary.firstHalf / 100; summary.secondHalfAcc = summary.secondHalf / 100;
      await mkdir(directory, {recursive:true});
      await writeFile(path.join(directory,"realLife.json"), JSON.stringify({build:records[0][arm].build, aiCropEnabled:arm === "ai" || flags.baselineAi === "1", mode:"realLife", summary,
        misses:records.filter(r=>!r[arm].ok && !r[arm].error).map(r=>({name:r.name,id:r.id,i:r.i,scene:r.scene,rot:r.rotation,layout:r.layout,coverage:r.coverage,got:r[arm].got,by:r[arm].by,trueRank:r[arm].trueRank,artBest:r[arm].artBest,aiCrop:r[arm].aiCrop,stages:r[arm].stages,ms:r[arm].ms,perfectControl:r[arm].perfectControl})),
        errors:records.filter(r=>r[arm].error).map(r=>({i:r.i,name:r.name,error:r[arm].error}))}, null, 2)+"\n");
    }
  }
  if (log) console.log(JSON.stringify(payload.summary));
}
