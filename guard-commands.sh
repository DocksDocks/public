#!/bin/bash
# Guard: validate command markdown structure hasn't been broken
DIR="${1:-/home/docks/projects/public/ssot/.claude/commands}"
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
done

if [ "$errors" -gt 0 ]; then
  echo "Guard FAILED: $errors structural errors" >&2
  exit 1
fi
echo "Guard PASSED: all commands structurally valid"
exit 0
