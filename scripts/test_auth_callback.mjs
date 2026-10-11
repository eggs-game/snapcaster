import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build, preview } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), "snapcast-oauth-"));
const authOrigin = "https://auth.snapcast.test";
const authCode = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const user = { id: userId, aud: "authenticated", role: "authenticated", is_anonymous: false, user_metadata: {} };
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, exp: expiresAt, aud: "authenticated" })}.test-only`;
// Optional control run uses the real App source from a known earlier commit.
const baseline = process.argv.find((arg) => arg.startsWith("--baseline="))?.split("=")[1];
if (baseline) assert.match(baseline, /^[a-f0-9]{7,40}$/);
const baselineSource = baseline && execFileSync("git", ["show", `${baseline}:src/App.jsx`], { cwd: root, encoding: "utf8" });
let server, browser, releaseExchange;

try {
  await build({
    root,
    logLevel: "silent",
    publicDir: false,
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(authOrigin),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("test-only-public-key"),
    },
    build: { outDir: directory, emptyOutDir: true },
    plugins: baseline ? [{
      name: "oauth-regression-control",
      enforce: "pre",
      load(id) { if (id === path.join(root, "src/App.jsx")) return baselineSource; },
    }] : [],
  });
  server = await preview({ root, logLevel: "silent", build: { outDir: directory }, preview: { host: "127.0.0.1", port: 0 } });
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addInitScript(() => {
    sessionStorage.setItem("sc-account-only-sign-in", String(Date.now()));
    localStorage.setItem("sb-auth-auth-token-code-verifier", JSON.stringify("test-only-verifier"));
  });
  let exchanges = 0;
  let exchangeStarted;
  const started = new Promise((resolve) => { exchangeStarted = resolve; });
  const heldExchange = new Promise((resolve) => { releaseExchange = resolve; });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseUrl) return route.continue();
    if (url.origin !== authOrigin) return route.abort();
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
    if (url.pathname === "/auth/v1/token") {
      assert.equal(route.request().postDataJSON().auth_code, authCode);
      assert.equal(route.request().postDataJSON().code_verifier, "test-only-verifier");
      exchanges++;
      exchangeStarted();
      await heldExchange;
      return route.fulfill({ headers, json: { access_token: accessToken, refresh_token: "test-only-refresh", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, user } });
    }
    if (url.pathname === "/auth/v1/user") return route.fulfill({ headers, json: user });
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 400, headers, json: { message: "Server could not revoke all sessions" } });
    const records = {
      "/rest/v1/profiles": { id: userId, display_name: "OAuth test", avatar_url: "" },
      "/rest/v1/account_preferences": { user_id: userId, theme: "dark" },
      "/rest/v1/account_private": { email: null, email_verified: false },
    };
    return route.fulfill({ headers: { ...headers, "Content-Range": "*/0" }, json: records[url.pathname] || [] });
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?code=${authCode}`, { waitUntil: "domcontentloaded" });
  let timer;
  try {
    await Promise.race([started, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("OAuth code was removed before the login client could exchange it.")), 10_000);
    })]);
  } finally { clearTimeout(timer); }
  assert.equal(new URL(page.url()).searchParams.get("code"), authCode, "URL cleanup must wait for authentication");
  assert.equal(await page.getByRole("dialog").count(), 0, "account-only login must not open a game dialog");
  releaseExchange();
  await page.getByRole("button", { name: "OAuth test", exact: true }).waitFor({ timeout: 10_000 });
  assert.equal(new URL(page.url()).searchParams.has("code"), false, "consumed callback codes must be removed");
  assert.equal(exchanges, 1, "the callback must be exchanged exactly once");
  assert.equal(await page.getByRole("dialog").count(), 0);
  if (!baseline) {
    await page.getByRole("button", { name: "OAuth test", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    try {
      await page.getByRole("alert").filter({ hasText: "Server could not revoke all sessions" }).waitFor({ timeout: 15_000 });
    } catch (error) {
      throw new Error(`Rejected sign-out did not show its error: ${(await page.locator(".site-account").innerText()).slice(0, 800)}`, { cause: error });
    }
    await page.getByRole("button", { name: "Sign in with Discord", exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").filter({ hasText: "Server could not revoke all sessions" }).count(), 1,
      "server revocation failures must remain visible once the SDK clears the local session");
  }
  console.log("OAuth callback exchanges once and cleans up without a game dialog; failed server sign-out is shown once after local session cleanup.");
} finally {
  releaseExchange?.();
  await browser?.close();
  if (server) {
    const closed = new Promise((resolve) => server.httpServer.close(resolve));
    server.httpServer.closeAllConnections();
    await closed;
  }
  await rm(directory, { recursive: true, force: true });
}
