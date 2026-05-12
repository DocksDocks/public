#!/bin/bash
set -euo pipefail

codex::sync() {
  CODEX_DIR="$HOME/.codex"
  AGENTS_DIR="$HOME/.agents"
  CODEX_SYNCED=1

  local codex_settings="$REPO_DIR/SoT/.codex/config.toml"
  local user_codex_settings="$CODEX_DIR/config.toml"
  local codex_agents_md="$REPO_DIR/SoT/.codex/AGENTS.md"
  local user_codex_agents_md="$CODEX_DIR/AGENTS.md"
  local user_codex_rtk_md="$CODEX_DIR/RTK.md"
  local codex_bin="$REPO_DIR/SoT/.codex/bin/codex"
  local user_codex_bin="$HOME/.local/bin/codex"
  local codex_marketplace="$REPO_DIR/SoT/.codex/plugins/marketplace.json"
  local user_codex_marketplace="$AGENTS_DIR/plugins/marketplace.json"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    [[ -f "$codex_settings" ]] && echo "[dry-run] merge $codex_settings -> $user_codex_settings"
    [[ -f "$codex_agents_md" ]] && echo "[dry-run] cp $codex_agents_md -> $user_codex_agents_md"
    if [[ "${SKIP_OPTIONAL_BOOTSTRAP:-0}" -eq 0 ]]; then
      echo "[dry-run] refresh Codex RTK.md with rtk init -g --codex"
    else
      echo "[dry-run] skip Codex RTK init (--no-rtk)"
    fi
    [[ -f "$codex_bin" ]] && echo "[dry-run] install $codex_bin -> $user_codex_bin"
    [[ -f "$codex_marketplace" ]] && echo "[dry-run] cp $codex_marketplace -> $user_codex_marketplace"
    echo "[dry-run] bootstrap Codex marketplace DocksDocks/docks when codex CLI is available"
    return
  fi

  mkdir -p "$CODEX_DIR"
  codex::sync_config "$codex_settings" "$user_codex_settings"
  codex::sync_agents_md "$codex_agents_md" "$user_codex_agents_md"
  codex::sync_rtk "$codex_agents_md" "$user_codex_agents_md" "$user_codex_rtk_md"
  codex::install_launcher "$codex_bin" "$user_codex_bin"
  codex::sync_marketplace "$codex_marketplace" "$user_codex_marketplace"
  codex::bootstrap_marketplace
}

codex::sync_agents_md() {
  local codex_agents_md="$1"
  local user_codex_agents_md="$2"

  [[ -f "$codex_agents_md" ]] || return

  cp "$codex_agents_md" "$user_codex_agents_md"
  log "Codex AGENTS.md synced"
}

codex::sync_rtk() {
  local codex_agents_md="$1"
  local user_codex_agents_md="$2"
  local user_codex_rtk_md="$3"

  [[ -f "$codex_agents_md" ]] || return

  if [[ "${SKIP_OPTIONAL_BOOTSTRAP:-0}" -eq 1 ]]; then
    warn "Skipping Codex RTK init (--no-rtk)"
    cp "$codex_agents_md" "$user_codex_agents_md"
    log "Codex AGENTS.md restored"
    return
  fi

  if ! command -v rtk >/dev/null 2>&1; then
    warn "rtk not in PATH — Codex AGENTS.md imports @RTK.md, but RTK.md was not generated"
    return
  fi

  if rtk init -g --codex >/dev/null 2>&1; then
    log "Codex RTK refreshed (rtk init -g --codex)"
  else
    warn "Failed to initialize Codex RTK.md via rtk init -g --codex"
  fi

  cp "$codex_agents_md" "$user_codex_agents_md"
  log "Codex AGENTS.md restored after RTK init"
}

codex::sync_config() {
  local codex_settings="$1"
  local user_codex_settings="$2"

  [[ -f "$codex_settings" ]] || return

  if [[ ! -f "$user_codex_settings" ]]; then
    cp "$codex_settings" "$user_codex_settings"
    log "Codex config installed"
    return
  fi

  cp "$user_codex_settings" "$user_codex_settings.bak"
  codex::merge_top_level_settings "$codex_settings" "$user_codex_settings"
  codex::merge_table_settings "$codex_settings" "$user_codex_settings"

  if [[ "$FORCE" -eq 1 ]]; then
    log "Codex config reconciled (backup at config.toml.bak; runtime tables preserved)"
  else
    log "Codex config merged (backup at config.toml.bak)"
  fi
}

codex::merge_top_level_settings() {
  local codex_settings="$1"
  local user_codex_settings="$2"
  local setting_line setting_key tmp_file

  while IFS= read -r setting_line; do
    [[ -z "$setting_line" ]] && continue
    setting_key="${setting_line%%=*}"
    setting_key="${setting_key%"${setting_key##*[![:space:]]}"}"

    tmp_file="$user_codex_settings.tmp"
    awk -v key="$setting_key" -v replacement="$setting_line" '
      BEGIN { in_table = 0; replaced = 0 }
      /^\[/ {
        if (!replaced) {
          print replacement
          replaced = 1
        }
        in_table = 1
        print
        next
      }
      !in_table && $0 ~ ("^" key "[[:space:]]*=") {
        if (!replaced) {
          print replacement
          replaced = 1
        }
        next
      }
      { print }
      END {
        if (!replaced) {
          print replacement
        }
      }
    ' "$user_codex_settings" > "$tmp_file" && mv "$tmp_file" "$user_codex_settings"
  done < <(awk '
    /^\[/ { exit }
    /^[[:space:]]*($|#)/ { next }
    /^[A-Za-z0-9_.-]+[[:space:]]*=/ { print }
  ' "$codex_settings")
}

codex::merge_table_settings() {
  local codex_settings="$1"
  local user_codex_settings="$2"
  local table_header table_block tmp_file

  while IFS= read -r table_header; do
    [[ -z "$table_header" ]] && continue

    table_block="$(
      awk -v header="$table_header" '
        $0 == header { printing = 1 }
        printing && $0 ~ /^\[/ && $0 != header { exit }
        printing { print }
      ' "$codex_settings"
    )"

    tmp_file="$user_codex_settings.tmp"
    awk -v header="$table_header" '
      $0 == header { skip = 1; next }
      skip && /^\[/ { skip = 0 }
      !skip { print }
    ' "$user_codex_settings" > "$tmp_file" && mv "$tmp_file" "$user_codex_settings"

    {
      printf '\n'
      printf '%s\n' "$table_block"
    } >> "$user_codex_settings"
  done < <(grep -E '^\[[^]]+\]' "$codex_settings")
}

codex::install_launcher() {
  local codex_bin="$1"
  local user_codex_bin="$2"

  [[ -f "$codex_bin" ]] || return

  mkdir -p "$HOME/.local/bin"
  if [[ ! -e "$user_codex_bin" ]] || grep -q 'Managed by DocksDocks/public sync.sh' "$user_codex_bin" 2>/dev/null; then
    cp "$codex_bin" "$user_codex_bin"
    chmod +x "$user_codex_bin"
    log "Codex launcher installed (~/.local/bin/codex)"
  else
    warn "~/.local/bin/codex exists and is not managed by this kit — leaving it unchanged"
  fi
}

codex::sync_marketplace() {
  local codex_marketplace="$1"
  local user_codex_marketplace="$2"

  [[ -f "$codex_marketplace" ]] || return

  mkdir -p "$AGENTS_DIR/plugins"
  jq . "$codex_marketplace" >/dev/null

  if [[ -f "$user_codex_marketplace" && "$FORCE" -eq 0 ]]; then
    cp "$user_codex_marketplace" "$user_codex_marketplace.bak"
    jq -s '
      .[0] as $repo | .[1] as $user |
      ($user * {name: ($user.name // $repo.name), interface: ($user.interface // $repo.interface)}) |
      .plugins = (
        (($user.plugins // []) + ($repo.plugins // []))
        | reverse
        | unique_by(.name)
        | reverse
      )
    ' "$codex_marketplace" "$user_codex_marketplace" > "$user_codex_marketplace.tmp" \
      && mv "$user_codex_marketplace.tmp" "$user_codex_marketplace"
    log "Codex marketplace merged (backup at marketplace.json.bak)"
  else
    [[ -f "$user_codex_marketplace" ]] && cp "$user_codex_marketplace" "$user_codex_marketplace.bak"
    cp "$codex_marketplace" "$user_codex_marketplace"
    log "Codex marketplace installed"
  fi
}

codex::bootstrap_marketplace() {
  local codex_add_out

  if command -v codex >/dev/null 2>&1; then
    codex_add_out=$(codex plugin marketplace add DocksDocks/docks 2>&1 || true)
    if echo "$codex_add_out" | grep -q 'could not find a Codex CLI binary'; then
      warn "Codex launcher is installed, but no npm Codex binary was found — install with: npm install -g @openai/codex"
    elif echo "$codex_add_out" | grep -q "already added from a different source"; then
      if codex plugin marketplace remove docks >/dev/null 2>&1 && codex plugin marketplace add DocksDocks/docks >/dev/null 2>&1; then
        log "Codex Docks marketplace reconciled"
      else
        warn "Codex marketplace reconcile failed; run: codex plugin marketplace remove docks && codex plugin marketplace add DocksDocks/docks"
      fi
    elif echo "$codex_add_out" | grep -qi 'error\|failed'; then
      warn "Codex marketplace add failed; open /plugins after restart and use the DocksDocks marketplace"
    else
      log "Codex Docks marketplace added"
    fi
  else
    warn "codex CLI not in PATH — deployed marketplace config; manual install command: codex plugin marketplace add DocksDocks/docks"
  fi
}

codex::summary() {
  local codex_plugin_count

  [[ "${CODEX_SYNCED:-0}" -eq 1 ]] || return
  echo "Codex:    ${CODEX_DIR:-$HOME/.codex}"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    codex_plugin_count=$(grep -c '^\[plugins\."' "${CODEX_DIR:-$HOME/.codex}/config.toml" 2>/dev/null || true)
    codex_plugin_count=${codex_plugin_count:-0}
    echo "Codex plugins: $codex_plugin_count enabled in config.toml"
  fi
}

codex::next_steps() {
  [[ "${CODEX_SYNCED:-0}" -eq 1 ]] || return
  echo "In Codex, restart and open /plugins to install or verify the Docks plugin."
}
