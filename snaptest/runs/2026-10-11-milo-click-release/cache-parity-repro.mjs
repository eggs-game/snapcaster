import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createReadStream} from "node:fs";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";
const repo=process.cwd(),frozen=path.resolve(process.env.CACHE_SOURCE_ROOT||repo),artifacts=path.dirname(fileURLToPath(import.meta.url));
const current=await readFile(path.join(frozen,"src/recognition/recognizer.js"),"utf8");
assert.ok(current.includes("referenceFeatureCache.length >= 120"),"run on a source checkout with the reviewed 120-entry cache");
const frozenSource=current.replace("referenceFeatureCache.length >= 120","referenceFeatureCache.length >= 60");
const bundle=async file=>(await build({entryPoints:[path.join(frozen,file)],bundle:true,write:false,format:"esm",logLevel:"silent"})).outputFiles[0].text;
const [matcher,ai]=await Promise.all([bundle("src/recognition/matcher.js"),bundle("src/recognition/aiCropWorker.js")]);
const hook=`
const __postCache=self.postMessage.bind(self);
self.postMessage=(message,...args)=>{
 message.referenceCacheStats={entries:referenceFeatureCache.length,handles:referenceFeatureCache.length*2,heapBytes:self.cv?.HEAPU8?.byteLength||null,
  descriptorBytes:referenceFeatureCache.reduce((n,e)=>n+e.features.desc.rows*e.features.desc.cols+e.features.kp.size()*28,0)};
 return __postCache(message,...args);
};
`;
const modules={};for(const capacity of [60,120]) {
 const prefix="/"+capacity;
 modules[prefix+"/matcher.js"]=matcher;modules[prefix+"/aiCropWorker.js"]=ai;
 modules[prefix+"/recognizer.js"]=frozenSource.replace("referenceFeatureCache.length >= 60","referenceFeatureCache.length >= "+capacity).replace("self.onmessage = async (e) => {",hook+"\nself.onmessage = async (e) => {");
}
const server=createServer((req,res)=>{
 const url=new URL(req.url,"http://localhost"),p=url.pathname;
 if(modules[p]){res.setHeader("Content-Type","text/javascript");return res.end(modules[p]);}
 if(/^\/(60|120)\/test$/.test(p)) {
  const capacity=p.split("/")[1];res.setHeader("Content-Type","text/html");return res.end(`<!doctype html><script>window.stats=[];window.phases=[];const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.addEventListener('message',e=>{const d=e.data;if(d.referenceCacheStats)window.stats.push(d.referenceCacheStats);if(d.matches&&d.orbTiming)window.phases.push({orb:d.orbTiming,milo:d.miloOrbTiming});});}};</script><script type="module">import * as matcher from '/${capacity}/matcher.js';window.matcher=matcher;await matcher.preload();window.ready=true;</script>`);
 }
 const file=path.resolve(repo,"public","."+p);if(!file.startsWith(path.join(repo,"public")+path.sep)){res.writeHead(404);return res.end();}
 const type=file.endsWith(".json")?"application/json":file.endsWith(".wasm")?"application/wasm":/\.m?js$/.test(file)?"text/javascript":file.endsWith(".jpg")?"image/jpeg":"application/octet-stream";
 res.setHeader("Content-Type",type);const stream=createReadStream(file);stream.on("error",()=>{res.writeHead(404);res.end();});stream.pipe(res);
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const captures=JSON.parse(await readFile(path.join(artifacts,"cache-inputs.json"),"utf8"));
const fixture=async index=>{const item=captures.find(r=>r.i===index),bytes=await readFile(path.join(artifacts,item.file));return{...item,source:"data:image/jpeg;base64,"+bytes.toString("base64"),sha256:createHash("sha256").update(bytes).digest("hex")};};
const geier=await fixture(188),reprieve=await fixture(15);
const inputs=[geier,{name:"Contagion",source:"/snaptest/arcane/medium/000.jpg",point:{nx:.5,ny:.5}},{name:"Arlinn Kord",source:"/snaptest/arcane/medium/034.jpg",point:{nx:.5,ny:.5}},reprieve,geier,geier,geier];
const photoManifest=JSON.parse(await readFile("public/snaptest/arcane/manifest.json","utf8"));inputs[1].source="/snaptest/arcane/medium/"+photoManifest.medium[0].file;inputs[2].source="/snaptest/arcane/medium/"+photoManifest.medium[34].file;
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",args:["--disable-background-timer-throttling","--disable-renderer-backgrounding"]});
const catalogHashes={};for(const file of ["public/carddata/manifest.json","public/carddata/cards.json","public/carddata/milo/manifest.json"])catalogHashes[file]=createHash("sha256").update(await readFile(path.join(repo,file))).digest("hex");
const arms={},records=[],report={scope:"Native exact60-versus120 descriptor-capacity control on identical frozen pipeline/source/images, default stopOFF. Timings are diagnostic recognition-only, no camera/display transport.",workerSHA256:createHash("sha256").update(current).digest("hex"),catalog:catalogHashes,catalogNote:"Archived proof used113263faces. This reproducer uses the working checkout public assets; for exact archived replay use its pinned source/catalog fingerprints.",records};
try {
 for(const capacity of [60,120]){const context=await browser.newContext(),page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/${capacity}/test?aiCrop=1&milo=1`);await page.waitForFunction(()=>window.ready,null,{timeout:120000});arms[capacity]=page;}
 for(let i=0;i<inputs.length;i++) {
  const record={i,name:inputs[i].name,sha256:inputs[i].sha256};
  for(const capacity of i%2?[120,60]:[60,120]){
   const page=arms[capacity];await page.bringToFront();record[capacity]=await page.evaluate(async input=>{window.stats=[];window.phases=[];const t=performance.now(),r=await window.matcher.identify(input.source,input.point),best=r.matches[0];return{ms:Math.round(performance.now()-t),best,artBest:r.art_best,blockedNames:r.blocked_names,stages:r.stage_ms,phases:window.phases,stats:window.stats};},inputs[i]);
   assert.ok(record[capacity].stats.every(s=>s.entries<=capacity&&s.handles<=capacity*2),"native ownership remains bounded");
  }
  assert.deepEqual(record[60].best,record[120].best,"capacity cannot change identity,printing,confidence,sourceproof or score");
  assert.deepEqual(record[60].artBest,record[120].artBest);assert.deepEqual(record[60].blockedNames,record[120].blockedNames);
  records.push(record);console.log(JSON.stringify({i,name:record.name,arms:[60,120].map(c=>({capacity:c,ms:record[c].ms,entries:record[c].stats.at(-1)?.entries,heap:record[c].stats.at(-1)?.heapBytes,misses:record[c].phases.map(p=>p.milo?p.milo.map(m=>m.refFeatureMisses):p.orb.refFeatureMisses)}))}));await save();
 }
 for(const capacity of [60,120]) {
  const tail=records.slice(-3).flatMap(r=>r[capacity].stats);
  assert.ok(tail.every(s=>s.entries===capacity),"native cache reaches the actual fixed-capacity plateau");
  assert.equal(new Set(tail.map(s=>s.heapBytes)).size,1,"OpenCV native heap remains flat across repeated eviction/reuse");
  assert.ok(tail[0].heapBytes>0);
 }
 report.ok=true;await save();
}finally{await save();await browser.close();await new Promise(r=>server.close(r));}
async function save(){await mkdir(".cache/reference-cache",{recursive:true});await writeFile(".cache/reference-cache/native-parity.json",JSON.stringify(report,null,2));}
