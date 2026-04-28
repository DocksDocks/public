#!/usr/bin/env bash
# capture.sh — extract per-agent token usage from a Claude Code session JSONL.
#
# Usage:
#   bash tests/baseline/capture.sh <session-uuid>     # specific session
#   bash tests/baseline/capture.sh                    # most recent session in this project
#
# Output: markdown table to stdout (per-agent totals + aggregate row).
# Each row: agent, status, in / out / cacheRead / cacheCreate / total tokens, wall-clock, tool-uses.
#
# To save findings to the roadmap baseline file:
#   bash tests/baseline/capture.sh > docs/roadmap/finished/$(date +%Y-%m-%d)-pipeline-baseline-measurement.md

set -euo pipefail

PROJECT_SLUG="-home-vagrant-projects-public"
SESSIONS_DIR="$HOME/.claude/projects/$PROJECT_SLUG"

if [[ ! -d "$SESSIONS_DIR" ]]; then
  echo "ERROR: sessions dir not found at $SESSIONS_DIR" >&2
  exit 1
fi

SESSION_UUID="${1:-}"

if [[ -z "$SESSION_UUID" ]]; then
  # Use most recent JSONL in the project
  SESSION_FILE=$(find "$SESSIONS_DIR" -maxdepth 1 -name '*.jsonl' -printf '%T@ %p\n' \
    | sort -rn | head -1 | cut -d' ' -f2-)
  if [[ -z "$SESSION_FILE" ]]; then
    echo "ERROR: no session JSONL files in $SESSIONS_DIR" >&2
    exit 1
  fi
  SESSION_UUID=$(basename "$SESSION_FILE" .jsonl)
else
  SESSION_FILE="$SESSIONS_DIR/$SESSION_UUID.jsonl"
  if [[ ! -f "$SESSION_FILE" ]]; then
    echo "ERROR: session file not found: $SESSION_FILE" >&2
    exit 1
  fi
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not installed" >&2
  exit 1
fi

KIT_SHA=$(git -C "$(dirname "$(realpath "$0")")/../.." rev-parse --short HEAD 2>/dev/null || echo unknown)
RUN_DATE=$(date +%Y-%m-%d)

echo "# Pipeline measurement — $RUN_DATE"
echo
echo "**Session:** \`$SESSION_UUID\`"
echo "**Kit commit:** \`$KIT_SHA\`"
echo "**Source JSONL:** \`$SESSION_FILE\`"
echo

echo "## Per-agent invocations"
echo
echo "| # | Agent | Status | In | Out | Cache read | Cache create | Total | Wall-clock | Tool calls |"
echo "|---|---|---|---:|---:|---:|---:|---:|---:|---:|"

# Extract every Agent tool invocation with usage data.
# Use jq to emit pipe-delimited rows; pipe through awk to compute totals + format.
jq -r '
  select(.toolUseResult? | type == "object")
  | select(.toolUseResult.agentType?)
  | [
      .toolUseResult.agentType,
      .toolUseResult.status,
      (.toolUseResult.usage.input_tokens // 0),
      (.toolUseResult.usage.output_tokens // 0),
      (.toolUseResult.usage.cache_read_input_tokens // 0),
      (.toolUseResult.usage.cache_creation_input_tokens // 0),
      (.toolUseResult.totalTokens // 0),
      (.toolUseResult.totalDurationMs // 0),
      (.toolUseResult.totalToolUseCount // 0)
    ]
  | @tsv
' "$SESSION_FILE" \
  | awk -F'\t' '
      BEGIN {
        n = 0
        tot_in = 0; tot_out = 0; tot_cr = 0; tot_cc = 0; tot_tok = 0; tot_ms = 0; tot_tools = 0
      }
      {
        n++
        agent = $1; status = $2
        in_t = $3; out_t = $4; cr = $5; cc = $6; tot = $7; ms = $8; tools = $9
        tot_in += in_t; tot_out += out_t; tot_cr += cr; tot_cc += cc
        tot_tok += tot; tot_ms += ms; tot_tools += tools
        secs = ms / 1000
        printf "| %d | %s | %s | %s | %s | %s | %s | %s | %.1fs | %s |\n", \
          n, agent, status, in_t, out_t, cr, cc, tot, secs, tools
      }
      END {
        printf "| | **Total (%d invocations)** | — | %d | %d | %d | %d | %d | %.1fs | %d |\n", \
          n, tot_in, tot_out, tot_cr, tot_cc, tot_tok, tot_ms / 1000, tot_tools
      }
    '

echo
echo "## Notes"
echo
echo "- Cache reads are highly compressed input; total token cost ≠ \`In\` alone — use the \`Total\` column for cost estimation."
echo "- Wall-clock is per-subagent end-to-end (includes tool-call I/O)."
echo "- Status \`pending\` means the subagent stopped without explicit completion (e.g. user interrupt or token-budget hit) — its row may be partial."
echo
echo "## Next steps"
echo
echo "1. If a worst-case agent's bootstrap-cost ratio is high (input ≫ output for an agent that produced little plan-file content), flag for T3-02 phase-merge analysis."
echo "2. Compare \`In\` vs \`Cache read\` per agent: high cache-read ratio means good prompt-cache hit; low means the agent re-bootstrapped fully."
echo "3. Sum the \`Total\` column to get session-wide token spend for the measured commands."
