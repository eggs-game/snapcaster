import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const worker = readFileSync(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
const headerEnd = worker.indexOf("/* eslint");
assert.ok(headerEnd > 0, "Read the actual production alignment helper");
const rawHelper = worker.slice(0, headerEnd);
const tests = readFileSync(new URL("./test_verifier_work.mjs", import.meta.url), "utf8");
const slice = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to));
// Reconstruct the previous uncancellable primitive loop from the actual
// function. No Git state, private files or copied verifier implementation.
const verifyStart = worker.indexOf("async function verifyTopMatches(");
const verifyEnd = worker.indexOf("async function visualFallback(", verifyStart);
const currentVerify = worker.slice(verifyStart, verifyEnd);
assert.ok(currentVerify.includes("const waitForReference ="), "production must support cancellation before a held reference resolves");
assert.ok(currentVerify.includes("inspected.size % 8 === 0"), "warm loops require a bounded task boundary");
let previousVerify = currentVerify
  .replace(/  const assertActive = \(\) => \{\n[\s\S]*?\n  \};\n/, "")
  .replace(/  const waitForReference = promise =>[\s\S]*?\}\)\]\) : promise;\n/, "")
  .replace(/^[ \t]*assertActive\(\);\n/gm, "")
  .replace(/^[ \t]*if \(isActive && inspected\.size % 8 === 0\) await new Promise\(resolve => setTimeout\(resolve, 0\)\);\n/gm, "")
  .replace("await waitForReference(Promise.all([jobs[i], detailJobs[i], enlargedJobs[i]]))", "await Promise.all([jobs[i], detailJobs[i], enlargedJobs[i]])")
  .replace("await waitForReference(fetchReference(rival.scryfall_id, rival.face || 0))", "await fetchReference(rival.scryfall_id, rival.face || 0)");
assert.ok(!previousVerify.includes("assertActive") && !previousVerify.includes("waitForReference")
  && !previousVerify.includes("inspected.size % 8 === 0"), "positive control actually removes every cancellation guard/yield");
const control = worker.slice(0, verifyStart) + previousVerify + worker.slice(verifyEnd);
class Pixels { constructor(data, width, height) { Object.assign(this, { data, width, height }); } }
const image = (seed, width = 28, height = 40) => new Pixels(Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 13 + seed * 37) % 256), width, height);
const fixture = vm.createContext({ vm, slice, performance, setTimeout, Pixels, image });
vm.runInContext(slice(tests, 'function verifier(', '\nfor (const scores'), fixture);
const create = (source, ...args) => fixture.verifier(source, ...args);
const cacheFor = f => f.context.RawAlignmentCache ? new f.context.RawAlignmentCache(256) : null;
const plain = value => JSON.parse(JSON.stringify(value));
const match = (id = 'id') => ({ name: `Card ${id}`, scryfall_id: id, distance: 90 });
for (const [contrast, threshold] of [[false, 20], [true, 20], [true, 8]]) {
  const base = create(control, { small: 40, normal: 30, detail: 20 });
  const candidate = create(worker, { small: 40, normal: 30, detail: 20 });
  const args = [[match()], [image(1)], true, image(3, 594, 594), { x: 120, y: 120 }, 0, [{ mappedClick: { x: 120, y: 120 } }], contrast, threshold];
  const expected = await base.context.verifyTopMatches(...args);
  args[0] = [match()];
  const cache = cacheFor(candidate);
  assert.deepEqual(plain(await candidate.context.verifyTopMatches(...args, cache, () => true)), plain(expected));
  args[0] = [match()];
  assert.deepEqual(plain(await candidate.context.verifyTopMatches(...args, cache, () => true)), plain(expected));
  if (cache) {
    if (!contrast && threshold === 20) assert.ok(candidate.timing.alignmentCacheHits > 0, 'combined active fixture actually reuses raw primitive alignment');
    else assert.equal(cache.entries.size, 0, 'CLAHE and FAST8 continue to bypass primitive caching');
  }
}
{
  const cancelled = create(worker, [40], 1, false), cache = cacheFor(cancelled);
  cancelled.context.fetchReference = () => { throw new Error('obsolete reference fetch started'); };
  cancelled.context.orbFeatures = () => { throw new Error('obsolete native feature allocation started'); };
  await assert.rejects(cancelled.context.verifyTopMatches([match()], [image(1)], false,
    null, null, 0, [], false, 20, cache, () => false), /Superseded recognition verification/);
}
for (const stage of ['query', 'source', 'rival']) {
  const scores = stage === 'source' ? [60, ...Array(11).fill(0)] : [40];
  const f = create(worker, scores, scores.length, false);
  let release, active = true, queryHandles = 0, sourceHandles = 0, rivalFetch = false, rivalChallenges = 0;
  const originalFeatures = f.context.orbFeatures;
  f.context.orbFeatures = (...args) => {
    const features = originalFeatures(...args), source = args[1] === 1600;
    features.count = args[1];
    if (![500, 1600].includes(args[1])) return features;
    source ? sourceHandles += 2 : queryHandles += 2;
    features.kp.delete = features.desc.delete = () => { source ? sourceHandles-- : queryHandles--; };
    return features;
  };
  if (stage === 'source') {
    const align = f.context.orbAlignment;
    f.context.orbAlignment = (query, ...args) => query.count === 1600
      ? { inliers: 0, artInliers: 0, textInliers: 0, halfInliers: [0, 0], inside: null }
      : align(query, ...args);
  }
  const cache = cacheFor(f), queryImage = image(1), cameraImage = image(3, 594, 594);
  const matches = scores.map((_, i) => ({ ...match(i), distance: stage === 'source' && i === 11 ? 1 : 90 + i }));
  const argumentsFor = entries => [entries, [queryImage], false,
    stage === 'source' ? cameraImage : null, stage === 'source' ? { x: 120, y: 120 } : null,
    0, [], false, 20, cache, () => active];
  // Populate the same owner's cache first. A cancelled await must reject even
  // when the next alignment would otherwise be an immediate cache hit.
  await f.context.verifyTopMatches(...argumentsFor(matches.map(entry => ({ ...entry }))));
  if (stage === 'rival') {
    f.context.catalogArtworkRivals = () => [{ scryfall_id: 'catalog-rival', face: 0 }];
    f.context.referencesShareArtwork = () => { rivalChallenges++; return false; };
  }
  const originalFetch = f.context.fetchReference;
  f.context.fetchReference = (id, ...rest) => id === (stage === 'source' ? 11 : stage === 'rival' ? 'catalog-rival' : 0)
    ? new Promise(resolve => { if (stage === 'rival') rivalFetch = true; release = () => originalFetch(id, ...rest).then(resolve); }) : originalFetch(id, ...rest);
  const pending = f.context.verifyTopMatches(...argumentsFor(matches));
  // Task-yield variants may pause at eight references before reaching a held
  // source/rival fetch. Wait for that actual boundary rather than one tick.
  for (let iteration = 0; iteration < 100; iteration++) {
    if (release && (stage === 'source' ? sourceHandles === 2 : stage === 'rival' ? rivalFetch : queryHandles === 2)) break;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.equal(typeof release, 'function');
  assert.equal(queryHandles, stage === 'query' ? 2 : 0);
  assert.equal(sourceHandles, stage === 'source' ? 2 : 0);
  active = false; release();
  await assert.rejects(pending, /Superseded recognition verification/);
  assert.equal(queryHandles, 0); assert.equal(sourceHandles, 0);
  assert.equal(f.timing.refsRanked, stage === 'source' ? 10 : 1, 'cancelled reference cannot start another query/rival');
  if (stage === 'query' && cache) assert.equal(f.timing.alignmentCacheHits, 0, 'a populated primitive cache cannot bypass owner invalidation');
  assert.equal(rivalChallenges, 0, 'cancelled catalog reference cannot start shared-artwork verification');
}

const ownerFunctions = code => slice(code, 'function beginMiloOwner(', 'function prefetchMiloRows(');
function owned(f, code = worker) {
  Object.assign(f.context, { currentMiloOwner: 0, miloOwnerActive: true, miloOwnerCancellation: null,
    lastMiloContext: null, deferredMiloContext: null, lastTitleSource: { scanId: null, candidates: [] } });
  vm.runInContext(ownerFunctions(code), f.context);
  assert.equal(f.context.beginMiloOwner(10), true);
  return f.context.miloOwnerGuard(10);
}
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error));
process.on('unhandledRejection', onUnhandled);
try {
  for (const stage of ['query', 'source', 'rival']) for (const action of ['release', 'new-owner']) {
    const scores = stage === 'source' ? [60, ...Array(11).fill(0)] : [40];
    const f = create(worker, scores, scores.length, false), guard = owned(f), cache = cacheFor(f);
    let publicResolve, publicReject, queryHandles = 0, sourceHandles = 0, heldRival = false;
    const features = f.context.orbFeatures;
    f.context.orbFeatures = (...args) => {
      const value = features(...args), source = args[1] === 1600;
      value.count = args[1];
      if (![500,1600].includes(args[1])) return value;
      source ? sourceHandles += 2 : queryHandles += 2;
      value.kp.delete = value.desc.delete = () => { source ? sourceHandles-- : queryHandles--; };
      return value;
    };
    if (stage === 'source') {
      const alignment = f.context.orbAlignment;
      f.context.orbAlignment = (query, ...args) => query.count === 1600
        ? { inliers: 0, artInliers: 0, textInliers: 0, halfInliers: [0,0], inside: null } : alignment(query, ...args);
    }
    if (stage === 'rival') f.context.catalogArtworkRivals = () => [{ scryfall_id: 'catalog-rival', face: 0 }];
    const fetch = f.context.fetchReference, target = stage === 'query' ? 0 : stage === 'source' ? 11 : 'catalog-rival';
    f.context.fetchReference = (id, ...args) => id === target ? new Promise((resolve, reject) => {
      if (stage === 'rival') heldRival = true;
      publicResolve = () => fetch(id, ...args).then(resolve); publicReject = () => reject(new Error('late public download failure'));
    }) : fetch(id, ...args);
    const pool = scores.map((_, index) => ({ ...match(index), distance: stage === 'source' && index === 11 ? 1 : 90 + index }));
    const waiting = f.context.verifyTopMatches(pool, [image(1)], false,
      stage === 'source' ? image(3,594,594) : null, stage === 'source' ? { x:120,y:120 } : null,
      0, [], false, 20, cache, guard);
    for (let tick = 0; tick < 100; tick++) {
      if (publicResolve && (stage === 'query' ? queryHandles === 2 : stage === 'source' ? sourceHandles === 2 : heldRival)) break;
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.equal(typeof publicResolve, 'function');
    if (action === 'release') f.context.releaseMiloOwner(10); else f.context.beginMiloOwner(11);
    let deadline;
    try {
      await Promise.race([assert.rejects(waiting, /Superseded recognition verification/),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('owner cancellation waited for the held public reference')), 250); })]);
    } finally { clearTimeout(deadline); }
    assert.equal(queryHandles, 0); assert.equal(sourceHandles, 0);
    const cancelledPool = JSON.stringify(pool);
    // The losing public promise remains handled whether it later resolves or
    // rejects. Its completion cannot resume an old loop or mutate old scores.
    if (action === 'release') publicResolve(); else publicReject();
    await new Promise(setImmediate); await new Promise(setImmediate);
    assert.equal(JSON.stringify(pool), cancelledPool);
    if (action === 'new-owner') {
      const latest = f.context.miloOwnerGuard(11); let latestCancelled = false;
      latest.cancelled.then(() => { latestCancelled = true; });
      f.context.releaseMiloOwner(10); await new Promise(setImmediate);
      assert.equal(latest(), true); assert.equal(latestCancelled, false, 'stale release cannot abort a newer owner');
      f.context.releaseMiloOwner(11); await latest.cancelled;
      assert.equal(latest(), false); assert.equal(latestCancelled, true);
    }
  }
  assert.deepEqual(unhandled, []);
} finally { process.off('unhandledRejection', onUnhandled); }

// Positive control: removing owner races/guards restores the held-fetch bug.
{
  const f = create(control, [40], 1, false), guard = owned(f, control);
  let publicResolve, outcome = 'pending';
  const fetch = f.context.fetchReference;
  f.context.fetchReference = (...args) => new Promise(resolve => { publicResolve = () => fetch(...args).then(resolve); });
  const waiting = f.context.verifyTopMatches([match()], [image(1)], false, null,null,0,[],false,20,cacheFor(f),guard)
    .then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; });
  await new Promise(setImmediate); f.context.releaseMiloOwner(10); await new Promise(setImmediate);
  assert.equal(outcome, 'pending', 'the positive control still waits for the public download after cancellation');
  publicResolve(); await waiting; assert.equal(outcome, 'resolved');
}

// Execute the actual worker response handler around a held identify. A late
// old result must never replace newer OCR pixels or recreate released pixels.
for (const action of ['release', 'new-owner']) {
  const f = create(worker, [40], 1, false); owned(f);
  const context = f.context, replies = []; let finish;
  const completed = { scanId: 9, candidates: [{ tag: 'completed-source' }] };
  context.lastTitleSource = completed;
  Object.assign(context, { self: { postMessage: data => replies.push(data) }, cachedReferencePreview: () => null,
    identify: async () => { await new Promise(resolve => { finish = resolve; }); return { matches: [], titleSource: [{ tag: 'obsolete-source' }] }; } });
  vm.runInContext(worker.slice(worker.indexOf('self.onmessage = async (e)')), context);
  const waiting = context.self.onmessage({ data: { type:'identify',id:12,ownerId:10,bmp:{close(){}} } });
  await new Promise(setImmediate);
  let expected = completed;
  if (action === 'release') context.releaseMiloOwner(10);
  else {
    context.beginMiloOwner(11); assert.equal(context.lastTitleSource.candidates.length, 0, 'new owner clears previous OCR pixels');
    expected = { scanId: 20, candidates: [{ tag: 'newer-source' }] }; context.lastTitleSource = expected;
    context.beginMiloOwner(11); assert.equal(context.lastTitleSource, expected, 'same-owner continuation retains its current source');
  }
  finish(); await waiting;
  assert.equal(context.lastTitleSource, expected, 'late cancelled identify cannot overwrite title ownership');
  assert.equal(replies.at(-1).titleSource, undefined, 'private title pixels cannot escape in old worker responses');
  assert.equal(replies.at(-1).error, undefined);
}

// Positive control: cached promises starve the cancellation task in v1.
// Bounded task yields in v2 process it within eight inspected references.
if (worker.includes('inspected.size % 8 === 0')) {
  const oldWorker = control;
  assert.ok(!oldWorker.includes('inspected.size % 8 === 0'), 'positive control retains the microtask-only loop');
  for (const [label, code] of [['microtask-only', oldWorker], ['task-yield', worker]]) {
    const f = create(code, Array(12).fill(30), 12, false), cache = cacheFor(f), pixels = image(7);
    let active = true, handles = 0;
    const features = f.context.orbFeatures;
    f.context.orbFeatures = (...args) => {
      const result = features(...args);
      if (args[1] === 500) { handles += 2; result.kp.delete = result.desc.delete = () => handles--; }
      return result;
    };
    const run = () => f.context.verifyTopMatches(Array.from({ length: 12 }, (_, i) => match(i)), [pixels], false,
      null, null, 0, [], false, 20, cache, () => active);
    await run(); // All reference and primitive entries are genuinely warm.
    const task = setTimeout(() => { active = false; }, 0);
    if (label === 'microtask-only') {
      await run(); assert.equal(active, true); assert.equal(f.timing.refsRanked, 12);
    } else {
      await assert.rejects(run(), /Superseded recognition verification/);
      assert.ok(f.timing.refsInspected <= 8, 'warm matching has a bounded cancellation task boundary');
    }
    assert.equal(handles, 0); clearTimeout(task);
  }
}
console.log('Combined primitive cache/owner checks preserve active raw/CLAHE/FAST8 proofs, clean held query/source/rival awaits, and process warm-loop cancellation within eight references');
