import {
  getCommanderPairing,
  getCommanderPairings,
  isCommanderCard,
  isValidCommanderPartner,
} from "./commanderRules.js";

export {
  getCommanderPairing,
  getCommanderPairings,
  isCommanderCard,
  isValidCommanderPartner,
} from "./commanderRules.js";

// Card-name suggestions backed by Scryfall.
//
// The autocomplete endpoint only matches names as one continuous prefix, so a
// multi-word fragment like "jodah un" returns nothing even though it clearly
// means "Jodah, the Unifier". When autocomplete comes back empty we fall back
// to the full search API with per-word name filters.
export async function suggestCardNames(query, signal) {
  const q = query.trim();
  if (q.length < 2) return [];

  const autoResp = await fetch(
    `https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`,
    { signal },
  );
  const names = autoResp.ok ? (await autoResp.json()).data || [] : [];
  if (names.length) return names;

  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const search = words.map((w) => `name:"${w.replace(/"/g, "")}"`).join(" ");
  const searchResp = await fetch(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(search)}&unique=cards&order=name`,
    { signal },
  );
  if (!searchResp.ok) return []; // 404 = no matches
  const cards = (await searchResp.json()).data || [];
  return cards.slice(0, 12).map((card) => card.name);
}

function pairingSearch(pairing) {
  switch (pairing?.kind) {
    case "partner": return 't:legendary t:creature o:"Partner"';
    case "friends": return 't:legendary t:creature o:"Friends forever"';
    case "variant": return `t:legendary t:creature o:"Partner—${pairing.label}"`;
    case "choose-background": return "t:background";
    case "background": return 't:legendary t:creature o:"Choose a Background"';
    case "doctors-companion": return "t:legendary t:creature t:time t:lord t:doctor";
    case "doctor": return 't:legendary t:creature o:"Doctor\'s companion"';
    default: return "";
  }
}

export async function suggestCommanderPartners(primaryCard, query, signal) {
  const pairings = getCommanderPairings(primaryCard);
  const q = query.trim();
  if (!pairings.length || q.length < 2) return [];

  const words = q.split(/\s+/).filter(Boolean);
  const nameFilters = words.map((word) => `name:"${word.replace(/"/g, "")}"`).join(" ");
  const searches = pairings
    .map(pairingSearch)
    .filter(Boolean)
    .map(async (searchFilter) => {
      const response = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`${searchFilter} ${nameFilters}`)}&unique=cards&order=name`,
        { signal },
      );
      return response.ok ? (await response.json()).data || [] : [];
    });
  const named = pairings
    .filter((pairing) => pairing.kind === "named" && pairing.name.toLowerCase().includes(q.toLowerCase()))
    .map(async (pairing) => {
      const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(pairing.name)}`, { signal });
      return response.ok ? [await response.json()] : [];
    });
  const cards = (await Promise.all([...searches, ...named])).flat();
  return [...new Map(cards
    .filter((card) => isValidCommanderPartner(primaryCard, card))
    .map((card) => [card.name, card]))
    .values()]
    .slice(0, 12)
    .map((card) => card.name);
}
