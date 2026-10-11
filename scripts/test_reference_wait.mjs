import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Run the real verifier with two stalled, low-ranked image downloads. A
// decisive first-ten result must finish without waiting for the unused tail.
const source = readFileSync(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
let downloads = 0, deleted = 0;
const context = vm.createContext({
  performance, ORB_SHORTLIST: 12, orbTiming: {},
  fetchReference: async id => { downloads++; return id >= 10 ? new Promise(() => {}) : { id }; },
  orbFeatures: image => ({ image, kp: { delete() { deleted++; } }, desc: { delete() { deleted++; } } }),
  orbAlignment: (_query, reference) => ({ score: reference.image.id === 0 ? 80 : 1 }),
  artworkInlierScore: alignment => alignment.score,
  whiteBalance: image => image, colorSignature: () => [], colorSimilarity: () => 1,
  hasPositiveClickProof: () => true,
});
const featureCache=source.slice(source.indexOf("const referenceFeatureCache ="),source.indexOf("function orbAlignment("));
vm.runInContext(featureCache+source.slice(source.indexOf("async function verifyTopMatches("), source.indexOf("async function visualFallback(")), context);
const matches = Array.from({length:12}, (_,i) => ({name:`Card ${i}`, scryfall_id:i, distance:100+i}));
let timer;
try {
  const result = await Promise.race([
    context.verifyTopMatches(matches, [{}], false),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("unused reference download blocked identification")), 1000); }),
  ]);
  assert.equal(result.matches[0].name, "Card 0");
  assert.equal(result.artDecisive, true);
  assert.equal(downloads, 12, "download references concurrently");
  assert.equal(deleted, 2, "release the query while the bounded cache owns reusable public-reference features");
  assert.equal(vm.runInContext("referenceFeatureCache.length",context),10);
} finally { clearTimeout(timer); }
console.log("Decisive verification finishes while unused reference downloads are stalled");

// Matching a reused illustration can register the clicked footprint perfectly
// while naming the wrong card. The real ranker must preserve the better whole-
// card evidence until text distinguishes the shared-art identities.
for (const [shared, text, expected, decisive] of [[true,0,"Event",false], [true,8,"Creature",true], [false,0,"Creature",true]]) {
  const ctx = vm.createContext({
    performance, ORB_SHORTLIST:2, orbTiming:{},
    fetchReference:async id=>({id}),
    orbFeatures:image=>({image,kp:{delete(){}},desc:{delete(){}}}),
    orbAlignment:(_query,ref)=>({score:ref.image.id===0?30:13}), artworkInlierScore:a=>a.score,
    whiteBalance:image=>image,colorSignature:()=>[],colorSimilarity:()=>1,
    hasPositiveClickProof:()=>true,referencesShareArtwork:()=>shared,
  });
  vm.runInContext(featureCache+source.slice(source.indexOf("async function verifyTopMatches("),source.indexOf("async function visualFallback(")),ctx);
  const result=await ctx.verifyTopMatches([
    {name:"Creature",scryfall_id:0,distance:153,click_text_inliers:text},
    {name:"Event",scryfall_id:1,distance:123},
  ],[{}],false);
  assert.equal(result.matches[0].name,expected);
  assert.equal(result.artDecisive,decisive);
}
console.log("Shared artwork cannot override stronger whole-card evidence without distinguishing text");
