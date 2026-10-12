import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Run the actual Game click handler with deferred camera replies. A newer
// result must neither wait for nor be overwritten by an older capture.
const source = readFileSync(new URL("../src/Game.jsx", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("  const identify = useCallback("), source.indexOf("  // Clicking an opponent's commander name"));
let releaseOld, result, nearbyHints = [];
const scans = [], scanOptions = [], published = [], created = [], revoked = [], preparations = [], canceled = [];
const conn = { localStream: { getVideoTracks: () => [] },
  requestRemoteCapture: (_peer, _nx, _ny, options) => new Promise((resolve) => {
    options?.onFirstFrame?.({ blob: new Blob(["remote first sample"]), px: .2, py: .3 });
    releaseOld = resolve;
  }),
};
const cap = { blob: new Blob(["capture"]), url: "blob:capture", px: .5, py: .5 };
const context = vm.createContext({ Blob, performance, Date,
  URL: { createObjectURL: () => { const url = `blob:preview-${created.length}`; created.push(url); return url; }, revokeObjectURL: (url) => revoked.push(url) },
  useCallback: (fn) => fn, setTimeout() {}, setFlash() {}, openCardPanel() {},
  clickToNormalized: (_video, nx, ny) => ({ nx, ny }),
  captureLocalFrame: async (_stream, _nx, _ny, options) => { options?.onFirstFrame?.(cap); return { ...cap }; },
  canPrepareRecognitionCapture: () => true,
  prepareRecognitionCapture: (blob, point, options) => {
    const entry = { blob, point, options }; preparations.push(entry); return () => canceled.push(entry);
  },
  identifyCard: async (blob, _point, options) => { scans.push(blob); scanOptions.push(options); return result; },
  nearbyRecognitionHints: () => nearbyHints, isReusableRecognitionMatch: () => false,
  persistRecognitionTiming() {}, setCurrent: (value) => published.push(value), setLookups() {},
  connRef: { current: conn }, myId: "self", session: { name: "Tester" },
  activeRecognitionRef: { current: null }, latestRecognitionRequestRef: { current: 0 },
  recognitionPreparationRef: { current: null },
  captureObjectUrlsRef: { current: [] }, recognitionHintsRef: { current: [] }, rosterRef: { current: [] },
});
vm.runInContext(handler.replace("const identify =", "globalThis.identify ="), context);
const video = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
const card = { name: "Verified", scryfall_id: "winning-printing", face: 0, distance: 100, identified_by: "art-match" };
result = { matches: [card], stage_ms: {}, reference_preview: { scryfall_id: card.scryfall_id, face: 0, blob: new Blob(["verified reference"]) } };
const old = context.identify("remote", video, .1, .1);
await context.identify("self", video, .8, .8);
assert.equal(preparations.length, 2, "local and remote first samples start preparation");
assert.ok(canceled.includes(preparations[0]), "a newer click cancels older first-frame preparation");
assert.equal(preparations[0].options.isActive(), false, "queued old model work observes the current click epoch");
assert.equal(preparations[1].blob, cap.blob, "preparation keeps the capture's exact Blob identity");
assert.equal(scans.length, 1);
assert.equal(published.at(-1).matches[0], card);
assert.equal(published.at(-1).previewImage, created[0]);
releaseOld({ ...cap, url: "blob:obsolete", blob: new Blob(["obsolete capture"]) });
await old;
assert.ok(revoked.includes("blob:obsolete"), "a final capture arriving after supersession or unmount is released immediately");
assert.ok(!context.captureObjectUrlsRef.current.includes("blob:obsolete"), "a late capture cannot register a URL after the final unmount cleanup");
assert.equal(scans.length, 1, "obsolete captures never displace the newest pending recognition job");
assert.equal(published.at(-1).matches[0], card, "late camera replies cannot replace the visible answer");

nearbyHints = [{ name: "Previous card at this spot", scryfall_id: "prior-printing", face: 1 }];
const preparedBeforeHint = preparations.length;
await context.identify("self", video, .8, .8);
assert.equal(preparations.length, preparedBeforeHint + 1, "nearby hints may overlap optional geometry with unchanged capture sampling");
assert.equal(scanOptions.at(-1).hints, nearbyHints, "the verified-hint prepass still receives the original hints");
nearbyHints = [];

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
