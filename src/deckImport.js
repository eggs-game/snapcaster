const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOARDS = new Set(["commander", "mainboard", "sideboard", "maybeboard"]);
const CARD_TYPES = ["Battle", "Planeswalker", "Creature", "Sorcery", "Instant", "Artifact", "Enchantment", "Land"];

export function normalizeDeckBoard(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "commander" || normalized === "commanders") return "commander";
  if (normalized === "sideboard" || normalized === "side") return "sideboard";
  if (normalized === "maybeboard" || normalized === "maybe" || normalized === "considering") return "maybeboard";
  return "mainboard";
}

export function parseDeckAttributionUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Enter a valid Moxfield or Archidekt deck link.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Deck links must use HTTPS.");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "moxfield.com" && parts[0] === "decks" && /^[A-Za-z0-9_-]{8,64}$/.test(parts[1] || "")) {
    return { provider: "moxfield", id: parts[1], url: `https://moxfield.com/decks/${parts[1]}` };
  }
  if (host === "archidekt.com" && parts[0] === "decks" && /^\d{1,12}$/.test(parts[1] || "")) {
    return { provider: "archidekt", id: parts[1], url: `https://archidekt.com/decks/${parts[1]}` };
  }
  throw new Error("Use a public Moxfield or Archidekt deck link.");
}

export function parseDeckSourceUrl(value) {
  const source = parseDeckAttributionUrl(value);
  if (source.provider === "moxfield") {
    throw new Error("Moxfield links are attribution only. In Moxfield choose More → Export → Copy for Moxfield, then paste the exported list below.");
  }
  return source;
}

export function detectDeckImportInput(value) {
  const input = String(value || "").trim();
  if (!input) return { kind: "empty", input };
  try {
    const source = parseDeckAttributionUrl(input);
    return { kind: `${source.provider}_url`, input, source };
  } catch {
    const cards = parseDeckText(input);
    if (cards.length) return { kind: "deck_text", input, cards };
    return { kind: /^https?:\/\//i.test(input) ? "invalid_url" : "unknown", input };
  }
}

export function summarizeDeckCards(cards) {
  const normalized = aggregateDeckCards(cards);
  const totals = {
    commander: 0,
    mainboard: 0,
    sideboard: 0,
    maybeboard: 0,
  };
  for (const card of normalized) totals[card.board] += card.quantity;
  return {
    commanders: normalized.filter((card) => card.board === "commander").map((card) => card.name).slice(0, 2),
    totalCards: Object.values(totals).reduce((total, quantity) => total + quantity, 0),
    uniqueCards: normalized.length,
    totals,
  };
}

function cleanCard(card) {
  const name = String(card?.name || "").trim().slice(0, 200);
  const quantity = Math.max(1, Math.min(999, Math.trunc(Number(card?.quantity) || 1)));
  const board = BOARDS.has(card?.board) ? card.board : normalizeDeckBoard(card?.board);
  const scryfallId = UUID.test(String(card?.scryfall_id || "")) ? String(card.scryfall_id) : null;
  const oracleId = UUID.test(String(card?.oracle_id || "")) ? String(card.oracle_id) : null;
  const manaValue = Number(card?.mana_value ?? card?.cmc);
  const typeLine = String(card?.type_line || "").trim().slice(0, 200) || null;
  const colors = [...new Set((Array.isArray(card?.colors) ? card.colors : [])
    .map((color) => String(color).toUpperCase())
    .filter((color) => /^[WUBRG]$/.test(color)))];
  const tags = [...new Set((Array.isArray(card?.tags) ? card.tags : [])
    .map((tag) => String(tag).trim().replace(/\s+/g, " ").slice(0, 32))
    .filter(Boolean))].slice(0, 8);
  if (!name) return null;
  return {
    name,
    quantity,
    board,
    scryfall_id: scryfallId,
    oracle_id: oracleId,
    set_code: String(card?.set_code || "").trim().toLowerCase().slice(0, 12) || null,
    collector_number: String(card?.collector_number || "").trim().slice(0, 32) || null,
    mana_value: Number.isFinite(manaValue) && manaValue >= 0 && manaValue <= 100 ? manaValue : null,
    type_line: typeLine,
    colors,
    tags,
  };
}

export function primaryCardType(typeLine) {
  const normalized = String(typeLine || "").split("//")[0].split("—")[0];
  if (/\bLand\b/i.test(normalized)) return "Land";
  return CARD_TYPES.find((type) => new RegExp(`\\b${type}\\b`, "i").test(normalized)) || "Other";
}

export function aggregateDeckCards(cards) {
  const aggregate = new Map();
  for (const input of Array.isArray(cards) ? cards : []) {
    const card = cleanCard(input);
    if (!card) continue;
    const key = `${card.board}\u0000${card.name.toLocaleLowerCase("en-US")}`;
    const existing = aggregate.get(key);
    if (existing) {
      existing.quantity = Math.min(999, existing.quantity + card.quantity);
      existing.tags = [...new Set([...(existing.tags || []), ...(card.tags || [])])].slice(0, 8);
    }
    else aggregate.set(key, card);
  }
  return [...aggregate.values()].slice(0, 500);
}

export function parseDeckText(value) {
  const cards = [];
  let board = "mainboard";
  for (const rawLine of String(value || "").split(/\r?\n/).slice(0, 2000)) {
    const line = rawLine.trim();
    if (!line || /^(?:#|\/\/)/.test(line)) continue;
    const heading = line.replace(/[:\s]+$/, "").toLowerCase();
    if (/^(?:commander|commanders|mainboard|deck|sideboard|maybeboard|considering)$/.test(heading)) {
      board = normalizeDeckBoard(heading);
      continue;
    }
    const match = line.match(/^\s*(\d{1,3})\s*x?\s+(.+?)\s*$/i);
    if (!match) continue;
    const tags = [];
    let name = match[2]
      .replace(/\s+#!([^#]+?)(?=\s+#!|$)/g, (_, tag) => {
        const cleaned = String(tag).trim().replace(/\s+/g, " ").slice(0, 32);
        if (cleaned) tags.push(cleaned);
        return "";
      })
      .replace(/\s+(?:\*CMDR\*|\[commander\]|#commander)\s*$/i, "")
      .replace(/\s+\([A-Z0-9]{2,8}\)(?:\s+[A-Za-z0-9*★-]+)?\s*$/i, "")
      .replace(/\s+\/\s+/g, " // ")
      .trim();
    const taggedCommander = /(?:\*CMDR\*|\[commander\]|#commander)/i.test(line);
    if (name) cards.push({ name, quantity: Number(match[1]), board: taggedCommander ? "commander" : board, tags });
  }
  return aggregateDeckCards(cards);
}

function cardIdentity(card) {
  const oracle = card?.oracleCard || card?.oracle_card || {};
  return {
    name: oracle.name || card?.name || card?.card_name,
    scryfall_id: card?.uid || card?.id || card?.scryfall_id,
    oracle_id: oracle.uid || oracle.id || card?.oracle_id,
    set_code: card?.edition?.editioncode || card?.set || card?.set_code,
    collector_number: card?.collectorNumber || card?.collector_number,
    mana_value: oracle?.cmc ?? oracle?.manaValue ?? card?.cmc ?? card?.mana_value,
    type_line: oracle?.type || oracle?.type_line || card?.type || card?.type_line,
    colors: oracle?.colors || card?.colors,
  };
}

export function parseArchidektDeck(payload) {
  const cards = (payload?.cards || []).map((entry) => {
    const categories = (entry?.categories || []).map((category) => String(category).toLowerCase());
    const board = categories.some((category) => category.includes("commander"))
      ? "commander"
      : categories.some((category) => category.includes("sideboard"))
        ? "sideboard"
        : categories.some((category) => category.includes("maybeboard") || category.includes("consider"))
          ? "maybeboard"
          : "mainboard";
    return { ...cardIdentity(entry?.card), quantity: entry?.quantity, board };
  });
  return { name: String(payload?.name || "").trim().slice(0, 120), cards: aggregateDeckCards(cards) };
}
