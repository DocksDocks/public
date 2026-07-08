#!/bin/bash
# engine.sh — the docks-kit bash engine (zero-dependency escape hatch).
# Canonical UX is the ./docks-kit CLI; this is the same engine it drives:
#   bash lib/engine.sh sync [claude] [codex] [agents] [flags]   # full sync
#   bash lib/engine.sh model <claude|codex> [value] [--dry-run] # get/set deployed model
#   bash lib/engine.sh toolchain check                          # doctor table
#   bash lib/engine.sh toolchain ensure <tool> [--yes]          # install/upgrade one tool
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=lib/common.sh
source "$REPO_DIR/lib/common.sh"
# shellcheck source=lib/toolchain.sh
source "$REPO_DIR/lib/toolchain.sh"

engine::sync() {
  common::parse_args "$@"
  common::preflight
  common::validate_model_flags

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
}

# Direct mode: get/set the DEPLOYED model for one tool without a full sync.
# Set path reuses the deploy-time modifier functions (claude::sync_model /
# codex::sync_model) so `docks-kit model claude opus` and
# `docks-kit sync claude --claude-model=opus` share one implementation.
engine::model() {
  local tool="" value="" arg
  for arg in "$@"; do
    case "$arg" in
      --dry-run)     DRY_RUN=1 ;;
      claude|codex)  tool="$arg" ;;
      -*)            err "Unknown flag for model: $arg"; exit 2 ;;
      *)             value="$arg" ;;
    esac
  done
  [[ -n "$tool" ]] || { err "Usage: model <claude|codex> [value] [--dry-run]"; exit 2; }

  if [[ -z "$value" ]]; then
    case "$tool" in
      claude)
        [[ -f "$HOME/.claude/settings.json" ]] || { warn "~/.claude/settings.json missing"; return; }
        echo "deployed: $(jq -r '.model // "default (unset)"' "$HOME/.claude/settings.json")"
        echo "SoT:      $(jq -r '.model // "default (unset)"' "$REPO_DIR/SoT/.claude/settings.json")" ;;
      codex)
        [[ -f "$HOME/.codex/config.toml" ]] || { warn "~/.codex/config.toml missing"; return; }
        echo "deployed: $(awk -F'"' '/^model[[:space:]]*=/{print $2; exit}' "$HOME/.codex/config.toml")"
        echo "SoT:      $(awk -F'"' '/^model[[:space:]]*=/{print $2; exit}' "$REPO_DIR/SoT/.codex/config.toml")" ;;
    esac
    common::print_models "$tool"
    return
  fi

  case "$tool" in
    claude)
      common::_validate_claude_model "$value" \
        || { common::print_models claude; err "Invalid Claude model '$value'"; exit 2; }
      CLAUDE_MODEL="$value"
      # shellcheck source=lib/claude.sh
      source "$REPO_DIR/lib/claude.sh"
      claude::sync_model ;;
    codex)
      common::_validate_codex_model "$value" \
        || { common::print_models codex; err "Invalid Codex model '$value'"; exit 2; }
      CODEX_MODEL="$value"
      # shellcheck source=lib/codex.sh
      source "$REPO_DIR/lib/codex.sh"
      codex::sync_model ;;
  esac
}

# Direct mode: toolchain doctor / single-tool ensure.
engine::toolchain() {
  local op="${1:-check}" tool="${2:-}" arg
  for arg in "$@"; do
    [[ "$arg" == "--yes" ]] && ASSUME_YES=1
  done

  case "$op" in
    check) toolchain::report ;;
    ensure)
      [[ -n "$tool" && "$tool" != "--yes" ]] || { err "Usage: toolchain ensure <tool> [--yes]"; exit 2; }
      case "$tool" in
        rtk)
          # shellcheck source=lib/claude.sh
          source "$REPO_DIR/lib/claude.sh"
          toolchain::ensure rtk claude::_rtk_install ;;
        bun)
          # shellcheck source=lib/skills.sh
          source "$REPO_DIR/lib/skills.sh"
          skills::_bun_bootstrap >/dev/null ;;
        effect-solutions)
          # shellcheck source=lib/skills.sh
          source "$REPO_DIR/lib/skills.sh"
          toolchain::ensure effect-solutions skills::_effect_solutions_install ;;
        agent-browser)
          # shellcheck source=lib/skills.sh
          source "$REPO_DIR/lib/skills.sh"
          toolchain::ensure agent-browser skills::_agent_browser_install ;;
        *) err "toolchain ensure supports managed tools only (rtk, bun, effect-solutions, agent-browser)"; exit 2 ;;
      esac ;;
    *) err "Usage: toolchain [check|ensure <tool>] [--yes]"; exit 2 ;;
  esac
}

case "${1:-}" in
  model)     shift; engine::model "$@" ;;
  toolchain) shift; engine::toolchain "$@" ;;
  sync)      shift; engine::sync "$@" ;;
  *)         engine::sync "$@" ;;
esac
