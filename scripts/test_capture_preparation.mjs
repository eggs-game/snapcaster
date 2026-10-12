import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/recognition/matcher.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("const capturePreparations ="), source.indexOf("// OCR runs"))
  .replaceAll("export function ", "function ");
const perform = source.slice(source.indexOf("async function performIdentify("), source.indexOf("let identifyActive ="));
const point = { nx: .25, ny: .7 };
const blob = () => new Blob(["exact same camera bytes"], { type: "image/jpeg" });
let clock = 0, enabled = true, proposals = [], decoded = [], closed = [], verified = [];
let failPreparation = false, release;
const context = vm.createContext({ Blob, performance: { now: () => clock },
  aiCropEnabled: () => enabled,
  // These tests isolate geometry preparation. Speculative full recognition
  // has its own owner/queue tests and must not silently run in this fixture.
  miloEnabled: () => false, identifyActive: false, queuedIdentify: null,
  recognitionOwnerSeq: 0, worker: null,
  releaseMiloContexts: () => { throw new Error("geometry-only preparation cannot own a full verifier job"); },
  startIdentifyJob: () => { throw new Error("Milo-disabled fixture cannot start speculative recognition"); },
  sourceToBitmap: async (input) => {
    const bitmap = { source: input, width: 594, height: 594, close() { closed.push(bitmap); } };
    decoded.push(bitmap); return bitmap;
  },
  proposeAiCrops: async (bitmap, click, _retry, { isActive = () => true } = {}) => {
    if (failPreparation) { failPreparation = false; throw new Error("decode/inference failed"); }
    if (release === "hold") await new Promise(resolve => { release = resolve; });
    if (!isActive()) return { quads: [], diagnostic: { status: "canceled" } };
    proposals.push({ bitmap, click });
    return { quads: [{ source: bitmap.source }], diagnostic: { status: "ready", ms: 180 } };
  },
  createImageBitmap: async bitmap => ({ ...bitmap, close() {} }),
  VISUAL_EXACT_DISTANCE: 90,
  supersededRecognitionError: () => Object.assign(new Error("superseded"), { code: "RECOGNITION_SUPERSEDED" }),
  runOnWorker: async (bitmap, click, _hints, quads, aiOnly) => {
    verified.push({ bitmap, click, quads });
    if (!aiOnly) bitmap.close(); // The full worker owns the transferred original.
    return { matches: [{ name: "Verified selected frame", distance: 100, identified_by: "art-match" }],
      art_decisive: true, art_best: { clickInside: true, inliers: 50 }, stage_ms: {} };
  },
  finishIdentify: async result => result,
});
vm.runInContext(helpers + perform, context);
async function flush() { await new Promise(setImmediate); }
async function scan(input, click = point, hints = [], ai = true) {
  const entry = context.takeCapturePreparation(input, click, hints, ai);
  return context.performIdentify(input, click, hints, ai, false, entry);
}

const winningFirst = blob();
clock = 10;
const cancel = context.prepareRecognitionCapture(winningFirst, point);
await flush();
assert.equal(proposals.length, 1);
assert.equal(closed.length, 1, "preparation releases its original bitmap");
clock = 250;
const result = await scan(winningFirst);
assert.equal(proposals.length, 1, "the identical selected Blob consumes preparation once");
assert.equal(result.ai_crop.prepared, true);
assert.equal(result.stage_ms.captureOverlap, 0, "synchronous fixture consumes no invented overlap time");
assert.equal(verified.at(-1).bitmap.source, winningFirst, "hash verification always sees the selected frame");
assert.equal(verified.at(-1).quads[0].source, winningFirst);
cancel();
await scan(winningFirst);
assert.equal(proposals.length, 2, "consumed proposals are not persistent lookup answers");

for (const scenario of ["other-frame", "other-point", "off", "canceled", "failed"]) {
  const first = blob(), final = scenario === "other-frame" ? blob() : first;
  const before = proposals.length;
  failPreparation = scenario === "failed";
  const cancelFirst = context.prepareRecognitionCapture(first, point);
  await flush();
  if (scenario === "canceled") cancelFirst();
  const output = await scan(final, scenario === "other-point" ? { ...point, nx: .251 } : point,
    [], scenario !== "off");
  assert.ok(!output.ai_crop.prepared, `${scenario} cannot reuse another preparation`);
  assert.equal(verified.at(-1).bitmap.source, final, `${scenario} verifies final pixels`);
  if (scenario !== "off") {
    assert.equal(proposals.at(-1).bitmap.source, final);
    assert.ok(proposals.length > before, `${scenario} runs the normal proposal on the selected frame`);
  }
  cancelFirst();
}

const staleHintFrame = blob();
context.prepareRecognitionCapture(staleHintFrame, point);
await flush();
const beforeStale = proposals.length;
const staleResult = await scan(staleHintFrame, point, [{}]);
assert.equal(staleResult.ai_crop.prepared, true, "a stale hint may reuse only its exact selected frame preparation");
assert.equal(proposals.length, beforeStale, "a stale hint does not repeat the selected frame's corner inference");

release = "hold";
const losingFirst = blob();
const cancelQueued = context.prepareRecognitionCapture(losingFirst, point);
await flush();
cancelQueued();
release();
await flush();
assert.equal(context.takeCapturePreparation(losingFirst, point, [], true), null);
assert.ok(closed.includes(decoded.at(-1)), "canceled queued preparation still releases its bitmap");

release = "hold";
const obsolete = blob();
const cancelAdopted = context.prepareRecognitionCapture(obsolete, point);
await flush();
const obsoleteScan = scan(obsolete).catch(error => error);
await flush();
const priorProposals = proposals.length, priorVerifications = verified.length;
cancelAdopted();
release();
assert.equal((await obsoleteScan).code, "RECOGNITION_SUPERSEDED");
assert.equal(proposals.length, priorProposals, "a canceled adopted preparation cannot start replacement model work");
assert.equal(verified.length, priorVerifications, "the obsolete frame cannot occupy the main worker");
enabled = false;
const before = decoded.length;
context.prepareRecognitionCapture(blob(), point)();
await flush();
assert.equal(decoded.length, before, "disabled AI does not decode early frames");
assert.equal(closed.length, decoded.length, "every prepared and selected bitmap is released");
console.log("OK: capture preparation reuses only exact selected pixels and click; stale hints, cancellation, failures and other frames retain verification");
