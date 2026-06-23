#!/bin/bash
set -euo pipefail

# Source-order guards: this lib depends on common.sh's log/warn/err and on
# sync.sh's REPO_DIR. Fail fast with a clear message if sourced standalone.
declare -F log >/dev/null 2>&1 || { printf '\033[1;31m[err]\033[0m %s\n' "lib/codex.sh must be sourced after lib/common.sh" >&2; exit 1; }
[[ -n "${REPO_DIR:-}" ]] || { printf '\033[1;31m[err]\033[0m %s\n' "REPO_DIR must be set before sourcing lib/codex.sh" >&2; exit 1; }

codex::sync() {
  CODEX_DIR="$HOME/.codex"
  CODEX_SYNCED=1

  local codex_settings="$REPO_DIR/SoT/.codex/config.toml"
  local user_codex_settings="$CODEX_DIR/config.toml"
  local codex_rules_dir="$REPO_DIR/SoT/.codex/rules"
  local user_codex_rules_dir="$CODEX_DIR/rules"
  local codex_agents_md="$REPO_DIR/SoT/.codex/AGENTS.md"
  local user_codex_agents_md="$CODEX_DIR/AGENTS.md"
  local codex_marketplace="$REPO_DIR/SoT/.codex/plugins/marketplace.json"
  local user_codex_marketplace="$AGENTS_DIR/plugins/marketplace.json"

  # Per-stage dry-run pattern: each helper owns its own [[ DRY_RUN ]] echo +
  # early return. codex::sync is the dispatcher and never inspects DRY_RUN.
  codex::ensure_bubblewrap
  [[ "$DRY_RUN" -eq 0 ]] && mkdir -p "$CODEX_DIR"
  codex::sync_config "$codex_settings" "$user_codex_settings"
  codex::sync_rules "$codex_rules_dir" "$user_codex_rules_dir"
  codex::sync_agents_md "$codex_agents_md" "$user_codex_agents_md"
  codex::sync_marketplace "$codex_marketplace" "$user_codex_marketplace"
  codex::remove_legacy_docks_marketplace
  codex::sync_plugins "$codex_settings"
}

# Codex prefers a system bubblewrap on Linux, then falls back to its bundled
# helper when user namespaces allow it. macOS uses Seatbelt natively.
codex::ensure_bubblewrap() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] verify bubblewrap installed (recommended Codex Linux sandbox runtime)"
    return
  fi

  codex::_bwrap_supported_os || return
  command -v bwrap >/dev/null 2>&1 && return

  if [[ "${SKIP_OPTIONAL_BOOTSTRAP:-0}" -eq 1 ]]; then
    warn "bubblewrap not installed (--no-rtk skips auto-install). Codex may use its bundled helper if user namespaces work; recommended install: sudo apt install -y bubblewrap"
    return
  fi

  local pm_install
  pm_install=$(codex::_bwrap_detect_pm_install_cmd)
  if [[ -z "$pm_install" ]]; then
    warn "bubblewrap not installed and no supported package manager found (apt-get/dnf/pacman/zypper). Codex may use its bundled helper if user namespaces work; install system bubblewrap manually when possible."
    return
  fi

  warn "bubblewrap not installed - recommended for Codex Linux sandbox. Running: $pm_install (sudo prompt may appear)"
  if ! eval "$pm_install"; then
    warn "Failed to auto-install bubblewrap. Install manually: $pm_install"
    return
  fi

  if ! command -v bwrap >/dev/null 2>&1; then
    warn "Package install reported success but bwrap not on PATH — check installation manually"
    return
  fi

  codex::_bwrap_verify_userns
}

# Returns 0 if the current OS supports bubblewrap (Linux); 1 otherwise. macOS
# uses Seatbelt natively so bwrap is not needed; unknown OSes get a warning.
codex::_bwrap_supported_os() {
  case "$(uname -s)" in
    Darwin*) return 1 ;;
    Linux*) return 0 ;;
    *) warn "Unknown OS — skipping bubblewrap check; Codex sandbox may not work"; return 1 ;;
  esac
}

# Echoes the `sudo <pm> install -y bubblewrap` command for the first PM found
# on PATH (apt-get -> dnf -> pacman -> zypper); empty string if none found.
codex::_bwrap_detect_pm_install_cmd() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "sudo apt-get install -y bubblewrap"
  elif command -v dnf >/dev/null 2>&1; then
    echo "sudo dnf install -y bubblewrap"
  elif command -v pacman >/dev/null 2>&1; then
    echo "sudo pacman -S --noconfirm bubblewrap"
  elif command -v zypper >/dev/null 2>&1; then
    echo "sudo zypper install -y bubblewrap"
  fi
}

# Probe whether unprivileged user namespaces work - system bubblewrap and the
# bundled Codex helper both depend on them at runtime.
codex::_bwrap_verify_userns() {
  if unshare -Ur true >/dev/null 2>&1; then
    log "bubblewrap installed and functional ($(bwrap --version 2>/dev/null | head -1))"
  else
    warn "bubblewrap installed but unprivileged user namespaces appear blocked. On Ubuntu 24.04+, prefer loading the AppArmor bwrap-userns-restrict profile; fallback: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0"
  fi
}

codex::sync_rules() {
  local codex_rules_dir="$1"
  local user_codex_rules_dir="$2"
  local rule_file user_rule_file rules_synced=0

  [[ -d "$codex_rules_dir" ]] || return

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] cp $codex_rules_dir/*.rules -> $user_codex_rules_dir/"
    return
  fi

  mkdir -p "$user_codex_rules_dir"
  while IFS= read -r rule_file; do
    [[ -f "$rule_file" ]] || continue
    user_rule_file="$user_codex_rules_dir/$(basename "$rule_file")"
    [[ -f "$user_rule_file" ]] && cp "$user_rule_file" "$user_rule_file.bak"
    cp "$rule_file" "$user_rule_file"
    rules_synced=1
  done < <(find "$codex_rules_dir" -maxdepth 1 -type f -name '*.rules' | sort)

  [[ "$rules_synced" -eq 1 ]] && log "Codex rules synced"
}

codex::sync_agents_md() {
  local codex_agents_md="$1"
  local user_codex_agents_md="$2"

  [[ -f "$codex_agents_md" ]] || return

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] cp $codex_agents_md -> $user_codex_agents_md"
    return
  fi

  cp "$codex_agents_md" "$user_codex_agents_md"
  log "Codex AGENTS.md synced"
}

codex::sync_config() {
  local codex_settings="$1"
  local user_codex_settings="$2"

  [[ -f "$codex_settings" ]] || return

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] merge $codex_settings -> $user_codex_settings"
    return
  fi

  if [[ ! -f "$user_codex_settings" ]]; then
    cp "$codex_settings" "$user_codex_settings"
    log "Codex config installed"
    return
  fi

  cp "$user_codex_settings" "$user_codex_settings.bak"

  # Stage list is the OCP extension point: append a new stage here to grow the
  # merge pipeline without editing the loop. Order matters — scrub deprecated
  # keys before merging so SoT keys don't re-introduce a scrubbed table.
  local stages=(scrub_deprecated_features merge_top_level_settings merge_table_settings) stage
  for stage in "${stages[@]}"; do
    "codex::$stage" "$codex_settings" "$user_codex_settings"
  done

  if [[ "$FORCE" -eq 1 ]]; then
    log "Codex config reconciled (backup at config.toml.bak; runtime tables preserved)"
  else
    log "Codex config merged (backup at config.toml.bak)"
  fi
}

# Drop deprecated [features].use_legacy_landlock and the [features] table if
# that was its only key. Codex emits a "deprecated" warning on every run while
# the key is present (value=false still warns). bubblewrap is the default Linux
# sandbox now; removing the override lets Codex pick it up automatically.
codex::scrub_deprecated_features() {
  # Unified stage signature: (codex_settings, user_codex_settings). $1 is unused.
  local user_codex_settings="$2"

  [[ -f "$user_codex_settings" ]] || return 0
  grep -q '^use_legacy_landlock[[:space:]]*=' "$user_codex_settings" || return 0

  local tmp="$user_codex_settings.tmp"
  awk '
    in_features {
      if (/^\[/) {
        in_features = 0
        if (keep) { print header; printf "%s", body }
        print
        next
      }
      if (/^use_legacy_landlock[[:space:]]*=/) next
      body = body $0 "\n"
      if (/[^[:space:]]/) keep = 1
      next
    }
    /^\[features\][[:space:]]*$/ {
      in_features = 1
      header = $0
      body = ""
      keep = 0
      next
    }
    { print }
    END {
      if (in_features && keep) { print header; printf "%s", body }
    }
  ' "$user_codex_settings" > "$tmp" && mv "$tmp" "$user_codex_settings"

  log "Codex: scrubbed deprecated [features].use_legacy_landlock"
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

codex::sync_marketplace() {
  local codex_marketplace="$1"
  local user_codex_marketplace="$2"

  [[ -f "$codex_marketplace" ]] || return

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] cp $codex_marketplace -> $user_codex_marketplace"
    return
  fi

  mkdir -p "$AGENTS_DIR/plugins"
  jq . "$codex_marketplace" >/dev/null

  if [[ -f "$user_codex_marketplace" && "$FORCE" -eq 0 ]]; then
    if ! jq empty "$user_codex_marketplace" 2>/dev/null; then
      err "Skipping marketplace sync: $user_codex_marketplace is not valid JSON. Fix or delete it."
      return
    fi
    cp "$user_codex_marketplace" "$user_codex_marketplace.bak"
    if ! jq -s '
      .[0] as $repo | .[1] as $user |
      ($user * {name: ($user.name // $repo.name), interface: ($user.interface // $repo.interface)}) |
      .plugins = (
        (($user.plugins // []) + ($repo.plugins // []))
        | reverse
        | unique_by(.name)
        | reverse
      )
    ' "$codex_marketplace" "$user_codex_marketplace" > "$user_codex_marketplace.tmp"; then
      rm -f "$user_codex_marketplace.tmp"
      err "jq marketplace merge failed — marketplace unchanged (backup at marketplace.json.bak)"
      return
    fi
    mv "$user_codex_marketplace.tmp" "$user_codex_marketplace"
    log "Codex marketplace merged (backup at marketplace.json.bak)"
  else
    [[ -f "$user_codex_marketplace" ]] && cp "$user_codex_marketplace" "$user_codex_marketplace.bak"
    cp "$codex_marketplace" "$user_codex_marketplace"
    log "Codex marketplace installed"
  fi
}

codex::_marketplace_source() {
  local marketplace="$1"
  local config_file="$2"

  [[ -f "$config_file" ]] || return

  awk -v marketplace="$marketplace" '
    $0 == "[marketplaces." marketplace "]" {
      in_marketplace = 1
      next
    }
    /^\[/ {
      in_marketplace = 0
    }
    in_marketplace && /^[[:space:]]*source[[:space:]]*=/ {
      source = $0
      sub(/^[^=]+=[[:space:]]*/, "", source)
      sub(/[[:space:]]*#.*/, "", source)
      gsub(/^"|"$/, "", source)
      print source
      exit
    }
  ' "$config_file"
}

codex::remove_legacy_docks_marketplace() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] remove legacy configured Codex Docks marketplace when personal marketplace is deployed"
    return
  fi

  if ! command -v codex >/dev/null 2>&1; then
    return
  fi

  case "$(codex::_marketplace_source docks "$CODEX_DIR/config.toml")" in
    "https://github.com/DocksDocks/docks.git"|"DocksDocks/docks")
      if codex plugin marketplace remove docks >/dev/null 2>&1; then
        log "Removed legacy configured Codex Docks marketplace; using personal marketplace file"
      else
        warn "Failed to remove legacy configured Codex Docks marketplace"
      fi ;;
    *) ;;
  esac
}

codex::_first_line() {
  local text="$1"
  text="${text%%$'\n'*}"
  printf '%s\n' "$text"
}

codex::_standalone_install_command() {
  printf 'tmp=$(mktemp) && curl -fsSL https://chatgpt.com/codex/install.sh -o "$tmp" && CODEX_NON_INTERACTIVE=1 sh "$tmp"\n'
}

codex::_manual_plugin_refresh_command() {
  local codex_settings="$1"
  local first_plugin

  first_plugin="$(codex::_enabled_plugin_ids "$codex_settings" | head -n 1)"
  if [[ -n "$first_plugin" ]]; then
    printf 'codex plugin add %s\n' "$first_plugin"
  else
    printf 'codex plugin add <plugin@marketplace>\n'
  fi
}

codex::_enabled_plugin_ids() {
  local codex_settings="$1"

  [[ -f "$codex_settings" ]] || return

  awk '
    function flush_plugin() {
      if (plugin != "" && enabled == 1) print plugin
    }
    /^\[plugins\."[^"]+"\][[:space:]]*$/ {
      flush_plugin()
      plugin = $0
      sub(/^\[plugins\."/,"",plugin)
      sub(/"\][[:space:]]*$/,"",plugin)
      enabled = 0
      next
    }
    /^\[/ {
      flush_plugin()
      plugin = ""
      enabled = 0
      next
    }
    plugin != "" && /^[[:space:]]*enabled[[:space:]]*=[[:space:]]*true([[:space:]]*(#.*)?)?$/ {
      enabled = 1
    }
    END {
      flush_plugin()
    }
  ' "$codex_settings"
}

codex::sync_plugins() {
  local codex_settings="$1"
  local plugin_id refreshed_plugins=0 failed=0 add_out failure_line

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] add enabled Codex plugins from SoT"
    return
  fi

  if ! command -v codex >/dev/null 2>&1; then
    warn "codex CLI not in PATH - deployed config/marketplace only; install current standalone Codex with: $(codex::_standalone_install_command); then run: $(codex::_manual_plugin_refresh_command "$codex_settings")"
    return
  fi

  while IFS= read -r plugin_id; do
    [[ -z "$plugin_id" ]] && continue

    if add_out=$(codex plugin add "$plugin_id" 2>&1); then
      refreshed_plugins=$((refreshed_plugins + 1))
    elif [[ "$add_out" == *"could not find a Codex CLI binary"* ]]; then
      warn "Codex plugin refresh hit a stale launcher/wrapper on PATH - install current standalone Codex with: $(codex::_standalone_install_command)"
      failed=$((failed + 1))
    else
      failure_line="$(codex::_first_line "$add_out")"
      warn "Codex plugin refresh failed for $plugin_id: ${failure_line:-unknown error}; run manually: codex plugin add $plugin_id"
      failed=$((failed + 1))
    fi
  done < <(codex::_enabled_plugin_ids "$codex_settings")

  if [[ "$refreshed_plugins" -gt 0 ]]; then
    log "Codex plugins synced (plugins: ~$refreshed_plugins)"
  fi
  if [[ "$failed" -gt 0 ]]; then
    warn "$failed Codex plugin operation(s) failed — re-run sync or install manually"
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
  echo "Restart Codex to load any refreshed plugins, skills, or tools."
}
