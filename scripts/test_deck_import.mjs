import assert from "node:assert/strict";
import {
  aggregateDeckCards,
  parseArchidektDeck,
  parseDeckAttributionUrl,
  parseDeckSourceUrl,
  parseDeckText,
  primaryCardType,
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
});

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

assert.equal(aggregateDeckCards([
  { name: "Sol Ring", quantity: 1, board: "mainboard" },
  { name: "sol ring", quantity: 2, board: "mainboard" },
])[0].quantity, 3);

const antManCards = parseDeckText(ANT_MAN_DECK_TEXT);
assert.equal(antManCards.reduce((sum, card) => sum + card.quantity, 0), 107);
assert.equal(antManCards.filter((card) => card.board === "commander")[0].name, "The Astonishing Ant-Man");
assert.equal(antManCards.filter((card) => card.board === "sideboard").length, 7);

console.log("deck import parsing and source validation passed");
