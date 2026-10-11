import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const matcher = readFileSync(new URL("../src/recognition/matcher.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
const perform = matcher.slice(matcher.indexOf("async function performIdentify("), matcher.indexOf("let identifyActive"));
for (const scenario of ["portrait", "landscape", "weak", "wide", "four-three", "milo-off", "ai-off", "hint"]) {
  const direct = ["portrait", "landscape", "weak"].includes(scenario);
  const hints = scenario === "hint" ? [{}] : [];
  const calls = [], detectorCalls = [];
  let closed = 0;
  const context = vm.createContext({performance, VISUAL_EXACT_DISTANCE:90,
    sourceToBitmap:async()=>({width:scenario==="four-three"?800:scenario==="wide"?900:scenario==="landscape"?680:488,
      height:scenario==="four-three"?600:scenario==="wide"?500:scenario==="landscape"?488:680,close(){closed++;}}),
    createImageBitmap:async()=>({}),
    proposeAiCrops:async(_bmp,_point,retry)=>{detectorCalls.push(!!retry);return{quads:[],diagnostic:{status:"ready"}};},
    runOnWorker:async(_bmp,_point,_hints,_quads,aiOnly)=>{
      calls.push(aiOnly);return{matches:[{name:"Verified",distance:scenario==="weak"?190:80}],stage_ms:{}};
    },
    finishIdentify:async r=>r,
  });
  vm.runInContext(perform,context);
  const result = await context.performIdentify("photo",{nx:.5,ny:.5},hints,scenario!=="ai-off",scenario!=="milo-off");
  assert.equal(calls[0],direct,scenario+": only card-shaped, unhinted, AI-enabled inputs use the direct trial");
  if (scenario==="weak") assert.equal(calls.at(-1),false,"a weak direct trial retains the full fallback");
  if (direct) assert.equal(result.ai_crop.status,"input-card");
  if (["portrait","landscape"].includes(scenario)) {
    assert.equal(detectorCalls.length,0,"verified direct reads skip corner inference");
    assert.equal(closed,1,"direct acceptance closes its source bitmap");
  }
  if (["hint","ai-off"].includes(scenario)) assert.equal(detectorCalls.length,0);
}

// The detailed references must contain additional pixels; thumbnails keep
// the hash contract's dimensions. Cache ownership and bitmap cleanup apply
// to both sizes, without touching the network in this check.
const canvases=[], urls=[];
let closed=0;
const context=vm.createContext({CARD_W:244,CARD_H:340,
  fetch:async url=>{urls.push(url);return{ok:true,blob:async()=>({})};},
  createImageBitmap:async()=>({close(){closed++;}}),
  OffscreenCanvas:class {
    constructor(width,height){this.width=width;this.height=height;canvases.push(this);}
    getContext(){return{drawImage(){},getImageData:(_x,_y,width,height)=>({width,height})};}
  },
});
vm.runInContext("const refCache=new Map();"+worker.slice(worker.indexOf("function fetchReference("),worker.indexOf("function orbFeatures(")),context);
const small=await context.fetchReference("abcdef",0), normal=await context.fetchReference("abcdef",0,"normal");
assert.equal(small.width,244);assert.equal(small.height,340);
assert.equal(normal.width,244);assert.equal(normal.height,340);
const detail=await context.fetchReference("abcdef",0,"detail");
assert.equal(detail.width,400);assert.equal(detail.height,557);
assert.equal(await context.fetchReference("abcdef",0,"detail"),detail);
assert.equal(await context.fetchReference("abcdef",0,"normal"),normal,"cache reuses detailed image separately");
assert.equal(urls.length,2);assert.equal(closed,3);
assert.ok(urls[1].includes("/normal/front/"));
assert.ok(canvases.every(c=>c.width===0&&c.height===0),"release temporary reference canvases");
console.log("Photo trials preserve fallback and kill switches; detailed references retain bounded extra pixels and release temporary buffers");

// Exercise real registration geometry at both reference resolutions. A
// clipped card with matching rules text can register; art alone, a weak
// template, excessive extrapolation and an outside click cannot acquire it.
const geometry=vm.createContext({CARD_W:244,CARD_H:340});
vm.runInContext(worker.slice(worker.indexOf("function orderCorners("),worker.indexOf("function findCardQuads(")),geometry);
vm.runInContext(worker.slice(worker.indexOf("function homographySourceQuad("),worker.indexOf("// Gray-world",worker.indexOf("function homographySourceQuad("))),geometry);
vm.runInContext(worker.slice(worker.indexOf("function contentSupportsIdentity("),worker.indexOf("function extendAiVerification(")),geometry);
vm.runInContext(worker.slice(worker.indexOf("function orbAlignment("),worker.indexOf("// Shared borders",worker.indexOf("function orbAlignment("))),geometry);
function registration({refWidth=244,count=40,text=10,clipped=true,cardWidth=500,cardHeight=700,click={x:215,y:300}}={}) {
  const refHeight=Math.round(refWidth*340/244);
  const points=Array.from({length:count},(_,i)=>({x:refWidth*(.2+(i%5)*.1),y:refHeight*(i<text?.7:.3)}));
  const H=[refWidth/cardWidth,0,refWidth*25/cardWidth,0,refHeight/cardHeight,refHeight*35/cardHeight,0,0,1];
  class Mat {delete(){}}
  class Matches {delete(){} size(){return count;} get(i){return{size:()=>2,delete(){},get:j=>({distance:j?80:10,queryIdx:i,trainIdx:i})};}}
  geometry.self={cv:{NORM_HAMMING:6,CV_32FC2:1,RANSAC:1,Mat,
    BFMatcher:class {knnMatch(){} delete(){}},DMatchVectorVector:Matches,
    matFromArray:()=>new Mat(),findHomography:(_q,_r,_method,_threshold,mask)=>{
      mask.rows=count;mask.data=Array(count).fill(1);return{rows:3,data64F:H,delete(){}};
    }}};
  const features={width:430,height:600,desc:{rows:count},kp:{get:i=>({pt:points[i]})}};
  return geometry.orbAlignment(features,{...features,width:refWidth,height:refHeight},click,null,clipped);
}
for(const refWidth of [244,400]) {
  const proof=registration({refWidth});
  assert.equal(proof.inside,true,"strong clipped printing owns the click at either reference resolution");
  assert.equal(proof.textInliers,10,"text bands scale with reference dimensions");
  assert.equal(proof.artInliers,30,"art bands scale with reference dimensions");
  assert.equal(registration({refWidth,clipped:false}).inside,null,"ordinary scenes retain the original area bound");
  assert.equal(registration({refWidth,text:0}).inside,null,"shared illustration cannot expand the footprint");
  assert.equal(registration({refWidth,count:30}).inside,null,"weak correspondence cannot expand the footprint");
  assert.equal(registration({refWidth,cardWidth:700,cardHeight:980}).inside,null,"the exception has a hard area bound");
  assert.equal(registration({refWidth,click:{x:600,y:300}}).inside,false,"extrapolation does not make a neighbour own the click");
}
console.log("Clipped registration retains printed-text, strength, bounded-area and outside-click guards at both resolutions");

// A registered, color-cast photo must compare consistent illumination
// variants. Only a positively registered footprint may replace crop color.
const rawFrame={color:[.1,.9],ring:[.1,.9]}, ref={color:[.9,.1],ring:[.9,.1]};
const balanced={color:[.8,.2],ring:[.8,.2]};
const colors=vm.createContext({source:{},ref,item:{color_sim:.2,ring_sim:.2},
  alignment:{inside:true,inliers:40,artInliers:20,textInliers:20,corners:[]},
  whiteBalance:()=>balanced,rectifyCard:()=>rawFrame,
  colorSignature:p=>p.color,ringSignature:p=>p.ring,contentSupportsIdentity:()=>true,
});
vm.runInContext(worker.slice(worker.indexOf("function colorSimilarity("),worker.indexOf("// Hue histogram",worker.indexOf("function colorSimilarity("))),colors);
vm.runInContext(worker.slice(worker.indexOf("function registeredColorAgreement("),worker.indexOf("const sharedArtworkCache")),colors);
const colorStart=worker.indexOf("// Moderate template coincidences");
const colorBlock=worker.slice(colorStart,worker.indexOf("          if (alignment.inside === true && alignment.inliers >= 16",colorStart));
vm.runInContext(colorBlock,colors);
assert.ok(colors.item.color_sim>.99&&colors.item.ring_sim>.99,"registered source and reference both receive the same balancing treatment");
colors.alignment.inside=false;colors.item={color_sim:.2,ring_sim:.2};vm.runInContext(colorBlock,colors);
assert.equal(colors.item.color_sim,.2,"a neighbour cannot replace clicked-crop color evidence");
console.log("Registered color comparisons correct lighting on both images and retain the clicked-footprint gate");
