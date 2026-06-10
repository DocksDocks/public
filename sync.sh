#!/bin/bash
# sync.sh — portable AI coding agent config sync
# Usage: ./sync.sh [--dry-run] [--no-rtk] [--force] [--remove-plugins] [--fable] [--permissive] [--claude] [--codex] [--agents]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=lib/common.sh
source "$REPO_DIR/lib/common.sh"

common::parse_args "$@"
common::preflight

if [[ "$SYNC_CLAUDE" -eq 1 && -d "$REPO_DIR/SoT/.claude" ]]; then
  # shellcheck source=lib/claude.sh
  source "$REPO_DIR/lib/claude.sh"
  claude::sync
fi

if [[ "$SYNC_CODEX" -eq 1 && -d "$REPO_DIR/SoT/.codex" ]]; then
  # shellcheck source=lib/codex.sh
  source "$REPO_DIR/lib/codex.sh"
  codex::sync
fi

if [[ "$SYNC_AGENTS" -eq 1 && -d "$REPO_DIR/SoT/.agents" ]]; then
  # shellcheck source=lib/skills.sh
  source "$REPO_DIR/lib/skills.sh"
  skills::sync
fi

echo ""
echo "--- Sync complete ---"
echo "Repo:     $REPO_DIR"
if declare -F claude::summary >/dev/null 2>&1; then
  claude::summary
fi
if declare -F codex::summary >/dev/null 2>&1; then
  codex::summary
fi
if declare -F skills::summary >/dev/null 2>&1; then
  skills::summary
fi

echo ""
if declare -F claude::next_steps >/dev/null 2>&1; then
  claude::next_steps
fi
if declare -F codex::next_steps >/dev/null 2>&1; then
  codex::next_steps
fi
if declare -F skills::next_steps >/dev/null 2>&1; then
  skills::next_steps
fi
