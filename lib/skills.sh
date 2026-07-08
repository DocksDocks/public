#!/bin/bash
set -euo pipefail

# Source-order guards: this lib depends on common.sh's log/warn/err and on
# the entry script's REPO_DIR. Fail fast with a clear message if sourced standalone.
declare -F log >/dev/null 2>&1 || { printf '\033[1;31m[err]\033[0m %s\n' "lib/skills.sh must be sourced after lib/common.sh" >&2; exit 1; }
[[ -n "${REPO_DIR:-}" ]] || { printf '\033[1;31m[err]\033[0m %s\n' "REPO_DIR must be set before sourcing lib/skills.sh" >&2; exit 1; }

# Universal AI-agent skills bootstrap (agentskills.io standard).
# Reads SoT/.agents/skills.txt, runs `npx skills add` for each missing slug.
# Idempotent: pre-checks ~/.agents/skills/<basename> and skips if present.

skills::sync() {
  # AGENTS_DIR is initialized in lib/common.sh as a kit-global with env override.
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
  if [[ "$PRUNE" -eq 1 ]]; then
    skills::reconcile_removals
  fi
  skills::sync_agent_browser_cli
  skills::sync_effect_solutions_cli
  skills::update_snapshot
}

# Emit one cleaned slug per line from a manifest: skip blank/comment lines, strip
# inline #comments and ALL whitespace. Single source of truth so sync_universal,
# _load_slug_list, and update_snapshot can never diverge on parsing.
skills::_normalize_manifest() {
  awk '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    { sub(/[[:space:]]*#.*$/, ""); gsub(/[[:space:]]+/, ""); if (length($0)) print }
  ' "$1"
}

skills::sync_universal() {
  local slug basename added=0 already=0 failed=0 healed=0

  if ! command -v node >/dev/null 2>&1; then
    warn "node/npx not in PATH — skipping universal skills bootstrap (install Node.js to enable)"
    return
  fi

  # DRY_RUN branches only at the action point, so dry-run and real see the same
  # normalized slug set from skills::_normalize_manifest.
  while IFS= read -r slug; do
    basename="${slug##*/}"

    if [[ "$DRY_RUN" -eq 1 ]]; then
      if [[ -d "$SKILLS_DIR/$basename" ]]; then
        echo "[dry-run] universal skill present: $basename"
        skills::heal_claude_symlink "$basename" || true
      else
        echo "[dry-run] npx skills add $slug -g -y -a claude-code codex"
      fi
      continue
    fi

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
  done < <(skills::_normalize_manifest "$SKILLS_MANIFEST")

  [[ "$DRY_RUN" -eq 1 ]] && return

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

# toolchain::ensure callback for agent-browser. Upgrade = npm refresh only (the
# Chrome download is not repeated); first install also pulls Chrome for Testing.
skills::_agent_browser_install() {
  local mode="$1" verb="Installing"
  [[ "$mode" == "upgrade" ]] && verb="Upgrading"
  local install_flags=()
  case "$(uname -s)" in
    Linux*) install_flags+=(--with-deps) ;;  # may prompt sudo for libnss3/libatk
  esac

  log "$verb agent-browser CLI via npm..."
  if ! npm install -g agent-browser >/dev/null 2>&1; then
    warn "npm install -g agent-browser failed. Try manually: npm install -g agent-browser"
    return 1
  fi

  if [[ "$mode" == "install" ]]; then
    log "Downloading Chrome for Testing (~175 MB; sudo may be requested for system libs on Linux)..."
    if ! agent-browser install ${install_flags[@]+"${install_flags[@]}"}; then
      warn "agent-browser install failed. Re-run manually: agent-browser install ${install_flags[*]:-}"
      return 1
    fi
  fi
  log "agent-browser CLI ready ($(agent-browser --version 2>/dev/null | awk '{print $NF}' || echo 'version unknown'))"
}

skills::sync_agent_browser_cli() {
  # The agent-browser SKILL.md alone is just instructions — the CLI binary
  # is what drives Chrome. Auto-install on first run because the slug is
  # declared in skills.txt (declaration = "I want this on every machine").
  grep -q '^vercel-labs/agent-browser$' "$SKILLS_MANIFEST" 2>/dev/null || return 0

  if ! command -v npm >/dev/null 2>&1; then
    [[ "$DRY_RUN" -eq 1 ]] || warn "npm not found — cannot auto-install agent-browser CLI. Install Node.js, then re-run sync."
    return
  fi

  # `|| warn`: a failed npm install must not abort the remaining skills sync
  # (snapshot write, effect-solutions) under set -e.
  toolchain::ensure agent-browser skills::_agent_browser_install || warn "agent-browser bootstrap failed — continuing sync"
}

# Resolve a usable `bun` binary. `bun` lives in ~/.bun/bin, which is off the
# non-interactive PATH that sync/agent shells use, so `command -v` alone misses
# a perfectly good install. Fall back to the known install locations.
skills::_find_bun() {
  local c
  c="$(command -v bun 2>/dev/null || true)"
  [[ -n "$c" ]] && { printf '%s\n' "$c"; return 0; }
  for c in "${BUN_INSTALL:-$HOME/.bun}/bin/bun" "$HOME/.bun/bin/bun"; do
    [[ -x "$c" ]] && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

# effect-solutions is the optional ground-truth Effect docs CLI the effect-kit
# skills consult opportunistically. It ships as a Bun bin with a
# `#!/usr/bin/env bun` shebang, so BOTH `bun` and the CLI must be on PATH to
# run it. bun's global bin (~/.cache/.bun/bin or ~/.bun/bin, depending on
# BUN_INSTALL/XDG_CACHE_HOME) and bun itself sit off the non-interactive PATH,
# and ~/.bashrc's "if not interactive, return" guard means rc PATH edits never
# reach agent shells. So we symlink both binaries into ~/.local/bin — already
# first on the agent PATH, matching Codex's official standalone install path. Gated on
# effect-kit being enabled in SoT; auto-installs Bun when absent (download-
# then-run, per the kit's no-`curl|bash` rule).
# Bootstrap Bun itself (download-then-run, per the kit's no-`curl|bash` rule).
# Echoes the bun path on success. Shared toolchain callback material: also used
# directly when only Bun is missing.
skills::_bun_bootstrap() {
  local bun tmp_bun_installer
  if bun="$(skills::_find_bun)"; then
    printf '%s\n' "$bun"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    warn "Bun and curl both missing — cannot bootstrap Bun. Install Bun manually, then re-run sync."
    return 1
  fi
  warn "Bun not found — installing Bun..."
  tmp_bun_installer=$(mktemp 2>/dev/null || echo "/tmp/bun-install-$$.sh")
  curl -fsSL https://bun.sh/install -o "$tmp_bun_installer" && bash "$tmp_bun_installer" >/dev/null 2>&1 || true
  rm -f "$tmp_bun_installer"
  if ! bun="$(skills::_find_bun)"; then
    warn "Bun install failed. Install manually: curl -fsSL https://bun.sh/install -o /tmp/bun.sh && bash /tmp/bun.sh"
    return 1
  fi
  log "Bun installed ($("$bun" --version 2>/dev/null || echo 'version unknown'))"
  printf '%s\n' "$bun"
}

# toolchain::ensure callback for effect-solutions: install and upgrade are the
# same idempotent `bun add -g @latest` (bun resolves the newest release either
# way) — the toolchain `track` policy is what finally gives this CLI the
# self-upgrade that agent-browser always had.
skills::_effect_solutions_install() {
  local mode="$1" verb="Installing"
  [[ "$mode" == "upgrade" ]] && verb="Upgrading"
  local bun gbin

  bun="$(skills::_bun_bootstrap)" || return 1

  log "$verb effect-solutions CLI via bun..."
  if ! "$bun" add -g effect-solutions@latest >/dev/null 2>&1; then
    warn "bun add -g effect-solutions failed. Try manually: bun add -g effect-solutions@latest"
    return 1
  fi

  # `bun pm -g bin` is the authoritative global-bin query (path varies with
  # BUN_INSTALL/XDG_CACHE_HOME). Link the CLI and bun itself so the shebang
  # resolves in non-interactive agent shells.
  gbin="$("$bun" pm -g bin 2>/dev/null || true)"
  if [[ -n "$gbin" && -x "$gbin/effect-solutions" ]]; then
    mkdir -p "$HOME/.local/bin"
    ln -sf "$bun" "$HOME/.local/bin/bun"
    ln -sf "$gbin/effect-solutions" "$HOME/.local/bin/effect-solutions"
    log "effect-solutions CLI ready (linked bun + effect-solutions into ~/.local/bin)"
  else
    warn "effect-solutions installed but binary not found under '${gbin:-<unknown>}' — link it onto PATH manually"
  fi
}

skills::sync_effect_solutions_cli() {
  local settings="$REPO_DIR/SoT/.claude/settings.json"
  grep -Eq '"effect-kit@docks"[[:space:]]*:[[:space:]]*true' "$settings" 2>/dev/null || return 0

  toolchain::ensure effect-solutions skills::_effect_solutions_install || warn "effect-solutions bootstrap failed — continuing sync"
}

# Populate <array_name> with stripped, non-empty slugs from <file>. Supports
# both manifest format (4-step strip + comment handling) and snapshot format
# (one slug per line, no comments — strip is a safe no-op).
skills::_load_slug_list() {
  local file="$1" array_name="$2" slug
  while IFS= read -r slug; do
    eval "$array_name+=(\"\$slug\")"
  done < <(skills::_normalize_manifest "$file")
}

# Uninstall a single snapshot slug from the universal CLI. Increments the
# caller's <ok_var>/<fail_var> via eval (bash 3.2-safe; no namerefs).
skills::_remove_one_slug() {
  local slug="$1" ok_var="$2" fail_var="$3" basename="${1##*/}"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] kit-managed skill no longer in SoT — would remove: $basename"
    return
  fi
  if npx --yes skills remove --global -y -a '*' -s "$basename" >/dev/null 2>&1; then
    eval "$ok_var=\$(( \$$ok_var + 1 ))"
  else
    warn "Failed to remove kit-managed skill: $basename"
    eval "$fail_var=\$(( \$$fail_var + 1 ))"
  fi
}

skills::reconcile_removals() {
  # Uninstall kit-managed skills (tracked in $SKILLS_SNAPSHOT) that are no longer
  # declared in $SKILLS_MANIFEST. Never touches user-installed skills (not in
  # snapshot) or CLI auto-installed meta-skills like find-skills.
  local slug removed=0 failed=0
  local -a current_slugs=()
  local -a snapshot_slugs=()

  if [[ ! -f "$SKILLS_SNAPSHOT" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] (--prune) no kit-managed-skills snapshot yet; first real sync writes $SKILLS_SNAPSHOT, then future --prune runs reconcile against it"
    fi
    return
  fi

  skills::_load_slug_list "$SKILLS_MANIFEST" current_slugs
  skills::_load_slug_list "$SKILLS_SNAPSHOT" snapshot_slugs

  for slug in ${snapshot_slugs[@]+"${snapshot_slugs[@]}"}; do
    if [[ ${#current_slugs[@]} -gt 0 ]] && printf '%s\n' "${current_slugs[@]}" | grep -qx "$slug"; then
      continue
    fi
    skills::_remove_one_slug "$slug" removed failed
  done

  if [[ "$removed" -gt 0 ]]; then
    log "Kit-managed skills removed (-$removed)"
  fi
  if [[ "$failed" -gt 0 ]]; then
    warn "$failed skill remove(s) failed — re-run with --prune or run: npx skills remove -g -y -a '*' -s <name>"
  fi
}

skills::update_snapshot() {
  # Persist the current set of kit-declared slugs so the next --prune
  # pass can detect removed entries. Format: one slug per line, sorted, stable.
  [[ "$DRY_RUN" -eq 1 ]] && return

  mkdir -p "$AGENTS_DIR"
  skills::_normalize_manifest "$SKILLS_MANIFEST" | sort -u > "$SKILLS_SNAPSHOT"
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
