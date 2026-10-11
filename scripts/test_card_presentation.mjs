import assert from "node:assert/strict";
import { isDecisiveCardMatch } from "../src/cardPresentation.js";

for (const method of ["search", "art-match", "ocr-title", "visual-exact", "recent-hint"]) {
  assert.equal(isDecisiveCardMatch({ identified_by: method, distance: 220 }), true,
    `${method} results already verified by the pipeline must render as a card`);
}
for (const method of [undefined, "hash", "milo", "tentative"]) {
  assert.equal(isDecisiveCardMatch({ identified_by: method, distance: 80 }), false,
    "a nearest candidate must not become a confident presentation just from its hash distance");
}
assert.equal(isDecisiveCardMatch(null), false);
console.log("OK: verified room-hint and direct results render confidently; unverified candidates do not");
