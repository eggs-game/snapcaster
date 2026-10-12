const HINT_TTL_MS = 4 * 60 * 60 * 1000;
export const RECOGNITION_HINT_LIMIT = 256;
const HINT_CACHE_LIMIT = RECOGNITION_HINT_LIMIT;
const HINT_SCAN_LIMIT = 12;
const HINT_RADIUS = 0.15;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
}

function safeId(value, length) {
  return String(value || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, length);
}

export function normalizeRecognitionHint(value, now = Date.now()) {
  const ownerId = safeId(value?.ownerId, 40);
  const nx = safeCoordinate(value?.nx);
  const ny = safeCoordinate(value?.ny);
  const card = value?.card && typeof value.card === "object" ? value.card : {};
  const scryfallId = String(card.scryfall_id || "").toLowerCase();
  if (!ownerId || nx == null || ny == null || !UUID_RE.test(scryfallId)) return null;
  const atValue = Number(value?.at);
  // Expiration must survive normalization. Replacing an old timestamp with
  // `now` would keep a stale board position alive every time the cache is read.
  if (Number.isFinite(atValue) && atValue > 0 && atValue <= now - HINT_TTL_MS) return null;
  const at = Number.isFinite(atValue) && atValue > now - HINT_TTL_MS && atValue < now + 60000
    ? atValue
    : now;
  return {
    ownerId,
    nx,
    ny,
    at,
    card: {
      name: String(card.name || "").trim().slice(0, 120),
      scryfall_id: scryfallId,
      face: Number(card.face) === 1 ? 1 : 0,
      set: String(card.set || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toLowerCase(),
      collector_number: String(card.collector_number || "").slice(0, 20),
    },
  };
}

export function rememberRecognitionHint(existing, value, now = Date.now()) {
  const hint = normalizeRecognitionHint(value, now);
  if (!hint) return Array.isArray(existing) ? existing.slice(-HINT_CACHE_LIMIT) : [];
  const key = `${hint.card.scryfall_id}:${hint.card.face}`;
  const next = (Array.isArray(existing) ? existing : []).filter((entry) => {
    const normalized = normalizeRecognitionHint(entry, now);
    if (!normalized || now - normalized.at > HINT_TTL_MS) return false;
    const sameCard = `${normalized.card.scryfall_id}:${normalized.card.face}` === key;
    const dx = normalized.nx - hint.nx;
    const dy = normalized.ny - hint.ny;
    return !(normalized.ownerId === hint.ownerId && sameCard && dx * dx + dy * dy < 0.0025);
  });
  return [...next, hint].slice(-HINT_CACHE_LIMIT);
}

export function nearbyRecognitionHints(existing, ownerId, nx, ny, now = Date.now()) {
  const safeOwnerId = safeId(ownerId, 40);
  const x = safeCoordinate(nx);
  const y = safeCoordinate(ny);
  if (!safeOwnerId || x == null || y == null) return [];
  const radiusSq = HINT_RADIUS * HINT_RADIUS;
  const seen = new Set();
  return (Array.isArray(existing) ? existing : [])
    .map((entry) => normalizeRecognitionHint(entry, now))
    .filter(Boolean)
    .filter((entry) => entry.ownerId === safeOwnerId && now - entry.at <= HINT_TTL_MS)
    .map((entry) => {
      const dx = entry.nx - x;
      const dy = entry.ny - y;
      return { entry, distanceSq: dx * dx + dy * dy };
    })
    .filter(({ distanceSq }) => distanceSq <= radiusSq)
    .sort((a, b) => a.distanceSq - b.distanceSq || b.entry.at - a.entry.at)
    .filter(({ entry }) => {
      const key = `${entry.card.scryfall_id}:${entry.card.face}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, HINT_SCAN_LIMIT)
    .map(({ entry }) => entry.card);
}

export function removeRecognitionHintsForOwner(existing, ownerId) {
  const owner = safeId(ownerId, 40);
  return (Array.isArray(existing) ? existing : []).filter(entry => entry.ownerId !== owner);
}

// The wider recognition shortlist must never select a displayed answer. A
// remembered preview is only useful for a tight, unambiguous repeat click;
// fresh capture/verification remains responsible for the current identity.
export function rememberedRecognitionHint(existing, ownerId, nx, ny, now = Date.now()) {
  const owner = safeId(ownerId, 40), x = safeCoordinate(nx), y = safeCoordinate(ny);
  if (!owner || x == null || y == null) return null;
  const candidates = (Array.isArray(existing) ? existing : [])
    .map(entry => normalizeRecognitionHint(entry, now)).filter(Boolean)
    .filter(entry => entry.ownerId === owner && entry.card.name
      && (entry.nx - x) ** 2 + (entry.ny - y) ** 2 <= 0.04 ** 2)
    .sort((a, b) => b.at - a.at);
  const positions = [];
  for (const entry of candidates) {
    // A later verified card at the exact old spot supersedes its old preview.
    // Keep both candidates in the ordinary verifier's wider shortlist.
    if (positions.some(newer => (newer.nx - entry.nx) ** 2 + (newer.ny - entry.ny) ** 2 <= 0.012 ** 2)) continue;
    positions.push(entry);
  }
  const identities = new Set(positions.map(entry => `${entry.card.scryfall_id}:${entry.card.face}`));
  if (identities.size !== 1) return null;
  return positions.sort((a, b) => (a.nx - x) ** 2 + (a.ny - y) ** 2
    - (b.nx - x) ** 2 - (b.ny - y) ** 2 || b.at - a.at)[0] || null;
}

export function isReusableRecognitionMatch(match) {
  if (!match?.scryfall_id) return false;
  if (["art-match", "visual-exact", "recent-hint", "ocr-title"].includes(match.identified_by)) return true;
  return Number(match.distance) <= 90;
}
