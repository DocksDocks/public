#!/bin/bash
# install.sh — global docks-kit install.
# Recommended invocation (download-then-run, never `curl | bash`):
#   curl -fsSL https://raw.githubusercontent.com/DocksDocks/public/main/install.sh -o /tmp/docks-kit-install.sh
#   bash /tmp/docks-kit-install.sh && rm /tmp/docks-kit-install.sh
# Installs Bun when absent, then `bun add -g docks-kit@latest` and links the
# CLI + bun into ~/.local/bin (the dir reliably on non-interactive PATHs).
set -euo pipefail

# BEGIN GENERATED BUN PIN
BUN_PIN="1.3.14"
# END GENERATED BUN PIN

log()  { printf '\033[1;32m[ok]\033[0m %s\n'   "$1" >&2; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$1" >&2; }
err()  { printf '\033[1;31m[err]\033[0m %s\n'  "$1" >&2; }

find_bun() {
  local c
  c="$(command -v bun 2>/dev/null || true)"
  [[ -n "$c" ]] && { printf '%s\n' "$c"; return 0; }
  for c in "${BUN_INSTALL:-$HOME/.bun}/bin/bun" "$HOME/.bun/bin/bun" "$HOME/.local/bin/bun"; do
    [[ -x "$c" ]] && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

link_if_distinct() {
  local source="$1"
  local destination="$2"
  if [[ "$source" -ef "$destination" ]]; then
    return 0
  fi
  ln -sf "$source" "$destination"
}

path_has_entry() {
  local entry="$1"
  [[ ":${PATH:-}:" == *":${entry}:"* ]]
}

if ! BUN="$(find_bun)"; then
  command -v curl >/dev/null 2>&1 || { err "curl is required to bootstrap Bun. Install Bun manually: https://bun.sh"; exit 1; }
  warn "Bun not found — installing (download-then-run)..."
  tmp_installer=$(mktemp 2>/dev/null || echo "/tmp/bun-install-$$.sh")
  curl -fsSL https://bun.sh/install -o "$tmp_installer" && bash "$tmp_installer" "bun-v$BUN_PIN" >/dev/null 2>&1 || true
  rm -f "$tmp_installer"
  BUN="$(find_bun)" || { err "Bun install failed. Install manually: https://bun.sh"; exit 1; }
  log "Bun installed ($("$BUN" --version 2>/dev/null || echo 'version unknown'))"
fi

log "Installing docks-kit via bun..."
"$BUN" add -g docks-kit@latest

if ! gbin="$("$BUN" pm -g bin 2>/dev/null)"; then
  err "Bun could not report its global binary directory."
  exit 1
fi
if [[ -z "$gbin" || ! -x "$gbin/docks-kit" ]]; then
  err "The installed docks-kit binary was not found under '${gbin:-<unknown>}'."
  exit 1
fi

mkdir -p "$HOME/.local/bin"
link_if_distinct "$BUN" "$HOME/.local/bin/bun"
link_if_distinct "$gbin/docks-kit" "$HOME/.local/bin/docks-kit"
log "docks-kit installed (linked into ~/.local/bin)"

if path_has_entry "$HOME/.local/bin"; then
  log "docks-kit ready"
  log "Next: docks-kit sync   (or docks-kit docs overview)"
else
  warn "Add ~/.local/bin to PATH before running docks-kit:"
  printf 'export PATH="%s/.local/bin:$PATH"\n' "$HOME" >&2
fi
