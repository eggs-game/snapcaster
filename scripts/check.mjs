#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const python = process.env.SNAPCAST_PYTHON || "python3";
const checks = [
  [node, "scripts/test_build_output_isolation.mjs"],
  [node, "scripts/test_metadata_evidence.mjs"],
  [node, "scripts/test_video_quality.mjs"],
  [node, "scripts/test_card_search_cache.mjs"],
  [node, "scripts/test_deck_import.mjs"],
  [node, "scripts/test_deck_analysis.mjs"],
  [node, "scripts/test_auth_intent.mjs"],
  [node, "scripts/test_account_origins.mjs"],
  [node, "scripts/test_production_decks_check.mjs"],
  [node, "scripts/test_anonymous_retention.mjs"],
  [node, "scripts/test_realtime_epoch_rotation.mjs"],
  [node, "scripts/test_game_rejoin_contract.mjs"],
  [node, "scripts/test_game_controls.mjs"],
  [node, "scripts/test_local_commander_selection.mjs"],
  [node, "scripts/test_game_connection_reset.mjs"],
  [node, "scripts/test_video_counter_contrast.mjs"],
  [node, "scripts/test_card_presentation.mjs"],
  [node, "scripts/test_chat_commands.mjs"],
  [node, "scripts/test_local_game_simulation.mjs"],
  [node, "scripts/test_recognition_hints.mjs"],
  [node, "scripts/test_recognition_queue.mjs"],
  [node, "scripts/test_ai_crop.mjs"],
  [node, "scripts/test_milo_lookup.mjs"],
  [node, "scripts/test_milo_parallel.mjs"],
  [node, "scripts/test_photo_matching.mjs"],
  [node, "scripts/test_edge_isolation.mjs"],
  [node, "scripts/test_photo_release_gate.mjs"],
  [node, "scripts/test_reference_wait.mjs"],
  [node, "scripts/test_reference_features.mjs"],
  [node, "scripts/test_click_matching.mjs"],
  [node, "scripts/test_hash_distance.mjs"],
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
