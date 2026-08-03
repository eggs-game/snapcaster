const ACCOUNT_ONLY_SIGN_IN_KEY = "sc-account-only-sign-in";
const ACCOUNT_ONLY_SIGN_IN_MAX_AGE_MS = 15 * 60 * 1000;

function storage() {
  try { return sessionStorage; } catch { return null; }
}

export function markAccountOnlySignInIntent(now = Date.now()) {
  try { storage()?.setItem(ACCOUNT_ONLY_SIGN_IN_KEY, String(now)); } catch { /* sign-in can continue without the marker */ }
}

export function clearAccountOnlySignInIntent() {
  try { storage()?.removeItem(ACCOUNT_ONLY_SIGN_IN_KEY); } catch { /* marker cleanup remains best effort */ }
}

export function hasAccountOnlySignInIntent(now = Date.now()) {
  try {
    const startedAt = Number(storage()?.getItem(ACCOUNT_ONLY_SIGN_IN_KEY));
    if (!Number.isFinite(startedAt) || startedAt <= 0 || now - startedAt > ACCOUNT_ONLY_SIGN_IN_MAX_AGE_MS) {
      clearAccountOnlySignInIntent();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function stripJoinIntentFromSearch(search = "") {
  const params = new URLSearchParams(search);
  if (params.get("action") === "join") params.delete("action");
  params.delete("code");
  params.delete("visitor");
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function resolveInitialLobbyModal(search = "", { suppressJoin = false } = {}) {
  const params = new URLSearchParams(search);
  const action = params.get("action");
  if (action === "create") return "create";
  if (suppressJoin) return null;
  if (params.get("code") || params.get("visitor") === "1") return "join";
  return action === "join" ? "join-code" : null;
}
