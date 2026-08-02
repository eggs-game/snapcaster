#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const python = process.env.SNAPCAST_PYTHON || "python3";
const checks = [
  [node, "scripts/test_metadata_evidence.mjs"],
  [node, "scripts/test_video_quality.mjs"],
  [node, "scripts/test_card_search_cache.mjs"],
  [node, "scripts/test_deck_import.mjs"],
  [node, "scripts/test_recognition_hints.mjs"],
  [node, "scripts/test_recognition_queue.mjs"],
  [python, "scripts/check_hash_duplication.py"],
  [python, "scripts/test_account_security.py"],
];

for (const [command, ...args] of checks) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv.includes("--build")) {
  const { build } = await import("vite");
  await build({ root });
}
