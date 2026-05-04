---
name: roadmap-init
description: Use when bootstrapping the docs/roadmap/ convention in a project — creates planned/ongoing/finished/ subdirectories with .gitkeep files, writes a generic docs/roadmap/CLAUDE.md teaching tri-state checkbox tracking and auto-compact resilience, and adds a one-paragraph Roadmap section to the project's root CLAUDE.md (creating a stub if missing). Idempotent — skips files that already exist and reports what was untouched.
allowed-tools: >-
  Read Write Edit Glob Grep
  Bash(date) Bash(ls:*) Bash(mkdir:*) Bash(touch:*) Bash(test:*) Bash(stat:*)
  Bash(git status) Bash(git rev-parse:*) Bash(git log:*) Bash(git add:*)
  Bash(rtk:*)
---

# Roadmap Bootstrapper

One-shot scaffolder for the `docs/roadmap/` convention: lifecycle folders, `.gitkeep` files, a roadmap-local `CLAUDE.md`, and a top-level mention in the project's root `CLAUDE.md`. All operations target the current project root (the working directory at invoke time, not this kit). Single-session, no approval gate — the work is small and idempotent enough that re-running is the recovery mechanism.

---

<constraint>
Project-root targeting:

All paths in this command are RELATIVE to the project working directory at invoke time — `docs/roadmap/CLAUDE.md`, `CLAUDE.md`, etc. Never write to `/home/docks/projects/public/` or any other absolute kit path. If `git rev-parse --show-toplevel` succeeds, prefer that as the project root; otherwise use the current working directory.
</constraint>

<constraint>
Idempotency — never overwrite:

For each target (4 scaffolding paths + the project root `CLAUDE.md`), check existence FIRST. If a file or directory already exists, classify it as SKIP and do not touch it. The only exception is the project root `CLAUDE.md` — if it exists but does NOT contain the literal string `docs/roadmap`, append the Roadmap section once. If it already mentions `docs/roadmap`, treat it as SKIP.

Re-running this command on a project that already has `docs/roadmap/` must be a no-op for the existing files. Detection drives every action; never write blindly.
</constraint>

<constraint>
Phase 1 is read-only:

Phase 1 inspects the project state with `Read`/`Glob`/`Grep` and read-only `Bash` calls only (`test`, `ls`, `stat`, `git status`/`rev-parse`/`log`). No `Write`/`Edit`/`mkdir`/`touch` until Phase 2. After Phase 1 completes, `git status --short` should show no new untracked or modified files attributable to this command.
</constraint>

---

## Pre-flight context

Environment snapshot (rendered at command-invoke time via Claude Code `!`-injection):

- Date: !`date '+%Y-%m-%d %H:%M:%S %Z'`
- Project root: !`git rev-parse --show-toplevel 2>/dev/null || pwd`
- Working tree: !`git status --short 2>/dev/null | head -10 || echo "(not a git repo)"`

Existing scaffolding probe:

```!
test -d docs/roadmap && echo "docs/roadmap/ EXISTS" || echo "docs/roadmap/ MISSING"
test -f docs/roadmap/CLAUDE.md && echo "docs/roadmap/CLAUDE.md EXISTS" || echo "docs/roadmap/CLAUDE.md MISSING"
test -f CLAUDE.md && echo "CLAUDE.md EXISTS" || echo "CLAUDE.md MISSING"
ls docs/roadmap/ 2>/dev/null || true
```

Use this snapshot directly in Phase 1 — no need to re-shell.

---

## Phase 1: Detection

<task>
Inspect the project to decide which scaffolding actions are needed. Read-only — no Write/Edit/mkdir/touch in this phase.

Steps:

1. Confirm the project root (use the value rendered in Pre-flight). All subsequent paths are relative to it.
2. For each of the four scaffolding targets, classify as `CREATE` or `SKIP (already exists)`:
   - `docs/roadmap/planned/.gitkeep`
   - `docs/roadmap/ongoing/.gitkeep`
   - `docs/roadmap/finished/.gitkeep`
   - `docs/roadmap/CLAUDE.md`
3. For the project's root `CLAUDE.md`:
   - If file is MISSING: classify as `CREATE STUB` (write a minimal CLAUDE.md whose only content is the Roadmap section).
   - If file EXISTS: `Grep` for the literal token `docs/roadmap` in it.
     - If matched: classify as `SKIP (already mentions docs/roadmap)`.
     - If not matched: classify as `APPEND ROADMAP SECTION`.
4. Emit a 5-row table to the user showing target | classification | reason. This is the only "plan" the user sees — no separate approval gate.

Success Criteria:
- A 5-row classification table appears in the orchestrator's response.
- No file-system mutations occurred (`git status --short` unchanged from Pre-flight).
- Every classification is one of the allowed values listed above — no ambiguous "maybe" entries.
</task>

## Phase 2: Implementation

<task>
Execute the actions classified in Phase 1. Skip any target classified `SKIP`.

Steps:

1. **Directories + .gitkeep** — for each missing folder among `planned/`, `ongoing/`, `finished/`:
   - `mkdir -p docs/roadmap/<folder>`
   - `touch docs/roadmap/<folder>/.gitkeep`
2. **`docs/roadmap/CLAUDE.md`** — if classified `CREATE`, write the **Embedded Template** (below) verbatim. Substitute the timestamp tokens (`{{ISO_DATE}}`) with the output of `date +"%Y-%m-%dT%H:%M:%S%:z"`.
3. **Project root `CLAUDE.md`** —
   - If `CREATE STUB`: write a minimal file containing exactly the **Root-CLAUDE.md Mention** snippet (below) and nothing else.
   - If `APPEND ROADMAP SECTION`: use `Edit` (or `Read`-then-`Write` if the file is small) to append the **Root-CLAUDE.md Mention** snippet at the end of the file, separated from prior content by one blank line.
   - If `SKIP`: do nothing for this target. Log it as untouched.
4. Run `ls -la docs/roadmap/ docs/roadmap/planned docs/roadmap/ongoing docs/roadmap/finished` and capture the output.
5. Run `git status --short` and capture the output.

Final report to the user: a single bullet list (≤8 bullets) of created vs skipped paths, followed by the captured `ls` and `git status --short` outputs. No prose narration.

Success Criteria:
- Every target classified `CREATE` / `CREATE STUB` / `APPEND ROADMAP SECTION` in Phase 1 is now in the expected state on disk.
- Every target classified `SKIP` is still untouched (verify by absence from `git status --short` for that path).
- `docs/roadmap/CLAUDE.md` (if created) contains the literal heading `## Real-time task tracking — tri-state checkboxes` (Grep to confirm).
- The project root `CLAUDE.md` contains the literal string `docs/roadmap` after this phase.
- The final bullet list reflects reality, not the Phase 1 plan — re-verify with `test -f` before claiming "created".

Anti-Hallucination Checks:
- Before reporting "created", run `test -f <path>` and confirm exit 0.
- Before reporting "skipped", confirm Phase 1 classified it as SKIP — do not invent skips.
- Do not claim the root `CLAUDE.md` was updated unless `Grep "docs/roadmap" CLAUDE.md` matches a line you actually added.
</task>

---

## Embedded Template — `docs/roadmap/CLAUDE.md`

The verbatim content to write at `docs/roadmap/CLAUDE.md` (substitute `{{ISO_DATE}}` placeholders with the current ISO 8601 timestamp at write time):

````markdown
# Roadmap Conventions

All non-trivial plans live here. A plan is anything that takes more than one
commit to finish and/or needs checkbox tracking across sessions.

## Lifecycle folders

| Folder | When a plan lives here |
|--------|------------------------|
| `planned/` | Plan is written + approved, but no code has landed yet |
| `ongoing/` | At least one commit toward the plan has landed |
| `finished/` | All steps closed; prefixed with completion date `YYYY-MM-DD-<slug>.md` |

Move the file with `git mv` between folders so history is preserved.

## File header (required)

Every plan starts with a YAML metadata block and a status line:

```markdown
---
created: {{ISO_DATE}}
updated: {{ISO_DATE}}
finished: null
status: planned
---

# <Plan Title>
```

Rules:

- **`created`** — set once, never change.
- **`updated`** — bump to the current timestamp on every edit, including state flips.
- **`finished`** — `null` until the plan moves to `finished/`, then set to the completion timestamp.
- **`status`** — one of `planned`, `ongoing`, `finished`. Must match the folder.

Timestamps are ISO 8601 with explicit local offset
(`YYYY-MM-DDTHH:MM:SS±HH:MM`). Never use relative phrasing like "today" or
"last week" inside the plan. Fetch a fresh timestamp:

```bash
date +"%Y-%m-%dT%H:%M:%S%:z"
```

## Real-time task tracking — tri-state checkboxes

Every actionable step is a GitHub-style checkbox in one of three states:

| State | Meaning | Commit policy |
|-------|---------|---------------|
| `- [ ]` | Planned, not started | Lives in commits |
| `- [~]` | Active / in-progress / partial | **Uncommitted scratch state — flip freely without a commit** |
| `- [x]` | Done — code landed | Flip in the commit that lands the step (or the next commit if batched) |

The `[~]` state is the working scratch marker. It exists so you can:

- Mark several steps as "currently touching" during exploratory work without
  generating a commit per micro-step.
- Recover state after auto-compaction: the file on disk is the source of
  truth, so progress isn't lost when the conversation context gets summarized.
- Sweep `[~]` → `[x]` when steps actually land — either step-by-step or in a
  small batch within the same logical commit.

**Hard rule:** never flip `[x]` for a step you didn't actually land in code.
`[~]` is permissive; `[x]` is a binding claim that the step shipped.

If a step is abandoned mid-flight, strike it through (`~~…~~`) with a
one-line reason rather than silently deleting it.

If scope changes, update the plan in the same commit that enacts the change.

## Auto-compact resilience

The plan file on disk is the source of truth — it is not part of conversation
context, so auto-compact never touches it. Practices that exploit this:

- **Re-read before resume** — when picking up work after a gap or after a
  compaction event, start by re-reading the plan file rather than relying on
  conversation memory.
- **Update as you go** — flip `[~]` and `[x]` in the file, not just in chat.
  Conversation state is volatile; file state is durable.
- **Don't track state only in chat** — if a TodoWrite list is the only place a
  step's status lives, auto-compact can drop it. Mirror anything important to
  the plan file.

## Lifecycle transitions

| Transition | What to do |
|------------|------------|
| New plan | Create in `planned/<slug>.md` with the header, status `planned`. |
| First commit toward plan | `git mv` to `ongoing/`, flip status to `ongoing`, bump `updated`. |
| Last `[~]` / `[ ]` flips to `[x]` | `git mv` to `finished/YYYY-MM-DD-<slug>.md`, set `finished`, flip status to `finished`, bump `updated`. |
| Plan superseded | Move to `finished/` with `status: superseded` and a one-paragraph note explaining what replaces it. |

## Slugs

Lowercase, hyphenated, descriptive. Match the primary commit scope where
possible (e.g. `auth-rate-limit`, `image-cdn-migration`).

When a plan lands in `finished/`, prefix with the completion date to keep the
folder chronologically browsable:

```
finished/2026-05-04-auth-rate-limit.md
```

## Not a plan

Reference docs, architecture notes, and API contracts do **not** belong here —
they belong in `.claude/skills/`, `.claude/agents/`, or the project's root
`CLAUDE.md`. This folder is strictly for time-boxed work items where progress
needs to be tracked across sessions.
````

---

## Root-CLAUDE.md Mention

The snippet to append to the project's root `CLAUDE.md` (or to be the entire body of a freshly created stub):

```markdown
## Roadmap

Multi-commit work plans live in `docs/roadmap/` and move between `planned/` →
`ongoing/` → `finished/` via `git mv` so history is preserved. Tracking uses
tri-state checkboxes (`[ ]` planned, `[~]` active scratch, `[x]` landed); only
`[x]` is a binding commit claim. See `docs/roadmap/CLAUDE.md` for the full
convention.
```

When appending to an existing `CLAUDE.md`, prepend a single blank line so the
new section is visually separated from prior content.

When creating a stub (no prior `CLAUDE.md`), the file's entire content is this
snippet — nothing else.

---

## Allowed Tools

See frontmatter. Phase 1 uses `Read`/`Glob`/`Grep` and read-only `Bash` calls (`test`, `ls`, `stat`, `git status`/`rev-parse`/`log`). Phase 2 adds `Write`/`Edit` plus `mkdir`/`touch` for the actual scaffolding. No subagents are invoked — this is a single-session orchestrator since the work is mechanical.

## Usage

```bash
/roadmap-init    # Detect, then scaffold (no arguments, no approval gate)
```

Idempotent: re-running on a project that already has `docs/roadmap/` reports each existing target as `SKIP` and writes nothing. The recovery mechanism for any partial state is to re-run the command.
