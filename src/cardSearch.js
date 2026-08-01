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
import { suggestLocalCardNames } from "./cardNameIndex.js";

const SCRYFALL_CACHE_LIMIT = 200;
const scryfallCache = new Map();

function cachedScryfall(url) {
  if (scryfallCache.has(url)) return scryfallCache.get(url);
  const request = fetch(url)
    .then(async (response) => ({
      ok: response.ok,
      status: response.status,
      data: response.ok ? await response.json() : null,
    }))
    .catch((error) => {
      scryfallCache.delete(url);
      throw error;
    });
  scryfallCache.set(url, request);
  if (scryfallCache.size > SCRYFALL_CACHE_LIMIT) {
    scryfallCache.delete(scryfallCache.keys().next().value);
  }
  return request;
}

function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function fetchCardByName(name, { exact = false, signal } = {}) {
  const mode = exact ? "exact" : "fuzzy";
  const result = await withAbort(
    cachedScryfall(
      `https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(String(name || "").trim())}`,
    ),
    signal,
  );
  return result.ok ? result.data : null;
}

export async function suggestCardNames(query, signal) {
  const q = query.trim();
  if (q.length < 2) return [];

  const localNames = await suggestLocalCardNames(q);
  if (localNames.length) return localNames;

  const autoResp = await withAbort(
    cachedScryfall(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`),
    signal,
  );
  const names = autoResp.ok ? autoResp.data?.data || [] : [];
  if (names.length) return names;

  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const search = words.map((w) => `name:"${w.replace(/"/g, "")}"`).join(" ");
  const searchResp = await withAbort(
    cachedScryfall(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(search)}&unique=cards&order=name`,
    ),
    signal,
  );
  if (!searchResp.ok) return []; // 404 = no matches
  const cards = searchResp.data?.data || [];
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
      const response = await withAbort(
        cachedScryfall(
          `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`${searchFilter} ${nameFilters}`)}&unique=cards&order=name`,
        ),
        signal,
      );
      return response.ok ? response.data?.data || [] : [];
    });
  const named = pairings
    .filter((pairing) => pairing.kind === "named" && pairing.name.toLowerCase().includes(q.toLowerCase()))
    .map(async (pairing) => {
      const card = await fetchCardByName(pairing.name, { exact: true, signal });
      return card ? [card] : [];
    });
  const cards = (await Promise.all([...searches, ...named])).flat();
  return [...new Map(cards
    .filter((card) => isValidCommanderPartner(primaryCard, card))
    .map((card) => [card.name, card]))
    .values()]
    .slice(0, 12)
    .map((card) => card.name);
}
