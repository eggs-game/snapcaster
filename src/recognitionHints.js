const HINT_TTL_MS = 4 * 60 * 60 * 1000;
const HINT_CACHE_LIMIT = 32;
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

export function isReusableRecognitionMatch(match) {
  if (!match?.scryfall_id) return false;
  if (["art-match", "visual-exact", "recent-hint", "ocr-title"].includes(match.identified_by)) return true;
  return Number(match.distance) <= 90;
}
