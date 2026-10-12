#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readNativeReleaseEvidence, assertNativeMatrixPrecision, assertNativePrimaryRetention, sha256 } from "./native_recognition_release.mjs";
const directory = process.argv[2] || ".cache/recognition-release/click-match-1";
const gates = { realLife: [200, 0], tableauEdh10: [100, .92], tableauVegasEdh20: [200, .83], tableauEdhDice10: [100, .90], random200: [200, .95], edh200: [200, .93] };
const primaryOnly=process.argv.includes("--primary");
const broadOnly=process.argv.includes("--broad");
assert.ok(!(primaryOnly && broadOnly),"choose one partial check scope");
let candidateBuild;
const photoEvidencePath=process.argv.find(arg=>arg.startsWith("--photo-improvement="))?.slice("--photo-improvement=".length);
const nativeEvidencePath=process.argv.find(arg=>arg.startsWith("--native-improvement="))?.slice("--native-improvement=".length);
let nativePair;
if (nativeEvidencePath !== undefined) {
  assert.ok(nativeEvidencePath, "native improvement requires an evidence file");
  assert.ok(!photoEvidencePath, "choose one alternate improvement evidence mode");
  assert.ok(!primaryOnly && !broadOnly, "native improvement requires the complete recognition matrix, not a partial check");
  assert.ok(process.argv[3] && !process.argv[3].startsWith("--"), "native improvement requires a current-main control directory");
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"});
  const sourceFiles=execFileSync("rg",["--files","src"],{cwd:root,encoding:"utf8"}).trim().split("\n").filter(file=>/\.(jsx?|css)$/.test(file));
  const mainFiles=git("ls-tree","-r","--name-only","main","--","src").trim().split("\n").filter(file=>/\.(jsx?|css)$/.test(file));
  const build=source=>JSON.parse(source.match(/const BUILD = ("[^"]+")/)?.[1] || '"unknown"');
  const snapshot={
    build:build(readFileSync(path.join(root,"src/main.jsx"),"utf8")),
    controlBuild:build(git("show","main:src/main.jsx")),controlCommit:git("rev-parse","main").trim(),
    sourceDigests:Object.fromEntries(sourceFiles.map(file=>[file,sha256(readFileSync(path.join(root,file)))])),
    controlSourceDigests:Object.fromEntries(mainFiles.map(file=>[file,sha256(git("show",`main:${file}`))])),
    catalogDigests:Object.fromEntries(["public/carddata/manifest.json","public/carddata/cards.json","public/carddata/milo/manifest.json"].map(file=>[file,sha256(readFileSync(path.join(root,file)))])),
  };
  nativePair=readNativeReleaseEvidence(path.resolve(nativeEvidencePath),snapshot);
}
let photoPair;
if (photoEvidencePath) {
  // A photo-targeted release must prove its improvement on unchanged supplied
  // pixels, while retaining the primary crowded-table baseline below.
  const pair=JSON.parse(readFileSync(photoEvidencePath));
  photoPair=pair;
  const manifest=JSON.parse(readFileSync(new URL("../public/snaptest/arcane/manifest.json",import.meta.url))).medium;
  assert.equal(pair.suite,"arcane"); assert.equal(pair.severity,"medium");
  assert.equal(pair.paired,true); assert.equal(pair.baselineMilo,true);
  assert.equal(pair.completed,200); assert.equal(pair.records.length,200);
  for (const [i,row] of pair.records.entries()) {
    assert.equal(row.id,manifest[i].id,"same supplied photo identity and order");
    assert.equal(row.file,manifest[i].file,"same supplied source pixels");
    assert.equal(row.name,manifest[i].name,"unchanged photo ground truth");
    assert.equal(row.ai.build,pair.build,"one candidate build throughout");
    assert.equal(row.baseline.build,pair.records[0].baseline.build,"one frozen main throughout");
    assert.ok(!row.ai.error && !row.baseline.error,"photo scans have no errors");
  }
  const count=arm=>pair.records.filter(r=>r[arm].ok).length;
  const accepted=pair.records.filter(r=>["art-match","visual-exact"].includes(r.ai.by));
  assert.ok(accepted.every(r=>r.ai.ok),"photo: every confident result is correct");
  assert.ok(count("ai")-count("baseline")>4,"photo: gain exceeds the documented noise band");
  assert.ok(pair.records.every(r=>!r.baseline.ok || r.ai.ok),"photo: no individually regressed identity");
  assert.ok(pair.summary.ai.medianMs < pair.summary.baseline.medianMs*.8,"photo: material median speedup");
  assert.ok(pair.summary.ai.p90Ms < pair.summary.baseline.p90Ms,"photo: tail latency improves too");
  assert.ok(pair.records.filter(r=>r.ai.ok && r.ai.ms<1000).length > pair.records.filter(r=>r.baseline.ok && r.baseline.ms<1000).length+4,"photo: more correct subsecond scans");
  console.log(`Supplied photos: ${count("baseline")}/200 -> ${count("ai")}/200; every confident result correct`);
}
for (const [mode, [n, accuracy]] of Object.entries(primaryOnly ? {realLife:gates.realLife} : broadOnly ? Object.fromEntries(Object.entries(gates).filter(([mode])=>mode!=="realLife")) : gates)) {
  const result = JSON.parse(readFileSync(path.join(directory, mode + ".json")));
  const s = result.summary;
  candidateBuild ??= result.build;
  assert.equal(result.build,candidateBuild,"one candidate build across the checked release suites");
  if (nativePair) {
    assert.equal(result.build,nativePair.builds.candidate,"same current candidate in native and recognition suites");
    assertNativeMatrixPrecision(result,mode);
  }
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
      if (photoPair) {
        assert.equal(result.build,photoPair.build,"same candidate in photo and crowded-table suites");
        assert.equal(control.build,photoPair.records[0].baseline.build,"same current-main control in both suites");
      }
      if (nativePair) {
        assert.equal(control.build,nativePair.builds.control,"same current-main control in native and primary recognition suites");
        assertNativePrimaryRetention(result,control);
      }
      assert.equal(control.summary.n, 200); assert.equal(control.summary.errors, 0);
      assert.ok(s.accuracy >= control.summary.accuracy, "Real life: no regression against current-main control");
      if (!photoEvidencePath && !nativePair) assert.ok(control.misses.length - result.misses.length > 4, "Real life: improvement must exceed the documented two-card-per-100 noise band");
      const oldMisses = new Map(control.misses.map(m => [m.i, m]));
      const newMisses = new Map(result.misses.map(m => [m.i, m]));
      for (const [i,m] of newMisses) if (oldMisses.has(i)) assert.equal(m.id,oldMisses.get(i).id,"same deterministic card draw");
      if (photoEvidencePath) assert.ok([...newMisses.keys()].every(i=>oldMisses.has(i)),"photo release: no individually regressed crowded-table identity");
      console.log(`Real life versus current main: ${[...oldMisses.keys()].filter(i=>!newMisses.has(i)).length} recovered; ${[...newMisses.keys()].filter(i=>!oldMisses.has(i)).length} regressed`);
    }
  }
  console.log(`${mode}: release gates passed (${s.accuracy * 100}%; median ${s.medianMs}ms; p90 ${s.p90Ms}ms)`);
}
if(primaryOnly) process.exit(0);
const hintResult = JSON.parse(readFileSync(path.join(directory, "recentHint20.json")));
assert.equal(hintResult.build,candidateBuild,"same candidate in hint and recognition suites");
if (nativePair) assertNativeMatrixPrecision(hintResult,"recentHint20");
const hint = hintResult.summary;
assert.equal(hint.n, 20); assert.equal(hint.errors, 0); assert.equal(hint.accuracy, 1);
assert.equal(hint.recentHint.hits, hint.recentHint.attempted);
assert.equal(hint.recentHint.fullCropFallbacks.length, 0);
assert.equal(hint.wasmHeapStartMB, hint.wasmHeapEndMB);
assert.ok(hint.recentHint.speedup >= 2, "recent hints retain a material speedup");
console.log(`recentHint20: all verified, ${hint.recentHint.speedup}x faster, flat WASM heap`);
if (nativePair) console.log(`Native ${nativePair.policy}: ${nativePair.matchedCaptures} exact JPEG pairs, median ratio ${nativePair.gains.fresh.medianRatio.toFixed(3)}, p90 ratio ${nativePair.gains.fresh.p90Ratio.toFixed(3)}, +${nativePair.gains.fresh.correctUnder1s} correct under 1s; full matrix and confident precision retained`);
