/**
 * EngineNative `sync claude` LSP server probes and installs. The php-lsp,
 * typescript-lsp, and rust-analyzer-lsp plugins are no-ops without their
 * server binaries, so this pass installs the missing ones. Message strings
 * and spawned argv are part of the contract.
 */
import { spawnProcess } from "./exec"
import type { Ctx } from "./index"
import { isObject, parseJson } from "./jq"
import { belowFloor, field, installedVersion } from "./toolchain"
import { payloadText } from "../payload"

function lspPkg(ctx: Ctx, tool: string, pkg: string): string | undefined {
  const version = field(tool, "verified")
  if (version !== "") return `${pkg}@${version}`
  ctx.services.logger.warn(`Skipping ${pkg} install: ${tool} has no verified version in SoT/toolchain.json`)
  return undefined
}

/**
 * npm treats a package's `engines` field as advisory unless the host opted
 * into engine-strict, so installing typescript-language-server 6 on an older
 * Node succeeds and then fails at every startup. Report the host Node version
 * when it is too old, and the empty string when the install is safe.
 */
async function nodeBelowServerFloor(ctx: Ctx): Promise<string> {
  const floor = field("node", "floor")
  if (floor === "") return ""
  const installed = await installedVersion(ctx, "node")
  return belowFloor(installed, floor) ? installed : ""
}

/** npm-global channel: intelephense, typescript-language-server, typescript. */
async function installNpmServers(ctx: Ctx, missing: ReadonlyArray<string>): Promise<void> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger
  if (missing.length === 0) return
  const specs = missing.join(" ")
  if (ctx.dryRun) {
    echo(`[dry-run] would install: npm install -g ${specs}`)
    return
  }

  if (ctx.services.deps.probe("npm").state === "missing") {
    ctx.services.deps.warnMissing(
      "npm",
      ctx.services.logger,
      `cannot install LSP servers (${specs}); the php-lsp/typescript-lsp plugins stay no-ops`
    )
    return
  }

  verbose(`Installing LSP servers via npm: ${specs}...`)
  progress(`Installing LSP servers via npm: ${specs}...`)
  const installResult = await spawnProcess("npm", ["install", "-g", ...missing], { stdio: "ignore" })
  clearProgress()
  if (installResult.exitCode === 0) {
    change(`LSP servers installed (${specs})`)
    ctx.nextStepTriggers.claudeRestart = true
  } else {
    warn(`npm install -g ${specs} failed. Try manually: npm install -g ${specs}`)
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
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger
  if (ctx.dryRun) {
    echo("[dry-run] would install: rustup component add rust-analyzer")
    return
  }
  verbose("Installing rust-analyzer via rustup...")
  progress("Installing rust-analyzer via rustup...")
  const result = await spawnProcess("rustup", ["component", "add", "rust-analyzer"], { stdio: "ignore" })
  clearProgress()
  if (result.exitCode === 0) {
    change("LSP server installed (rust-analyzer via rustup)")
    ctx.nextStepTriggers.claudeRestart = true
  } else {
    warn("rustup component add rust-analyzer failed. Try manually: rustup component add rust-analyzer")
  }
}

export async function syncLspServers(ctx: Ctx): Promise<void> {
  const { echo, verbose, warn } = ctx.services.logger
  const sot = parseJson(payloadText("SoT/.claude/settings.json"))
  const enabled = sot !== undefined && isObject(sot) && isObject(sot["enabledPlugins"]) ? sot["enabledPlugins"] : undefined
  if (enabled === undefined) return
  const enables = (plugin: string): boolean => Object.prototype.hasOwnProperty.call(enabled, plugin)
  const hasPhp = enables("php-lsp@claude-plugins-official")
  const hasTs = enables("typescript-lsp@claude-plugins-official")
  const hasRust = enables("rust-analyzer-lsp@claude-plugins-official")
  if (!hasPhp && !hasTs && !hasRust) return

  const phpMissing = hasPhp && ctx.services.deps.probe("intelephense").state === "missing"
  const tsServerMissing = hasTs && ctx.services.deps.probe("typescript-language-server").state === "missing"
  const tscMissing = hasTs && ctx.services.deps.probe("tsc").state === "missing"
  const rustMissing = hasRust && ctx.services.deps.probe("rust-analyzer").state === "missing"
  // A host without rustup does no Rust work, so the plugin has nothing to
  // serve there. Installing is impossible and warning every sync would name no
  // action the user wants, so that host is not counted as missing a tool.
  const rustInstallable = rustMissing && ctx.services.deps.probe("rustup").state === "present"
  if (rustMissing && !rustInstallable) {
    verbose("Skipping rust-analyzer: rustup is not installed, so the rust-analyzer-lsp plugin stays a no-op")
  }

  const missingToolCount = Number(phpMissing) + Number(tsServerMissing) + Number(tscMissing) + Number(rustInstallable)
  if (missingToolCount === 0) {
    if (ctx.dryRun) {
      echo("[dry-run] LSP server binaries present")
    } else {
      verbose("LSP server binaries present")
    }
    return
  }

  const blockingNode = tsServerMissing ? await nodeBelowServerFloor(ctx) : ""
  if (blockingNode !== "") {
    warn(
      `Skipping typescript-language-server install: Node ${blockingNode} is older than the ${field("node", "floor")} that version requires. Upgrade Node, then re-run sync.`
    )
  }
  const missing = [
    phpMissing ? lspPkg(ctx, "intelephense", "intelephense") : undefined,
    tsServerMissing && blockingNode === ""
      ? lspPkg(ctx, "typescript-language-server", "typescript-language-server")
      : undefined,
    tscMissing ? lspPkg(ctx, "tsc", "typescript") : undefined
  ].filter((spec): spec is string => spec !== undefined)

  await installNpmServers(ctx, missing)
  if (rustInstallable) await installRustAnalyzer(ctx)
}
