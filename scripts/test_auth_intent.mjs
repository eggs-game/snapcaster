#!/usr/bin/env node
import assert from "node:assert/strict";

const values = new Map();
globalThis.sessionStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};

const {
  clearAccountOnlySignInIntent,
  hasAccountOnlySignInIntent,
  markAccountOnlySignInIntent,
  resolveInitialLobbyModal,
  stripJoinIntentFromSearch,
} = await import("../src/authIntent.js");

markAccountOnlySignInIntent(1_000);
assert.equal(hasAccountOnlySignInIntent(2_000), true);
assert.equal(hasAccountOnlySignInIntent(1_000 + 16 * 60 * 1_000), false);
markAccountOnlySignInIntent(5_000);
clearAccountOnlySignInIntent();
assert.equal(hasAccountOnlySignInIntent(5_001), false);

assert.equal(resolveInitialLobbyModal("?action=join"), "join-code");
assert.equal(resolveInitialLobbyModal("?code=ABCD12"), "join");
assert.equal(resolveInitialLobbyModal("?visitor=1&code=ABCD12"), "join");
assert.equal(resolveInitialLobbyModal("?action=join", { suppressJoin: true }), null);
assert.equal(resolveInitialLobbyModal("?code=ABCD12", { suppressJoin: true }), null);
assert.equal(resolveInitialLobbyModal("?action=create", { suppressJoin: true }), "create");
assert.equal(stripJoinIntentFromSearch("?action=join&code=ABCD12&visitor=1"), "");
assert.equal(stripJoinIntentFromSearch("?action=create&code=ABCD12"), "?action=create");

console.log("account-only OAuth intent handling passed");
