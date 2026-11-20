/**
 * The Effect services of `docks-kit plan`: child processes (gh and git), files, waits, and the repository that the
 * latest GitHub read named. The command entry provides `PlanServicesLive`; tests provide their own layers.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { Context, Duration, Effect, Layer, Predicate } from "effect";

import { FileError, SpawnError, type RepositoryInfo } from "./types";

// plan.mjs reads gh output up to this size; a larger output is a refusal, not a cut.
export const MAX_OUTPUT_MIB = 256;

export interface ProcessOptions {
  readonly cwd?: string;
  readonly input?: string | Uint8Array;
  /** `latin1` keeps each byte of the output as one character, for byte-exact path output. */
  readonly encoding?: "utf8" | "latin1";
  readonly env?: NodeJS.ProcessEnv;
  /** Pass the child's stderr through to this process, as a shell script does. */
  readonly inheritStderr?: boolean;
}

export interface ProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the child could not start or its output passed the limit. */
  readonly error: { readonly code: string | undefined; readonly message: string } | undefined;
}

/**
 * The text of `latin1` output (one character per byte) when its bytes are UTF-8, or undefined when they are not.
 * A path that is not UTF-8 cannot pass on a command line or to a Node path API as text without a lost byte.
 */
export const utf8Text = (bytes: string): string | undefined => {
  const text = Buffer.from(bytes, "latin1").toString("utf8");
  return Buffer.from(text, "utf8").toString("latin1") === bytes ? text : undefined;
};

/**
 * The character that Node puts in an argument or in `process.cwd()` in place of a byte that is not UTF-8. Such a
 * string names another file; a real U+FFFD in a name looks the same, so both fail closed.
 */
export const LOST_BYTE = "\uFFFD";

const errorCode = (error: unknown): string | undefined => {
  const code = Predicate.hasProperty(error, "code") ? error.code : undefined;
  return Predicate.isString(code) ? code : undefined;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Runs a child process with an argv and no shell, and waits for it. */
export class PlanProcess extends Context.Service<
  PlanProcess,
  {
    readonly run: (
      command: string,
      args: ReadonlyArray<string>,
      options?: ProcessOptions,
    ) => Effect.Effect<ProcessResult, SpawnError>;
  }
>()("docks-kit/plan/PlanProcess") {
  static readonly layer = Layer.effect(
    PlanProcess,
    Effect.sync(() => {
      const run = Effect.fn("PlanProcess.run")(function* (
        command: string,
        args: ReadonlyArray<string>,
        options: ProcessOptions = {},
      ) {
        const result = yield* Effect.try({
          try: () =>
            spawnSync(command, [...args], {
              encoding: options.encoding ?? "utf8",
              maxBuffer: MAX_OUTPUT_MIB * 1024 * 1024,
              cwd: options.cwd,
              input: options.input,
              env: options.env,
              stdio: ["pipe", "pipe", options.inheritStderr === true ? "inherit" : "pipe"],
            }),
          catch: (error) => new SpawnError({ message: errorMessage(error) }),
        });
        const processResult: ProcessResult = {
          status: result.status,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          error:
            result.error === undefined
              ? undefined
              : { code: errorCode(result.error), message: result.error.message },
        };
        return processResult;
      });
      return PlanProcess.of({ run });
    }),
  );
}

const fileOperation = <A>(operation: () => A): Effect.Effect<A, FileError> =>
  Effect.try({
    try: operation,
    catch: (error) => new FileError({ message: errorMessage(error), code: errorCode(error) }),
  });

/** What a path of a checkout holds on disk, as the `test` operators of a shell script see it. */
export type CheckoutEntry =
  | { readonly kind: "link"; readonly target: string }
  | { readonly kind: "file"; readonly executable: boolean }
  | { readonly kind: "directory" }
  | { readonly kind: "special" }
  | { readonly kind: "missing" };

function checkoutEntry(path: Buffer): CheckoutEntry {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(path);
  } catch {
    return { kind: "missing" };
  }
  if (stats.isSymbolicLink())
    return {
      kind: "link",
      target: fs.readlinkSync(path, { encoding: "buffer" }).toString("latin1"),
    };
  if (stats.isFile()) {
    let executable = true;
    try {
      fs.accessSync(path, fs.constants.X_OK);
    } catch {
      executable = false;
    }
    return { kind: "file", executable };
  }
  return stats.isDirectory() ? { kind: "directory" } : { kind: "special" };
}

/** File access. A failure carries the Node error message and code. */
export class PlanFiles extends Context.Service<
  PlanFiles,
  {
    /**
     * What the path holds on disk; the bytes of a link target are latin1 characters. Only a failed link read fails.
     */
    readonly entry: (path: Buffer) => Effect.Effect<CheckoutEntry, FileError>;
    /** Create the directory and its parents, and set its mode to 0700. */
    readonly ensurePrivateDirectory: (path: string) => Effect.Effect<void, FileError>;
    /** Write a UTF-8 file; `mode` applies when the write creates it. */
    readonly writeFile: (
      path: string,
      data: string,
      mode?: number,
    ) => Effect.Effect<void, FileError>;
    readonly chmod: (path: string, mode: number) => Effect.Effect<void, FileError>;
    readonly readFile: (path: string) => Effect.Effect<string, FileError>;
    /** Create a new file that must not exist yet, write it, and close it. */
    readonly createExclusive: (
      path: string,
      data: string,
      mode: number,
    ) => Effect.Effect<void, FileError>;
    /** Remove a file; a missing file is no failure. */
    readonly remove: (path: string) => Effect.Effect<void, FileError>;
  }
>()("docks-kit/plan/PlanFiles") {
  static readonly layer = Layer.effect(
    PlanFiles,
    Effect.sync(() =>
      PlanFiles.of({
        entry: (path) => fileOperation(() => checkoutEntry(path)),
        ensurePrivateDirectory: (path) =>
          fileOperation(() => {
            fs.mkdirSync(path, { recursive: true, mode: 0o700 });
            fs.chmodSync(path, 0o700);
          }),
        writeFile: (path, data, mode) =>
          fileOperation(() =>
            fs.writeFileSync(path, data, mode === undefined ? "utf8" : { encoding: "utf8", mode }),
          ),
        chmod: (path, mode) => fileOperation(() => fs.chmodSync(path, mode)),
        readFile: (path) => fileOperation(() => fs.readFileSync(path, "utf8")),
        createExclusive: (path, data, mode) =>
          fileOperation(() => {
            const descriptor = fs.openSync(path, "wx", mode);
            try {
              fs.writeFileSync(descriptor, data, "utf8");
            } finally {
              fs.closeSync(descriptor);
            }
          }),
        remove: (path) => fileOperation(() => fs.rmSync(path, { force: true })),
      }),
    ),
  );
}

/**
 * The pauses of `reopen` and `archive`, on the Effect clock. With `PLAN_CLI_SKIP_WAITS=1` (a test hook), a pause
 * returns at once and appends its length in milliseconds and a newline to the file that `PLAN_CLI_WAIT_LOG` names.
 */
export class PlanWaits extends Context.Service<
  PlanWaits,
  { readonly sleep: (milliseconds: number) => Effect.Effect<void, FileError> }
>()("docks-kit/plan/PlanWaits") {
  static readonly layer = Layer.effect(
    PlanWaits,
    Effect.sync(() => {
      const sleep = Effect.fn("PlanWaits.sleep")(function* (milliseconds: number) {
        if (process.env["PLAN_CLI_SKIP_WAITS"] !== "1")
          return yield* Effect.sleep(Duration.millis(milliseconds));
        const log = process.env["PLAN_CLI_WAIT_LOG"];
        if (log) yield* fileOperation(() => fs.appendFileSync(log, `${milliseconds}\n`));
      });
      return PlanWaits.of({ sleep });
    }),
  );
}

/** The repository that the latest snapshot read named; one per command run. */
export class PlanRepository extends Context.Service<
  PlanRepository,
  { current: RepositoryInfo | undefined }
>()("docks-kit/plan/PlanRepository") {
  static readonly layer = Layer.effect(
    PlanRepository,
    Effect.sync(() => PlanRepository.of({ current: undefined })),
  );
}

export const PlanServicesLive = Layer.mergeAll(
  PlanProcess.layer,
  PlanFiles.layer,
  PlanWaits.layer,
  PlanRepository.layer,
);
