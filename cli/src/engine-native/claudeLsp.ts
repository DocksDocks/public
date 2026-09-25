/**
 * EngineNative LSP server probes, `sync claude` installs, and the
 * `toolchain upgrade` npm upgrade. The php-lsp,
 * typescript-lsp, and rust-analyzer-lsp plugins are no-ops without their
 * server binaries, so this pass installs the missing ones. Message strings
 * and spawned argv are part of the contract.
 */
import { defaultProbeExecutor, npmGlobalVersions, type ToolId } from "./deps";
import { realpathSync } from "node:fs";
import { capture, spawnProcess } from "./exec";
import type { Ctx } from "./index";
import { isObject, parseJson } from "./jq";
import { belowFloor, field, installedVersion, isNewer } from "./toolchain";
import { payloadText } from "../payload";

function lspPkg(ctx: Ctx, tool: string, pkg: string): string | undefined {
  const version = field(tool, "verified");
  if (version !== "") return `${pkg}@${version}`;
  ctx.services.logger.warn(
    `Skipping ${pkg} install: ${tool} has no verified version in SoT/toolchain.json`,
  );
  return undefined;
}

/**
 * npm treats a package's `engines` field as advisory unless the host opted
 * into engine-strict, so installing typescript-language-server 6 on an older
 * Node succeeds and then fails at every startup. Report the host Node version
 * when it is too old, and the empty string when the install is safe.
 */
async function nodeBelowServerFloor(ctx: Ctx): Promise<string> {
  const floor = field("node", "floor");
  if (floor === "") return "";
  const installed = await installedVersion(ctx, "node");
  return belowFloor(installed, floor) ? installed : "";
}

/** npm-global channel: intelephense, typescript-language-server, typescript. */
async function installNpmServers(ctx: Ctx, missing: ReadonlyArray<string>): Promise<void> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger;
  if (missing.length === 0) return;
  const specs = missing.join(" ");
  if (ctx.dryRun) {
    echo(`[dry-run] would install: npm install -g ${specs}`);
    return;
  }

  if (ctx.services.deps.probe("npm").state === "missing") {
    ctx.services.deps.warnMissing(
      "npm",
      ctx.services.logger,
      `cannot install LSP servers (${specs}); the php-lsp/typescript-lsp plugins stay no-ops`,
    );
    return;
  }

  verbose(`Installing LSP servers via npm: ${specs}...`);
  progress(`Installing LSP servers via npm: ${specs}...`);
  const installResult = await spawnProcess("npm", ["install", "-g", ...missing], {
    stdio: "ignore",
  });
  clearProgress();
  if (installResult.exitCode === 0) {
    change(`LSP servers installed (${specs})`);
    ctx.nextStepTriggers.claudeRestart = true;
  } else {
    warn(`npm install -g ${specs} failed. Try manually: npm install -g ${specs}`);
  }
}

/**
 * rustup channel: rust-analyzer ships no npm package, and upstream's first
 * recommendation is the rustup component, which tracks the toolchain the host
 * already trusts. The component version therefore follows that toolchain, so
 * the manifest row carries no verified pin - the stance bubblewrap already
 * takes for a distro package.
 */
async function installRustAnalyzer(ctx: Ctx): Promise<void> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger;
  if (ctx.dryRun) {
    echo("[dry-run] would install: rustup component add rust-analyzer");
    return;
  }
  verbose("Installing rust-analyzer via rustup...");
  progress("Installing rust-analyzer via rustup...");
  const result = await spawnProcess("rustup", ["component", "add", "rust-analyzer"], {
    stdio: "ignore",
  });
  clearProgress();
  if (result.exitCode === 0) {
    change("LSP server installed (rust-analyzer via rustup)");
    ctx.nextStepTriggers.claudeRestart = true;
  } else {
    warn(
      "rustup component add rust-analyzer failed. Try manually: rustup component add rust-analyzer",
    );
  }
}

export async function syncLspServers(ctx: Ctx): Promise<void> {
  const { echo, verbose, warn } = ctx.services.logger;
  const sot = parseJson(payloadText("SoT/.claude/settings.json"));
  const enabled =
    sot !== undefined && isObject(sot) && isObject(sot["enabledPlugins"])
      ? sot["enabledPlugins"]
      : undefined;
  if (enabled === undefined) return;
  const enables = (plugin: string): boolean =>
    Object.prototype.hasOwnProperty.call(enabled, plugin);
  const hasPhp = enables("php-lsp@claude-plugins-official");
  const hasTs = enables("typescript-lsp@claude-plugins-official");
  const hasRust = enables("rust-analyzer-lsp@claude-plugins-official");
  if (!hasPhp && !hasTs && !hasRust) return;

  const phpMissing = hasPhp && ctx.services.deps.probe("intelephense").state === "missing";
  const tsServerMissing =
    hasTs && ctx.services.deps.probe("typescript-language-server").state === "missing";
  const tscMissing = hasTs && ctx.services.deps.probe("tsc").state === "missing";
  const rustMissing = hasRust && ctx.services.deps.probe("rust-analyzer").state === "missing";
  // A host without rustup does no Rust work, so the plugin has nothing to
  // serve there. Installing is impossible and warning every sync would name no
  // action the user wants, so that host is not counted as missing a tool.
  const rustInstallable = rustMissing && ctx.services.deps.probe("rustup").state === "present";
  if (rustMissing && !rustInstallable) {
    verbose(
      "Skipping rust-analyzer: rustup is not installed, so the rust-analyzer-lsp plugin stays a no-op",
    );
  }

  const missingToolCount =
    Number(phpMissing) + Number(tsServerMissing) + Number(tscMissing) + Number(rustInstallable);
  if (missingToolCount === 0) {
    if (ctx.dryRun) {
      echo("[dry-run] LSP server binaries present");
    } else {
      verbose("LSP server binaries present");
    }
    return;
  }

  const blockingNode = tsServerMissing ? await nodeBelowServerFloor(ctx) : "";
  if (blockingNode !== "") {
    warn(
      `Skipping typescript-language-server install: Node ${blockingNode} is older than the ${field("node", "floor")} that version requires. Upgrade Node, then re-run sync.`,
    );
  }
  const missing = [
    phpMissing ? lspPkg(ctx, "intelephense", "intelephense") : undefined,
    tsServerMissing && blockingNode === ""
      ? lspPkg(ctx, "typescript-language-server", "typescript-language-server")
      : undefined,
    tscMissing ? lspPkg(ctx, "tsc", "typescript") : undefined,
  ].filter((spec): spec is string => spec !== undefined);

  await installNpmServers(ctx, missing);
  if (rustInstallable) await installRustAnalyzer(ctx);
}

/** Kit-pinned npm-global LSP packages: manifest tool id and npm package name. */
const NPM_SERVERS: ReadonlyArray<readonly [ToolId, string]> = [
  ["intelephense", "intelephense"],
  ["typescript-language-server", "typescript-language-server"],
  ["tsc", "typescript"],
];

/**
 * `toolchain upgrade`: move each kit-pinned npm-global LSP package that npm
 * owns and that sits below its `verified` pin to that exact pin. A copy that
 * npm does not own came from another installer, so it is named and left
 * alone. A missing package stays missing: `sync claude` owns first installs.
 */
export async function upgradeLspServers(ctx: Ctx): Promise<number> {
  const { change, clearProgress, echo, err, progress, verbose, warn } = ctx.services.logger;
  if (ctx.services.deps.probe("npm").state === "missing") {
    err("toolchain upgrade needs npm: the kit installs its LSP servers with npm install -g");
    return 1;
  }
  const owned = await npmGlobalVersions(defaultProbeExecutor);
  const prefix = await capture("npm", ["prefix", "-g"]);
  const windows = ctx.services.platform.name() === "windows";
  const comparable = (path: string): string => {
    const slashed = path.replaceAll("\\", "/");
    return windows ? slashed.toLowerCase() : slashed;
  };
  const resolved = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  // A PATH entry is the npm copy of `pkg` when the file it resolves to lies in
  // that package's own directory: <prefix>/lib/node_modules/<pkg> on POSIX,
  // where npm's bin entries are links into it. Any other file under the prefix
  // does not count, because a system Node uses /usr or /usr/local as its prefix
  // and distro binaries live there too. npm writes Windows shims straight into
  // <prefix> instead of linking, so there a shim in <prefix> itself counts.
  const npmRoot = prefix === "" ? "" : `${comparable(resolved(prefix))}/`;
  const isNpmCopy = (path: string, pkg: string): boolean => {
    const packageDir = `${npmRoot}${windows ? "" : "lib/"}node_modules/${comparable(pkg)}/`;
    if (comparable(resolved(path)).startsWith(packageDir)) return true;
    const entry = comparable(path);
    return windows && entry.slice(0, entry.lastIndexOf("/") + 1) === `${comparable(prefix)}/`;
  };

  const targets: Array<readonly [string, string]> = [];
  const moves: Array<string> = [];
  for (const [tool, pkg] of NPM_SERVERS) {
    const verified = field(tool, "verified");
    if (verified === "") continue;
    const installed = owned[pkg];
    const probe = ctx.services.deps.probe(tool);
    const onPath = probe.state === "present" ? (probe.path ?? "") : "";
    if (installed === undefined) {
      if (onPath !== "") {
        warn(
          `Skipping ${pkg}: ${onPath} is not an npm global package. Upgrade it with the tool that installed it.`,
        );
      } else {
        verbose(`${pkg} is not installed; sync claude installs it when its plugin is enabled`);
      }
      continue;
    }
    if (onPath !== "" && npmRoot !== "" && !isNpmCopy(onPath, pkg)) {
      warn(
        `${tool} on PATH is ${onPath}, not the npm global copy under ${prefix}; an upgrade changes only the npm copy`,
      );
    }
    if (!isNewer(verified, installed)) {
      verbose(`${pkg} up to date (${installed}, verified ${verified})`);
      continue;
    }
    if (tool === "typescript-language-server") {
      const blockingNode = await nodeBelowServerFloor(ctx);
      if (blockingNode !== "") {
        warn(
          `Skipping typescript-language-server upgrade: Node ${blockingNode} is older than the ${field("node", "floor")} that version requires. Upgrade Node first.`,
        );
        continue;
      }
    }
    targets.push([pkg, verified]);
    moves.push(`${pkg} ${installed} -> ${verified}`);
  }

  if (targets.length === 0) {
    echo("npm LSP servers: nothing to upgrade");
    return 0;
  }
  const specs = targets.map(([pkg, verified]) => `${pkg}@${verified}`);
  const command = `npm install -g ${specs.join(" ")}`;
  if (ctx.dryRun) {
    echo(`[dry-run] would upgrade (${moves.join(", ")}): ${command}`);
    return 0;
  }
  progress(`Upgrading LSP servers via npm: ${specs.join(" ")}...`);
  const result = await spawnProcess("npm", ["install", "-g", ...specs], { stdio: "ignore" });
  clearProgress();
  if (result.exitCode !== 0) {
    err(`${command} failed. Try manually: ${command}`);
    return 1;
  }
  // npmGlobalVersions memoizes per executor, so a fresh executor object reads
  // the inventory npm holds after the install.
  const after = await npmGlobalVersions({ ...defaultProbeExecutor });
  const short = targets
    .filter(([pkg, verified]) => after[pkg] !== verified)
    .map(([pkg, verified]) => `${pkg} is ${after[pkg] ?? "missing"}, expected ${verified}`);
  if (short.length > 0) {
    err(`npm install -g exited 0, but npm ls -g reports: ${short.join("; ")}`);
    return 1;
  }
  change(`LSP servers upgraded (${moves.join(", ")}); restart Claude Code to load them`);
  return 0;
}
