import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

import { p, spawnProcess, type AsyncProcessOptions, type AsyncProcessResult } from "./exec"
import type { Ctx } from "./index"
import type { EngineServices } from "./services"
import { field } from "./toolchain"

export type BunRuntimeState =
  | { readonly kind: "ready"; readonly executable: string }
  | {
      readonly kind: "deferred"
      readonly reason: "missing-curl" | "download-failed" | "installer-failed" | "install-failed"
    }

function predictedExecutable(ctx: Ctx): string {
  const root = process.env["BUN_INSTALL"] !== undefined && process.env["BUN_INSTALL"] !== ""
    ? process.env["BUN_INSTALL"]!
    : p(ctx.home, ".bun")
  return p(root, "bin", "bun")
}

type BunInstallResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "download-failed" | "installer-failed"; readonly detail: string }

function processFailure(result: AsyncProcessResult): string {
  const details = [result.error?.message, result.stderr.trim()].filter((value): value is string => value !== undefined && value !== "")
  return details.join(": ") || (result.exitCode === null ? "the process ended without an exit code" : `exit code ${result.exitCode}`)
}

async function installBun(pin: string, installer: string): Promise<BunInstallResult> {
  const options: AsyncProcessOptions = { stdio: ["ignore", "ignore", "pipe"] }
  const download = await spawnProcess("curl", ["-fsSL", "https://bun.sh/install", "-o", installer], options)
  if (download.error !== undefined || download.exitCode !== 0) {
    return { ok: false, reason: "download-failed", detail: processFailure(download) }
  }
  const install = await spawnProcess("bash", [installer, `bun-v${pin}`], options)
  if (install.error !== undefined || install.exitCode !== 0) {
    return { ok: false, reason: "installer-failed", detail: processFailure(install) }
  }
  return { ok: true }
}

export function bunBootstrap(ctx: Ctx, services: EngineServices): Promise<BunRuntimeState> {
  if (ctx.bunRuntime !== undefined) return ctx.bunRuntime
  const pending = runBunBootstrap(ctx, services)
  ctx.bunRuntime = pending
  return pending
}

async function runBunBootstrap(ctx: Ctx, services: EngineServices): Promise<BunRuntimeState> {

  const existing = await services.deps.path("bun")
  if (existing !== "") return { kind: "ready", executable: existing }

  const pin = field(ctx, "bun", "verified")
  if (pin === "") {
    services.logger.warn("Bun bootstrap aborted — SoT/toolchain.json has no verified Bun pin")
    return { kind: "deferred", reason: "install-failed" }
  }
  if (services.deps.probe("curl").state === "missing") {
    services.deps.warnMissing("curl", services.logger, "cannot bootstrap Bun; install Bun manually, then re-run sync")
    return { kind: "deferred", reason: "missing-curl" }
  }
  if (ctx.dryRun) {
    const executable = predictedExecutable(ctx)
    services.logger.echo(`[dry-run] install Bun ${pin} (kit-verified) -> ${executable}`)
    return { kind: "ready", executable }
  }
  services.logger.warn(`Bun not found — installing Bun ${pin} (kit-verified)...`)
  const temporaryDir = mkdtempSync(p(tmpdir(), "docks-kit-bun-"))
  const installer = p(temporaryDir, "install.sh")
  let result: BunInstallResult
  try {
    result = await installBun(pin, installer)
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true })
  }
  if (!result.ok) {
    const stage = result.reason === "download-failed" ? "installer download" : "installer"
    services.logger.warn(
      `Bun ${stage} failed (${result.detail}). Install Bun manually from https://bun.sh/docs/installation, then re-run sync.`
    )
    return { kind: "deferred", reason: result.reason }
  }

  const installed = await services.deps.path("bun")
  if (installed === "") {
    services.logger.warn("Bun install failed. Install manually from https://bun.sh/docs/installation, then re-run sync.")
    return { kind: "deferred", reason: "install-failed" }
  }
  const version = await services.deps.version("bun")
  services.logger.change(`Bun installed (${version !== "" ? version : "version unknown"})`)
  return { kind: "ready", executable: installed }
}
