# CSO Description Rules — Checklist

## Critical Constraint

Description is loaded at every session start (~100 tokens per skill). It must encode TRIGGER CONDITIONS, not capabilities. A capability-first description is invisible to semantic matching against user task descriptions.

## Mandatory Rules

1. **MUST start with "Use when"** — no exceptions for kit skills (vendored skills are exempt via `upstream:`)
2. **MUST include ≥5 project-specific identifiers** — function names, file names, variable names, flag names, path names from the actual codebase
3. **MUST be ≤1024 characters** — discovery scanner may truncate longer descriptions
4. **MUST describe trigger scenarios** — when should Claude load this skill? Not: what does this skill contain?

## Checklist

```
[ ] Starts with "Use when"
[ ] ≥5 identifiers from the actual codebase (not generic terms)
[ ] ≤1024 characters (count: echo -n "..." | wc -c)
[ ] Trigger conditions listed (not capabilities)
[ ] No banned phrases (see below)
```

## Banned Phrases (Generic/Non-Informative)

| Banned | Why | Replace with |
|--------|-----|-------------|
| "important to note" | AI slop | Just state the fact |
| "this skill covers" | Capability framing | "Use when editing <X>" |
| "provides a reference for" | Capability framing | "Use when modifying <X>" |
| "comprehensive guide to" | Inflated adjective | Specific trigger condition |
| "you need to understand" | Condescending | Direct trigger: "Use when <task>" |

## Pass / Fail Examples

| Description | Result | Reason |
|-------------|--------|--------|
| "Use when editing sync.sh, lib/common.sh, or any flag in --force / --remove-plugins; covers TARGET_FILTER_SET, FORCE, REMOVE_PLUGINS, common::parse_args, common::preflight" | PASS | Starts with "Use when", 5+ identifiers, triggers stated |
| "This skill provides a reference for the sync.sh orchestration system and its flags" | FAIL | Capability framing; no "Use when"; generic |
| "Use when running sync.sh" | FAIL | Triggers too vague; 0 project-specific identifiers |
| "Use when modifying settings merge behavior in claude::sync_settings for ~/.claude/settings.json and ~/.claude.json" | PASS | "Use when", identifiers: `claude::sync_settings`, `settings.json`, `~/.claude.json` |

## Identifier Counting Rules

Count identifiers that are specific to THIS project's codebase:

| Counts | Does Not Count |
|--------|---------------|
| `TARGET_FILTER_SET` (variable name) | "flags" (generic) |
| `claude::sync_settings` (function name) | "settings" (generic) |
| `lib/common.sh` (file path) | "bash scripts" (generic) |
| `--remove-plugins` (flag name) | "remove plugins" (generic) |
| `jq -e … has($n)` (code idiom) | "JSON processing" (generic) |
| `SoT/.claude/settings.json` (SoT path) | "config files" (generic) |

## Length Verification

```bash
echo -n "Use when editing sync.sh…" | wc -c
```

Target: under 900 characters to leave margin for future edits without needing to recount.
