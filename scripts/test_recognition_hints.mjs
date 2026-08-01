import assert from "node:assert/strict";
import {
  isReusableRecognitionMatch,
  nearbyRecognitionHints,
  normalizeRecognitionHint,
  rememberRecognitionHint,
} from "../src/recognitionHints.js";

const now = 1_800_000_000_000;
const solRing = {
  ownerId: "player-1",
  nx: 0.4,
  ny: 0.6,
  at: now,
  card: {
    name: "Sol Ring",
    scryfall_id: "e07f656c-97b5-4147-821a-edbb49f34e19",
    face: 0,
    set: "cmm",
    collector_number: "396",
  },
};

assert.equal(normalizeRecognitionHint({ ...solRing, card: { scryfall_id: "bad" } }, now), null);
assert.equal(normalizeRecognitionHint({ ...solRing, nx: 4 }, now).nx, 1);

let cache = rememberRecognitionHint([], solRing, now);
cache = rememberRecognitionHint(cache, { ...solRing, nx: 0.41, at: now + 1000 }, now + 1000);
assert.equal(cache.length, 1, "nearby duplicates of the same printing should replace");
assert.equal(nearbyRecognitionHints(cache, "player-1", 0.42, 0.59, now + 1000).length, 1);
assert.equal(nearbyRecognitionHints(cache, "player-1", 0.9, 0.1, now + 1000).length, 0);
assert.equal(nearbyRecognitionHints(cache, "player-2", 0.42, 0.59, now + 1000).length, 0);

assert.equal(isReusableRecognitionMatch({ scryfall_id: solRing.card.scryfall_id, distance: 90 }), true);
assert.equal(isReusableRecognitionMatch({ scryfall_id: solRing.card.scryfall_id, distance: 170 }), false);
assert.equal(isReusableRecognitionMatch({
  scryfall_id: solRing.card.scryfall_id,
  distance: 170,
  identified_by: "art-match",
}), true);

console.log("OK: recognition hints are bounded, spatial, sanitized, and confidence-gated");
