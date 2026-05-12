#!/bin/bash
set -euo pipefail

DRY_RUN=${DRY_RUN:-0}
SKIP_OPTIONAL_BOOTSTRAP=${SKIP_OPTIONAL_BOOTSTRAP:-0}
FORCE=${FORCE:-0}
REMOVE_PLUGINS=${REMOVE_PLUGINS:-0}

log()  { printf "\033[1;32m[ok]\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33m[warn]\033[0m %s\n" "$1"; }
err()  { printf "\033[1;31m[err]\033[0m %s\n" "$1" >&2; }

common::usage() {
  echo "Usage: $0 [--dry-run] [--no-rtk] [--force] [--remove-plugins]"
  echo ""
  echo "  --force           replace tool settings with SoT where supported"
  echo "  --remove-plugins  uninstall/remove plugin layer entries not in SoT where supported"
  echo "  --no-rtk          skip optional tool bootstrap"
  echo "  --dry-run         preview without applying"
}

common::parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --dry-run)         DRY_RUN=1 ;;
      --no-rtk)          SKIP_OPTIONAL_BOOTSTRAP=1 ;;
      --force)           FORCE=1 ;;
      --remove-plugins)  REMOVE_PLUGINS=1 ;;
      -h|--help)
        common::usage
        exit 0 ;;
      *) err "Unknown arg: $arg"; exit 2 ;;
    esac
  done
}

common::preflight() {
  command -v jq >/dev/null 2>&1 || { err "jq is required. Install: sudo apt install -y jq (or brew install jq)"; exit 1; }
  command -v curl >/dev/null 2>&1 || { err "curl is required."; exit 1; }
}
