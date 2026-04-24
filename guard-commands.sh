#!/bin/bash
# Guard: validate command markdown structure hasn't been broken.
# Accepts two flavors:
#   - Legacy:  inline <task>...</task> blocks per phase (with Success Criteria in-task)
#   - Thin orchestrator:  `subagent_type: foo-bar` references; Success Criteria lives
#     in the corresponding ssot/.claude/agents/<name>.md files
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIR="${1:-$SCRIPT_DIR/ssot/.claude/commands}"
errors=0

for f in "$DIR"/*.md; do
  name=$(basename "$f")

  # Commands come in two flavors:
  #   - Legacy:  inline <task>...</task> blocks per phase
  #   - Thin orchestrator:  subagent_type: references that delegate to
  #     ssot/.claude/agents/<name>.md files (agents carry Success Criteria)
  task_open=$(grep -c '<task>' "$f")
  task_close=$(grep -c '</task>' "$f")
  subagent_refs=$(grep -cE '`subagent_type:|subagent_type: `' "$f")

  if [ "$task_open" -gt 0 ] && [ "$subagent_refs" -eq 0 ]; then
    flavor="legacy"
  elif [ "$subagent_refs" -gt 0 ] && [ "$task_open" -eq 0 ]; then
    flavor="thin"
  elif [ "$task_open" -eq 0 ] && [ "$subagent_refs" -eq 0 ]; then
    echo "FAIL: $name — neither <task> blocks nor subagent_type: references found (not a valid command)" >&2
    errors=$((errors + 1))
    continue
  else
    echo "FAIL: $name — mixes <task> blocks and subagent_type: references (pick one flavor)" >&2
    errors=$((errors + 1))
    continue
  fi

  if [ "$flavor" = "legacy" ]; then
    # Every <task> must have a matching </task> (legacy flavor only)
    if [ "$task_open" -ne "$task_close" ]; then
      echo "FAIL: $name — mismatched <task> tags ($task_open open, $task_close close)" >&2
      errors=$((errors + 1))
    fi

    # Legacy commands must have Success Criteria inline (thin commands push it to agents)
    if ! grep -q 'Success Criteria' "$f"; then
      echo "FAIL: $name — no Success Criteria found (legacy command)" >&2
      errors=$((errors + 1))
    fi
  fi

  # Must not be empty or suspiciously short (applies to both flavors)
  lines=$(wc -l < "$f")
  if [ "$lines" -lt 50 ]; then
    echo "FAIL: $name — suspiciously short ($lines lines)" >&2
    errors=$((errors + 1))
  fi

  # Thin commands: verify every subagent_type reference resolves to an agent file
  if [ "$flavor" = "thin" ]; then
    AGENTS_DIR="$SCRIPT_DIR/ssot/.claude/agents"
    # Extract agent names from patterns like `subagent_type: foo-bar` or `subagent_type: \`foo-bar\``
    agents=$(grep -oE "subagent_type: \`?[a-z][a-z0-9-]+\`?" "$f" \
             | sed -E 's/subagent_type: `?([a-z0-9-]+)`?/\1/' | sort -u)
    for a in $agents; do
      if [ ! -f "$AGENTS_DIR/${a}.md" ]; then
        echo "FAIL: $name — subagent_type '$a' has no matching $AGENTS_DIR/${a}.md" >&2
        errors=$((errors + 1))
      fi
    done
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
