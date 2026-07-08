#!/bin/bash
set -euo pipefail

DRY_RUN=${DRY_RUN:-0}
SKIP_RTK=${SKIP_RTK:-0}
RECONCILE=${RECONCILE:-0}
PRUNE=${PRUNE:-0}
ASSUME_YES=${ASSUME_YES:-0}
CLAUDE_COMPACT_WINDOW=${CLAUDE_COMPACT_WINDOW:-}
CLAUDE_PERMISSIVE=${CLAUDE_PERMISSIVE:-0}
CLAUDE_PLUGINS=${CLAUDE_PLUGINS:-}
CLAUDE_MODEL=${CLAUDE_MODEL:-}
CODEX_MODEL=${CODEX_MODEL:-}
TARGET_FILTER_SET=${TARGET_FILTER_SET:-0}
SYNC_CLAUDE=${SYNC_CLAUDE:-0}
SYNC_CODEX=${SYNC_CODEX:-0}
SYNC_AGENTS=${SYNC_AGENTS:-0}
AGENTS_DIR="${AGENTS_DIR:-$HOME/.agents}"

# Opt-in plugins installable via --claude-plugin=<name> (space-separated).
KNOWN_CLAUDE_OPTIN_PLUGINS="supabase n8n"

log()  { printf "\033[1;32m[ok]\033[0m %s\n"   "$1" >&2; }
warn() { printf "\033[1;33m[warn]\033[0m %s\n" "$1" >&2; }
err()  { printf "\033[1;31m[err]\033[0m %s\n"  "$1" >&2; }

common::usage() {
  echo "Usage: $0 [claude] [codex] [agents] [flags]"
  echo ""
  echo "Targets (positional; default: all three)"
  echo "  claude            sync the Claude Code SoT"
  echo "  codex             sync the Codex SoT"
  echo "  agents            sync universal agent skills"
  echo ""
  echo "Global flags"
  echo "  --dry-run         preview without applying"
  echo "  --reconcile       reconcile kit-owned settings with SoT (SoT keys win; user-only keys preserved; permissions arrays replaced)"
  echo "  --prune           uninstall kit-managed installs not in SoT (plugins, marketplaces, skills in SoT/.agents/skills.txt)"
  echo "  --skip-rtk        skip optional tool bootstrap (RTK, bubblewrap)"
  echo "  --yes             auto-accept toolchain prompts (containers/CI)"
  echo ""
  echo "Deploy-time modifiers (deployed config only; SoT untouched; a later flag-less sync reverts)"
  echo "  --claude-model=<m>            set deployed ~/.claude/settings.json model (aliases: best|opus|fable|sonnet|haiku, full claude-* IDs, or 'default' to unset)"
  echo "  --claude-compact-window=<n>   set deployed autocompact window in tokens (e.g. 680000 or 680k) for disposable sessions"
  echo "  --claude-permissive           empty permissions.ask/deny in deployed settings (sandboxes/containers; unattended commits + pushes)"
  echo "  --codex-model=<m>             set deployed ~/.codex/config.toml model (e.g. gpt-5.5)"
  echo ""
  echo "Sticky opt-ins (installed + enabled until --prune)"
  echo "  --claude-plugin=<name>        opt an optional plugin into this machine (known: ${KNOWN_CLAUDE_OPTIN_PLUGINS// /, }; repeatable)"
}

common::select_target() {
  case "$1" in
    claude) SYNC_CLAUDE=1 ;;
    codex)  SYNC_CODEX=1 ;;
    agents) SYNC_AGENTS=1 ;;
    *)      err "Unknown sync target: $1"; exit 2 ;;
  esac
  TARGET_FILTER_SET=1
}

# Normalize a --claude-compact-window value to plain tokens: digits, or
# digits + k/K (x1000). Echoes the normalized number; returns 1 on junk.
common::parse_compact_window() {
  local v="$1"
  case "$v" in
    *[kK]) v="${v%[kK]}"; [[ "$v" =~ ^[0-9]+$ ]] || return 1; v=$((v * 1000)) ;;
    *)     [[ "$v" =~ ^[0-9]+$ ]] || return 1 ;;
  esac
  printf '%s' "$v"
}

common::add_claude_plugin() {
  local name="$1"
  case " $KNOWN_CLAUDE_OPTIN_PLUGINS " in
    *" $name "*) CLAUDE_PLUGINS="$CLAUDE_PLUGINS $name" ;;
    *) err "Unknown opt-in plugin '$name'. Known: ${KNOWN_CLAUDE_OPTIN_PLUGINS// /, }"; exit 2 ;;
  esac
}

common::claude_plugin_wanted() {
  case " $CLAUDE_PLUGINS " in
    *" $1 "*) return 0 ;;
    *)        return 1 ;;
  esac
}

# Emit the kit-verified model IDs for a tool, one per line, from SoT/models.json.
# Silent no-op when the manifest or jq is unavailable (validators then fall back
# to their pattern checks).
common::_models_from_manifest() {
  local tool="$1" manifest="$REPO_DIR/SoT/models.json"
  [[ -f "$manifest" ]] && command -v jq >/dev/null 2>&1 || return 0
  jq -r --arg t "$tool" '.[$t].models[]?.id // empty' "$manifest" 2>/dev/null
}

# Human-readable catalog listing (stderr) — used by the bare-flag helper and
# validation failures so the user sees valid values without leaving the terminal.
common::print_models() {
  local tool="$1" manifest="$REPO_DIR/SoT/models.json" verified
  if [[ ! -f "$manifest" ]] || ! command -v jq >/dev/null 2>&1; then
    warn "Model catalog unavailable ($manifest)"
    return 0
  fi
  verified=$(jq -r --arg t "$tool" '.[$t].verified // "?"' "$manifest")
  {
    echo "Available $tool models (kit-verified $verified — SoT/models.json):"
    jq -r --arg t "$tool" '.[$t].models[]? | "  \(.id)\(if .note then "  — \(.note)" else "" end)"' "$manifest"
    case "$tool" in
      claude) echo "  (full claude-* model IDs outside the catalog are accepted with a warning)" ;;
      codex)  echo "  (well-formed IDs outside the catalog are accepted with a warning)" ;;
    esac
  } >&2
}

# Catalog match, or any full claude-* ID (warned — new models outrun the catalog).
common::_validate_claude_model() {
  local m="$1"
  [[ -n "$m" ]] || return 1
  if common::_models_from_manifest claude | grep -qx -- "$m"; then
    return 0
  fi
  case "$m" in
    claude-*)
      warn "Claude model '$m' is not in the kit-verified catalog (SoT/models.json) — applying anyway"
      return 0 ;;
    *) return 1 ;;
  esac
}

# Charset check is the hard gate (also blocks TOML-quote injection — the value
# is interpolated into a quoted config.toml string); catalog miss only warns.
common::_validate_codex_model() {
  local m="$1"
  [[ "$m" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  if ! common::_models_from_manifest codex | grep -qx -- "$m"; then
    warn "Codex model '$m' is not in the kit-verified catalog (SoT/models.json) — applying anyway (check ~/.codex/config.toml if Codex rejects it)"
  fi
  return 0
}

# Fail-fast gate: runs after parse+preflight, BEFORE any sync step mutates
# state, so a bad model value can never abort a half-finished sync.
common::validate_model_flags() {
  if [[ -n "$CLAUDE_MODEL" ]]; then
    if [[ "$SYNC_CLAUDE" -eq 0 ]]; then
      warn "--claude-model ignored: claude target not selected"
      CLAUDE_MODEL=""
    elif ! common::_validate_claude_model "$CLAUDE_MODEL"; then
      common::print_models claude
      err "Invalid Claude model '$CLAUDE_MODEL' — use an alias above or a full claude-* ID"
      exit 2
    fi
  fi
  if [[ -n "$CODEX_MODEL" ]]; then
    if [[ "$SYNC_CODEX" -eq 0 ]]; then
      warn "--codex-model ignored: codex target not selected"
      CODEX_MODEL=""
    elif ! common::_validate_codex_model "$CODEX_MODEL"; then
      common::print_models codex
      err "Invalid Codex model '$CODEX_MODEL' — must match ^[A-Za-z0-9._-]+\$"
      exit 2
    fi
  fi
}

common::parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      claude|codex|agents)  common::select_target "$arg" ;;
      --dry-run)            DRY_RUN=1 ;;
      --skip-rtk)           SKIP_RTK=1 ;;
      --reconcile)          RECONCILE=1 ;;
      --prune)              PRUNE=1 ;;
      --yes)                ASSUME_YES=1 ;;
      --claude-model=*)     CLAUDE_MODEL="${arg#*=}" ;;
      --codex-model=*)      CODEX_MODEL="${arg#*=}" ;;
      --claude-model)
        common::print_models claude
        err "--claude-model requires a value: --claude-model=<model>"
        exit 2 ;;
      --codex-model)
        common::print_models codex
        err "--codex-model requires a value: --codex-model=<model>"
        exit 2 ;;
      --claude-compact-window=*)
        CLAUDE_COMPACT_WINDOW="$(common::parse_compact_window "${arg#*=}")" \
          || { err "--claude-compact-window expects a token count (e.g. 680000 or 680k)"; exit 2; } ;;
      --claude-compact-window)
        err "--claude-compact-window requires a value: --claude-compact-window=<tokens> (e.g. 680k)"
        exit 2 ;;
      --claude-permissive)  CLAUDE_PERMISSIVE=1 ;;
      --claude-plugin=*)    common::add_claude_plugin "${arg#*=}" ;;
      --claude-plugin)
        err "--claude-plugin requires a value: --claude-plugin=<${KNOWN_CLAUDE_OPTIN_PLUGINS// /|}>"
        exit 2 ;;
      # Renamed legacy flags: hint and refuse (clean break, no compat behavior).
      --claude|--codex|--agents)
        err "${arg} was renamed: pass the target as a word, e.g. 'sync ${arg#--}'"; exit 2 ;;
      --force)              err "--force was renamed to --reconcile"; exit 2 ;;
      --remove-plugins)     err "--remove-plugins was renamed to --prune (it also removes marketplaces + kit-managed skills)"; exit 2 ;;
      --680k)               err "--680k was renamed to --claude-compact-window=680k"; exit 2 ;;
      --permissive)         err "--permissive was renamed to --claude-permissive"; exit 2 ;;
      --supabase)           err "--supabase was renamed to --claude-plugin=supabase"; exit 2 ;;
      --n8n)                err "--n8n was renamed to --claude-plugin=n8n"; exit 2 ;;
      --no-rtk)             err "--no-rtk was renamed to --skip-rtk"; exit 2 ;;
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
