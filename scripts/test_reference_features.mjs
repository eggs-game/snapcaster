import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../src/recognition/recognizer.js",import.meta.url),"utf8");
const helpers=source.slice(source.indexOf("const referenceFeatureCache ="),source.indexOf("function orbAlignment("));
let alive=0,calls=0;
const handle=()=>{alive++;let deleted=false;return{delete(){assert.equal(deleted,false,"native handles must not be freed twice");deleted=true;alive--;}};};
const orbFeatures=(image,n,contrast)=>{calls++;assert.equal(n,300);return{kp:handle(),desc:handle(),signature:`${image.id}:${!!contrast}`};};
const context=vm.createContext({orbFeatures});vm.runInContext(helpers,context);
const images=Array.from({length:80},(_,id)=>({id}));
const first=context.referenceFeatures(images[0]);context.releaseReferenceFeatures(first);
assert.equal(alive,2,"the cache owns borrowed native features after verification");
assert.equal(context.referenceFeatures(images[0]),first);assert.equal(calls,1,"reuse the exact same public-reference descriptor");
const contrast=context.referenceFeatures(images[0],true);
assert.notEqual(contrast,first);assert.notEqual(contrast.signature,first.signature,"contrast and raw features cannot share an entry");
for(let i=0;i<600;i++) {
 const f=context.referenceFeatures(images[i%80],i%3===0);
 assert.equal(f.signature,`${i%80}:${i%3===0}`);
 context.releaseReferenceFeatures(f);assert.ok(alive<=120,"retain at most sixty keypoint/descriptor pairs");
}
assert.equal(alive,120);
const fallback=vm.createContext({orbFeatures,WeakRef:undefined});vm.runInContext(helpers,fallback);
const uncached=fallback.referenceFeatures(images[0]);assert.equal(uncached.cachedReference,undefined);
fallback.releaseReferenceFeatures(uncached);assert.equal(alive,120,"older browsers release uncached native features normally");
console.log("Reference descriptors preserve identity and contrast mode; native ownership stays bounded across repeated eviction and reuse");
