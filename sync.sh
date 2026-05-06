#!/bin/bash
# sync.sh — portable Claude Code config sync + RTK bootstrap
# Usage: ./sync.sh [--dry-run] [--no-rtk] [--force] [--remove-plugins]
#
# Flag semantics (orthogonal — combine as needed):
#   --force            wholesale-replace ~/.claude/settings.json with SSOT
#                      (default is additive merge; user-only keys preserved)
#   --remove-plugins   uninstall plugins / remove marketplaces NOT in SSOT
#                      (default is additive: drift is preserved)
#
# For a full reset to SSOT (settings AND plugins), pass both flags.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
DRY_RUN=0
SKIP_RTK=0
FORCE=0
REMOVE_PLUGINS=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)         DRY_RUN=1 ;;
    --no-rtk)          SKIP_RTK=1 ;;
    --force)           FORCE=1 ;;
    --remove-plugins)  REMOVE_PLUGINS=1 ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--no-rtk] [--force] [--remove-plugins]"
      echo ""
      echo "  --force           replace ~/.claude/settings.json with SSOT (default: merge)"
      echo "  --remove-plugins  uninstall plugins/marketplaces not in SSOT (default: keep)"
      echo "  --no-rtk          skip RTK bootstrap"
      echo "  --dry-run         preview without applying"
      exit 0 ;;
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
[ "$DRY_RUN" -eq 1 ] || mkdir -p "$CLAUDE_DIR"

# Skills, commands, and agents now ship via the docks plugin (DocksDocks/docks).
# Install on a new machine with:
#   /plugin marketplace add DocksDocks/docks
#   /plugin install docks@docks
# This kit syncs only settings.json, hooks, status-line scripts, and the CLAUDE.md.

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

# --- Sync hooks (additive; preserves RTK + any user-managed hooks) ---
if [ -d "$REPO_DIR/ssot/.claude/hooks" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] rsync -a $REPO_DIR/ssot/.claude/hooks/ $CLAUDE_DIR/hooks/"
  else
    mkdir -p "$CLAUDE_DIR/hooks"
    rsync -a "$REPO_DIR/ssot/.claude/hooks/" "$CLAUDE_DIR/hooks/"
    find "$CLAUDE_DIR/hooks" -maxdepth 1 -name '*.sh' -exec chmod +x {} +
    hook_count=$(ls "$CLAUDE_DIR/hooks/"*.sh 2>/dev/null | wc -l)
    log "Hooks synced ($hook_count scripts)"
  fi
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

# --- Reconcile plugin marketplaces + plugins via the claude CLI ---
# extraKnownMarketplaces declares marketplace sources, but Claude Code does NOT
# auto-clone them — the marketplace must be cloned to
# ~/.claude/plugins/marketplaces/<name>/ before plugins can install.
# Same for enabledPlugins: declaration alone is not enough; the plugin record
# must exist in ~/.claude/plugins/installed_plugins.json. Without this step,
# /reload-plugins reports "Plugin <X> not found in marketplace <Y>".
#
# Six idempotent passes via the `claude plugin` CLI:
#   1. Add SSOT marketplaces missing from disk
#   2. Install SSOT plugins missing from installed_plugins.json
#   3. Refresh marketplace manifests (`marketplace update`)
#   4. Update installed plugins to latest (`plugin update` — idempotent)
#   5. (--remove-plugins only) Uninstall plugins NOT in SSOT enabledPlugins
#   6. (--remove-plugins only) Remove marketplaces NOT in SSOT extraKnownMarketplaces
#      (built-in `claude-plugins-official` is never removed — Anthropic ships it)
#
# Why --remove-plugins is its own flag (not folded into --force):
# --force is about replacing settings.json wholesale; --remove-plugins is about
# reconciling the plugin layer. They're orthogonal — you might want to wipe a
# stale settings.json without nuking installed plugins, or vice versa. Combine
# with `./sync.sh --force --remove-plugins` for a full reset to SSOT.
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] bootstrap + update plugin marketplaces + plugins from SSOT"
  [ "$REMOVE_PLUGINS" -eq 1 ] && echo "[dry-run] (--remove-plugins) would also uninstall plugins not in SSOT and remove extra marketplaces"
elif command -v claude >/dev/null 2>&1; then
  KNOWN_MARKETPLACES="$CLAUDE_DIR/plugins/known_marketplaces.json"
  INSTALLED_PLUGINS="$CLAUDE_DIR/plugins/installed_plugins.json"
  added_mp=0
  added_pl=0
  updated_pl=0
  removed_pl=0
  removed_mp=0
  failed=0

  # 1. Add any extraKnownMarketplaces that aren't cloned yet.
  while IFS=$'\t' read -r mp_name mp_repo; do
    [ -z "$mp_name" ] && continue
    if [ -f "$KNOWN_MARKETPLACES" ] && jq -e --arg n "$mp_name" '.[$n]' "$KNOWN_MARKETPLACES" >/dev/null 2>&1; then
      continue
    fi
    if claude plugin marketplace add "$mp_repo" >/dev/null 2>&1; then
      added_mp=$((added_mp + 1))
    else
      warn "Failed to add marketplace: $mp_name ($mp_repo)"
      failed=$((failed + 1))
    fi
  done < <(jq -r '.extraKnownMarketplaces // {} | to_entries[] | "\(.key)\t\(.value.source.repo)"' "$REPO_SETTINGS")

  # 2. Install any enabledPlugins entry (true OR false) not yet installed.
  #    `false` means "keep installed but globally disabled" — the plugin must
  #    still be on disk so project-level settings.json can enable it per-project.
  while IFS= read -r plugin_id; do
    [ -z "$plugin_id" ] && continue
    if [ -f "$INSTALLED_PLUGINS" ] && jq -e --arg n "$plugin_id" '.plugins[$n] // empty' "$INSTALLED_PLUGINS" >/dev/null 2>&1; then
      continue
    fi
    if claude plugin install "$plugin_id" >/dev/null 2>&1; then
      added_pl=$((added_pl + 1))
    else
      warn "Failed to install plugin: $plugin_id"
      failed=$((failed + 1))
    fi
  done < <(jq -r '.enabledPlugins // {} | keys[]' "$REPO_SETTINGS")

  # 3. Refresh marketplace manifests so subsequent plugin updates see latest versions.
  claude plugin marketplace update >/dev/null 2>&1 || true

  # 4. Update each installed plugin (always; idempotent — `claude plugin update`
  #    silently no-ops when the plugin is already at latest).
  if [ -f "$INSTALLED_PLUGINS" ]; then
    while IFS= read -r plugin_id; do
      [ -z "$plugin_id" ] && continue
      out=$(claude plugin update "$plugin_id" 2>&1 || true)
      # "Successfully updated" only appears on actual upgrade — `already at the latest`
      # is the no-op path. Counts only real version changes.
      if echo "$out" | grep -q "Successfully updated"; then
        updated_pl=$((updated_pl + 1))
      fi
    done < <(jq -r '.plugins | keys[]' "$INSTALLED_PLUGINS")
  fi

  # 5. (--remove-plugins only) Uninstall plugins installed but NOT keyed in
  #    SSOT enabledPlugins at all. Plugins keyed as `false` are kept installed
  #    (globally disabled but available for per-project enable). Default sync
  #    is additive — drift preserved. Pass --remove-plugins to reconcile.
  if [ "$REMOVE_PLUGINS" -eq 1 ] && [ -f "$INSTALLED_PLUGINS" ]; then
    while IFS= read -r plugin_id; do
      [ -z "$plugin_id" ] && continue
      if ! jq -e --arg n "$plugin_id" '.enabledPlugins | has($n)' "$REPO_SETTINGS" >/dev/null 2>&1; then
        if claude plugin uninstall -y "$plugin_id" >/dev/null 2>&1; then
          removed_pl=$((removed_pl + 1))
        else
          warn "Failed to uninstall plugin: $plugin_id"
          failed=$((failed + 1))
        fi
      fi
    done < <(jq -r '.plugins | keys[]' "$INSTALLED_PLUGINS")
  fi

  # 6. (--remove-plugins only) Remove extraKnownMarketplaces not in SSOT.
  #    NEVER remove `claude-plugins-official` — Claude Code auto-installs it and
  #    re-removing each sync would just re-trigger Anthropic's bootstrap.
  if [ "$REMOVE_PLUGINS" -eq 1 ] && [ -f "$KNOWN_MARKETPLACES" ]; then
    while IFS= read -r mp_name; do
      [ -z "$mp_name" ] && continue
      [ "$mp_name" = "claude-plugins-official" ] && continue
      if ! jq -e --arg n "$mp_name" '.extraKnownMarketplaces[$n]' "$REPO_SETTINGS" >/dev/null 2>&1; then
        if claude plugin marketplace remove "$mp_name" >/dev/null 2>&1; then
          removed_mp=$((removed_mp + 1))
        else
          warn "Failed to remove marketplace: $mp_name"
          failed=$((failed + 1))
        fi
      fi
    done < <(jq -r '. | keys[]' "$KNOWN_MARKETPLACES")
  fi

  if [ "$added_mp" -gt 0 ] || [ "$added_pl" -gt 0 ] || [ "$updated_pl" -gt 0 ] || [ "$removed_pl" -gt 0 ] || [ "$removed_mp" -gt 0 ]; then
    log "Plugins synced (marketplaces: +$added_mp -$removed_mp, plugins: +$added_pl ~$updated_pl -$removed_pl)"
  else
    log "Plugins already in sync"
  fi
  [ "$failed" -gt 0 ] && warn "$failed plugin operation(s) failed — re-run sync or install manually"
else
  warn "claude CLI not in PATH — skipping plugin reconcile (run /plugin marketplace add + /plugin install manually)"
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
    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | bash
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
    if command -v rtk >/dev/null 2>&1; then
      log "RTK installed ($(rtk --version 2>/dev/null || echo 'version unknown'))"
    else
      err "RTK install failed. Install manually: https://github.com/rtk-ai/rtk"
    fi
  else
    installed_ver=$(rtk --version 2>/dev/null | awk '{print $2}')
    log "RTK already installed (rtk ${installed_ver:-unknown})"
    # Stale-check: warn if GitHub has a newer release. Soft-fail on network/rate-limit issues.
    latest_tag=$(curl -fsSL --max-time 5 "https://api.github.com/repos/rtk-ai/rtk/releases/latest" 2>/dev/null \
      | jq -r '.tag_name // empty' 2>/dev/null | sed 's/^v//' || true)
    if [ -n "$latest_tag" ] && [ -n "$installed_ver" ] && [ "$latest_tag" != "$installed_ver" ]; then
      newer=$(printf '%s\n%s\n' "$installed_ver" "$latest_tag" | sort -V | tail -n1)
      if [ "$newer" = "$latest_tag" ]; then
        warn "RTK $installed_ver is outdated (latest $latest_tag).
  Review:   https://github.com/rtk-ai/rtk/releases/tag/v$latest_tag (changelog + release author)
  Research: ask Claude to web-search 'rtk-ai/rtk v$latest_tag' for any compromise/CVE reports
  Install:  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | bash
  (RTK runs as a PreToolUse bash hook — supply-chain risk warrants review before upgrading)"
      fi
    fi
  fi

  if command -v rtk >/dev/null 2>&1; then
    # RTK 0.38.0 stopped generating ~/.claude/hooks/rtk-rewrite.sh in favor of
    # a direct `rtk hook claude` command in settings.json. Use ~/.claude/RTK.md
    # as the init sentinel (rtk init -g writes it).
    if [ ! -f "$CLAUDE_DIR/RTK.md" ]; then
      rtk init --global
      log "RTK initialized (RTK.md generated)"
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
  hook_count=$(ls "$CLAUDE_DIR/hooks/"*.sh 2>/dev/null | wc -l)
  echo "Hooks:    $hook_count scripts"
  if command -v rtk >/dev/null 2>&1; then
    echo "RTK:      $(rtk --version 2>/dev/null || echo 'installed')"
  else
    echo "RTK:      not installed"
  fi
  if command -v claude >/dev/null 2>&1; then
    plugin_count=$(jq -r '.plugins | keys | length' "$CLAUDE_DIR/plugins/installed_plugins.json" 2>/dev/null || echo 0)
    echo "Plugins:  $plugin_count installed (from SSOT enabledPlugins + Anthropic auto-installs)"
  fi
fi
echo ""
echo "In a Claude Code session, run /reload-plugins to pick up newly installed plugins."
echo "Restart Claude Code for hook/env-var changes to take effect."
