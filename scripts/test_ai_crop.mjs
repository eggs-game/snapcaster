import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { aiCropWindows, validateAiQuad, sameAiQuad } from "../src/recognition/aiCropGeometry.js";

const portrait = [{ x: 30, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 66 }, { x: 30, y: 66 }];
const point = { nx: 0.5, ny: 0.3 };
assert.ok(validateAiQuad(portrait, 100, 100, point));
assert.ok(validateAiQuad([portrait[2], portrait[0], portrait[3], portrait[1]], 100, 100, point));
assert.equal(validateAiQuad(portrait, 100, 100, { nx: 0.9, ny: 0.3 }), null, "reject a perfect neighbour that does not contain the click");
assert.equal(validateAiQuad(portrait.map(() => ({ x: 50, y: 50 })), 100, 100, point), null);
assert.equal(validateAiQuad([...portrait.slice(0, 3), { x: NaN, y: 66 }], 100, 100, point), null);
assert.equal(validateAiQuad([...portrait.slice(0, 3), { x: 48, y: 20 }], 100, 100, point), null, "reject concave quads");
const landscape = portrait.map((p) => ({ x: p.y, y: p.x }));
assert.ok(validateAiQuad(landscape, 100, 100, { nx: 0.3, ny: 0.5 }));
assert.ok(sameAiQuad(portrait, [...portrait.slice(1), portrait[0]], 100, 100));
assert.ok(!sameAiQuad(portrait, portrait.map((p) => ({ x: p.x + 10, y: p.y })), 100, 100));
for (const click of [{ nx: 0, ny: 0 }, { nx: 1, ny: 1 }, point]) {
  for (const win of [...aiCropWindows(640, 480, click), ...aiCropWindows(640, 480, click, true)]) {
    assert.ok(win.x >= 0 && win.y >= 0 && win.x + win.w <= 640 && win.y + win.h <= 480);
    assert.ok(click.nx * 640 >= win.x && click.nx * 640 <= win.x + win.w);
    assert.ok(click.ny * 480 >= win.y && click.ny * 480 <= win.y + win.h);
  }
}
const retryWindows = aiCropWindows(640, 480, { nx: .5, ny: .5 }, true);
assert.equal(retryWindows.length, 4);
assert.equal(new Set(retryWindows.map(w => `${w.x},${w.y}`)).size, 4, "retry moves the crop in every card orientation");

// Inject a missing runtime and a non-responsive worker. Both must preserve
// recognition by returning no proposals, releasing/terminating the worker,
// and avoiding a 15-second failure penalty on every later click.
const cropModule = readFileSync(new URL("../src/recognition/aiCrop.js", import.meta.url), "utf8");
const source = cropModule
  .replaceAll("export ", "").replaceAll("import.meta.env?.DEV", "true")
  .replaceAll("import.meta.url", "'http://localhost/src/recognition/aiCrop.js'");
for (const failure of ["failed", "timeout"]) {
  let copies = 0, terminated = 0, timer;
  const context = vm.createContext({
    URL, URLSearchParams, performance,
    location: { search: "?aiCrop=1" },
    OffscreenCanvas: class {},
    createImageBitmap: async () => { copies++; return { close() {} }; },
    setTimeout: (callback) => { timer = callback; return 1; }, clearTimeout() {},
    Worker: class {
      postMessage({ id }) {
        queueMicrotask(() => failure === "failed"
          ? this.onmessage({ data: { id, quads: [], diagnostic: { status: "failed" } } })
          : timer());
      }
      terminate() { terminated++; }
    },
  });
  vm.runInContext(source, context);
  const result = await context.proposeAiCrops({}, point);
  assert.equal(result.quads.length, 0);
  assert.equal(result.diagnostic.status, failure);
  assert.equal(terminated, 1);
  timer(); // A late timeout must not finish/terminate an already settled job.
  assert.equal(terminated, 1);
  await context.proposeAiCrops({}, point);
  assert.equal(copies, 1, "failed model is disabled for the rest of the page");
}

const switchedOff = vm.createContext({
  URL, URLSearchParams, performance, location: { search: "?aiCrop=0" },
  OffscreenCanvas: class {},
  createImageBitmap() { throw new Error("disabled inference must not copy images for inference"); },
  Worker() { throw new Error("disabled inference must not load the model worker"); },
});
vm.runInContext(cropModule.replaceAll("export ", "").replaceAll("import.meta.env?.DEV", "false")
  .replaceAll("import.meta.url", "'http://localhost/src/recognition/aiCrop.js'"), switchedOff);
assert.equal(switchedOff.aiCropEnabled(), false, "explicit kill switch skips inference");
assert.equal((await switchedOff.proposeAiCrops({}, point)).diagnostic.status, "off");

// Model warmup and concurrent scans must not replace each other's callbacks.
let posted = [], created = 0, closedWarmBitmap = 0, copiedBitmaps = 0, serialTerminations = 0;
const serial = vm.createContext({
  URL, URLSearchParams, performance, setTimeout, clearTimeout,
  location: { search: "" },
  createImageBitmap: async () => { copiedBitmaps++; return { close() {} }; },
  OffscreenCanvas: class { transferToImageBitmap() { return { close() { closedWarmBitmap++; } }; } },
  Worker: class {
    constructor() { created++; }
    postMessage({ id }) { posted.push(() => this.onmessage({ data: { id, quads: [], diagnostic: { status: "ready" } } })); }
    terminate() { serialTerminations++; }
  },
});
vm.runInContext(source, serial);
const warm = serial.preloadAiCrop();
const scan = serial.proposeAiCrops({}, point);
await new Promise(resolve => setImmediate(resolve));
assert.equal(posted.length, 1);
posted[0]();
await warm;
await new Promise(resolve => setImmediate(resolve));
assert.equal(posted.length, 2);
posted[1]();
await scan;
assert.equal(created, 1);
assert.equal(closedWarmBitmap, 1);
assert.equal(serial.preloadAiCrop(), warm, "warmup runs once");

// A losing sample can be canceled while older Milo work occupies the worker.
// Cancellation is checked when its turn arrives, not when it was enqueued.
const busyLookup = serial.lookupAiCrops([]);
await new Promise(resolve => setImmediate(resolve));
assert.equal(posted.length, 3);
let activePreparation = true, closedPreparation = 0;
const preparationBitmap = { close() { closedPreparation++; } };
const beforeCancellationCopies = copiedBitmaps;
const canceledPreparation = serial.proposeAiCrops(preparationBitmap, point, false, { isActive: () => activePreparation });
const followingScan = serial.proposeAiCrops({}, point);
activePreparation = false;
await new Promise(resolve => setImmediate(resolve));
assert.equal(posted.length, 3, "the busy model keeps its existing callback");
posted[2]();
await busyLookup;
const canceled = await canceledPreparation;
assert.equal(canceled.diagnostic.status, "canceled");
assert.equal(canceled.diagnostic.ms, 0);
assert.ok(canceled.diagnostic.queueMs >= 0);
assert.equal(canceled.quads.length, 0);
assert.equal(closedPreparation, 0, "the caller retains ownership of the original preparation bitmap");
await new Promise(resolve => setImmediate(resolve));
assert.equal(copiedBitmaps, beforeCancellationCopies + 1, "only the following live scan copies a bitmap");
assert.equal(posted.length, 4, "canceled preparation never posts a worker job");
assert.equal(created, 1);
assert.equal(serialTerminations, 0);
posted[3]();
assert.equal((await followingScan).diagnostic.status, "ready", "cancellation must not disable cropping or corrupt the next callback");
preparationBitmap.close();
assert.equal(closedPreparation, 1);

// Exercise the integration with different identity evidence, a failed fast
// trial, and a recent-card hint. Only the established strong evidence may
// bypass full recognition; verified hints must avoid waiting for inference.
const matcher = readFileSync(new URL("../src/recognition/matcher.js", import.meta.url), "utf8");
const perform = matcher.slice(matcher.indexOf("async function performIdentify("), matcher.indexOf("let identifyActive ="));
for (const scenario of ["off", "hint", "empty", "exact", "art", "weak", "bad-art-flag", "error", "neighbour-art", "neighbour-exact"]) {
  let modelCalls = 0, closed = 0;
  const calls = [];
  const bitmap = { close() { closed++; } };
  const context = vm.createContext({
    performance, VISUAL_EXACT_DISTANCE: 90,
    sourceToBitmap: async () => bitmap,
    createImageBitmap: async () => ({ close() {} }),
    proposeAiCrops: async () => {
      modelCalls++;
      return { quads: scenario === "empty" ? [] : [portrait], diagnostic: { status: "ready", ms: 1 } };
    },
    runOnWorker: async (bmp, _point, hints, quads, aiOnly, _candidates, _milo, _preview, hintsOnly) => {
      calls.push({ bmp, hints, quads, aiOnly });
      if (aiOnly && scenario === "error") throw new Error("injected fast-trial failure");
      return { matches: [{ distance: aiOnly && !["exact","neighbour-exact"].includes(scenario) ? 91 : 90,
        identified_by: ["art","neighbour-art"].includes(scenario) ? "art-match" : undefined }],
        art_decisive: ["art", "bad-art-flag", "neighbour-art"].includes(scenario), hint_hit: !!hintsOnly, art_best: {clickInside: scenario.startsWith("neighbour-") ? false : null}, stage_ms: {} };
    },
    finishIdentify: async (result) => result,
  });
  vm.runInContext(perform, context);
  const hints = scenario === "hint" ? [{ name: "Sol Ring" }] : [];
  const result = await context.performIdentify("capture", point, hints, scenario !== "off");
  const fast = ["exact", "art"].includes(scenario);
  assert.equal(modelCalls, ["off", "hint"].includes(scenario) ? 0 : 1, scenario);
  assert.equal(calls.length, ["weak", "bad-art-flag", "error", "neighbour-art", "neighbour-exact"].includes(scenario) ? 2 : 1, scenario);
  assert.equal(calls.at(-1).aiOnly, fast ? true : false, scenario);
  if (scenario === "hint") {
    assert.equal(calls[0].hints, hints);
    assert.equal(result.ai_crop.status, "hint-hit");
  }
  if (fast) assert.equal(closed, 1, "fast success releases the original capture");
}
console.log("AI crop gates reject neighbours; failures/weak reads fall back; strong reads bypass isolation; recent hints skip inference");
