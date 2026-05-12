#!/bin/bash
set -euo pipefail

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
  hook_count=$(ls "$CLAUDE_DIR/hooks/"*.sh 2>/dev/null | wc -l)
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

claude::sync_settings() {
  local repo_settings="$REPO_DIR/SoT/.claude/settings.json"
  local user_settings="$CLAUDE_DIR/settings.json"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] merge $repo_settings -> $user_settings"
  elif [[ ! -f "$user_settings" || "$FORCE" -eq 1 ]]; then
    [[ -f "$user_settings" ]] && cp "$user_settings" "$user_settings.bak"
    cp "$repo_settings" "$user_settings"
    if [[ -f "$user_settings.bak" ]]; then
      log "Settings replaced (backup at settings.json.bak)"
    else
      log "Settings installed"
    fi
  else
    cp "$user_settings" "$user_settings.bak"
    jq -s '
      .[0] as $repo | .[1] as $user |
      ($user * $repo) |
      .permissions.allow = (($user.permissions.allow // []) + ($repo.permissions.allow // []) | unique) |
      .permissions.deny  = (($user.permissions.deny  // []) + ($repo.permissions.deny  // []) | unique) |
      .permissions.ask   = (($user.permissions.ask   // []) + ($repo.permissions.ask   // []) | unique)
    ' "$repo_settings" "$user_settings" > "$user_settings.tmp" \
      && mv "$user_settings.tmp" "$user_settings"
    log "Settings merged (backup at settings.json.bak)"
  fi
}

claude::sync_claude_json() {
  local claude_json="$HOME/.claude.json"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] set showTurnDuration=true in ~/.claude.json"
    return
  fi

  if [[ -f "$claude_json" ]]; then
    jq '.showTurnDuration = true' "$claude_json" > "$claude_json.tmp" \
      && mv "$claude_json.tmp" "$claude_json"
  else
    echo '{"showTurnDuration": true}' > "$claude_json"
  fi
  log "~/.claude.json updated (showTurnDuration)"
}

claude::sync_plugins() {
  local repo_settings="$REPO_DIR/SoT/.claude/settings.json"
  local known_marketplaces="$CLAUDE_DIR/plugins/known_marketplaces.json"
  local installed_plugins="$CLAUDE_DIR/plugins/installed_plugins.json"
  local added_mp=0
  local added_pl=0
  local updated_pl=0
  local removed_pl=0
  local removed_mp=0
  local failed=0
  local mp_name mp_repo plugin_id out

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

  while IFS=$'\t' read -r mp_name mp_repo; do
    [[ -z "$mp_name" ]] && continue
    if [[ -f "$known_marketplaces" ]] && jq -e --arg n "$mp_name" '.[$n]' "$known_marketplaces" >/dev/null 2>&1; then
      continue
    fi
    if claude plugin marketplace add "$mp_repo" >/dev/null 2>&1; then
      added_mp=$((added_mp + 1))
    else
      warn "Failed to add marketplace: $mp_name ($mp_repo)"
      failed=$((failed + 1))
    fi
  done < <(jq -r '.extraKnownMarketplaces // {} | to_entries[] | "\(.key)\t\(.value.source.repo)"' "$repo_settings")

  while IFS= read -r plugin_id; do
    [[ -z "$plugin_id" ]] && continue
    if [[ -f "$installed_plugins" ]] && jq -e --arg n "$plugin_id" '.plugins[$n] // empty' "$installed_plugins" >/dev/null 2>&1; then
      continue
    fi
    if claude plugin install "$plugin_id" >/dev/null 2>&1; then
      added_pl=$((added_pl + 1))
    else
      warn "Failed to install plugin: $plugin_id"
      failed=$((failed + 1))
    fi
  done < <(jq -r '.enabledPlugins // {} | keys[]' "$repo_settings")

  claude plugin marketplace update >/dev/null 2>&1 || true

  if [[ -f "$installed_plugins" ]]; then
    while IFS= read -r plugin_id; do
      [[ -z "$plugin_id" ]] && continue
      out=$(claude plugin update "$plugin_id" 2>&1 || true)
      if echo "$out" | grep -q "Successfully updated"; then
        updated_pl=$((updated_pl + 1))
      fi
    done < <(jq -r '.plugins | keys[]' "$installed_plugins")
  fi

  if [[ "$REMOVE_PLUGINS" -eq 1 && -f "$installed_plugins" ]]; then
    while IFS= read -r plugin_id; do
      [[ -z "$plugin_id" ]] && continue
      if ! jq -e --arg n "$plugin_id" '.enabledPlugins | has($n)' "$repo_settings" >/dev/null 2>&1; then
        if claude plugin uninstall -y "$plugin_id" >/dev/null 2>&1; then
          removed_pl=$((removed_pl + 1))
        else
          warn "Failed to uninstall plugin: $plugin_id"
          failed=$((failed + 1))
        fi
      fi
    done < <(jq -r '.plugins | keys[]' "$installed_plugins")
  fi

  if [[ "$REMOVE_PLUGINS" -eq 1 && -f "$known_marketplaces" ]]; then
    while IFS= read -r mp_name; do
      [[ -z "$mp_name" ]] && continue
      [[ "$mp_name" == "claude-plugins-official" ]] && continue
      if ! jq -e --arg n "$mp_name" '.extraKnownMarketplaces[$n]' "$repo_settings" >/dev/null 2>&1; then
        if claude plugin marketplace remove "$mp_name" >/dev/null 2>&1; then
          removed_mp=$((removed_mp + 1))
        else
          warn "Failed to remove marketplace: $mp_name"
          failed=$((failed + 1))
        fi
      fi
    done < <(jq -r '. | keys[]' "$known_marketplaces")
  fi

  if [[ "$added_mp" -gt 0 || "$added_pl" -gt 0 || "$updated_pl" -gt 0 || "$removed_pl" -gt 0 || "$removed_mp" -gt 0 ]]; then
    log "Plugins synced (marketplaces: +$added_mp -$removed_mp, plugins: +$added_pl ~$updated_pl -$removed_pl)"
  else
    log "Plugins already in sync"
  fi
  if [[ "$failed" -gt 0 ]]; then
    warn "$failed plugin operation(s) failed — re-run sync or install manually"
  fi
}

claude::sync_rtk() {
  local tmp installed_ver latest_tag newer tmp_rtk_installer

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
    latest_tag=$(curl -fsSL --max-time 5 "https://api.github.com/repos/rtk-ai/rtk/releases/latest" 2>/dev/null \
      | jq -r '.tag_name // empty' 2>/dev/null | sed 's/^v//' || true)
    if [[ -n "$latest_tag" && -n "$installed_ver" && "$latest_tag" != "$installed_ver" ]]; then
      newer=$(printf '%s\n%s\n' "$installed_ver" "$latest_tag" | sort -V | tail -n1)
      if [[ "$newer" == "$latest_tag" ]]; then
        warn "RTK $installed_ver is outdated (latest $latest_tag).
  Review:   https://github.com/rtk-ai/rtk/releases/tag/v$latest_tag (changelog + release author)
  Research: ask Claude to web-search 'rtk-ai/rtk v$latest_tag' for any compromise/CVE reports
  Install:  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh -o /tmp/rtk-install.sh && bash /tmp/rtk-install.sh && rm /tmp/rtk-install.sh
  (RTK runs as a PreToolUse bash hook — supply-chain risk warrants review before upgrading)"
      fi
    fi
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
    hook_count=$(ls "${CLAUDE_DIR:-$HOME/.claude}/hooks/"*.sh 2>/dev/null | wc -l)
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
