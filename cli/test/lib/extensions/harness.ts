/**
 * The extension suites' harness, ported from the helpers of DocksDocks/docks
 * `scripts/tests/unit/verify-gate.test.mjs` and `context-tree-nudge.test.mjs`.
 *
 * The suites load an omp extension adapter of the kit plugin by its path, run
 * its factory with a fake `pi` that records each handler, and drive that
 * handler with omp events. The adapters do not import @oh-my-pi packages, so
 * they load outside omp.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, onTestFinished } from "vitest";

/** The folder of the kit plugin's omp extensions. */
export const EXTENSIONS_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "SoT",
  ".omp",
  "plugin",
  "extensions",
);

/** One omp event handler, as the fake `pi` records it. */
export type Handler<Result> = (event: object, ctx: object) => Promise<Result>;

interface FakePi<Result> {
  on(name: string, handler: Handler<Result>): void;
}

type ExtensionFactory<Result> = (pi: FakePi<Result>) => unknown;

// The module boundary: an adapter's default export is the factory that omp calls with its `pi`.
const isFactory = <Result>(value: unknown): value is ExtensionFactory<Result> =>
  typeof value === "function";

/**
 * Run the factory of the extension at `file` with a fake `pi` that records
 * each handler, and return the one handler of `eventName`.
 */
export async function extensionHandler<Result>(
  file: string,
  eventName: string,
): Promise<Handler<Result>> {
  // A runtime path: the suite names the adapter, and this is the module load omp does for an extension entry.
  const extension: { readonly default?: unknown } = await import(file);
  const factory = extension.default;
  expect(typeof factory, "the extension must export a default factory").toBe("function");
  if (!isFactory<Result>(factory)) throw new Error(`${file} has no default factory`);
  const handlers = new Map<string, Array<Handler<Result>>>();
  await factory({
    on: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  });
  const list = handlers.get(eventName) ?? [];
  expect(list.length, `the extension must register one ${eventName} handler`).toBe(1);
  const [handler] = list;
  if (handler === undefined) throw new Error(`${file} registers no ${eventName} handler`);
  return handler;
}

/**
 * A new folder below the temporary folder, with symbolic links and Windows short names resolved,
 * removed after the case. git prints its folders in that form.
 */
export function tempDir(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const GIT_NAME = process.platform === "win32" ? "git.exe" : "git";

// One word for a POSIX shell, in single quotes.
const shellQuote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

// The git file that the PATH of the test process names first.
function realGit(): string {
  const file = (process.env["PATH"] ?? "")
    .split(path.delimiter)
    .map((dir) => path.join(dir, GIT_NAME))
    .find((candidate) => fs.existsSync(candidate));
  if (file === undefined) throw new Error(`no ${GIT_NAME} on PATH`);
  return file;
}

/**
 * The variables that put a stand-in for git first on PATH. The cores start git without a shell,
 * and Windows then runs only an executable, so the stand-in is the Node executable that `node` on
 * PATH names (the suites can run under Bun), placed in `<dir>/bin` under the name of git. On Windows
 * it is a hard link or a copy. Elsewhere it is a symbolic link, because a Node built with a shared
 * libnode (macOS) finds that library next to its real file only; if that link does not start, a
 * shell script that starts the real Node takes its place. `NODE_OPTIONS` makes that Node run
 * `script` as CommonJS before it would load a main module. The script sees `gitArgs`, the
 * arguments of the git call (Node takes the first one as its main module and resolves it to an
 * absolute path), and ends with `runGit()`, which runs the real git with those arguments and the
 * stdio of the call, and exits with its status.
 */
export function gitStub(dir: string, script: string): Readonly<Record<string, string>> {
  const node = execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const stub = path.join(bin, GIT_NAME);
  if (process.platform === "win32") {
    try {
      fs.linkSync(node, stub);
    } catch {
      // Another volume: a copy works where a hard link does not.
      fs.copyFileSync(node, stub);
    }
  } else {
    fs.symlinkSync(node, stub);
    if (spawnSync(stub, ["-e", "0"]).status !== 0) {
      fs.unlinkSync(stub);
      fs.writeFileSync(stub, `#!/bin/sh\nexec ${shellQuote(node)} "$@"\n`, { mode: 0o755 });
    }
  }
  const preload = path.join(dir, "git-stub.cjs");
  fs.writeFileSync(
    preload,
    [
      'const { spawnSync } = require("node:child_process");',
      'const path = require("node:path");',
      "const gitArgs = [path.basename(process.argv[1]), ...process.argv.slice(2)];",
      "const runGit = () => {",
      `  const result = spawnSync(${JSON.stringify(realGit())}, gitArgs, { stdio: "inherit" });`,
      "  process.exit(result.status ?? 1);",
      "};",
      script,
      "",
    ].join("\n"),
  );
  return {
    PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
    // A quoted value keeps a space in the path; Node reads a backslash in it as an escape, as JSON writes it.
    NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
  };
}

/**
 * Set the environment that omp gives the extension for one call, and put the
 * old values back after it. An undefined value removes the variable.
 */
export async function withEnv<T>(
  values: Readonly<Record<string, string | undefined>>,
  action: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]] as const),
  );
  const apply = (entries: Readonly<Record<string, string | undefined>>): void => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  try {
    return await action();
  } finally {
    apply(previous);
  }
}

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

/** Record each write to stdout and stderr and each console call while `action` runs. */
export async function captureOutput<T>(
  action: () => Promise<T>,
): Promise<{ readonly result: T; readonly printed: ReadonlyArray<string> }> {
  const printed: string[] = [];
  const streams = [process.stdout, process.stderr];
  const writes = streams.map((stream) => stream.write);
  const consoleOriginals = CONSOLE_METHODS.map((name) => console[name]);
  for (const stream of streams) {
    stream.write = (chunk: unknown, ...rest: ReadonlyArray<unknown>): boolean => {
      printed.push(String(chunk));
      const callback = rest.find((value) => typeof value === "function");
      callback?.();
      return true;
    };
  }
  for (const name of CONSOLE_METHODS) {
    console[name] = (...args: ReadonlyArray<unknown>): void => {
      printed.push(args.join(" "));
    };
  }
  try {
    return { result: await action(), printed };
  } finally {
    for (const [index, stream] of streams.entries()) {
      const write = writes[index];
      if (write !== undefined) stream.write = write;
    }
    for (const [index, name] of CONSOLE_METHODS.entries()) {
      const original = consoleOriginals[index];
      if (original !== undefined) console[name] = original;
    }
  }
}
