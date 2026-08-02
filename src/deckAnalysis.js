import { primaryCardType } from "./deckImport.js";

export const DECK_BOARD_LABELS = {
  commander: "Commander",
  mainboard: "Mainboard",
  sideboard: "Sideboard",
  maybeboard: "Considering",
};

export const DECK_BOARD_ORDER = ["commander", "mainboard", "sideboard", "maybeboard"];

const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Sorcery", "Instant", "Artifact", "Enchantment", "Land", "Other"];
const TYPE_LABELS = {
  Creature: "Creatures",
  Planeswalker: "Planeswalkers",
  Battle: "Battles",
  Sorcery: "Sorceries",
  Instant: "Instants",
  Artifact: "Artifacts",
  Enchantment: "Enchantments",
  Land: "Lands",
  Other: "Other",
};

function quantity(card) {
  return Math.max(0, Number(card?.quantity) || 0);
}

function isDeckCard(card) {
  return card?.board === "commander" || card?.board === "mainboard";
}

export function formatDeckText(cards) {
  return DECK_BOARD_ORDER
    .map((board) => {
      const lines = (Array.isArray(cards) ? cards : [])
        .filter((card) => card?.board === board && quantity(card) > 0 && String(card?.name || "").trim())
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((card) => `${quantity(card)} ${String(card.name).trim()}${(card.tags || []).map((tag) => ` #!${tag}`).join("")}`);
      return lines.length ? `${DECK_BOARD_LABELS[board]}\n${lines.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function buildManaCurve(cards) {
  const curve = [0, 1, 2, 3, 4, 5, 6, 7].map((value) => ({ label: value === 7 ? "7+" : String(value), count: 0 }));
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!isDeckCard(card) || primaryCardType(card?.type_line) === "Land" || card?.mana_value == null) continue;
    const manaValue = Math.max(0, Math.floor(Number(card.mana_value)) || 0);
    curve[Math.min(7, manaValue)].count += quantity(card);
  }
  return curve;
}

export function buildTypeBreakdown(cards) {
  const counts = new Map(TYPE_ORDER.map((type) => [type, 0]));
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!isDeckCard(card)) continue;
    const type = primaryCardType(card?.type_line);
    counts.set(type, (counts.get(type) || 0) + quantity(card));
  }
  return TYPE_ORDER
    .map((type) => ({ key: type, label: TYPE_LABELS[type] || type, count: counts.get(type) || 0 }))
    .filter((entry) => entry.count > 0);
}

export function buildColorBreakdown(cards) {
  const breakdown = [
    { key: "W", label: "White", count: 0 },
    { key: "U", label: "Blue", count: 0 },
    { key: "B", label: "Black", count: 0 },
    { key: "R", label: "Red", count: 0 },
    { key: "G", label: "Green", count: 0 },
    { key: "C", label: "Colorless", count: 0 },
  ];
  const byKey = new Map(breakdown.map((entry) => [entry.key, entry]));
  let spellCount = 0;
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!isDeckCard(card) || primaryCardType(card?.type_line) === "Land") continue;
    const cardQuantity = quantity(card);
    spellCount += cardQuantity;
    const colors = [...new Set((Array.isArray(card?.colors) ? card.colors : []).filter((color) => byKey.has(color) && color !== "C"))];
    for (const color of colors.length ? colors : ["C"]) byKey.get(color).count += cardQuantity;
  }
  return breakdown.map((entry) => ({ ...entry, percentage: spellCount ? Math.round((entry.count / spellCount) * 100) : 0 }));
}

export function shuffleMainDeck(cards, random = Math.random) {
  const library = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    if (card?.board !== "mainboard") continue;
    for (let index = 0; index < quantity(card); index += 1) {
      library.push({ ...card, drawKey: `${card.id || card.name}-${index}` });
    }
  }
  for (let index = library.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(index, Math.max(0, Math.floor(random() * (index + 1))));
    [library[index], library[swapIndex]] = [library[swapIndex], library[index]];
  }
  return library;
}
