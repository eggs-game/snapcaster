import assert from "node:assert/strict";
import {
  aggregateDeckCards,
  detectDeckImportInput,
  parseArchidektDeck,
  parseDeckAttributionUrl,
  parseDeckSourceUrl,
  parseDeckText,
  parseMoxfieldExport,
  primaryCardType,
  summarizeDeckCards,
} from "../src/deckImport.js";
import { ANT_MAN_DECK_TEXT } from "../src/mockDeckFixtures.js";

assert.deepEqual(parseDeckAttributionUrl("https://www.moxfield.com/decks/abc_DEF-123"), {
  provider: "moxfield",
  id: "abc_DEF-123",
  url: "https://moxfield.com/decks/abc_DEF-123",
});
assert.throws(
  () => parseDeckSourceUrl("https://www.moxfield.com/decks/abc_DEF-123"),
  /attribution only.*More.*Export.*Copy for Moxfield/i,
);
assert.deepEqual(parseDeckSourceUrl("https://archidekt.com/decks/12345/example"), {
  provider: "archidekt",
  id: "12345",
  url: "https://archidekt.com/decks/12345",
});
assert.equal(detectDeckImportInput("https://moxfield.com/decks/abc_DEF-123").kind, "moxfield_url");
assert.equal(detectDeckImportInput("https://archidekt.com/decks/12345/example").kind, "archidekt_url");
assert.equal(detectDeckImportInput("https://example.com/decks/123").kind, "invalid_url");
for (const unsafe of [
  "http://moxfield.com/decks/abc_DEF-123",
  "https://moxfield.com.evil.test/decks/abc_DEF-123",
  "https://user:password@moxfield.com/decks/abc_DEF-123",
  "https://archidekt.com:8443/decks/12345",
]) assert.throws(() => parseDeckSourceUrl(unsafe));

const textCards = parseDeckText(`
Commander
1 Atraxa, Praetors' Voice (2X2) 188

Mainboard
1 Sol Ring
2 Forest (FDN) 281
1 Sol Ring

Sideboard
1 Swords to Plowshares
`);
assert.deepEqual(textCards.map(({ name, quantity, board }) => ({ name, quantity, board })), [
  { name: "Atraxa, Praetors' Voice", quantity: 1, board: "commander" },
  { name: "Sol Ring", quantity: 2, board: "mainboard" },
  { name: "Forest", quantity: 2, board: "mainboard" },
  { name: "Swords to Plowshares", quantity: 1, board: "sideboard" },
]);
assert.equal(detectDeckImportInput("Commander\n1 Sol Ring").kind, "deck_text");
assert.deepEqual(summarizeDeckCards(textCards), {
  commanders: ["Atraxa, Praetors' Voice"],
  totalCards: 6,
  uniqueCards: 4,
  totals: { commander: 1, mainboard: 4, sideboard: 1, maybeboard: 0 },
});
assert.deepEqual(parseDeckText("1 Atraxa, Praetors' Voice (2X2) 188 *CMDR*")[0], {
  name: "Atraxa, Praetors' Voice",
  quantity: 1,
  board: "commander",
  scryfall_id: null,
  oracle_id: null,
  set_code: null,
  collector_number: null,
  mana_value: null,
  type_line: null,
  colors: [],
  tags: [],
});

const taggedMoxfieldCard = parseDeckText("1 Aetherize (PLST) DDO-36 #!Mass disruption #!Interaction")[0];
assert.equal(taggedMoxfieldCard.name, "Aetherize");
assert.deepEqual(taggedMoxfieldCard.tags, [
  "Mass disruption",
  "Interaction",
]);
assert.equal(parseDeckText("1 Fire / Ice (MH2) 290 #!Interaction")[0].name, "Fire // Ice");

const moxfieldWithoutCommanderMarker = parseMoxfieldExport(`
1 Niko, Light of Hope (DSK) 224
1 Sol Ring (CMM) 396
`);
assert.equal(moxfieldWithoutCommanderMarker[0].name, "Niko, Light of Hope");
assert.equal(moxfieldWithoutCommanderMarker[0].board, "commander");
assert.equal(moxfieldWithoutCommanderMarker[1].board, "mainboard");

const moxfieldWithCommanderMarker = parseMoxfieldExport(`
1 Sol Ring (CMM) 396
1 Niko, Light of Hope (DSK) 224 *CMDR*
`);
assert.equal(moxfieldWithCommanderMarker[0].board, "mainboard");
assert.equal(moxfieldWithCommanderMarker[1].board, "commander");

const archidekt = parseArchidektDeck({
  name: "Sample",
  cards: [{
    quantity: 1,
    categories: ["Commander"],
    card: {
      uid: "495e2dcb-736f-425e-8f2d-fffba92bb334",
      collectorNumber: "188",
      edition: { editioncode: "2X2" },
      oracleCard: { uid: "11111111-1111-4111-8111-111111111111", name: "Atraxa, Praetors' Voice", cmc: 4, type: "Legendary Creature — Phyrexian Angel Horror", colors: ["W", "U", "B", "G"] },
    },
  }],
});
assert.equal(archidekt.name, "Sample");
assert.equal(archidekt.cards[0].board, "commander");
assert.equal(archidekt.cards[0].set_code, "2x2");
assert.equal(archidekt.cards[0].mana_value, 4);
assert.equal(primaryCardType(archidekt.cards[0].type_line), "Creature");
assert.equal(primaryCardType("Legendary Land"), "Land");
assert.equal(primaryCardType("Enchantment Land — Saga"), "Land");
assert.equal(primaryCardType("Instant // Land"), "Instant");

assert.equal(aggregateDeckCards([
  { name: "Sol Ring", quantity: 1, board: "mainboard", tags: ["Ramp"] },
  { name: "sol ring", quantity: 2, board: "mainboard", tags: ["Mana", "Ramp"] },
])[0].quantity, 3);
assert.deepEqual(aggregateDeckCards([
  { name: "Sol Ring", quantity: 1, board: "mainboard", tags: ["Ramp"] },
  { name: "sol ring", quantity: 2, board: "mainboard", tags: ["Mana", "Ramp"] },
])[0].tags, ["Ramp", "Mana"]);

const antManCards = parseDeckText(ANT_MAN_DECK_TEXT);
assert.equal(antManCards.reduce((sum, card) => sum + card.quantity, 0), 107);
assert.equal(antManCards.filter((card) => card.board === "commander")[0].name, "The Astonishing Ant-Man");
assert.equal(antManCards.filter((card) => card.board === "sideboard").length, 7);

console.log("deck import parsing and source validation passed");
