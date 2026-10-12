import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const worker = await readFile(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
const headerEnd = worker.indexOf("/* eslint");
assert.ok(headerEnd > 0, "Actual worker must contain the primitive alignment helper before its classic-worker marker");
const source = worker.slice(0, headerEnd);
assert.ok(source.includes("const rawAlignmentInputs = new WeakMap();"));
assert.equal(typeof global.gc, "function", "Run this ownership regression with node --expose-gc");
let calls = 0, fail = false;
const context = vm.createContext({ WeakRef, orbTiming: {}, orbAlignment: () => {
  calls++; if (fail) throw new Error("alignment failed");
  return { inliers: 32, inside: true, artInliers: 17, textInliers: 15,
    halfInliers: [16,16], corners: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
} });
vm.runInContext(source + "\nglobalThis.RawAlignmentCache=RawAlignmentCache;globalThis.provenance=features=>rawAlignmentInputs.get(features);", context);
const cache = new context.RawAlignmentCache(2), queryImage = { width: 244, height: 340 }, referenceImage = { width: 244, height: 340 };
const feature = (image, count = 500, contrast = false, threshold = 20) => context.recordRawAlignmentInput({
  kp: { delete() {} }, desc: { rows: 10, delete() {} }, width: image.width, height: image.height,
}, image, count, contrast, threshold);
const query = feature(queryImage), reference = feature(referenceImage, 300), click = { x: 4, y: 7 };
const region = { width: 594, height: 594, click, cameraToCrop: [1,0,0,0,1,0,0,0,1] };
const align = (q = query, r = reference, point = click, sourceRegion = region, clipped = false) => context.rawAlignment(cache, q, r, point, sourceRegion, clipped);
assert.deepEqual(Object.keys(query).sort(), ["desc", "height", "kp", "width"], "features gain no strong ImageData property");
assert.ok(context.provenance(reference).image instanceof WeakRef);
const first = align(); first.corners[0].x = 900; first.halfInliers[0] = 900;
const second = align(feature(queryImage), feature(referenceImage, 300), { ...click }, { ...region, cameraToCrop: [...region.cameraToCrop] });
assert.equal(calls, 1); assert.equal(second.corners[0].x, 1); assert.equal(second.halfInliers[0], 16);
for (const changed of [
  () => align(feature({ ...queryImage })),
  () => align(query, feature({ ...referenceImage }, 300)),
  () => align(query, reference, { x: 5, y: 7 }),
  () => align(query, reference, click, { ...region, click: { x: 8, y: 7 } }),
  () => align(query, reference, click, { ...region, cameraToCrop: [1,0,1,0,1,0,0,0,1] }),
  () => align(query, reference, click, region, true),
  () => align(feature(queryImage, 1600)),
  () => align(query, reference, click, { ...region, width: 0, height: 0 }),
  () => align(query, reference, click, { ...region, width: 593 }),
  () => align(query, reference, click, { ...region, height: 593 }),
  () => align(query, reference, click, { ...region, cameraToCrop: [1,-0,0,0,1,0,0,0,1] }),
  () => align(query, reference, click, { ...region, cameraToCrop: [1,0,0,0,1,0,0,0] }),
  () => align(query, reference, click, { ...region, cameraToCrop: [1,0,0,0,1,0,0,0,NaN] }),
  () => align(query, reference, click, { ...region, cameraToCrop: [1,0,0,0,1,0,0,0,Infinity] }),
  () => align(query, reference, null),
  () => align(query, reference, click, null),
]) {
  const before = calls; changed(); assert.equal(calls, before + 1, "different image/count/geometry never borrows old primitive proof");
}
assert.equal(cache.entries.size, 2, "primitive results remain bounded");
for (const changed of [feature(queryImage, 500, true), feature(queryImage, 500, false, 8), feature(queryImage, 800), {}]) {
  const before = calls; align(changed); align(changed);
  assert.equal(calls, before + 2, "contrast/FAST8/unsupported or absent provenance never memoize");
}
for (const changed of [feature(referenceImage, 300, true), feature(referenceImage, 300, false, 8), feature(referenceImage, 500), {}]) {
  const before = calls; align(query, changed); align(query, changed);
  assert.equal(calls, before + 2, "unsupported reference settings or provenance must execute the original primitive");
}
{
  const bounded = new context.RawAlignmentCache(), images = [];
  for (let index = 0; index < 320; index++) {
    const pixels = { width: 244, height: 340 }; images.push(pixels);
    context.rawAlignment(bounded, feature(pixels), reference, click, region);
    assert.ok(bounded.entries.size <= 256, "the production cap is never exceeded");
  }
  assert.equal(bounded.entries.size, 256);
  const before = calls;
  context.rawAlignment(bounded, feature(images.at(-1)), reference, click, region);
  assert.equal(calls, before, "newest entry is reusable");
  context.rawAlignment(bounded, feature(images[0]), reference, click, region);
  assert.equal(calls, before + 1, "oldest primitive proof is evicted at the fixed bound");
  assert.equal(bounded.entries.size, 256);
}
fail = true;
const before = calls;
assert.throws(() => align(query, reference, { x: 99, y: 99 }), /failed/);
assert.throws(() => align(query, reference, { x: 99, y: 99 }), /failed/);
assert.equal(calls, before + 2, "exceptions never create a result entry");
fail = false;

// Older browsers use the original primitive; no strong-pointer fallback.
const older = vm.createContext({ WeakRef: undefined, orbTiming: {}, orbAlignment: () => ({ inliers: ++calls }) });
vm.runInContext(source + "\nglobalThis.RawAlignmentCache=RawAlignmentCache;", older);
const oldFeature = older.recordRawAlignmentInput({}, queryImage, 500, false, 20), oldCache = new older.RawAlignmentCache();
const oldBefore = calls; older.rawAlignment(oldCache, oldFeature, reference); older.rawAlignment(oldCache, oldFeature, reference);
assert.equal(calls, oldBefore + 2); assert.equal(oldCache.entries.size, 0);
assert.deepEqual(Object.keys(oldFeature), []);

if (global.gc) {
  // Simulate a global native-feature cache retaining both feature objects.
  // The previous prototype retains ImageData through rawProofInput.image;
  // this provenance must allow it to be collected despite held features.
  const heldFeatures = [];
  function releaseImage(strong) {
    const image = { width: 244, height: 340, data: new Uint8Array(244 * 340 * 4) };
    const weak = new WeakRef(image), features = feature(image, 300);
    if (strong) features.rawProofInput = { image };
    heldFeatures.push(features); return weak;
  }
  const legacy = releaseImage(true), corrected = releaseImage(false);
  for (let iteration = 0; iteration < 6; iteration++) { await new Promise(setImmediate); global.gc(); }
  assert.ok(legacy.deref(), "positive control reproduces the old strong reference ownership");
  assert.equal(corrected.deref(), undefined, "WeakMap provenance with WeakRef values cannot retain ImageData through held features");
  assert.equal(heldFeatures.length, 2);
}
console.log("OK: weak feature provenance, exact primitive image/caps/geometry bindings, bounded clones, mode/error fallback and collected image ownership");
