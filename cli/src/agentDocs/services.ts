/**
 * The services of `docks-kit agent-docs`: git and files. Each file method mirrors one `fs` call of the agent-doc
 * helper scripts with the same symlink handling; a call that the scripts treated as a test (`test -f`, `test -L`)
 * never fails. The command entry provides `AgentDocsServicesLive`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { Context, Effect, Layer, Predicate } from "effect";

import { FileError, SpawnError } from "../plan/types";

// Room for the listing of a very large repository; the default of 1 MiB would cut it off.
const OUTPUT_BUFFER = 256 * 1024 * 1024;

/** The end of one git run, as `spawnSync` reports it. */
export interface GitResult {
  readonly status: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when git could not start, or its output passed the limit. */
  readonly error: { readonly message: string } | undefined;
}

/** What `stat` sees at a path, through symlinks. */
export type StatKind = "file" | "directory" | "other";

/** What a folder listing sees for one entry, without following a symlink. */
export type EntryKind = "file" | "directory" | "symlink" | "other";

export interface FolderEntry {
  readonly name: string;
  readonly kind: EntryKind;
}

const errorCode = (error: unknown): string | undefined => {
  const code = Predicate.hasProperty(error, "code") ? error.code : undefined;
  return Predicate.isString(code) ? code : undefined;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The text that the scripts print for a failed call: `error.code ?? error.message`. */
export const errorDetail = (error: FileError): string => error.code ?? error.message;

const fileOperation = <A>(operation: () => A): Effect.Effect<A, FileError> =>
  Effect.try({
    try: operation,
    catch: (error) => new FileError({ message: errorMessage(error), code: errorCode(error) }),
  });

/** True when the call does not throw: `test -e`, `test -L`, and the like. */
const succeeds = (operation: () => unknown): boolean => {
  try {
    operation();
    return true;
  } catch {
    return false;
  }
};

function statKind(file: string): StatKind | undefined {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(file);
  } catch {
    return undefined;
  }
  if (stats.isFile()) return "file";
  return stats.isDirectory() ? "directory" : "other";
}

function entryKind(entry: fs.Dirent): EntryKind {
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isFile()) return "file";
  return entry.isDirectory() ? "directory" : "other";
}

function runGit(args: ReadonlyArray<string>, cwd: string | undefined): GitResult {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", maxBuffer: OUTPUT_BUFFER });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error === undefined ? undefined : { message: result.error.message },
  };
}

/** Runs git with an argv and no shell, and waits for it; the scripts' `spawnSync('git', ...)`. */
export class AgentDocsGit extends Context.Service<
  AgentDocsGit,
  {
    /**
     * Run git in `cwd`, or in the working folder; the output is UTF-8 text. Fails only when the runtime refuses the
     * arguments before git starts.
     */
    readonly run: (
      args: ReadonlyArray<string>,
      cwd?: string,
    ) => Effect.Effect<GitResult, SpawnError>;
  }
>()("docks-kit/agentDocs/AgentDocsGit") {
  static readonly layer = Layer.succeed(
    AgentDocsGit,
    AgentDocsGit.of({
      run: (args, cwd) =>
        Effect.try({
          try: () => runGit(args, cwd),
          catch: (error) => new SpawnError({ message: errorMessage(error) }),
        }),
    }),
  );
}

/** File access of the agent-doc checks. A failure carries the Node error message and code. */
export class AgentDocsFiles extends Context.Service<
  AgentDocsFiles,
  {
    /** `fs.statSync`, which follows symlinks; undefined when the call fails. */
    readonly stat: (file: string) => Effect.Effect<StatKind | undefined>;
    /** `test -L`: a failed lstat, for example below a file, means no symlink. */
    readonly isSymlink: (file: string) => Effect.Effect<boolean>;
    /** True when an entry is at `file`, a dangling symlink included (`test -e || test -L`). */
    readonly entryExists: (file: string) => Effect.Effect<boolean>;
    /** `fs.existsSync`, which follows symlinks. */
    readonly exists: (file: string) => Effect.Effect<boolean>;
    /** The entries of a folder, through a symlink too, in the order of the system. */
    readonly readFolder: (folder: string) => Effect.Effect<ReadonlyArray<FolderEntry>, FileError>;
    /** The text of a file; `latin1` gives one character per byte. */
    readonly readFile: (
      file: string,
      encoding: "utf8" | "latin1",
    ) => Effect.Effect<string, FileError>;
    readonly readLink: (file: string) => Effect.Effect<string, FileError>;
    /** `fs.realpathSync`. */
    readonly realPath: (file: string) => Effect.Effect<string, FileError>;
    /** `fs.realpathSync.native`, which resolves each part as the kernel does. */
    readonly realPathNative: (file: string) => Effect.Effect<string, FileError>;
    /** Fails unless `cd` may enter the folder (search permission). */
    readonly canSearch: (folder: string) => Effect.Effect<void, FileError>;
    /** The physical working folder, as `pwd -P` prints it. */
    readonly workingFolder: Effect.Effect<string>;
    readonly changeFolder: (folder: string) => Effect.Effect<void, FileError>;
    /** The `HOME` variable of the environment. */
    readonly home: Effect.Effect<string | undefined>;
  }
>()("docks-kit/agentDocs/AgentDocsFiles") {
  static readonly layer = Layer.effect(
    AgentDocsFiles,
    Effect.sync(() =>
      AgentDocsFiles.of({
        stat: (file) => Effect.sync(() => statKind(file)),
        isSymlink: (file) =>
          Effect.sync(() => {
            try {
              return fs.lstatSync(file).isSymbolicLink();
            } catch {
              return false;
            }
          }),
        entryExists: (file) => Effect.sync(() => succeeds(() => fs.lstatSync(file))),
        exists: (file) => Effect.sync(() => fs.existsSync(file)),
        readFolder: (folder) =>
          fileOperation(() =>
            fs
              .readdirSync(folder, { withFileTypes: true })
              .map((entry): FolderEntry => ({ name: entry.name, kind: entryKind(entry) })),
          ),
        // Node's readFileSync with an encoding decodes the bytes as Buffer#toString does.
        readFile: (file, encoding) => fileOperation(() => fs.readFileSync(file).toString(encoding)),
        readLink: (file) => fileOperation(() => fs.readlinkSync(file)),
        realPath: (file) => fileOperation(() => fs.realpathSync(file)),
        realPathNative: (file) => fileOperation(() => fs.realpathSync.native(file)),
        canSearch: (folder) => fileOperation(() => fs.accessSync(folder, fs.constants.X_OK)),
        workingFolder: Effect.sync(() => process.cwd()),
        changeFolder: (folder) => fileOperation(() => process.chdir(folder)),
        home: Effect.sync(() => process.env["HOME"]),
      }),
    ),
  );
}

export const AgentDocsServicesLive = Layer.mergeAll(AgentDocsGit.layer, AgentDocsFiles.layer);

/** Write text to stdout as is. */
export const writeStdout = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stdout.write(text);
  });

/** Write text to stderr as is. */
export const writeStderr = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(text);
  });

/** Print lines on stdout, each with its newline, or nothing for no lines. */
export const printLines = (lines: ReadonlyArray<string>): Effect.Effect<void> =>
  lines.length > 0 ? writeStdout(`${lines.join("\n")}\n`) : Effect.void;
