import assert from "node:assert/strict";
import { checkProductionDecks } from "./check_production_decks.mjs";

const requests = [];
function fixture(missingRoute) {
  return async (url, options) => {
    requests.push({ url, options });
    const allowed = options.headers.Origin === "https://www.snapcast.app";
    const status = !allowed ? 403 : url.pathname === missingRoute ? 503 : 401;
    return Response.json({ error: status === 403 ? "Origin not allowed"
      : status === 503 ? "Deck imports are not configured" : "Authentication required" }, { status });
  };
}

assert.equal((await checkProductionDecks(undefined, fixture())).length, 4);
for (const { url, options } of requests) {
  assert.equal(url.origin, "https://www.snapcast.app");
  assert.equal(options.method, "POST");
  assert.equal(options.body, "{}");
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.redirect, "error");
}
for (const route of ["/api/commanders", "/api/decks"]) {
  await assert.rejects(checkProductionDecks(undefined, fixture(route)), /expected HTTP 401, received 503/);
}
await assert.rejects(checkProductionDecks(undefined, async () => Response.json({ error: "Origin not allowed" }, { status: 403 })), /expected HTTP 401, received 403/);
await assert.rejects(checkProductionDecks(undefined, async () => Response.json({}, { status: 200 })), /expected HTTP 401, received 200/);
await assert.rejects(checkProductionDecks(undefined, async () => new Response("private diagnostics")), /expected JSON, received HTTP 200/);
console.log("Deployment check detects missing deck configuration without sessions, secrets, or mutations.");
