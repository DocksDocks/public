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
  claude::sync_680k
  claude::sync_permissive
  claude::sync_claude_json
  claude::sync_connector_env
  claude::sync_removals
  claude::sync_plugins
  claude::sync_lsp_servers
  claude::sync_rtk
}

claude::sync_scripts() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] cp statusline.sh, fetch-usage.sh, notification.mp3"
    return
  fi

  cp "$REPO_DIR/SoT/.claude/statusline.sh" "$CLAUDE_DIR/"
  cp "$REPO_DIR/SoT/.claude/fetch-usage.sh" "$CLAUDE_DIR/"
  chmod +x "$CLAUDE_DIR/statusline.sh" "$CLAUDE_DIR/fetch-usage.sh"
  [[ -f "$REPO_DIR/notification.mp3" ]] && cp "$REPO_DIR/notification.mp3" "$CLAUDE_DIR/"
  log "Scripts synced (statusline, fetch-usage, alert)"
}

claude::sync_hooks() {
  local hook_count

  [[ -d "$REPO_DIR/SoT/.claude/hooks" ]] || return

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] cp -R $REPO_DIR/SoT/.claude/hooks/. $CLAUDE_DIR/hooks/"
    return
  fi

  mkdir -p "$CLAUDE_DIR/hooks"
  # cp -R (not rsync — rsync is not coreutils and is absent on minimal images
  # like the Claude-Code-on-the-web Ubuntu sandbox). `src/.` copies contents
  # (incl. dotfiles) into dst; additive, like rsync without --delete.
  cp -R "$REPO_DIR/SoT/.claude/hooks/." "$CLAUDE_DIR/hooks/"
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

# Deploy-time modifier (--680k): raise the DEPLOYED autocompact window to 680K
# for disposable containers — host machines stay on the SoT cap. Touches only
# ~/.claude/settings.json — the SoT stays at its cap and the model selection is
# never changed. A later flag-less sync restores the SoT value via the repo-wins
# merge, so re-pass --680k on machines that should keep 680K.
claude::sync_680k() {
  local user_settings="$CLAUDE_DIR/settings.json"

  [[ "$WINDOW_680K" -eq 1 ]] || return 0

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] (--680k) set env.CLAUDE_CODE_AUTO_COMPACT_WINDOW=680000 in $user_settings"
    return
  fi

  [[ -f "$user_settings" ]] || { warn "(--680k) $user_settings missing — skipped"; return; }
  jq empty "$user_settings" 2>/dev/null || { err "(--680k) $user_settings is not valid JSON — skipped"; return; }
  if ! jq '.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "680000"' "$user_settings" > "$user_settings.tmp"; then
    rm -f "$user_settings.tmp"
    err "(--680k) jq edit failed — settings unchanged"
    return
  fi
  mv "$user_settings.tmp" "$user_settings"
  log "680K mode: autocompact window set to 680K in deployed settings (SoT and model unchanged)"
}

# Deploy-time modifier (--permissive): for disposable sandboxes/containers.
# Empties permissions.ask and permissions.deny in the DEPLOYED settings so no
# rule prompts or blocks — git push drops out of ask and is covered by the
# existing Bash(git *) allow rule, so commits and pushes run unattended. The SoT
# arrays are untouched; a later flag-less sync re-unions them back in.
claude::sync_permissive() {
  local user_settings="$CLAUDE_DIR/settings.json"

  [[ "$PERMISSIVE" -eq 1 ]] || return 0

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] (--permissive) empty permissions.ask and permissions.deny in $user_settings"
    return
  fi

  [[ -f "$user_settings" ]] || { warn "(--permissive) $user_settings missing — skipped"; return; }
  jq empty "$user_settings" 2>/dev/null || { err "(--permissive) $user_settings is not valid JSON — skipped"; return; }
  if ! jq '.permissions.ask = [] | .permissions.deny = []' "$user_settings" > "$user_settings.tmp"; then
    rm -f "$user_settings.tmp"
    err "(--permissive) jq edit failed — settings unchanged"
    return
  fi
  mv "$user_settings.tmp" "$user_settings"
  log "Permissive mode: permissions.ask/deny emptied in deployed settings (sandbox use; SoT unchanged)"
}

claude::sync_claude_json() {
  local claude_json="$HOME/.claude.json"
  local mcp_sot="$REPO_DIR/SoT/.claude/mcp-servers.json"
  local jq_args=() filter='.showTurnDuration = true' have_mcp=0

  # settings.json cannot hold mcpServers (schema rejects it), so user-scoped MCP
  # servers the kit manages live here in ~/.claude.json. Merge is additive:
  # `(.mcpServers // {}) * SoT` — the user's own servers survive, SoT wins per
  # server key. Dropping a server from the SoT file does NOT remove it (additive
  # by default, like every other sync layer).
  if [[ -f "$mcp_sot" ]] && jq empty "$mcp_sot" 2>/dev/null; then
    have_mcp=1
    jq_args=(--slurpfile mcp "$mcp_sot")
    filter+=' | .mcpServers = ((.mcpServers // {}) * ($mcp[0].mcpServers // {}))'
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] set showTurnDuration=true in ~/.claude.json"
    [[ "$have_mcp" -eq 1 ]] && echo "[dry-run] merge mcpServers from SoT/.claude/mcp-servers.json into ~/.claude.json"
    return
  fi

  if [[ -f "$claude_json" ]]; then
    if ! jq empty "$claude_json" 2>/dev/null; then
      err "Skipping ~/.claude.json edit: not valid JSON. Fix or delete it."
      return
    fi
    if ! jq "${jq_args[@]+"${jq_args[@]}"}" "$filter" "$claude_json" > "$claude_json.tmp"; then
      rm -f "$claude_json.tmp"
      err "jq edit of ~/.claude.json failed — file unchanged"
      return
    fi
    mv "$claude_json.tmp" "$claude_json"
  else
    jq -n "${jq_args[@]+"${jq_args[@]}"}" "{} | $filter" > "$claude_json"
  fi
  log "~/.claude.json updated (showTurnDuration$([[ "$have_mcp" -eq 1 ]] && printf ', mcpServers'))"
}

# Ensure ENABLE_CLAUDEAI_MCP_SERVERS=false is exported as a REAL shell env var.
# This is the only working way to suppress claude.ai cloud connectors (Figma,
# Drive, Gmail, ...): they're fetched from the account at session start and
# IGNORE the settings.json `env` block (applied too late), so the var must be
# present in the process before `claude` launches — i.e. in the shell rc.
# Surgical: disables ONLY claude.ai connectors (MCP source #5 in Claude Code's
# scope hierarchy). Local/project/user/plugin servers (supabase, n8n, .mcp.json)
# are untouched. Idempotent + non-clobbering: if the var is already set in any
# common rc (any value), it's left as-is — set it to `true` yourself to keep
# connectors. Multi-platform: targets ~/.zshrc (zsh) or ~/.bashrc (bash),
# ~/.profile otherwise.
claude::sync_connector_env() {
  local line="export ENABLE_CLAUDEAI_MCP_SERVERS=false"
  local marker="# docks-kit: disable claude.ai cloud MCP connectors (set =true to keep them)"
  local -a candidates=("$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshenv")
  local f target shell_name

  for f in "${candidates[@]}"; do
    if [[ -f "$f" ]] && grep -q 'ENABLE_CLAUDEAI_MCP_SERVERS' "$f" 2>/dev/null; then
      if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "[dry-run] ENABLE_CLAUDEAI_MCP_SERVERS already in $f — would skip"
      else
        log "claude.ai connectors: ENABLE_CLAUDEAI_MCP_SERVERS already set in $f (left as-is)"
      fi
      return
    fi
  done

  shell_name="$(basename "${SHELL:-bash}")"
  case "$shell_name" in
    zsh)  target="$HOME/.zshrc" ;;
    bash) target="$HOME/.bashrc" ;;
    *)    target="$HOME/.profile" ;;
  esac

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] append 'export ENABLE_CLAUDEAI_MCP_SERVERS=false' to $target"
    return
  fi

  printf '\n%s\n%s\n' "$marker" "$line" >> "$target"
  log "claude.ai connectors disabled via $target (start a new shell to apply)"
}

# --- Removed-artifact pruning -------------------------------------------------
# Declarative manifest of kit-owned artifacts the kit no longer ships. The
# default sync is additive (the jq merge keeps user-only keys; cp -R never
# deletes), so config the kit dropped in an older version would otherwise
# linger forever on an already-synced machine. `claude::sync_removals` prunes
# the items below on every sync.
#
# NARROW exception to "additive by default": entries here are force-removed from
# EVERY synced ~/.claude. List kit-owned keys the kit used to set and has since
# dropped — they are pruned from the kit-managed settings.json. A deliberate
# per-machine override of any of these belongs in settings.local.json, which
# sync never touches. Do NOT list a key the kit never owned (a user's custom env
# vars, mcpServers, theme) — the additive merge already preserves those.
#   hooks          hook scripts under ~/.claude/hooks/ to delete (the matching
#                  settings.json hook entry is already dropped by the SoT
#                  settings merge, which replaces .hooks wholesale)
#   files          other paths under ~/.claude/ to delete
#   settingsKeys   dotted key paths to del() from ~/.claude/settings.json
#   claudeJsonKeys dotted key paths to del() from ~/.claude.json
claude::_removed_manifest() {
  cat <<'JSON'
{
  "hooks":          ["disable-claudeai-connectors.sh"],
  "files":          ["alert_bubble.mp3"],
  "settingsKeys": [
    "showTurnDuration",
    "advisorModel",
    "env.CLAUDE_CODE_SUBAGENT_MODEL",
    "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
    "env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
    "env.CLAUDE_CODE_DISABLE_1M_CONTEXT",
    "env.CLAUDE_CODE_FORK_SUBAGENT",
    "env.CLAUDE_CODE_EFFORT_LEVEL"
  ],
  "claudeJsonKeys": []
}
JSON
}

# Delete dotted key paths from a JSON file via jq delpaths. Echoes the count of
# keys that were actually present (and removed); echoes 0 when the file is
# missing/invalid or no listed key exists. Honors DRY_RUN (counts, no write).
# delpaths ignores absent paths, so this is idempotent.
claude::_prune_json_keys() {
  local file="$1" keys="$2" present
  { [[ "$keys" == "[]" || ! -f "$file" ]] || ! jq empty "$file" 2>/dev/null; } && { echo 0; return; }
  present=$(jq --argjson k "$keys" '. as $doc | [ $k[] | split(".") as $p | select($doc | getpath($p) != null) ] | length' "$file" 2>/dev/null || echo 0)
  [[ "$present" -gt 0 ]] || { echo 0; return; }
  if [[ "$DRY_RUN" -eq 0 ]]; then
    if jq --argjson k "$keys" 'delpaths([ $k[] | split(".") ])' "$file" > "$file.tmp" 2>/dev/null; then
      mv "$file.tmp" "$file"
    else
      rm -f "$file.tmp"; warn "Failed to prune stale keys from $file"; echo 0; return
    fi
  fi
  echo "$present"
}

claude::sync_removals() {
  local manifest name path hooks_removed=0 files_removed=0 skeys cjkeys

  manifest="$(claude::_removed_manifest)"

  while IFS= read -r name; do
    [[ -z "$name" || ! -e "$CLAUDE_DIR/hooks/$name" ]] && continue
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] rm $CLAUDE_DIR/hooks/$name"
    else
      rm -f "$CLAUDE_DIR/hooks/$name"; hooks_removed=$((hooks_removed + 1))
    fi
  done < <(jq -r '.hooks[]? // empty' <<<"$manifest")

  while IFS= read -r path; do
    [[ -z "$path" || ! -e "$CLAUDE_DIR/$path" ]] && continue
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] rm $CLAUDE_DIR/$path"
    else
      rm -f "$CLAUDE_DIR/$path"; files_removed=$((files_removed + 1))
    fi
  done < <(jq -r '.files[]? // empty' <<<"$manifest")

  skeys=$(claude::_prune_json_keys "$CLAUDE_DIR/settings.json" "$(jq -c '.settingsKeys // []' <<<"$manifest")")
  cjkeys=$(claude::_prune_json_keys "$HOME/.claude.json" "$(jq -c '.claudeJsonKeys // []' <<<"$manifest")")

  if [[ "$DRY_RUN" -eq 1 ]]; then
    [[ "$skeys" -gt 0 ]]  && echo "[dry-run] del $skeys stale key(s) from $CLAUDE_DIR/settings.json"
    [[ "$cjkeys" -gt 0 ]] && echo "[dry-run] del $cjkeys stale key(s) from $HOME/.claude.json"
    # Explicit 0: the trailing [[ ]] tests above leave $?=1 when their counts are
    # 0, and a bare `return` would propagate that — aborting sync under `set -e`.
    return 0
  fi

  if [[ $((hooks_removed + files_removed + skeys + cjkeys)) -gt 0 ]]; then
    log "Pruned stale artifacts (hooks: $hooks_removed, files: $files_removed, settings keys: $skeys, claude.json keys: $cjkeys)"
  fi
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

# True when installed_plugins.json records a USER-scope install for the plugin.
# Registry values are per-scope record arrays (Claude Code >= 2.1.198); the
# type guard tolerates the older single-object form. A project/local-scope
# record does NOT count — the kit's tri-state contract requires user scope.
claude::_plugin_user_scope_installed() {
  local installed_plugins="$1" plugin_id="$2"
  [[ -f "$installed_plugins" ]] || return 1
  jq -e --arg n "$plugin_id" \
    '.plugins[$n] // empty | (if type == "array" then . else [.] end) | any(.scope? == "user")' \
    "$installed_plugins" >/dev/null 2>&1
}

# Pass 2 — install any SoT-enabled plugin not yet installed at user scope.
claude::_plugins_install() {
  local repo_settings="$1" installed_plugins="$2"
  local plugin_id added=0 failed=0 refreshed=0

  while IFS= read -r plugin_id; do
    [[ -z "$plugin_id" ]] && continue
    if claude::_plugin_user_scope_installed "$installed_plugins" "$plugin_id"; then
      continue
    fi
    # Stale-manifest guard: an already-cloned marketplace may predate a plugin
    # later added to it, and pass 3's manifest refresh runs after this pass —
    # too late for the install. Refresh once before the first install attempt.
    if [[ "$refreshed" -eq 0 ]]; then
      claude::_cli plugin marketplace update >/dev/null 2>&1 || true
      refreshed=1
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
        claude::_plugin_user_scope_installed "$installed_plugins" "$plugin_id" || continue
        if claude::_cli plugin uninstall -y --scope user "$plugin_id" >/dev/null 2>&1; then
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

# Pass 6 — enforce SoT enabled-state in ~/.claude/settings.json. `claude plugin
# install` (pass 2) enables at user scope as a side effect. A plain jq rewrite of
# that back to false loses a race: the CLI owns settings.json and reverts the
# external edit, so the false value only sticks on a SECOND sync (once the plugin
# is already installed and pass 2 skips it). Fix: disable SoT-false plugins
# through the CLI's own `plugin disable` verb — authoritative, sticks in one pass
# — THEN jq-normalize so every SoT-declared value wins and user-only
# enabledPlugins entries are preserved. The disable is guarded on the plugin
# being currently enabled (re-disabling an already-disabled plugin is a CLI
# error), which keeps steady-state syncs quiet. If `plugin disable` is missing or
# fails the jq-normalize still runs, degrading to the old two-sync behavior
# rather than breaking. Idempotent — safe to run every sync.
claude::_plugins_reassert_enabled_state() {
  local repo_settings="$1" user_settings="$2" plugin_id
  [[ -f "$user_settings" ]] || return 0

  while IFS= read -r plugin_id; do
    [[ -z "$plugin_id" ]] && continue
    jq -e --arg n "$plugin_id" '.enabledPlugins[$n] == true' "$user_settings" >/dev/null 2>&1 || continue
    claude::_cli plugin disable "$plugin_id" >/dev/null 2>&1 \
      || warn "Failed to disable SoT-false plugin: $plugin_id (will retry next sync)"
  done < <(jq -r '.enabledPlugins // {} | to_entries[] | select(.value == false) | .key' "$repo_settings")

  if jq -s '.[0].enabledPlugins as $sot | .[1]
            | .enabledPlugins = ((.enabledPlugins // {}) * $sot)' \
       "$repo_settings" "$user_settings" > "$user_settings.tmp"; then
    mv "$user_settings.tmp" "$user_settings"
  else
    rm -f "$user_settings.tmp"
    warn "enabledPlugins re-assert failed — false-keyed plugins may be left enabled"
  fi
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
  claude::_plugins_reassert_enabled_state "$repo_settings" "$CLAUDE_DIR/settings.json"
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

# The php-lsp / typescript-lsp plugins only register lspServers config (it
# ships in the marketplace manifest) — the language-server binaries are
# separate npm globals, without which the plugins are silent no-ops. Gated on
# key presence in SoT enabledPlugins (true OR false: false-keyed plugins can
# be enabled per-project, so the binary must still exist).
claude::sync_lsp_servers() {
  local sot_settings="$REPO_DIR/SoT/.claude/settings.json"
  local missing=()

  jq -e '.enabledPlugins | has("php-lsp@claude-plugins-official") or has("typescript-lsp@claude-plugins-official")' \
    "$sot_settings" >/dev/null 2>&1 || return 0

  if jq -e '.enabledPlugins | has("php-lsp@claude-plugins-official")' "$sot_settings" >/dev/null 2>&1; then
    command -v intelephense >/dev/null 2>&1 || missing+=(intelephense)
  fi
  if jq -e '.enabledPlugins | has("typescript-lsp@claude-plugins-official")' "$sot_settings" >/dev/null 2>&1; then
    command -v typescript-language-server >/dev/null 2>&1 || missing+=(typescript-language-server)
    command -v tsc >/dev/null 2>&1 || missing+=(typescript)
  fi

  if [[ ${#missing[@]} -eq 0 ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] LSP server binaries present"
    else
      log "LSP server binaries present"
    fi
    return
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] would install: npm install -g ${missing[*]}"
    return
  fi

  if ! command -v npm >/dev/null 2>&1; then
    warn "npm not found — cannot install LSP servers (${missing[*]}); the php-lsp/typescript-lsp plugins stay no-ops. Install Node.js, then re-run sync."
    return
  fi

  log "Installing LSP servers via npm: ${missing[*]}..."
  if npm install -g "${missing[@]}" >/dev/null 2>&1; then
    log "LSP servers installed (${missing[*]})"
  else
    warn "npm install -g ${missing[*]} failed. Try manually: npm install -g ${missing[*]}"
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
