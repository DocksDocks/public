import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"

import { p } from "./exec"
import type { Ctx } from "./index"
import type { EngineServices } from "./services"
import { field } from "./toolchain"

export type BunRuntimeState =
  | { readonly kind: "ready"; readonly executable: string }
  | { readonly kind: "deferred"; readonly reason: "missing-curl" | "install-failed" }

function remember(ctx: Ctx, state: BunRuntimeState): BunRuntimeState {
  ctx.bunRuntime = state
  return state
}

function predictedExecutable(ctx: Ctx): string {
  const root = process.env["BUN_INSTALL"] !== undefined && process.env["BUN_INSTALL"] !== ""
    ? process.env["BUN_INSTALL"]!
    : p(ctx.home, ".bun")
  return p(root, "bin", "bun")
}

function installBun(pin: string, installer: string): void {
  const download = spawnSync("curl", ["-fsSL", "https://bun.sh/install", "-o", installer], { stdio: "ignore" })
  if (download.error === undefined && download.status === 0) {
    spawnSync("bash", [installer, `bun-v${pin}`], { stdio: "ignore" })
  }
}

export function bunBootstrap(ctx: Ctx, services: EngineServices): BunRuntimeState {
  if (ctx.bunRuntime !== undefined) return ctx.bunRuntime

  const existing = services.deps.path("bun")
  if (existing !== "") return remember(ctx, { kind: "ready", executable: existing })

  const pin = field(ctx, "bun", "verified")
  if (pin === "") {
    services.logger.warn("Bun bootstrap aborted — SoT/toolchain.json has no verified Bun pin")
    return remember(ctx, { kind: "deferred", reason: "install-failed" })
  }
  if (services.deps.probe("curl").state === "missing") {
    services.deps.warnMissing("curl", services.logger, "cannot bootstrap Bun; install Bun manually, then re-run sync")
    return remember(ctx, { kind: "deferred", reason: "missing-curl" })
  }
  if (ctx.dryRun) {
    const executable = predictedExecutable(ctx)
    services.logger.echo(`[dry-run] install Bun ${pin} (kit-verified) -> ${executable}`)
    return remember(ctx, { kind: "ready", executable })
  }
  services.logger.warn(`Bun not found — installing Bun ${pin} (kit-verified)...`)
  const installer = p(tmpdir(), `bun-install-${process.pid}.sh`)
  try {
    installBun(pin, installer)
  } finally {
    rmSync(installer, { force: true })
  }

  const installed = services.deps.path("bun")
  if (installed === "") {
    services.logger.warn("Bun install failed. Install manually from https://bun.sh/docs/installation, then re-run sync.")
    return remember(ctx, { kind: "deferred", reason: "install-failed" })
  }
  const version = services.deps.version("bun")
  services.logger.change(`Bun installed (${version !== "" ? version : "version unknown"})`)
  return remember(ctx, { kind: "ready", executable: installed })
}
