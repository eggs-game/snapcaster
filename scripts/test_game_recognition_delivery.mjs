import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Run the actual Game click handler with deferred camera replies. A newer
// result must neither wait for nor be overwritten by an older capture.
const source = readFileSync(new URL("../src/Game.jsx", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("  const identify = useCallback("), source.indexOf("  // Clicking an opponent's commander name"));
let releaseOld, result;
const scans = [], published = [], created = [], revoked = [];
const conn = { localStream: { getVideoTracks: () => [] },
  requestRemoteCapture: () => new Promise((resolve) => { releaseOld = resolve; }),
};
const cap = { blob: new Blob(["capture"]), url: "blob:capture", px: .5, py: .5 };
const context = vm.createContext({ Blob, performance, Date,
  URL: { createObjectURL: () => { const url = `blob:preview-${created.length}`; created.push(url); return url; }, revokeObjectURL: (url) => revoked.push(url) },
  useCallback: (fn) => fn, setTimeout() {}, setFlash() {}, openCardPanel() {},
  clickToNormalized: (_video, nx, ny) => ({ nx, ny }),
  captureLocalFrame: async () => ({ ...cap }),
  identifyCard: async (blob) => { scans.push(blob); return result; },
  nearbyRecognitionHints: () => [], isReusableRecognitionMatch: () => false,
  persistRecognitionTiming() {}, setCurrent: (value) => published.push(value), setLookups() {},
  connRef: { current: conn }, myId: "self", session: { name: "Tester" },
  activeRecognitionRef: { current: null }, latestRecognitionRequestRef: { current: 0 },
  captureObjectUrlsRef: { current: [] }, recognitionHintsRef: { current: [] }, rosterRef: { current: [] },
});
vm.runInContext(handler.replace("const identify =", "globalThis.identify ="), context);
const video = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
const card = { name: "Verified", scryfall_id: "winning-printing", face: 0, distance: 100, identified_by: "art-match" };
result = { matches: [card], stage_ms: {}, reference_preview: { scryfall_id: card.scryfall_id, face: 0, blob: new Blob(["verified reference"]) } };
const old = context.identify("remote", video, .1, .1);
await context.identify("self", video, .8, .8);
assert.equal(scans.length, 1);
assert.equal(published.at(-1).matches[0], card);
assert.equal(published.at(-1).previewImage, created[0]);
releaseOld({ ...cap, blob: new Blob(["obsolete capture"]) });
await old;
assert.equal(scans.length, 1, "obsolete captures never displace the newest pending recognition job");
assert.equal(published.at(-1).matches[0], card, "late camera replies cannot replace the visible answer");

for (const preview of [
  { scryfall_id: "other-printing", face: 0, blob: new Blob(["other"]) },
  { scryfall_id: card.scryfall_id, face: 1, blob: new Blob(["reverse"]) },
]) {
  result = { ...result, reference_preview: preview };
  const count = created.length;
  await context.identify("self", video, .8, .8);
  assert.equal(published.at(-1).previewImage, "", "a changed OCR winner or different face cannot reuse another printing's thumbnail");
  assert.equal(created.length, count);
}
result.reference_preview = { scryfall_id: card.scryfall_id, face: 0, blob: new Blob(["reference"]) };
for (let i = 0; i < 40; i++) await context.identify("self", video, .8, .8);
assert.ok(context.captureObjectUrlsRef.current.length <= 32);
assert.ok(revoked.length > 0, "the existing game URL bound owns cached reference previews too");
assert.ok(context.captureObjectUrlsRef.current.includes(published.at(-1).previewImage), "the current image remains live after evicting older URLs");
console.log("OK: latest clicks skip obsolete captures, display only the matching verified face, and retain bounded preview URLs");
