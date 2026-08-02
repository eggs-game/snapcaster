import assert from "node:assert/strict";
import { buildColorBreakdown, buildManaCurve, buildTypeBreakdown, formatDeckText, shuffleMainDeck } from "../src/deckAnalysis.js";

const cards = [
  { id: "cmdr", name: "Niko", quantity: 1, board: "commander", mana_value: 3, type_line: "Legendary Creature", colors: ["W", "U"], tags: ["Blink"] },
  { id: "plains", name: "Plains", quantity: 3, board: "mainboard", mana_value: 0, type_line: "Basic Land — Plains", colors: [], tags: [] },
  { id: "spell", name: "Cloudshift", quantity: 2, board: "mainboard", mana_value: 1, type_line: "Instant", colors: ["W"], tags: ["Blink"] },
  { id: "rock", name: "Sol Ring", quantity: 1, board: "mainboard", mana_value: 1, type_line: "Artifact", colors: [], tags: ["Ramp"] },
  { id: "large", name: "Big Spell", quantity: 1, board: "mainboard", mana_value: 9, type_line: "Sorcery", colors: ["U"], tags: [] },
  { id: "side", name: "Side Card", quantity: 1, board: "sideboard", mana_value: 2, type_line: "Creature", colors: ["G"], tags: [] },
];

assert.equal(formatDeckText(cards), `Commander
1 Niko #!Blink

Mainboard
1 Big Spell
2 Cloudshift #!Blink
3 Plains
1 Sol Ring #!Ramp

Sideboard
1 Side Card`);
assert.deepEqual(buildManaCurve(cards).map((entry) => entry.count), [0, 3, 0, 1, 0, 0, 0, 1]);
assert.deepEqual(buildTypeBreakdown(cards), [
  { key: "Creature", label: "Creatures", count: 1 },
  { key: "Sorcery", label: "Sorceries", count: 1 },
  { key: "Instant", label: "Instants", count: 2 },
  { key: "Artifact", label: "Artifacts", count: 1 },
  { key: "Land", label: "Lands", count: 3 },
]);
const colors = Object.fromEntries(buildColorBreakdown(cards).map((entry) => [entry.key, entry]));
assert.deepEqual({ W: colors.W.count, U: colors.U.count, G: colors.G.count, C: colors.C.count }, { W: 3, U: 2, G: 0, C: 1 });
assert.equal(colors.W.percentage, 60);
const shuffled = shuffleMainDeck(cards, () => 0);
assert.equal(shuffled.length, 7);
assert.equal(shuffled.filter((card) => card.name === "Plains").length, 3);
assert.equal(shuffled.some((card) => card.board !== "mainboard"), false);
assert.equal(new Set(shuffled.map((card) => card.drawKey)).size, shuffled.length);
console.log("deck analysis tests passed");
