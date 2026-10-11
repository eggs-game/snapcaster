#!/usr/bin/env node
import { pathToFileURL } from "node:url";

// No session or private key is needed. Missing server configuration returns
// 503 before authentication; a configured route must instead reject with 401.
export async function checkProductionDecks(baseUrl = "https://www.snapcast.app", request = fetch) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) {
    throw new Error("Use HTTPS for a deployed API check");
  }
  const results = [];
  for (const route of ["/api/commanders", "/api/decks"]) {
    for (const [label, origin, expected] of [
      ["authentication", base.origin, 401],
      ["foreign origin", "https://unrelated.example", 403],
    ]) {
      const response = await request(new URL(route, base), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: "{}",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`${route} ${label}: expected JSON, received HTTP ${response.status}`);
      }
      const expectedError = expected === 401 ? "Authentication required" : "Origin not allowed";
      if (response.status !== expected || body.error !== expectedError) {
        // Do not echo response bodies: an unexpected deployment may contain
        // sensitive diagnostics or return an HTML login page.
        throw new Error(`${route} ${label}: expected HTTP ${expected}, received ${response.status}`);
      }
      results.push(`${route} ${label}: HTTP ${response.status}`);
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log((await checkProductionDecks(process.argv[2])).join("\n"));
  } catch (error) {
    console.error(`Deck API configuration check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
