import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// PRIVATE actual-Game/native-camera controls; caller owns the existing browser,
// source snapshot, fixtures and exclusive CPU slot. No production source edit.
export async function runNativeGameControls({ page, report, output, save, options = {} }) {
  const requireEarly = options.requireEarly ?? true;
  const movingOnly = options.gameControlsCases === 'moving-only';
  const heldOnly = options.gameControlsCases === 'held-only';
  const records = report.gameCancellationControls = [];
  const record = async value => {
    records.push(value); await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'game-cancellation-controls.json'), JSON.stringify({ sourceDigests: report.sourceDigests, catalogDigests: report.catalogDigests, records }, null, 2) + '\n');
    await save?.(); console.log('Actual Game control:', value.name, value.got, value.capture?.selected, value.displayMs);
  };
  const click = async item => {
    const point = await page.locator('.tile video').evaluate((video, p) => {
      const r = video.getBoundingClientRect();
      const scale = getComputedStyle(video).objectFit === 'contain' ? Math.min(r.width / video.videoWidth, r.height / video.videoHeight) : Math.max(r.width / video.videoWidth, r.height / video.videoHeight);
      return { x: r.left + (r.width - video.videoWidth * scale) / 2 + p.nx * video.videoWidth * scale,
        y: r.top + (r.height - video.videoHeight * scale) / 2 + p.ny * video.videoHeight * scale };
    }, item);
    await page.mouse.click(point.x, point.y);
  };
  const tokens = async amount => page.waitForFunction(n => {
    const p = window.__nativeOwner.peers.get('native-viewer');
    return Math.min(4, (p.capTokens ?? 4) + (Date.now() - (p.capTokensAt || 0)) / 1200) >= n;
  }, amount, { timeout: 15000 });
  const waitResult = async (before, timeoutMs = Number(options.gameControlsTimeoutMs || 90000)) => {
    await page.waitForFunction(n => window.__nativeSamples.length > n && window.__nativeSamples.at(-1)?.timing
      && (document.querySelector('.card-empty-state.failed,.lookup-status.error') || window.__nativeSamples.at(-1).images.some(image => image.paintAt)), before, { timeout: timeoutMs });
    await page.waitForFunction(() => !window.__SNAP_RECOGNITION_QUEUE?.active && !window.__SNAP_RECOGNITION_QUEUE?.waiting, null, { timeout: 15000 });
    if (requireEarly) await page.waitForFunction(() => {
      const events = window.__nativeControlEvents;
      const owner = events.filter(event => event.kind === 'worker-post' && event.messageType === 'identify').at(-1)?.ownerId;
      return owner != null && events.some(event => event.kind === 'worker-received' && event.messageType === 'milo-release' && event.ownerId === owner);
    }, null, { timeout: 15000 });
    return page.evaluate(() => {
      const sample = window.__nativeSamples.at(-1), capture = window.__nativeCaptureRecords.at(-1);
      const image = sample.images.find(value => value.paintAt);
      return { got: document.querySelector('.card-hit .card-meta > b')?.textContent || null,
        capture, timing: sample.timing, displayMs: image ? Math.round(image.paintAt - sample.at) : null,
        queue: { ...window.__SNAP_RECOGNITION_QUEUE }, hints: window.__nativeReadHints(),
        matcher: window.__nativeMatcherData, events: window.__nativeControlEvents.slice(),
        clockOffset: performance.timeOrigin, uiEvents: window.__nativeUiEvents?.slice() || [],
        sourceControl: window.__nativeMovingControl || null };
    });
  };
  const reset = async () => page.evaluate(() => {
    window.__nativeClearHints(); window.__nativeControlEvents.length = 0;
    window.__nativeOnCaptureSample = null; window.__nativePaintOverride = null;
    if (window.__nativeMovingTimer) clearTimeout(window.__nativeMovingTimer);
    window.__nativeMovingTimer = null; window.__nativeMovingControl = null;
    window.__nativeUiEvents = []; let previousTitle = document.querySelector('.card-hit .card-meta > b')?.textContent || null;
    window.__nativeUiObserver?.disconnect();
    window.__nativeUiObserver = new MutationObserver(() => {
      const title = document.querySelector('.card-hit .card-meta > b')?.textContent || null;
      if (title !== previousTitle) { previousTitle = title; if (title) window.__nativeUiEvents.push({ at: Date.now(), name: title }); }
    });
    window.__nativeUiObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    window.__nativeBlur = 0; window.__nativePaintSource();
  });
  const scene = async number => page.evaluate(async scene => {
    const items = await window.__nativeSetScene(scene);
    await new Promise(resolve => setTimeout(resolve, 180)); return items;
  }, number);
  const hintNames = result => result.hints.map(hint => hint.card?.name || hint.name).filter(Boolean);
  const assertFinal = (result, expected) => {
    assert.equal(result.got, expected, 'Only the selected/latest card is displayed');
    assert.equal(result.queue.active, false); assert.equal(result.queue.waiting, false);
    assert.ok(hintNames(result).every(name => name === expected), 'No unselected/obsolete card is remembered as a room hint');
    assert.ok(result.capture?.sha256, 'Exact final JPEG SHA is recorded');
    assert.equal(result.capture.frames.length, 3, 'Production three-sample selection remains intact');
    const winner = result.matcher?.matches?.[0];
    assert.equal(winner?.name, expected);
    assert.ok(['art-match', 'visual-exact'].includes(winner.identified_by), 'Final result retains confident verification');
    assert.ok(winner.confidence >= .9, 'Final confidence remains strong');
    assert.equal(winner.click_inside, true, 'Final winner has positive source click ownership');
    if (requireEarly) assert.ok(result.events.some(event => event.kind === 'selected-source-sha' && event.sha256 === result.capture.sha256),
      'Selected matcher source is the exact final capture JPEG');
  };
  try {
    if (!heldOnly) {
    // Native scene1 card14 is Three Steps Ahead. Warm its references through
    // the actual Game once; no identity is seeded into matcher/model inputs.
    let items = await scene(1); const a = items[4];
    assert.equal(a.name, 'Three Steps Ahead');
    await reset(); await tokens(1.02);
    let before = await page.evaluate(() => window.__nativeSamples.length);
    await click(a); let result = await waitResult(before); assertFinal(result, a.name);
    await record({ name: 'static-three-steps-warm', expected: a.name, ...result });

    // Clone original opaque fixture scenes. Shift only the second source
    // scene to place its card24 at the same click as card14. Both arms must
    // independently validate identical final JPEG/geometry before pairing.
    const bItems = await scene(2), b = bItems[4];
    await page.evaluate(async ({ a, b }) => {
      const clone = canvas => { const copy = document.createElement('canvas'); copy.width = 1920; copy.height = 1080;
        const ctx = copy.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 1080); ctx.drawImage(canvas, 0, 0); return copy; };
      const sourceB = clone(window.__nativeScene.canvas);
      await window.__nativeSetScene(1); const sourceA = clone(window.__nativeScene.canvas);
      const shiftedB = document.createElement('canvas'); shiftedB.width = 1920; shiftedB.height = 1080;
      const ctx = shiftedB.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 1080);
      const dx = Math.round((a.nx - b.nx) * 1920), dy = Math.round((a.ny - b.ny) * 1080);
      ctx.drawImage(sourceB, dx, dy); sourceB.width = sourceB.height = 0;
      window.__nativeControlCanvases = { a: sourceA, b: shiftedB, translation: { dx, dy } };
    }, { a, b });

    for (const control of [
      { name: 'first-sharp-static', blur: 0, after: null, different: false },
      { name: 'first-mild2-clear150', blur: 2, after: 150, different: false },
      { name: 'first-blur7-clear150', blur: 7, after: 150, different: false },
      { name: 'first-blur7-clear220', blur: 7, after: 220, different: false },
      { name: 'first-valid-A-mild2-later-B150', blur: 2, after: 150, different: true },
    ]) {
      await reset(); await tokens(1.02);
      await page.evaluate(control => {
        const state = window.__nativeMovingControl = { ...control, phase: 'first', samples: [], firstAt: null, changedAt: null };
        window.__nativePaintOverride = ctx => {
          ctx.filter = state.phase === 'first' && state.blur ? 'blur(' + state.blur + 'px)' : 'none';
          ctx.drawImage(window.__nativeControlCanvases[state.phase === 'final' && state.different ? 'b' : 'a'], 0, 0);
          ctx.filter = 'none'; return true;
        };
        window.__nativeOnCaptureSample = (_trace, index) => {
          state.samples.push({ index, at: Date.now(), phase: state.phase });
          if (index !== 0 || state.firstAt != null) return;
          state.firstAt = Date.now();
          if (state.after != null) window.__nativeMovingTimer = setTimeout(() => {
            state.changedAt = Date.now(); state.phase = 'final'; window.__nativePaintSource();
          }, state.after);
        };
        window.__nativePaintSource();
      }, control);
      await page.waitForTimeout(180);
      before = await page.evaluate(() => window.__nativeSamples.length);
      await click(a); result = await waitResult(before);
      const expected = control.different ? b.name : a.name;
      result.uiEvents = await page.evaluate(() => window.__nativeUiEvents.slice());
      await record({ ...control, expected, sourceA: a.name, sourceB: b.name, translation: await page.evaluate(() => window.__nativeControlCanvases.translation), ...result });
      assertFinal(result, expected);
      assert.ok(result.capture.firstSHA256, 'First progressive JPEG SHA is recorded');
      if (control.after == null) assert.equal(result.capture.firstSHA256, result.capture.sha256, 'Static first winner stays byte-identical');
      if (control.different) {
        assert.notEqual(result.capture.firstSHA256, result.capture.sha256, 'Different content selects a later JPEG');
        assert.ok(result.capture.selected > 0, 'Different sharper content wins normal frame selection');
        assert.ok(!hintNames(result).includes(a.name), 'Unselected first card cannot leave a hint');
        assert.ok(!result.uiEvents.some(event => event.name === a.name), 'Unselected first card cannot publish to UI');
      }
      if (requireEarly && (control.blur === 2)) {
        const started = result.events.find(event => event.kind === 'early-start');
        assert.ok(started, 'INCONCLUSIVE: mild source did not start full early recognition');
        assert.ok(result.events.some(event => event.kind === 'worker-post' && event.messageType === 'identify'
          && event.ownerId === started.ownerId && event.at < result.capture.endedAt + performanceTimeOrigin(result)),
          'An actual early core identify is posted before final selection');
        const cancelled = result.events.find(event => event.kind === 'cancel' && event.hadFullJob && event.ownerId === started.ownerId);
        const selected = result.events.find(event => event.kind === 'selected-identify');
        assert.ok(cancelled && selected && cancelled.at <= selected.at, 'The later winner cancels the early owner before selected identify');
        assert.ok(result.events.some(event => event.kind === 'worker-received' && event.messageType === 'milo-release' && event.ownerId === started.ownerId));
      }
    }

    if (movingOnly) return records;

    await reset(); items = await scene(1);
    const latest = items[6]; await tokens(2.05);
    before = await page.evaluate(() => window.__nativeSamples.length);
    await page.evaluate(() => window.__nativeHoldModelReplies());
    await click(a);
    await page.waitForFunction(() => window.__nativeHeldModelReplyCount() > 0, null, { timeout: 10000 });
    await click(latest);
    await page.waitForTimeout(320);
    await page.evaluate(() => window.__nativeReleaseModelReplies());
    result = await waitResult(before); await record({ name: 'held-cornelius-new-click', expected: latest.name, oldCard: a.name, ...result });
    assertFinal(result, latest.name); assert.ok(!hintNames(result).includes(a.name));
    assert.ok(!result.uiEvents.some(event => event.name === a.name), 'Held old card must not publish to UI');

    await reset(); await tokens(3.1);
    before = await page.evaluate(() => window.__nativeSamples.length);
    await click(a); await page.waitForTimeout(55); await click(items[5]); await page.waitForTimeout(55); await click(items[7]);
    result = await waitResult(before); await record({ name: 'rapid-three-different-clicks', expected: items[7].name, obsolete: [a.name, items[5].name], ...result });
    assertFinal(result, items[7].name);
    assert.ok(hintNames(result).every(name => ![a.name, items[5].name].includes(name)));
    assert.ok(!result.uiEvents.some(event => [a.name, items[5].name].includes(event.name)), 'Rapid obsolete cards must not publish to UI');
    }

    // Warm only the latest target's references through the actual UI, then
    // hold a public GET begun by uncached old work. V4 must deliver the new
    // card before this old fetch is released. Baseline moving-only skips this
    // deliberately discriminating cancellation control.
    await reset(); const items = await scene(0);
    const old = items[5], newest = items[3];
    await tokens(1.02); let before = await page.evaluate(() => window.__nativeSamples.length);
    await click(newest); let result = await waitResult(before); assertFinal(result, newest.name);
    await reset(); await tokens(2.05);
    let armed = true, held = null, releaseHeld, finishHeld;
    const gate = new Promise(resolve => { releaseHeld = resolve; });
    const heldDone = new Promise(resolve => { finishHeld = resolve; });
    const publicReferences = url => url.hostname === 'cards.scryfall.io';
    const holdReference = async route => {
      if (!armed || held || route.request().method() !== 'GET') return route.fallback();
      held = { url: route.request().url(), at: Date.now(), releasedAt: null };
      try { await gate; await route.continue(); } finally { finishHeld(); }
    };
    await page.route(publicReferences, holdReference);
    try {
      before = await page.evaluate(() => window.__nativeSamples.length);
      await click(old);
      const deadline = Date.now() + 12000;
      while (!held && Date.now() < deadline) await page.waitForTimeout(40);
      assert.ok(held, 'INCONCLUSIVE: old source did not begin an uncached public reference GET');
      await click(newest);
      try { result = await waitResult(before, Number(options.latestDeadlineMs || 2500)); }
      catch (error) {
        await record({ name: 'held-old-reference-deadline-failure', expected: newest.name,
          oldCard: old.name, held: {...held}, latestDeadlineMs: Number(options.latestDeadlineMs || 2500),
          error: String(error), failureState: await page.evaluate(() => ({queue:window.__SNAP_RECOGNITION_QUEUE,
            title:document.querySelector('.card-hit .card-meta > b')?.textContent||null,
            events:window.__nativeControlEvents.slice(),hints:window.__nativeReadHints()})) });
        throw error;
      }
      assertFinal(result, newest.name);
      assert.ok(!result.uiEvents.some(event => event.name === old.name), 'Held old reference cannot publish stale card');
      const deliveredAt = Date.now();
      assert.equal(held.releasedAt, null, 'Latest result and idle queue precede old GET release');
      await record({ name: 'held-old-reference-newest-before-release', expected: newest.name, oldCard: old.name,
        held: { ...held }, latestDeliveredAt: deliveredAt, deliveredBeforeRelease: true, ...result });
    } finally {
      armed = false; if (held) held.releasedAt = Date.now(); releaseHeld();
      if (held) await heldDone;
      await page.unroute(publicReferences, holdReference);
    }
  } finally {
    await page.evaluate(() => {
      window.__nativeReleaseModelReplies?.();
      if (window.__nativeMovingTimer) clearTimeout(window.__nativeMovingTimer);
      window.__nativeOnCaptureSample = null; window.__nativePaintOverride = null; window.__nativeBlur = 0;
      const canvases = window.__nativeControlCanvases;
      if (canvases) for (const name of ['a', 'b']) canvases[name].width = canvases[name].height = 0;
      window.__nativeControlCanvases = null; window.__nativePaintSource();
      window.__nativeUiObserver?.disconnect();
    });
  }
  return records;
}

// Capture timestamps use performance.now, while owner instrumentation uses
// Date.now. The sample's paired origins are exported by the native observer.
function performanceTimeOrigin(result) {
  return result.clockOffset || 0;
}
