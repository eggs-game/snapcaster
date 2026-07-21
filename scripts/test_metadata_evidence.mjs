#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  evaluateMetadataEvidence, genericManaValues, manaCostOptions, manaSymbolCounts,
  manaTokens, normalizeManaCost, primaryTypes,
} from "../src/recognition/metadataEvidence.js";

assert.deepEqual(manaTokens("{2}{R}{G}"), ["2", "R", "G"]);
assert.equal(normalizeManaCost("{2}{r}{g}"), "{2}{R}{G}");
assert.deepEqual(manaCostOptions("{2}{R} // {1}{U}"), ["{2}{R}{1}{U}", "{2}{R}", "{1}{U}"]);
assert.deepEqual(genericManaValues("{2}{R} // {1}{U}"), [2, 1]);
assert.deepEqual(manaSymbolCounts("{2}{R}{G}"), [3]);
assert.deepEqual(primaryTypes("Legendary Artifact Creature — Shapeshifter"), ["artifact", "creature"]);

const orvar = {
  mana_cost: "{3}{U}",
  type_line: "Legendary Creature — Shapeshifter",
  oracle_text: "Changeling\nWhenever you cast an instant or sorcery spell...",
};

assert.deepEqual(
  evaluateMetadataEvidence({ type: { text: "Sorcery", confidence: 0.98 } }, orvar),
  { compatible: false, score: -Infinity, reasons: ["primary-type-mismatch"] },
);
assert.equal(evaluateMetadataEvidence({
  mana: { generic: 1, genericConfidence: 0.99 },
}, { mana_cost: "{2}{R}{G}" }).compatible, false);
assert.equal(evaluateMetadataEvidence({
  mana: { symbolCount: 1, symbolCountConfidence: 0.99 },
}, { mana_cost: "{2}{R}{G}" }).compatible, false);
assert.deepEqual(
  evaluateMetadataEvidence({ mana: { cost: "{1}", confidence: 0.98 } }, orvar),
  { compatible: false, score: -Infinity, reasons: ["mana-cost-mismatch"] },
);

const match = evaluateMetadataEvidence({
  mana: { cost: "{3}{U}", confidence: 0.97 },
  type: { text: "Creature — Shapeshifter", confidence: 0.97 },
  rules: { text: "Changeling whenever instant sorcery", confidence: 0.8 },
}, orvar);
assert.equal(match.compatible, true);
assert.ok(match.score >= 7);

assert.equal(evaluateMetadataEvidence({
  rules: { text: "cast", confidence: 0.9 },
}, orvar).score, 0);
assert.equal(evaluateMetadataEvidence({
  rules: { text: "Changeling", confidence: 0.9 },
}, orvar).score, 1);

// Weak reads are neutral: they must never eliminate a visually plausible card.
assert.equal(evaluateMetadataEvidence({
  mana: { cost: "{1}", confidence: 0.4 },
  type: { text: "Sorcery", confidence: 0.5 },
}, orvar).compatible, true);

console.log("OK: metadata evidence compatibility gates");
