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
const geometry = vm.createContext({});
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
const colors = vm.createContext({ ImageData: class { constructor(data,width,height) { Object.assign(this,{data,width,height}); } } });
vm.runInContext(worker.slice(worker.indexOf("function whiteBalance("), worker.indexOf("async function verifyTopMatches(")), colors);
const solid = rgb => ({ width: 20, height: 20, data: Uint8ClampedArray.from(Array.from({length:400}, () => [...rgb,255]).flat()) });
const greenCapture = solid([36,120,36]), greenReference = solid([40,130,40]);
assert.ok(colors.colorSimilarity(colors.colorSignature(colors.whiteBalance(greenCapture)),colors.colorSignature(greenReference)) < .22,
  "one-sided lighting correction can falsely veto strong registered artwork");
assert.ok(colors.registeredColorAgreement(greenCapture,greenReference).color > .99,
  "registered query and reference need the same lighting treatment");
for (const evidence of ["weak", "neighbour", "unregistered", "verified"]) {
  const initial = { name: "Old guess", scryfall_id: "old", face: 0, distance: 190 };
  const winner = { name: "Retrieved card", scryfall_id: "new", milo_retrieval: true, face: 0, distance: 150,
    click_inside: evidence === "unregistered" ? null : evidence !== "neighbour", click_inliers: 24, click_art_inliers: 12 };
  let calls = 0;
  const context = vm.createContext({
    self: {}, cards: [[], []], cardsSha256: "current",
    lastMiloContext: { scanId: 7, base: [initial], images: [{}], queryImages: [{}], dists: [190,150], blockedNames: [],
      result: { matches: [initial], printingMatches: [initial], artChecked: 1 } },
    cardMeta: row => row === 1 ? { ...winner } : { ...initial },
    verifyTopMatches: async (pool) => { calls++; assert.ok(pool.some(m => m.name === "Old guess")); return { matches: [winner], artDecisive: evidence !== "weak", artChecked: 2 }; },
  });
  vm.runInContext(helpers + boundary, context);
  await assert.rejects(context.verifyMiloRows(8, [{ row: 1, score: .999 }], "current"), /mismatch/);
  await assert.rejects(context.verifyMiloRows(7, [{ row: 1, score: .999 }], "stale"), /mismatch/);
  assert.equal(calls, 0, "stale rows must never reach the verifier");
  const result = await context.verifyMiloRows(7, [{ row: 1, score: .999 }, { row: -1, score: .99 }, { row: 1, score: NaN }], "current");
  assert.equal(result.miloRescued, evidence === "verified");
  assert.equal(result.matches[0].name, evidence === "verified" ? winner.name : initial.name, "a high model score alone cannot replace the established result");
  assert.equal(initial.milo_retrieval, undefined, "rescue verification must not mutate baseline matches");
}
console.log("Milo keeps a diverse bounded shortlist, rejects stale catalogs, and requires decisive artwork plus positive clicked-card proof");

// A missing Milo catalog disables only lookup; the shared corner detector
// must remain usable, and all model jobs must keep their own callbacks.
const bridgeSource = readFileSync(new URL("../src/recognition/aiCrop.js", import.meta.url), "utf8")
  .replaceAll("export ", "").replaceAll("import.meta.url", "'http://localhost/src/recognition/aiCrop.js'");
let modelJobs = [], workerCount = 0;
const bridge = vm.createContext({
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
  const context = vm.createContext({
    performance, VISUAL_EXACT_DISTANCE: 90,
    sourceToBitmap: async () => ({ close() { closed++; } }), createImageBitmap: async () => ({}),
    proposeAiCrops: async () => ({ quads: [{}], diagnostic: { status: "ready", ms: 1 } }),
    runOnWorker: async (_bmp, _point, _hints, _quads, aiOnly) => { if (!aiOnly) fallbacks++; return { ...base }; },
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
  assert.equal(fallbacks, ["clear", "verified"].includes(scenario) ? 0 : 1);
  assert.equal(result.matches[0].name, rescue ? "New verified card" : "Old guess");
  assert.equal(result.milo_images, undefined, "capture pixels must not escape into final diagnostics");
  if (rescue || scenario === "clear") assert.equal(closed, 1);
}
console.log("Milo failures preserve cropping; fast reads/hints skip lookup; only verified rescues skip the full fallback");
