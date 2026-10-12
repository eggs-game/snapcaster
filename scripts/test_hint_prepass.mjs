import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const hint = { scryfall_id: "a75b7f92-4e9f-4720-8f63-3b2f45253368", face: 1 };
const printing = { ...hint, name: "Verified printing" };
const hintGate = slice("const RECENT_HINT_EXACT_DISTANCE =", "// ---------- OpenCV card outline");
// Run the real identify entry and both real hint tiers. The observation point
// replaces everything *after* their boundary, so a miss reaching the ordinary
// crop family is observable without loading OpenCV or the entire catalog.
const identifyEntry = slice("async function identify(", "  let clickInsideCardLikeQuad = false;")
  + "globalThis.fullFamily++; bmp.close(); return { fullFamilyReached: true, matches: [], titleSource: [] }; }";
const handler = source.slice(source.indexOf("self.onmessage = async (e) => {"));
const ownership = slice("function beginMiloOwner(", "function prefetchMiloRows(");

function fixture({ local = 220, outline = 220, cvReady = true, content = true,
  decisive = false, failure = null } = {}) {
  const calls = { crops: [], prepared: [], verify: [], warnings: [], referencePreviews: [], replies: [] };
  let closes = 0, clock = 0;
  const pixels = kind => ({ kind, distance: kind === "outline" ? outline : local });
  const context = vm.createContext({
    console: { warn: (...args) => calls.warnings.push(args) },
    performance: { now: () => ++clock },
    self: { cv: { HEAPU8: { length: 134000000 } }, postMessage: message => calls.replies.push(message) },
    cvReady, cvStatus: cvReady ? "ready" : "failed", shardedIndex: false,
    index: new Uint8Array(64), cards: [printing], VEC_BYTES: 64,
    printingIndexByKey: new Map([[`${hint.scryfall_id}:1`, 0]]), ensurePrintingIndex() {},
    loadIndex: async () => { if (failure === "index") throw new Error("index unavailable"); },
    waitForCV: async () => {},
    loadGlobalIndex: async () => { throw new Error("warm fixture must not load another index"); },
    HALF_ROTATIONS: false, ORIENTED_STRATEGY: /outline/, CARD_W: 244, CARD_H: 340, ART_CLICK_V: .35,
    prepTiming: { calls: 0, wb: 0, gray: 0, variants: 0 },
    bitmapToImageData: () => { calls.crops.push("source"); return pixels("source"); },
    contentBoxCropImageData: () => { calls.crops.push("content-box"); return content ? pixels("content-box") : null; },
    centerCropImageData: (_bmp, scale, point) => { calls.crops.push({ scale, point }); return pixels(`center-${scale}`); },
    anchoredCropImageData: (_bmp, scale, point, anchor) => { calls.crops.push({ scale, point, anchor }); return pixels("art"); },
    whiteBalance: image => { calls.prepared.push(image.kind); return image; },
    toGray: image => image, queryVariants: image => [image], queryVariantsUpright: image => [image],
    hashWords: value => value, detailScore: () => 50,
    wordDistance: query => query.distance,
    cardMeta: (_index, distance) => ({ ...printing, distance }),
    findCardQuads: () => { if (failure === "outline") throw new Error("outline unavailable"); return ["quad"]; },
    rectifyCard: () => ({ image: pixels("outline") }),
    verifyTopMatches: async (...args) => {
      calls.verify.push(args);
      if (failure === "verify") throw new Error("verification unavailable");
      return { matches: args[0], artDecisive: decisive, artBest: { inliers: decisive ? 50 : 2 }, artChecked: 1 };
    },
    cachedReferencePreview: match => { calls.referencePreviews.push(match); return match ? "exact-face-preview" : null; },
    lastMiloContext: null, deferredMiloContext: null, currentMiloOwner: 0, miloOwnerActive: true, miloOwnerCancellation: null,
    lastTitleSource: { scanId: null, candidates: [] }, fullFamily: 0,
  });
  vm.runInContext(hintGate + identifyEntry + ownership + handler, context);
  const bitmap = () => ({ width: 1000, height: 600, close() { closes++; } });
  const request = async (options = {}) => {
    const prior = closes;
    await context.self.onmessage({ data: { id: "scan", type: "identify", bmp: bitmap(),
      point: { nx: .2, ny: .8 }, hints: [hint], ...options } });
    assert.equal(closes - prior, 1, "the transferred bitmap is closed exactly once on hit, miss, fallback, or error");
    return calls.replies.at(-1);
  };
  return { context, calls, request };
}

const json = value => JSON.parse(JSON.stringify(value));
for (const options of [{ local: 90 }, { local: 150, decisive: true }, { outline: 90 }]) {
  const ordinary = fixture(options), prepass = fixture(options);
  const before = await ordinary.request(), after = await prepass.request({ hintsOnly: true });
  assert.deepEqual(json(after), json(before), "a verified hit preserves every ordinary hint result and timing field");
  assert.equal(after.hintHit, true);
  assert.equal(after.matches[0].scryfall_id, hint.scryfall_id);
  assert.equal(after.matches[0].face, 1, "back-face hints cannot change face");
  assert.equal(after.referencePreview, "exact-face-preview");
  assert.equal(prepass.context.fullFamily, 0);
  assert.equal(prepass.calls.prepared.length, options.outline ? 7 : 6, "local six-crop tier precedes outline work");
  if (!options.outline) assert.equal(prepass.calls.prepared.includes("outline"), false);
}

for (const options of [{}, { local: 91 }, { local: 180 }, { local: 181 },
  { cvReady: false }, { content: false }, { failure: "outline" }]) {
  const missed = fixture(options);
  const reply = await missed.request({ hintsOnly: true });
  assert.equal(reply.hintMiss, true);
  assert.equal(reply.hintHit, undefined);
  assert.equal(reply.matches.length, 0);
  assert.equal(reply.candidatesTried, 0);
  assert.equal(reply.artDecisive, false);
  assert.equal(reply.referencePreview, null);
  assert.ok(Number.isFinite(reply.stageMs.hint) && Number.isFinite(reply.stageMs.hintPrep));
  assert.equal(missed.context.fullFamily, 0, "a stale hint cannot enter global crop generation or scoring");
  assert.equal(missed.calls.referencePreviews.length, 0, "a miss cannot fetch or expose a winner image");
  assert.equal(missed.calls.prepared.length, options.cvReady === false || options.failure ? 6 : options.content === false ? 6 : 7);
  assert.equal(missed.calls.verify.length, options.local >= 91 && options.local <= 180 ? 1 : 0,
    "distance 90 stays exact, 91–180 needs decisive artwork, and 181 is rejected before verification");
  assert.equal(missed.context.lastTitleSource.candidates.length, 0);
  assert.equal(missed.context.lastMiloContext, null);
}

for (const hints of [[], [{ ...hint, face: 0 }], [{ scryfall_id: "untrusted", face: 1 }]]) {
  const missed = fixture({ local: 0, outline: 0 });
  const reply = await missed.request({ hintsOnly: true, hints });
  assert.equal(reply.hintMiss, true, "missing, invalid, or absent exact-face hints are never accepted");
  assert.equal(missed.calls.verify.length, 0);
}

for (const flag of [undefined, false, "true", 1]) {
  const ordinary = fixture();
  const reply = await ordinary.request({ hintsOnly: flag });
  assert.equal(reply.fullFamilyReached, true, "only explicit true changes the worker route");
  assert.equal(reply.hintMiss, undefined);
  assert.equal(ordinary.context.fullFamily, 1);
}
for (const failure of ["index", "verify"]) {
  const failed = fixture({ local: 150, failure });
  const reply = await failed.request({ hintsOnly: true });
  assert.match(reply.error, /unavailable/);
  assert.equal(reply.hintMiss, undefined, "errors remain errors rather than false verified hits or synthetic misses");
  assert.equal(failed.calls.referencePreviews.length, 0);
}

assert.match(source, /let DISTINCT_NAME_ORB_STOP = false;/, "the rejected shortlist experiment remains disabled");
console.log("OK: the worker hint-only route preserves both verification tiers, exact printing/face hits, bitmap ownership, errors, and ordinary fallback");
