import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { rm } from "node:fs/promises";

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
  plugins: [react(), excludeLocalMockData()],
});
