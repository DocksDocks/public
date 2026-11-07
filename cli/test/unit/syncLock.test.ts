/**
 * Spec for the sync lock (plans #161 and #164). `engineSync` takes
 * `<kitCacheDir(home)>/sync-lock.db` through `kitLock.ts acquireKitLock` before
 * `parseArgs`, unless its arguments hold `--dry-run`, `-h`, or `--help`, or
 * the run is a dry run through the `DRY_RUN` env global (`ctx.dryRun`).
 * `modes.ts modeModel` takes the same lock first, with the same exceptions.
 * When another holder keeps the lock past the wait bound, the run prints
 * `another docks-kit sync holds <path>; run sync again after it ends` and
 * returns exit code 1.
 *
 * A writing sync also takes a folder lock in each Codex, agents, and omp
 * folder that it writes: the omp agent folder, the omp intercom folder, and
 * the omp data root. Syncs of different homes can share these folders.
 *
 * Wait bound seam: both call sites read `DOCKS_KIT_SYNC_LOCK_WAIT_MS` from
 * `process.env` at the start of the run, as `engineSync` reads
 * `DOCKS_KIT_SYNC_CONCURRENCY`. Unset or empty means `SYNC_LOCK_WAIT_MS`
 * (120 000 ms); a non-negative safe integer is the wait in ms. These tests
 * set it to a small value, so that a held lock ends the run quickly.
 *
 * Each test holds the lock in this process; a second acquire in the same
 * process finds the lock held (`kitLock.test.ts`).
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type * as ExecModule from "../../src/engine-native/exec";

/** The `omp` spawns of a sync, recorded while a test sets the array; else every spawn runs. */
const spawned = vi.hoisted(() => ({
  omp: undefined as Array<{ args: Array<string>; env: NodeJS.ProcessEnv | undefined }> | undefined,
}));
vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec");
  const spawnProcess: typeof actual.spawnProcess = async (cmd, args, options) => {
    if (cmd !== "omp" || spawned.omp === undefined) return actual.spawnProcess(cmd, args, options);
    spawned.omp.push({ args: [...args], env: options?.env });
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { ...actual, spawnProcess };
});

import { runEngineNative } from "../../src/engine-native";
import { p } from "../../src/engine-native/exec";
import { acquireKitLock, releaseKitLock } from "../../src/engine-native/kitLock";
import { ompPaths } from "../../src/engine-native/ompPaths";
import { kitCacheDir } from "../../src/engine-native/scratch";
import {
  makeDependencyManager,
  makeEngineServices,
  type EngineServices,
  type Logger,
} from "../../src/engine-native/services";
import { folderLockPaths } from "../../src/engine-native/syncDispatch";

const WAIT_MS = "100";
const CONCURRENCY_ERROR = "DOCKS_KIT_SYNC_CONCURRENCY must be 1, 2, or 3";
const WAIT_ERROR = "DOCKS_KIT_SYNC_LOCK_WAIT_MS must be a non-negative safe integer";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "AGENTS_DIR",
  "DOCKS_KIT_HOME",
  "DRY_RUN",
  "DOCKS_KIT_VERBOSE",
  "DOCKS_KIT_INTERACTIVE",
  "DOCKS_KIT_SYNC_CONCURRENCY",
  "DOCKS_KIT_SYNC_LOCK_WAIT_MS",
  "SKIP_BUBBLEWRAP",
  "RECONCILE",
  "PRUNE",
  "CLAUDE_COMPACT_WINDOW",
  "CLAUDE_PERMISSIVE",
  "CLAUDE_PLUGINS",
  "CLAUDE_MODEL",
  "CODEX_MODEL",
  "CODEX_HOME",
  "PI_CODING_AGENT_DIR",
  "OMP_PROFILE",
  "PI_PROFILE",
  "PI_CONFIG_DIR",
  "XDG_DATA_HOME",
] as const;

/** Run `body` with a temporary HOME and a small sync lock wait; restore the environment after. */
async function withHome(body: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "sync-lock-"));
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    // engineHome reads USERPROFILE on win32, so both keys point at the temp home.
    process.env["HOME"] = home;
    process.env["USERPROFILE"] = home;
    process.env["AGENTS_DIR"] = p(home, ".agents");
    process.env["DOCKS_KIT_INTERACTIVE"] = "0";
    process.env["DOCKS_KIT_SYNC_LOCK_WAIT_MS"] = WAIT_MS;
    await body(home);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Services that record each printed line and answer every dependency probe
 * without a host process: Bun is present, every other tool is missing.
 */
function recordingServices(records: Array<string>): EngineServices {
  const base = makeEngineServices();
  const logger: Logger = {
    ...base.logger,
    change: (message) => void records.push(message),
    verbose: () => {},
    warn: (message) => void records.push(message),
    err: (message) => void records.push(message),
    echo: (message) => void records.push(message),
  };
  const bun = "/opt/stub/bin/bun";
  return {
    ...base,
    logger,
    deps: makeDependencyManager(base.platform, {
      commandExists: (name) => name === "bun",
      capture: async () => "",
      which: (name) => (name === "bun" ? bun : ""),
    }),
  };
}

/**
 * The services of `recordingServices`, with omp and git present, so that a
 * sync runs its `omp` commands. `beforePipelines` runs when the sync starts
 * its pipelines, after it took its locks.
 */
function ompServices(records: Array<string>, beforePipelines: () => void): EngineServices {
  const base = recordingServices(records);
  const present: Record<string, true> = { bun: true, omp: true, git: true };
  return {
    ...base,
    logger: {
      ...base.logger,
      acquireTerminal: (message) => {
        beforePipelines();
        return base.logger.acquireTerminal(message);
      },
    },
    deps: makeDependencyManager(base.platform, {
      commandExists: (name) => Object.hasOwn(present, name),
      capture: async () => "",
      which: (name) => (Object.hasOwn(present, name) ? `/opt/stub/bin/${name}` : ""),
    }),
  };
}

function syncLock(home: string): string {
  return join(kitCacheDir(home), "sync-lock.db");
}

function heldLine(home: string): string {
  return `another docks-kit sync holds ${syncLock(home)}; run sync again after it ends`;
}

/** Every entry below `home`: a directory as `<dir>`, a file as its bytes in base64. */
function snapshot(home: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const name of readdirSync(home, { recursive: true, encoding: "utf8" }).sort()) {
    const path = join(home, name);
    entries[name] = lstatSync(path).isDirectory() ? "<dir>" : readFileSync(path).toString("base64");
  }
  return entries;
}

/** Hold the sync lock of `home` while `body` runs. */
async function holdingLock(home: string, body: () => Promise<void>): Promise<void> {
  const held = await acquireKitLock(syncLock(home), { waitMs: 0 });
  if (held.kind !== "acquired") throw new Error(`expected a free lock at ${syncLock(home)}`);
  try {
    await body();
  } finally {
    releaseKitLock(held.lock);
  }
}

/** Try the sync lock of `home` once, release it when the try took it, and return the result kind. */
async function probe(home: string): Promise<string> {
  const result = await acquireKitLock(syncLock(home), { waitMs: 0 });
  if (result.kind === "acquired") releaseKitLock(result.lock);
  return result.kind;
}

/** The lock file that a writing sync takes inside a Codex, agents, or omp folder. */
const FOLDER_LOCK = ".docks-kit-sync-lock.db";
const CODEX_CONFIG = 'model = "gpt-5.5"\n';

function heldLineFor(lock: string): string {
  return `another docks-kit sync holds ${lock}; run sync again after it ends`;
}

/** Run `body` with a folder outside HOME, as a folder of another home; remove it after. */
async function withSharedFolder(body: (folder: string) => Promise<void>): Promise<void> {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "sync-shared-")));
  try {
    await body(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Hold the lock inside `folder`, as a sync of another home that shares the
 * folder does. As in a sync, the lock does not change the folder mode.
 */
async function holdingFolderLock(
  folder: string,
  body: (lock: string) => Promise<void>,
): Promise<void> {
  const lock = join(folder, FOLDER_LOCK);
  const held = await acquireKitLock(lock, { waitMs: 0, privateDirectory: false });
  if (held.kind !== "acquired") throw new Error(`expected a free lock at ${lock}`);
  try {
    await body(lock);
  } finally {
    releaseKitLock(held.lock);
  }
}

describe("sync under the sync lock", () => {
  it("exits 1 with the held line and leaves HOME unchanged while another sync holds the lock", async () => {
    await withHome(async (home) => {
      mkdirSync(p(home, ".claude"), { recursive: true });
      writeFileSync(p(home, ".claude", "settings.json"), '{"model":"sonnet"}\n');

      await holdingLock(home, async () => {
        const before = snapshot(home);
        const records: Array<string> = [];

        expect(await runEngineNative(["sync", "claude"], recordingServices(records))).toBe(1);

        expect(records).toContain(heldLine(home));
        expect(snapshot(home)).toEqual(before);
      });
    });
  });

  it("does not read the harness selection while another sync holds the lock", async () => {
    await withHome(async (home) => {
      // The selection read of a sync with no target would import this file into
      // kit.db and rename it to state.json.migrated.
      mkdirSync(p(home, ".docks-kit"), { recursive: true });
      writeFileSync(
        p(home, ".docks-kit", "state.json"),
        `${JSON.stringify({ version: 1, harnesses: ["claude"] })}\n`,
      );

      await holdingLock(home, async () => {
        const before = snapshot(home);
        const records: Array<string> = [];

        expect(await runEngineNative(["sync"], recordingServices(records))).toBe(1);

        expect(records).toContain(heldLine(home));
        expect(snapshot(home)).toEqual(before);
      });
    });
  });

  it("takes no lock in a dry run", async () => {
    await withHome(async (home) => {
      await holdingLock(home, async () => {
        const records: Array<string> = [];

        expect(
          await runEngineNative(["sync", "claude", "--dry-run"], recordingServices(records)),
        ).toBe(0);

        expect(records).not.toContain(heldLine(home));
      });
    });
  });

  it("takes no lock when the DRY_RUN env global is 1", async () => {
    await withHome(async (home) => {
      process.env["DRY_RUN"] = "1";

      await holdingLock(home, async () => {
        const records: Array<string> = [];

        // Only the raw channel reads the env globals.
        expect(
          await runEngineNative(["sync", "claude"], recordingServices(records), {
            envGlobals: true,
          }),
        ).toBe(0);

        expect(records).not.toContain(heldLine(home));
      });
    });
  });

  it("waits for the lock when the DRY_RUN env global is 1 but the run reads no env globals", async () => {
    await withHome(async (home) => {
      process.env["DRY_RUN"] = "1";
      mkdirSync(p(home, ".claude"), { recursive: true });
      writeFileSync(p(home, ".claude", "settings.json"), '{"model":"sonnet"}\n');

      await holdingLock(home, async () => {
        const before = snapshot(home);
        const records: Array<string> = [];

        // The public CLI ignores DRY_RUN, so this run writes and must wait.
        expect(await runEngineNative(["sync", "claude"], recordingServices(records))).toBe(1);

        expect(records).toContain(heldLine(home));
        expect(snapshot(home)).toEqual(before);
      });
    });
  });

  it("prints the help with -h and --help while another sync holds the lock", async () => {
    await withHome(async (home) => {
      await holdingLock(home, async () => {
        for (const flag of ["-h", "--help"]) {
          const records: Array<string> = [];

          expect(await runEngineNative(["sync", flag], recordingServices(records))).toBe(0);

          expect(records).not.toContain(heldLine(home));
        }
      });
    });
  });

  it("releases the lock when the run stops with an ExitError", async () => {
    await withHome(async (home) => {
      process.env["DOCKS_KIT_SYNC_CONCURRENCY"] = "7";
      const failed: Array<string> = [];

      expect(await runEngineNative(["sync", "claude"], recordingServices(failed))).toBe(2);

      expect(failed).toContain(CONCURRENCY_ERROR);
      expect(await probe(home)).toBe("acquired");

      // The same run takes the lock before the check that throws the ExitError.
      await holdingLock(home, async () => {
        const blocked: Array<string> = [];

        expect(await runEngineNative(["sync", "claude"], recordingServices(blocked))).toBe(1);

        expect(blocked).toContain(heldLine(home));
        expect(blocked).not.toContain(CONCURRENCY_ERROR);
      });
    });
  });

  it("exits 2 when the lock wait is not a non-negative safe integer", async () => {
    await withHome(async (home) => {
      mkdirSync(p(home, ".claude"), { recursive: true });
      writeFileSync(p(home, ".claude", "settings.json"), '{"model":"sonnet"}\n');
      // `Number` makes the first value Infinity and rounds the second.
      for (const waitMs of ["9".repeat(400), String(Number.MAX_SAFE_INTEGER + 1)]) {
        process.env["DOCKS_KIT_SYNC_LOCK_WAIT_MS"] = waitMs;
        const records: Array<string> = [];

        expect(
          await runEngineNative(["model", "claude", "default"], recordingServices(records)),
        ).toBe(2);

        expect(records).toContain(WAIT_ERROR);
        expect(readFileSync(p(home, ".claude", "settings.json"), "utf8")).toBe(
          '{"model":"sonnet"}\n',
        );
      }
    });
  });
});

describe("model under the sync lock", () => {
  it("exits 1 with the held line and leaves HOME unchanged while another sync holds the lock", async () => {
    await withHome(async (home) => {
      mkdirSync(p(home, ".claude"), { recursive: true });
      writeFileSync(p(home, ".claude", "settings.json"), '{"model":"sonnet"}\n');

      await holdingLock(home, async () => {
        const before = snapshot(home);
        const records: Array<string> = [];

        expect(
          await runEngineNative(["model", "claude", "default"], recordingServices(records)),
        ).toBe(1);

        expect(records).toContain(heldLine(home));
        expect(snapshot(home)).toEqual(before);
      });
    });
  });

  it("takes no lock with --dry-run", async () => {
    await withHome(async (home) => {
      mkdirSync(p(home, ".claude"), { recursive: true });
      writeFileSync(p(home, ".claude", "settings.json"), '{"model":"sonnet"}\n');

      await holdingLock(home, async () => {
        const records: Array<string> = [];

        expect(
          await runEngineNative(
            ["model", "claude", "default", "--dry-run"],
            recordingServices(records),
          ),
        ).toBe(0);

        expect(records).not.toContain(heldLine(home));
        expect(readFileSync(p(home, ".claude", "settings.json"), "utf8")).toBe(
          '{"model":"sonnet"}\n',
        );
      });
    });
  });

  it("takes no lock when the DRY_RUN env global is 1", async () => {
    await withHome(async (home) => {
      process.env["DRY_RUN"] = "1";
      mkdirSync(p(home, ".claude"), { recursive: true });
      writeFileSync(p(home, ".claude", "settings.json"), '{"model":"sonnet"}\n');

      await holdingLock(home, async () => {
        const records: Array<string> = [];

        // Only the raw channel reads the env globals.
        expect(
          await runEngineNative(["model", "claude", "default"], recordingServices(records), {
            envGlobals: true,
          }),
        ).toBe(0);

        expect(records).not.toContain(heldLine(home));
        expect(readFileSync(p(home, ".claude", "settings.json"), "utf8")).toBe(
          '{"model":"sonnet"}\n',
        );
      });
    });
  });
});

describe("folder locks of a shared Codex or agents folder", () => {
  it("makes a sync of another home wait while a sync holds the shared Codex folder", async () => {
    await withHome(async (home) => {
      await withSharedFolder(async (shared) => {
        process.env["CODEX_HOME"] = shared;
        writeFileSync(join(shared, "config.toml"), CODEX_CONFIG);

        await holdingFolderLock(shared, async (lock) => {
          const before = snapshot(shared);
          const records: Array<string> = [];

          expect(await runEngineNative(["sync", "codex"], recordingServices(records))).toBe(1);

          expect(records).toContain(heldLineFor(lock));
          expect(snapshot(shared)).toEqual(before);
        });
        expect(await probe(home)).toBe("acquired");
      });
    });
  });

  it("makes a sync of another home wait while a sync holds the shared agents folder", async () => {
    await withHome(async (home) => {
      await withSharedFolder(async (shared) => {
        process.env["AGENTS_DIR"] = shared;

        await holdingFolderLock(shared, async (lock) => {
          const before = snapshot(shared);
          const records: Array<string> = [];

          // `AGENTS_DIR` is an env global, which only the raw channel reads.
          expect(
            await runEngineNative(["sync", "agents"], recordingServices(records), {
              envGlobals: true,
            }),
          ).toBe(1);

          expect(records).toContain(heldLineFor(lock));
          expect(snapshot(shared)).toEqual(before);
        });
        expect(await probe(home)).toBe("acquired");
      });
    });
  });

  it("makes a model codex write wait while a sync holds the Codex folder", async () => {
    await withHome(async (home) => {
      await withSharedFolder(async (shared) => {
        process.env["CODEX_HOME"] = shared;
        writeFileSync(join(shared, "config.toml"), CODEX_CONFIG);

        await holdingFolderLock(shared, async (lock) => {
          const records: Array<string> = [];

          expect(
            await runEngineNative(["model", "codex", "gpt-5.4"], recordingServices(records)),
          ).toBe(1);

          expect(records).toContain(heldLineFor(lock));
          expect(readFileSync(join(shared, "config.toml"), "utf8")).toBe(CODEX_CONFIG);
        });
        expect(await probe(home)).toBe("acquired");
      });
    });
  });

  it("takes no folder lock in a dry run", async () => {
    await withHome(async () => {
      await withSharedFolder(async (shared) => {
        process.env["CODEX_HOME"] = shared;
        process.env["AGENTS_DIR"] = shared;

        await holdingFolderLock(shared, async (lock) => {
          const records: Array<string> = [];

          await runEngineNative(
            ["sync", "codex", "agents", "--dry-run"],
            recordingServices(records),
            { envGlobals: true },
          );

          expect(records).not.toContain(heldLineFor(lock));
        });
      });
    });
  });

  it("takes one lock per real folder, in the sorted order of the lock paths", async () => {
    await withSharedFolder(async (base) => {
      const first = join(base, "a");
      const second = join(base, "b");
      const link = join(base, "link-to-a");
      mkdirSync(first);
      mkdirSync(second);
      symlinkSync(first, link, "junction");

      expect(folderLockPaths([second, link, first])).toEqual([
        join(first, FOLDER_LOCK),
        join(second, FOLDER_LOCK),
      ]);
    });
  });
});

describe("folder locks of a shared omp folder", () => {
  it("makes a sync of another home wait while a sync holds the shared omp agent folder", async () => {
    await withHome(async (home) => {
      await withSharedFolder(async (shared) => {
        process.env["PI_CODING_AGENT_DIR"] = shared;

        await holdingFolderLock(shared, async (lock) => {
          const before = snapshot(shared);
          const records: Array<string> = [];

          expect(await runEngineNative(["sync", "omp"], recordingServices(records))).toBe(1);

          expect(records).toContain(heldLineFor(lock));
          expect(snapshot(shared)).toEqual(before);
        });
        expect(await probe(home)).toBe("acquired");
      });
    });
  });

  it("creates no intercom folder in a held omp agent folder and keeps its mode", async () => {
    await withHome(async () => {
      await withSharedFolder(async (shared) => {
        // A mode other than 0700, so that a chmod to 0700 shows.
        chmodSync(shared, 0o755);
        process.env["PI_CODING_AGENT_DIR"] = shared;

        await holdingFolderLock(shared, async (lock) => {
          const mode = statSync(shared).mode;
          const records: Array<string> = [];

          expect(await runEngineNative(["sync", "omp"], recordingServices(records))).toBe(1);

          expect(records).toContain(heldLineFor(lock));
          expect(existsSync(join(shared, "intercom"))).toBe(false);
          expect(statSync(shared).mode).toBe(mode);
        });
      });
    });
  });

  it("makes a sync of another home wait while a sync holds the shared omp intercom folder", async () => {
    await withHome(async (home) => {
      await withSharedFolder(async (shared) => {
        // The intercom root `~/.pi/agent` links to a folder that another home
        // also uses. The omp agent folder stays `~/.omp/agent` in the home.
        const intercom = join(shared, "intercom");
        mkdirSync(intercom);
        chmodSync(intercom, 0o755);
        mkdirSync(p(home, ".pi"));
        symlinkSync(shared, p(home, ".pi", "agent"), "junction");

        await holdingFolderLock(intercom, async (lock) => {
          const mode = statSync(intercom).mode;
          const records: Array<string> = [];

          expect(await runEngineNative(["sync", "omp"], recordingServices(records))).toBe(1);

          expect(records).toContain(heldLineFor(lock));
          expect(existsSync(join(intercom, "config.json"))).toBe(false);
          expect(statSync(intercom).mode).toBe(mode);
        });
        expect(await probe(home)).toBe("acquired");
      });
    });
  });

  // omp reads XDG_DATA_HOME only on Linux and macOS.
  it.skipIf(process.platform === "win32")(
    "makes a sync of another home wait while a sync holds the shared omp data root",
    async () => {
      await withHome(async (home) => {
        await withSharedFolder(async (shared) => {
          // omp uses `$XDG_DATA_HOME/omp` as its data root only when it exists.
          const dataRoot = join(shared, "omp");
          mkdirSync(dataRoot);
          process.env["XDG_DATA_HOME"] = shared;

          await holdingFolderLock(dataRoot, async (lock) => {
            const before = snapshot(shared);
            const records: Array<string> = [];

            expect(await runEngineNative(["sync", "omp"], recordingServices(records))).toBe(1);

            expect(records).toContain(heldLineFor(lock));
            expect(snapshot(shared)).toEqual(before);
          });
          expect(await probe(home)).toBe("acquired");
        });
      });
    },
  );

  it("makes syncs of two homes meet at a missing omp data root that PI_CONFIG_DIR puts outside both homes", async () => {
    await withHome(async (firstHome) => {
      await withSharedFolder(async (shared) => {
        // Both homes and `shared` are in the same temporary folder, so one
        // PI_CONFIG_DIR value points both homes at `shared/root`.
        const configDir = join("..", basename(shared), "root");
        const dataRoot = join(shared, "root");
        process.env["PI_CONFIG_DIR"] = configDir;

        // The first sync creates the missing data root and takes its lock.
        await runEngineNative(["sync", "omp"], recordingServices([]));
        expect(existsSync(join(dataRoot, FOLDER_LOCK))).toBe(true);

        await withHome(async (secondHome) => {
          process.env["PI_CONFIG_DIR"] = configDir;

          await holdingFolderLock(dataRoot, async (lock) => {
            const records: Array<string> = [];

            expect(await runEngineNative(["sync", "omp"], recordingServices(records))).toBe(1);

            expect(records).toContain(heldLineFor(lock));
          });
          expect(await probe(secondHome)).toBe("acquired");
        });
        expect(await probe(firstHome)).toBe("acquired");
      });
    });
  });

  it("takes no omp folder lock in a dry run", async () => {
    await withHome(async () => {
      await withSharedFolder(async (shared) => {
        process.env["PI_CODING_AGENT_DIR"] = shared;

        await holdingFolderLock(shared, async (lock) => {
          const records: Array<string> = [];

          expect(
            await runEngineNative(["sync", "omp", "--dry-run"], recordingServices(records)),
          ).toBe(0);

          expect(records).not.toContain(heldLineFor(lock));
        });
      });
    });
  });
});

describe("omp children of a sync", () => {
  // omp reads XDG_DATA_HOME only on Linux and macOS.
  for (const profile of [undefined, "work"]) {
    it.skipIf(process.platform === "win32")(
      `keeps each omp child on the locked config root when the XDG candidate appears after the locks (${profile ?? "default"} profile)`,
      async () => {
        await withHome(async (home) => {
          await withSharedFolder(async (shared) => {
            process.env["XDG_DATA_HOME"] = shared;
            if (profile !== undefined) process.env["OMP_PROFILE"] = profile;
            const configRoot =
              profile === undefined ? p(home, ".omp") : p(home, ".omp", "profiles", profile);
            // omp adopts this candidate as its data root once it exists.
            const candidate =
              profile === undefined
                ? join(shared, "omp")
                : join(shared, "omp", "profiles", profile);
            spawned.omp = [];

            try {
              // Another sync, for example one whose PI_CONFIG_DIR is the XDG
              // candidate, creates it after this sync chose its locks.
              const records: Array<string> = [];
              const services = ompServices(records, () =>
                mkdirSync(candidate, { recursive: true }),
              );

              expect(await runEngineNative(["sync", "omp"], services)).toBe(0);

              expect(existsSync(join(configRoot, FOLDER_LOCK))).toBe(true);
              expect(spawned.omp.length).toBeGreaterThan(0);
              for (const { args, env } of spawned.omp) {
                const childRoot = ompPaths({
                  home,
                  env: env ?? process.env,
                  platform: process.platform,
                }).dataRoot;
                expect({ args, childRoot }).toEqual({ args, childRoot: configRoot });
              }
              // The kit wrote nothing into the unlocked candidate.
              expect(readdirSync(candidate)).toEqual([]);
            } finally {
              spawned.omp = undefined;
            }
          });
        });
      },
    );
  }
});
