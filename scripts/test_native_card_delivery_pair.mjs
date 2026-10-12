import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateNativePair, validateNativeTailPair, NATIVE_TAIL_THRESHOLDS } from "./check_native_card_delivery_pair.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
function report(freshMs, repeatMs, build) {
  const lookup = (i, mode, ms) => ({ got: `Card ${i}`, correct: true, by: "art-match", confidence: 1,
    displayMs: ms, image: { width: 146, height: 204, opacity: 1, kind: "preview" },
    winner: { id: `12345678-1234-4123-8123-${String(i).padStart(12, "0")}`, face: 0 },
    timing: { remote: true, hintHit: mode === "repeat", captureMs: 250, recognitionMs: ms - 260, totalMs: ms - 10 },
    capture: { sha256: digest(`camera pixels ${i} ${mode}`), width: 594, height: 594, bytes: 90000,
      selected: 0, frames: [0, 1, 2].map(index => ({ index, at: index * 120, score: 30 - index })) } });
  return { ok: true, sample: "authoritative SNAPTEST realLife 200, seed 20260803", build, commit: build,
    errors: [], nativeErrors: [], blockedWrites: [], warmup: { core: { status: "ready" }, milo: { status: "ready" } },
    catalogDigests: Object.fromEntries(["public/carddata/manifest.json", "public/carddata/cards.json", "public/carddata/milo/manifest.json"].map(file => [file, digest(file)])),
    catalog: { manifest: { count: 113269 }, milo: { model: "milo1", count: 113269, dimension: 128, revision: "a".repeat(40),
      model_sha256: digest("model"), seed_sha256: digest("gallery seed"), preprocess: "compatible",
      cards_sha256: digest("public/carddata/cards.json"), files: Object.fromEntries([["vectors.bin", 128], ["norms.bin", 4], ["names.bin", 4]].map(([file, size]) => [file, { sha256: digest(file), bytes: 113269 * size }])) } },
    sourceDigests: Object.fromEntries(["src/webrtc.js", "src/Game.jsx", "src/recognition/matcher.js", "src/recognition/recognizer.js", "src/snaptest/scene.js"].map(file => [file, digest(file)])),
    rows: Array.from({ length: 200 }, (_, i) => ({ id: `printing-${i}`, name: `Card ${i}`, scene: Math.floor(i / 10), index: i % 10,
      nx: .5, ny: .5, rotation: ["upright", "tapped", "inverted"][i % 3], coverage: 0, clipped: 0,
      layout: "side-by-side", occ: "clear", pool: "card", fresh: lookup(i, "fresh", freshMs), repeat: lookup(i, "repeat", repeatMs) })) };
}
const control = report(1200, 500, "control"), candidate = report(800, 450, "candidate");
const thresholds = { maxFreshMedianRatio: .8, minFreshUnder1Gain: 5, maxRepeatMedianRatio: 1.05, minRepeatUnder1Gain: 0 };
const check = value => validateNativePair(control, value, thresholds);
const good = check(candidate);
assert.equal(good.ok, true); assert.equal(good.matchedCaptures, 400); assert.equal(good.summary.fresh.candidate.correctUnder1s, 200);
assert.equal(good.summary.fresh.candidate.byRotation.tapped.n, 67); assert.equal(good.summary.repeat.candidate.confident.correct, 200);
assert.equal(good.summary.fresh.candidate.firstHalf.correct, 100);
assert.equal(validateNativePair(control, candidate).ok, false, "latency thresholds must be supplied from measurements");
const freshControl = structuredClone(control), freshCandidate = structuredClone(candidate);
for (const arm of [freshControl, freshCandidate]) for (const row of arm.rows) row.repeat = null;
const freshOnly = validateNativePair(freshControl, freshCandidate, { maxFreshMedianRatio: .8, minFreshUnder1Gain: 5 });
assert.equal(freshOnly.ok, true); assert.deepEqual(freshOnly.modes, ["fresh"]);
assert.equal(freshOnly.matchedCaptures, 200); assert.equal(freshOnly.matchedSourceCaptures, 400);
assert.equal(validateNativePair(freshControl, freshCandidate).ok, true, "fresh-only runs use the predeclared 10%/+5 gate");
assert.equal(validateNativePair(freshControl, freshCandidate, { maxFreshMedianRatio: .95, minFreshUnder1Gain: 1 }).ok, false, "the predeclared gate cannot be weakened");
assert.equal(validateNativePair(control, freshCandidate, thresholds).ok, false, "one-sided repeats cannot silently disappear");

for (const missing of [false, true]) {
  const edited = structuredClone(candidate);
  edited.rows[17].fresh.capture.sha256 = missing ? null : digest("different camera frame");
  const result = check(edited);
  assert.equal(result.ok, false); assert.equal(result.exactPaired, false); assert.equal(result.status, "not-valid-exact-pair");
  assert.equal(result.captureMismatches[0].index, 7);
}
const repeatPixels = structuredClone(candidate); repeatPixels.rows[0].repeat.capture.sha256 = digest("different repeat frame");
assert.equal(check(repeatPixels).exactPaired, false, "repeat captures cannot bypass the same-pixel gate");
const lost = structuredClone(candidate); lost.rows[0].fresh.got = "Wrong card"; lost.rows[0].fresh.correct = false;
assert.equal(check(lost).confidentErrors.length, 1); assert.equal(check(lost).regressions.length, 1); assert.equal(check(lost).ok, false);
lost.rows[0].fresh.by = null;
assert.equal(check(lost).ok, false, "an uncertain label cannot hide a lost correct identity");
const lie = structuredClone(candidate); lie.rows[0].fresh.got = "Wrong card";
assert.ok(check(lie).failures.some(message => message.includes("correct flag")));
const short = structuredClone(candidate); short.rows.pop(); assert.equal(check(short).ok, false);
const missingRepeat = structuredClone(candidate); missingRepeat.rows[0].repeat = null; assert.equal(check(missingRepeat).ok, false);
const moved = structuredClone(candidate); moved.rows[0].nx = .55; assert.equal(check(moved).ok, false);
const rotated = structuredClone(candidate); rotated.rows[0].rotation = "inverted"; assert.equal(check(rotated).ok, false);
const changedScene = structuredClone(candidate); changedScene.sourceDigests["src/snaptest/scene.js"] = digest("other scene code"); assert.equal(check(changedScene).ok, false);
const changedCatalog = structuredClone(candidate); changedCatalog.catalogDigests["public/carddata/cards.json"] = digest("new catalog"); assert.equal(check(changedCatalog).ok, false);
const changedModel = structuredClone(candidate); changedModel.catalog.milo.revision = "b".repeat(40); assert.equal(check(changedModel).ok, false);
const face = structuredClone(candidate); face.rows[0].fresh.winner.face = 1; assert.equal(check(face).ok, false);
const reprint = structuredClone(candidate); reprint.rows[0].fresh.winner.id = "87654321-1234-4123-8123-123456789abc";
assert.equal(check(reprint).ok, true); assert.equal(check(reprint).winnerChanges.length, 1, "same-card/face printing changes are reported without inventing a failure");
const missingConfidence = structuredClone(candidate); missingConfidence.rows[0].fresh.confidence = null; assert.equal(check(missingConfidence).ok, false);
const emptyConfidence = structuredClone(candidate); for (const row of emptyConfidence.rows) row.fresh.by = null; assert.equal(check(emptyConfidence).ok, false);
const blurred = structuredClone(candidate); blurred.rows[0].fresh.capture.selected = 2; assert.equal(check(blurred).ok, false);
const invisible = structuredClone(candidate); invisible.rows[0].fresh.image.opacity = .5; assert.equal(check(invisible).ok, false);
const premature = structuredClone(candidate); premature.rows[0].fresh.timing.totalMs = 2000; assert.equal(check(premature).ok, false);
const slow = report(1200, 450, "candidate"); slow.summary = { fresh: { displayMs: { p50: 1 }, correctUnder1s: 200 } };
assert.equal(check(slow).ok, false, "recompute timing/subsecond counts instead of trusting reported summaries");
const errored = structuredClone(candidate); errored.nativeErrors.push("peer failed"); assert.equal(check(errored).ok, false);
console.log("Native pair gate requires all 200 exact fresh JPEG pairs, checks any included repeats, and preserves identities, confident precision, visible paint and explicit measured latency thresholds");

// The subsecond median is already achieved: a separate, predeclared policy
// evaluates the slow tail without changing the original median gate.
const tailControl=report(800,500,"tail-control"),tailCandidate=report(800,500,"tail-candidate");
for(const arm of [tailControl,tailCandidate])for(const row of arm.rows)row.repeat=null;
const time=(row,ms)=>{row.fresh.displayMs=ms;row.fresh.timing.recognitionMs=ms-260;row.fresh.timing.totalMs=ms-10;};
for(let i=150;i<200;i++){time(tailControl.rows[i],2000);time(tailCandidate.rows[i],i<170?950:1500);}
assert.deepEqual(NATIVE_TAIL_THRESHOLDS,{maxFreshMedianRatio:1.05,maxFreshP90Ratio:.85,minFreshUnder1Gain:10});
const tail=validateNativeTailPair(tailControl,tailCandidate);
assert.equal(tail.ok,true);assert.equal(tail.policy,"tail-improvement");
assert.equal(tail.gains.fresh.p90Ratio,.75);assert.equal(tail.gains.fresh.correctUnder1s,20);
assert.equal(validateNativePair(tailControl,tailCandidate).ok,false,"unchanged median cannot pass the original median policy");
for(const changed of [{maxFreshMedianRatio:1.06},{maxFreshP90Ratio:.86},{minFreshUnder1Gain:9}])
 assert.equal(validateNativeTailPair(tailControl,tailCandidate,changed).ok,false,"tail thresholds cannot be weakened after measuring");
const slowTail=structuredClone(tailCandidate);for(let i=170;i<200;i++)time(slowTail.rows[i],1900);
assert.equal(validateNativeTailPair(tailControl,slowTail).ok,false,"more subsecond cards alone cannot hide a slow p90");
const fewerSubsecond=structuredClone(tailCandidate);for(let i=150;i<165;i++)time(fewerSubsecond.rows[i],1500);
assert.equal(validateNativeTailPair(tailControl,fewerSubsecond).ok,false,"p90 alone cannot hide fewer than ten extra correct subsecond cards");
const changedTailPixel=structuredClone(tailCandidate);changedTailPixel.rows[0].fresh.capture.sha256=digest("changed tail input");
assert.equal(validateNativeTailPair(tailControl,changedTailPixel).exactPaired,false);
const tailWrong=structuredClone(tailCandidate);tailWrong.rows[0].fresh.got="Other";tailWrong.rows[0].fresh.correct=false;
assert.equal(validateNativeTailPair(tailControl,tailWrong).ok,false,"tail speed cannot hide a lost correct/confident card");
console.log("Native tail policy preserves the same 200-pixel/accuracy proof and requires predeclared p90/subsecond gains with bounded median change");
