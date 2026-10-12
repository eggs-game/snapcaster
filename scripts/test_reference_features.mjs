import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../src/recognition/recognizer.js",import.meta.url),"utf8");
const helpers=source.slice(source.indexOf("const referenceFeatureCache ="),source.indexOf("function orbAlignment("));
let alive=0,calls=0;
const handle=()=>{alive++;let deleted=false;return{delete(){assert.equal(deleted,false,"native handles must not be freed twice");deleted=true;alive--;}};};
const orbFeatures=(image,n,contrast,fastThreshold=20)=>{calls++;assert.equal(n,300);return{kp:handle(),desc:handle(),signature:`${image.id}:${!!contrast}:${fastThreshold}`};};
const context=vm.createContext({orbFeatures,orbTiming:{}});vm.runInContext(helpers,context);
const images=Array.from({length:80},(_,id)=>({id}));
const first=context.referenceFeatures(images[0]);context.releaseReferenceFeatures(first);
assert.equal(alive,2,"the cache owns borrowed native features after verification");
assert.equal(context.referenceFeatures(images[0]),first);assert.equal(calls,1,"reuse the exact same public-reference descriptor");
const contrast=context.referenceFeatures(images[0],true);
assert.notEqual(contrast,first);assert.notEqual(contrast.signature,first.signature,"contrast and raw features cannot share an entry");
const sensitive=context.referenceFeatures(images[0],true,8);
assert.notEqual(sensitive,contrast,"FAST8 and FAST20 must never share native descriptors for identical reference pixels");
assert.equal(sensitive.signature,"0:true:8");
assert.equal(context.referenceFeatures(images[0],true,8),sensitive);
assert.equal(context.referenceFeatures(images[0],true),contrast,"the extra pass cannot replace the original CLAHE descriptors");
const working=[];
for(const image of images.slice(0,52))for(const restored of [false,true]) {
 const features=context.referenceFeatures(image,restored);context.releaseReferenceFeatures(features);working.push({image,restored,features});
}
const computed=calls;
for(const {image,restored,features} of working) {
 const reused=context.referenceFeatures(image,restored);assert.equal(reused,features);context.releaseReferenceFeatures(reused);
}
assert.equal(calls,computed,"a104-entry raw/contrast retry working set must not churn between modes");
assert.equal(alive,210,"the cache owns exactlytwo native handles per retained view/contrast/threshold combination");
for(let i=0;i<600;i++) {
 const f=context.referenceFeatures(images[i%80],i%3===0);
 assert.equal(f.signature,`${i%80}:${i%3===0}:20`);
 context.releaseReferenceFeatures(f);assert.ok(alive<=240,"retain at most 120 keypoint/descriptor pairs");
}
assert.equal(alive,240);
assert.equal(vm.runInContext("referenceFeatureCache.length",context),120);
const fallback=vm.createContext({orbFeatures,WeakRef:undefined,orbTiming:{}});vm.runInContext(helpers,fallback);
const uncached=fallback.referenceFeatures(images[0]);assert.equal(uncached.cachedReference,undefined);
fallback.releaseReferenceFeatures(uncached);assert.equal(alive,240,"older browsers release uncached native features normally");
console.log("Reference descriptors preserve identity and contrast mode; native ownership stays bounded across repeated eviction and reuse");
