import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Run the real verifier with two stalled, low-ranked image downloads. A
// decisive first-ten result must finish without waiting for the unused tail.
const source = readFileSync(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
let downloads = 0, deleted = 0;
const context = vm.createContext({
  performance, DISTINCT_NAME_ORB_STOP:false, splitIdentitySupported:()=>true, catalogArtworkRivals:()=>[], CARD_W:244, CARD_H:340, ORB_SHORTLIST: 12, orbTiming: {},
  fetchReference: async id => { downloads++; return id >= 10 ? new Promise(() => {}) : { id }; },
  orbFeatures: image => ({ image, kp: { delete() { deleted++; } }, desc: { delete() { deleted++; } } }),
  orbAlignment: (_query, reference) => ({ score: reference.image.id === 0 ? 80 : 1 }),
  artworkInlierScore: alignment => alignment.score,
  whiteBalance: image => image, colorSignature: () => [], colorSimilarity: () => 1,
  hasPositiveClickProof: () => true,
});
const featureCache=source.slice(source.indexOf("const referenceFeatureCache ="),source.indexOf("function orbAlignment("));
const signatures=source.slice(source.indexOf("const referenceColorCache ="),source.indexOf("function registeredColorAgreement("));
vm.runInContext(featureCache+signatures+source.slice(source.indexOf("async function verifyTopMatches("), source.indexOf("async function visualFallback(")), context);
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
    performance, DISTINCT_NAME_ORB_STOP:false, splitIdentitySupported:()=>true, catalogArtworkRivals:()=>[], CARD_W:244, CARD_H:340, ORB_SHORTLIST:2, orbTiming:{},
    fetchReference:async id=>({id}),
    orbFeatures:image=>({image,kp:{delete(){}},desc:{delete(){}}}),
    orbAlignment:(_query,ref)=>({score:ref.image.id===0?30:13}), artworkInlierScore:a=>a.score,
    whiteBalance:image=>image,colorSignature:()=>[],colorSimilarity:()=>1,
    hasPositiveClickProof:()=>true,referencesShareArtwork:()=>shared,
  });
  vm.runInContext(featureCache+signatures+source.slice(source.indexOf("async function verifyTopMatches("),source.indexOf("async function visualFallback(")),ctx);
  const result=await ctx.verifyTopMatches([
    {name:"Creature",scryfall_id:0,distance:153,click_text_inliers:text},
    {name:"Event",scryfall_id:1,distance:123},
  ],[{}],false);
  assert.equal(result.matches[0].name,expected);
  assert.equal(result.artDecisive,decisive);
}
console.log("Shared artwork cannot override stronger whole-card evidence without distinguishing text");

// A matching name absent from the query shortlist must still challenge a
// reused illustration. The catalog is evidence against confidence, not a seed.
for (const text of [0,8]) {
  const ctx=vm.createContext({performance,DISTINCT_NAME_ORB_STOP:false,splitIdentitySupported:()=>true,CARD_W:244,CARD_H:340,ORB_SHORTLIST:1,orbTiming:{},
    catalogArtworkRivals:()=>[{name:"Missing counterpart",scryfall_id:9}],
    fetchReference:async id=>({id}),orbFeatures:image=>({image,kp:{delete(){}},desc:{delete(){}}}),
    orbAlignment:()=>({score:57}),artworkInlierScore:a=>a.score,whiteBalance:image=>image,
    colorSignature:()=>[],colorSimilarity:()=>1,hasPositiveClickProof:()=>true,referencesShareArtwork:()=>true,
  });
  vm.runInContext(featureCache+signatures+source.slice(source.indexOf("async function verifyTopMatches("),source.indexOf("async function visualFallback(")),ctx);
  const result=await ctx.verifyTopMatches([{name:"Artwork leader",scryfall_id:0,distance:194,regional_proof:true,click_text_inliers:text}],[{}],false);
  assert.equal(result.artDecisive,text>=8,"a detected outline cannot distinguish identical art without printed text");
  assert.equal(result.matches.length,1,"catalog rivals never seed an answer");
}
// Exercise the real 256-bit catalog search, name diversity, cache and fallback.
const rows=[["Leader","set","1","lead",0],["Leader","set","2","reprint",0],["Rival","set","3","rival",0],["Rival","set","4","rival2",0],["Other","set","5","other",0],["Distant","set","6","distant",0]];
const arts=new Uint8Array(rows.length*32);arts.fill(255,5*32);arts[2*32]=1;arts[3*32]=3;arts[4*32]=7;
const catalog=vm.createContext({cards:rows,artIndex:arts,ART_BYTES:32,POPCOUNT:Uint8Array.from({length:256},(_,i)=>i.toString(2).replace(/0/g,"").length),
  ensurePrintingIndex:()=>new Map(rows.map((r,i)=>[`${r[3]}:${r[4]}`,i])),cardMeta:(i,distance)=>({name:rows[i][0],scryfall_id:rows[i][3],distance}),
});
vm.runInContext(source.slice(source.indexOf("const catalogArtworkRivalCache"),source.indexOf("const sharedArtworkCache")),catalog);
const challenge=catalog.catalogArtworkRivals({name:"Leader",scryfall_id:"lead"});
assert.deepEqual(Array.from(challenge,r=>r.name),["Rival","Other"]);
assert.equal(catalog.catalogArtworkRivals({name:"Leader",scryfall_id:"lead"}),challenge,"reuse the bounded printing probe");
assert.equal(catalog.catalogArtworkRivals({name:"Unknown",scryfall_id:"absent"}).length,0);
catalog.artIndex=null;assert.equal(catalog.catalogArtworkRivals({name:"Leader",scryfall_id:"lead"}).length,0,"missing legacy catalog keeps the existing matcher usable");
console.log("Missing shortlist rivals still prevent shared-art confidence; catalog probes are bounded, diverse and never introduce an answer");
