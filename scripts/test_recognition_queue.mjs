import assert from "node:assert/strict";

globalThis.document = { visibilityState: "visible" };
globalThis.fetch = async () => ({ blob: async () => new Blob(["frame"], { type: "image/jpeg" }) });
globalThis.createImageBitmap = async (blob) => ({ blob, close() {} });
let clock = 0;
const savedPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");
Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => clock } });

const posted = [];
globalThis.Worker = class FakeRecognitionWorker {
  postMessage(message) {
    if (["milo-begin", "milo-release"].includes(message.type)) return;
    posted.push({ id: message.id, deliver: () => {
      this.onmessage?.({
        data: {
          id: message.id,
          matches: [],
          printingMatches: [],
          titleCount: 0,
          stageMs: { worker: 10, total: 10 },
        },
      });
    } });
  }
};

const { identify } = await import("../src/recognition/matcher.js");
const first = identify("first", { nx: 0.5, ny: 0.5 });
const second = identify("second", { nx: 0.5, ny: 0.5 }).catch((error) => error);
const third = identify("third", { nx: 0.5, ny: 0.5 });

await new Promise(setImmediate);
assert.equal(posted.length, 1, "the worker must receive only the active scan");
clock = 125;
posted[0].deliver();
const firstResult = await first;
const superseded = await second;
await new Promise(setImmediate);
assert.equal(posted.length, 2, "only the newest queued scan may enter the worker");
clock = 150;
posted[1].deliver();
const thirdResult = await third;
await new Promise(setImmediate);

assert.equal(superseded.code, "RECOGNITION_SUPERSEDED");
assert.equal(posted.length, 2);
assert.equal(firstResult.stage_ms.queue, 0);
assert.equal(thirdResult.stage_ms.queue, 125, "queue diagnostics include time behind the older active scan");
assert.equal(thirdResult.stage_ms.total, 25, "pipeline total retains its own start clock and excludes queue delay");
assert.equal(thirdResult.stage_ms.worker, 10, "queue diagnostics preserve worker stage timings");
assert.deepEqual(globalThis.__SNAP_RECOGNITION_QUEUE, { active: false, waiting: false });
if (savedPerformance) Object.defineProperty(globalThis, "performance", savedPerformance); else delete globalThis.performance;

console.log("recognition queue keeps one active/newest waiting job and reports queue wait separately from pipeline total");
