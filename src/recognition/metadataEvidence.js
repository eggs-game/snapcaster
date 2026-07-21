// Semantic compatibility rules for visual metadata observations.
//
// This module intentionally does not perform OCR or image extraction. It is
// the policy boundary between a measured observation and candidate ranking:
// high-confidence contradictions may veto; missing/weak reads stay neutral.

const PRIMARY_TYPES = [
  "artifact", "battle", "creature", "enchantment", "instant", "kindred",
  "land", "planeswalker", "sorcery",
];
const RULES_STOP_WORDS = new Set([
  "about", "after", "another", "before", "being", "card", "cards", "choose",
  "control", "controls", "counter", "creature", "creatures", "damage", "each",
  "from", "have", "instead", "other", "owner", "player", "players", "spell",
  "target", "than", "that", "their", "this", "those", "until", "when",
  "whenever", "where", "with", "would", "your",
]);

export function manaTokens(cost) {
  return [...String(cost || "").matchAll(/\{([^}]+)\}/g)].map((match) => match[1].toUpperCase());
}

export function normalizeManaCost(cost) {
  return manaTokens(cost).map((token) => `{${token}}`).join("");
}

export function manaCostOptions(cost) {
  const combined = normalizeManaCost(cost);
  const faces = String(cost || "").split("//").map(normalizeManaCost).filter(Boolean);
  return [...new Set([combined, ...faces].filter(Boolean))];
}

export function genericManaValues(cost) {
  return [...new Set(String(cost || "").split("//").map((face) => (
    manaTokens(face).reduce((sum, token) => sum + (/^\d+$/.test(token) ? Number(token) : 0), 0)
  )))];
}

export function manaSymbolCounts(cost) {
  return [...new Set(String(cost || "").split("//").map((face) => manaTokens(face).length))];
}

export function primaryTypes(typeLine) {
  const value = String(typeLine || "").toLowerCase();
  return PRIMARY_TYPES.filter((type) => new RegExp(`\\b${type}\\b`).test(value));
}

export function meaningfulWords(text) {
  return new Set(
    (String(text || "").toLowerCase().match(/[a-z]{4,}/g) || [])
      .filter((word) => !RULES_STOP_WORDS.has(word)),
  );
}

function disjoint(a, b) {
  return a.length && b.length && !a.some((value) => b.includes(value));
}

/**
 * Compare extracted visual evidence with one v4 metadata candidate.
 *
 * Observation shape (all fields optional):
 *   mana: { cost, confidence, generic, genericConfidence,
 *           symbolCount, symbolCountConfidence }
 *   type: { text, confidence }
 *   rules: { text, confidence }
 *
 * Candidate shape: { mana_cost, type_line, oracle_text }
 */
export function evaluateMetadataEvidence(observation, candidate) {
  const reasons = [];
  let score = 0;

  const observedMana = normalizeManaCost(observation?.mana?.cost);
  const candidateMana = manaCostOptions(candidate?.mana_cost);
  if (observation?.mana?.confidence >= 0.92 && observedMana) {
    // Shared-image split/adventure cards may expose one cost clearly even
    // though the index retains both face costs. Either visible cost is valid.
    if (!candidateMana.includes(observedMana)) {
      return { compatible: false, score: -Infinity, reasons: ["mana-cost-mismatch"] };
    }
    score += 3;
    reasons.push("mana-cost-match");
  }
  if (observation?.mana?.genericConfidence >= 0.95
      && Number.isInteger(observation.mana.generic)) {
    const values = genericManaValues(candidate?.mana_cost);
    if (!values.includes(observation.mana.generic)) {
      return { compatible: false, score: -Infinity, reasons: ["generic-mana-mismatch"] };
    }
    score += 1;
    reasons.push("generic-mana-match");
  }
  if (observation?.mana?.symbolCountConfidence >= 0.97
      && Number.isInteger(observation.mana.symbolCount)) {
    const counts = manaSymbolCounts(candidate?.mana_cost);
    if (!counts.includes(observation.mana.symbolCount)) {
      return { compatible: false, score: -Infinity, reasons: ["mana-symbol-count-mismatch"] };
    }
    score += 1;
    reasons.push("mana-symbol-count-match");
  }

  const observedTypes = primaryTypes(observation?.type?.text);
  const candidateTypes = primaryTypes(candidate?.type_line);
  if (observation?.type?.confidence >= 0.92 && observedTypes.length) {
    if (disjoint(observedTypes, candidateTypes)) {
      return { compatible: false, score: -Infinity, reasons: ["primary-type-mismatch"] };
    }
    score += 2;
    reasons.push("primary-type-match");
  }

  // Rules OCR is small, multi-line, and often partial. Treat it as positive
  // corroboration only; absence or disagreement must not veto a candidate.
  if (observation?.rules?.confidence >= 0.55) {
    const observedWords = meaningfulWords(observation.rules.text);
    const candidateWords = meaningfulWords(candidate?.oracle_text);
    const matches = [];
    for (const word of observedWords) if (candidateWords.has(word)) matches.push(word);
    // One ordinary OCR token is too easy to hit by chance. Accept either two
    // independent words, or one long word at strong read confidence.
    const supported = matches.length >= 2
      || (matches.some((word) => word.length >= 8) && observation.rules.confidence >= 0.8);
    if (supported) {
      const overlap = matches.length;
      score += Math.min(3, overlap);
      reasons.push(`rules-word-match:${overlap}`);
    }
  }

  return { compatible: true, score, reasons };
}
