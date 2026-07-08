#!/bin/bash
set -euo pipefail

# Source-order guards: this lib depends on common.sh's log/warn/err and on
# the entry script's REPO_DIR. Fail fast with a clear message if sourced standalone.
declare -F log >/dev/null 2>&1 || { printf '\033[1;31m[err]\033[0m %s\n' "lib/toolchain.sh must be sourced after lib/common.sh" >&2; exit 1; }
[[ -n "${REPO_DIR:-}" ]] || { printf '\033[1;31m[err]\033[0m %s\n' "REPO_DIR must be set before sourcing lib/toolchain.sh" >&2; exit 1; }

# Verified-version-floor layer over the external toolchain (SoT/toolchain.json).
# The manifest holds DATA (kind/policy/floor/verified/pinnable); this lib owns
# the generic compare/gate/prompt machinery; tool-specific install commands stay
# in their owning lib (claude.sh knows rtk, skills.sh knows bun/agent-browser/
# effect-solutions) and are passed to toolchain::ensure as callbacks.

toolchain::_manifest() { printf '%s' "$REPO_DIR/SoT/toolchain.json"; }

toolchain::field() {
  local tool="$1" field="$2"
  jq -r --arg t "$tool" --arg f "$field" '.tools[$t][$f] // empty' "$(toolchain::_manifest)" 2>/dev/null
}

# Strictly-newer semver-ish compare (numeric per dotted field, like the old
# skills::_agent_browser_newer_npm) — returns 0 when $1 > $2. Deliberately not
# `sort -V` (absent on older BSD/macOS sort).
toolchain::_is_newer() {
  local a="$1" b="$2" newer
  [[ -n "$a" && -n "$b" && "$a" != "$b" ]] || return 1
  newer=$(printf '%s\n%s\n' "$a" "$b" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n1)
  [[ "$newer" == "$a" ]]
}

# Presence probe. bun gets install-path fallbacks: it lives off the
# non-interactive PATH (~/.bun/bin), so `command -v` alone misses real installs.
toolchain::present() {
  local tool="$1"
  case "$tool" in
    bun) command -v bun >/dev/null 2>&1 || [[ -x "${BUN_INSTALL:-$HOME/.bun}/bin/bun" || -x "$HOME/.bun/bin/bun" ]] ;;
    *)   command -v "$tool" >/dev/null 2>&1 ;;
  esac
}

# Installed version, best-effort; empty when the tool is missing or the version
# is unparseable (ensure treats present-but-unparseable under `track` as stale
# and refreshes — self-healing rather than silently never upgrading).
toolchain::installed_version() {
  # Every arm is `|| true`-guarded: callers assign via $(...) under
  # set -e/pipefail, so a no-match grep or failing --version must never
  # propagate a non-zero status — missing/unparseable just means empty output.
  local tool="$1" bunbin
  toolchain::present "$tool" || return 0
  case "$tool" in
    rtk)            rtk --version 2>/dev/null | awk '{print $2}' || true ;;
    claude)         claude --version 2>/dev/null | awk '{print $1}' || true ;;
    codex)          codex --version 2>/dev/null | awk '{print $NF}' || true ;;
    bun)            { command -v bun >/dev/null 2>&1 && bun --version || "$HOME/.bun/bin/bun" --version; } 2>/dev/null || true ;;
    agent-browser)  agent-browser --version 2>/dev/null | awk '{print $NF}' || true ;;
    effect-solutions)
      bunbin="$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"
      [[ -x "$bunbin" ]] && "$bunbin" pm -g ls 2>/dev/null | grep -oE 'effect-solutions@[0-9][0-9.]*' | head -1 | cut -d@ -f2 || true ;;
    node)           node --version 2>/dev/null | sed 's/^v//' || true ;;
    npm)            npm --version 2>/dev/null || true ;;
    jq)             jq --version 2>/dev/null | sed 's/^jq-//' || true ;;
    curl)           curl --version 2>/dev/null | awk 'NR==1{print $2}' || true ;;
    tsc)            tsc --version 2>/dev/null | awk '{print $2}' || true ;;
    *)              : ;;
  esac
  return 0
}

# Latest available version for managed tools; empty = unknown/offline (ensure
# then leaves the installed tool alone). Network calls capped at 5s.
toolchain::latest_version() {
  local tool="$1"
  case "$tool" in
    rtk)
      curl -fsSL --max-time 5 "https://api.github.com/repos/rtk-ai/rtk/releases/latest" 2>/dev/null \
        | jq -r '.tag_name // empty' 2>/dev/null | sed 's/^v//' || true ;;
    agent-browser|effect-solutions)
      command -v npm >/dev/null 2>&1 && npm view "$tool" version 2>/dev/null || true ;;
    *) : ;;
  esac
  return 0
}

# Gate a candidate install/upgrade against the kit-verified version. Echoes the
# version to install ("" = latest) and returns 0 to proceed, 1 to skip.
#   mode=install : tool missing — a decline falls back to the pinned `verified`
#                  when pinnable (the machine still needs the tool)
#   mode=upgrade : a decline stays on the installed version
toolchain::_gate() {
  local tool="$1" mode="$2" latest="$3"
  local verified pinnable answer
  verified=$(toolchain::field "$tool" verified)
  pinnable=$(toolchain::field "$tool" pinnable)

  if [[ -z "$verified" ]] || ! toolchain::_is_newer "$latest" "$verified"; then
    echo ""; return 0
  fi

  if [[ "$ASSUME_YES" -eq 1 ]]; then
    warn "$tool $latest is newer than kit-verified $verified — proceeding (--yes)"
    echo ""; return 0
  fi

  if [[ -t 0 ]]; then
    printf '\033[1;33m[warn]\033[0m %s\n' "$tool $latest is not kit-verified (verified: $verified)." >&2
    read -r -p "Install $tool $latest anyway? [y/N] " answer
    case "$answer" in
      [yY]*) echo ""; return 0 ;;
    esac
  fi

  if [[ "$mode" == "install" && "$pinnable" == "true" ]]; then
    warn "installing kit-verified $tool $verified instead of $latest"
    echo "$verified"; return 0
  fi
  warn "skipping $tool ${mode} (latest $latest is above kit-verified $verified; pass --yes to accept, or update SoT/toolchain.json after testing)"
  return 1
}

# Ensure a managed tool per manifest policy. install_fn is called as:
#   <install_fn> <install|upgrade> <version>   (empty version = latest)
toolchain::ensure() {
  local tool="$1" install_fn="$2"
  local policy installed latest target

  policy=$(toolchain::field "$tool" policy)

  if ! toolchain::present "$tool"; then
    latest=$(toolchain::latest_version "$tool")
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] would install $tool (${latest:-latest}, gated by toolchain.json verified pin)"
      return 0
    fi
    if [[ -z "$latest" ]]; then
      # Latest unknown (offline/rate-limited): the gate can't compare, so an
      # empty target would install unverified latest. Pin the kit-verified
      # version when we can; otherwise install latest with an explicit warn.
      target=$(toolchain::field "$tool" verified)
      if [[ -n "$target" && "$(toolchain::field "$tool" pinnable)" == "true" ]]; then
        warn "$tool latest version unknown (offline?) — installing kit-verified $target instead"
      else
        target=""
        warn "$tool latest version unknown (offline?) and not pinnable — installing latest unverified"
      fi
    else
      target=$(toolchain::_gate "$tool" install "$latest") || return 0
    fi
    # ${target:-$latest}: install the exact version the gate approved, not a
    # floating "latest" that may have moved since the check.
    "$install_fn" install "${target:-$latest}"
    return $?
  fi

  installed=$(toolchain::installed_version "$tool")

  if [[ "$policy" != "track" ]]; then
    [[ "$DRY_RUN" -eq 1 ]] && { echo "[dry-run] $tool present (${installed:-version unknown})"; return 0; }
    log "$tool present (${installed:-version unknown})"
    return 0
  fi

  latest=$(toolchain::latest_version "$tool")
  if [[ -z "$latest" ]]; then
    [[ "$DRY_RUN" -eq 1 ]] && { echo "[dry-run] $tool present (${installed:-version unknown}); latest unknown (offline?) — no action"; return 0; }
    log "$tool present (${installed:-version unknown}; latest unknown — no action)"
    return 0
  fi

  # Present but version unparseable → refresh to a known state.
  if [[ -z "$installed" ]] || toolchain::_is_newer "$latest" "$installed"; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] would upgrade $tool (${installed:-unknown} -> $latest, gated by toolchain.json verified pin)"
      return 0
    fi
    target=$(toolchain::_gate "$tool" upgrade "$latest") || return 0
    "$install_fn" upgrade "${target:-$latest}"
    return $?
  fi

  [[ "$DRY_RUN" -eq 1 ]] && { echo "[dry-run] $tool up to date ($installed)"; return 0; }
  log "$tool up to date ($installed)"
}

# Doctor table over every manifest tool (also consumed by `docks-kit status`).
# Status: ok | missing | below-floor(<floor>) | above-verified(<verified>).
toolchain::report() {
  local tool kind os floor verified installed status
  printf '%-28s %-9s %-14s %-9s %-9s %s\n' "TOOL" "KIND" "INSTALLED" "FLOOR" "VERIFIED" "STATUS"
  while IFS= read -r tool; do
    os=$(toolchain::field "$tool" os)
    if [[ -n "$os" ]]; then
      case "$(uname -s)" in
        Linux*)  [[ "$os" == "linux" ]]  || continue ;;
        Darwin*) [[ "$os" == "darwin" ]] || continue ;;
      esac
    fi
    kind=$(toolchain::field "$tool" kind)
    floor=$(toolchain::field "$tool" floor)
    verified=$(toolchain::field "$tool" verified)
    if [[ "$kind" == "pin" ]]; then
      # No binary to probe — the tool is invoked via npx at the pinned version.
      printf '%-28s %-9s %-14s %-9s %-9s %s\n' \
        "$tool" "$kind" "(npx)" "${floor:--}" "${verified:--}" "pinned"
      continue
    fi
    if toolchain::present "$tool"; then
      installed=$(toolchain::installed_version "$tool")
      status="ok"
      if [[ -n "$floor" && -n "$installed" ]] && toolchain::_is_newer "$floor" "$installed"; then
        status="below-floor"
      elif [[ -n "$verified" && -n "$installed" ]] && toolchain::_is_newer "$installed" "$verified"; then
        status="above-verified"
      fi
    else
      installed="-"
      status="missing"
    fi
    printf '%-28s %-9s %-14s %-9s %-9s %s\n' \
      "$tool" "${kind:--}" "${installed:-?}" "${floor:--}" "${verified:--}" "$status"
  done < <(jq -r '.tools | keys[]' "$(toolchain::_manifest)")
}
