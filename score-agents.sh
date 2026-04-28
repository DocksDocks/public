#!/bin/bash
# Mechanical agent quality scorer
# Scores each agent file against Anthropic subagent docs + project conventions.
# Max per-file: 15.
#
# Provenance:
#  - "docs"    — Anthropic-documented (code.claude.com/docs/en/sub-agents)
#  - "project" — kit-specific convention (see CLAUDE.md Agents section)
#
# Output: single total, or `<name> <score>` per agent with --per-file

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

has_fm_field() {
  local file="$1" field="$2"
  awk -v key="$field" '
    /^---$/{c++; next}
    c==1 && $0 ~ "^"key":"{found=1; exit}
    END{exit !found}
  ' "$file"
}

for file in "$DIR"/*.md; do
  [ -f "$file" ] || continue
  name=$(basename "$file" .md)
  [ "$name" = ".gitkeep" ] && continue
  score=0

  # 1. [docs-example] Description starts with "Use when" (2 pts) — every Anthropic
  #    doc example uses this prefix
  desc=$(grep '^description:' "$file" | head -1 | sed 's/^description:[[:space:]]*//')
  echo "$desc" | grep -qiE '^use when' && score=$((score + 2))

  # 2. [project] "Not" exclusion clause (1 pt) — narrows the match surface
  echo "$desc" | grep -qiE '\bnot\b' && score=$((score + 1))

  # 3. [project] Description length sweet spot 80–900 chars (1 pt)
  desc_len=${#desc}
  if [ "$desc_len" -ge 80 ] && [ "$desc_len" -le 900 ]; then
    score=$((score + 1))
  fi

  # 4. [project] <constraint> blocks present (1 pt each, max 2)
  constraint_count=$(grep -c '<constraint>' "$file")
  cc=$constraint_count
  [ "$cc" -gt 2 ] && cc=2
  score=$((score + cc))

  # 5. [project] Has ## Workflow and ## Success Criteria (2 pts: 1 each)
  grep -q '^## Workflow' "$file" && score=$((score + 1))
  grep -q '^## Success Criteria' "$file" && score=$((score + 1))

  # 6. [project] Body size sweet spot 60–300 lines (1 pt)
  body_lines=$(awk '/^---$/{c++;next} c==2{print}' "$file" | wc -l)
  if [ "$body_lines" -ge 60 ] && [ "$body_lines" -le 300 ]; then
    score=$((score + 1))
  fi

  # 7. [project] Anti-hallucination checklist present (1 pt)
  grep -qiE 'anti-hallucination|file:line refs|verify import paths' "$file" && score=$((score + 1))

  # 8. [docs] Explicit model declared (1 pt) — agent-frontmatter `model:` is the
  #    per-phase tiering mechanism per the subagents doc resolution order
  grep -qE '^model:[[:space:]]*(sonnet|opus|haiku)' "$file" && score=$((score + 1))

  # 9. [docs] Tool constraint declared — `tools:` OR `disallowedTools:` (1 pt).
  #    Absence of both means the agent inherits ALL parent tools; explicit
  #    constraints make permission behavior predictable.
  if has_fm_field "$file" "tools" || has_fm_field "$file" "disallowedTools"; then
    score=$((score + 1))
  fi

  # 10. [project] No slop words (lose 1 per hit, max 2)
  slop=$(grep -ciE '\bcomprehensive\b|\brobust\b|\belegant\b|\bseamless\b' "$file")
  slop_score=$((2 - slop))
  [ "$slop_score" -lt 0 ] && slop_score=0
  score=$((score + slop_score))

  # 11. [project] Research-gate constraint (1 pt) — rewards agents that explicitly
  #     require context7 / WebFetch lookup before suggesting framework/library
  #     changes. Catches training-data drift on framework conventions (e.g.,
  #     Next.js 16 `proxy.ts` vs legacy `middleware.ts`, React 19 `ref` prop vs
  #     `forwardRef`, Tailwind 4 CSS-first vs JS config). Detected by mention of
  #     context7 lookup keywords — they only appear inside <constraint> blocks
  #     in this kit, so it's a clean signal.
  if grep -qiE '(resolve-library-id|query-docs|context7)' "$file"; then
    score=$((score + 1))
  fi

  if [ "$MODE" = "per-file" ]; then
    echo "$name $score"
  fi
  total=$((total + score))
done

if [ "$MODE" = "total" ]; then
  echo "$total"
fi
