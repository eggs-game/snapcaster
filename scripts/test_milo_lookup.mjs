import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { diverseMiloRows, validateMiloCatalog, MILO_MODEL_SHA, MILO_PREPROCESS, MILO_REVISION } from "../src/recognition/miloLookup.js";

// A heavily reprinted card cannot fill the entire verification shortlist.
const groups = new Uint32Array([0,0,0,0,0,0,1,1,2,3,4,5,6]);
const ranked = diverseMiloRows(new Float32Array([.99,.98,.97,.96,.95,.94,.93,.92,.91,.90,.89,.88,.87]), groups);
assert.equal(ranked.length, 8);
assert.equal(new Set(ranked.map(r => groups[r.row])).size, 6);
assert.equal(ranked.filter(r => groups[r.row] === 0).length, 2);
assert.equal(diverseMiloRows(new Float32Array([NaN, Infinity]), new Uint32Array(2)).length, 0);
// Compare the faster two-treatment implementation against the original
// exhaustive grouping, including ties, sparse groups and non-finite scores.
function exhaustiveRows(scores, groups) {
  const leaders = new Map();
  for (let row = 0; row < scores.length; row++) {
    if (!Number.isFinite(scores[row])) continue;
    const entries = leaders.get(groups[row]) || [];
    entries.push({ row, score: scores[row] });
    entries.sort((a,b) => b.score - a.score || a.row - b.row);
    entries.length = Math.min(entries.length, 2); leaders.set(groups[row], entries);
  }
  const chosen = [...leaders.values()].sort((a,b) => b[0].score-a[0].score || a[0].row-b[0].row).slice(0,6);
  return [...chosen.map(entries => entries[0]), ...chosen.map(entries => entries[1]).filter(Boolean)];
}
for (const n of [1, 7, 127, 10000]) {
  const scores = Float32Array.from({length:n}, (_,i) => i % 23 === 0 ? NaN : ((i * 71) % 101) / 100);
  const groups = Uint32Array.from({length:n}, (_,i) => (i * 17) % 61);
  assert.deepEqual(diverseMiloRows(scores, groups), exhaustiveRows(scores, groups));
}
const manifest = { version: 1, revision: MILO_REVISION, model_sha256: MILO_MODEL_SHA, preprocess: MILO_PREPROCESS,
  dimension: 128, count: 2, names: 2, cards_sha256: "a".repeat(64) };
validateMiloCatalog(manifest, new Int8Array(256), new Float32Array([127,127]), new Uint32Array([0,1]));
for (const changed of [{ ...manifest, count: 3 }, { ...manifest, revision: "old" }, { ...manifest, dimension: 256 }]) {
  assert.throws(() => validateMiloCatalog(changed, new Int8Array(256), new Float32Array([127,127]), new Uint32Array([0,1])));
}
assert.throws(() => validateMiloCatalog(manifest, new Int8Array(256), new Float32Array([NaN,127]), new Uint32Array([0,1])));
assert.throws(() => validateMiloCatalog(manifest, new Int8Array(256), new Float32Array([127,127]), new Uint32Array([0,2])));

// Exercise the real rescue boundary, with a fake verifier controlling evidence.
const worker = readFileSync(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
const boundary = worker.slice(worker.indexOf("async function verifyMiloRows("), worker.indexOf("self.onmessage = async (e)"));
const helpers = worker.slice(worker.indexOf("function contentSupportsIdentity("), worker.indexOf("function homographySourceQuad("));
const geometry = vm.createContext({splitIdentitySupported:()=>true,});
vm.runInContext(worker.slice(worker.indexOf("function rectifiedClick("), worker.indexOf("function rectifyCard(")), geometry);
vm.runInContext(worker.slice(worker.indexOf("function homographySourceQuad("), worker.indexOf("// Gray-world")), geometry);
vm.runInContext(helpers, geometry);
const shifted = [1,0,-100,0,1,-50,0,0,1];
assert.deepEqual(JSON.parse(JSON.stringify(geometry.rectifiedClick(shifted, {x:150,y:100}, 300, false))), {x:50,y:50});
assert.equal(geometry.homographyContainsClick([1,0,0,0,1,0,0,0,1], geometry.rectifiedClick(shifted, {x:400,y:100}, 300, false), 200,300), false, "a crop containing the click does not prove its neighbour contains the click");
assert.deepEqual(JSON.parse(JSON.stringify(geometry.rectifiedClick([1,0,0,0,1,0,0,0,1], {x:100,y:50}, 200, true))), {x:149,y:100}, "retain the exact clockwise pixel-centre transform for tapped cards");
assert.deepEqual(JSON.parse(JSON.stringify(geometry.rectifiedClick([-1,0,200,0,-1,300,0,0,1], {x:50,y:50}, 300, false))), {x:150,y:250});
assert.equal(geometry.rectifiedClick([0,0,0,0,0,0,0,0,0], {x:1,y:1}, 300, false), null);
// Region-to-reference and camera-to-region compose to the original camera
// footprint, even when the learned crop omitted part of the actual card.
const combined = geometry.multiplyHomographies([.5,0,0,0,.5,0,0,0,1], [2,0,-200,0,2,-100,0,0,1]);
assert.deepEqual(Array.from(combined), shifted);
assert.equal(geometry.homographyContainsClick(combined,{x:150,y:100},200,300),true);
assert.equal(geometry.homographyContainsClick(combined,{x:400,y:100},200,300),false);
for (const bad of [{inside:null,inliers:100,artInliers:90}, {inside:true,inliers:23,artInliers:12}, {inside:true,inliers:50,artInliers:0,textInliers:2}]) {
  assert.equal(geometry.recordRegionalProof({},bad),false, "only registered strong content may establish click ownership");
}
const neighbourProof = {};
assert.equal(geometry.recordRegionalProof(neighbourProof,{inside:false,inliers:100,artInliers:90}),true);
assert.equal(geometry.hasPositiveClickProof(neighbourProof),false);
assert.equal(geometry.recordRegionalProof(neighbourProof,{inside:true,inliers:35,artInliers:12}),true,
  "a registered clicked duplicate takes priority over a stronger outside copy");
assert.equal(geometry.recordRegionalProof(neighbourProof,{inside:false,inliers:150,artInliers:90}),false);
assert.equal(geometry.hasPositiveClickProof(neighbourProof),true);
const proof = {};
assert.equal(geometry.recordRegionalProof(proof,{inside:true,inliers:35,artInliers:12}),true);
assert.equal(geometry.hasClickProof(proof),true);
assert.equal(proof.identified_by,undefined,"registered geometry still needs the decisive rival/color/gray gates");
const colors = vm.createContext({splitIdentitySupported:()=>true, ImageData: class { constructor(data,width,height) { Object.assign(this,{data,width,height}); } } });
vm.runInContext(worker.slice(worker.indexOf("function whiteBalance("), worker.indexOf("async function verifyTopMatches(")), colors);
const solid = rgb => ({ width: 20, height: 20, data: Uint8ClampedArray.from(Array.from({length:400}, () => [...rgb,255]).flat()) });
const greenCapture = solid([36,120,36]), greenReference = solid([40,130,40]);
assert.ok(colors.colorSimilarity(colors.colorSignature(colors.whiteBalance(greenCapture)),colors.colorSignature(greenReference)) < .22,
  "one-sided lighting correction can falsely veto strong registered artwork");
assert.ok(colors.registeredColorAgreement(greenCapture,greenReference).color > .99,
  "registered query and reference need the same lighting treatment");
for (const evidence of ["weak", "neighbour", "unregistered", "verified", "contrast", "contrast-neighbour"]) {
  const initial = { name: "Old guess", scryfall_id: "old", face: 0, distance: 190 };
  const winner = { name: "Retrieved card", scryfall_id: "new", milo_retrieval: true, face: 0, distance: 150,
    click_inside: evidence === "unregistered" ? null : !evidence.includes("neighbour"), click_inliers: 24, click_art_inliers: 12 };
  let calls = 0;
  const timing = {};
  const context = vm.createContext({splitIdentitySupported:()=>true,
    self: {}, cards: [[], []], cardsSha256: "current", orbTiming: timing,
    lastMiloContext: { scanId: 7, base: [initial], images: [{}], queryImages: [{}], dists: [190,150], blockedNames: [],
      result: { matches: [initial], printingMatches: [initial], artChecked: 1 } },
    cardMeta: row => row === 1 ? { ...winner } : { ...initial },
    verifyTopMatches: async (pool, _images, _shaped, _source, _click, _budget, _regions, contrast) => {
      calls++; assert.ok(pool.some(m => m.name === "Old guess"));
      timing.refsRanked = calls * 10; timing.sourceFeat = calls * 7;
      if (evidence.startsWith("contrast")) assert.equal(!!contrast, calls === 2);
      return { matches: [winner], artDecisive: evidence !== "weak" && (!evidence.startsWith("contrast") || !!contrast), artChecked: 2 };
    },
  });
  vm.runInContext(helpers + boundary, context);
  await assert.rejects(context.verifyMiloRows(8, [{ row: 1, score: .999 }], "current"), /mismatch/);
  await assert.rejects(context.verifyMiloRows(7, [{ row: 1, score: .999 }], "stale"), /mismatch/);
  assert.equal(calls, 0, "stale rows must never reach the verifier");
  const result = await context.verifyMiloRows(7, [{ row: 1, score: .999 }, { row: -1, score: .99 }, { row: 1, score: NaN }], "current");
  const rescued = ["verified", "contrast"].includes(evidence);
  assert.equal(result.miloRescued, rescued);
  assert.equal(result.matches[0].name, rescued ? winner.name : initial.name, "a high model score alone cannot replace the established result");
  assert.equal(initial.milo_retrieval, undefined, "rescue verification must not mutate baseline matches");
  assert.deepEqual(Array.from(result.miloOrbTiming, t => [t.contrast, t.refsRanked, t.sourceFeat]), evidence.startsWith("contrast")
    ? [[false,10,7],[true,20,14]] : evidence === "weak" ? [[false,10,7],[true,20,14]] : [[false,10,7]]);
  timing.refsRanked = 999;
  assert.equal(result.miloOrbTiming[0].refsRanked, 10, "later passes cannot mutate diagnostic snapshots");
}
console.log("Milo keeps a diverse bounded shortlist, rejects stale catalogs, and requires decisive artwork plus positive clicked-card proof");

// A missing Milo catalog disables only lookup; the shared corner detector
// must remain usable, and all model jobs must keep their own callbacks.
const bridgeSource = readFileSync(new URL("../src/recognition/aiCrop.js", import.meta.url), "utf8")
  .replaceAll("export ", "").replaceAll("import.meta.url", "'http://localhost/src/recognition/aiCrop.js'");
let modelJobs = [], workerCount = 0;
const bridge = vm.createContext({splitIdentitySupported:()=>true,
  URL, URLSearchParams, performance, setTimeout, clearTimeout, location: { search: "" },
  OffscreenCanvas: class { transferToImageBitmap() { return { close() {} }; } },
  createImageBitmap: async () => ({ close() {} }),
  Worker: class {
    constructor() { workerCount++; }
    postMessage({ id, type }) {
      modelJobs.push(type || "corners");
      queueMicrotask(() => this.onmessage({ data: { id, quads: [], rows: [], diagnostic: { status: type?.startsWith("milo-") ? "failed" : "ready" } } }));
    }
  },
});
vm.runInContext(bridgeSource, bridge);
await Promise.all([bridge.preloadAiCrop(), bridge.preloadMilo(), bridge.proposeAiCrops({}, {})]);
assert.deepEqual(modelJobs, ["corners", "milo-warmup", "corners"]);
assert.equal(workerCount, 1);
assert.equal((await bridge.lookupAiCrops([{}])).diagnostic.status, "failed");
assert.equal(modelJobs.length, 3, "failed lookup must not cost another inference/download on the next scan");

const matcher = readFileSync(new URL("../src/recognition/matcher.js", import.meta.url), "utf8");
const perform = matcher.slice(matcher.indexOf("async function performIdentify("), matcher.indexOf("let identifyActive"));
for (const scenario of ["clear", "verified", "weak", "failed", "stale", "hint"]) {
  let lookupCalls = 0, fallbacks = 0, closed = 0;
  const base = { scan_id: 1, matches: [{ name: "Old guess", distance: scenario === "clear" ? 70 : 190 }],
    art_best: {}, milo_images: [{}], printing_matches: [], stage_ms: {} };
  const context = vm.createContext({splitIdentitySupported:()=>true,
    performance, VISUAL_EXACT_DISTANCE: 90,
    sourceToBitmap: async () => ({ close() { closed++; } }), createImageBitmap: async () => ({}),
    proposeAiCrops: async (_bmp, _point, retry) => ({ quads: retry ? [] : [{}], diagnostic: { status: "ready", ms: 1 } }),
    runOnWorker: async (_bmp, _point, _hints, _quads, aiOnly, _candidates, _milo, _preview, hintsOnly) => {
      if (!aiOnly && !hintsOnly) fallbacks++;
      return { ...base, hint_hit: !!hintsOnly };
    },
    lookupAiCrops: async () => { lookupCalls++; return { diagnostic: { status: scenario === "failed" ? "failed" : "ready" }, rows: scenario === "failed" ? [] : [{ row: 1, score: .999 }] }; },
    runMiloVerification: async () => {
      if (scenario === "stale") throw new Error("catalog mismatch");
      return { ...base, milo_rescued: scenario === "verified", matches: [{ name: "New verified card", distance: 140 }] };
    },
    finishIdentify: async result => result,
  });
  vm.runInContext(perform, context);
  const result = await context.performIdentify("capture", {}, scenario === "hint" ? [{}] : [], true, true);
  const rescue = scenario === "verified";
  assert.equal(lookupCalls, ["clear", "hint"].includes(scenario) ? 0 : 1);
  assert.equal(fallbacks, ["clear", "verified", "hint"].includes(scenario) ? 0 : 1);
  assert.equal(result.matches[0].name, rescue ? "New verified card" : "Old guess");
  assert.equal(result.milo_images, undefined, "capture pixels must not escape into final diagnostics");
  if (rescue || scenario === "clear") assert.equal(closed, 1);
}
console.log("Milo failures preserve cropping; fast reads/hints skip lookup; only verified rescues skip the full fallback");

for (const scenario of ["verified", "weak", "error", "neighbour", "thin", "source-thin", "unregistered"]) {
  const original = [{ crop: "original" }], retry = [{ crop: "retry" }];
  let trial = 0, fallbacks = 0, closed = 0;
  const result = { scan_id: 1, matches: [{ name: "Old guess", distance: 190 }], art_best: {}, stage_ms: {} };
  const context = vm.createContext({splitIdentitySupported:()=>true,
    performance, VISUAL_EXACT_DISTANCE: 90,
    sourceToBitmap: async () => ({ close() { closed++; } }), createImageBitmap: async () => ({}),
    proposeAiCrops: async (_bmp, _point, shifted) => ({ quads: shifted ? retry : original, diagnostic: { status: "ready", ms: 1 } }),
    runOnWorker: async (_bmp, _point, _hints, quads, aiOnly) => {
      if (!aiOnly) { fallbacks++; assert.equal(quads, original, "a rejected retry must preserve the original fallback crops"); }
      if (aiOnly && ++trial === 2) {
        if (scenario === "error") throw new Error("retry failure");
        return { ...result, scan_id: 2, milo_images: [{}], ...(scenario === "neighbour" ? {
          art_decisive: true, art_best: {clickInside:false}, matches:[{name:"Neighbour",distance:70,identified_by:"art-match"}]
        } : {}) };
      }
      return { ...result };
    },
    lookupAiCrops: async () => ({ rows: [{row:1,score:.99}], diagnostic: {status:"ready"} }),
    runMiloVerification: async id => {
      assert.equal(id, 2);
      return { ...result, milo_rescued: ["verified", "thin", "source-thin", "unregistered"].includes(scenario),
        art_best: {clickInside: scenario === "unregistered" ? null : true,
          inliers: scenario === "thin" ? 23 : 24, clickInliers: scenario === "source-thin" ? 23 : 24},
        matches: [{ name: "Retry verified", distance: 140 }], milo_verification: [] };
    },
    finishIdentify: async result => result,
  });
  vm.runInContext(perform, context);
  const final = await context.performIdentify("capture", {}, [], true, true);
  assert.equal(final.matches[0].name, scenario === "verified" ? "Retry verified" : "Old guess");
  assert.equal(fallbacks, scenario === "verified" ? 0 : 1);
  if (scenario === "verified") { assert.equal(closed,1); assert.equal(final.milo.rescued,true); assert.equal(final.ai_crop.retryHit,true); }
}
console.log("Adaptive crop rescues retain verified acceptance and preserve the original fallback after weak or failed retries");
