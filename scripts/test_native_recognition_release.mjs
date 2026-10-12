import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateNativePair, validateNativeTailPair, NATIVE_PAIR_THRESHOLDS, NATIVE_TAIL_THRESHOLDS } from "./check_native_card_delivery_pair.mjs";
import { validateNativeReleaseEvidence, readNativeReleaseEvidence, assertNativeMatrixPrecision, assertNativePrimaryRetention, sha256, listRecognitionSources } from "./native_recognition_release.mjs";

// Historical report bodies are structural fixtures only. These tests replace
// build/source/catalog metadata deliberately; they make no performance claim.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const json=file=>JSON.parse(readFileSync(path.join(root,file)));
const policy=json("snaptest/runs/2026-10-12-milo-click-release/policy.json");
assert.ok(Number.isFinite(Date.parse(policy.predeclaredAt)),"Record policy declaration time before the full native outcome");
assert.deepEqual(policy.median,NATIVE_PAIR_THRESHOLDS,"Retain the recorded original median policy");
assert.deepEqual(policy.tail,NATIVE_TAIL_THRESHOLDS,"Retain the recorded alternate tail policy");
const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"});
const files=listRecognitionSources(root);
const mainFiles=git("ls-tree","-r","--name-only","main","--","src").trim().split("\n").filter(file=>/\.(jsx?|css)$/.test(file));
const build=source=>JSON.parse(source.match(/const BUILD = ("[^"]+")/)?.[1]);
const snapshot={build:build(readFileSync(path.join(root,"src/main.jsx"),"utf8")),controlBuild:build(git("show","main:src/main.jsx")),controlCommit:git("rev-parse","main").trim(),
  sourceDigests:Object.fromEntries(files.map(file=>[file,sha256(readFileSync(path.join(root,file)))])),
  controlSourceDigests:Object.fromEntries(mainFiles.map(file=>[file,sha256(git("show",`main:${file}`))])),
  catalogDigests:Object.fromEntries(["public/carddata/manifest.json","public/carddata/cards.json","public/carddata/milo/manifest.json"].map(file=>[file,sha256(readFileSync(path.join(root,file)))])),
};
const catalog={manifest:json("public/carddata/manifest.json"),milo:json("public/carddata/milo/manifest.json")};
function fixture(file,candidate=false) {
  const result=json(file);
  result.build=candidate?snapshot.build:snapshot.controlBuild;result.commit=candidate?"working-source-fixture":snapshot.controlCommit;
  result.sourceDigests=structuredClone(candidate?snapshot.sourceDigests:snapshot.controlSourceDigests);
  result.catalogDigests=structuredClone(snapshot.catalogDigests);result.catalog=structuredClone(catalog);
  return result;
}
const control=fixture("snaptest/runs/2026-10-11-milo-click-release/native-control-200.json");
const candidate=fixture("snaptest/runs/2026-10-11-milo-click-release/native-candidate-200.json",true);
const pair=validateNativePair(control,candidate);
assert.equal(pair.ok,true,JSON.stringify(pair.failures));
assert.equal(validateNativeReleaseEvidence(pair,control,candidate,snapshot).ok,true);

const tailCandidate=structuredClone(candidate);
for(const row of tailCandidate.rows)if(row.fresh.displayMs!=null) {
  const value=row.fresh,ms=Math.max(value.timing.captureMs+20,Math.floor(value.displayMs*.7));
  value.displayMs=ms;value.timing.totalMs=ms-10;value.timing.recognitionMs=ms-10-value.timing.captureMs;
}
const tailPair=validateNativeTailPair(control,tailCandidate);
assert.equal(tailPair.ok,true,JSON.stringify(tailPair.failures));
assert.equal(validateNativeReleaseEvidence(tailPair,control,tailCandidate,snapshot).ok,true);

function reject(change,pattern=/native/) {
  const a=structuredClone(control),b=structuredClone(candidate),s=structuredClone(snapshot);
  change(a,b,s);const p=validateNativePair(a,b);p.ok=true;
  assert.throws(()=>validateNativeReleaseEvidence(p,a,b,s),pattern);
}
reject((_a,b)=>b.rows.pop(),/all200|200|complete/);
reject((_a,b)=>{b.build="old candidate";},/current final BUILD/);
reject((_a,b)=>{b.sourceDigests["src/recognition/miloBackend.js"]=sha256("different backend");},/candidate source/);
reject((_a,b)=>{delete b.sourceDigests["src/main.jsx"];},/candidate source/);
reject(a=>{a.commit="old main";},/current main commit/);
reject((_a,_b,s)=>{s.catalogDigests["public/carddata/cards.json"]=sha256("new catalog");},/catalog/);
reject((_a,b)=>{b.rows[0].fresh.got="wrong accepted card";b.rows[0].fresh.correct=false;},/wrong confident|regressed/);
reject(a=>{a.rows[0].fresh.got="wrong control card";a.rows[0].fresh.correct=false;},/every confident result/);
const weakened=structuredClone(pair);weakened.thresholds.maxFreshMedianRatio=.95;
assert.throws(()=>validateNativeReleaseEvidence(weakened,control,candidate,snapshot),/predeclared/);
const weakCount=structuredClone(pair);weakCount.thresholds.minFreshUnder1Gain=4;
assert.throws(()=>validateNativeReleaseEvidence(weakCount,control,candidate,snapshot),/predeclared/);
const weakTail=structuredClone(tailPair);weakTail.thresholds.maxFreshP90Ratio=.9;
assert.throws(()=>validateNativeReleaseEvidence(weakTail,control,tailCandidate,snapshot),/predeclared/);
const weakTailCount=structuredClone(tailPair);weakTailCount.thresholds.minFreshUnder1Gain=9;
assert.throws(()=>validateNativeReleaseEvidence(weakTailCount,control,tailCandidate,snapshot),/predeclared/);
const forged=structuredClone(pair);forged.gains.fresh.correctUnder1s=999;
assert.throws(()=>validateNativeReleaseEvidence(forged,control,candidate,snapshot),/saved gains/);
const changedPixels=structuredClone(candidate);changedPixels.rows[0].fresh.capture.sha256=sha256("new camera pixels");
assert.throws(()=>validateNativeReleaseEvidence(pair,control,changedPixels,snapshot),/capture hash/);

const primary=json("snaptest/runs/2026-10-11-milo-adaptive-release/candidate/realLife.json");
assertNativePrimaryRetention(primary,primary);assertNativeMatrixPrecision(primary,"realLife");
const lost=structuredClone(primary),oldCorrect=Array.from({length:200},(_,i)=>i).find(i=>!primary.misses.some(m=>m.i===i));
lost.misses[0]={...lost.misses[0],i:oldCorrect,id:"a-previously-correct-printing",name:"Newly missed card"};
assert.throws(()=>assertNativePrimaryRetention(lost,primary),/individually regressed/);
const duplicate=structuredClone(primary);duplicate.misses[1]={...duplicate.misses[0]};
assert.throws(()=>assertNativePrimaryRetention(duplicate,primary),/duplicate/);
const imprecise=structuredClone(primary);imprecise.summary.byPathway["art-match"].ok--;
assert.throws(()=>assertNativeMatrixPrecision(imprecise,"realLife"),/every confident/);
const hidden=structuredClone(primary);hidden.misses[0].by="art-match";
assert.throws(()=>assertNativeMatrixPrecision(hidden,"realLife"),/confident miss/);
const ocr=structuredClone(primary);ocr.summary.byPathway["ocr-title"]={n:2,ok:1};
assert.throws(()=>assertNativeMatrixPrecision(ocr,"realLife"),/ocr-title/);

const temporary=mkdtempSync(path.join(tmpdir(),"snapcast-native-release-"));
try {
  const controlFile=path.join(temporary,"native-control.json"),candidateFile=path.join(temporary,"native-candidate.json"),evidenceFile=path.join(temporary,"native-pair.json");
  const save=(file,value)=>writeFileSync(file,JSON.stringify(value));
  save(controlFile,control);save(candidateFile,candidate);
  const evidence={...pair,inputs:Object.fromEntries([["control",controlFile],["candidate",candidateFile]].map(([arm,file])=>[arm,{file:path.basename(file),sha256:sha256(readFileSync(file))}]))};
  save(evidenceFile,evidence);assert.equal(readNativeReleaseEvidence(evidenceFile,snapshot).ok,true);
  save(evidenceFile,{ok:true});assert.throws(()=>readNativeReleaseEvidence(evidenceFile,snapshot),/report reference/);
  save(evidenceFile,evidence);writeFileSync(candidateFile,readFileSync(candidateFile,"utf8")+" ");
  assert.throws(()=>readNativeReleaseEvidence(evidenceFile,snapshot),/input SHA256/);save(candidateFile,candidate);

  const candidateDirectory=path.join(temporary,"candidate"),controlDirectory=path.join(temporary,"control");
  mkdirSync(candidateDirectory);mkdirSync(controlDirectory);
  const matrix=["realLife","tableauEdh10","tableauVegasEdh20","tableauEdhDice10","random200","edh200","recentHint20"];
  for(const mode of matrix) {
    const report=json(`snaptest/runs/2026-10-11-milo-adaptive-release/candidate/${mode}.json`);report.build=snapshot.build;
    save(path.join(candidateDirectory,mode+".json"),report);
    if(mode==="realLife"){const main=structuredClone(report);main.build=snapshot.controlBuild;save(path.join(controlDirectory,mode+".json"),main);}
  }
  const run=(...args)=>spawnSync(process.execPath,["scripts/check_recognition_release.mjs",candidateDirectory,controlDirectory,...args],{cwd:root,encoding:"utf8"});
  save(evidenceFile,evidence);
  let result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/noise band/,"Ordinary accuracy improvement remains strict");
  result=run("--native-improvement="+evidenceFile);assert.equal(result.status,0,result.stderr);
  result=run("--native-improvement="+evidenceFile,"--primary");assert.notEqual(result.status,0);assert.match(result.stderr,/complete recognition matrix/);
  save(evidenceFile,{ok:true});result=run("--native-improvement="+evidenceFile);assert.notEqual(result.status,0);assert.match(result.stderr,/report reference/);
  save(evidenceFile,evidence);const broad=json("snaptest/runs/2026-10-11-milo-adaptive-release/candidate/tableauVegasEdh20.json");broad.build=snapshot.build;broad.summary.byPathway["art-match"].ok--;
  save(path.join(candidateDirectory,"tableauVegasEdh20.json"),broad);result=run("--native-improvement="+evidenceFile);assert.notEqual(result.status,0);assert.match(result.stderr,/every confident/);

  const exported=path.join(temporary,"cli-pair.json");
  result=spawnSync(process.execPath,["scripts/check_native_card_delivery_pair.mjs",controlFile,candidateFile,"--output="+exported],{cwd:root,encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);assert.equal(readNativeReleaseEvidence(exported,snapshot).ok,true,"CLI evidence references remain portable and SHA-bound");
} finally {rmSync(temporary,{recursive:true,force:true});}
console.log("Native alternate release mode revalidates exact 200-pair current-source evidence, enforces predeclared material speed, full-matrix confident precision and individual primary retention; ordinary/photo gates remain unchanged");
