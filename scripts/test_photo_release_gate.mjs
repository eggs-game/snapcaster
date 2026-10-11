import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const directory=mkdtempSync(path.join(tmpdir(),"snapcast-photo-gate-"));
try {
  const candidate=path.join(directory,"candidate"), control=path.join(directory,"control");
  mkdirSync(candidate);mkdirSync(control);
  const real=JSON.parse(readFileSync(new URL("../snaptest/runs/2026-10-11-milo-adaptive-release/candidate/realLife.json",import.meta.url)));
  const candidateReal={...structuredClone(real),build:"test-photo"}, controlReal={...structuredClone(real),build:"test-main"};
  const manifest=JSON.parse(readFileSync(new URL("../public/snaptest/arcane/manifest.json",import.meta.url))).medium;
  const pair={suite:"arcane",severity:"medium",paired:true,baselineMilo:true,completed:200,build:"test-photo",
    records:manifest.map((r,i)=>({...r,baseline:{build:"test-main",ok:i>=40,ms:4000},ai:{build:"test-photo",ok:true,by:"art-match",ms:500}})),
    summary:{baseline:{medianMs:4000,p90Ms:5000},ai:{medianMs:500,p90Ms:800}}};
  const evidence=path.join(directory,"pair.json");
  const write=()=>{
    writeFileSync(path.join(candidate,"realLife.json"),JSON.stringify(candidateReal));
    writeFileSync(path.join(control,"realLife.json"),JSON.stringify(controlReal));
    writeFileSync(evidence,JSON.stringify(pair));
  };
  const run=(photo=true)=>spawnSync(process.execPath,["scripts/check_recognition_release.mjs",candidate,control,"--primary",...(photo?["--photo-improvement="+evidence]:[])],{encoding:"utf8"});
  write();
  let r=run(false);assert.notEqual(r.status,0);assert.match(r.stderr,/noise band/,"the ordinary primary gate is still strict");
  r=run();assert.equal(r.status,0,r.stderr);
  pair.records[0].ai.ok=false;write();r=run();assert.notEqual(r.status,0);assert.match(r.stderr,/confident result/);
  pair.records[0].ai.ok=true;
  pair.records[1].file="different-pixels.jpg";write();r=run();assert.notEqual(r.status,0);assert.match(r.stderr,/source pixels/);
  pair.records[1].file=manifest[1].file;
  const firstCorrect=manifest.findIndex((_,i)=>!controlReal.misses.some(m=>m.i===i));
  candidateReal.misses[0].i=firstCorrect;write();r=run();assert.notEqual(r.status,0);assert.match(r.stderr,/regressed crowded-table/);
  candidateReal.misses=structuredClone(real.misses);
  pair.records=pair.records.map(r=>({...r,ai:{...r.ai,ok:r.baseline.ok,by:undefined}}));write();r=run();
  assert.notEqual(r.status,0);assert.match(r.stderr,/gain exceeds/);
  for(const mode of ["tableauEdh10","tableauVegasEdh20","tableauEdhDice10","random200","edh200","recentHint20"]) {
    const report=JSON.parse(readFileSync(new URL(`../snaptest/runs/2026-10-11-milo-adaptive-release/candidate/${mode}.json`,import.meta.url)));
    report.build="test-photo";writeFileSync(path.join(candidate,mode+".json"),JSON.stringify(report));
  }
  const broad=()=>spawnSync(process.execPath,["scripts/check_recognition_release.mjs",candidate,"--broad"],{encoding:"utf8"});
  r=broad();assert.equal(r.status,0,r.stderr);
  const mixedPath=path.join(candidate,"edh200.json"),mixed=JSON.parse(readFileSync(mixedPath));
  mixed.build="older-build";writeFileSync(mixedPath,JSON.stringify(mixed));
  r=broad();assert.notEqual(r.status,0);assert.match(r.stderr,/one candidate build/);
  console.log("Photo releases require significant paired gains, unchanged pixels and confident precision; crowded identities and the ordinary primary noise gate remain protected");
} finally {rmSync(directory,{recursive:true,force:true});}
