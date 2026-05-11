#!/bin/bash
# Auto-disable Claude.ai MCP connectors for the current project on session start.
#
# Workaround for the still-unfixed env-var path:
#   https://github.com/anthropics/claude-code/issues/45158
#   https://github.com/anthropics/claude-code/issues/20412
#
# Mechanism: patches ~/.claude.json projects[$cwd].disabledMcpServers — the only
# claude.ai-connector disable path that survives auth-sync round-trips.
# Idempotent: safe to fire on every startup (deduplicates the array).
#
# Edit CONNECTORS to taste. Names use the literal "claude.ai <Name>" format
# (with the dot and the space) — that's the format Claude Code stores them in.
# Inspect existing names with:
#   jq -r '.projects[] | (.disabledMcpServers // [])[]' ~/.claude.json | sort -u

set -euo pipefail

CLAUDE_JSON="$HOME/.claude.json"
[ ! -f "$CLAUDE_JSON" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

CONNECTORS='["claude.ai Asana","claude.ai Gmail","claude.ai Google Calendar","claude.ai Google Drive"]'

CWD=$(jq -r '.cwd // empty' < /dev/stdin 2>/dev/null || true)
[ -z "$CWD" ] || [ "$CWD" = "null" ] && exit 0

TMP="$(mktemp)"
jq --arg cwd "$CWD" --argjson connectors "$CONNECTORS" '
  .projects[$cwd].disabledMcpServers = (
    (.projects[$cwd].disabledMcpServers // []) + $connectors | unique
  )
' "$CLAUDE_JSON" > "$TMP" && mv "$TMP" "$CLAUDE_JSON"

exit 0
