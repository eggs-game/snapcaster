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

export default defineConfig({
  plugins: [react(), enforceInitialBundleBudget(), excludeLocalMockData()],
});
