#!/bin/bash
set -euo pipefail

# Universal AI-agent skills bootstrap (agentskills.io standard).
# Reads SoT/.agents/skills.txt, runs `npx skills add` for each missing slug.
# Idempotent: pre-checks ~/.agents/skills/<basename> and skips if present.

skills::sync() {
  AGENTS_DIR="$HOME/.agents"
  # The kit installs each skill for claude-code + codex (its SoT support
  # matrix). Naming two agents makes the CLI keep the canonical copy at the
  # universal ~/.agents/skills/ path — that's what our checks track.
  SKILLS_DIR="$AGENTS_DIR/skills"
  SKILLS_MANIFEST="$REPO_DIR/SoT/.agents/skills.txt"
  SKILLS_SNAPSHOT="$AGENTS_DIR/.kit-managed-skills"
  SKILLS_SYNCED=1

  [[ -f "$SKILLS_MANIFEST" ]] || return

  # A fresh machine may not have ~/.agents/skills/ yet; create it so the
  # pre-check below has a dir to stat (the CLI also creates it on install).
  [[ "$DRY_RUN" -eq 1 ]] || mkdir -p "$SKILLS_DIR"

  skills::sync_universal
  if [[ "$REMOVE_PLUGINS" -eq 1 ]]; then
    skills::reconcile_removals
  fi
  skills::sync_agent_browser_cli
  skills::update_snapshot
}

skills::sync_universal() {
  local slug basename added=0 already=0 failed=0 healed=0

  if ! command -v node >/dev/null 2>&1; then
    warn "node/npx not in PATH — skipping universal skills bootstrap (install Node.js to enable)"
    return
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    while IFS= read -r slug; do
      [[ -z "$slug" || "$slug" =~ ^[[:space:]]*# ]] && continue
      slug="${slug%%#*}"
      slug="${slug// /}"
      basename="${slug##*/}"
      if [[ -d "$SKILLS_DIR/$basename" ]]; then
        echo "[dry-run] universal skill present: $basename"
        skills::heal_claude_symlink "$basename" || true
      else
        echo "[dry-run] npx skills add $slug -g -y -a claude-code codex"
      fi
    done < "$SKILLS_MANIFEST"
    return
  fi

  while IFS= read -r slug; do
    [[ -z "$slug" || "$slug" =~ ^[[:space:]]*# ]] && continue
    slug="${slug%%#*}"
    slug="${slug// /}"
    [[ -z "$slug" ]] && continue
    basename="${slug##*/}"

    if [[ -d "$SKILLS_DIR/$basename" ]]; then
      already=$((already + 1))
      if skills::heal_claude_symlink "$basename"; then
        healed=$((healed + 1))
      fi
      continue
    fi

    # <source> is positional and MUST precede the variadic -a/--agent flag,
    # or --agent swallows the slug. Naming both agents (claude-code codex)
    # makes the CLI keep the canonical ~/.agents/skills/ copy and symlink it
    # into ~/.claude/skills/; a single agent would copy-direct instead.
    if npx --yes skills add "$slug" -g -y -a claude-code codex >/dev/null 2>&1; then
      added=$((added + 1))
    else
      warn "Failed to install universal skill: $slug"
      failed=$((failed + 1))
    fi
  done < "$SKILLS_MANIFEST"

  SKILLS_PRESENT=$((added + already))

  if [[ "$added" -gt 0 ]]; then
    log "Universal skills synced (+$added new, $already already present)"
  else
    log "Universal skills already in sync ($already present)"
  fi
  if [[ "$healed" -gt 0 ]]; then
    log "Claude per-tool symlinks healed (+$healed) — canonical present, ~/.claude/skills/<name> was missing or broken"
  fi
  if [[ "$failed" -gt 0 ]]; then
    warn "$failed skill install(s) failed — re-run sync or install manually with: npx skills add <slug> -g -y -a claude-code codex"
  fi
}

# Recreate ~/.claude/skills/<basename> → ../../.agents/skills/<basename>
# when canonical exists but the per-tool symlink is missing or broken.
# Matches the relative path the upstream `skills` CLI writes
# (vercel-labs/skills installer.ts:createSymlink uses relative(parentDir, target)).
# Idempotent: leaves correct symlinks alone; replaces stale/broken symlinks.
# Skips real (non-symlink) directories to avoid destroying user content.
# Returns 0 when a heal occurred, 1 otherwise (so callers can tally).
skills::heal_claude_symlink() {
  local basename="$1"
  local canonical="$SKILLS_DIR/$basename"
  local claude_skills_dir="$HOME/.claude/skills"
  local claude_link="$claude_skills_dir/$basename"
  local rel_target="../../.agents/skills/$basename"

  [[ -d "$canonical" ]] || return 1

  if [[ -L "$claude_link" ]]; then
    local current
    current="$(readlink "$claude_link" 2>/dev/null || true)"
    if [[ "$current" == "$rel_target" ]]; then
      return 1
    fi
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] would replace stale Claude symlink: ~/.claude/skills/$basename -> $current  (correct: $rel_target)"
      return 0
    fi
    rm -f "$claude_link"
  elif [[ -e "$claude_link" ]]; then
    warn "~/.claude/skills/$basename exists as a real path (not a symlink) — leaving alone; remove manually if it's stale"
    return 1
  else
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] would create missing Claude symlink: ~/.claude/skills/$basename -> $rel_target"
      return 0
    fi
  fi

  mkdir -p "$claude_skills_dir"
  ln -s "$rel_target" "$claude_link"
  return 0
}

skills::sync_agent_browser_cli() {
  # The agent-browser SKILL.md alone is just instructions — the CLI binary
  # is what drives Chrome. Auto-install on first run because the slug is
  # declared in skills.txt (declaration = "I want this on every machine").
  local install_flags=()
  case "$(uname -s)" in
    Linux*) install_flags+=(--with-deps) ;;  # may prompt sudo for libnss3/libatk
  esac

  grep -q '^vercel-labs/agent-browser$' "$SKILLS_MANIFEST" 2>/dev/null || return 0

  if [[ "$DRY_RUN" -eq 1 ]]; then
    if command -v agent-browser >/dev/null 2>&1; then
      echo "[dry-run] agent-browser CLI present"
    else
      echo "[dry-run] would install: npm install -g agent-browser"
      echo "[dry-run] would install: agent-browser install ${install_flags[*]:-}"
    fi
    return
  fi

  if command -v agent-browser >/dev/null 2>&1; then
    log "agent-browser CLI present ($(agent-browser --version 2>/dev/null || echo 'version unknown'))"
    return
  fi

  if ! command -v npm >/dev/null 2>&1; then
    warn "npm not found — cannot auto-install agent-browser CLI. Install Node.js, then re-run sync."
    return
  fi

  log "Installing agent-browser CLI via npm..."
  if ! npm install -g agent-browser >/dev/null 2>&1; then
    warn "npm install -g agent-browser failed. Try manually: npm install -g agent-browser"
    return
  fi

  log "Downloading Chrome for Testing (~175 MB; sudo may be requested for system libs on Linux)..."
  if agent-browser install ${install_flags[@]+"${install_flags[@]}"}; then
    log "agent-browser CLI ready ($(agent-browser --version 2>/dev/null || echo 'version unknown'))"
  else
    warn "agent-browser install failed. Re-run manually: agent-browser install ${install_flags[*]:-}"
  fi
}

skills::reconcile_removals() {
  # Uninstall kit-managed skills (tracked in $SKILLS_SNAPSHOT) that are no longer
  # declared in $SKILLS_MANIFEST. Never touches user-installed skills (not in
  # snapshot) or CLI auto-installed meta-skills like find-skills.
  local slug basename removed=0 failed=0
  local -a current_slugs=()
  local -a snapshot_slugs=()

  if [[ ! -f "$SKILLS_SNAPSHOT" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] (--remove-plugins) no kit-managed-skills snapshot yet; first real sync writes $SKILLS_SNAPSHOT, then future --remove-plugins runs reconcile against it"
    fi
    return
  fi

  while IFS= read -r slug; do
    [[ -z "$slug" || "$slug" =~ ^[[:space:]]*# ]] && continue
    slug="${slug%%#*}"
    slug="${slug// /}"
    [[ -n "$slug" ]] && current_slugs+=("$slug")
  done < "$SKILLS_MANIFEST"

  while IFS= read -r slug; do
    [[ -n "$slug" ]] && snapshot_slugs+=("$slug")
  done < "$SKILLS_SNAPSHOT"

  for slug in ${snapshot_slugs[@]+"${snapshot_slugs[@]}"}; do
    if [[ ${#current_slugs[@]} -gt 0 ]] && printf '%s\n' "${current_slugs[@]}" | grep -qx "$slug"; then
      continue
    fi
    basename="${slug##*/}"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] kit-managed skill no longer in SoT — would remove: $basename"
      continue
    fi
    if npx --yes skills remove --global -y -a '*' -s "$basename" >/dev/null 2>&1; then
      removed=$((removed + 1))
    else
      warn "Failed to remove kit-managed skill: $basename"
      failed=$((failed + 1))
    fi
  done

  if [[ "$removed" -gt 0 ]]; then
    log "Kit-managed skills removed (-$removed)"
  fi
  if [[ "$failed" -gt 0 ]]; then
    warn "$failed skill remove(s) failed — re-run with --remove-plugins or run: npx skills remove -g -y -a '*' -s <name>"
  fi
}

skills::update_snapshot() {
  # Persist the current set of kit-declared slugs so the next --remove-plugins
  # pass can detect removed entries. Format: one slug per line, sorted, stable.
  [[ "$DRY_RUN" -eq 1 ]] && return

  mkdir -p "$AGENTS_DIR"
  awk '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    { sub(/[[:space:]]*#.*$/, ""); gsub(/[[:space:]]+/, ""); if (length($0)) print }
  ' "$SKILLS_MANIFEST" | sort -u > "$SKILLS_SNAPSHOT"
}

skills::summary() {
  [[ "${SKILLS_SYNCED:-0}" -eq 1 ]] || return
  echo "Skills:   ${SKILLS_DIR:-$HOME/.agents/skills}"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    # SKILLS_PRESENT comes from skills::sync_universal's own tally; a bare
    # `find` over ~/.agents/skills/ would also count user-installed skills.
    echo "          ${SKILLS_PRESENT:-0} universal skill(s) installed"
  fi
}

skills::next_steps() {
  [[ "${SKILLS_SYNCED:-0}" -eq 1 ]] || return
  echo "Restart Claude Code (and Codex) to discover newly installed universal skills."
}
