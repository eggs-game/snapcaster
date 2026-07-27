let namesPromise = null;
let searchableNames = null;
const queryCache = new Map();

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function loadCardNames() {
  if (namesPromise) return namesPromise;
  namesPromise = fetch("/carddata/names.json")
    .then((response) => {
      if (!response.ok) throw new Error("Card name index is missing.");
      return response.json();
    })
    .then((names) => {
      const safeNames = Array.isArray(names) ? names : [];
      searchableNames = safeNames.map((name) => {
        const normalized = normalize(name);
        return { name, normalized, words: normalized.split(" ") };
      });
      return safeNames;
    })
    .catch((error) => {
      namesPromise = null;
      throw error;
    });
  return namesPromise;
}

export async function suggestLocalCardNames(query, limit = 12) {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return [];
  if (queryCache.has(normalizedQuery)) return queryCache.get(normalizedQuery).slice(0, limit);
  if (!searchableNames) await loadCardNames();
  const queryWords = normalizedQuery.split(" ");
  const matches = [];
  for (const entry of searchableNames || []) {
    let score = 3;
    if (entry.normalized.startsWith(normalizedQuery)) score = 0;
    else if (queryWords.every((word) => entry.words.some((candidate) => candidate.startsWith(word)))) score = 1;
    else if (queryWords.every((word) => entry.normalized.includes(word))) score = 2;
    if (score < 3) matches.push({ ...entry, score });
  }
  matches.sort((a, b) => (
    a.score - b.score
    || a.normalized.length - b.normalized.length
    || a.normalized.localeCompare(b.normalized)
  ));
  const result = matches.slice(0, 24).map((entry) => entry.name);
  queryCache.set(normalizedQuery, result);
  if (queryCache.size > 100) queryCache.delete(queryCache.keys().next().value);
  return result.slice(0, limit);
}
