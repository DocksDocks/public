/**
 * EngineNative `sync codex` pipeline. Line-based TOML passes intentionally
 * avoid a TOML library because reformatting user configs would be a behavior
 * change. Guard order, message strings, and backup behavior are golden-tested.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  payloadBytes,
  payloadDisplayPath,
  payloadPaths,
  payloadText,
  type PayloadPath,
} from "../payload";
import { syncConfig } from "./codexConfig";
import { removeRetiredImportedHooks } from "./codexHooks";
import { removeLegacyDocksMarketplace, syncMarketplace, syncPlugins } from "./codexPlugins";
import { syncCodexEffort, syncCodexModel } from "./codexToml";
import { p, spawnProcess } from "./exec";
import type { Ctx } from "./index";
import { compareCodepoints } from "./jq";
import { hostOs } from "./os";

export { removeRetiredPluginTablesText } from "./codexConfig";
export { codexNextSteps, codexSummary } from "./codexStatus";

export async function codexSync(ctx: Ctx): Promise<void> {
  const codexDir = p(ctx.home, ".codex");
  const sotConfig = payloadText("SoT/.codex/config.toml");
  const userConfig = p(codexDir, "config.toml");

  await ensureBubblewrap(ctx);
  if (!ctx.dryRun) mkdirSync(codexDir, { recursive: true });
  syncConfig(ctx, sotConfig, userConfig);
  removeRetiredImportedHooks(ctx, codexDir);
  syncCodexModel(ctx, ctx.codexModel);
  syncCodexEffort(ctx, ctx.codexEffort);
  syncRules(ctx, payloadPaths("SoT/.codex/rules/"), p(codexDir, "rules"));
  syncAgentsMd(ctx, payloadText("SoT/.codex/AGENTS.md"), p(codexDir, "AGENTS.md"));
  syncMarketplace(
    ctx,
    payloadText("SoT/.codex/plugins/marketplace.json"),
    p(ctx.agentsDir, "plugins", "marketplace.json"),
  );
  await removeLegacyDocksMarketplace(ctx, userConfig);
  await syncPlugins(ctx, sotConfig);
}

// ---------------------------------------------------------- bubblewrap ----

async function ensureBubblewrap(ctx: Ctx): Promise<void> {
  const { change, echo, warn } = ctx.services.logger;
  if (!bwrapSupportedOs(ctx)) return;

  if (ctx.dryRun) {
    echo("[dry-run] verify bubblewrap installed (recommended Codex Linux sandbox runtime)");
    return;
  }

  if (ctx.services.deps.probe("bwrap").state === "present") return;

  if (ctx.skipBubblewrap) {
    warn(
      "bubblewrap not installed (--skip-bubblewrap skips auto-install). Codex may use its bundled helper if user namespaces work; recommended install: sudo apt install -y bubblewrap",
    );
    return;
  }

  const pmInstall = bwrapDetectPmInstallCmd(ctx);
  if (pmInstall === "") {
    warn(
      "bubblewrap not installed and no supported package manager found (apt-get/dnf/pacman/zypper). Codex may use its bundled helper if user namespaces work; install system bubblewrap manually when possible.",
    );
    return;
  }

  warn(
    `bubblewrap not installed - recommended for Codex Linux sandbox. Running: ${pmInstall} (sudo prompt may appear)`,
  );
  const runInstaller = () =>
    spawnProcess("bash", ["-c", pmInstall], { stdio: ["inherit", "inherit", "inherit"] });
  const res = await (ctx.terminalLease?.withExclusive(runInstaller) ?? runInstaller());
  if (res.exitCode !== 0) {
    warn(`Failed to auto-install bubblewrap. Install manually: ${pmInstall}`);
    return;
  }

  if (ctx.services.deps.probe("bwrap").state === "missing") {
    warn("Package install reported success but bwrap not on PATH — check installation manually");
    return;
  }

  const namespaceProbe = await spawnProcess("unshare", ["-Ur", "true"], { stdio: "ignore" });
  if (namespaceProbe.error !== undefined) {
    warn(`Could not run unshare to check user namespaces: ${namespaceProbe.error.message}`);
  } else if (namespaceProbe.exitCode === 0) {
    change(`bubblewrap installed and functional (${await ctx.services.deps.version("bwrap")})`);
  } else {
    warn(
      "bubblewrap installed but unprivileged user namespaces appear blocked. On Ubuntu 24.04+, prefer loading the AppArmor bwrap-userns-restrict profile; fallback: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0",
    );
  }
}

function bwrapSupportedOs(ctx: Ctx): boolean {
  const { warn } = ctx.services.logger;
  const os = hostOs(ctx.services.platform.name());
  if (os.supportsBubblewrap) return true;
  if (os.id === "unknown") {
    warn("Unknown OS — skipping bubblewrap check; Codex sandbox may not work");
  }
  return false;
}

function bwrapDetectPmInstallCmd(ctx: Ctx): string {
  if (ctx.services.deps.probe("apt-get").state === "present")
    return "sudo apt-get install -y bubblewrap";
  if (ctx.services.deps.probe("dnf").state === "present") return "sudo dnf install -y bubblewrap";
  if (ctx.services.deps.probe("pacman").state === "present")
    return "sudo pacman -S --noconfirm bubblewrap";
  if (ctx.services.deps.probe("zypper").state === "present")
    return "sudo zypper install -y bubblewrap";
  return "";
}

// ------------------------------------------------------- rules + agents ----

function syncRules(ctx: Ctx, sotRules: ReadonlyArray<PayloadPath>, userRulesDir: string): void {
  const { change, echo, verbose } = ctx.services.logger;
  const firstRule = sotRules[0];
  if (firstRule === undefined) return;
  const firstDisplay = payloadDisplayPath(firstRule);
  const sotRulesDir = firstDisplay.slice(0, firstDisplay.lastIndexOf("/"));

  if (ctx.dryRun) {
    echo(`[dry-run] cp ${sotRulesDir}/*.rules -> ${userRulesDir}/`);
    return;
  }

  mkdirSync(userRulesDir, { recursive: true });
  let sawRules = false;
  let rulesChanged = false;
  const ruleFiles = sotRules.filter((path) => path.endsWith(".rules")).sort(compareCodepoints);
  for (const ruleFile of ruleFiles) {
    sawRules = true;
    const userRuleFile = p(userRulesDir, ruleFile.slice(ruleFile.lastIndexOf("/") + 1));
    const content = payloadBytes(ruleFile);
    const identical = existsSync(userRuleFile) && readFileSync(userRuleFile).equals(content);
    if (identical) continue;
    if (existsSync(userRuleFile)) copyFileSync(userRuleFile, `${userRuleFile}.bak`);
    writeFileSync(userRuleFile, content);
    rulesChanged = true;
  }
  if (rulesChanged) {
    change("Codex rules synced");
    ctx.nextStepTriggers.codexRestart = true;
  } else if (sawRules) verbose("Codex rules already in sync");
}

function syncAgentsMd(ctx: Ctx, sotAgentsMdText: string, userAgentsMd: string): void {
  const { change, echo, verbose } = ctx.services.logger;
  const sotAgentsMd = payloadDisplayPath("SoT/.codex/AGENTS.md");

  if (ctx.dryRun) {
    echo(`[dry-run] cp ${sotAgentsMd} -> ${userAgentsMd}`);
    return;
  }

  if (existsSync(userAgentsMd) && readFileSync(userAgentsMd, "utf8") === sotAgentsMdText) {
    verbose("Codex AGENTS.md already in sync");
    return;
  }
  if (existsSync(userAgentsMd)) copyFileSync(userAgentsMd, `${userAgentsMd}.bak`);
  writeFileSync(userAgentsMd, sotAgentsMdText);
  change("Codex AGENTS.md synced");
  ctx.nextStepTriggers.codexRestart = true;
}
