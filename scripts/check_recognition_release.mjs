#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
const directory = process.argv[2] || ".cache/recognition-release/click-match-1";
const gates = { realLife: [200, 0], tableauEdh10: [100, .92], tableauVegasEdh20: [200, .83], tableauEdhDice10: [100, .90], random200: [200, .95], edh200: [200, .93] };
const primaryOnly=process.argv.includes("--primary");
for (const [mode, [n, accuracy]] of Object.entries(primaryOnly ? {realLife:gates.realLife} : gates)) {
  const result = JSON.parse(readFileSync(path.join(directory, mode + ".json")));
  const s = result.summary;
  assert.equal(s.n, n, `${mode}: complete all cards`);
  assert.equal(s.errors, 0, `${mode}: no scan errors`);
  assert.ok(s.accuracy >= accuracy, `${mode}: accuracy ${s.accuracy} < ${accuracy}`);
  for (const key of ["art-match", "visual-exact"]) {
    const bucket = s.byPathway[key];
    if (bucket) assert.ok((bucket.ok / bucket.n) >= (mode === "realLife" ? .99 : mode === "tableauVegasEdh20" ? .98 : 1), `${mode}: ${key} precision`);
  }
  if (mode === "tableauVegasEdh20") {
    assert.ok(s.byCoverage["0 (clear)"].acc >= .84, "Vegas: clear card accuracy");
    for (const [rotation, bucket] of Object.entries(s.byRotation)) assert.ok((bucket.ok / bucket.n) >= .77, `Vegas: ${rotation} accuracy`);
    assert.ok(result.misses.every(m => m.perfectControl), "Vegas: every miss has a perfect-crop control");
  }
  if (mode === "realLife") {
    assert.ok(process.argv[3], "Real life requires a current-main control directory for the deterministic comparison");
    assert.ok(result.misses.every(m => m.perfectControl), "Real life: every miss has a perfect-crop control");
    if (process.argv[3]) {
      const control = JSON.parse(readFileSync(path.join(process.argv[3], "realLife.json")));
      assert.equal(control.summary.n, 200); assert.equal(control.summary.errors, 0);
      assert.ok(s.accuracy >= control.summary.accuracy, "Real life: no regression against current-main control");
      assert.ok(control.misses.length - result.misses.length > 4, "Real life: improvement must exceed the documented two-card-per-100 noise band");
      const oldMisses = new Map(control.misses.map(m => [m.i, m]));
      const newMisses = new Map(result.misses.map(m => [m.i, m]));
      for (const [i,m] of newMisses) if (oldMisses.has(i)) assert.equal(m.id,oldMisses.get(i).id,"same deterministic card draw");
      console.log(`Real life versus current main: ${[...oldMisses.keys()].filter(i=>!newMisses.has(i)).length} recovered; ${[...newMisses.keys()].filter(i=>!oldMisses.has(i)).length} regressed`);
    }
  }
  console.log(`${mode}: release gates passed (${s.accuracy * 100}%; median ${s.medianMs}ms; p90 ${s.p90Ms}ms)`);
}
if(primaryOnly) process.exit(0);
const hint = JSON.parse(readFileSync(path.join(directory, "recentHint20.json"))).summary;
assert.equal(hint.n, 20); assert.equal(hint.errors, 0); assert.equal(hint.accuracy, 1);
assert.equal(hint.recentHint.hits, hint.recentHint.attempted);
assert.equal(hint.recentHint.fullCropFallbacks.length, 0);
assert.equal(hint.wasmHeapStartMB, hint.wasmHeapEndMB);
assert.ok(hint.recentHint.speedup >= 2, "recent hints retain a material speedup");
console.log(`recentHint20: all verified, ${hint.recentHint.speedup}x faster, flat WASM heap`);
