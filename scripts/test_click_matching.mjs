import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const worker = readFileSync(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
const start = worker.indexOf("function homographySourceQuad(");
const end = worker.indexOf("// Gray-world", start);
const context = vm.createContext({});
vm.runInContext(worker.slice(start, end), context);
const inside = context.homographyContainsClick;
// A reference card at source x=100..300, y=50..350. A strong neighbouring
// artwork match must fail if the actual clicked card lies to its right.
const shifted = [1, 0, -100, 0, 1, -50, 0, 0, 1];
assert.equal(inside(shifted, { x: 150, y: 100 }, 200, 300), true);
assert.equal(inside(shifted, { x: 400, y: 100 }, 200, 300), false);
// Tapped and perspective mappings retain source-space click ownership.
assert.equal(inside([0, 1, -50, -1, 0, 300, 0, 0, 1], { x: 150, y: 100 }, 200, 300), true);
assert.equal(inside([1, 0, 0, 0, 1, 0, 0.001, 0, 1], { x: 100, y: 100 }, 200, 300), true);
assert.equal(inside([1, 0, 0, 0, 1, 0, 0, 0, 0], { x: 100, y: 100 }, 200, 300), null);
assert.equal(inside([NaN, 0, 0, 0, 1, 0, 0, 0, 1], { x: 100, y: 100 }, 200, 300), null);
assert.deepEqual(JSON.parse(JSON.stringify(context.homographySourceQuad(shifted, 200, 300))),
  [{ x: 100, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 350 }, { x: 100, y: 350 }]);
assert.equal(context.homographySourceQuad([0,0,0,0,0,0,0,0,0], 200, 300), null);
const helperStart = worker.indexOf("function excludeProvenNeighbours(");
vm.runInContext(worker.slice(worker.indexOf("function contentSupportsIdentity("),worker.indexOf("function extendAiVerification(")),context);
vm.runInContext(worker.slice(helperStart, worker.indexOf("// Gray-world", helperStart)), context);
const proof = (name, inside, inliers = 24, art = 12) => ({ name, click_inside: inside, click_inliers: inliers, click_art_inliers: art, art_inliers: 51 });
const target = proof("Champion's Drake", true);
const neighbour = proof("Global Ruin", false);
const otherPrinting = { name: "Global Ruin", distance: 60, art_inliers: 20 };
context.excludeProvenNeighbours([target,neighbour,otherPrinting], [target,neighbour]);
assert.equal(target.click_blocked, false);
assert.equal(neighbour.click_blocked, true);
assert.equal(otherPrinting.click_blocked, true, "low-distance printings cannot reintroduce a proven neighbour");
const aboveClick = proof("Held card", false);
context.excludeProvenNeighbours([aboveClick], [aboveClick]);
assert.equal(aboveClick.click_blocked, false, "no competing positive proof preserves off-centre recovery");
const duplicate = proof("Champion's Drake", false);
context.excludeProvenNeighbours([target,duplicate], [target,duplicate]);
assert.equal(duplicate.click_blocked, false, "duplicate copies keep the correct identity eligible");
const weak = proof("Weak coincidence", false,24,4);
context.excludeProvenNeighbours([target,weak], [target,weak]);
assert.equal(weak.click_blocked, false, "template-only evidence cannot exclude a candidate");
const artworkStart = worker.indexOf("function contentSupportsIdentity(");
vm.runInContext(worker.slice(artworkStart, worker.indexOf("function orbScore(", artworkStart)), context);
assert.equal(context.artworkInlierScore({inliers:27,artInliers:0}),11,"shared blank-card borders cannot make a confident artwork identity");
assert.equal(context.artworkInlierScore({inliers:51,artInliers:3}),11);
assert.equal(context.artworkInlierScore({inliers:16,artInliers:4}),16);
assert.equal(context.artworkInlierScore({inliers:51,artInliers:30}),51);
assert.equal(context.artworkInlierScore({inliers:7,artInliers:0}),7);
console.log("source/reference mappings distinguish the clicked card from neighbours, including rotation and perspective");

assert.equal(context.artworkInlierScore({inliers:51,artInliers:0,textInliers:12}),51,"strong printed content survives covered artwork");
assert.equal(context.artworkInlierScore({inliers:51,artInliers:0,textInliers:0}),11,"borders alone remain weak even at high counts");
assert.equal(context.artworkInlierScore({inliers:29,artInliers:0,textInliers:12}),11);
const supplementalStart=worker.indexOf("function extendAiVerification(");
vm.runInContext(worker.slice(supplementalStart,worker.indexOf("function homographySourceQuad(",supplementalStart)),context);
const base=[{name:"Base",scryfall_id:"base"}];
const extended=context.extendAiVerification(base,[base[0],...Array.from({length:20},(_,i)=>({name:"AI"+i,scryfall_id:"ai"+i,identified_by:"visual-exact",art_inliers:100,color_sim:1}))]);
assert.equal(extended[0],base[0]);assert.equal(extended.length,13);assert.equal(extended[1].ai_supplement,true);assert.equal(extended[1].identified_by,undefined);
assert.equal(extended[1].art_inliers,0,"supplements must reverify; trial scores cannot survive an early stop");
assert.equal(extended[1].color_sim,0);

const matcher=readFileSync(new URL('../src/recognition/matcher.js',import.meta.url),'utf8');
const helper=matcher.slice(matcher.indexOf('function withoutBlockedNeighbours('),matcher.indexOf('async function sourceToBitmap('));
const fallback=matcher.slice(matcher.indexOf('function suppressUnsafeVisualFallback('),matcher.indexOf('// Object URL of the title strip'));
const ocr=matcher.slice(matcher.indexOf('async function applyTitleOCRUnlocked('),matcher.indexOf('function applyTitleOCR(result)'));
const blocked='Neighbour Permanents';const clicked='Clicked Target';let reSearches=0;
const ctx=vm.createContext({performance,VISUAL_KEEP:210,
 runVisualFallback:async()=>{reSearches++;return{matches:[{name:blocked,distance:10},{name:clicked,distance:190}],printing_matches:[{name:blocked,distance:10},{name:clicked,distance:190}]};},
 runTitleStrips:async()=>[{images:['neighbour'],strategy:'outline-1'},{images:['target'],strategy:'outline-2'}],
 getOCRPool:async()=>Array.from({length:3},()=>({recognize:async image=>({data:{text:image==='neighbour'?blocked:clicked,confidence:image==='neighbour'?100:80}})})),
 bestIndexedTitle:text=>({name:text,score:1}),normalizeTitle:text=>text.toLowerCase(),ocrDebugUrl:()=>null,
 readMetadataObservation:async()=>null,evaluateMetadataEvidence:()=>({compatible:true,score:0,reasons:[]}),
});
vm.runInContext(helper+fallback+ocr,ctx);
const existing={blocked_names:[blocked],matches:[{name:blocked,distance:10},{name:clicked,distance:190}],printing_matches:[{name:blocked,distance:10},{name:clicked,distance:190}]};
assert.equal((await ctx.applyVisualFallback(existing)).matches[0].name,clicked);
assert.equal(reSearches,0);
const searched=await ctx.applyVisualFallback({blocked_names:[blocked],matches:[],sharded_index:true,card_found:true});
assert.equal(searched.matches[0].name,clicked);assert.equal(searched.printing_matches.length,1);
const read=await ctx.applyTitleOCRUnlocked({...existing,title_count:2,scan_id:1,sharded_index:false});
assert.equal(read.matches[0].name,clicked,'even a perfect OCR read of the excluded neighbour cannot become an answer');
assert.equal(read.matches[0].identified_by,'ocr-title');
console.log('negative click proof survives printing selection, title OCR and visual re-search');

const textTarget={name:"Clicked text",click_inside:true,click_inliers:35,click_art_inliers:0,click_text_inliers:8};
const textNeighbour={name:"Neighbour text",click_inside:false,click_inliers:35,click_art_inliers:0,click_text_inliers:8};
context.excludeProvenNeighbours([textTarget,textNeighbour],[textTarget,textNeighbour]);
assert.equal(textNeighbour.click_blocked,true,"strong interior text has the same click ownership requirement as artwork");
assert.equal(context.hasClickProof({...textTarget,click_inliers:34}),false);
assert.equal(context.hasClickProof({...textTarget,click_text_inliers:7}),false);
const decisiveStart = worker.indexOf("  const isDecisiveLead =");
vm.runInContext(worker.slice(decisiveStart,worker.indexOf("  // Weak AI retrieval",decisiveStart)).replace("const isDecisiveLead", "globalThis.isDecisiveLead"),context);
const outsideLead = { ...proof("Outside guess",false,38,10), art_inliers:98, color_sim:.71, distance:166 };
assert.equal(context.isDecisiveLead(outsideLead,{art_inliers:6}),true,
  "raw artwork ranking preserves the established above-click single-card guess");
assert.equal(context.hasPositiveClickProof(outsideLead),false,
  "outside ownership cannot make that guess a confident clicked-card identity");
assert.equal(context.hasPositiveClickProof({...outsideLead,click_inside:null,click_inliers:6}),false,
  "strong isolated artwork with an unregistered camera footprint remains tentative");
assert.equal(context.hasPositiveClickProof({...outsideLead,click_inside:true}),true);
assert.ok(worker.includes('const decisive = isDecisiveLead(best, rival) && (!source || !click || hasPositiveClickProof(best))'));
assert.equal(outsideLead.click_blocked,undefined,"keep the off-centre guess selectable");
assert.equal(context.isDecisiveLead({...outsideLead,click_inside:true},{art_inliers:6}),true);
assert.equal(context.isDecisiveLead({...outsideLead,click_inside:true,shared_artwork:true,click_text_inliers:0},{art_inliers:6}),false,
  "even overwhelming registered artwork cannot distinguish two names that reuse it");
assert.equal(context.isDecisiveLead({...outsideLead,click_inside:true,shared_artwork:true,click_text_inliers:8},{art_inliers:6}),true);
const globalArt={...outsideLead,click_inside:true,distance:202,art_inliers:60,click_text_inliers:0};
assert.equal(context.hasPositiveClickProof(globalArt),false,
  "an extrapolated artwork footprint cannot own the click or block the actual layout");
assert.equal(context.hasPositiveClickProof({...globalArt,regional_proof:true}),true);
assert.equal(context.hasPositiveClickProof({...globalArt,click_text_inliers:8}),true);
const actualLayout={...proof("Actual Art Series",false,38,10),distance:202};
context.excludeProvenNeighbours([globalArt,actualLayout],[globalArt,actualLayout]);
assert.notEqual(actualLayout.click_blocked,true,
  "an untrusted illustration anchor cannot exclude the actual Art Series card");
assert.equal(context.isDecisiveLead(globalArt,{art_inliers:6}),false,
  "a global illustration match cannot invent a missing printed card body at poor whole-card distance");
assert.equal(context.isDecisiveLead({...globalArt,regional_proof:true},{art_inliers:6}),true,
  "independent clicked-card region registration preserves legitimate artwork-only rescues");
assert.equal(context.isDecisiveLead({...globalArt,click_text_inliers:8},{art_inliers:6}),true);
assert.equal(context.isDecisiveLead({...globalArt,distance:180},{art_inliers:6}),true);
const finishStart = matcher.indexOf("function hasOutsideClickProof(");
const finishCode = matcher.slice(finishStart,matcher.indexOf("async function performIdentify(",finishStart));
const finalContext = vm.createContext({ VISUAL_EXACT_DISTANCE:90, OCR_SKIP_DISTANCE:220, performance,
  applyTitleOCR:async result => result });
vm.runInContext(finishCode,finalContext);
for (const distance of [60,166]) {
  const outside = { ...outsideLead, distance, confidence:1, identified_by:"art-match" };
  const result = await finalContext.finishIdentify({ matches:[outside],art_decisive:true,art_best:{weak:false,inliers:98} });
  assert.equal(result.matches[0].name,"Outside guess");
  assert.equal(result.matches[0].identified_by,undefined,"near-exact hashing cannot revive an outside confidence label");
  assert.ok(result.matches[0].confidence < .7);
  assert.equal(result.art_decisive,false);
}
assert.equal(finalContext.hasOutsideClickProof({...outsideLead,click_inliers:15}),false);
assert.equal(finalContext.hasOutsideClickProof({...outsideLead,click_art_inliers:7}),false);
assert.equal(finalContext.hasOutsideClickProof({...textNeighbour,click_inliers:35}),true);
console.log("outside registration retains an off-centre guess without confidently naming an unreadable target's neighbour");
