import assert from "node:assert/strict";
import commanders from "../api/commanders.js";
import accountDelete from "../api/account-delete.js";

const environmentKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const previous = environmentKeys.map((key) => process.env[key]);
// No token is sent: valid origins must still stop at authentication, before
// creating a client, contacting Supabase, or executing any mutation.
process.env.SUPABASE_URL = "https://example.test";
process.env.SUPABASE_ANON_KEY = "test-only";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";

async function responseFor(handler, origin) {
  const response = {
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({ method: "POST", headers: { origin }, body: {} }, response);
  return response;
}

try {
  for (const handler of [commanders, accountDelete]) {
    for (const origin of ["https://snapcast.app", "https://www.snapcast.app", "https://snapcaster.vercel.app"]) {
      const response = await responseFor(handler, origin);
      assert.equal(response.code, 401, `${origin} must reach authentication`);
      assert.equal(response.body.error, "Authentication required");
    }
    for (const origin of ["https://www.snapcast.app.evil.test", "https://evil.test", "http://www.snapcast.app", "https://www.snapcast.app:444", "https://www.snapcast.app/"]) {
      const response = await responseFor(handler, origin);
      assert.equal(response.code, 403, `${origin} must remain blocked`);
      assert.equal(response.body.error, "Origin not allowed");
    }
  }
  console.log("Account APIs accept the canonical production origin and still reject unrelated origins before authentication.");
} finally {
  environmentKeys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  });
}
