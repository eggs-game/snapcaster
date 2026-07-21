// Semantic compatibility rules for visual metadata observations.
//
// This module intentionally does not perform OCR or image extraction. It is
// the policy boundary between a measured observation and candidate ranking:
// high-confidence contradictions may veto; missing/weak reads stay neutral.

const PRIMARY_TYPES = [
  "artifact", "battle", "creature", "enchantment", "instant", "kindred",
  "land", "planeswalker", "sorcery",
];

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

export function primaryTypes(typeLine) {
  const value = String(typeLine || "").toLowerCase();
  return PRIMARY_TYPES.filter((type) => new RegExp(`\\b${type}\\b`).test(value));
}

export function meaningfulWords(text) {
  return new Set(
    String(text || "").toLowerCase().match(/[a-z]{4,}/g) || [],
  );
}

function disjoint(a, b) {
  return a.length && b.length && !a.some((value) => b.includes(value));
}

/**
 * Compare extracted visual evidence with one v4 metadata candidate.
 *
 * Observation shape (all fields optional):
 *   mana: { cost, confidence }
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
    let overlap = 0;
    for (const word of observedWords) if (candidateWords.has(word)) overlap++;
    if (overlap) {
      score += Math.min(3, overlap);
      reasons.push(`rules-word-match:${overlap}`);
    }
  }

  return { compatible: true, score, reasons };
}
