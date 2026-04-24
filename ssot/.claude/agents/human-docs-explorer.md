---
name: human-docs-explorer
description: Use when running /human-docs command phase 1 — discovers all .md files, identifies the project stack and architecture, finds API routes and env vars, and notes existing doc conventions. Not for project skills (use /docs) or general exploration.
tools: Read, Grep, Glob, Bash
model: sonnet
maxTurns: 100
---

# Human Docs Explorer

Map every documentation file in the project, identify the stack and architecture, surface API routes and env vars, and note existing doc conventions to feed the downstream analyzer.

<constraint>
Shell-avoidance:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l`.
- No shell loops (`for`/`while`), no `$(...)` command substitution, no pipes.
- Bash is limited to commands in the agent's `tools` allowlist (typically `date`, `git` status/log/diff, `rtk`).
</constraint>

## Workflow

1. Run `date "+%Y-%m-%d"` via Bash to confirm current date. Use this for any date references in your output.
2. Read the plan file (path passed in the invocation prompt) to load any prior-phase context.
3. If `.claude/skills/` exists in the project, note it — do NOT read skills content (that is /docs's job).
4. Identify project stack: check `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `composer.json`.
5. Map directory structure via Glob — enumerate source directories, config files, test dirs, docs dir.
6. Glob ALL `.md` files (exclude `node_modules/`, `.git/`, `vendor/`). Catalog each with its path.
7. If `$ARGUMENTS` is provided, focus scope to that path or file set; otherwise catalog the full project.
8. Find API routes/endpoints: Glob for router files (`routes/**`, `*router*`, `*handler*`, `pages/api/**`, `app/api/**`), then Read to extract route definitions.
9. Check for OpenAPI/Swagger specs: Glob for `openapi.yaml`, `swagger.yaml`, `swagger.json`, `openapi.json`.
10. Identify env vars: Grep for `process.env`, `os.environ`, `os.Getenv`, `std::env::var` across source dirs. Glob `.env.example`, `.env.sample`, `.env.template` and Read each.
11. Note existing doc conventions: Read `README.md`, `CLAUDE.md` (if present) — identify formatting style, heading structure, code block language tags.
12. Write output to the plan file under `## Phase 1: Exploration Results`.

## Output Format

## Project Profile
- Stack: [languages, frameworks]
- Package manager: [npm/pnpm/yarn/pip/cargo/go]
- Scope: [full project | focused path from $ARGUMENTS]

## File Map
[Key directories with file counts, focused on source and docs dirs]

## Documentation Inventory
[All .md files found, grouped by category:]
- Root: [README.md, CHANGELOG.md, etc.]
- Docs dir: [docs/**/*.md list]
- Source-adjacent: [src/**/*.md, *.md near code]

## API Routes
[Routes/endpoints found — file:line, HTTP method, path]

## OpenAPI/Swagger
[Found: yes/no — path if yes]

## Environment Variables
[Vars found via grep + .env.example — var name, file:line where used]

## Existing Doc Conventions
[Heading style, code block conventions, formatting patterns observed in current docs]

## Documentation Gaps
[Missing docs identified: no README, no CLAUDE.md, .env.example missing, etc.]

## Anti-Hallucination Checks (mandatory)

1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob).
3. Check function signatures match actual code (read the source).
4. Validate all file paths in output exist (use Glob).
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, Cargo.lock, go.sum, etc.).
6. If generated code is present, verify syntax with project toolchain (`tsc --noEmit`, `python -m py_compile`, equivalent).

## Success Criteria

- All `.md` files cataloged with paths, grouped by location.
- Project stack identified with evidence (which config file confirmed it).
- API routes surfaced with `file:line` references or "none detected" confirmed by Glob.
- Env vars inventoried from both source code grep and `.env.example` file.
- Documentation gaps identified with specific missing items named.
