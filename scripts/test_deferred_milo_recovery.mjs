import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function contentSupportsIdentity("), source.indexOf("function homographySourceQuad("));
const owners = source.slice(source.indexOf("function beginMiloOwner("), source.indexOf("function prefetchMiloRows("));
const verify = source.slice(source.indexOf("async function verifyMiloRows("), source.indexOf("self.onmessage = async (e)"));
const handler = source.slice(source.indexOf("self.onmessage = async (e)"));
const printing = { name: "Retrieved", scryfall_id: "retrieved", face: 0, distance: 150,
  click_inside: true, click_inliers: 30, click_art_inliers: 20, milo_retrieval: true };
const old = { name: "Rival", scryfall_id: "rival", face: 0, distance: 190 };
function frame(scanId, tag, ownerId = 10) {
  const query = { tag: tag + "-query" }, source = { tag: tag + "-source" }, click = { x: scanId, y: 20 };
  return { scanId, ownerId, queryImages: [query], images: [query], source, click,
    sourceRegions: new Map([[query, { mappedClick: { x: 3, y: 4 }, cameraToCrop: [1,0,0,0,1,0,0,0,1] }]]),
    base: [{ ...old }], dists: [190,150], blockedNames: [],
    result: { matches: [{ ...old }], printingMatches: [{ ...old }], artChecked: 1 } };
}
function workerContext() {
  const calls = [], replies = [], timing = {};
  let hold;
  const context = vm.createContext({ self: { postMessage: data => replies.push(data) },
    splitIdentitySupported: () => true, cards: [[], []], cardsSha256: "current", orbTiming: timing,
    lastMiloContext: frame(7, "initial"), deferredMiloContext: null, currentMiloOwner: 10, miloOwnerActive: true, miloOwnerCancellation: null,
    lastTitleSource: { scanId: null, candidates: [] }, cachedReferencePreview: () => null,
    cardMeta: () => ({ ...printing }),
    verifyTopMatches: async (pool, queries, shaped, pixels, click, added, regions, contrast = false, threshold = 20) => {
      calls.push({ pool, queries, shaped, pixels, click, added, regions, contrast, threshold });
      timing.fastThreshold = threshold; timing.restoreContrast = contrast;
      if (threshold === 20) {
        // The normal enhanced pass may alter its own clones. Recovery must
        // reuse the raw-populated pool, including its unresolved rival.
        for (const match of pool) match.proofTag = contrast ? "enhanced" : "raw";
        return { matches: pool, checkedMatches: pool, artDecisive: false, artChecked: pool.length };
      }
      assert.ok(pool.every(match => match.proofTag === "raw"));
      assert.deepEqual(Array.from(pool, match => match.name), ["Retrieved", "Rival"]);
      assert.equal(contrast, true); assert.equal(added, 1);
      if (hold) await new Promise(resolve => { hold = resolve; });
      return { matches: [{ ...printing }, { ...old }], checkedMatches: [{ ...printing }], artDecisive: true,
        artBest: { clickInside: true, inliers: 30, clickInliers: 30 }, artChecked: 2 };
    },
  });
  vm.runInContext(helpers + owners + verify + handler, context);
  return { context, calls, replies, hold: () => { hold = true; }, release: () => hold() };
}

// Preserve just one original context while normal retry creates its own.
{
  const { context, calls } = workerContext(), initial = context.lastMiloContext;
  const first = await context.verifyMiloRows(7, [{ row: 1, score: .99 }], "current", { ownerId: 10, retainOriginal: true });
  assert.equal(first.miloRecoveryEligible, true);
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.threshold === 20));
  assert.equal(context.deferredMiloContext, initial);
  context.lastMiloContext = frame(8, "retry");
  await context.verifyMiloRows(8, [{ row: 1, score: .99 }], "current", { ownerId: 10 });
  assert.equal(calls.length, 4, "normal retry still cannot run FAST8");
  assert.equal(context.deferredMiloContext, initial, "retry must not replace the original retained source");
  const original = await context.verifyMiloRows(7, [], "current", { ownerId: 10, recovery: true });
  assert.equal(original.miloRescued, true);
  assert.equal(calls[4].pixels, initial.source); assert.equal(calls[4].click, initial.click);
  assert.equal(calls[4].queries[0], initial.queryImages[0]);
  assert.equal(calls[4].regions[0], initial.sourceRegions.get(initial.queryImages[0]));
  assert.equal(context.deferredMiloContext, null);
  await assert.rejects(context.verifyMiloRows(7, [], "current", { ownerId: 10, recovery: true }), /mismatch|not eligible/);
  await context.verifyMiloRows(8, [], "current", { ownerId: 10, recovery: true });
  assert.equal(calls[5].pixels.tag, "retry-source", "the retry has its own exact source-bound recovery");
  await assert.rejects(context.verifyMiloRows(8, [], "current", { ownerId: 10, recovery: true }), /not eligible/);
  assert.equal(calls.length, 6, "each of two eligible contexts is consumed at most once");
}

// Actual worker control messages invalidate both slots and cannot revive a
// cancelled same-generation owner or clear a newer owner's pixels.
for (const action of ["new-owner", "final-release", "timeout-release"]) {
  const state = workerContext(), { context, calls } = state;
  await context.verifyMiloRows(7, [{ row: 1, score: .99 }], "current", { ownerId: 10, retainOriginal: true });
  state.hold();
  const pending = context.verifyMiloRows(7, [], "current", { ownerId: 10, recovery: true });
  await new Promise(setImmediate);
  await context.self.onmessage({ data: action === "new-owner"
    ? { type: "milo-begin", ownerId: 11 } : { type: "milo-release", ownerId: 10 } });
  assert.equal(context.lastMiloContext, null); assert.equal(context.deferredMiloContext, null);
  state.release(); await assert.rejects(pending, /mismatch/, "late sensitive work cannot publish after " + action);
  assert.equal(context.beginMiloOwner(10), false, "an old or terminal generation cannot reactivate itself");
  if (action === "new-owner") {
    context.lastMiloContext = frame(9, "newer", 11);
    await context.self.onmessage({ data: { type: "milo-release", ownerId: 10 } });
    assert.equal(context.lastMiloContext.scanId, 9, "old cleanup cannot release a newer request");
  }
  assert.equal(calls.length, 3);
}

// Identity, catalog and owner mismatches fail before sensitive extraction.
{
  const { context, calls } = workerContext();
  await context.verifyMiloRows(7, [{ row: 1, score: .99 }], "current", { ownerId: 10, retainOriginal: true });
  for (const [scanId, fingerprint, ownerId] of [[8,"current",10], [7,"stale",10], [7,"current",9]])
    await assert.rejects(context.verifyMiloRows(scanId, [], fingerprint, { ownerId, recovery: true }), /mismatch/);
  assert.equal(calls.length, 2);
}

// A late identify response must not recreate released pixels or erase a
// newer owner's context, even though its ordinary response may still drain.
for (const terminal of ["new-owner", "release"]) {
  const { context, replies } = workerContext();
  let finish;
  context.identify = async () => {
    await new Promise(resolve => { finish = resolve; });
    return { matches: [], titleSource: [], miloContext: frame(7, "late") };
  };
  const late = context.self.onmessage({ data: { type: "identify", id: 12, ownerId: 10, bmp: { close() {} } } });
  await new Promise(setImmediate);
  await context.self.onmessage({ data: terminal === "new-owner"
    ? { type: "milo-begin", ownerId: 11 } : { type: "milo-release", ownerId: 10 } });
  const newer = terminal === "new-owner" ? frame(9, "newer", 11) : null;
  context.lastMiloContext = newer;
  finish(); await late;
  assert.equal(context.lastMiloContext, newer, "late identify cannot repopulate a cancelled context");
  assert.equal(context.deferredMiloContext, null);
  assert.equal(replies.at(-1).error, undefined);
}

const matcher = readFileSync(new URL("../src/recognition/matcher.js", import.meta.url), "utf8");
const perform = matcher.slice(matcher.indexOf("async function performIdentify("), matcher.indexOf("let identifyActive"));
for (const scenario of ["initial-hit", "retry-hit", "retry-milo-hit", "initial-recovery", "retry-recovery", "no-recovery", "thin-retry", "recovery-error", "cancel-normal", "cancel-recovery"]) {
  const events = [], releases = [];
  let trial = 0, closed = 0, active = true, resume;
  const base = id => ({ scan_id: id, matches: [{ ...old }], printing_matches: [{ ...old }],
    art_decisive: false, art_best: {}, milo_images: [{ scan: id }], stage_ms: {} });
  const accepted = id => ({ ...base(id), matches: [{ ...printing, identified_by: "art-match" }],
    art_decisive: true, art_best: { clickInside: true, inliers: 30, clickInliers: 30 } });
  const context = vm.createContext({ performance, VISUAL_EXACT_DISTANCE: 90,
    supersededRecognitionError: () => Object.assign(new Error("superseded"), { code: "RECOGNITION_SUPERSEDED" }),
    sourceToBitmap: async () => ({ width: 500, height: 500, close() { closed++; } }),
    createImageBitmap: async bitmap => ({ ...bitmap, close() {} }),
    proposeAiCrops: async (_bitmap, _point, retry) => { events.push(retry ? "retry-crop" : "initial-crop"); return { quads: [{ retry: !!retry }], diagnostic: { status: "ready", ms: 1 } }; },
    runOnWorker: async (bitmap, _point, _hints, quads, aiOnly, _candidates, _milo, _preview, _hintOnly, ownerId) => {
      assert.equal(ownerId, 10);
      if (!aiOnly) { events.push("ordinary"); assert.equal(quads[0].retry, false); bitmap.close(); return base(3); }
      const id = ++trial; events.push(id === 1 ? "initial-hash" : "retry-hash");
      return scenario === "initial-hit" && id === 1 || scenario === "retry-hit" && id === 2 ? accepted(id) : base(id);
    },
    lookupAiCrops: async images => { events.push("lookup-" + images[0].scan); return { rows: [{ row: 1, score: .99 }], cards_sha256: "current", diagnostic: { status: "ready" } }; },
    runMiloVerification: async (scanId, _lookup, options) => {
      assert.equal(options.ownerId, 10);
      events.push((options.recovery ? "sensitive-" : "normal-") + scanId);
      if (scenario === "cancel-normal" && !options.recovery || scenario === "cancel-recovery" && options.recovery)
        await new Promise(resolve => { resume = resolve; });
      if (options.recovery) {
        if (scenario === "recovery-error") throw new Error("source disappeared");
        const hit = scenario === "initial-recovery" && scanId === 1 || ["retry-recovery", "thin-retry"].includes(scenario) && scanId === 2;
        return { ...(hit ? accepted(scanId) : base(scanId)), milo_rescued: hit,
          ...(scenario === "thin-retry" && scanId === 2 ? { art_best: { clickInside: true, inliers: 23, clickInliers: 30 } } : {}) };
      }
      assert.equal(options.retainOriginal === true, scanId === 1);
      if (scenario === "retry-milo-hit" && scanId === 2) return { ...accepted(scanId), milo_rescued: true };
      return { ...base(scanId), milo_rescued: false, milo_recovery_eligible: true, milo_recovery_scan_id: scanId };
    },
    releaseMiloContexts: ownerId => releases.push(ownerId), finishIdentify: async value => value,
  });
  vm.runInContext(perform, context);
  const job = context.performIdentify("source", { nx: .5, ny: .5 }, [], true, true, null,
    { id: 10, isActive: () => active });
  if (scenario.startsWith("cancel")) {
    await new Promise(setImmediate); assert.equal(typeof resume, "function"); active = false; resume();
    await assert.rejects(job, { code: "RECOGNITION_SUPERSEDED" });
    assert.ok(!events.includes("ordinary"));
  } else {
    const result = await job, sensitive = events.filter(event => event.startsWith("sensitive"));
    if (["initial-hit", "retry-hit", "retry-milo-hit"].includes(scenario)) assert.deepEqual(sensitive, [], "a held FAST8 pass cannot delay a normal success");
    else {
      assert.ok(events.indexOf("normal-2") < events.indexOf("sensitive-1"), "both old normal phases must fail before sensitivity changes");
      assert.deepEqual(sensitive, scenario === "initial-recovery" ? ["sensitive-1"] : ["sensitive-1", "sensitive-2"]);
    }
    assert.equal(result.matches[0].name, ["no-recovery", "thin-retry", "recovery-error"].includes(scenario) ? "Rival" : "Retrieved");
    assert.equal(events.includes("ordinary"), ["no-recovery", "thin-retry", "recovery-error"].includes(scenario));
  }
  assert.equal(closed, 1, "selected bitmap ownership is released once after " + scenario);
  assert.deepEqual(releases, [10], "final/error/cancel releases its own retained contexts");
}

// Hold the actual pipeline at each asynchronous boundary that previously
// permitted obsolete work or an obsolete result to continue.
for (const stage of ["decode", "retry-hash", "retry-lookup", "ordinary", "finish"]) {
  let active = true, resume, workerCalls = 0, lookupCalls = 0, closes = 0;
  const events = [], releases = [];
  const pause = () => new Promise(resolve => { resume = resolve; });
  const value = { matches: [{ ...old, distance: 250 }], stage_ms: {}, art_decisive: false,
    scan_id: 1, milo_images: [{}], printing_matches: [] };
  const retryStage = stage.startsWith("retry");
  const context = vm.createContext({ performance, VISUAL_EXACT_DISTANCE: 90,
    supersededRecognitionError: () => Object.assign(new Error("superseded"), { code: "RECOGNITION_SUPERSEDED" }),
    sourceToBitmap: async () => { if (stage === "decode") await pause(); return { width: 500, height: 500, close() { closes++; } }; },
    createImageBitmap: async bitmap => ({ ...bitmap, close() {} }),
    proposeAiCrops: async () => { events.push("proposal"); return { quads: retryStage ? [{}] : [], diagnostic: { status: retryStage ? "ready" : "off" } }; },
    runOnWorker: async (bitmap, _point, _hints, _quads, aiOnly) => {
      workerCalls++; events.push("worker-" + workerCalls);
      if (stage === "ordinary" || stage === "retry-hash" && workerCalls === 2) await pause();
      if (!aiOnly) bitmap.close();
      return value;
    },
    lookupAiCrops: async () => {
      lookupCalls++; events.push("lookup-" + lookupCalls);
      if (stage === "retry-lookup" && lookupCalls === 2) await pause();
      return { rows: [{ row: 1, score: .9 }], diagnostic: { status: "ready" }, cards_sha256: "current" };
    },
    runMiloVerification: async () => { events.push("verify"); return value; },
    finishIdentify: async input => { events.push("finish"); if (stage === "finish") await pause(); return input; },
    releaseMiloContexts: ownerId => releases.push(ownerId),
  });
  vm.runInContext(perform, context);
  const job = context.performIdentify("source", { nx: .5, ny: .5 }, [], true, true, null,
    { id: 10, isActive: () => active });
  await new Promise(setImmediate); assert.equal(typeof resume, "function", "hold " + stage);
  active = false; resume();
  await assert.rejects(job, { code: "RECOGNITION_SUPERSEDED" }, stage + " must reject instead of resolving an old result");
  if (stage === "decode") assert.deepEqual(events, [], "late decode cannot start Cornelius or the recognizer");
  if (stage === "retry-hash") assert.equal(lookupCalls, 1, "late retry hash cannot start obsolete Milo lookup");
  if (stage === "retry-lookup") assert.equal(events.filter(event => event === "verify").length, 1,
    "late retry retrieval cannot start obsolete verification");
  if (stage === "ordinary") assert.ok(!events.includes("finish"), "late ordinary fallback cannot start OCR/finish");
  assert.equal(closes, 1, "selected bitmap closes once after late " + stage);
  assert.deepEqual(releases, [10], "late " + stage + " releases only its owner");
}

// Exercise the real matcher timeout adapter rather than merely simulating a
// worker release: it drops pending ownership and sends the terminal release.
{
  const messages = [], pending = new Map(); let timer;
  const ownedWorker = { postMessage: message => messages.push(message) };
  const context = vm.createContext({ worker: ownedWorker, getWorker: () => ownedWorker,
    seq: 20, pending, IDENTIFY_TIMEOUT_MS: 30000,
    setTimeout: callback => { timer = callback; return 1; },
  });
  vm.runInContext(matcher.slice(matcher.indexOf("function releaseMiloContexts("), matcher.indexOf("function prefetchMiloReferences(")), context);
  const waiting = context.runMiloVerification(7, { rows: [{ row: 1, score: .9 }], cards_sha256: "current" },
    { ownerId: 10, recovery: true });
  assert.equal(pending.size, 1); timer();
  await assert.rejects(waiting, /timed out/); assert.equal(pending.size, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), { type: "milo-release", ownerId: 10 });
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0].rows)), [], "recovery transmits no substitute retrieval pool");
}
console.log("OK: normal successes skip FAST8; failed initial/retry snapshots preserve rivals/source and cannot survive new-owner, release, timeout or cancellation");
