#!/bin/bash
# sync.sh — portable Claude Code config sync + RTK bootstrap
# Usage: ./sync.sh [--dry-run] [--no-rtk] [--force]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
DRY_RUN=0
SKIP_RTK=0
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --no-rtk)    SKIP_RTK=1 ;;
    --force)     FORCE=1 ;;
    -h|--help)   echo "Usage: $0 [--dry-run] [--no-rtk] [--force]"; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf "\033[1;32m[ok]\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33m[warn]\033[0m %s\n" "$1"; }
err()  { printf "\033[1;31m[err]\033[0m %s\n" "$1" >&2; }

# --- Pre-flight ---
command -v jq   >/dev/null 2>&1 || { err "jq is required. Install: sudo apt install -y jq (or brew install jq)"; exit 1; }
command -v curl >/dev/null 2>&1 || { err "curl is required."; exit 1; }
[ -d "$REPO_DIR/ssot/.claude" ] || { err "Cannot find ssot/.claude/ in $REPO_DIR"; exit 1; }
[ "$DRY_RUN" -eq 1 ] || mkdir -p "$CLAUDE_DIR/commands"

# --- Sync commands (additive, never delete) ---
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] rsync -a $REPO_DIR/ssot/.claude/commands/ $CLAUDE_DIR/commands/"
else
  rsync -a "$REPO_DIR/ssot/.claude/commands/" "$CLAUDE_DIR/commands/"
  count=$(ls "$CLAUDE_DIR/commands/"*.md 2>/dev/null | wc -l)
  log "Commands synced ($count files)"
fi

# --- Sync skills (additive, never delete) ---
if [ -d "$REPO_DIR/ssot/.claude/skills" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] rsync -a $REPO_DIR/ssot/.claude/skills/ $CLAUDE_DIR/skills/"
  else
    mkdir -p "$CLAUDE_DIR/skills"
    rsync -a "$REPO_DIR/ssot/.claude/skills/" "$CLAUDE_DIR/skills/"
    skill_count=$(find "$CLAUDE_DIR/skills" -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l)
    log "Skills synced ($skill_count skills)"
  fi
fi

# --- Sync scripts + alert sound ---
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] cp statusline.sh, fetch-usage.sh, alert_bubble.mp3"
else
  cp "$REPO_DIR/ssot/.claude/statusline.sh"  "$CLAUDE_DIR/"
  cp "$REPO_DIR/ssot/.claude/fetch-usage.sh" "$CLAUDE_DIR/"
  chmod +x "$CLAUDE_DIR/statusline.sh" "$CLAUDE_DIR/fetch-usage.sh"
  [ -f "$REPO_DIR/alert_bubble.mp3" ] && cp "$REPO_DIR/alert_bubble.mp3" "$CLAUDE_DIR/"
  log "Scripts synced (statusline, fetch-usage, alert)"
fi

# --- Sync CLAUDE.md (project coding conventions) ---
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] cp ssot/.claude/CLAUDE.md -> ~/.claude/CLAUDE.md"
else
  cp "$REPO_DIR/ssot/.claude/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
  log "CLAUDE.md synced"
fi

# --- Merge settings.json ---
REPO_SETTINGS="$REPO_DIR/ssot/.claude/settings.json"
USER_SETTINGS="$CLAUDE_DIR/settings.json"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] merge $REPO_SETTINGS -> $USER_SETTINGS"
elif [ ! -f "$USER_SETTINGS" ] || [ "$FORCE" -eq 1 ]; then
  [ -f "$USER_SETTINGS" ] && cp "$USER_SETTINGS" "$USER_SETTINGS.bak"
  cp "$REPO_SETTINGS" "$USER_SETTINGS"
  if [ -f "$USER_SETTINGS.bak" ]; then
    log "Settings replaced (backup at settings.json.bak)"
  else
    log "Settings installed"
  fi
else
  cp "$USER_SETTINGS" "$USER_SETTINGS.bak"
  # jq `*` recursively merges objects but REPLACES arrays entirely.
  # We apply `$user * $repo` so repo values override user for scalar/object keys,
  # then explicitly concat + dedupe permissions arrays so user-added permissions
  # are preserved.
  jq -s '
    .[0] as $repo | .[1] as $user |
    ($user * $repo) |
    .permissions.allow = (($user.permissions.allow // []) + ($repo.permissions.allow // []) | unique) |
    .permissions.deny  = (($user.permissions.deny  // []) + ($repo.permissions.deny  // []) | unique) |
    .permissions.ask   = (($user.permissions.ask   // []) + ($repo.permissions.ask   // []) | unique)
  ' "$REPO_SETTINGS" "$USER_SETTINGS" > "$USER_SETTINGS.tmp" \
    && mv "$USER_SETTINGS.tmp" "$USER_SETTINGS"
  log "Settings merged (backup at settings.json.bak)"
fi

# --- Write ~/.claude.json (separate schema; settings.json rejects showTurnDuration) ---
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] set showTurnDuration=true in ~/.claude.json"
else
  CLAUDE_JSON="$HOME/.claude.json"
  if [ -f "$CLAUDE_JSON" ]; then
    jq '.showTurnDuration = true' "$CLAUDE_JSON" > "$CLAUDE_JSON.tmp" \
      && mv "$CLAUDE_JSON.tmp" "$CLAUDE_JSON"
  else
    echo '{"showTurnDuration": true}' > "$CLAUDE_JSON"
  fi
  log "~/.claude.json updated (showTurnDuration)"
fi

# --- RTK bootstrap ---
if [ "$SKIP_RTK" -eq 1 ]; then
  warn "Skipping RTK (--no-rtk)"
  # Remove @RTK.md import since RTK won't be available
  if [ "$DRY_RUN" -eq 0 ] && [ -f "$CLAUDE_DIR/CLAUDE.md" ]; then
    if grep -q '^@RTK\.md$' "$CLAUDE_DIR/CLAUDE.md" 2>/dev/null; then
      # Portable in-place delete (macOS + Linux sed differ on -i)
      tmp="$CLAUDE_DIR/CLAUDE.md.tmp"
      grep -v '^@RTK\.md$' "$CLAUDE_DIR/CLAUDE.md" > "$tmp" && mv "$tmp" "$CLAUDE_DIR/CLAUDE.md"
      log "Stripped @RTK.md import from CLAUDE.md"
    fi
  fi
elif [ "$DRY_RUN" -eq 1 ]; then
  command -v rtk >/dev/null 2>&1 && echo "[dry-run] rtk already installed" || echo "[dry-run] would install RTK"
else
  if ! command -v rtk >/dev/null 2>&1; then
    warn "RTK not found. Installing..."
    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
    if command -v rtk >/dev/null 2>&1; then
      log "RTK installed ($(rtk --version 2>/dev/null || echo 'version unknown'))"
    else
      err "RTK install failed. Install manually: https://github.com/rtk-ai/rtk"
    fi
  else
    log "RTK already installed ($(rtk --version 2>/dev/null || echo 'version unknown'))"
  fi

  if command -v rtk >/dev/null 2>&1; then
    if [ ! -f "$CLAUDE_DIR/hooks/rtk-rewrite.sh" ]; then
      rtk init --global
      log "RTK initialized (hook + RTK.md generated)"
    else
      log "RTK already initialized"
    fi
  fi
fi

# --- Summary ---
echo ""
echo "--- Sync complete ---"
echo "Repo:     $REPO_DIR"
echo "Target:   $CLAUDE_DIR"
if [ "$DRY_RUN" -eq 0 ]; then
  count=$(ls "$CLAUDE_DIR/commands/"*.md 2>/dev/null | wc -l)
  echo "Commands: $count files"
  skill_count=$(find "$CLAUDE_DIR/skills" -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l)
  echo "Skills:   $skill_count skills"
  if command -v rtk >/dev/null 2>&1; then
    echo "RTK:      $(rtk --version 2>/dev/null || echo 'installed')"
  else
    echo "RTK:      not installed"
  fi
fi
echo ""
echo "Restart Claude Code for changes to take effect."
