// These methods have already passed recognition's confidence gate. A room
// hint is verified against the new photo, so it should render like its original
// artwork match rather than as a failed lookup.
const DECISIVE_METHODS = new Set(["ocr-title", "art-match", "search", "visual-exact", "recent-hint"]);

export function isDecisiveCardMatch(match) {
  return Boolean(match && DECISIVE_METHODS.has(match.identified_by));
}
