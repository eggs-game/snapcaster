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
