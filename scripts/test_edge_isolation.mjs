import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../src/recognition/recognizer.js",import.meta.url),"utf8");
const gray={w:640,h:640,pix:new Uint8Array(640*640).fill(128)};
// A sideways card clipped by the top edge, with the supplied click below it.
for(let y=0;y<140;y++)for(let x=275;x<495;x++)gray.pix[y*640+x]=x<280||x>490||y>134?25:235;
const context=vm.createContext({performance,CARD_W:244,CARD_H:340,ISOLATION_CAP_SCALE:.5,isolationTiming:{},
 toGray:()=>gray,
 rotatedAnchoredCropImageData:(src,angle,scale,point,anchorV,anchorH,landscape)=>({angle,scale,point,anchorV,anchorH,landscape}),
});
vm.runInContext(source.slice(source.indexOf("function grayAt("),source.indexOf("// Scales the per-family")),context);
vm.runInContext(source.slice(source.indexOf("function localCardIsolationCandidates("),source.indexOf("// ── Learned card-quad detector")),context);
const candidates=context.localCardIsolationCandidates({}, {nx:.5,ny:.5});
const tapped=candidates.filter(c=>c.isolationFamily==="top-edge-tapped");
assert.equal(tapped.length,16,"the additive edge family has a bounded half-cap quota");
assert.ok(tapped.some(c=>c.isolationScore>30&&c.image.anchorV>2),"source boundary evidence frames a card over two short sides above the click");
for(const crop of tapped) {
 assert.equal(crop.image.landscape,true);
 const p=crop.image,ch=640*p.scale,cw=ch*340/244,angle=p.angle*Math.PI/180;
 const cy=320-Math.sin(angle)*(p.anchorH-.5)*cw-Math.cos(angle)*(p.anchorV-.5)*ch;
 const minY=cy-Math.abs(Math.sin(angle))*cw/2-Math.abs(Math.cos(angle))*ch/2;
 assert.ok(minY>=-.3*ch-1e-8&&minY<=.1*ch+1e-8,"retrieval is limited to the physical capture boundary");
 assert.equal(crop.sourceClick,undefined);assert.equal(crop.cameraToCrop,undefined,"isolation cannot create independent regional proof");
}
const inside=context.localCardIsolationCandidates({}, {nx:.5,ny:.5},{allowAboveClick:false});
assert.ok(inside.every(c=>!c.isolationFamily.startsWith("top-edge")),"a registered clicked-card outline suppresses both above-click families");
const families=["portrait","top-edge","top-edge-tapped","sideways-raw","sideways-rotated"];
const isolation=families.flatMap(family=>Array.from({length:3},(_,i)=>({candidate:{isolationFamily:family,strategy:`isolate-${family}-${i}`}})));
const bridge=vm.createContext({isolation});
const begin=source.indexOf("      const exactIsolation = new Set();");
vm.runInContext(source.slice(begin,source.indexOf("      for (const p of isolation)",begin))+"globalThis.selected=exactIsolation",bridge);
assert.equal(bridge.selected.size,10);
for(const family of families)assert.equal([...bridge.selected].filter(p=>p.candidate.isolationFamily===family).length,2,"full-index bridges cannot displace another orientation's quota");
const hashes=vm.createContext({performance,preparedCache:new WeakMap(),prepTiming:{calls:0,wb:0,gray:0,variants:0},
 HALF_ROTATIONS:true,ORIENTED_STRATEGY:/^(isolate-|outline-|detector$)/,
 whiteBalance:image=>image,toGray:image=>image,queryVariants:()=>[0,90,180,270],queryVariantsUpright:()=>[0,180],hashWords:x=>x,detailScore:()=>1,
});
const prep=source.slice(source.indexOf("  const prepareCandidate ="),source.indexOf("  const recentResult ="));
vm.runInContext(prep+"globalThis.prepare=prepareCandidate",hashes);
assert.deepEqual(Array.from(hashes.prepare({image:{},strategy:"isolate-top-edge-tapped-0",isolationFamily:"top-edge-tapped"}).variants),[0,90,180,270],"a landscape crop must hash its quarter-turn orientations");
assert.deepEqual(Array.from(hashes.prepare({image:{},strategy:"isolate-top-edge-0",isolationFamily:"top-edge"}).variants),[0,180],"the portrait edge family retains its original orientations");
assert.deepEqual(Array.from(hashes.prepare({image:{},strategy:"isolate-sideways-raw-0",isolationFamily:"sideways-raw"}).variants),[0,180],"the established orientation families are unchanged");
console.log("Clipped sideways retrieval is bounded to the frame edge, retains every orientation quota and creates no regional confidence proof");
