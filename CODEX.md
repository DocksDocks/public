# CODEX.md

Configuration specific to Codex. `SoT/.codex/` is the Single Source of Truth that gets synced to `~/.codex/` and Codex's personal plugin marketplace path by `./sync.sh`. Edit files in `SoT/.codex/` here in the repo, then run sync; do not edit deployed config directly unless you are testing a local-only override.

`SoT/.codex/config.toml` currently enables the Docks plugin as `docks@docks`. Docks is skills-only on Codex: Claude Code slash commands and subagents do not load in Codex.

`SoT/.codex/plugins/marketplace.json` is deployed to `~/.agents/plugins/marketplace.json`, which is Codex's personal marketplace discovery path. Codex's runtime config, auth, cache, sessions, and plugin enablement live under `~/.codex/`.

`SoT/.codex/bin/codex` is a launcher for machines where Codex was installed with `npm install -g @openai/codex` under NVM but non-interactive shells do not source NVM. It is deployed to `~/.local/bin/codex`, which is already on PATH.

`SoT/.codex/AGENTS.md` is deployed to `~/.codex/AGENTS.md` as a human-readable reference for this kit's Codex user-scope layout.

`SoT/.codex/AGENTS.md` imports `@RTK.md`. `sync.sh` lets `rtk init -g --codex` generate `~/.codex/RTK.md` when missing, then restores the SoT-managed `AGENTS.md` so RTK content can track the installed RTK version without owning the whole Codex instructions file. RTK does not currently expose a Codex hook processor, so this is instruction-level integration rather than transparent command rewriting.

Run:

```bash
./sync.sh --dry-run
./sync.sh --no-rtk
```

After sync, restart Codex and open `/plugins` to verify the Docks marketplace/plugin state.
