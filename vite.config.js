import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { rm } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const INITIAL_JS_GZIP_BUDGET = 80 * 1024;

function enforceInitialBundleBudget() {
  return {
    name: "enforce-initial-bundle-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((output) => output.type === "chunk" && output.isEntry);
      if (!entry) this.error("Could not find the application entry chunk.");
      const gzipBytes = gzipSync(entry.code).byteLength;
      if (gzipBytes > INITIAL_JS_GZIP_BUDGET) {
        this.error(
          `Initial JavaScript is ${(gzipBytes / 1024).toFixed(1)} KiB gzip; `
          + `the budget is ${INITIAL_JS_GZIP_BUDGET / 1024} KiB. Check for a static import `
          + "that collapsed an account, multiplayer, recognition, or route boundary.",
        );
      }
    },
  };
}

function excludeLocalMockData() {
  return {
    name: "exclude-local-mock-data",
    apply: "build",
    async closeBundle() {
      await rm(new URL("./dist/mock-data.local.json", import.meta.url), { force: true });
    },
  };
}

function localDeckProviderProxy() {
  return {
    name: "local-deck-provider-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__deck-provider")) return next();
        try {
          const requestUrl = new URL(req.url, "http://localhost");
          const provider = requestUrl.searchParams.get("provider");
          const id = requestUrl.searchParams.get("id") || "";
          const endpoint = provider === "archidekt" && /^\d{1,12}$/.test(id)
            ? `https://archidekt.com/api/decks/${encodeURIComponent(id)}/`
            : null;
          if (!endpoint) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid provider request" }));
            return;
          }
          const response = await fetch(endpoint, {
            headers: { Accept: "application/json", "User-Agent": "Snapcast local development" },
          });
          const body = await response.text();
          res.statusCode = response.status;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(body.slice(0, 3_000_000));
        } catch (error) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(error?.message || "Provider request failed") }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localDeckProviderProxy(), enforceInitialBundleBudget(), excludeLocalMockData()],
});
