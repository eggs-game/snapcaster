import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const matcher=readFileSync(new URL("../src/recognition/matcher.js",import.meta.url),"utf8");
const worker=readFileSync(new URL("../src/recognition/recognizer.js",import.meta.url),"utf8");
const modelAdapter=readFileSync(new URL("../src/recognition/aiCrop.js",import.meta.url),"utf8");

// An interim image notification must not consume the final worker response,
// cancel its timeout, or revive a callback after the request has completed.
let cleared=0, previews=0, finals=0, finalResult;
const dispatch=vm.createContext({URL,Worker:class{},clearTimeout(){cleared++;},withoutBlockedNeighbours:r=>r});
vm.runInContext("let worker=null;globalThis.pending=new Map();"+matcher.slice(matcher.indexOf("function getWorker("),matcher.indexOf("function withoutBlockedNeighbours("))
  .replaceAll("import.meta.url","'http://localhost/src/recognition/matcher.js'"),dispatch);
dispatch.pending.set(7,{timer:1,onMilo:()=>previews++,resolve:result=>{finals++;finalResult=result;},reject:assert.fail});
const channel=dispatch.getWorker();
channel.onmessage({data:{id:7,type:"milo-preview",images:[{}]}});
assert.equal(previews,1);assert.equal(finals,0);assert.equal(cleared,0);assert.equal(dispatch.pending.size,1);
const cachedPreview={scryfall_id:"verified-printing",face:1,blob:new Blob(["already-downloaded-reference"],{type:"image/jpeg"})};
channel.onmessage({data:{id:7,matches:[{name:"Verified"}],referencePreview:cachedPreview}});
channel.onmessage({data:{id:7,type:"milo-preview",images:[{}]}});
assert.equal(previews,1);assert.equal(finals,1);assert.equal(cleared,1);assert.equal(dispatch.pending.size,0);
assert.equal(finalResult.reference_preview,cachedPreview,"cached reference bytes travel with the final answer without another fetch or object URL");

// Prefetching cannot interpret stale rows, exceed the existing reference
// budget, or perform image requests for invalid/duplicated candidates.
const fetched=[];
const prefetch=vm.createContext({cards:Array(20),cardsSha256:"current",cardMeta:row=>({scryfall_id:row,face:row%2}),
  fetchReference:(id,face,size="small")=>fetched.push({id,face,size})});
vm.runInContext(worker.slice(worker.indexOf("function prefetchMiloRows("),worker.indexOf("async function verifyMiloRows(")),prefetch);
const rows=Array.from({length:20},(_,row)=>({row,score:.9}));
prefetch.prefetchMiloRows(rows,"stale");assert.equal(fetched.length,0);
prefetch.prefetchMiloRows(rows,"current");assert.equal(fetched.length,16);assert.equal(fetched.filter(r=>r.size==="normal").length,4);
fetched.length=0;
prefetch.prefetchMiloRows([{row:-1,score:1},{row:20,score:1},{row:0,score:NaN},{row:1,score:.9},{row:1,score:.9}],"current");
assert.equal(fetched.length,2);assert.equal(fetched[0].id,1);

const perform=matcher.slice(matcher.indexOf("async function performIdentify("),matcher.indexOf("let identifyActive"));
for (const scenario of ["rescue","clear","clear-failed","failed"]) {
  let lookups=0, prefetched=0, fallbacks=0, release;
  const clear=scenario.startsWith("clear");
  const images=[{}], lookup={rows:[{row:1,score:.9}],diagnostic:{status:"ready"}};
  const base={scan_id:7,matches:[{name:"Original",distance:190,...(clear?{identified_by:"art-match"}:{})}],
    art_decisive:clear,art_best:clear?{clickInside:true,inliers:50,clickInliers:50}:{},milo_images:images,stage_ms:{}};
  const context=vm.createContext({performance,VISUAL_EXACT_DISTANCE:90,
    sourceToBitmap:async()=>({close(){}}),createImageBitmap:async()=>({}),
    proposeAiCrops:async(_bmp,_point,retry)=>({quads:retry?[]:[{}],diagnostic:{status:"ready"}}),
    lookupAiCrops:input=>{lookups++;assert.equal(input,images);return scenario==="failed"?Promise.reject(new Error("model failed")):
      clear?new Promise((resolve,reject)=>{release=()=>scenario==="clear-failed"?reject(new Error("late model failed")):resolve(lookup);}):Promise.resolve(lookup);},
    prefetchMiloReferences:()=>prefetched++,
    runOnWorker:async(_bmp,_point,_hints,_quads,aiOnly,_candidates,_milo,onMilo)=>{
      if(!aiOnly){fallbacks++;return{...base};}
      onMilo(images);assert.equal(lookups,1,"lookup starts before the hash verifier returns");return{...base};
    },
    runMiloVerification:async id=>{assert.equal(id,7);return{...base,milo_rescued:true,matches:[{name:"Verified",distance:140}]};},
    finishIdentify:async r=>r,
  });
  vm.runInContext(perform,context);
  let settled=false;
  const job=context.performIdentify("capture",{},[],true,true).then(r=>{settled=true;return r;});
  if(clear) {await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,true,"a verified artwork answer must settle before unused lookup work");}
  const result=await job;
  assert.equal(lookups,1,"reuse speculative rows instead of embedding twice");
  assert.equal(fallbacks,scenario==="failed"?1:0);
  assert.equal(prefetched,scenario==="failed"||clear?0:1);
  assert.equal(result.matches[0].name,scenario==="rescue"?"Verified":"Original");
  if(scenario==="rescue") assert.equal(result.milo.rescued,true);
  if(clear) {
    assert.equal(result.milo.unused,true);assert.equal(result.milo.pending,true);
    const published=JSON.stringify(result);
    release();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(JSON.stringify(result),published,"late success/failure must not mutate the published answer or timings");
    assert.equal(prefetched,scenario==="clear-failed"?0:1);
    assert.equal(fallbacks,0,"a failed unused lookup cannot turn a verified answer into fallback");
  }
}

// The actual shared model adapter already owns callback serialization. A later
// crop/lookup cannot overwrite the handler of an unused speculative lookup.
let releaseModel;
const modelCalls=[];
const models=vm.createContext({
  runMilo:(_type,images)=>{
    modelCalls.push(images[0]);
    return images[0]==="old-lookup"?new Promise(resolve=>{releaseModel=()=>resolve("old-result");}):Promise.resolve("new-result");
  },
  runProposal:async bitmap=>{modelCalls.push(bitmap);return "new-crop";},
});
vm.runInContext(modelAdapter.slice(modelAdapter.indexOf("let proposalQueue ="),modelAdapter.indexOf("let warmupPromise;")).replaceAll("export function ","function "),models);
const oldLookup=models.lookupAiCrops(["old-lookup"]);
await new Promise(resolve=>setImmediate(resolve));
const nextCrop=models.proposeAiCrops("next-crop",{});
const nextLookup=models.lookupAiCrops(["next-lookup"]);
await new Promise(resolve=>setImmediate(resolve));
assert.deepEqual(modelCalls,["old-lookup"],"a later job must wait at the model adapter, not hold an already-safe answer");
releaseModel();
assert.equal(await oldLookup,"old-result");assert.equal(await nextCrop,"new-crop");assert.equal(await nextLookup,"new-result");
assert.deepEqual(modelCalls,["old-lookup","next-crop","next-lookup"]);
console.log("Parallel Milo returns verified answers before unused lookup, retains model/request ownership, bounded prefetch, immutable diagnostics and failed-model fallback");
