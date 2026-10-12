import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const worker = readFileSync(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
const slice = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to));
// Reconstruct only the legacy eager-warp behavior as a control. The color
// formula is checked independently below, and no git history is needed in CI.
const deferredWarp = `      if (registeredCorners) {
        // Improving views can replace the registered corners several times.
        // Color uses only the final accepted frame, so warp exactly that one.
        const tR = performance.now();
        const registeredFrame = rectifyCard(source, registeredCorners);
        orbTiming.match += performance.now() - tR;`;
assert.ok(worker.includes(deferredWarp), "control must exercise the actual deferred-warp block");
const baseline = worker.replace("let inliers = 0, registeredCorners = null;", "let inliers = 0, registeredFrame = null;")
  .replace("registeredCorners = alignment.corners;", "registeredFrame = rectifyCard(source, alignment.corners);")
  .replace(deferredWarp, "      if (registeredFrame) {");
class Pixels {
  constructor(data, width, height) { Object.assign(this, { data, width, height }); }
}
function image(seed, width = 28, height = 40) {
  const data = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 13 + seed * 37) % 256);
  return new Pixels(data, width, height);
}

const colors = vm.createContext({ ImageData: Pixels });
vm.runInContext(slice(worker, "function whiteBalance(", "// A split identity"), colors);
const realBalance = colors.whiteBalance;
let frameBalances = 0, referenceBalances = 0;
const reference = image(9), pixelsBefore = reference.data.slice();
colors.whiteBalance = input => { if (input === reference) referenceBalances++; else frameBalances++; return realBalance(input); };
function legacyAgreement(frame, ref) {
  const wbFrame = realBalance(frame), wbRef = realBalance(ref);
  return {
    color: Math.max(colors.colorSimilarity(colors.colorSignature(frame), colors.colorSignature(ref)), colors.colorSimilarity(colors.colorSignature(wbFrame), colors.colorSignature(wbRef))),
    ring: Math.max(colors.colorSimilarity(colors.ringSignature(frame), colors.ringSignature(ref)), colors.colorSimilarity(colors.ringSignature(wbFrame), colors.ringSignature(wbRef))),
  };
}
for (let seed = 0; seed < 20; seed++) {
  const frame = image(seed);
  assert.deepEqual(JSON.parse(JSON.stringify(colors.registeredColorAgreement(frame, reference))), legacyAgreement(frame, reference));
}
assert.equal(referenceBalances, 1, "balance each immutable reference once");
assert.equal(frameBalances, 20, "every new camera frame still receives its own correction");
assert.deepEqual(reference.data, pixelsBefore, "reference pixels remain immutable");
colors.reference = reference;
const cached = vm.runInContext("referenceColorCache.get(reference)", colors);
assert.deepEqual(Object.keys(cached).sort(), ["balancedColor", "balancedRing", "color", "ring"]);
assert.ok(Object.values(cached).every(histogram => histogram.length === 13), "cache only tiny signatures, never balanced image pixels");
assert.equal(colors.referenceColorSignature(reference), colors.referenceColorSignature(reference), "reuse the same signature by reference identity");
assert.notEqual(colors.referenceColorSignature(reference), colors.referenceColorSignature(image(9)), "a different reference object owns a separate entry");

function verifier(source, scores, count = 1, regional = true, distinctStop = false) {
  const warps = [], refs = new Map(), timing = {}, extracts = [];
  const context = vm.createContext({ performance, ImageData: Pixels, CARD_W: 244, CARD_H: 340, ORB_SHORTLIST: count, orbTiming: timing, DISTINCT_NAME_ORB_STOP: distinctStop,
    splitIdentitySupported: () => true, catalogArtworkRivals: () => [], referencesShareArtwork: () => false, excludeProvenNeighbours: () => {},
    fetchReference: async (id, _face, size = "small") => {
      const key = `${id}:${size}`;
      if (!refs.has(key)) refs.set(key, Object.assign(image(size === "small" ? 1 : size === "normal" ? 2 : 3), { id, size }));
      return refs.get(key);
    },
    orbFeatures: (input, n, contrast) => { extracts.push({ n, contrast }); return { image: input, kp: { delete() {} }, desc: { delete() {} } }; },
    orbAlignment: (_query, ref, click) => {
      const inliers = regional ? scores[ref.image.size] : scores[ref.image.id];
      return { inliers, inside: regional || click ? true : null, artInliers: inliers, textInliers: 12, halfInliers: [12,12], corners: regional ? [{ view: ref.image.size }] : undefined };
    },
    rectifyCard: (_source, corners) => { warps.push(corners); return image(corners[0].view === "small" ? 4 : corners[0].view === "normal" ? 5 : 6); },
  });
  vm.runInContext(slice(source, "const referenceFeatureCache =", "function orbAlignment(")
    + slice(source, "function contentSupportsIdentity(", "function extendAiVerification(")
    + slice(source, "function whiteBalance(", "// A split identity")
    + slice(source, "async function verifyTopMatches(", "async function visualFallback("), context);
  return { context, warps, timing, extracts };
}

for (const scores of [{ small: 30, normal: 40, detail: 50 }, { small: 30, normal: 50, detail: 40 }]) {
  const old = verifier(baseline, scores), current = verifier(worker, scores);
  const scan = async instance => instance.context.verifyTopMatches([{ name: "Printing", scryfall_id: "id", distance: 90, milo_highres: true }], [image(3, 300, 450)], true,
    image(8, 600, 600), { x: 100, y: 100 }, 0, [{ mappedClick: { x: 50, y: 50 } }]);
  const expected = await scan(old), actual = await scan(current);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), "all match, proof, color, and confidence fields match the eager-warp control");
  assert.ok(old.warps.length > 1, "control actually performs redundant improving-view warps");
  assert.equal(current.warps.length, 1, "warp only the final accepted regional corners");
  assert.deepEqual(current.warps[0], old.warps.at(-1), "weaker later views cannot replace the accepted footprint");
  assert.equal(current.timing.refsInspected, 1); assert.equal(current.timing.refsRanked, 1);
  assert.equal(current.timing.refFeatureMisses, 3); assert.equal(current.timing.refFeatureHits, 0);
  assert.equal(current.timing.sourceProbes, 0); assert.equal(current.timing.sourceFeat, 0);
  assert.ok(current.extracts.every(({ n }) => n !== 1600), "regional ownership still bypasses full-source extraction");
}

const scores = [80, 79, ...Array(10).fill(1)], repeated = verifier(worker, scores, scores.length, false);
const matches = scores.map((_, i) => ({ name: i < 2 ? "Same card" : `Rival ${i}`, scryfall_id: i, distance: 80 + i }));
await repeated.context.verifyTopMatches(matches, [image(2)], false);
assert.equal(repeated.timing.distinctEarlyStopRank, 10, "diagnostics reveal same-name printings blocking the existing early stop");
assert.equal(repeated.timing.refsRanked, 12, "diagnostics cannot change the existing early-stop rule");
assert.equal(repeated.timing.refsInspected, 12);

assert.match(worker, /let DISTINCT_NAME_ORB_STOP = false;/, "the experiment is disabled by default");
for (const [scores, expectedRank] of [[ [80,79,...Array(10).fill(1)], 10 ], [ [27,26,...Array(10).fill(1)], 12 ], [ [80,79,40,...Array(9).fill(1)], 12 ], [ [82,81,40,...Array(9).fill(1)], 10 ]]) {
  const experiment = verifier(worker, scores, scores.length, false, true);
  await experiment.context.verifyTopMatches(scores.map((_, i) => ({ name: i < 2 ? "Same card" : `Rival ${i}`, scryfall_id: i, distance: 80 + i })), [image(2)], false);
  assert.equal(experiment.timing.refsRanked, expectedRank, "distinct names retain the minimum ten, 28-inlier floor, and two-times-plus-one margin");
}

const replies = [], config = vm.createContext({ self: { postMessage: message => replies.push(message) } });
vm.runInContext("let DISTINCT_NAME_ORB_STOP = false;" + worker.slice(worker.indexOf("self.onmessage = async (e) => {")), config);
for (const enabled of [true, false, "true", 1, undefined]) {
  await config.self.onmessage({ data: { id: "config", type: "set-distinct-name-orb-stop", enabled } });
  assert.equal(replies.at(-1).distinctNameOrbStop, enabled === true, "only explicit boolean true enables the experiment");
}
const matcher = readFileSync(new URL("../src/recognition/matcher.js", import.meta.url), "utf8"), requests = [];
const setter = vm.createContext({ getWorker: () => ({ postMessage: message => requests.push(message) }) });
vm.runInContext(slice(matcher, "export function setDistinctNameOrbStop(", "export function setHalfRotations(").replace("export ", ""), setter);
setter.setDistinctNameOrbStop(true); setter.setDistinctNameOrbStop(false);
assert.deepEqual(requests.map(({ type, enabled }) => [type, enabled]), [["set-distinct-name-orb-stop",true],["set-distinct-name-orb-stop",false]]);

// The experiment is rejected even when aggregate real-card accuracy holds:
// a distinct rival beyond reference ten can beat an earlier reprinted guess.
// Keep the actual source-ownership, printed-content and final confidence gates
// active; only the returned geometric keypoint evidence is controlled.
const lateScores = [80,79,...Array(9).fill(1),130];
const lateRows = lateScores.map((_, i) => ({ name: i < 2 ? "Earlier reprinted guess" : i === 11 ? "Actual late rival" : `Other ${i}`, scryfall_id: i, distance: i === 11 ? 150 : 90 + i }));
const scanLate = instance => instance.context.verifyTopMatches(lateRows.map(row => ({ ...row })), [image(2)], false, image(8,120,160), { x:50,y:50 });
const conservative = verifier(worker, lateScores, 12, false, false), unsafe = verifier(worker, lateScores, 12, false, true);
const safeResult = await scanLate(conservative), unsafeResult = await scanLate(unsafe);
assert.equal(safeResult.matches[0].name, "Actual late rival", "default OFF must inspect the later stronger different-name identity");
assert.equal(conservative.timing.refsRanked, 12);
assert.equal(unsafeResult.matches[0].name, "Earlier reprinted guess", "the explicit ON control must reproduce the rejected false identity");
assert.equal(unsafe.timing.refsRanked, 10);
for (const result of [safeResult, unsafeResult]) {
  assert.equal(result.artDecisive, true);
  assert.equal(result.matches[0].identified_by, "art-match");
  assert.equal(result.matches[0].click_inside, true, "the controlled evidence still passes real clicked-footprint gates");
  assert.ok(result.matches[0].click_text_inliers >= 8);
}
for (const rejectedEvidence of ["outside", "no-printed-content"]) {
  const guarded = verifier(worker, lateScores, 12, false, false), align = guarded.context.orbAlignment;
  guarded.context.orbAlignment = (...args) => ({ ...align(...args), ...(rejectedEvidence === "outside" ? { inside:false } : { artInliers:0, textInliers:0 }) });
  const result = await scanLate(guarded);
  assert.equal(result.artDecisive, false, `${rejectedEvidence} cannot pass the actual geometric/content confidence boundary`);
}

console.log("Verifier output exactly matches eager-warp control while caching tiny immutable reference signatures; work counters do not alter early stopping");
