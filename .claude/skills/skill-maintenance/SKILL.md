---
name: skill-maintenance
description: Use when adding, refreshing, splitting, merging, or rewriting any skill under .claude/skills/; covers the CSO description prefix (Use when...), the >=5-project-specific-identifier requirement, the metadata.source_files array and metadata.updated ISO date contract, the 500-line SKILL.md body cap, the references/ 30-150-line target, the user-invocable false frontmatter default, and the upstream block (source, license, vendored_at) for vendored third-party skills.
user-invocable: false
metadata:
  source_files: []
  updated: "2026-05-17"
---

# Skill Maintenance

<constraint>
Every SKILL.md description MUST start with "Use when" (CSO prefix). Descriptions that start with anything else ("Covers…", "This skill…", capability-first phrasing) are not auto-discovered correctly. The description is the only thing loaded at session start — it must encode trigger conditions, not capabilities.
</constraint>

<constraint>
`user-invocable: false` is mandatory in frontmatter for all kit skills. Omitting it or setting `true` changes discovery behavior.
</constraint>

<constraint>
After any code change to a file listed in a skill's `metadata.source_files`, update `metadata.updated` to the current ISO date (YYYY-MM-DD). Skills with stale `updated` dates silently ship wrong information to every session that loads them.
</constraint>

## When to Use

- A new pattern is introduced in `lib/*.sh` or `SoT/` that would benefit from being documented
- An existing skill's `source_files` are modified and the skill body needs refreshing
- A skill grows beyond 500 lines and needs splitting
- Two skills overlap significantly and should be merged
- A third-party skill is vendored into `.claude/skills/`
- The maintenance skill itself needs updating

## Core Patterns

### Frontmatter Schema

```yaml
---
name: <kebab-case — MUST match directory name exactly>
description: Use when <trigger conditions>. Covers <5+ project-specific identifiers>.
user-invocable: false
metadata:
  source_files:
    - path: <relative path from project root>
      lines: "<N-M>"    # optional but preferred for scoped reads
  updated: "<YYYY-MM-DD>"
---
```

Vendored third-party skills add an `upstream:` block:

```yaml
upstream:
  source: https://github.com/<owner>/<repo>
  license: MIT
  vendored_at: "YYYY-MM-DD"
```

`upstream:` relaxes CSO prefix, `user-invocable`, and `metadata.updated` checks in `guard-skills.sh` and `score-skills.sh`. Universal structural checks still apply.

### Body Structure (≤500 lines)

```
1. # <Title>                    — one line
2. <constraint> blocks          — 2-4 critical non-negotiable rules; placed AT TOP (U-shaped attention)
3. ## When to Use               — bullet list of trigger scenarios
4. ## Core Patterns             — tables, code blocks, file:line references; NO prose
5. ## Key Decisions             — 2-5 bullets with file:line references
6. ## Gotchas                   — concrete failure scenarios; placed AT END (U-shaped attention)
7. ## References                — list of references/ files with when-to-read conditions
```

### CSO Description Requirements

| Requirement | Pass | Fail |
|-------------|------|------|
| Starts with "Use when" | "Use when editing sync.sh…" | "This skill covers sync.sh…" |
| ≥5 project-specific identifiers | "covers TARGET_FILTER_SET, FORCE, REMOVE_PLUGINS, common::parse_args, sync.sh" | "covers sync flags and idempotency" |
| ≤1024 characters | (count before committing) | Truncated by discovery scanner |
| Trigger conditions, not capabilities | "Use when adding a new target flag" | "Provides a reference for all flags" |

### `references/` Files

- Target: 30-150 lines each
- Required: title, critical constraints at top, code blocks with file:line refs, `| Good | Bad | Why |` table, gotchas at bottom
- Naming: kebab-case `.md` files under `references/`
- When to create: when a detail would make SKILL.md exceed 500 lines, or when deep reference content is needed only in specific sub-tasks

### `metadata.source_files` Update Trigger

Update `metadata.updated` when:
- Any file in `source_files` has a substantive change (logic, not just formatting/comments)
- A line range in `source_files` moves due to insertions/deletions above it
- A new pattern appears that should be documented in the skill

Do NOT update for: typo fixes, comment-only changes, renames that don't affect behavior, test-only changes.

### Anti-Hallucination Checklist (before writing any claim)

1. Read the referenced file at the stated line — does the code at that line actually match the claim?
2. Verify import paths and function names resolve to real symbols (use Glob + Read)
3. Check function signatures match actual code
4. Cross-reference package names against lockfile when documenting library patterns
5. Apply research-gate (context7 → WebFetch) before documenting any external library/framework API

## Key Decisions

- Description is the ONLY content loaded at session start. All trigger-condition intelligence must be in the description, not the body.
- Body ≤500 lines is a hard cap. When body content would exceed this, move detail to `references/` files.
- `references/` files are loaded on-demand when the skill body explicitly instructs "read `references/<name>.md`." They are not auto-loaded.
- Maintenance skill has empty `metadata.source_files: []` because it documents skill conventions, not codebase patterns.
- Vendored skill `upstream:` block signals validators to preserve the body verbatim — do not rewrite upstream skill bodies to conform to kit CSO rules.

## When to Skip Updates

- Typo fixes in source files (no behavioral change)
- Pure rename/move with no logic change
- Test-only changes that don't affect documented patterns
- Comment additions that don't introduce new patterns

## Gotchas

- **Stale `metadata.updated`**: a skill with a year-old `updated` date and changed `source_files` silently ships wrong line references. The only safeguard is the discipline of updating `metadata.updated` on every behavioral change to `source_files`.
- **Description exceeds 1024 chars**: discovery scanner may truncate. Count before committing — use `wc -c` on the description string if unsure.
- **Single-agent `-a claude-code` installs for universal skills (from skills.txt)**: copy-directs into `~/.claude/skills/` without creating `~/.agents/skills/` canonical path. See `universal-skills-context` skill for the two-agent requirement.
- **`upstream:` block does NOT exempt from structural checks**: fenced frontmatter, name-matches-directory, description ≥ 20 chars, body ≤500 lines are still enforced. Only CSO prefix, `user-invocable`, and `metadata.updated` are relaxed.

## References

- `references/cso-description-rules.md` — checklist + pass/fail examples; read when drafting or reviewing a skill description
- `references/frontmatter-schema.md` — full YAML schema with field semantics; read when creating a new skill or vendoring a third-party skill
