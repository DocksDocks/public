/**
 * EngineNative `sync codex` pipeline. Line-based TOML passes intentionally
 * avoid a TOML library because reformatting user configs would be a behavior
 * change. Guard order, message strings, and backup behavior are golden-tested.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { resolveEffort } from "../efforts";
import {
  payloadBytes,
  payloadDisplayPath,
  payloadPaths,
  payloadText,
  type PayloadPath,
} from "../payload";
import { replaceTextIfChanged } from "./atomicWrite";
import { syncConfig } from "./codexConfig";
import { removeRetiredImportedHooks } from "./codexHooks";
import { codexHome } from "./codexPaths";
import { removeLegacyDocksMarketplace, syncMarketplace, syncPlugins } from "./codexPlugins";
import { replaceTopLevelSetting, syncCodexEffort, syncCodexModel } from "./codexToml";
import { p, spawnProcess } from "./exec";
import type { Ctx } from "./index";
import { compareCodepoints } from "./jq";
import { hostOs } from "./os";

export { removeRetiredPluginTablesText } from "./codexConfig";
export { codexNextSteps, codexSummary } from "./codexStatus";

export async function codexSync(ctx: Ctx): Promise<void> {
  const codexDir = codexHome(ctx.home);
  const sotConfig = payloadText("SoT/.codex/config.toml");
  const userConfig = p(codexDir, "config.toml");

  // Merge the SoT with the --codex-model / --codex-effort values already applied.
  // A repeated modifier run then merges to the same bytes and keeps config.toml.bak.
  let deployedSotConfig = sotConfig;
  if (ctx.codexModel !== "") {
    deployedSotConfig = replaceTopLevelSetting(
      deployedSotConfig,
      "model",
      `model = "${ctx.codexModel}"`,
    );
  }
  if (ctx.codexEffort !== "") {
    deployedSotConfig = replaceTopLevelSetting(
      deployedSotConfig,
      "model_reasoning_effort",
      `model_reasoning_effort = "${resolveEffort("codex", ctx.codexEffort)}"`,
    );
  }

  await ensureBubblewrap(ctx);
  if (!ctx.dryRun) mkdirSync(codexDir, { recursive: true });
  // Only a real sync compares against this text; a dry run reads nothing.
  const deployedBefore = ctx.dryRun
    ? undefined
    : existsSync(userConfig)
      ? readFileSync(userConfig, "utf8")
      : "";
  syncConfig(ctx, deployedSotConfig, userConfig);
  removeRetiredImportedHooks(ctx, codexDir);
  syncCodexModel(ctx, ctx.codexModel, deployedBefore);
  syncCodexEffort(ctx, ctx.codexEffort, deployedBefore);
  syncRules(
    ctx,
    payloadPaths("SoT/.codex/rules/"),
    p(codexDir, "rules"),
    p(codexDir, ".kit-managed-rules"),
  );
  syncAgentsMd(ctx, payloadText("SoT/.codex/AGENTS.md"), p(codexDir, "AGENTS.md"));
  const unresolvedMarketplace = syncMarketplace(
    ctx,
    payloadText("SoT/.codex/plugins/marketplace.json"),
    p(ctx.agentsDir, "plugins", "marketplace.json"),
  );
  await removeLegacyDocksMarketplace(ctx, userConfig);
  await syncPlugins(ctx, sotConfig, unresolvedMarketplace);
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

/** One `<sha256>  <file name>` line of the rules manifest, the `sha256sum` format. */
const RULES_RECORD = /^([0-9a-f]{64}) {2}([^/\\]+\.rules)$/;

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The rules files that earlier syncs wrote: file name to the sha256 of the kit bytes. */
function readRulesRecords(manifestFile: string): Map<string, string> {
  const records = new Map<string, string>();
  if (!existsSync(manifestFile)) return records;
  for (const line of readFileSync(manifestFile, "utf8").split("\n")) {
    const record = RULES_RECORD.exec(line);
    if (record !== null) records.set(record[2]!, record[1]!);
  }
  return records;
}

/**
 * Deploys the SoT rules files and records each one in `manifestFile`. Codex
 * applies every file in `rules/`, so a file that the SoT dropped keeps its old
 * rules active. Each sync therefore removes a recorded file that the SoT no
 * longer ships while the file holds the recorded kit bytes. An edited file
 * stays, keeps its record, and gets a warning on each sync. Sync deploys each
 * name that the SoT ships over an existing file, recorded or not. It backs up
 * a file that differs to `<name>.bak` and replaces it. Cleanup never reads or
 * removes a file that the SoT does not ship and no sync recorded, such as the
 * `default.rules` file of Codex. Sync replaces the manifest through a temporary
 * file and a rename, so an interrupted sync keeps the previous manifest.
 */
export function syncRules(
  ctx: Ctx,
  sotRules: ReadonlyArray<PayloadPath>,
  userRulesDir: string,
  manifestFile: string,
): void {
  const { change, echo, verbose, warn } = ctx.services.logger;
  const ruleFiles = sotRules.filter((path) => path.endsWith(".rules")).sort(compareCodepoints);
  const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
  const shippedNames = new Set(ruleFiles.map(fileName));
  const nextRecords = new Map<string, string>();
  const firstRule = sotRules[0];

  if (ctx.dryRun) {
    if (firstRule !== undefined) {
      const firstDisplay = payloadDisplayPath(firstRule);
      const sotRulesDir = firstDisplay.slice(0, firstDisplay.lastIndexOf("/"));
      echo(`[dry-run] cp ${sotRulesDir}/*.rules -> ${userRulesDir}/`);
    }
  } else if (firstRule !== undefined) {
    mkdirSync(userRulesDir, { recursive: true });
    let rulesChanged = false;
    for (const ruleFile of ruleFiles) {
      const userRuleFile = p(userRulesDir, fileName(ruleFile));
      const content = payloadBytes(ruleFile);
      nextRecords.set(fileName(ruleFile), sha256Hex(content));
      const identical = existsSync(userRuleFile) && readFileSync(userRuleFile).equals(content);
      if (identical) continue;
      if (existsSync(userRuleFile)) copyFileSync(userRuleFile, `${userRuleFile}.bak`);
      writeFileSync(userRuleFile, content);
      rulesChanged = true;
    }
    if (rulesChanged) {
      change("Codex rules synced");
      ctx.nextStepTriggers.codexRestart = true;
    } else if (ruleFiles.length > 0) verbose("Codex rules already in sync");
  }

  for (const [name, recordedHash] of readRulesRecords(manifestFile)) {
    if (shippedNames.has(name)) continue;
    const file = p(userRulesDir, name);
    if (!existsSync(file)) continue;
    if (sha256Hex(readFileSync(file)) !== recordedHash) {
      warn(
        `Codex rules: kept ${file}: the SoT no longer ships it, and it differs from the kit copy. Review it and delete it if you do not need its rules.`,
      );
      nextRecords.set(name, recordedHash);
      continue;
    }
    if (ctx.dryRun) {
      echo(`[dry-run] remove ${file}`);
      continue;
    }
    rmSync(file, { force: true });
    change(`Codex rules: removed ${file}; the SoT no longer ships it`);
    ctx.nextStepTriggers.codexRestart = true;
  }
  if (ctx.dryRun) return;

  const manifest = [...nextRecords]
    .sort(([left], [right]) => compareCodepoints(left, right))
    .map(([name, hash]) => `${hash}  ${name}\n`)
    .join("");
  if (manifest !== "" || existsSync(manifestFile)) replaceTextIfChanged(manifestFile, manifest);
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
