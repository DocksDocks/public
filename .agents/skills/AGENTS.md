# Project skills and wrapper agents (.agents/skills/)

Canonical project skills live here. The `.claude/skills/<name>` symlinks and the
wrapper agents in `.claude/agents/` and `.codex/agents/` follow the same rules.
Read this file before you add, edit, or cite code from a skill or a wrapper agent.

## Conventions

**Project-skill scope.** Keep project skills within two classes: kit-mechanic skills and the `unslop` repo-prose skill.
Canonical project skills live in `.agents/skills/<name>/SKILL.md`.
Each `.claude/skills/<name>` entry is a relative symlink to its canonical directory.
Codex reads `.agents/skills/` natively, so one copy serves both tools.
Kit-mechanic skills document regression-prone kit logic. Most of it is TypeScript in `cli/src/engine-native/`, in the CLI commands under `cli/src/commands/`, and in the top-level `cli/src/*.ts` modules such as `cli/src/services.ts`. The rest is in the `docks-kit` launcher and in the omp extension `SoT/.omp/plugin/extensions/hygiene.ts`.
Kit-mechanic skills: `codex-config-merge-context`, `engine-native-context`, `plugin-bootstrap-context`, `settings-merge-context`, `sync-orchestration-context`, `toolchain-context`, `universal-skills-context`, `omp-sync-context`, `tidy-context`, and `host-platform-context`.
**Pipeline content** (multi-agent slash commands, refactor/security/docs workflows, parallel-scanner agents) belongs in the separate [DocksDocks/docks](https://github.com/DocksDocks/docks) plugin — not here. Project-level agents under `.claude/agents/` follow the same rule: kit-mechanic agents that wrap kit-mechanic skills are permitted; pipeline agents live in the docks plugin.

**Windows checkouts.** These eleven entries are the only symlinks this repository tracks (verify: `git ls-files -s | awk '$1=="120000"' | wc -l` prints `11`). Git for Windows defaults to `core.symlinks=false`. This setting checks a symlink out as a plain file that holds the target path. Claude Code then finds no `SKILL.md` and silently loads no project skill. Codex is unaffected, because it reads the real directories under `.agents/skills/`. To restore Claude Code on Windows, enable Developer Mode or run as administrator, then `git config core.symlinks true` and re-checkout the paths: `git checkout -- .claude/skills`. Never repair this by replacing an entry with a copy; two copies drift, which is the failure the canonical layout removes. This limitation is confined to project skills in this checkout. It does not affect the deployed user-level skills, where `skillsLinks.ts linkOrCopy` already falls back from symlink to junction to marked copy.

`npx skills add cursor/plugins -s unslop -y -a claude-code codex` installs `unslop`, and root `skills-lock.json` pins it.
The repository vendors upstream `unslop` text and pins it by the lockfile hash, so never edit it locally.
Upstream licenses `pstack/` under MIT (Copyright (c) 2026 Lauren Tan), so redistribution is permitted.
MIT requires the notice to travel with the copy, so `.agents/skills/unslop/LICENSE` vendors it verbatim and must stay beside `SKILL.md`.
The `unslop` "adding soul" guidance conflicts with the global Simplified Technical English Output Standard.
The Output Standard wins.
Use `unslop` only for its pattern-detection lists.

<constraint>
When a kit-mechanic skill, its `references/`, or a wrapper agent (`.claude/agents/*.md` + its `.codex/agents/*.toml` twin) cites EngineNative internals, name the **module + exported/local function + semantic anchor** (e.g. `claudePluginPasses.ts syncPlugins, pass 5 uninstall guard`) — never a raw `file:NNN` line number, which goes stale on every refactor. Keep exactly one coarse `metadata.source_files[].lines` range per skill file as the sole intentional line-number touchpoint.
</constraint>

## Owned elsewhere

- Universal-skill opt-in (`SoT/.agents/skills.txt`, `skillsInstall.ts syncUniversal`): `AGENTS.md` (`## Skills`).
- The guard for `metadata.source_files[].lines`: `cli/test/unit/skillMetadata.test.ts` (probe: set one range end past the line count of its file; `bunx vitest run cli/test/unit/skillMetadata.test.ts` must fail and name it; revert).
- The `unslop` pin: `skills-lock.json`.
- The EngineNative rules that the kit-mechanic skills document: `cli/AGENTS.md`.

## Gotchas

- Claude Code reads no `AGENTS.md` under a `.agents/` directory, so this file never loads by itself in Claude Code. Open it from the root `## Context tree` table (source: https://code.claude.com/docs/en/memory, section "When Claude Code reads AGENTS.md").

Pointers here name concepts, not coordinates — if a path or symbol moved,
trust the stated purpose and re-locate it (grep the symbol) before acting.

<!-- machine-readable drift aid — `audit` reads `sources:` to scope its content check -->
## tree (metadata)
- sources: `.agents/skills/*/SKILL.md`, `.claude/skills/`, `.claude/agents/`, `.codex/agents/`, `skills-lock.json`, `.agents/skills/unslop/LICENSE`, `cli/test/unit/skillMetadata.test.ts`
