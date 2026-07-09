import { Command, Options } from "@effect/cli"
import { Console, Effect } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { bail, compiled } from "../engine"
import { kitHome } from "../kitHome"

const noSync = Options.boolean("no-sync").pipe(
  Options.withDescription("Update the kit only; skip the chained flag-less sync")
)

const git = (home: string, args: Array<string>): { ok: boolean; out: string } => {
  const res = spawnSync("git", ["-C", home, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
  return { ok: res.error === undefined && res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() }
}

/** Spawn the freshly-updated code — the running process still has the old
 * version loaded, so the chained sync must be a new process. */
const chainSync = (argv0: string, args: Array<string>): Effect.Effect<void> =>
  Effect.sync(() => {
    const res = spawnSync(argv0, args, { stdio: "inherit" })
    if (res.error !== undefined || res.status !== 0) process.exit(res.status ?? 1)
  })

const updateCheckout = (home: string, skipSync: boolean) =>
  Effect.gen(function* () {
    if (spawnSync("git", ["--version"], { stdio: "ignore" }).status !== 0) {
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
      return yield* Console.log(`Already up to date (${after.slice(0, 7)}, upstream ${upstream.out}).`)
    }

    const count = git(home, ["rev-list", "--count", `${before}..${after}`]).out
    yield* Console.log(`Updated ${before.slice(0, 7)}..${after.slice(0, 7)} (${count} commit(s) from ${upstream.out}).`)

    const touched = git(home, ["diff", "--name-only", before, after]).out.split("\n")
    if (touched.includes("bun.lock") || touched.includes("package.json")) {
      const res = spawnSync("bun", ["install", "--frozen-lockfile"], { cwd: home, stdio: "inherit" })
      if (res.error !== undefined || res.status !== 0) {
        return yield* bail("dependencies changed but 'bun install --frozen-lockfile' failed - fix that, then run docks-kit sync", 1)
      }
    }

    if (compiled) {
      return yield* Console.log(
        "This compiled binary still runs the previous version - rebuild (bash cli/build-binaries.sh) or download the latest release binary, then run: docks-kit sync"
      )
    }
    if (skipSync) return yield* Console.log("Kit updated. Run: docks-kit sync")
    yield* Console.log("Kit updated - running sync with the new version...")
    return yield* chainSync(process.execPath, [join(home, "cli/src/main.ts"), "sync"])
  })

const updatePackage = (home: string, skipSync: boolean) =>
  Effect.gen(function* () {
    // Bun's global dir is configurable (BUN_INSTALL_GLOBAL_DIR / BUN_INSTALL),
    // so the ~/.bun path shape alone under-detects Bun installs.
    const underEnvDir = (v: string): boolean => {
      const dir = process.env[v]
      return dir !== undefined && dir !== "" && home.startsWith(dir)
    }
    const viaBun =
      home.includes("/.bun/") ||
      home.includes("\\.bun\\") ||
      underEnvDir("BUN_INSTALL_GLOBAL_DIR") ||
      underEnvDir("BUN_INSTALL")
    const res = viaBun
      ? spawnSync("bun", ["add", "-g", "docks-kit@latest"], { stdio: "inherit" })
      : spawnSync("npm", ["install", "-g", "docks-kit@latest"], { stdio: "inherit" })
    if (res.error !== undefined || res.status !== 0) {
      return yield* bail(`global package update failed (${viaBun ? "bun add -g" : "npm install -g"} docks-kit@latest)`, 1)
    }
    if (skipSync) return yield* Console.log("Kit updated. Run: docks-kit sync")
    yield* Console.log("Kit updated - running sync with the new version...")
    // Chain through the package dir just updated (global installs update in
    // place) — a bare `docks-kit` PATH lookup could hit a different shim.
    return yield* chainSync(process.execPath, [join(home, "cli/src/main.ts"), "sync"])
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
    "Self-update the kit: autodetects the install (git checkout -> ff-only pull; bun/npm global -> @latest) and chains a flag-less sync with the new version (--no-sync to skip)."
  )
)
