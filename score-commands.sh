#!/bin/bash
# Mechanical command quality scorer
# Scores each .md command file against quality criteria from CLAUDE.md conventions
# Output: single number (total score across all commands)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIR="${1:-$SCRIPT_DIR/ssot/.claude/commands}"
total=0

for f in "$DIR"/*.md; do
  name=$(basename "$f")
  score=0

  # 1. Plan Mode enforcement via <constraint> tag (2pts)
  grep -q '<constraint>' "$f" && grep -qi 'EnterPlanMode\|Plan Mode' "$f" && score=$((score + 2))

  # 2. Phase Transition Protocol constraint (2pts)
  grep -q 'Phase Transition Protocol' "$f" && score=$((score + 2))

  # 3. Every <task> block has Success Criteria (2pts per task, max 10pts)
  task_count=$(grep -c '<task>' "$f")
  criteria_count=$(grep -c 'Success Criteria' "$f")
  if [ "$task_count" -gt 0 ] && [ "$criteria_count" -ge "$task_count" ]; then
    sc=$((task_count * 2))
    [ "$sc" -gt 10 ] && sc=10
    score=$((score + sc))
  fi

  # 4. Anti-Hallucination Checks in verifier (3pts)
  grep -q 'Anti-Hallucination' "$f" && score=$((score + 3))

  # 5. No slop words in descriptions/titles (2pts, lose 1 per slop word found)
  slop=$(grep -ciE '\bcomprehensive\b|\brobust\b|\belegant\b|\bseamless\b' "$f")
  slop_score=$((2 - slop))
  [ "$slop_score" -lt 0 ] && slop_score=0
  score=$((score + slop_score))

  # 6. BAD/GOOD examples present (2pts)
  grep -q 'BAD:' "$f" && grep -q 'GOOD:' "$f" && score=$((score + 2))

  # 7. <constraint> tags used for critical rules (1pt per, max 3pts)
  constraint_count=$(grep -c '<constraint>' "$f")
  cc=$constraint_count
  [ "$cc" -gt 3 ] && cc=3
  score=$((score + cc))

  # 8. No inert `model="opus"` annotations — subagent model is controlled by
  #    CLAUDE_CODE_SUBAGENT_MODEL env var; XML-attr-style annotations in prompts
  #    have no programmatic effect and waste tokens. (2pts if absent)
  if ! grep -qE 'model="opus"|model: "opus"' "$f"; then
    score=$((score + 2))
  fi

  # 9. Allowed Tools section (1pt)
  grep -qi 'Allowed Tools' "$f" && score=$((score + 1))

  # 10. Research-first constraint (context7 + WebFetch) (2pts)
  grep -q 'resolve-library-id\|context7\|query-docs' "$f" && score=$((score + 2))

  # 11. Research-Allowed-Tools consistency: if the file instructs research (context7
  #     or WebFetch), it must also permit WebFetch/WebSearch somewhere. (2pts)
  if grep -qE 'resolve-library-id|context7|query-docs' "$f"; then
    if grep -qE 'WebFetch|WebSearch' "$f" && grep -qiE 'Allowed Tools|allowed-tools' "$f"; then
      score=$((score + 2))
    fi
  else
    # No research needed — don't penalize
    score=$((score + 2))
  fi

  total=$((total + score))
done

echo "$total"
