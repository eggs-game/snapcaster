import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
const requests = [], blobs = new Map();
let releaseNormal;
const context = vm.createContext({ CARD_W: 244, CARD_H: 340,
  fetch: async (url) => {
    requests.push(url);
    if (url.includes("/normal/front/a/b/abcdef")) await new Promise((resolve) => { releaseNormal = resolve; });
    const blob = new Blob([url], { type: "image/jpeg" });
    blobs.set(url, blob);
    return { ok: true, blob: async () => blob };
  },
  createImageBitmap: async () => ({ close() {} }),
  OffscreenCanvas: class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { drawImage() {}, getImageData: (_x, _y, width, height) => ({ width, height }) }; }
  },
});
vm.runInContext("const refCache = new Map();" + source.slice(source.indexOf("function fetchReference("), source.indexOf("function orbFeatures(")), context);
const match = { scryfall_id: "abcdef", face: 0 };
assert.equal(context.cachedReferencePreview(match), null, "unfetched candidates cannot start an image download for display");
assert.equal(requests.length, 0);
await context.fetchReference(match.scryfall_id, 0);
const small = context.cachedReferencePreview(match);
assert.equal(small.blob, blobs.get(requests[0]), "display reuses exactly the public reference already decoded for verification");
const normalRequest = context.fetchReference(match.scryfall_id, 0, "normal");
assert.equal(context.cachedReferencePreview(match).blob, small.blob, "a stalled normal image cannot delay the ready thumbnail");
assert.equal(context.cachedReferencePreview({ ...match, face: 1 }), null, "front and reverse reference faces never leak into each other's result");
assert.equal(context.cachedReferencePreview({ ...match, scryfall_id: "other" }), null);
releaseNormal();
await normalRequest;
assert.equal(context.cachedReferencePreview(match).blob, blobs.get(requests[1]), "prefer the larger image once it is already available");
assert.equal(requests.length, 2, "reading a preview itself performs no fetches");
await context.fetchReference(match.scryfall_id, 1);
assert.equal(context.cachedReferencePreview({ ...match, face: 1 }).blob, blobs.get(requests[2]));
for (let i = 0; i < 405; i++) await context.fetchReference(`card${i}`, 0);
assert.equal(context.cachedReferencePreview(match), null, "the existing reference-cache eviction releases its preview blob too");
assert.ok(vm.runInContext("refCache.size", context) <= 401, "previews cannot add a separate unbounded image cache");
console.log("OK: reference display reuses cached winning-printing pixels without waiting for unused downloads, extra fetches, face confusion, or unbounded retention");
