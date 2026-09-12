/**
 * Help text and the early-exit signal for the EngineNative flag layer.
 * Kept dependency-free (besides injected ctx) so modifier mapping and the
 * dispatch loop can both share it without import cycles.
 */

import type { Ctx } from "./index"
import { advisorFlagGrammar, effortFlagGrammar } from "../efforts"

export class ExitError extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`)
  }
}

export function printCatalog(ctx: Ctx, catalog: string): void {
  for (const line of catalog.split("\n")) ctx.services.logger.echo(line)
}

export function printUsage(ctx: Ctx, knownPlugins: ReadonlyArray<string>): void {
  const { echo } = ctx.services.logger
  const argv0 = "docks-kit sync"
  echo(`Usage: ${argv0} [claude] [codex] [agents] [omp] [flags]`)
  echo("")
  echo("Targets (positional; default: this machine's harness selection)")
  echo("  claude            sync the Claude Code SoT")
  echo("  codex             sync the Codex SoT")
  echo("  agents            sync universal agent skills")
  echo("  omp               sync the Oh My Pi SoT")
  echo("")
  echo("Global flags")
  echo("  --dry-run         preview without applying")
  echo(
    "  --reconcile       reconcile kit-owned settings with SoT (SoT keys win; user-only keys preserved; permissions arrays replaced)"
  )
  echo(
    "  --prune           uninstall kit-managed installs not in SoT (plugins, marketplaces, skills in SoT/.agents/skills.txt)"
  )
  echo("  --skip-bubblewrap skip optional bubblewrap bootstrap (Codex Linux sandbox)")
  echo("  --skip-plugin-refresh  install missing plugins but skip refresh-only updates")
  echo("  --verbose         also print no-op confirmations (already in sync, up to date, left as-is)")
  echo("")
  echo("Deploy-time modifiers (deployed config only; SoT untouched; a later flag-less sync reverts)")
  echo(
    "  --claude-model=<m>            set deployed ~/.claude/settings.json model (aliases: best|opus|fable|sonnet|haiku, full claude-* IDs, or 'default' to unset)"
  )
  echo(`  ${effortFlagGrammar("claude").padEnd(39)} set deployed effortLevel`)
  echo(`  ${advisorFlagGrammar().padEnd(39)} set deployed advisor state`)
  echo(
    "  --claude-compact-window=<n>   set deployed autocompact window in tokens (e.g. 680000 or 680k) for disposable sessions"
  )
  echo(
    "  --claude-permissive           empty permissions.ask/deny in deployed settings (sandboxes/containers; unattended commits + pushes)"
  )
  echo("  --codex-model=<m>             set deployed ~/.codex/config.toml model (e.g. gpt-5.5)")
  echo(`  ${effortFlagGrammar("codex").padEnd(39)} set deployed model_reasoning_effort`)
  echo("")
  echo("Sticky opt-ins (installed + enabled until --prune)")
  echo(
    `  --claude-plugin=<name>        opt an optional plugin into this machine (known: ${knownPlugins.join(", ")}; repeatable)`
  )
}
