#!/bin/bash
# Mechanical skill quality scorer
# Scores each SKILL.md against agentskills.io + project conventions.
# Max per-file: 16.
#
# Provenance:
#  - "docs"    — Anthropic-documented (code.claude.com/docs/en/skills, agentskills.io)
#  - "project" — kit-specific convention (see ssot/.claude/CLAUDE.md Project Skills)
#
# Output: single total, or `<name> <score>` per skill with --per-file

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

# Extract a YAML value that may span multiple lines (single-line or block-scalar)
# until the next top-level YAML key or end of frontmatter.
extract_yaml_value() {
  local file="$1" key="$2"
  awk -v key="$key" '
    /^---$/{c++; if(c==2) exit; next}
    c==1 && $0 ~ "^"key":" {
      sub("^"key":[[:space:]]*", "")
      flag=1
      print
      next
    }
    c==1 && flag && /^[a-z_][a-zA-Z0-9_-]*:/ { flag=0 }
    c==1 && flag { print }
  ' "$file"
}

for skill_dir in "$DIR"/*/; do
  [ -d "$skill_dir" ] || continue
  skill_name=$(basename "$skill_dir")
  file="$skill_dir/SKILL.md"
  [ -f "$file" ] || continue
  score=0

  # Third-party vendored skills opt into relaxed scoring via `upstream:` frontmatter block
  has_upstream=$(grep -c '^upstream:' "$file")

  # 1. [docs-example] Description starts with "Use when" (2 pts) — matches every
  #    Anthropic doc example; upstream: skills accept "Use when" anywhere
  desc=$(grep '^description:' "$file" | head -1 | sed 's/^description:[[:space:]]*//')
  if [ "$has_upstream" -gt 0 ]; then
    echo "$desc" | grep -qiE 'use when' && score=$((score + 2))
  else
    echo "$desc" | grep -qiE '^use when' && score=$((score + 2))
  fi

  # 2. [docs] description + when_to_use combined ≤ 1,536 chars (2 pts) — HARD SPEC
  #    The skill listing truncates at 1,536 chars; exceeding this silently drops
  #    trigger keywords Claude needs to match on. Source: skills doc frontmatter ref.
  desc_body=$(extract_yaml_value "$file" "description" | tr '\n' ' ')
  wtu_body=$(extract_yaml_value "$file" "when_to_use" | tr '\n' ' ')
  combined_len=$((${#desc_body} + ${#wtu_body}))
  if [ "$combined_len" -le 1536 ] && [ "$combined_len" -gt 0 ]; then
    score=$((score + 2))
  fi

  # 3. [project] Freshness within last 180 days (1 pt) — metadata.updated for kit
  #    skills; fall back to upstream.vendored_at for upstream: skills
  updated=$(awk '/^metadata:/{in_meta=1; next} in_meta && /^[a-z]/{in_meta=0} in_meta && /updated:/{print; exit}' "$file" \
            | sed 's/.*updated:[[:space:]]*"\{0,1\}\([0-9-]*\)"\{0,1\}.*/\1/')
  if [ -z "$updated" ] && [ "$has_upstream" -gt 0 ]; then
    updated=$(awk '/^upstream:/{in_up=1; next} in_up && /^[a-z]/{in_up=0} in_up && /vendored_at:/{print; exit}' "$file" \
              | sed 's/.*vendored_at:[[:space:]]*"\{0,1\}\([0-9-]*\)"\{0,1\}.*/\1/')
  fi
  if [ -n "$updated" ]; then
    updated_ts=$(date -d "$updated" +%s 2>/dev/null || echo 0)
    if [ "$updated_ts" -gt 0 ]; then
      age_days=$(( (today - updated_ts) / 86400 ))
      [ "$age_days" -le 180 ] && score=$((score + 1))
    fi
  fi

  # 4. [project] <constraint> blocks for non-negotiable rules (1 pt each, max 3)
  constraint_count=$(grep -c '<constraint>' "$file")
  cc=$constraint_count
  [ "$cc" -gt 3 ] && cc=3
  score=$((score + cc))

  # 5. [project] BAD/GOOD examples present (2 pts) — accept "BAD"/"GOOD" or
  #    "Wrong"/"Right" idioms
  if { grep -qE '\bBAD\b|//\s*BAD|#\s*BAD' "$file" && grep -qE '\bGOOD\b|//\s*GOOD|#\s*GOOD' "$file"; } \
     || { grep -qiE 'wrong fix' "$file" && grep -qiE 'right fix' "$file"; }; then
    score=$((score + 2))
  fi

  # 6. [project] No slop words (2 pts, lose 1 per hit)
  slop=$(grep -ciE '\bcomprehensive\b|\brobust\b|\belegant\b|\bseamless\b' "$file")
  slop_score=$((2 - slop))
  [ "$slop_score" -lt 0 ] && slop_score=0
  score=$((score + slop_score))

  # 7. [project] At least one markdown table for rule summaries (1 pt)
  grep -qE '^\|.*\|' "$file" && score=$((score + 1))

  # 8. [project] Code fences with language tags (1 pt)
  grep -qE '^```[a-z]+' "$file" && score=$((score + 1))

  # 9. [docs-aligned] Body size in sweet spot 80–350 lines (2 pts).
  #    Anthropic tip: keep SKILL.md under 500 lines. Compaction re-attaches only
  #    the first 5,000 tokens of each invoked skill — content beyond that gets
  #    silently truncated. At ~12 tokens/line measured across this kit's skills
  #    (and ~1.35× higher on Opus 4.7's tokenizer), 350 lines ≈ 4,200 tokens on
  #    4.6 / ~5,670 on 4.7 — the soft ceiling sits right at the 4.7 budget edge.
  body_lines=$(awk '/^---$/{c++;next} c==2{print}' "$file" | wc -l)
  if [ "$body_lines" -ge 80 ] && [ "$body_lines" -le 350 ]; then
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
