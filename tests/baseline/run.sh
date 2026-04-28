#!/usr/bin/env bash
# run.sh — automated baseline-measurement runner.
#
# Spawns a fresh `claude -p` session against a copy of the baseline fixture,
# auto-detects the ExitPlanMode gate via stream-json events, terminates the
# session cleanly when the gate is reached, then captures the session JSONL
# via capture.sh and prints the per-agent measurement table.
#
# Auth: uses your Claude subscription (Max/Pro/Team/Enterprise) by default —
# tokens count against your subscription's session/day quota, not the API.
# To force API billing instead, set ANTHROPIC_API_KEY before invoking
# (per Claude Code auth precedence, an API key in env always wins in -p mode).
#
# ExitPlanMode auto-detect: in headless mode the gate has no UI to approve and
# would otherwise hang indefinitely. We watch the stream-json output for the
# `tool_use` event with `name: "ExitPlanMode"` and SIGTERM the parent claude
# process. The pipeline is robust under SIGTERM — all completed analysis
# phases are flushed to the on-disk session JSONL before exit, and capture.sh
# extracts everything from there regardless. No manual `timeout` wrapper needed.
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

# Plan invocation. stream-json + --verbose is required for per-event output.
# --max-turns 50 is a defense-in-depth ceiling; the gate watchdog should fire
# first under normal pipeline behavior.
INVOCATION=(
  claude -p "$CMD $TARGET/"
  --permission-mode plan
  --output-format stream-json
  --verbose
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
  echo
  echo "Watchdog: greps stream-json output for ExitPlanMode tool_use; SIGTERMs parent on detection."
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

# Run the pipeline in background, with stream-json watchdog for ExitPlanMode
echo "Invoking: ${INVOCATION[*]}" >&2
echo "Auth: subscription (default — no ANTHROPIC_API_KEY in env)" >&2
echo "ExitPlanMode auto-detect armed (no manual timeout needed)." >&2
echo

STREAM_FILE=$(mktemp /tmp/baseline-stream.XXXXXX.jsonl)

"${INVOCATION[@]}" > "$STREAM_FILE" 2>&1 &
CLAUDE_PID=$!

# Watchdog: poll the stream file for the ExitPlanMode tool_use event.
# Emitted as part of an `assistant` content block before the gate hangs.
# Match pattern is anchored to the JSON shape to avoid false positives.
GATE_PATTERN='"type":"tool_use"[^}]*"name":"ExitPlanMode"'
START_TIME=$SECONDS
GATE_DETECTED=0
LAST_TICK=0

while kill -0 "$CLAUDE_PID" 2>/dev/null; do
  if [[ -s "$STREAM_FILE" ]] && grep -Eq "$GATE_PATTERN" "$STREAM_FILE"; then
    ELAPSED=$((SECONDS - START_TIME))
    MM=$((ELAPSED / 60))
    SS=$((ELAPSED % 60))
    echo "[watchdog] ExitPlanMode reached at ${MM}m${SS}s — terminating cleanly" >&2
    GATE_DETECTED=1
    sleep 2  # grace period for any in-flight event flushes
    kill -TERM "$CLAUDE_PID" 2>/dev/null || true
    break
  fi

  # Periodic heartbeat so the user knows we're still watching
  ELAPSED=$((SECONDS - START_TIME))
  if (( ELAPSED - LAST_TICK >= 60 )); then
    LAST_TICK=$ELAPSED
    STREAM_BYTES=$(stat -c%s "$STREAM_FILE" 2>/dev/null || echo 0)
    echo "[watchdog] +${ELAPSED}s elapsed, stream=${STREAM_BYTES}B, no gate yet" >&2
  fi

  sleep 2
done

# Wait for claude to exit fully (after our SIGTERM, or natural completion)
wait "$CLAUDE_PID" 2>/dev/null || true
PIPELINE_EXIT=$?

if [[ ! -s "$STREAM_FILE" ]]; then
  echo "ERROR: empty stream from claude -p (exit $PIPELINE_EXIT)" >&2
  rm -rf "$TARGET" "$STREAM_FILE"
  exit 1
fi

# Extract session_id from the init event (first system/init line in the stream).
SESSION_ID=$(jq -r 'select(.type == "system" and .subtype == "init") | .session_id' \
  "$STREAM_FILE" 2>/dev/null | head -1)

if [[ -z "$SESSION_ID" ]]; then
  echo "ERROR: no session_id in stream output. First 5 lines:" >&2
  head -5 "$STREAM_FILE" >&2
  rm -rf "$TARGET" "$STREAM_FILE"
  exit 1
fi

if (( GATE_DETECTED == 1 )); then
  echo "Session: $SESSION_ID (gate detected, terminated cleanly)" >&2
else
  echo "Session: $SESSION_ID (natural exit $PIPELINE_EXIT)" >&2
fi
echo "Capturing measurement ..." >&2
echo

# Run capture (writes markdown table to stdout — caller redirects as needed)
bash "$KIT_ROOT/tests/baseline/capture.sh" "$SESSION_ID"

# Cleanup
rm -rf "$TARGET" "$STREAM_FILE"
echo >&2
echo "Done. Fixture cleaned up; session JSONL preserved at:" >&2
echo "  ~/.claude/projects/-home-vagrant-projects-public/$SESSION_ID.jsonl" >&2
