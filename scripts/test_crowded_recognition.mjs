#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const url = process.argv[2] || "http://127.0.0.1:4183";
const output = process.argv[3] || ".cache/crowded-regressions.json";
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const records=[];
try {
 const page = await browser.newPage();
 await page.goto(url + "/snaptest?debug=1");
 await page.waitForFunction(() => window.__SNAP_RECOGNITION_WARMUP?.status === "ready", null, { timeout: 90000 });
 const manifest = await page.evaluate(async () => (await (await fetch("/snaptest/regressions/manifest.json")).json()));
 for (const fixture of manifest.fixtures) for (const aiCrop of [false,true]) {
  const record = await page.evaluate(async ({fixture,aiCrop}) => {
   const start=performance.now();
   const result=await window.__scIdentifyUrl("/snaptest/regressions/"+fixture.file, fixture.point, [], { aiCrop });
   return { build:window.__SNAP_BUILD, expected:fixture.name, expectedOutcome:fixture.expectedOutcome, got:result.matches[0]?.name, aiCrop, ms:Math.round(performance.now()-start), by:result.matches[0]?.identified_by, artBest:result.art_best, blockedNames:result.blocked_names, ai:result.ai_crop, stages:result.stage_ms };
  },{fixture,aiCrop});
  records.push(record);console.log(JSON.stringify(record));
 }
} finally {
 await mkdir(output.slice(0,output.lastIndexOf("/")) || ".", {recursive:true});
 await writeFile(output,JSON.stringify(records,null,2)+"\n");
 await browser.close();
}
for (const record of records) {
 if(record.expectedOutcome === "correct-or-unresolved") assert.ok(record.got===record.expected || !record.by,`unresolved capture must not confidently name another card: ${record.expected}, AI=${record.aiCrop}`);
 else assert.equal(record.got,record.expected,`crowded regression ${record.expected}, AI=${record.aiCrop}`);
}
