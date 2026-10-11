#!/usr/bin/env node
import { readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createFourPlayerFixture } from "./fixtures/four_player_simulation.mjs";

const target = path.resolve(process.argv[2] || "public/mock-data.local.json");
if (path.basename(target) !== "mock-data.local.json") throw new Error("Simulation data must use the production-excluded mock-data.local.json filename.");
let base;
try {
  base = JSON.parse(await readFile(target, "utf8"));
  const backup = path.join(os.tmpdir(), `snapcast-mock-backup-${Date.now()}.json`);
  await copyFile(target, backup);
  process.stdout.write(`Preserved your previous fixture at ${backup}.\n`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  base = JSON.parse(await readFile("scripts/fixtures/accessibility-mock-data.json", "utf8"));
}
await writeFile(target, `${JSON.stringify(createFourPlayerFixture(base), null, 2)}\n`);
process.stdout.write(`Prepared ${target}. Open your loopback preview at /?code=TEST04 and join as a player.\n`);
process.stdout.write("Use a new tab or clear sessionStorage['snapcast-local-mock-state'] if an older fixture session is already loaded.\n");
