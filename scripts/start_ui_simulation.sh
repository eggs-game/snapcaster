#!/usr/bin/env bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_NODE="${SNAPCAST_NODE:-$(command -v node || true)}"
if [[ ! -x "$TASK_NODE" ]]; then
  TASK_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$TASK_NODE" ]]; then
  echo "Node is unavailable. Set SNAPCAST_NODE to your Node executable." >&2
  exit 1
fi
if [[ ! -f "$TASK_ROOT/node_modules/vite/bin/vite.js" ]]; then
  echo "Workspace dependencies are unavailable. Install them before starting practice." >&2
  exit 1
fi

cd "$TASK_ROOT"
"$TASK_NODE" scripts/prepare_ui_simulation.mjs
echo "Practice table: http://127.0.0.1:${SNAPCAST_UI_PORT:-5184}/?code=TEST04"
exec "$TASK_NODE" node_modules/vite/bin/vite.js --host 127.0.0.1 --port "${SNAPCAST_UI_PORT:-5184}" --strictPort
