import assert from "node:assert/strict";

globalThis.document = { visibilityState: "visible" };
globalThis.fetch = async () => ({ blob: async () => new Blob(["frame"], { type: "image/jpeg" }) });
globalThis.createImageBitmap = async (blob) => ({ blob, close() {} });

const posted = [];
globalThis.Worker = class FakeRecognitionWorker {
  postMessage(message) {
    posted.push(message.id);
    setTimeout(() => {
      this.onmessage?.({
        data: {
          id: message.id,
          matches: [],
          printingMatches: [],
          titleCount: 0,
          stageMs: { total: 10 },
        },
      });
    }, 25);
  }
};

const { identify } = await import("../src/recognition/matcher.js");
const first = identify("first", { nx: 0.5, ny: 0.5 });
const second = identify("second", { nx: 0.5, ny: 0.5 }).catch((error) => error);
const third = identify("third", { nx: 0.5, ny: 0.5 });

await first;
const superseded = await second;
await third;
await new Promise((resolve) => setTimeout(resolve, 0));

assert.equal(superseded.code, "RECOGNITION_SUPERSEDED");
assert.equal(posted.length, 2);
assert.deepEqual(globalThis.__SNAP_RECOGNITION_QUEUE, { active: false, waiting: false });

console.log("recognition queue keeps one active and the newest waiting job");
