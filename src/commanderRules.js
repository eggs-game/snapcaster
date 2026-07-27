function hasType(card, type) {
  return new RegExp(`\\b${type}\\b`, "i").test(String(card?.type_line || ""));
}

function isLegendaryBackground(card) {
  return hasType(card, "Legendary") && hasType(card, "Enchantment") && hasType(card, "Background");
}

function isEligibleDoctor(card) {
  const typeLine = String(card?.type_line || "");
  const [, subtypes = ""] = typeLine.split("—");
  return hasType(card, "Legendary") && hasType(card, "Creature") && /^Time Lord Doctor$/i.test(subtypes.trim());
}

// These pure rules are shared by the browser's search UI and the trusted
// commander API. Scryfall's current Oracle data is the source of truth.
export function getCommanderPairings(card) {
  const oracle = String(card?.oracle_text || "");
  const pairings = [];
  for (const match of oracle.matchAll(/^Partner with ([^\n(]+?)(?:\s*\(|\s*$)/gim)) {
    pairings.push({ kind: "named", name: match[1].trim() });
  }
  for (const match of oracle.matchAll(/^Partner[—-]([^\n(]+?)(?:\s*\(|\s*$)/gim)) {
    pairings.push({ kind: "variant", label: match[1].trim().toLowerCase() });
  }
  if (/^Friends forever(?:\s|\(|$)/im.test(oracle)) pairings.push({ kind: "friends" });
  if (/^Partner(?!\s+with\b)(?:\s|\(|$)/im.test(oracle)) pairings.push({ kind: "partner" });
  if (/^Choose a Background(?:\s|\(|$)/im.test(oracle)) pairings.push({ kind: "choose-background" });
  if (/^Doctor['’]s companion(?:\s|\(|$)/im.test(oracle)) pairings.push({ kind: "doctors-companion" });
  if (isLegendaryBackground(card)) pairings.push({ kind: "background" });
  if (isEligibleDoctor(card)) pairings.push({ kind: "doctor" });
  return pairings;
}

export function getCommanderPairing(card) {
  return getCommanderPairings(card)[0] || null;
}

export function isCommanderCard(card) {
  const oracle = String(card?.oracle_text || "");
  return (
    (hasType(card, "Legendary") && hasType(card, "Creature"))
    || /can be your commander/i.test(oracle)
  );
}

export function isValidCommanderPartner(primary, candidate) {
  const candidatePairings = getCommanderPairings(candidate);
  return getCommanderPairings(primary).some((pairing) => {
    if (pairing.kind === "named") {
      return candidate?.name === pairing.name
        && candidatePairings.some((other) => other.kind === "named" && other.name === primary?.name);
    }
    if (pairing.kind === "doctors-companion") return isEligibleDoctor(candidate);
    if (pairing.kind === "doctor") return candidatePairings.some((other) => other.kind === "doctors-companion");
    if (pairing.kind === "choose-background") return isLegendaryBackground(candidate);
    if (pairing.kind === "background") return candidatePairings.some((other) => other.kind === "choose-background");
    return candidatePairings.some((other) => other.kind === pairing.kind && other.label === pairing.label);
  });
}
