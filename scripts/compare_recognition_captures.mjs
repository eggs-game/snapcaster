// Replay exact saved misses in both frozen builds; not a headline timing run.
import assert from "node:assert/strict";
import {chromium} from "playwright";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import path from "node:path";
const [candidate,baseline,captures,output,modes="tableauEdh10,tableauEdhDice10"]=process.argv.slice(2);
if(!output)throw new Error("usage: CANDIDATE_URL BASELINE_URL CAPTURE_ROOT OUTPUT [MODES]");
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
const records=[],arms={};
try {
 for(const [arm,base] of [["candidate",candidate],["baseline",baseline]]) {
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(base+"/snaptest?aiCrop=1&milo=1");
  await page.waitForFunction(()=>window.__SNAP_RECOGNITION_WARMUP?.status==="ready"&&window.__SNAP_MILO_WARMUP?.status==="ready",null,{timeout:90000});
  arms[arm]=page;
 }
 for(const mode of modes.split(",")) {
  const directory=path.join(captures,mode);
  const manifest=JSON.parse(await readFile(path.join(directory,"manifest.json"),"utf8"));
  for(const item of manifest) {
   assert.ok(item.point,"saved original click required");
   const source="data:image/"+(item.file.endsWith(".png")?"png":"jpeg")+";base64,"+(await readFile(path.join(directory,item.file))).toString("base64");
   const record={mode,file:item.file,name:item.name,id:item.id,point:item.point};
   for(const arm of records.length%2?["candidate","baseline"]:["baseline","candidate"]) {
    await arms[arm].bringToFront();
    record[arm]=await arms[arm].evaluate(async({source,item})=>{
     const r=await window.__scIdentifyUrl(source,item.point),best=r.matches[0];
     return{build:window.__SNAP_BUILD,got:best?.name,ok:best?.name===item.name,by:best?.identified_by,artBest:r.art_best,aiCrop:r.ai_crop,milo:r.milo};
    },{source,item});
   }
   records.push(record);console.log(JSON.stringify({mode,name:item.name,baseline:record.baseline.ok,candidate:record.candidate.ok}));
  }
 }
 const regressed=records.filter(r=>r.baseline.ok&&!r.candidate.ok);
 await mkdir(path.dirname(output),{recursive:true});
 await writeFile(output,JSON.stringify({purpose:"Exact saved suite misses, paired replay outside headline timing; fresh contexts and identical pixels/clicks",n:records.length,baselineCorrect:records.filter(r=>r.baseline.ok).length,candidateCorrect:records.filter(r=>r.candidate.ok).length,regressed:regressed.map(r=>({mode:r.mode,file:r.file,name:r.name})),records},null,2)+"\n");
 assert.equal(regressed.length,0,"saved broad-suite captures preserve every current-main identity");
 for(const r of records)assert.ok(!["art-match","visual-exact"].includes(r.candidate.by)||r.candidate.ok,"saved captures retain confident precision");
}finally{await browser.close();}
