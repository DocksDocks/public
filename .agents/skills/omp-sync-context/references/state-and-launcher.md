# omp State Store And Launcher

Part of `omp-sync-context`. Read the SKILL.md constraints first.

## Local State Store

Store the selection and the omp session model in the SQLite store
`~/.docks-kit/kit.db`, tables `harness_selection` and `omp_session`.
Resolve that path from the engine home with `kitDb.ts kitDbFile`.
Open the store only through `kitDb.ts withKitDb`, which applies the migrations.
Append a new migration to `kitDb.ts MIGRATIONS`; never edit a shipped entry.
Normalize entries into `claude`, `codex`, `agents`, and `omp` order.
Reject an empty or wholly unknown write.
Write the state directory with mode `0700`.
Chmod the database file to mode `0600`.
Never create the store on a read when neither `kit.db` nor `state.json` exists.

`withKitDb` imports a legacy `~/.docks-kit/state.json` once, when both tables
are empty, and renames it to `state.json.migrated`.
Each table has one writer, so a write to one key cannot drop the other.

Treat a missing, corrupt, or too-new store as no stored selection.
Resolve no stored selection to `claude`, `codex`, and `agents`.
Keep omp opt-in when no state exists.
Let explicit positional targets override the stored selection.

`sync` never prompts for a selection.
`sync` never writes the selection file.
The `docks-kit harnesses` command owns prompting and persistence.
Off a terminal, that command only prints the current selection.
With no stored selection, its picker pre-ticks every harness in `HARNESSES`, omp included.
The pre-tick changes no stored state until the user saves the picker.

Every `docks-kit omp` launch writes a run overlay under `kitCacheDir`;
only `--model` or `--pick` writes the `omp_session` table.
`docks-kit omp --fast` writes only `tier.openai` in the deployed
`config.yml`, through `ompFastMode.ts toggleDeployedOpenAiFast`.
The session model entry stores a required free model selector, an optional session thinking level,
and an optional advisor thinking level.
Compute both levels once at set time from the catalog row of the chosen model.
Derive each level from that model's own ladder, never from the global ladder
constant: free-model ladders differ per model, and some publish no `medium`
or no ladder (`cli/docs/omp-models.md`; verify: `omp models --json`).
Store no level for a model without a ladder, and render a bare selector for it.
An invented level makes omp fail when the session starts, not when the user
chooses the model.
Treat a missing, blank, or malformed entry as no stored model, and resolve it
to `DEFAULT_OMP_SESSION_MODEL`.
Never throw on a corrupt entry, because a launcher that refuses to start is
worse than one that starts on the default free model.
Drop each level field independently when it is blank, so a stale level never
survives a switch to a level-free model.

Anchor storage at `harnesses.ts` — `readHarnessSelection`, `writeHarnessSelection`, `readOmpSessionModel`, and `writeOmpSessionModel` — SQLite tables opened through `kitDb.ts withKitDb`, one writer per table.
Anchor rendering at `ompOverlay.ts` — `ladderCeiling`, `advisorLevelFor`, `planEffortChoice`, `advisorRecommendation`, and `renderFreeOverlay` — per-model ladder derivation, the picker question set, the advisor suggestion, and empty fallback chains, including the chains keyed by the free model at every level.

The launcher enforces the free model before omp starts.
Reject each forwarded flag that can select a model, in both forms and also after a `--`, because omp can read that `--` as a flag value.
Start omp with `launch` first, so a forwarded subcommand name becomes message text.
Pass the session model as an explicit `--model`, so a restored session model cannot replace it.
Set the three model variables in the child environment instead of removing them, because omp refills an unset variable from its `.env` files.
Check the session model against the free catalog of every candidate profile.
Do not claim that the launcher controls these paths, which can still select a paid model: model selection inside a running session, the `web` role and its chain, the model-kind roles, and extensions and hooks.
`cli/docs/omp-models.md` `### Model selection outside the launcher` owns the list.
Anchor input checks at `cli/src/commands/omp.ts` — `rejectedForwardedFlag` and `forwardedProfile` — the rejected model flags and the candidate profiles, scanned past `--`.
Anchor the launch at `ompOverlay.ts` — `buildOmpArgs` and `ompChildEnvironment` — `launch` first, the explicit `--model`, the model variables, and the `PI_CONFIG_FILES` append.
Anchor resolution at `parseArgs.ts` — `applyDefaultSelection` — explicit target precedence and legacy fallback.
Anchor dispatch at `syncDispatch.ts` — `engineSync` omp branch — selected pipeline execution.


Verify the store and the selection:
`bunx vitest run cli/test/unit/harnessSelection.test.ts -t "creates no store when a read finds neither file"`,
`bunx vitest run cli/test/unit/harnessSelection.test.ts -t "refuses an empty selection without erasing stored harnesses"`,
`bunx vitest run cli/test/unit/harnessSelection.test.ts -t "treats a corrupt SQLite store as missing selection and session state"`,
`bunx vitest run cli/test/unit/harnessSelection.test.ts -t "leaves no stale level behind when a level-free model overwrites a levelled one"`,
`bunx vitest run cli/test/unit/harnessesCommand.test.ts -t "does not open the picker when stdin is not a terminal"`,
and `bunx vitest run cli/test/unit/targetGrammar.test.ts -t "keeps an explicit target after a modifier ahead of a stored selection"`.

Verify the launcher and the overlay:
`bunx vitest run cli/test/unit/ompCommand.test.ts -t "rejects a model flag after a forwarded"`,
`bunx vitest run cli/test/unit/ompCommand.test.ts -t "refuses a launch whose model is free in the environment profile but not in a forwarded profile"`,
`bunx vitest run cli/test/unit/ompOverlay.test.ts -t "starts omp with launch, the overlay, and the session model at its level"`,
`bunx vitest run cli/test/unit/ompOverlay.test.ts -t "lists replaced variables in smol, slow, plan order"`,
`bunx vitest run cli/test/unit/ompOverlay.test.ts -t "renders a level-free model with bare chat selectors and no thinking keys"`,
and `bunx vitest run cli/test/unit/ompFastMode.test.ts -t "turns fast on and changes only tier.openai"`.
