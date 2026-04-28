#!/usr/bin/env bash
# run.sh — automated baseline-measurement runner.
#
# Spawns a fresh `claude -p` session against a copy of the baseline fixture,
# captures the session JSONL via capture.sh, prints a measurement table.
#
# Auth: uses your Claude subscription (Max/Pro/Team/Enterprise) by default —
# tokens count against your subscription's session/day quota, not the API.
# To force API billing instead, set ANTHROPIC_API_KEY before invoking
# (per Claude Code auth precedence, an API key in env always wins in -p mode).
#
# Usage:
#   bash tests/baseline/run.sh                  # default: /refactor
#   bash tests/baseline/run.sh /security        # specific command
#   bash tests/baseline/run.sh /refactor --dry-run
#
# Output: per-agent token-cost table to stdout.
# Save to a roadmap finished/ file:
#   bash tests/baseline/run.sh > docs/roadmap/finished/$(date +%F)-pipeline-baseline-measurement.md

set -euo pipefail

CMD="${1:-/refactor}"
DRY_RUN=false
if [[ "${2:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# Resolve kit root (script is at tests/baseline/run.sh, so kit root is two up)
SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
KIT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURE_SRC="$KIT_ROOT/tests/fixtures/nextjs-16-baseline"
TARGET=/tmp/baseline-target

if [[ ! -d "$FIXTURE_SRC" ]]; then
  echo "ERROR: fixture not found at $FIXTURE_SRC" >&2
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: claude CLI not in PATH" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not installed" >&2
  exit 1
fi

# Plan invocation
INVOCATION=(
  claude -p "$CMD $TARGET/"
  --permission-mode plan
  --output-format json
  --max-turns 50
)

if [[ "$DRY_RUN" == "true" ]]; then
  echo "# DRY RUN — no API call will be made" >&2
  echo
  echo "Would set up fixture at: $TARGET"
  echo "Would invoke:"
  printf '  %q ' "${INVOCATION[@]}"
  echo
  echo
  echo "Auth precedence summary (current env):"
  echo "  ANTHROPIC_API_KEY:        ${ANTHROPIC_API_KEY:+SET (would route to API)} ${ANTHROPIC_API_KEY:-not set (would use subscription)}"
  echo "  ANTHROPIC_AUTH_TOKEN:     ${ANTHROPIC_AUTH_TOKEN:+SET}"
  echo "  CLAUDE_CODE_OAUTH_TOKEN:  ${CLAUDE_CODE_OAUTH_TOKEN:+SET (subscription via long-lived token)}"
  echo "  CLAUDE_CODE_USE_BEDROCK:  ${CLAUDE_CODE_USE_BEDROCK:-not set}"
  echo "  CLAUDE_CODE_USE_VERTEX:   ${CLAUDE_CODE_USE_VERTEX:-not set}"
  exit 0
fi

# Setup target
echo "Setting up target at $TARGET ..." >&2
rm -rf "$TARGET"
cp -r "$FIXTURE_SRC" "$TARGET"
cd "$TARGET"
git init -q
git add -A
git -c commit.gpgsign=false commit -qm "fixture state for baseline run"
touch .measure
cd "$KIT_ROOT"

# Run the pipeline
echo "Invoking: ${INVOCATION[*]}" >&2
echo "Auth: subscription (default — no ANTHROPIC_API_KEY in env)" >&2
echo "This will count against your Max plan's session/day quota." >&2
echo

RESULT_JSON=$(mktemp /tmp/baseline-result.XXXXXX.json)

# Run; capture exit code so we can still extract data even if pipeline errors
# (e.g. ExitPlanMode in headless mode might fail — analysis data is still valid)
PIPELINE_EXIT=0
"${INVOCATION[@]}" > "$RESULT_JSON" || PIPELINE_EXIT=$?

if [[ ! -s "$RESULT_JSON" ]]; then
  echo "ERROR: empty result from claude -p (exit $PIPELINE_EXIT)" >&2
  rm -rf "$TARGET" "$RESULT_JSON"
  exit 1
fi

SESSION_ID=$(jq -r '.session_id // empty' "$RESULT_JSON")

if [[ -z "$SESSION_ID" ]]; then
  echo "ERROR: no session_id in result JSON. Raw output:" >&2
  cat "$RESULT_JSON" >&2
  rm -rf "$TARGET" "$RESULT_JSON"
  exit 1
fi

echo "Session: $SESSION_ID (pipeline exit: $PIPELINE_EXIT)" >&2
echo "Capturing measurement ..." >&2
echo

# Run capture (writes markdown table to stdout — caller redirects as needed)
bash "$KIT_ROOT/tests/baseline/capture.sh" "$SESSION_ID"

# Cleanup
rm -rf "$TARGET" "$RESULT_JSON"
echo >&2
echo "Done. Fixture cleaned up; session JSONL preserved at:" >&2
echo "  ~/.claude/projects/-home-vagrant-projects-public/$SESSION_ID.jsonl" >&2
