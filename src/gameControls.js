const INTERACTIVE_TARGETS = [
  "a[href]", "area[href]", "button", "input", "textarea", "select", "summary",
  "audio[controls]", "video[controls]", '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex^="-"])',
  ...["button", "link", "checkbox", "radio", "switch", "combobox", "textbox", "searchbox",
    "slider", "spinbutton", "listbox", "option", "tab", "treeitem", "menuitem",
    "menuitemcheckbox", "menuitemradio"].map((role) => `[role="${role}"]`),
].join(",");

// Passing the turn is a background shortcut. Space must keep its ordinary
// activation/editing behavior inside controls and while a modal is open.
export function isPlainSpaceShortcut(event, documentRef = globalThis.document) {
  if (!event || (event.code !== "Space" && event.key !== " ")) return false;
  if (event.repeat || event.defaultPrevented || event.isComposing
    || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (documentRef?.querySelector?.('[aria-modal="true"], dialog[open]')) return false;
  const pathTarget = event.composedPath?.()[0];
  const target = pathTarget || event.target;
  const element = target?.nodeType === 3 ? target.parentElement : target;
  if (element?.isContentEditable || element?.closest?.(INTERACTIVE_TARGETS)) return false;
  return true;
}

// A pointer drag can synthesize a click on the video beneath its release.
// Consume only that release click; remove the guard at the next task even
// when pointer cancellation produces no click, preserving ordinary card clicks.
export function suppressDragReleaseClick(windowRef = globalThis.window) {
  let timer;
  const cleanup = () => {
    windowRef.removeEventListener("click", consume, true);
    windowRef.clearTimeout(timer);
  };
  const consume = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    cleanup();
  };
  windowRef.addEventListener("click", consume, true);
  timer = windowRef.setTimeout(cleanup, 0);
  return cleanup;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Durable history accepts one integer per opponent membership UUID. Live game
// state still tracks each creature commander separately (`id` and `p:id`). Use
// the higher single-creature total, never their sum: two commanders each dealing
// 12 damage have not dealt a lethal 24 commander damage from one creature.
export function serializeCommanderDamage(damage, roster) {
  if (!damage || typeof damage !== "object" || Array.isArray(damage)) return {};
  const memberships = new Map((Array.isArray(roster) ? roster : [])
    .filter((member) => member?.id && member.role !== "visitor" && UUID_RE.test(String(member.membershipId || "")))
    .map((member) => [String(member.id), String(member.membershipId).toLowerCase()]));
  const snapshot = new Map();
  for (const [attackerId, rawValue] of Object.entries(damage)) {
    const participantId = attackerId.startsWith("p:") ? attackerId.slice(2) : attackerId;
    const membershipId = memberships.get(participantId);
    if (!membershipId || !["number", "string"].includes(typeof rawValue)
      || (typeof rawValue === "string" && !rawValue.trim())) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    const bounded = Math.max(0, Math.min(999, Math.trunc(value)));
    snapshot.set(membershipId, Math.max(snapshot.get(membershipId) ?? 0, bounded));
  }
  return Object.fromEntries(snapshot);
}
