/**
 * The extension suites' harness, ported from the helpers of DocksDocks/docks
 * `scripts/tests/unit/verify-gate.test.mjs` and `context-tree-nudge.test.mjs`.
 *
 * The suites load an omp extension adapter of the kit plugin by its path, run
 * its factory with a fake `pi` that records each handler, and drive that
 * handler with omp events. The adapters do not import @oh-my-pi packages, so
 * they load outside omp.
 */
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

/** A new folder below the temporary folder, with symbolic links resolved, removed after the case. */
export function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The git file that the PATH of the test process names first. */
export function realGit(): string | undefined {
  return (process.env["PATH"] ?? "")
    .split(path.delimiter)
    .map((dir) => path.join(dir, "git"))
    .find((file) => fs.existsSync(file));
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
