---
name: agent-first-setup
description: "Use when making a repository agent-first in one pass — root AGENTS.md, nested AGENTS.md nodes, skills in .agents/skills, no CLAUDE.md, no legacy .claude folder, durable docs — or auditing whether a repo is. Runs claude-md-migration and context-tree init, cleans up .claude after approval, adds a project verify skill, and ends with a pass/fail check. Not for one step alone: CLAUDE.md migration (use claude-md-migration), nested nodes only (use context-tree), or plan workspace setup (use plan-workspace)."
user-invocable: true
metadata:
  pattern: pipeline
  updated: "2026-11-20"
  content_hash: "eb8a5e48db1a7126dc393b36c28b25cd0a5c8252e0a18eaa2f967c5309bd9de4"
---

# Agent-First Setup

Make a repository easy for an omp agent to use, in one pass. An agent-first repository is:

- **Findable** — a root `AGENTS.md` routes to every nested `AGENTS.md` node; skills live in `.agents/skills/`, and project agents in `.omp/agents/`. omp loads `AGENTS.md` files only from the session folder up to the root, so the root routing table is how a session finds a deeper node.
- **Fast to understand** — the root states build/test/lint commands and repo-wide rules only; folder rules live in the folder `AGENTS.md`; each fact has one home.
- **Trustworthy** — docs hold durable facts only: no line anchors, no live counts or versions, no time-relative phrases; a volatile value carries the command that re-derives it.
- **Verifiable** — the check in Step 3 is a command, not prose. A project `verify` skill names the commands that start, drive, inspect, and stop the real product.
- **Free of legacy Claude Code files** — omp keeps one context file for each folder depth, and `AGENTS.md` comes first, so omp ignores a `CLAUDE.md` next to an `AGENTS.md`. A `.claude/CLAUDE.md` in the folder where a session starts replaces the `AGENTS.md` of that folder. omp finds project skills in `.agents/skills`. It also reads `.claude/skills` as a Claude-compatible skill source with a higher priority, so a `.claude/skills/<name>` that differs from `.agents/skills/<name>` gets the bare skill name. omp reads project agents only from `.omp/agents` and does not read `.claude/agents`. It reads `.claude/settings.json` as project settings (omp docs: `context-files.md`, `skills.md`, `task-agent-discovery.md`).

This skill is an orchestrator. `claude-md-migration` and `context-tree` do the work; this skill puts them in order, creates a missing root `AGENTS.md` in Step 1, cleans up the `.claude/` folder in Step 2a, adds the project `verify` skill in Step 2b, offers a pull-request template in Step 2c, and ends with the check.

<constraint>
Delegate, do not re-implement. For Step 1 and Step 2, load the named skill and follow its workflow as written, including its detection, classification, and verification steps. Do not copy, shorten, or reorder its steps here. If a named skill (`claude-md-migration`, `context-tree`) or a prerequisite it names is not available, STOP before any write and name the missing skill or plugin in your final message.
</constraint>

<constraint>
Every write stays behind the approval gate of the skill that owns it. At that gate, print the owning skill's proposal and ask for approval with the omp `ask` tool (see "Asking the user"). Resume this workflow only after the user answers. This skill owns four writes, each behind its own approval gate: the root `AGENTS.md` in Step 1 when no legacy `CLAUDE.md` exists, the `.claude/` cleanup in Step 2a, the project `verify` skill in Step 2b, and the pull-request template in Step 2c. It never overwrites an existing file. `audit` mode never writes: it runs Step 0, the owning skills' read-only modes, the detection of Step 1, Step 2a, Step 2b, and Step 2c, and Step 3, then reports. Step 3 reports findings; it never auto-fixes them.
</constraint>

## Modes

| Invocation | Runs | Writes? |
|---|---|---|
| `agent-first-setup` (default) | Step 0 → Step 1 → Step 2 → Step 2a → Step 2b → Step 2c → Step 3 → Step 4 | only through the owning skills' approval gates and the gates of Step 1, Step 2a, Step 2b, and Step 2c |
| `agent-first-setup audit` | Step 0 → read-only detection of Step 1 → `context-tree audit` → Step 2a proposal → Step 2b detection → Step 2c detection → Step 3 → Step 4 | never |

## Asking the user

Ask every question with the omp `ask` tool. This includes approval gates, owner choices, and missing build, test, or lint commands. The tool blocks until the user answers and records the answer in the transcript. A question in plain reply text does neither. Put all open questions for one gate into one call. An error, an empty result, or a default result is not approval: print the question, write nothing, and end the turn. If the `ask` tool is not available (for example, in a headless or print-mode run), print the questions, take no write, and end the turn.

## When to Use

- A new or inherited repository must work for omp agents, and the user wants it done in one pass.
- The user says "make this repo agent-first", "set up this repo for agents", or `/skill:agent-first-setup`.
- A repository still has a Claude Code `.claude/` folder with skills, agents, or settings.
- A health check after a large restructure: run `audit` for a pass/fail table with the owning skill for each fix.

## When NOT to use

| Situation | Use instead |
|---|---|
| Only migrate a legacy `CLAUDE.md` or `.claude/CLAUDE.md` into `AGENTS.md` | `claude-md-migration` |
| Only add, audit, or refresh nested AGENTS.md nodes | `context-tree` |
| Set up or refresh the GitHub-issue plan workspace (`docs/AGENTS.md`, `docs/PLAN.md`) | `plan-workspace` |
| Fix a stale or invalid SKILL.md found by the check | `skill-maintenance` |
| Author a new skill | `write-skill` |

## Workflow

### Step 0 — Resolve root and detect state (read-only)

The read-only checks and the write gates of this skill are helpers of the `docks-kit agent-docs` command of the kit CLI. It needs docks-kit 0.26.0 or later; `docks-kit update` installs it. Run the detection from any folder inside the repository:

```bash
docks-kit agent-docs agent-first detect
```

The first line is the repository root (the current folder outside git). Run every later command from that root. Record the state; do not write. The command only reads, and it prints these lines:

| Line | Meaning |
|---|---|
| `root AGENTS.md:`, `.agents/skills:` | `present` or `missing` |
| `legacy skills: .claude/skills` | a legacy Claude Code skills folder; Step 2a cleans it up |
| `legacy agents: <path>` | a Claude Code agent file `.claude/agents/<name>.md`; Step 2a converts or reports it |
| `legacy settings: <path>` | `.claude/settings.json` or `.claude/settings.local.json`; Step 2a reports it |
| `legacy other: .claude/<name>` | another entry of the root `.claude/` folder (not `CLAUDE.md`, `skills`, `agents`, or a settings file), for example `.claude/commands`; Step 2a reports it |
| `legacy external: <path> -> <target>` | a `.claude`, `.claude/skills`, or `.claude/agents` symlink whose real path is outside the repository. The command lists nothing below it; Step 2a reports it and never moves or removes it |
| `legacy: <path>` | a `CLAUDE.md` or a `.claude/CLAUDE.md`, at any depth; Step 1 migrates it |
| `personal: <path>` | a `CLAUDE.local.md`, also a gitignored one, because that personal file is usually gitignored |
| `node: <path>` | an `AGENTS.md` below the root; a file under `node_modules` is package content, not a node |
| `not-a-symlink: <path>` | a `.claude/skills` entry that is a real folder or file; Step 2a moves it |
| `ERROR legacy entries: ...` | the command cannot read the `.claude` folder or a folder in it |
| `pull-request template:` | the detection of [references/pull-request-template.md](references/pull-request-template.md) |
| `verify skill:`, `verify unverified:` | the Detect lines of [references/verify-skill-template.md](references/verify-skill-template.md) |

Outside git, the command walks the folder itself and skips each `.git`, `node_modules`, and `vendor` folder. The `pull-request template:` lines tell a usable template from an unusable entry, such as a broken symlink or an empty template folder, and `pull-request template: none` means that no usable template exists. That detection needs git; outside git, it prints an `ERROR` line. Report that error. An error is not a missing template. The verify lines are a `verify skill:` line and one `verify unverified:` line for each result that no run has shown. The verify detection prints an `ERROR` line when it cannot read the skill; report that error. After an `ERROR` line, the command exits with status 2 and its cause is on stderr; read every line that it printed. Status 1 is a usage error; otherwise the status is 0.

If Step 0 shows root `AGENTS.md` present, no `legacy:` or `personal:` line, no line of a `.claude` entry (`legacy skills`, `legacy agents`, `legacy settings`, `legacy other`, `legacy external`, `not-a-symlink`), no `.claude` entry at the root (`test -e .claude || test -L .claude` fails), and at least one node or a small repo, go directly to Step 2b. When a `.claude` entry is at the root, also when it holds only settings files or is empty, run Step 2a: it reports the settings and other entries and removes empty folders. Step 2b is a no-op when Step 0 shows `verify skill: present` and no `verify unverified:` or `ERROR` line. Step 2c is a no-op when Step 0 printed a usable `pull-request template:` line and no `pull-request template: none` line. A pass in Step 3 means the repo is already agent-first.

### Step 1 — Root `AGENTS.md` and legacy `CLAUDE.md`

- **Step 0 printed a `legacy:` line.** Load `claude-md-migration` and follow it from its first step. It owns the migration of each `CLAUDE.md` and `.claude/CLAUDE.md` into `AGENTS.md`, and it creates a destination `AGENTS.md` that does not exist. Its approval gate ends the turn; continue here after the user approves and its own verification prints no `BROKEN:` line. If it reports `BROKEN:`, STOP and report; do not start Step 2.
- **Step 0 printed `root AGENTS.md: missing` and no `legacy:` line.** This skill creates the root `AGENTS.md`:
  1. Fill [references/agents-md-template.md](references/agents-md-template.md) as its fill rules say. Take the commands from the build files; ask for a missing build, test, or lint command.
  2. Print the draft and the path `AGENTS.md`, and ask for approval.
  3. After approval, run the write gate of Step 2b with the path, and check that no entry is at `AGENTS.md`. Write only when the gate prints nothing and exits 0, and `test -e AGENTS.md || test -L AGENTS.md` fails. Otherwise report the line or the entry, write nothing, and stop.

     ```bash
     docks-kit agent-docs verify-skill write-gate AGENTS.md
     ```

  4. Write `AGENTS.md`. Never write through a symlink.
- **Root `AGENTS.md` present and no `legacy:` line.** Step 1 is a no-op.

Report each `personal:` line: omp does not load a `CLAUDE.local.md`. The user decides: list it in `contextFiles.extra`, move its content to `~/.omp/agent/AGENTS.md`, or keep it. Never change it.

In `audit` mode, run only the read-only detection and audit steps of `claude-md-migration`, and record what it would change and whether this step would create the root `AGENTS.md`.

### Step 2 — Run `context-tree`

- No nested node exists → load `context-tree` and run `init`. It decides which folders earn a node; a small repo can correctly get none.
- Nodes exist → run `context-tree audit`. If it reports drift and the user asks to fix it, run `context-tree refresh` through that skill's own handoff.
- `context-tree` names its own prerequisites (the docks-kit kit plugin). If it stops on one, report that blocker and continue to Step 2a.

In `audit` mode, run `context-tree audit` only.

### Step 2a — Clean up the `.claude/` folder

The `.claude/` folder at the root is the Claude Code configuration. omp still reads `.claude/skills` as a Claude-compatible skill source with a priority above `.agents/skills`: a `.claude/skills/<name>` that differs from `.agents/skills/<name>` gets the bare name, and the `.agents/skills` skill gets a namespaced name. omp does not read `.claude/agents`. The target layout keeps skills only in `.agents/skills` and agents in `.omp/agents`. Step 1 already migrated `.claude/CLAUDE.md`. This skill owns this cleanup, behind its own approval gate. Step 2a is a no-op when no `.claude` entry is at the root.

1. Run the Step 0 detection again, because Step 1 can change the folder. Its `legacy skills`, `legacy agents`, `legacy settings`, `legacy other`, `legacy external`, and `not-a-symlink` lines are the inventory. For the `.claude/skills` entries, also run `ls -A .claude/skills` when no `legacy external` line names `.claude` or `.claude/skills`. On an `ERROR legacy entries:` line, report it and make no change in this step.
2. For each `legacy agents:` line, run the conversion. It only reads, prints the omp agent text on stdout, and writes no file:

   ```bash
   docks-kit agent-docs agent-first convert-agent <path>
   ```

3. Build one proposal table, one row for each entry, with the action of the rules below. Print the table, each converted agent text, and each refused agent with its frontmatter and its `ERROR` line. Then ask for approval in one `ask` call. The user can approve, skip, or change each row; a skipped row stays in place.
4. After approval, run the actions in this order: skills, agents, then the empty folder. Immediately before each skill move and each `.omp/agents` write, run the write gate with the destination path, and check that no entry is at that path:

   ```bash
   docks-kit agent-docs verify-skill write-gate <destination>
   test -e <destination> || test -L <destination>
   ```

   Move or write only when the gate prints nothing and exits 0, and the `test` command fails. For a `target occupied:` line or an existing entry, do not move or write that entry: report the line or the entry, and leave the source in place. Run the gate before you make a missing `.agents/skills` or `.omp/agents` folder. A move uses `git mv` when git tracks the source (`git ls-files -- <path>` prints a path), and a plain `mv` when git does not track it or the repository is not a git repository. A removal uses `git rm` when git tracks the entry, and `rm` otherwise; `rm` on a symlink removes the link only. Report the command that you used for each entry.
5. Run the Step 0 detection again and report each `legacy` line that is still there.

| Entry | Action |
|---|---|
| `.claude/skills` as a symlink to `.agents/skills`, or a `.claude/skills/<name>` symlink that resolves into `.agents/skills` | Remove the link. The skill stays in `.agents/skills`. |
| `.claude/skills/<name>` as a real folder (`not-a-symlink:`) | Move it to `.agents/skills/<name>/` (make `.agents/skills` first when it is missing). When `.agents/skills/<name>` exists, do not move: show both and ask which one stays. Until then, omp gives the bare name `<name>` to the `.claude/skills` skill when the two differ, because the Claude source has the higher priority. |
| `.claude/skills/<name>` as a broken symlink, or a link outside `.agents/skills` | Report it; the user removes or keeps it. |
| `.claude/agents/<name>.md` that `convert-agent` converted | Show the omp text with this note: omp gives the agent the listed tools and also its MCP, extension, and custom tools. After approval, write the printed text, unchanged, to `.omp/agents/<name>.md` (step 4 gates the write), then remove the Claude file. When `.omp/agents/<name>.md` exists, never overwrite it: show both files and ask. The user can also drop the agent: then remove the Claude file and write nothing. |
| `.claude/agents/<name>.md` that `convert-agent` refused | Report it with its frontmatter and the reason of the `ERROR` line, and leave it in place; the user ports it by hand, or drops it. |
| `.claude/settings.json`, `.claude/settings.local.json` | Report each file with this warning: omp reads `.claude/settings.json` as a project settings source, so each key in it can be an active omp setting. Leave both in place; the user moves or removes them by hand. |
| `.claude/CLAUDE.md` | Step 1 owns it. If it is still there, report it and send the user to `claude-md-migration`. |
| `legacy other: .claude/<name>` (for example `.claude/commands`, `.claude/hooks`) | Report it and leave it in place; the user decides. |
| `legacy external: <path> -> <target>` | Report it with its target. Never move, remove, or follow it, and never change an entry below it; the user decides. |
| `.claude/skills`, `.claude/agents`, or `.claude/` itself when it is an empty folder after the actions | Remove the empty folder with `rmdir`. Never remove a folder that still holds an entry. |

The rules of `convert-agent` follow. omp reads an agent from `.omp/agents/<name>.md` and adds its MCP, extension, and custom tools to every explicit `tools` list, and a Claude denial has no omp form. So only a simple agent converts:

- **Converted:** the frontmatter holds only `name`, `description`, `tools`, `model`, `color`, and `effort`; `tools` is an explicit list (a comma-separated value, with or without quotes, a `[...]` list, or `- <tool>` lines; a trailing `# <comment>` outside quotes is removed); each tool has an omp name: `Read` → `read`, `Grep` → `grep`, `Glob` → `glob`, `Bash` → `bash`, `Edit` → `edit`, `Write` → `write`, `WebSearch` → `web_search`. A value that YAML 1.2 reads as a string converts: a mixed-case spelling such as `tRue`, `.iNf`, or `nUll`, and a colon inside a block scalar, inside quotes, or before a non-space character (`https://x`), are text. The output keeps `name` (in double quotes when YAML would read the bare name as a number or a boolean, for example `"123"`), `description`, the mapped `tools`, and the body. It drops `model`, `color`, and `effort`, and names them on stderr, because a Claude model alias fails in omp. The command exits 0.
- **Refused:** no `tools` list, a `disallowedTools` field, a tool with no omp name, a tool with a pattern such as `Bash(git status)`, no `name` or `description` (also an empty, `""`, `''`, `~`, `null`, `Null`, or `NULL` value, or a `|` or `>` block scalar with no content line; the reason is `no <field> field`), a `name` or `description` that YAML reads as no string (the reason is `<field> is no YAML string`: an unquoted boolean, number, or special float in a YAML 1.2 core-schema spelling, such as `true`, `True`, `FALSE`, `12`, `0x1F`, `1e3`, `.inf`, or `.NaN`; a value that starts with `[`, `{`, `]`, `}`, `,`, `*`, `- `, `? `, `%`, `@`, or a backtick; a `|` or `>` header that is not valid, such as `|x` or `|0`; a `- ` list; or a block mapping, that is a continuation line in `key: value` form), a `name` or `description` that starts with an anchor `&` or a tag `!`, also on a continuation line (the reason is `<field> uses a YAML anchor or tag`), a field that appears twice, the name `main` or `sub` (omp reserves them), a name that is not a safe file name (only lower-case letters and digits, in groups joined by single hyphens), or any other field (for example `permissionMode`, `hooks`, `mcpServers`, `skills`, `maxTurns`, or an unknown field). The command prints one `ERROR convert-agent <path>: <reason>; port it by hand` line and no agent text, and exits 2.

In `audit` mode, run steps 1 to 3 without the question, and record the table. Write nothing.

### Step 2b — Create the project `verify` skill

A project `verify` skill tells an agent how to run the real product the way a user or another program does. This skill owns this write. Follow the Create or re-verify section of [references/verify-skill-template.md](references/verify-skill-template.md). It runs `docks-kit agent-docs verify-skill detect` again first, because Step 2a can move a skill into `.agents/skills`. Its write gate and entry gate are `docks-kit agent-docs verify-skill write-gate <path>...` and `docks-kit agent-docs verify-skill entry-gate`. Ask each question of that section with the `ask` tool (see "Asking the user"). If the tool is not available, end the turn and report Step 2b as blocked.

- When the section stops without a write, record its reason for the report, for example "no runnable surface" or an occupied `.agents/skills/verify`, and go to Step 2c.
- Step 2b is complete only when the section leaves the skill verified: each command ran and showed its expected result, and the skill holds no `not observed:` entry. A failed command stays in the report with its output.

In `audit` mode, use the Step 0 output and run only step 4 and step 5 of that section, which write nothing. Record whether the skill exists, each `verify unverified:` or `ERROR` line, or the surface that needs the skill.

### Step 2c — Offer the pull-request template

This skill owns this write, behind its own approval gate. Follow [references/pull-request-template.md](references/pull-request-template.md). Offer the template only when Step 0 printed `pull-request template: none`, and list each `unusable` line with it. On a usable template, make no change; on an `ERROR` line, report the error and write nothing. Fill in the check command from the root `AGENTS.md` (or `Checks pass` when it names none), print the draft and the path `.github/pull_request_template.md`, and ask with the `ask` tool. After approval, run the write gate of the reference, `docks-kit agent-docs pr-template gate`, and write only on `target free`. On `target occupied`, report the entry that occupies the path and write nothing; the user resolves it. Never write through a symlink. Tell the user that GitHub uses the template only after it is on the default branch. In `audit` mode, record the Step 0 lines only.

### Step 3 — Agent-first check (read-only)

Run the check from the repository root. It only reads; it writes no file.

```bash
docks-kit agent-docs agent-first check
```

Every line it prints is `FAIL` (a contract break), `FINDING` (a risk or cleanup item a human must judge), or `ERROR` (a check that could not run; report its message, never as a pass). Each line starts with its kind and its check id, for example `FAIL C2 node not routed from root: api/AGENTS.md`. The lines come in the order C1 to C10. No output means every check passed. After an `ERROR` line, the command exits with status 2 and the cause is on stderr; the other lines still count. A check prints `ERROR C<n> cannot read <file>` for a file that it cannot read, and `ERROR C<n> file listing failed (see the message above)` for a file listing that fails. Outside git, the check walks the folder itself and skips each `.git`, `node_modules`, and `vendor` folder.

| Check | Rule | Lines |
|---|---|---|
| C1 | The root `AGENTS.md` exists and names its build, test, and lint commands (a whole word, any letter case). | `FAIL` when the file is missing; one `FINDING` for each command word that it does not name (add it, or accept: the repo has none or one gate covers it) |
| C2 | Every nested node is a row in a root table, and every row resolves. A row is a table line whose first cell is `<dir>/AGENTS.md` in backticks; a leading `@` inside the backticks is stripped. | `FAIL` for a node that no row routes, and for a dead route |
| C3 | No legacy context file. omp ignores a `CLAUDE.md` next to an `AGENTS.md`; a `.claude/CLAUDE.md` replaces the `AGENTS.md` of the folder where a session starts; a `CLAUDE.md` alone at its depth loads; omp does not load a `CLAUDE.local.md`. The root `CLAUDE.md`, `.claude/CLAUDE.md`, and `CLAUDE.local.md` count also when git ignores them. | `FAIL` for a `CLAUDE.md` next to an `AGENTS.md` and for each `.claude/CLAUDE.md` (migrate it with `claude-md-migration`); `FAIL C3 CLAUDE.md link to AGENTS.md` for a `CLAUDE.md` or `.claude/CLAUDE.md` that is a symlink to the `AGENTS.md` of its folder (remove the link; it has no content to migrate); `FINDING` for a `CLAUDE.md` with no `AGENTS.md` at its depth (it loads, but `AGENTS.md` is the convention), and for a `CLAUDE.local.md` (personal file; the user decides: `contextFiles.extra`, `~/.omp/agent/AGENTS.md`, or keep it) |
| C4 | No legacy `.claude` entry: each `.claude/skills` entry (a link or a folder, broken or not; no dot names), each `.claude/agents/*.md` file, each `.claude/settings.json` or `.claude/settings.local.json`, each other entry of the root `.claude/` folder, and each `.claude`, `.claude/skills`, or `.claude/agents` symlink whose real path is outside the repository. | One `FINDING` for each entry (Step 2a cleans it up; a settings file stays until the user moves it). `FINDING C4 legacy .claude entry (report only; the user decides): .claude/<name>` for another entry, and `FINDING C4 legacy .claude entry outside the repository (report it; never move or remove it): <path>` for an outside symlink |
| C5 | The durable-doc scan of each `AGENTS.md`, `SKILL.md`, and `skills/**/references/*.md`. Fenced blocks and URLs are skipped everywhere. Inline code spans and quoted text are skipped for the time and count rules only (a line anchor inside backticks still counts). A line anchor counts only when its path exists from the repo root or from the folder of the file (fictional example paths pass). The count rule skips a line that holds `verify:`; a phase, step, or tier number is not a count. | `FINDING C5 time-relative`, `bare-count`, and `line-anchor` with `<file>:<line>`, and `FINDING C5 no stale-tolerance line` for an `AGENTS.md` without the "Pointers here name concepts" line. Findings only; never auto-fix them |
| C6 | Every skill description starts with "Use when". A block scalar (`>`, `\|`, `>-`, `\|-`) reads its first indented line. | `FAIL` |
| C7 | No bare `@path` import in an `AGENTS.md`: omp expands it into context every time that file loads. Code spans and fenced blocks are not imports, so `` `@<dir>/AGENTS.md` `` in a routing row passes. A relative path resolves from the folder of the file; a `~/` path resolves from the home folder. | `FINDING` with the line count of the imported file, or with `no file at <path>` |
| C8 | Every `AGENTS.md` is at most 500 lines (kit policy). | `FINDING` |
| C9 | `.agents/skills/verify/SKILL.md` exists, and every command of the skill showed its expected result (a `not observed:` entry is a command that failed or that no run finished). | `FAIL` for each unverified command (rerun every command in Step 2b); `FINDING` for a missing skill (add it in Step 2b, or accept: the repo has no runnable surface); `ERROR` when the skill cannot be read |
| C10 | A usable pull-request template exists (the detection of Step 0). Each unusable entry is named. An error is not a missing template. | `FINDING` for each unusable entry, and for no usable template (add it in Step 2c, or accept: the repository wants none); `ERROR` when the detection fails |

Read each `FINDING` line before you report it. A line anchor on a fictional example path, a count that is a stated policy threshold, a time phrase inside a quoted BAD example, and a value inside a dated record (a file or sentence that carries its own date, such as an incident note or "Measured <date>") are not defects: mark each `accepted` with the reason. A C4 line for a settings file that the user keeps is `accepted` with that reason. If the root `AGENTS.md` names a repository doc guard (a lint script for doc pointers), run it too and add its output to the report.

### Step 4 — Report

Print one table. `Result` is `pass`, `fail (<count>)`, `findings (<count>)`, or `error (<count>)`; copy the counts from the Step 3 output. A check with an `ERROR` line is `error`, never `pass`, also when it printed no other line. When a check printed lines of more than one kind, show each kind, for example `fail (1), error (1)`.

| Check | Result | Fix owner |
|---|---|---|
| C1 root AGENTS.md + commands | | this skill, Step 1, or `claude-md-migration` (creates the file); the user supplies the commands |
| C2 root routing ↔ nodes on disk | | `context-tree` (`init` / `refresh`) |
| C3 legacy context files | | `claude-md-migration` (moves content, deletes the legacy files behind its gate) |
| C4 legacy `.claude` entries | | this skill, Step 2a |
| C5 durable-doc findings | | `context-tree audit` for nodes; `skill-maintenance` for skills |
| C6 skill descriptions | | `skill-maintenance` |
| C7 no eager `@path` imports | | `context-tree` (`audit` / `refresh`) |
| C8 node size (500-line kit policy) | | `context-tree` (`audit` / `refresh`; split the folder) |
| C9 project `verify` skill | | this skill, Step 2b |
| C10 pull-request template | | this skill, Step 2c |

Below the table, list: files written, moved, or removed by Step 1, Step 2, Step 2a, Step 2b, and Step 2c (from their reports, with the `git mv`, `mv`, `git rm`, or `rm` command of each), each `.claude` entry left in place with its reason (a refused agent, a settings file, a skipped row, a `target occupied:` line, another entry, an entry outside the repository), the `verify` skill commands that failed or did not run in Step 2b, every open `FAIL` line, every `FINDING` with its accepted/defect decision, every `ERROR` line from Step 0 and Step 3 with the message above it, and blockers that stopped a step.

**Idempotency:** on a repository that is already agent-first, Step 1, Step 2, Step 2a, Step 2b, and Step 2c are no-ops by their own contracts, Step 3 prints no `FAIL` line, no `ERROR` line, and no unaccepted `FINDING`, and no file is written. Any write on such a repository is a defect: report it.

## Common Traps

```text
BAD  — Step 1 copies the CLAUDE.md classification rules into this run and
       splits the file without the owning skill's approval table.
GOOD — Load claude-md-migration, print its proposal table, ask for approval
       with the omp `ask` tool, and resume here after the user approves.

BAD  — "Approve these changes? (yes/no)" as plain reply text.
GOOD — The same question through the `ask` tool, one call per gate.

BAD  — Copy .claude/agents/rev.md to .omp/agents/rev.md as it is.
GOOD — Run convert-agent, show its text with the extra-tools note, and
       write only that text, after approval, to a path with no entry.

BAD  — C5 reports a line anchor, so the agent rewrites the node on the spot.
GOOD — Report it as FINDING with the fix owner; context-tree refresh makes
       the change behind its own gate.

BAD  — "All checks pass" after Step 1 printed a BROKEN line.
GOOD — STOP at the BROKEN line; the report shows the step that failed.
```

| Trap | Wrong fix | Right fix |
|---|---|---|
| Nodes already exist | Run `context-tree init` again and expect new nodes | Run `context-tree audit`; `init` leaves existing nodes alone |
| Small repo gets no node | Force a node so C2 has rows | Zero nodes is a pass when `context-tree` finds no major folder |
| A legacy Claude skills link points into `.agents/skills` | Keep it for another tool | omp finds the skill in `.agents/skills`; Step 2a removes the link after approval |
| A Claude agent has `disallowedTools`, `permissionMode`, or a `Bash(...)` pattern | Drop the field and convert the rest | `convert-agent` refuses it: without that field, the omp agent would lose a limit of the Claude agent. Report it and leave it; the user ports it by hand |
| `.claude/settings.json` looks like a Claude Code file only | Delete it in the cleanup | omp reads it as project settings: report it with the warning and leave it; the user moves or removes it |
| `.omp/agents/<name>.md` exists | Overwrite it with the converted text | Never overwrite: show both files and ask |
| A CLAUDE.md holds only `@AGENTS.md` next to an `AGENTS.md` | Keep it as a harmless stub | omp ignores it: a C3 `FAIL`. `claude-md-migration` deletes it behind its gate |
| A CLAUDE.md holds rules next to an `AGENTS.md` | Leave it, because it once loaded | omp ignores it, so its rules are lost to omp: a C3 `FAIL`. `claude-md-migration` moves the content, then deletes the file |
| A root table row reads `@scripts/AGENTS.md` without backticks | Keep it; it is only a link | A bare `@path` is an import: omp expands that file every time the `AGENTS.md` loads (C7). Put the path in backticks |
| `audit` mode finds a fixable problem | Fix it in the same run | Report it; the user runs the default mode or the owning skill |
| The `verify` skill lists only the unit-test command | Accept it as verification | A unit test does not drive the product. Add a row that starts the surface, drives a main flow, and names the observable result |
| The `verify` skill waits with `sleep 5` | Raise the sleep until the run passes | Wait on a readiness signal: an open port, a health URL, or a log line |
| A `verify` command fails because a service or a dependency is not available | Remove the command from the skill, overwrite its expected result with the failure, ask the user while the server still runs, or on a later run rerun only the marked rows | Run Stop and cleanup first. Keep the command and mark it `not observed: expect <result>; got <first line of the failure>`; the commands after it keep their `expect` marks. Report the failure and ask the user for the fix. A later run first marks every result again, then reruns every command in order, because a flow can depend on an earlier flow. Step 2b stays open until each command shows its expected result |

## Anti-Hallucination Checks

- Do not report a check as `pass` unless you ran the Step 3 command in this session and it printed no line for that check. A check that printed an `ERROR` line did not run: report it as `error`.
- Do not claim Step 1 or Step 2 finished unless that skill's own verification ran and printed no failure line.
- Do not claim "no writes" in idempotent runs without `git status --short` showing no path changed by this run.
- Do not write an `.omp/agents` file from your own reading of a Claude agent; write only the text that `convert-agent` printed in this session.
- A skill you could not load is a blocker to name, not a step to reconstruct from memory.
- Do not write an expected result into the `verify` skill without a `not observed:` mark unless you observed it in this session.

## References

- `claude-md-migration` — legacy `CLAUDE.md` and `.claude/CLAUDE.md` migration into `AGENTS.md` (Step 1).
- `context-tree` — nested AGENTS.md nodes: `init`, `audit`, `refresh` (Step 2).
- `skill-maintenance` — fixes for C5 and C6 findings in SKILL.md files.
- [references/agents-md-template.md](references/agents-md-template.md) — the root `AGENTS.md` template (Step 1).
- [references/verify-skill-template.md](references/verify-skill-template.md) — the project `verify` skill template, surface recipes, and a worked example (Step 2b).
- omp docs: `context-files.md` (which context file loads at each depth), `skills.md` (project skills in `.agents/skills`), `task-agent-discovery.md` (project agents in `.omp/agents`, extra tools, project settings sources).
- agentskills.io specification: https://agentskills.io/specification

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/public repository. Use the `report-skill-issue` skill of the docks-kit kit plugin for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and the docks-kit version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
