#!/bin/bash
# Mechanical command quality scorer
# Scores each .md command file against a rubric combining Anthropic-documented
# frontmatter (allowed-tools, description, argument-hint, $ARGUMENTS) and
# project conventions (Plan Mode, Phase Transition Protocol, constraint tags,
# subagent_type cross-refs, no slop). Max per-file: 20.
#
# Provenance:
#  - "docs"    — Anthropic-documented (code.claude.com/docs/en/skills, sub-agents)
#  - "project" — kit-specific convention (see ssot/.claude/CLAUDE.md Command
#                Authoring Conventions)
#
# Output: total score, or `<name> <score>` per file with --per-file

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS_DIR="$SCRIPT_DIR/ssot/.claude/agents"
MODE="total"
DIR=""
for arg in "$@"; do
  case "$arg" in
    --per-file) MODE="per-file" ;;
    *) DIR="$arg" ;;
  esac
done
DIR="${DIR:-$SCRIPT_DIR/ssot/.claude/commands}"
total=0

# Extract a frontmatter field value (first occurrence, YAML block-scalar tolerant)
get_fm_field() {
  local file="$1" field="$2"
  awk -v key="$field" '
    /^---$/{c++; next}
    c==1 && $0 ~ "^"key":"{sub("^"key":[[:space:]]*",""); print; exit}
  ' "$file"
}

has_fm_field() {
  local file="$1" field="$2"
  awk -v key="$field" '
    /^---$/{c++; next}
    c==1 && $0 ~ "^"key":"{found=1; exit}
    END{exit !found}
  ' "$file"
}

for f in "$DIR"/*.md; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  score=0

  # 1. [project] Plan Mode constraint via <constraint> tag (2 pts)
  if grep -q '<constraint>' "$f" && grep -qi 'EnterPlanMode\|Plan Mode' "$f"; then
    score=$((score + 2))
  fi

  # 2. [project] Phase Transition Protocol constraint (2 pts) — required for 3+ phases
  phase_count=$(grep -cE '^## Phase [0-9]' "$f")
  if [ "$phase_count" -lt 3 ] || grep -q 'Phase Transition Protocol' "$f"; then
    score=$((score + 2))
  fi

  # 3. [docs] allowed-tools: frontmatter field (2 pts)
  has_fm_field "$f" "allowed-tools" && score=$((score + 2))

  # 4. [docs] description: frontmatter field (1 pt)
  has_fm_field "$f" "description" && score=$((score + 1))

  # 5. [docs] argument-hint: frontmatter field (1 pt)
  has_fm_field "$f" "argument-hint" && score=$((score + 1))

  # 6. [docs] $ARGUMENTS used in body when command accepts args.
  #    Pass when: body uses $ARGUMENTS, OR argument-hint: is absent (command
  #    explicitly declares no args — no body reference needed). (1 pt)
  if grep -q '\$ARGUMENTS' "$f" || ! has_fm_field "$f" "argument-hint"; then
    score=$((score + 1))
  fi

  # 7. [structural] Every `subagent_type:` reference resolves to an agent file (3 pts)
  # If no subagent_type references exist (non-thin command), this passes.
  agents=$(grep -oE "subagent_type: \`?[a-z][a-z0-9-]+\`?" "$f" \
           | sed -E 's/subagent_type: `?([a-z0-9-]+)`?/\1/' | sort -u)
  refs_ok=1
  if [ -n "$agents" ]; then
    for a in $agents; do
      [ -f "$AGENTS_DIR/${a}.md" ] || refs_ok=0
    done
  fi
  [ "$refs_ok" -eq 1 ] && score=$((score + 3))

  # 8. [project] No inert model="opus" / model: "opus" annotations (2 pts)
  #    These XML-attr-style strings in prompts have no programmatic effect; per-agent
  #    model is declared in agent frontmatter.
  if ! grep -qE 'model="opus"|model: "opus"' "$f"; then
    score=$((score + 2))
  fi

  # 9. [project] <constraint> blocks for non-negotiable rules (1 pt each, max 3)
  cc=$(grep -c '<constraint>' "$f")
  [ "$cc" -gt 3 ] && cc=3
  score=$((score + cc))

  # 10. [project] No slop words (2 pts, lose 1 per hit)
  slop=$(grep -ciE '\bcomprehensive\b|\brobust\b|\belegant\b|\bseamless\b' "$f")
  slop_score=$((2 - slop))
  [ "$slop_score" -lt 0 ] && slop_score=0
  score=$((score + slop_score))

  # 11. [project] At least one ## Phase section (1 pt) — signals phase-based orchestration
  [ "$phase_count" -ge 1 ] && score=$((score + 1))

  if [ "$MODE" = "per-file" ]; then
    echo "$name $score"
  fi
  total=$((total + score))
done

if [ "$MODE" = "total" ]; then
  echo "$total"
fi
