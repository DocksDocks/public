#!/bin/bash
# Mechanical agent quality scorer
# Scores each agent file against CSO + structural conventions.
# Output: single number (total score), or `<name> <score>` per agent with --per-file
#
# Score dimensions (0-10 per agent, max 10):
#  1. Description starts with "Use when" (2)
#  2. Description contains "Not" exclusion clause (1)
#  3. Description length sweet spot 80–900 chars (1)
#  4. <constraint> blocks present (1pt each, max 2)
#  5. Has ## Workflow and ## Success Criteria (2)
#  6. Body size 60–300 lines (1)
#  7. Anti-hallucination checklist present (1)
#  8. Explicit model declared (sonnet|opus|haiku) (1)
#  9. No slop words (lose 1 per hit, max 2)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="total"
DIR=""
for arg in "$@"; do
  case "$arg" in
    --per-file) MODE="per-file" ;;
    *) DIR="$arg" ;;
  esac
done
DIR="${DIR:-$SCRIPT_DIR/ssot/.claude/agents}"
total=0

if ! compgen -G "$DIR/*.md" > /dev/null; then
  if [ "$MODE" = "total" ]; then
    echo "0"
  fi
  exit 0
fi

for file in "$DIR"/*.md; do
  [ -f "$file" ] || continue
  name=$(basename "$file" .md)
  [ "$name" = ".gitkeep" ] && continue
  score=0

  # 1. Description starts with "Use when" (2pts)
  desc=$(grep '^description:' "$file" | head -1 | sed 's/^description:[[:space:]]*//')
  echo "$desc" | grep -qiE '^use when' && score=$((score + 2))

  # 2. "Not" exclusion clause (1pt)
  echo "$desc" | grep -qiE '\bnot\b' && score=$((score + 1))

  # 3. Description length sweet spot (1pt)
  desc_len=${#desc}
  if [ "$desc_len" -ge 80 ] && [ "$desc_len" -le 900 ]; then
    score=$((score + 1))
  fi

  # 4. <constraint> blocks (1pt each, max 2)
  constraint_count=$(grep -c '<constraint>' "$file")
  cc=$constraint_count
  [ "$cc" -gt 2 ] && cc=2
  score=$((score + cc))

  # 5. Has ## Workflow and ## Success Criteria (2pts: 1 each)
  grep -q '^## Workflow' "$file" && score=$((score + 1))
  grep -q '^## Success Criteria' "$file" && score=$((score + 1))

  # 6. Body size sweet spot 60–300 lines (1pt)
  body_lines=$(awk '/^---$/{c++;next} c==2{print}' "$file" | wc -l)
  if [ "$body_lines" -ge 60 ] && [ "$body_lines" -le 300 ]; then
    score=$((score + 1))
  fi

  # 7. Anti-hallucination checklist present (1pt)
  grep -qiE 'anti-hallucination|file:line refs|verify import paths' "$file" && score=$((score + 1))

  # 8. Explicit model declared (1pt)
  grep -qE '^model:[[:space:]]*(sonnet|opus|haiku)' "$file" && score=$((score + 1))

  # 9. No slop words (lose 1 per hit, max 2)
  slop=$(grep -ciE '\bcomprehensive\b|\brobust\b|\belegant\b|\bseamless\b' "$file")
  slop_score=$((2 - slop))
  [ "$slop_score" -lt 0 ] && slop_score=0
  score=$((score + slop_score))

  if [ "$MODE" = "per-file" ]; then
    echo "$name $score"
  fi
  total=$((total + score))
done

if [ "$MODE" = "total" ]; then
  echo "$total"
fi
