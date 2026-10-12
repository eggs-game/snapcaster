import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/recognition/matcher.js", import.meta.url), "utf8");
const perform = source.slice(source.indexOf("async function performIdentify("), source.indexOf("let identifyActive ="));
const hint = { scryfall_id: "prior-printing", face: 1 };
const verified = { name: "Selected card", scryfall_id: "selected-printing", face: 0,
  distance: 120, identified_by: "art-match" };
const result = { matches: [verified], art_decisive: true,
  art_best: { clickInside: true, inliers: 50, clickInliers: 50 }, stage_ms: {} };

for (const scenario of ["hit", "stale", "legacy", "error", "off", "canceled"]) {
  const calls = [], closed = [], proposals = [];
  let releaseHint;
  const preparation = { active: true, startedAt: 0, finishedAt: 5,
    job: ["hit", "canceled"].includes(scenario) ? new Promise(() => {}) : Promise.resolve({ quads: ["prepared-selected-frame"], diagnostic: { status: "ready" } }) };
  let bitmapSerial = 0;
  const bitmap = () => { const id = ++bitmapSerial; return { id, width: 594, height: 594,
    close() { assert.ok(!closed.includes(id), "a bitmap has one owner"); closed.push(id); } }; };
  const context = vm.createContext({ performance, VISUAL_EXACT_DISTANCE: 90,
    sourceToBitmap: async () => bitmap(), createImageBitmap: async () => bitmap(),
    supersededRecognitionError: () => Object.assign(new Error("superseded"), { code: "RECOGNITION_SUPERSEDED" }),
    proposeAiCrops: async (_bmp, _point, retry) => {
      proposals.push(retry); return { quads: [], diagnostic: { status: "ready" } };
    },
    runOnWorker: async (bmp, _point, hints, quads, aiOnly, _candidates, _milo, _preview, hintsOnly) => {
      calls.push({ hints, quads, aiOnly, hintsOnly });
      if (scenario === "canceled" && hintsOnly) await new Promise(resolve => { releaseHint = resolve; });
      bmp.close();
      if (hintsOnly) {
        if (scenario === "error") throw new Error("optional hint verifier failed");
        return scenario === "hit" ? { ...result, hint_hit: true }
          : { matches: [], hint_miss: true, stage_ms: { hint: 12, hintPrep: 10 } };
      }
      return aiOnly && scenario === "legacy" ? { matches: [], stage_ms: {} } : { ...result };
    },
    finishIdentify: async raw => raw,
  });
  vm.runInContext(perform, context);
  const job = context.performIdentify("selected-frame", { nx: .2, ny: .8 }, [hint], scenario !== "off", false,
    scenario === "off" ? null : preparation);
  let output;
  if (scenario === "canceled") {
    await new Promise(setImmediate);
    preparation.active = false;
    releaseHint();
    let timer;
    try { await assert.rejects(Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("obsolete hint miss waited for unused preparation")), 500); })]), { code: "RECOGNITION_SUPERSEDED" }); }
    finally { clearTimeout(timer); }
    assert.equal(calls.length, 1, "supersession during a hint prepass starts no obsolete AI or complete worker job");
  } else {
    let timer;
    try { output = await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("valid hint waited for unused preparation")), 500); })]); }
    finally { clearTimeout(timer); }
    assert.equal(output.matches[0], verified, "the same verified printing and face is delivered");
    if (scenario === "hit") {
      assert.equal(calls.length, 1);
      assert.equal(preparation.active, false, "a verified hint cancels unused prepared model work");
      assert.equal(output.ai_crop.status, "hint-hit");
    } else if (scenario === "off") {
      assert.equal(calls.length, 1, "AI-off retains the ordinary worker route");
      assert.equal(calls[0].hintsOnly, undefined);
      assert.equal(calls[0].hints[0], hint);
    } else {
      assert.equal(calls[0].hintsOnly, true);
      assert.equal(calls[1].aiOnly, true, "a missed hint permits the ordinary learned-crop trial");
      assert.equal(calls[1].hints.length, 0, "the fast trial does not repeat the hint tiers");
      assert.equal(calls[1].quads[0], "prepared-selected-frame");
      assert.equal(output.ai_crop.prepared, true);
      if (scenario === "legacy") {
        assert.equal(calls.at(-1).aiOnly, false);
        assert.equal(calls.at(-1).hints[0], hint, "weak learned evidence retains the original complete fallback and third hint tier");
      }
    }
  }
  assert.equal(proposals.length, 0, "prepared geometry and verified hits avoid duplicate model calls");
  assert.equal(closed.length, bitmapSerial, "selected originals and transferred clones are all released");
}

const plumbing = vm.createContext({ URL, Worker: class {}, clearTimeout() {}, setTimeout: () => 1,
  withoutBlockedNeighbours: r => r });
vm.runInContext("let worker = null; let seq = 0; const IDENTIFY_TIMEOUT_MS = 1; globalThis.pending = new Map();"
  + source.slice(source.indexOf("function getWorker("), source.indexOf("function withoutBlockedNeighbours("))
    .replaceAll("import.meta.url", "'http://localhost/src/recognition/matcher.js'")
  + source.slice(source.indexOf("function runOnWorker("), source.indexOf("function runMiloVerification(")), plumbing);
const worker = plumbing.getWorker();
let posted;
worker.postMessage = (message, transferred) => { posted = { message, transferred }; };
const transferred = {};
const miss = plumbing.runOnWorker(transferred, {}, [hint], [], false, [], false, null, true);
assert.equal(posted.message.hintsOnly, true);
assert.equal(posted.transferred[0], transferred);
worker.onmessage({ data: { id: posted.message.id, hintMiss: true, matches: [], stageMs: { hint: 2 } } });
assert.equal((await miss).hint_miss, true, "the explicit worker miss sentinel survives normalization");
console.log("OK: valid hints avoid model waits; stale hints regain exact-frame learned verification and preserve the complete fallback");
