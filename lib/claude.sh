#!/bin/bash
set -euo pipefail

# Source-order guards: this lib depends on common.sh's log/warn/err and on
# sync.sh's REPO_DIR. Fail fast with a clear message if sourced standalone.
declare -F log >/dev/null 2>&1 || { printf '\033[1;31m[err]\033[0m %s\n' "lib/claude.sh must be sourced after lib/common.sh" >&2; exit 1; }
[[ -n "${REPO_DIR:-}" ]] || { printf '\033[1;31m[err]\033[0m %s\n' "REPO_DIR must be set before sourcing lib/claude.sh" >&2; exit 1; }

claude::sync() {
  CLAUDE_DIR="$HOME/.claude"
  CLAUDE_SYNCED=1

  if [[ "$DRY_RUN" -eq 0 ]]; then
    mkdir -p "$CLAUDE_DIR"
  fi

  claude::sync_scripts
  claude::sync_hooks
  claude::sync_claude_md
  claude::sync_settings
  claude::sync_claude_json
  claude::sync_plugins
  claude::sync_rtk
}

claude::sync_scripts() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] cp statusline.sh, fetch-usage.sh, alert_bubble.mp3"
    return
  fi

  cp "$REPO_DIR/SoT/.claude/statusline.sh" "$CLAUDE_DIR/"
  cp "$REPO_DIR/SoT/.claude/fetch-usage.sh" "$CLAUDE_DIR/"
  chmod +x "$CLAUDE_DIR/statusline.sh" "$CLAUDE_DIR/fetch-usage.sh"
  [[ -f "$REPO_DIR/alert_bubble.mp3" ]] && cp "$REPO_DIR/alert_bubble.mp3" "$CLAUDE_DIR/"
  log "Scripts synced (statusline, fetch-usage, alert)"
}

claude::sync_hooks() {
  local hook_count

  [[ -d "$REPO_DIR/SoT/.claude/hooks" ]] || return

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] rsync -a $REPO_DIR/SoT/.claude/hooks/ $CLAUDE_DIR/hooks/"
    return
  fi

  mkdir -p "$CLAUDE_DIR/hooks"
  rsync -a "$REPO_DIR/SoT/.claude/hooks/" "$CLAUDE_DIR/hooks/"
  find "$CLAUDE_DIR/hooks" -maxdepth 1 -name '*.sh' -exec chmod +x {} +
  hook_count=$(find "$CLAUDE_DIR/hooks" -maxdepth 1 -name '*.sh' 2>/dev/null | wc -l)
  log "Hooks synced ($hook_count scripts)"
}

claude::sync_claude_md() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] cp SoT/.claude/CLAUDE.md -> ~/.claude/CLAUDE.md"
    return
  fi

  cp "$REPO_DIR/SoT/.claude/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
  log "CLAUDE.md synced"
}

# Validate that the existing user settings file is parseable. Returns 0 if
# the file is missing (caller will install) or valid; 1 if invalid (caller
# returns early without touching the file).
claude::_settings_validate() {
  local user_settings="$1"
  [[ -f "$user_settings" ]] || return 0
  if ! jq empty "$user_settings" 2>/dev/null; then
    err "Skipping settings sync: $user_settings is not valid JSON. Fix it manually or delete it to reinstall."
    return 1
  fi
  return 0
}

# First-install path — no user settings exist yet, copy SoT verbatim.
claude::_settings_install() {
  local repo_settings="$1" user_settings="$2"
  cp "$repo_settings" "$user_settings"
  log "Settings installed"
}

# Force-reconcile path: SoT keys win, permissions arrays REPLACED wholesale by
# SoT (user-added permissions are discarded), user-only top-level keys survive.
claude::_settings_reconcile() {
  local repo_settings="$1" user_settings="$2"
  cp "$user_settings" "$user_settings.bak"
  if ! jq -s '.[0] as $repo | .[1] as $user | $user * $repo' \
       "$repo_settings" "$user_settings" > "$user_settings.tmp"; then
    rm -f "$user_settings.tmp"
    err "jq reconcile failed — settings unchanged (backup at settings.json.bak)"
    return
  fi
  mv "$user_settings.tmp" "$user_settings"
  log "Settings reconciled (backup at settings.json.bak; user-only keys preserved, permissions arrays replaced by SoT)"
}

# Default-merge path: SoT keys win, permissions.{allow,deny,ask} arrays UNIONED
# (user + repo, deduplicated), user-only top-level keys survive.
claude::_settings_merge() {
  local repo_settings="$1" user_settings="$2"
  cp "$user_settings" "$user_settings.bak"
  if ! jq -s '
    .[0] as $repo | .[1] as $user |
    ($user * $repo) |
    .permissions.allow = (($user.permissions.allow // []) + ($repo.permissions.allow // []) | unique) |
    .permissions.deny  = (($user.permissions.deny  // []) + ($repo.permissions.deny  // []) | unique) |
    .permissions.ask   = (($user.permissions.ask   // []) + ($repo.permissions.ask   // []) | unique)
  ' "$repo_settings" "$user_settings" > "$user_settings.tmp"; then
    rm -f "$user_settings.tmp"
    err "jq merge failed — settings unchanged (backup at settings.json.bak)"
    return
  fi
  mv "$user_settings.tmp" "$user_settings"
  log "Settings merged (backup at settings.json.bak)"
}

claude::sync_settings() {
  local repo_settings="$REPO_DIR/SoT/.claude/settings.json"
  local user_settings="$CLAUDE_DIR/settings.json"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    if [[ ! -f "$user_settings" ]]; then
      echo "[dry-run] install $repo_settings -> $user_settings"
    elif [[ "$FORCE" -eq 1 ]]; then
      echo "[dry-run] reconcile $repo_settings -> $user_settings (SoT keys win; permissions arrays replaced; user-only keys preserved)"
    else
      echo "[dry-run] merge $repo_settings -> $user_settings (SoT keys win; permissions arrays unioned; user-only keys preserved)"
    fi
    return
  fi

  claude::_settings_validate "$user_settings" || return

  if [[ ! -f "$user_settings" ]]; then
    claude::_settings_install "$repo_settings" "$user_settings"
  elif [[ "$FORCE" -eq 1 ]]; then
    claude::_settings_reconcile "$repo_settings" "$user_settings"
  else
    claude::_settings_merge "$repo_settings" "$user_settings"
  fi
}

claude::sync_claude_json() {
  local claude_json="$HOME/.claude.json"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] set showTurnDuration=true in ~/.claude.json"
    return
  fi

  if [[ -f "$claude_json" ]]; then
    if ! jq empty "$claude_json" 2>/dev/null; then
      err "Skipping ~/.claude.json edit: not valid JSON. Fix or delete it."
      return
    fi
    if ! jq '.showTurnDuration = true' "$claude_json" > "$claude_json.tmp"; then
      rm -f "$claude_json.tmp"
      err "jq edit of ~/.claude.json failed — file unchanged"
      return
    fi
    mv "$claude_json.tmp" "$claude_json"
  else
    echo '{"showTurnDuration": true}' > "$claude_json"
  fi
  log "~/.claude.json updated (showTurnDuration)"
}

# Thin facade around the `claude` CLI plugin pipeline. Centralizes the kit's
# coupling so renaming the CLI or changing the binary lookup is a one-place
# edit instead of touching 6 call sites across 5 plugin-pipeline helpers.
# `command` prefix avoids potential alias/function interference.
claude::_cli() {
  command claude "$@"
}

# Pass 1 — install any marketplace in SoT that is not yet known. Echoes
# "<added> <failed>" on stdout (bash 3.2-portable counter return; namerefs
# require bash 4.3+ and would break macOS /bin/bash).
claude::_plugins_add_marketplaces() {
  local repo_settings="$1" known_marketplaces="$2"
  local mp_name mp_repo added=0 failed=0

  while IFS=$'\t' read -r mp_name mp_repo; do
    [[ -z "$mp_name" ]] && continue
    if [[ -f "$known_marketplaces" ]] && jq -e --arg n "$mp_name" '.[$n]' "$known_marketplaces" >/dev/null 2>&1; then
      continue
    fi
    if claude::_cli plugin marketplace add "$mp_repo" >/dev/null 2>&1; then
      added=$((added + 1))
    else
      warn "Failed to add marketplace: $mp_name ($mp_repo)"
      failed=$((failed + 1))
    fi
  done < <(jq -r '.extraKnownMarketplaces // {} | to_entries[] | "\(.key)\t\(.value.source.repo)"' "$repo_settings")

  echo "$added $failed"
}

# Pass 2 — install any SoT-enabled plugin not yet installed.
claude::_plugins_install() {
  local repo_settings="$1" installed_plugins="$2"
  local plugin_id added=0 failed=0

  while IFS= read -r plugin_id; do
    [[ -z "$plugin_id" ]] && continue
    if [[ -f "$installed_plugins" ]] && jq -e --arg n "$plugin_id" '.plugins[$n] // empty' "$installed_plugins" >/dev/null 2>&1; then
      continue
    fi
    if claude::_cli plugin install "$plugin_id" >/dev/null 2>&1; then
      added=$((added + 1))
    else
      warn "Failed to install plugin: $plugin_id"
      failed=$((failed + 1))
    fi
  done < <(jq -r '.enabledPlugins // {} | keys[]' "$repo_settings")

  echo "$added $failed"
}

# Pass 3 — refresh every installed plugin. Failures are not counted (best
# effort); only the "Successfully updated" classification bumps the counter.
claude::_plugins_update() {
  local installed_plugins="$1"
  local plugin_id out updated=0

  claude::_cli plugin marketplace update >/dev/null 2>&1 || true

  if [[ -f "$installed_plugins" ]]; then
    while IFS= read -r plugin_id; do
      [[ -z "$plugin_id" ]] && continue
      out=$(claude::_cli plugin update "$plugin_id" 2>&1 || true)
      if [[ "$out" == *"Successfully updated"* ]]; then
        updated=$((updated + 1))
      fi
    done < <(jq -r '.plugins | keys[]' "$installed_plugins")
  fi

  echo "$updated 0"
}

# Pass 4 — uninstall any installed plugin no longer declared in SoT. Gated by
# REMOVE_PLUGINS by the caller; helper assumes it should run.
claude::_plugins_uninstall() {
  local repo_settings="$1" installed_plugins="$2"
  local plugin_id removed=0 failed=0

  if [[ -f "$installed_plugins" ]]; then
    while IFS= read -r plugin_id; do
      [[ -z "$plugin_id" ]] && continue
      if ! jq -e --arg n "$plugin_id" '.enabledPlugins | has($n)' "$repo_settings" >/dev/null 2>&1; then
        if claude::_cli plugin uninstall -y "$plugin_id" >/dev/null 2>&1; then
          removed=$((removed + 1))
        else
          warn "Failed to uninstall plugin: $plugin_id"
          failed=$((failed + 1))
        fi
      fi
    done < <(jq -r '.plugins | keys[]' "$installed_plugins")
  fi

  echo "$removed $failed"
}

# Pass 5 — remove any extra marketplace not declared in SoT.
# claude-plugins-official is built-in and never removed (protection contract).
claude::_plugins_remove_marketplaces() {
  local repo_settings="$1" known_marketplaces="$2"
  local mp_name removed=0 failed=0

  if [[ -f "$known_marketplaces" ]]; then
    while IFS= read -r mp_name; do
      [[ -z "$mp_name" ]] && continue
      [[ "$mp_name" == "claude-plugins-official" ]] && continue
      if ! jq -e --arg n "$mp_name" '.extraKnownMarketplaces[$n]' "$repo_settings" >/dev/null 2>&1; then
        if claude::_cli plugin marketplace remove "$mp_name" >/dev/null 2>&1; then
          removed=$((removed + 1))
        else
          warn "Failed to remove marketplace: $mp_name"
          failed=$((failed + 1))
        fi
      fi
    done < <(jq -r '. | keys[]' "$known_marketplaces")
  fi

  echo "$removed $failed"
}

claude::sync_plugins() {
  local repo_settings="$REPO_DIR/SoT/.claude/settings.json"
  local known_marketplaces="$CLAUDE_DIR/plugins/known_marketplaces.json"
  local installed_plugins="$CLAUDE_DIR/plugins/installed_plugins.json"
  local added_mp added_pl updated_pl removed_pl=0 removed_mp=0
  local f1 f2 f3 f4=0 f5=0 failed

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] bootstrap + update plugin marketplaces + plugins from SoT"
    if [[ "$REMOVE_PLUGINS" -eq 1 ]]; then
      echo "[dry-run] (--remove-plugins) would also uninstall plugins not in SoT and remove extra marketplaces"
    fi
    return
  fi

  if ! command -v claude >/dev/null 2>&1; then
    warn "claude CLI not in PATH — skipping plugin reconcile (run /plugin marketplace add + /plugin install manually)"
    return
  fi

  read -r added_mp f1 < <(claude::_plugins_add_marketplaces "$repo_settings" "$known_marketplaces")
  read -r added_pl f2 < <(claude::_plugins_install "$repo_settings" "$installed_plugins")
  read -r updated_pl f3 < <(claude::_plugins_update "$installed_plugins")
  if [[ "$REMOVE_PLUGINS" -eq 1 ]]; then
    read -r removed_pl f4 < <(claude::_plugins_uninstall "$repo_settings" "$installed_plugins")
    read -r removed_mp f5 < <(claude::_plugins_remove_marketplaces "$repo_settings" "$known_marketplaces")
  fi
  failed=$((f1 + f2 + f3 + f4 + f5))

  if [[ "$added_mp" -gt 0 || "$added_pl" -gt 0 || "$updated_pl" -gt 0 || "$removed_pl" -gt 0 || "$removed_mp" -gt 0 ]]; then
    log "Plugins synced (marketplaces: +$added_mp -$removed_mp, plugins: +$added_pl ~$updated_pl -$removed_pl)"
  else
    log "Plugins already in sync"
  fi
  if [[ "$failed" -gt 0 ]]; then
    warn "$failed plugin operation(s) failed — re-run sync or install manually"
  fi
}

# Fetch the latest published RTK release tag and warn the user if the locally
# installed version is older. Network call has a 5s ceiling; any failure
# silently drops the check (best-effort advisory, not a hard gate).
claude::_warn_rtk_outdated() {
  local installed_ver="$1" latest_tag newer

  latest_tag=$(curl -fsSL --max-time 5 "https://api.github.com/repos/rtk-ai/rtk/releases/latest" 2>/dev/null \
    | jq -r '.tag_name // empty' 2>/dev/null | sed 's/^v//' || true)
  [[ -n "$latest_tag" && -n "$installed_ver" && "$latest_tag" != "$installed_ver" ]] || return 0

  newer=$(printf '%s\n%s\n' "$installed_ver" "$latest_tag" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n1)
  [[ "$newer" == "$latest_tag" ]] || return 0

  warn "RTK $installed_ver is outdated (latest $latest_tag).
  Review:   https://github.com/rtk-ai/rtk/releases/tag/v$latest_tag (changelog + release author)
  Research: ask Claude to web-search 'rtk-ai/rtk v$latest_tag' for any compromise/CVE reports
  Install:  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh -o /tmp/rtk-install.sh && bash /tmp/rtk-install.sh && rm /tmp/rtk-install.sh
  (RTK runs as a PreToolUse bash hook — supply-chain risk warrants review before upgrading)"
}

claude::sync_rtk() {
  local tmp installed_ver tmp_rtk_installer

  if [[ "${SKIP_OPTIONAL_BOOTSTRAP:-0}" -eq 1 ]]; then
    warn "Skipping RTK (--no-rtk)"
    if [[ "$DRY_RUN" -eq 0 && -f "$CLAUDE_DIR/CLAUDE.md" ]] && grep -q '^@RTK\.md$' "$CLAUDE_DIR/CLAUDE.md" 2>/dev/null; then
      tmp="$CLAUDE_DIR/CLAUDE.md.tmp"
      grep -v '^@RTK\.md$' "$CLAUDE_DIR/CLAUDE.md" > "$tmp" && mv "$tmp" "$CLAUDE_DIR/CLAUDE.md"
      log "Stripped @RTK.md import from CLAUDE.md"
    fi
    return
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    command -v rtk >/dev/null 2>&1 && echo "[dry-run] rtk already installed" || echo "[dry-run] would install RTK"
    return
  fi

  if ! command -v rtk >/dev/null 2>&1; then
    warn "RTK not found. Installing..."
    tmp_rtk_installer=$(mktemp 2>/dev/null || echo "/tmp/rtk-install-$$.sh")
    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh -o "$tmp_rtk_installer" && bash "$tmp_rtk_installer"
    rm -f "$tmp_rtk_installer"
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
    if command -v rtk >/dev/null 2>&1; then
      log "RTK installed ($(rtk --version 2>/dev/null || echo 'version unknown'))"
    else
      err "RTK install failed. Install manually: https://github.com/rtk-ai/rtk"
    fi
  else
    installed_ver=$(rtk --version 2>/dev/null | awk '{print $2}')
    log "RTK already installed (rtk ${installed_ver:-unknown})"
    claude::_warn_rtk_outdated "$installed_ver"
  fi

  if command -v rtk >/dev/null 2>&1; then
    if [[ ! -f "$CLAUDE_DIR/RTK.md" ]]; then
      rtk init --global
      log "RTK initialized (RTK.md generated)"
    else
      log "RTK already initialized"
    fi
  fi
}

claude::summary() {
  local hook_count plugin_count

  [[ "${CLAUDE_SYNCED:-0}" -eq 1 ]] || return
  echo "Claude:   ${CLAUDE_DIR:-$HOME/.claude}"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    hook_count=$(find "${CLAUDE_DIR:-$HOME/.claude}/hooks" -maxdepth 1 -name '*.sh' 2>/dev/null | wc -l)
    echo "Hooks:    $hook_count scripts"
    if command -v rtk >/dev/null 2>&1; then
      echo "RTK:      $(rtk --version 2>/dev/null || echo 'installed')"
    else
      echo "RTK:      not installed"
    fi
    if command -v claude >/dev/null 2>&1; then
      plugin_count=$(jq -r '.plugins | keys | length' "${CLAUDE_DIR:-$HOME/.claude}/plugins/installed_plugins.json" 2>/dev/null || echo 0)
      echo "Plugins:  $plugin_count installed (from SoT enabledPlugins + Anthropic auto-installs)"
    fi
  fi
}

claude::next_steps() {
  [[ "${CLAUDE_SYNCED:-0}" -eq 1 ]] || return
  echo "In a Claude Code session, run /reload-plugins to pick up newly installed plugins."
  echo "Restart Claude Code for hook/env-var changes to take effect."
}
