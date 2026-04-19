#!/bin/bash
# Mechanical skill quality scorer
# Scores each SKILL.md against agentskills.io + project conventions
# Output: single number (total score), or `<name> <score>` per skill with --per-file

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="total"
DIR=""
for arg in "$@"; do
  case "$arg" in
    --per-file) MODE="per-file" ;;
    *) DIR="$arg" ;;
  esac
done
DIR="${DIR:-$SCRIPT_DIR/ssot/.claude/skills}"
total=0
today=$(date +%s)

for skill_dir in "$DIR"/*/; do
  [ -d "$skill_dir" ] || continue
  skill_name=$(basename "$skill_dir")
  file="$skill_dir/SKILL.md"
  [ -f "$file" ] || continue
  score=0

  # 1. Description starts with "Use when" (2pts)
  desc=$(grep '^description:' "$file" | head -1 | sed 's/^description:[[:space:]]*//')
  echo "$desc" | grep -qiE '^use when' && score=$((score + 2))

  # 2. metadata.updated within last 180 days (1pt)
  updated=$(awk '/^metadata:/{in_meta=1; next} in_meta && /^[a-z]/{in_meta=0} in_meta && /updated:/{print; exit}' "$file" \
            | sed 's/.*updated:[[:space:]]*"\{0,1\}\([0-9-]*\)"\{0,1\}.*/\1/')
  if [ -n "$updated" ]; then
    updated_ts=$(date -d "$updated" +%s 2>/dev/null || echo 0)
    if [ "$updated_ts" -gt 0 ]; then
      age_days=$(( (today - updated_ts) / 86400 ))
      [ "$age_days" -le 180 ] && score=$((score + 1))
    fi
  fi

  # 3. <constraint> blocks for non-negotiable rules (1pt each, max 3)
  constraint_count=$(grep -c '<constraint>' "$file")
  cc=$constraint_count
  [ "$cc" -gt 3 ] && cc=3
  score=$((score + cc))

  # 4. BAD/GOOD examples present (2pts) — accept "BAD"/"GOOD" or "Wrong"/"Right" idioms
  if { grep -qE '\bBAD\b|//\s*BAD|#\s*BAD' "$file" && grep -qE '\bGOOD\b|//\s*GOOD|#\s*GOOD' "$file"; } \
     || { grep -qiE 'wrong fix' "$file" && grep -qiE 'right fix' "$file"; }; then
    score=$((score + 2))
  fi

  # 5. No slop words (2pts, lose 1 per hit)
  slop=$(grep -ciE '\bcomprehensive\b|\brobust\b|\belegant\b|\bseamless\b' "$file")
  slop_score=$((2 - slop))
  [ "$slop_score" -lt 0 ] && slop_score=0
  score=$((score + slop_score))

  # 6. At least one markdown table for rule summaries (1pt)
  grep -qE '^\|.*\|' "$file" && score=$((score + 1))

  # 7. Code fences with language tags (1pt)
  grep -qE '^```[a-z]+' "$file" && score=$((score + 1))

  # 8. Body size in sweet spot (80–400 lines) (2pts)
  body_lines=$(awk '/^---$/{c++;next} c==2{print}' "$file" | wc -l)
  if [ "$body_lines" -ge 80 ] && [ "$body_lines" -le 400 ]; then
    score=$((score + 2))
  fi

  if [ "$MODE" = "per-file" ]; then
    echo "$skill_name $score"
  fi
  total=$((total + score))
done

if [ "$MODE" = "total" ]; then
  echo "$total"
fi
