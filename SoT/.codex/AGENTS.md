# AGENTS.md

@RTK.md

Codex user-scope configuration managed by `./sync.sh`.

This directory is intentionally small:

- `config.toml` declares portable Codex settings and enabled plugins.
- `plugins/marketplace.json` is deployed to Codex's personal marketplace path at `~/.agents/plugins/marketplace.json`.
- `bin/codex` is a PATH launcher for the existing npm/NVM Codex install.
- `@RTK.md` imports Codex-scoped RTK instructions generated in `~/.codex/RTK.md` by `rtk init -g --codex`.
- `agents/` is reserved for future Codex-native agent config if Codex exposes a stable user-scope format.

Do not store secrets here.
