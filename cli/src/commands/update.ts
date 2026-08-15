import { Command, Flag } from "effect/unstable/cli"
import { Console, Effect } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { bail, compiled } from "../engine"
import { kitHome } from "../kitHome"
import { which } from "../engine-native/exec"
import { hostOs, type Invocation } from "../engine-native/os"

const noSync = Flag.boolean("no-sync").pipe(
  Flag.withDescription("Update the kit only; skip the chained flag-less sync")
)

/** Resolve Windows shims without changing the command spelling spawned on POSIX. */
const updateInvocation = (command: string, args: ReadonlyArray<string>): Invocation => {
  const host = hostOs()
  const executablePath = host.executableSuffixes.some((suffix) => suffix !== "")
    ? (which(command, host.executableSuffixes) || command)
    : command
  return host.invoke(executablePath, args)
}

const git = (home: string, args: Array<string>): { ok: boolean; out: string } => {
  const invocation = updateInvocation("git", ["-C", home, ...args])
  const res = spawnSync(invocation.command, [...invocation.args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
  return { ok: res.error === undefined && res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() }
}

/** Spawn the freshly-updated code — the running process still has the old
 * version loaded, so the chained sync must be a new process. */
const chainSync = (argv0: string, args: Array<string>): Effect.Effect<void> =>
  Effect.sync(() => {
    const invocation = updateInvocation(argv0, args)
    const res = spawnSync(invocation.command, [...invocation.args], { stdio: "inherit" })
    if (res.error !== undefined || res.status !== 0) process.exit(res.status ?? 1)
  })

export const updateSyncArgs = (home: string): Array<string> => [
  join(home, "cli/src/main.ts"),
  "sync",
  "--skip-plugin-refresh"
]

const readPackageVersion = (home: string): string => {
  try {
    const doc: unknown = JSON.parse(readFileSync(join(home, "package.json"), "utf8"))
    if (doc === null || typeof doc !== "object" || !("version" in doc)) return ""
    return typeof doc.version === "string" ? doc.version : ""
  } catch {
    return ""
  }
}

export type PackageManager = "bun" | "npm"

interface PackageRootCapture {
  readonly status: number | null
  readonly stdout: string
  readonly error?: Error
}

type CapturePackageRoot = (
  command: string,
  args: ReadonlyArray<string>
) => PackageRootCapture

const capturePackageRoot: CapturePackageRoot = (command, args) => {
  const invocation = updateInvocation(command, args)
  const res = spawnSync(invocation.command, [...invocation.args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    ...(res.error === undefined ? {} : { error: res.error })
  }
}

export const packageManagerForHome = (
  home: string,
  environment: NodeJS.ProcessEnv = process.env
): PackageManager => {
  const underEnvironmentRoot = (name: "BUN_INSTALL_GLOBAL_DIR" | "BUN_INSTALL"): boolean => {
    const root = environment[name]?.trim()
    return root !== undefined && root !== "" && (home === root || home.startsWith(`${root}/`))
  }
  return home.includes("/.bun/") ||
    underEnvironmentRoot("BUN_INSTALL_GLOBAL_DIR") ||
    underEnvironmentRoot("BUN_INSTALL")
    ? "bun"
    : "npm"
}

export type GlobalPackageHome =
  | { readonly ok: true; readonly home: string }
  | { readonly ok: false; readonly diagnostic: string }

export const resolveGlobalPackageHome = (
  manager: PackageManager,
  capture: CapturePackageRoot = capturePackageRoot
): GlobalPackageHome => {
  const commandArgs = manager === "bun" ? ["pm", "-g", "ls"] : ["root", "-g"]
  const result = capture(manager, commandArgs)
  if (result.error !== undefined || result.status !== 0) {
    const detail =
      result.error !== undefined
        ? result.error.message
        : `exit ${result.status ?? "without status"}`
    return {
      ok: false,
      diagnostic: `${manager} ${commandArgs.join(" ")} failed: ${detail}`
    }
  }

  if (manager === "npm") {
    const root = result.stdout.trim()
    return root === ""
      ? { ok: false, diagnostic: "npm root -g failed: empty output" }
      : { ok: true, home: join(root, "docks-kit") }
  }

  const globalHeader = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => / node_modules(?: \(\d+\))?$/.test(line))
  const globalDir =
    globalHeader === undefined
      ? undefined
      : /^(.*) node_modules(?: \(\d+\))?$/.exec(globalHeader)?.[1]
  return globalDir === undefined || globalDir === ""
    ? { ok: false, diagnostic: "bun pm -g ls did not report its global package root" }
    : { ok: true, home: join(globalDir, "node_modules", "docks-kit") }
}

export const packageUpdateResult = (
  before: string,
  after: string,
  samePackageRoot = true
): { alreadyCurrent: boolean; message: string } => {
  if (before === "" || after === "") return { alreadyCurrent: false, message: "" }
  if (!samePackageRoot) {
    return {
      alreadyCurrent: false,
      message: `Installed ${after} in the selected global package root.`
    }
  }
  if (before === after) {
    return { alreadyCurrent: true, message: `Already at the latest version (${after}).` }
  }
  return { alreadyCurrent: false, message: `Updated ${before} -> ${after}.` }
}

const updateCheckout = (home: string, skipSync: boolean) =>
  Effect.gen(function* () {
    const gitVersion = updateInvocation("git", ["--version"])
    if (spawnSync(gitVersion.command, [...gitVersion.args], { stdio: "ignore" }).status !== 0) {
      return yield* bail("git not found - cannot update the kit checkout")
    }
    const dirty = git(home, ["status", "--porcelain"])
    if (!dirty.ok) return yield* bail(`git status failed in ${home}: ${dirty.out}`)
    if (dirty.out !== "") {
      return yield* bail(`kit checkout ${home} has local changes - commit or stash them, then re-run docks-kit update`)
    }
    const upstream = git(home, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
    if (!upstream.ok) {
      return yield* bail("current branch has no upstream - set one (git branch --set-upstream-to) or update manually")
    }
    const before = git(home, ["rev-parse", "HEAD"]).out
    const pull = git(home, ["pull", "--ff-only"])
    if (!pull.ok) return yield* bail(`git pull --ff-only failed (diverged history?):\n${pull.out}`)
    const after = git(home, ["rev-parse", "HEAD"]).out

    if (before === after) {
      return yield* Console.log(`Already at the latest version (${after.slice(0, 7)}, upstream ${upstream.out}).`)
    }

    const count = git(home, ["rev-list", "--count", `${before}..${after}`]).out
    yield* Console.log(`Updated ${before.slice(0, 7)}..${after.slice(0, 7)} (${count} commit(s) from ${upstream.out}).`)

    const touched = git(home, ["diff", "--name-only", before, after]).out.split("\n")
    if (touched.includes("bun.lock") || touched.includes("package.json")) {
      const invocation = updateInvocation("bun", ["install", "--frozen-lockfile"])
      const res = spawnSync(invocation.command, [...invocation.args], { cwd: home, stdio: "inherit" })
      if (res.error !== undefined || res.status !== 0) {
        return yield* bail("dependencies changed but 'bun install --frozen-lockfile' failed - fix that, then run docks-kit sync", 1)
      }
    }

    if (compiled) {
      return yield* Console.log(
        "This compiled binary still runs the previous version - the checkout launcher will use updated source next time. Run: ./docks-kit sync (rebuild with bash cli/build-binaries.sh to restore the binary fast path)."
      )
    }
    if (skipSync) return yield* Console.log("Kit updated. Run: docks-kit sync")
    yield* Console.log("Kit updated - running sync with the new version...")
    return yield* chainSync(process.execPath, updateSyncArgs(home))
  })

const updatePackage = (home: string, skipSync: boolean) =>
  Effect.gen(function* () {
    const manager = packageManagerForHome(home)
    const beforeVersion = readPackageVersion(home)
    const updateArgs = manager === "bun"
      ? ["add", "-g", "docks-kit@latest"]
      : ["install", "-g", "docks-kit@latest"]
    const invocation = updateInvocation(manager, updateArgs)
    const res = spawnSync(invocation.command, [...invocation.args], { stdio: "inherit" })
    if (res.error !== undefined || res.status !== 0) {
      return yield* bail(
        `global package update failed (${manager === "bun" ? "bun add -g" : "npm install -g"} docks-kit@latest)`,
        1
      )
    }

    const updated = resolveGlobalPackageHome(manager)
    if (!updated.ok) {
      return yield* bail(
        `global package update completed, but the updated package root could not be resolved: ${updated.diagnostic}`,
        1
      )
    }
    const afterVersion = readPackageVersion(updated.home)
    if (afterVersion === "") {
      return yield* bail(
        `global package update completed, but ${join(updated.home, "package.json")} has no readable version`,
        1
      )
    }
    const result = packageUpdateResult(beforeVersion, afterVersion, home === updated.home)
    if (result.message !== "") yield* Console.log(result.message)
    if (result.alreadyCurrent) return
    if (skipSync) return yield* Console.log("Kit updated. Run: docks-kit sync")
    yield* Console.log("Kit updated - running sync with the new version...")
    return yield* chainSync(process.execPath, updateSyncArgs(updated.home))
  })

export const updateCommand = Command.make("update", { noSync }, (config) =>
  Effect.gen(function* () {
    const home = kitHome()
    if (existsSync(join(home, ".git"))) {
      return yield* updateCheckout(home, config.noSync)
    }
    if (home.includes("node_modules")) {
      return yield* updatePackage(home, config.noSync)
    }
    return yield* bail(
      `kit home ${home} is neither a git checkout nor a global package install - update it the way it was installed (e.g. download the latest release binary)`
    )
  })
).pipe(
  Command.withDescription(
    "Self-update the kit: autodetects the install (git checkout -> ff-only pull; bun/npm global -> @latest) and chains an install-missing-only sync with the new version (--no-sync to skip)."
  )
)
