#!/bin/bash
set -euo pipefail

DRY_RUN=${DRY_RUN:-0}
SKIP_OPTIONAL_BOOTSTRAP=${SKIP_OPTIONAL_BOOTSTRAP:-0}
FORCE=${FORCE:-0}
REMOVE_PLUGINS=${REMOVE_PLUGINS:-0}
TARGET_FILTER_SET=${TARGET_FILTER_SET:-0}
SYNC_CLAUDE=${SYNC_CLAUDE:-0}
SYNC_CODEX=${SYNC_CODEX:-0}
SYNC_AGENTS=${SYNC_AGENTS:-0}
AGENTS_DIR="${AGENTS_DIR:-$HOME/.agents}"

log()  { printf "\033[1;32m[ok]\033[0m %s\n"   "$1" >&2; }
warn() { printf "\033[1;33m[warn]\033[0m %s\n" "$1" >&2; }
err()  { printf "\033[1;31m[err]\033[0m %s\n"  "$1" >&2; }

common::usage() {
  echo "Usage: $0 [--dry-run] [--no-rtk] [--force] [--remove-plugins] [--claude] [--codex] [--agents]"
  echo ""
  echo "  --claude          sync only Claude Code SoT (can be combined with other target flags)"
  echo "  --codex           sync only Codex SoT (can be combined with other target flags)"
  echo "  --agents          sync only universal agent skills (can be combined with other target flags)"
  echo "  --force           reconcile kit-owned settings with SoT (SoT-declared keys win; user-only keys preserved; permissions arrays replaced)"
  echo "  --remove-plugins  uninstall kit-managed installs not in SoT (plugins, marketplaces, skills declared in SoT/.agents/skills.txt)"
  echo "  --no-rtk          skip optional tool bootstrap"
  echo "  --dry-run         preview without applying"
}

common::select_target() {
  TARGET_FILTER_SET=1
  case "$1" in
    claude) SYNC_CLAUDE=1 ;;
    codex)  SYNC_CODEX=1 ;;
    agents) SYNC_AGENTS=1 ;;
  esac
}

common::parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --dry-run)         DRY_RUN=1 ;;
      --no-rtk)          SKIP_OPTIONAL_BOOTSTRAP=1 ;;
      --force)           FORCE=1 ;;
      --remove-plugins)  REMOVE_PLUGINS=1 ;;
      --claude)          common::select_target claude ;;
      --codex)           common::select_target codex ;;
      --agents)          common::select_target agents ;;
      -h|--help)
        common::usage
        exit 0 ;;
      *) err "Unknown arg: $arg"; exit 2 ;;
    esac
  done

  if [[ "$TARGET_FILTER_SET" -eq 0 ]]; then
    SYNC_CLAUDE=1
    SYNC_CODEX=1
    SYNC_AGENTS=1
  fi
}

common::preflight() {
  if [[ "$SYNC_CLAUDE" -eq 1 || "$SYNC_CODEX" -eq 1 ]]; then
    command -v jq >/dev/null 2>&1 || { err "jq is required. Install: sudo apt install -y jq (or brew install jq)"; exit 1; }
  fi
  if [[ "$SYNC_CLAUDE" -eq 1 ]]; then
    command -v curl >/dev/null 2>&1 || { err "curl is required."; exit 1; }
  fi
}
