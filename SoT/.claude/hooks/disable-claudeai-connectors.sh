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

# Broad default: common claude.ai connectors. Listing a connector you don't have
# is a harmless no-op (Claude Code only disables names that match a real connector),
# so this errs toward off. Delete a line to KEEP that connector enabled in Code.
CONNECTORS='[
  "claude.ai Asana",
  "claude.ai Atlassian",
  "claude.ai Box",
  "claude.ai Canva",
  "claude.ai ClickUp",
  "claude.ai Cloudflare",
  "claude.ai Dropbox",
  "claude.ai Excalidraw",
  "claude.ai Figma",
  "claude.ai Gmail",
  "claude.ai Google Calendar",
  "claude.ai Google Drive",
  "claude.ai HubSpot",
  "claude.ai Intercom",
  "claude.ai Linear",
  "claude.ai Microsoft Learn",
  "claude.ai Notion",
  "claude.ai PayPal",
  "claude.ai Sentry",
  "claude.ai Slack",
  "claude.ai Socket",
  "claude.ai Square",
  "claude.ai Stripe",
  "claude.ai Vercel",
  "claude.ai Zapier"
]'

CWD=$(jq -r '.cwd // empty' < /dev/stdin 2>/dev/null || true)
[ -z "$CWD" ] || [ "$CWD" = "null" ] && exit 0

TMP="$(mktemp)"
jq --arg cwd "$CWD" --argjson connectors "$CONNECTORS" '
  .projects[$cwd].disabledMcpServers = (
    (.projects[$cwd].disabledMcpServers // []) + $connectors | unique
  )
' "$CLAUDE_JSON" > "$TMP" && mv "$TMP" "$CLAUDE_JSON"

exit 0
