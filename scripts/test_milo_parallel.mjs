import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const matcher=readFileSync(new URL("../src/recognition/matcher.js",import.meta.url),"utf8");
const worker=readFileSync(new URL("../src/recognition/recognizer.js",import.meta.url),"utf8");

// An interim image notification must not consume the final worker response,
// cancel its timeout, or revive a callback after the request has completed.
let cleared=0, previews=0, finals=0;
const dispatch=vm.createContext({URL,Worker:class{},clearTimeout(){cleared++;},withoutBlockedNeighbours:r=>r});
vm.runInContext("let worker=null;globalThis.pending=new Map();"+matcher.slice(matcher.indexOf("function getWorker("),matcher.indexOf("function withoutBlockedNeighbours("))
  .replaceAll("import.meta.url","'http://localhost/src/recognition/matcher.js'"),dispatch);
dispatch.pending.set(7,{timer:1,onMilo:()=>previews++,resolve:()=>finals++,reject:assert.fail});
const channel=dispatch.getWorker();
channel.onmessage({data:{id:7,type:"milo-preview",images:[{}]}});
assert.equal(previews,1);assert.equal(finals,0);assert.equal(cleared,0);assert.equal(dispatch.pending.size,1);
channel.onmessage({data:{id:7,matches:[{name:"Verified"}]}});
channel.onmessage({data:{id:7,type:"milo-preview",images:[{}]}});
assert.equal(previews,1);assert.equal(finals,1);assert.equal(cleared,1);assert.equal(dispatch.pending.size,0);

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
for (const scenario of ["rescue","clear","failed"]) {
  let lookups=0, prefetched=0, fallbacks=0, release;
  const images=[{}], lookup={rows:[{row:1,score:.9}],diagnostic:{status:"ready"}};
  const base={scan_id:7,matches:[{name:"Original",distance:scenario==="clear"?70:190}],art_best:{},milo_images:images,stage_ms:{}};
  const context=vm.createContext({performance,VISUAL_EXACT_DISTANCE:90,
    sourceToBitmap:async()=>({close(){}}),createImageBitmap:async()=>({}),
    proposeAiCrops:async(_bmp,_point,retry)=>({quads:retry?[]:[{}],diagnostic:{status:"ready"}}),
    lookupAiCrops:input=>{lookups++;assert.equal(input,images);return scenario==="failed"?Promise.reject(new Error("model failed")):
      scenario==="clear"?new Promise(resolve=>{release=()=>resolve(lookup);}):Promise.resolve(lookup);},
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
  if(scenario==="clear") {await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,"drain unused model work before accepting another click");release();}
  const result=await job;
  assert.equal(lookups,1,"reuse speculative rows instead of embedding twice");
  assert.equal(fallbacks,scenario==="failed"?1:0);
  assert.equal(prefetched,scenario==="failed"?0:1);
  assert.equal(result.matches[0].name,scenario==="rescue"?"Verified":"Original");
  if(scenario==="rescue") assert.equal(result.milo.rescued,true);
  if(scenario==="clear") assert.equal(result.milo.unused,true);
}
console.log("Parallel Milo retains request ownership, bounded/stale-safe prefetch, verified acceptance and failed-model fallback");
