import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/recognition/matcher.js', import.meta.url), 'utf8');
const prepare = source.slice(source.indexOf('const capturePreparations ='), source.indexOf('// OCR runs in a small pool'));
const perform = source.slice(source.indexOf('async function performIdentify('), source.indexOf('let identifyActive'));
const queue = source.slice(source.indexOf('let identifyActive'), source.indexOf('// Console debug hook:'));
const code = (prepare + perform + queue).replaceAll('export ', '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const point = { nx: .5, ny: .5 };
const unhandled = [];
const onUnhandled = error => unhandled.push(error);
process.on('unhandledRejection', onUnhandled);
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(options = {}) {
  let clock = 0, ai = true, milo = true, decodedCalls = 0;
  const events = [], decoded = [], copies = [], holds = [], messages = [], published = [];
  const names = new WeakMap();
  const frame = name => { const blob = new Blob([name]); names.set(blob, name); return blob; };
  const makeBitmap = (name, target) => {
    const bitmap = { name, width: 500, height: 500, closed: 0, close() { this.closed++; } };
    target.push(bitmap); return bitmap;
  };
  const context = vm.createContext({ Blob, performance: { now: () => clock }, VISUAL_EXACT_DISTANCE: 90,
    aiCropEnabled: () => ai, miloEnabled: () => milo,
    worker: { postMessage: message => messages.push(message) },
    sourceToBitmap: async input => {
      decodedCalls++;
      if (options.decodeFailure === decodedCalls) throw new Error('decode failed');
      return makeBitmap(names.get(input), decoded);
    },
    createImageBitmap: async bitmap => makeBitmap(bitmap.name, copies),
    proposeAiCrops: async (bitmap, _point, _retry, control) => {
      events.push({ type: 'proposal', name: bitmap.name });
      if (options.geometryGate) await options.geometryGate.promise;
      return { quads: options.empty ? [] : [{}], diagnostic: { status: options.geometryStatus || 'ready', ms: 1 } };
    },
    runOnWorker: async (bitmap, click, hints, _quads, _aiOnly, _candidates, _milo, preview, hintsOnly, ownerId) => {
      events.push({ type: 'worker', name: bitmap.name, point: click, hints, ownerId, hintsOnly });
      if (options.hold) { const held = gate(); holds.push({ ...held, preview }); await held.promise; }
      bitmap.close();
      const weak = options.weakFirst && events.filter(event => event.type === 'worker').length === 1;
      const match = { name: bitmap.name, distance: weak ? 190 : 50, identified_by: weak ? undefined : 'visual-exact' };
      return { matches: [match], printing_matches: [match], stage_ms: {}, art_best: { clickInside: true },
        scan_id: 1, milo_images: weak ? [{}] : [], hint_hit: !!hintsOnly && !!hints.length };
    },
    lookupAiCrops: async () => { events.push({ type: 'lookup' }); if (options.lookupGate) await options.lookupGate.promise;
      return { rows: [{ row: 1, score: .9 }], cards_sha256: 'current', diagnostic: { status: 'ready' } }; },
    runMiloVerification: async () => { events.push({ type: 'verify' }); throw new Error('Unexpected verifier after cancellation'); },
    prefetchMiloReferences: () => {},
    finishIdentify: async value => value,
    releaseMiloContexts: ownerId => messages.push({ type: 'milo-release', ownerId }),
  });
  vm.runInContext(code, context);
  return { context, frame, events, decoded, copies, holds, messages, published,
    clock: value => { clock = value; }, flags: (a, m) => { ai = a; milo = m; },
    state: expression => vm.runInContext(expression, context),
    entry: input => { context.input = input; return vm.runInContext('capturePreparations.get(input)', context); },
    scan: (input, click = point, flags = {}) => context.identify(input, click, flags).then(value => { published.push(value); return value; }),
    async drain() { for (let i = 0; i < 8; i++) { for (const held of holds) held.resolve(); await tick(); } },
    assertClosed() { assert.ok(decoded.every(bitmap => bitmap.closed === 1), 'Each decoded bitmap closes exactly once'); assert.ok(copies.every(bitmap => bitmap.closed === 1), 'Each transferred bitmap closes exactly once'); },
  };
}
const workerCalls = f => f.events.filter(event => event.type === 'worker');

// Exact selected bytes/point/options adopt the already-running owner without a
// second worker scan. No public result exists during the capture window.
{
  const f = fixture({ hold: true }), a = f.frame('A');
  f.context.prepareRecognitionCapture(a, point); await tick();
  const entry = f.entry(a);
  assert.ok(entry.fullJob); assert.equal(workerCalls(f).length, 1); assert.equal(f.published.length, 0);
  assert.equal(f.state('recognitionOwnerSeq'), 1);
  f.clock(90); const result = f.scan(a); await tick();
  assert.equal(f.state('recognitionOwnerSeq'), 1, 'Adoption never increments/supersedes its original owner');
  assert.equal(f.messages.filter(message => message.type === 'milo-begin').length, 1);
  assert.equal(f.published.length, 0, 'Pending early work is not published before final completion');
  f.clock(100); await f.drain();
  const value = await result;
  assert.equal(value.matches[0].name, 'A'); assert.equal(value.ai_crop.fullPrepared, true);
  assert.equal(value.stage_ms.captureRecognitionOverlap, 90);
  assert.equal(workerCalls(f).length, 1); f.assertClosed();
}
// A completed private result still stays private until selection; overlap is
// capped at actual completion rather than claiming the whole capture window.
{
  const f = fixture({ hold: true }), a = f.frame('A');
  f.context.prepareRecognitionCapture(a, point); await tick();
  f.clock(40); await f.drain(); assert.equal(f.published.length, 0);
  f.clock(100); const value = await f.scan(a);
  assert.equal(value.stage_ms.captureRecognitionOverlap, 40); assert.equal(workerCalls(f).length, 1); f.assertClosed();
}
// No full attempt can start with hints, an empty/failed geometry response,
// disabled AI/Milo, a cancelled preparation or a changed UI capture token.
for (const scenario of ['hints', 'empty', 'failed', 'ai-off', 'milo-off', 'cancel', 'token']) {
  const geometryGate = gate(), f = fixture({ geometryGate, empty: scenario === 'empty', geometryStatus: scenario === 'failed' ? 'failed' : 'ready' }), a = f.frame('A');
  let active = true;
  const cancel = f.context.prepareRecognitionCapture(a, point, { hints: scenario === 'hints' ? [{}] : [], isActive: () => active });
  await tick();
  if (scenario === 'ai-off') f.flags(false, true);
  if (scenario === 'milo-off') f.flags(true, false);
  if (scenario === 'cancel') cancel();
  if (scenario === 'token') active = false;
  geometryGate.resolve(); await tick();
  assert.equal(workerCalls(f).length, 0, scenario + ' must not begin a full scan');
  assert.equal(f.state('recognitionOwnerSeq'), 0); assert.equal(f.published.length, 0); f.assertClosed();
}
// A newer owner that runs while geometry is pending cannot be displaced even
// when it has completed and the queue happens to be idle at the detector reply.
{
  const geometryGate = gate(), f = fixture({ geometryGate }), a = f.frame('A'), b = f.frame('B');
  f.context.prepareRecognitionCapture(a, point); await tick();
  // Use an ordinary no-AI scan so this fixture's held detector is irrelevant.
  await f.scan(b, point, { aiCrop: false, milo: false });
  geometryGate.resolve(); await tick();
  assert.equal(workerCalls(f).filter(event => event.name === 'A').length, 0);
  assert.equal(f.state('recognitionOwnerSeq'), 1); f.assertClosed();
}
// The queue must be idle before an early scan can begin. Geometry remains
// optional preparation for the selected normal latest-only job instead.
{
  const f = fixture({ hold: true }), a = f.frame('A'), b = f.frame('B');
  const first = f.scan(b, point, { aiCrop: false, milo: false }); await tick();
  f.context.prepareRecognitionCapture(a, point); await tick();
  assert.equal(f.entry(a).fullJob, undefined); assert.equal(workerCalls(f).length, 1);
  await f.drain(); await first;
  const second = f.scan(a); await f.drain(); const value = await second;
  assert.equal(value.ai_crop.fullPrepared, undefined); assert.equal(workerCalls(f).length, 2); f.assertClosed();
}
// Sharper/different pixels, points, options or newly present hints invalidate
// the early owner and use the established selected-frame path. Late preview
// callbacks cannot schedule another lookup for the cancelled speculative job.
for (const scenario of ['frame', 'point', 'hints', 'milo-off', 'ai-off', 'cancel']) {
  const f = fixture({ hold: true }), a = f.frame('A'), b = f.frame('B');
  const cancel = f.context.prepareRecognitionCapture(a, point); await tick();
  const entry = f.entry(a), early = entry.fullJob;
  assert.ok(early);
  if (scenario === 'frame' || scenario === 'cancel') cancel();
  const input = scenario === 'frame' ? b : a;
  const click = scenario === 'point' ? { nx: .6, ny: .5 } : point;
  const flags = scenario === 'hints' ? { hints: [{}] } : scenario === 'milo-off' ? { milo: false } : scenario === 'ai-off' ? { aiCrop: false } : {};
  const selected = f.scan(input, click, flags); await tick();
  f.holds[0].preview?.([{}]);
  assert.equal(f.events.filter(event => event.type === 'lookup').length, 0, 'Cancelled early preview must not start Milo');
  await f.drain(); const value = await selected;
  await assert.rejects(early, { code: 'RECOGNITION_SUPERSEDED' });
  assert.equal(value.matches[0].name, scenario === 'frame' ? 'B' : 'A');
  assert.equal(value.ai_crop.fullPrepared, undefined);
  assert.equal(f.state('recognitionOwnerSeq'), 2);
  assert.ok(workerCalls(f).slice(1).every(event => event.name === (scenario === 'frame' ? 'B' : 'A')));
  f.assertClosed();
}
// Initial optional decode failure starts no early job and leaves normal
// selection usable. A later speculative decode failure is caught privately;
// selecting another frame cannot surface that hidden error.
{
  const f = fixture({ decodeFailure: 1 }), a = f.frame('A');
  f.context.prepareRecognitionCapture(a, point); await tick();
  assert.equal(f.entry(a).fullJob, undefined); assert.equal(workerCalls(f).length, 0);
  const value = await f.scan(a); assert.equal(value.matches[0].name, 'A'); f.assertClosed();
}
// Geometry may still be queued when selection decodes its winning Blob. A
// cancellation during that await cannot restart a proposal or publish later.
{
  const geometryGate = gate(), f = fixture({ geometryGate }), a = f.frame('A');
  const cancel = f.context.prepareRecognitionCapture(a, point); await tick();
  const selected = f.scan(a); await tick();
  cancel(); geometryGate.resolve();
  await assert.rejects(selected, { code: 'RECOGNITION_SUPERSEDED' }); await tick();
  assert.equal(workerCalls(f).length, 0); assert.equal(f.published.length, 0);
  assert.equal(f.events.filter(event => event.type === 'proposal').length, 1,
    'A cancelled queued preparation must not start a second proposal');
  assert.equal(f.state('identifyActive'), false); f.assertClosed();
}
// A still-pending Milo phase retains the old job privately. Releasing it
// after a different selected frame cannot begin verification/retry or publish.
{
  const lookupGate = gate(), f = fixture({ weakFirst: true, lookupGate }), a = f.frame('A'), b = f.frame('B');
  const cancel = f.context.prepareRecognitionCapture(a, point); await tick();
  const early = f.entry(a).fullJob;
  assert.equal(f.events.filter(event => event.type === 'lookup').length, 1);
  cancel(); const selected = f.scan(b); await tick();
  assert.equal(f.published.length, 0); lookupGate.resolve();
  await assert.rejects(early, { code: 'RECOGNITION_SUPERSEDED' });
  const value = await selected; await tick();
  assert.equal(value.matches[0].name, 'B');
  assert.equal(f.events.filter(event => event.type === 'verify').length, 0);
  assert.equal(f.state('identifyActive'), false); f.assertClosed();
}
{
  const f = fixture({ decodeFailure: 2 }), a = f.frame('A'), b = f.frame('B');
  const cancel = f.context.prepareRecognitionCapture(a, point); await tick();
  const early = f.entry(a).fullJob;
  await assert.rejects(early, /decode failed/); assert.equal(f.published.length, 0);
  assert.ok(f.messages.some(message => message.type === 'milo-release' && message.ownerId === 1),
    'A failed speculative decode before adoption terminates its allocated worker owner');
  cancel(); const value = await f.scan(b); assert.equal(value.matches[0].name, 'B'); f.assertClosed();
}
// If the exact selected frame owns an already-rejected private attempt, the
// failure is reported only at adoption, with no new owner or hidden retry.
{
  const f = fixture({ decodeFailure: 2 }), a = f.frame('A');
  f.context.prepareRecognitionCapture(a, point); await tick();
  const early = f.entry(a).fullJob;
  await assert.rejects(early, /decode failed/);
  assert.equal(f.published.length, 0);
  assert.equal(f.state('recognitionOwnerSeq'), 1);
  await assert.rejects(f.scan(a), /decode failed/);
  assert.equal(f.state('recognitionOwnerSeq'), 1, 'Error adoption keeps its original owner');
  assert.equal(workerCalls(f).length, 0); f.assertClosed();
}
await tick(); process.off('unhandledRejection', onUnhandled);
assert.deepEqual(unhandled, [], 'Every private early rejection has an attached handler');
console.log('PASS: exact Blob/point/options adopt one owner; hints/empty geometry/busy queue/new owner/options/frame/cancel/decode failures preserve normal paths, private results and close-once ownership');
