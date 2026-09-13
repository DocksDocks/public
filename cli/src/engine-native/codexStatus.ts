/**
 * EngineNative Codex status reporting: summary lines and next-step hints.
 */
import { p } from "./exec";
import { enabledPluginIds } from "./codexPlugins";
import type { Ctx } from "./index";

// -------------------------------------------------------------- summary ----

export function codexSummary(ctx: Ctx): void {
  const { echo } = ctx.services.logger;
  const codexDir = p(ctx.home, ".codex");
  echo(`Codex:    ${codexDir}`);
  if (!ctx.dryRun) {
    const count = enabledPluginIds(p(codexDir, "config.toml")).length;
    echo(`Codex plugins: ${count} enabled in config.toml`);
  }
}

export function codexNextSteps(ctx: Ctx): Array<string> {
  return ctx.verbose || ctx.nextStepTriggers.codexRestart
    ? ["Restart Codex to load any refreshed plugins, skills, or tools."]
    : [];
}
