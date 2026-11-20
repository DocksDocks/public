# Data preservation for transforming skills

Read this when authoring or editing a skill that **moves, splits, migrates, or rewrites existing content** (root → nodes, `CLAUDE.md` → `AGENTS.md`, `SKILL.md` → `references/`, code refactors). These skills can drop content with no error. The discipline below is the kit standard.

This file is **author-facing** — you read it while writing a skill, inside the docks repo. The runtime check (the bash in Template C) is **copied into each skill's own body or `references/`**, never linked from here at runtime. Duplication across skills is acceptable; a cross-skill link is a dangling pointer (agentskills.io: "keep file references one level deep").

## Why a byte-percentage floor is the WRONG primary check

A split/migration *adds* scaffolding (new headings, `@AGENTS.md` imports, sibling files, breadcrumbs), so total output is normally **≥100%** of input. A "fail if output < 95% of input" floor therefore (a) is too lenient — a whole lost section hides under added scaffolding — and (b) is backwards for the common case. **Per-section presence is the real invariant**; byte-delta is only a crude net-shrink tripwire.

## The 10-point checklist

1. **Inventory first.** Before any write, snapshot every source file you'll read or modify: path, byte count, and the list of `^#{1,3}` section headings.
2. **Account for every section.** Each source section must end up in some destination, or be **explicitly marked DROP** by the user at the gate. No silent omission.
3. **Route MIXED content paragraph-by-paragraph.** When a section is part-keep/part-move, split on blank lines and route each paragraph; default the unclassified remainder to **STAY** in the source.
4. **Show the plan, not just the targets.** The approval gate renders a `Section | Destination | Reason` table — never just a folder/file list. The user cannot catch a lost section they never see.
5. **Blocking approval gate.** The pause is a call to the omp `ask` tool; the agent writes nothing until the user answers. If `ask` is not available (a headless subagent or a print-mode run), the fallback is to *end the turn* (Template B).
6. **Two-phase write for relocations.** Write the new destinations first and verify they parse; prune the source **only after** a second confirmation. A halt mid-way then leaves *duplicated* (recoverable) content, never *lost* content.
7. **Copy verbatim when relocating.** Reformatting (heading level, list markers) is fine; **rewording is not**. Relocation must be content-preserving, not a paraphrase.
8. **Back up before destructive writes.** `git stash push -u -m "<skill>-pre-<op>-<ISO>"` is a one-command recovery anchor when in a repo.
9. **Verify by reading back.** After writing, re-read destinations and confirm every source section heading still appears downstream (Template C). Fail loud on a miss — do not claim success.
10. **Report real numbers.** The final report cites filesystem facts (`sections_preserved/total`, `bytes_in`, `bytes_out`), not narration.

## Template A — preservation constraint (top of body)

Place near the top so the agent reads it before any step (agentskills.io progressive disclosure: <https://agentskills.io/specification>). Write it as a literal checklist (literal-following models execute it step by step). Keep it readable as plain markdown.

```markdown
<constraint>
**No content loss across the transform.** Before any `write`, `edit`, or `git mv`:
1. Inventory every source section (`^#{1,3}` headings) + byte count.
2. Show a `Section | Destination | Reason` table; unclassified → KEEP in source.
3. Relocate verbatim (reformat OK, reword NOT). Two-phase: write destinations,
   verify, prune source last.
4. After writing, confirm every source section appears downstream AND total
   output is not a net shrink. On any miss: stop, locate it, do NOT report success.
</constraint>
```

## Template B — blocking approval gate

```markdown
<constraint>
**Approval gate — blocking, not a soft pause.** At the "propose" step: print the
Section→Destination table, then ask for approval with the omp `ask` tool. Send
one form per call, with every open question in that form. An error, a cancel,
or a timeout result is not approval: write nothing and end the turn. If `ask`
is not available or returns an error (for example, in a headless subagent or a
print-mode run), print the question as your FINAL message and end the turn; do
not invent a tool call.
Do NOT call `write`, `edit`, `git mv`, or a writing `bash` command until the
user answers. Silence is not consent; ambiguous answers → re-show the table and
ask again.
</constraint>
```

BAD: a plain-text "Approve? yes/no" at the end of a reply that keeps working, or when a question tool exists.

## Template C — inline verification block (copy into the skill, plain bash)

Pure POSIX + `grep`/`wc` (portable Linux + macOS).

```bash
## Verification (run before reporting success — fail loud)

# 1. Per-section presence: every source heading must appear in some destination.
# Strip the leading #s so a promoted/demoted heading (### → ##) still matches.
grep -E '^#{1,3} ' "$SOURCE_BEFORE" | sed -E 's/^#{1,3} +//' | while IFS= read -r h; do
  grep -rqF "$h" <destination-files> || echo "LOST SECTION: $h"
done

# 2. Net-shrink tripwire (a split ADDS scaffolding → expect output >= input bytes).
before=$(wc -c < "$SOURCE_BEFORE")
after=$(cat <every-file-written> | wc -c)
awk -v b="$before" -v a="$after" 'BEGIN{ if (a < b) print "NET SHRINK — investigate" }'

# Any non-empty line above ⇒ stop, locate the content, do NOT claim success.
```

## What a CI lint can and cannot check

`scripts/skills/transform-guard.mjs` validates **this repo's committed skill files** — it flags a docks SKILL.md that describes a transform but omits a preservation constraint + `## Verification` block. It is a *structure* lint. It canNOT check consumer runtime data loss: `scripts/` is author-side-only and never ships, and the skill runs in the consumer's repo where these scripts don't exist. That is exactly why the runtime check lives **inline in the skill body**, not in a shipped script.
