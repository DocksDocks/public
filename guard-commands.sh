#!/bin/bash
# Guard: validate command markdown structure hasn't been broken
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIR="${1:-$SCRIPT_DIR/ssot/.claude/commands}"
errors=0

for f in "$DIR"/*.md; do
  name=$(basename "$f")

  # Every <task> must have a matching </task> (these aren't in code blocks)
  open=$(grep -c '<task>' "$f")
  close=$(grep -c '</task>' "$f")
  if [ "$open" -ne "$close" ]; then
    echo "FAIL: $name — mismatched <task> tags ($open open, $close close)" >&2
    errors=$((errors + 1))
  fi

  # Must have at least one <task> block
  if [ "$open" -eq 0 ]; then
    echo "FAIL: $name — no <task> blocks found" >&2
    errors=$((errors + 1))
  fi

  # Must not be empty or suspiciously short
  lines=$(wc -l < "$f")
  if [ "$lines" -lt 50 ]; then
    echo "FAIL: $name — suspiciously short ($lines lines)" >&2
    errors=$((errors + 1))
  fi

  # Must have Success Criteria in at least one task
  if ! grep -q 'Success Criteria' "$f"; then
    echo "FAIL: $name — no Success Criteria found" >&2
    errors=$((errors + 1))
  fi

  # Must have Phase Transition Protocol if 3+ phases (CLAUDE.md convention)
  phase_count=$(grep -cE '^## Phase [0-9]' "$f")
  if [ "$phase_count" -ge 3 ]; then
    if ! grep -q 'Phase Transition Protocol' "$f"; then
      echo "FAIL: $name — $phase_count phases but no Phase Transition Protocol" >&2
      errors=$((errors + 1))
    fi
  fi

  # If command instructs research via context7/WebFetch, it must also permit WebFetch.
  # Check passes if WebFetch or WebSearch appears in any Allowed-Tools-adjacent context
  # (either a `## Allowed Tools` section or a `<constraint>`-wrapped Allowed Tools block).
  if grep -qE 'resolve-library-id|context7|query-docs' "$f"; then
    if ! grep -qiE 'Allowed Tools|allowed-tools' "$f"; then
      echo "FAIL: $name — research instructed but no Allowed Tools section" >&2
      errors=$((errors + 1))
    elif ! grep -qE 'WebFetch|WebSearch' "$f"; then
      echo "FAIL: $name — research instructed but WebFetch/WebSearch not permitted" >&2
      errors=$((errors + 1))
    fi
  fi
done

if [ "$errors" -gt 0 ]; then
  echo "Guard FAILED: $errors structural errors" >&2
  exit 1
fi
echo "Guard PASSED: all commands structurally valid"
exit 0
