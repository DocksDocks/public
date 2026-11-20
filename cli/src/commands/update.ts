import { Command, Flag } from "effect/cli";
import { Console, Effect } from "effect";
import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bail, compiled } from "../engine";
import { kitHome } from "../kitHome";
import { DEPENDENCIES, defaultProbeExecutor, resolvePath } from "../engine-native/deps";
import { p, spawnHost } from "../engine-native/exec";
import { hostOs, type HostOs } from "../engine-native/os";

const noSync = Flag.Boolean("no-sync").pipe(
  Flag.withDescription("Update the kit only; skip the chained flag-less sync"),
  Flag.withDefault(false),
);

/** The host spawn of an update. Tests pass a recorder to observe the children. */
type UpdateSpawn = (
  command: string,
  args: ReadonlyArray<string>,
  overrides?: SpawnSyncOptions,
) => SpawnSyncReturns<string>;

const git = (
  spawn: UpdateSpawn,
  home: string,
  args: Array<string>,
): { ok: boolean; out: string } => {
  const res = spawn("git", ["-C", home, ...args]);
  return {
    ok: res.error === undefined && res.status === 0,
    out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim(),
  };
};

/** Spawn the freshly-updated code — the running process still has the old
 * version loaded, so the chained sync must be a new process. */
const chainSync = (spawn: UpdateSpawn, args: Array<string>): Effect.Effect<void> =>
  Effect.sync(() => {
    const res = spawn(process.execPath, args, { stdio: "inherit" });
    if (res.error !== undefined || res.status !== 0) process.exit(res.status ?? 1);
  });

type PackageBinEntry =
  | { readonly ok: true; readonly entry: string }
  | { readonly ok: false; readonly diagnostic: string };

/** The file that the installed package's `bin` names. The chained sync runs
 * it, not a fixed path, because `@latest` can be a release that predates the
 * bundle and still names `cli/src/main.ts`. The host's `join` builds the
 * spawned path, so a Windows home gets one separator style. */
const packageBinEntry = (home: string): PackageBinEntry => {
  const manifestPath = join(home, "package.json");
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    doc = undefined;
  }
  const bin = doc !== null && typeof doc === "object" && "bin" in doc ? doc.bin : undefined;
  const named =
    typeof bin === "string"
      ? bin
      : bin !== null && typeof bin === "object" && "docks-kit" in bin
        ? bin["docks-kit"]
        : undefined;
  if (typeof named !== "string" || named === "") {
    return {
      ok: false,
      diagnostic: `global package update completed, but ${manifestPath} names no docks-kit bin`,
    };
  }
  const entry = join(home, named);
  return existsSync(entry)
    ? { ok: true, entry }
    : {
        ok: false,
        diagnostic: `global package update completed, but the docks-kit bin ${entry} named by ${manifestPath} does not exist`,
      };
};

const readPackageVersion = (home: string): string => {
  try {
    const doc: unknown = JSON.parse(readFileSync(p(home, "package.json"), "utf8"));
    if (doc === null || typeof doc !== "object" || !("version" in doc)) return "";
    return typeof doc.version === "string" ? doc.version : "";
  } catch {
    return "";
  }
};

export type PackageManager = "bun" | "npm";

interface PackageRootCapture {
  readonly status: number | null;
  readonly stdout: string;
  readonly error?: Error;
}

type CapturePackageRoot = (command: string, args: ReadonlyArray<string>) => PackageRootCapture;

const capturePackageRoot =
  (spawn: UpdateSpawn): CapturePackageRoot =>
  (command, args) => {
    const res = spawn(command, args);
    return {
      status: res.status,
      stdout: res.stdout ?? "",
      ...(res.error === undefined ? {} : { error: res.error }),
    };
  };

/**
 * The comparison key of a host path. Windows reports paths with backslashes
 * and compares them without case sensitivity. On POSIX, a backslash remains a
 * legal filename character, not a separator.
 */
const hostPathKey = (value: string, host: HostOs): string =>
  host.id === "windows"
    ? value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
    : value.replace(/\/+$/, "");

/** Whether two package homes name the same directory on this host. */
export const samePackageHome = (a: string, b: string, host: HostOs = hostOs()): boolean =>
  hostPathKey(a, host) === hostPathKey(b, host);

/** A Bun global home is `<root>/.bun/install/global/node_modules/<pkg>`. */
export const packageManagerForHome = (
  home: string,
  environment: NodeJS.ProcessEnv = process.env,
  host: HostOs = hostOs(),
): PackageManager => {
  const normalizedHome = hostPathKey(home, host);
  const underEnvironmentRoot = (name: "BUN_INSTALL_GLOBAL_DIR" | "BUN_INSTALL"): boolean => {
    const root = environment[name]?.trim();
    if (root === undefined || root === "") return false;
    const normalizedRoot = hostPathKey(root, host) || "/";
    const prefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
    return normalizedHome === normalizedRoot || normalizedHome.startsWith(prefix);
  };
  return normalizedHome.includes("/.bun/") ||
    underEnvironmentRoot("BUN_INSTALL_GLOBAL_DIR") ||
    underEnvironmentRoot("BUN_INSTALL")
    ? "bun"
    : "npm";
};

export type GlobalPackageHome =
  | { readonly ok: true; readonly home: string }
  | { readonly ok: false; readonly diagnostic: string };

export const resolveGlobalPackageHome = (
  manager: PackageManager,
  capture: CapturePackageRoot = capturePackageRoot(spawnHost),
): GlobalPackageHome => {
  const commandArgs = manager === "bun" ? ["pm", "-g", "ls"] : ["root", "-g"];
  const result = capture(manager, commandArgs);
  if (result.error !== undefined || result.status !== 0) {
    const detail =
      result.error !== undefined
        ? result.error.message
        : `exit ${result.status ?? "without status"}`;
    return {
      ok: false,
      diagnostic: `${manager} ${commandArgs.join(" ")} failed: ${detail}`,
    };
  }

  if (manager === "npm") {
    const root = result.stdout.trim();
    return root === ""
      ? { ok: false, diagnostic: "npm root -g failed: empty output" }
      : { ok: true, home: p(root, "docks-kit") };
  }

  const globalHeader = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => / node_modules(?: \(.*\))?$/.test(line));
  const globalDir =
    globalHeader === undefined
      ? undefined
      : /^(.*) node_modules(?: \(.*\))?$/.exec(globalHeader)?.[1];
  return globalDir === undefined || globalDir === ""
    ? { ok: false, diagnostic: "bun pm -g ls did not report its global package root" }
    : { ok: true, home: p(globalDir, "node_modules", "docks-kit") };
};

export const packageUpdateResult = (
  before: string,
  after: string,
  samePackageRoot = true,
): { alreadyCurrent: boolean; message: string } => {
  if (before === "" || after === "") return { alreadyCurrent: false, message: "" };
  if (!samePackageRoot) {
    return {
      alreadyCurrent: false,
      message: `Installed ${after} in the selected global package root.`,
    };
  }
  if (before === after) {
    return { alreadyCurrent: true, message: `Already at the latest version (${after}).` };
  }
  return { alreadyCurrent: false, message: `Updated ${before} -> ${after}.` };
};

export type UpdateBunCommand =
  | { readonly ok: true; readonly command: string }
  | { readonly ok: false; readonly diagnostic: string };

/**
 * The Bun that reinstalls checkout dependencies. The source path always runs
 * under Bun, and the launcher may have picked a Bun that is not on PATH, so it
 * reuses `execPath`. A compiled binary resolves Bun like the dependency probe:
 * PATH, then $BUN_INSTALL/bin, then ~/.bun/bin.
 */
export const updateBunCommand = async (
  isCompiled: boolean,
  execPath: string,
  home: string,
  resolveBun: () => Promise<string> = () => resolvePath(DEPENDENCIES.bun, defaultProbeExecutor),
): Promise<UpdateBunCommand> => {
  if (!isCompiled) return { ok: true, command: execPath };
  const resolved = await resolveBun();
  return resolved === ""
    ? {
        ok: false,
        diagnostic: `dependencies changed but Bun was not found - run 'bun install --frozen-lockfile' in ${home}, then docks-kit sync`,
      }
    : { ok: true, command: resolved };
};

export const updateCheckout = (home: string, skipSync: boolean, spawn: UpdateSpawn = spawnHost) =>
  Effect.gen(function* () {
    if (spawn("git", ["--version"], { stdio: "ignore" }).status !== 0) {
      return yield* bail("git not found - cannot update the kit checkout");
    }
    const dirty = git(spawn, home, ["status", "--porcelain"]);
    if (!dirty.ok) return yield* bail(`git status failed in ${home}: ${dirty.out}`);
    if (dirty.out !== "") {
      return yield* bail(
        `kit checkout ${home} has local changes - commit or stash them, then re-run docks-kit update`,
      );
    }
    const upstream = git(spawn, home, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    if (!upstream.ok) {
      return yield* bail(
        "current branch has no upstream - set one (git branch --set-upstream-to) or update manually",
      );
    }
    const before = git(spawn, home, ["rev-parse", "HEAD"]).out;
    const pull = git(spawn, home, ["pull", "--ff-only"]);
    if (!pull.ok) return yield* bail(`git pull --ff-only failed (diverged history?):\n${pull.out}`);
    const after = git(spawn, home, ["rev-parse", "HEAD"]).out;

    // A current kit still syncs: the sync repairs drift of the deployed files
    // and plugins, for example a pi-intercom install that left its pin.
    const changed = before !== after;
    if (changed) {
      const count = git(spawn, home, ["rev-list", "--count", `${before}..${after}`]).out;
      yield* Console.log(
        `Updated ${before.slice(0, 7)}..${after.slice(0, 7)} (${count} commit(s) from ${upstream.out}).`,
      );

      const touched = git(spawn, home, ["diff", "--name-only", before, after]).out.split("\n");
      if (touched.includes("bun.lock") || touched.includes("package.json")) {
        const bun = yield* Effect.promise(() => updateBunCommand(compiled, process.execPath, home));
        if (!bun.ok) return yield* bail(bun.diagnostic, 1);
        const res = spawn(bun.command, ["install", "--frozen-lockfile"], {
          cwd: home,
          stdio: "inherit",
        });
        if (res.error !== undefined || res.status !== 0) {
          return yield* bail(
            `dependencies changed but 'bun install --frozen-lockfile' failed - fix the error, then run 'bun install --frozen-lockfile' in ${home} and docks-kit sync`,
            1,
          );
        }
      }
    } else {
      yield* Console.log(
        `Already at the latest version (${after.slice(0, 7)}, upstream ${upstream.out}).`,
      );
    }

    if (compiled) {
      return yield* Console.log(
        changed
          ? "This compiled binary still runs the previous version - the checkout launcher will use updated source next time. Run: ./docks-kit sync (rebuild with bash cli/build-binaries.sh to restore the binary fast path)."
          : "This compiled binary cannot chain the sync. Run: ./docks-kit sync",
      );
    }
    if (skipSync)
      return yield* Console.log(
        changed ? "Kit updated. Run: docks-kit sync" : "Run: docks-kit sync",
      );
    yield* Console.log(
      changed
        ? "Kit updated - running sync with the new version..."
        : "Syncing to deliver plugin and config updates...",
    );
    // The source, also when the checkout holds a stale ignored bundle.
    return yield* chainSync(spawn, [join(home, "cli", "src", "main.ts"), "sync"]);
  });

export const updatePackage = (home: string, skipSync: boolean, spawn: UpdateSpawn = spawnHost) =>
  Effect.gen(function* () {
    const manager = packageManagerForHome(home);
    const beforeVersion = readPackageVersion(home);
    const updateArgs =
      manager === "bun" ? ["add", "-g", "docks-kit@latest"] : ["install", "-g", "docks-kit@latest"];
    const res = spawn(manager, updateArgs, { stdio: "inherit" });
    if (res.error !== undefined || res.status !== 0) {
      return yield* bail(
        `global package update failed (${manager === "bun" ? "bun add -g" : "npm install -g"} docks-kit@latest)`,
        1,
      );
    }

    const updated = resolveGlobalPackageHome(manager, capturePackageRoot(spawn));
    if (!updated.ok) {
      return yield* bail(
        `global package update completed, but the updated package root could not be resolved: ${updated.diagnostic}`,
        1,
      );
    }
    const afterVersion = readPackageVersion(updated.home);
    if (afterVersion === "") {
      return yield* bail(
        `global package update completed, but ${p(updated.home, "package.json")} has no readable version`,
        1,
      );
    }
    const result = packageUpdateResult(
      beforeVersion,
      afterVersion,
      samePackageHome(home, updated.home),
    );
    if (result.message !== "") yield* Console.log(result.message);
    if (skipSync)
      return yield* Console.log(
        result.alreadyCurrent ? "Run: docks-kit sync" : "Kit updated. Run: docks-kit sync",
      );
    const bin = packageBinEntry(updated.home);
    if (!bin.ok) return yield* bail(bin.diagnostic, 1);
    yield* Console.log(
      result.alreadyCurrent
        ? "Syncing to deliver plugin and config updates..."
        : "Kit updated - running sync with the new version...",
    );
    return yield* chainSync(spawn, [bin.entry, "sync"]);
  });

export const updateCommand = Command.make("update", { noSync }, (config) =>
  Effect.gen(function* () {
    const home = kitHome();
    if (existsSync(p(home, ".git"))) {
      return yield* updateCheckout(home, config.noSync);
    }
    if (home.includes("node_modules")) {
      return yield* updatePackage(home, config.noSync);
    }
    return yield* bail(
      `kit home ${home} is neither a git checkout nor a global package install - update it the way it was installed (e.g. download the latest release binary)`,
    );
  }),
).pipe(
  Command.withDescription(
    "Self-update the kit: autodetects the install (git checkout -> ff-only pull; bun/npm global -> @latest), then chains a flag-less sync that also refreshes plugins, even when the kit was already current (--no-sync to skip).",
  ),
);
