/// <reference types="bun" />

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { BUNDLE_PATH } from "./build-bundle";

const REPO_DIR = resolve(import.meta.dirname, "..", "..");
const PACKED_BUNDLE = `package/${BUNDLE_PATH}`;
const PACKED_STRAY_OUTPUT = /^package\/cli\/src\/.*\.js(\.map)?$/;
const START_TIME_RUNS = 10;
// Measured on Linux x64 with Bun 1.4.4: 66 ms for the bundle against 168 ms
// for the TypeScript source, so half the source keeps a wide margin.
const START_TIME_MAX_RATIO = 0.5;
const UNRELATED_FOLDER_COMMANDS: ReadonlyArray<ReadonlyArray<string>> = [
  ["--version"],
  ["--help"],
  ["sync", "--dry-run"],
];
const RECOVERY_COMMAND = "bun rm -g docks-kit && bun add -g docks-kit@latest";
const IGNORED_NODE_MODULES_ENTRIES: Record<string, true> = { ".bin": true, ".cache": true };
const TRUTHY_FLAG_VALUES: Record<string, true> = { "1": true, true: true, yes: true };
const KEEP_WORK_DIR =
  TRUTHY_FLAG_VALUES[(process.env.DOCKS_KIT_KEEP_SMOKE_DIR ?? "").toLowerCase()] === true;

// An ambient BUN_OPTIONS, DOCKS_KIT_ENGINE or NODE_OPTIONS diverts the
// installed CLI, so a local override would look like a broken package.
const CHILD_ENV: NodeJS.ProcessEnv = { ...process.env };
delete CHILD_ENV.BUN_OPTIONS;
delete CHILD_ENV.DOCKS_KIT_ENGINE;
delete CHILD_ENV.NODE_OPTIONS;

interface Manifest {
  readonly version: string;
  readonly dependencies?: Record<string, string>;
}

interface Pin {
  readonly name: string;
  readonly range: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function requireSuccess(label: string, result: SpawnSyncReturns<string>): void {
  if (result.error) {
    fail(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const status = result.signal ? `signal ${result.signal}` : `exit ${result.status ?? "unknown"}`;
    fail(`${label} failed with ${status}${output ? `:\n${output}` : ""}`);
  }
}

function readManifest(path: string, label: string): Manifest {
  if (!existsSync(path)) {
    fail(`${label} is missing at ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function displayPath(consumerDir: string, path: string): string {
  return relative(consumerDir, path).split(sep).join("/");
}

// A caller that already holds a proved tarball supplies it, so the smoke
// installs those exact bytes instead of repacking the working tree. Only an
// unsupplied run packs, which is what a local check and the parity lane want.
function resolveTarball(workDir: string, version: string): string {
  const expectedName = `docks-kit-${version}.tgz`;
  const supplied = process.argv[2] ?? process.env.DOCKS_KIT_SMOKE_TARBALL;
  if (supplied) {
    const suppliedPath = resolve(supplied);
    if (!existsSync(suppliedPath)) {
      fail(
        `assertion "the supplied tarball exists" failed: observed no file at ${suppliedPath}. ` +
          `Repair: pass the path of a packed ${expectedName}, or pass nothing so the smoke packs the working tree.`,
      );
    }
    if (basename(suppliedPath) !== expectedName) {
      fail(
        `assertion "the supplied tarball carries the root version" failed: observed ${basename(suppliedPath)}, ` +
          `expected ${expectedName}. Repair: pass the tarball packed from this tree, or align the root package.json ` +
          `version with the tarball you want to smoke.`,
      );
    }
    console.log(`[package-smoke] tarball: ${suppliedPath} (supplied, not repacked)`);
    return suppliedPath;
  }

  const pack = spawnSync("bun", ["pm", "pack", "--destination", workDir], {
    cwd: REPO_DIR,
    encoding: "utf8",
    env: CHILD_ENV,
  });
  requireSuccess("bun pm pack", pack);
  const packedPath = join(workDir, expectedName);
  if (!existsSync(packedPath)) {
    fail(
      `assertion "bun pm pack produced the versioned tarball" failed: observed no file at ${packedPath}. ` +
        `Repair: run "bun pm pack --destination <dir>" from the repository root and check the prepack gate.`,
    );
  }
  console.log(`[package-smoke] tarball: ${expectedName} (packed from the working tree)`);
  return packedPath;
}

// The consumer project carries no lockfile, so the registry resolves the
// tarball's declared ranges exactly as a global install does. That is the only
// way to catch a caret over a prerelease pulling in a mismatched transitive.
function installConsumer(workDir: string, tarball: string): string {
  const consumerDir = join(workDir, "consumer");
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify({ name: "docks-kit-package-smoke", version: "0.0.0", private: true }, null, 2)}\n`,
  );
  const install = spawnSync("bun", ["add", tarball], {
    cwd: consumerDir,
    encoding: "utf8",
    env: CHILD_ENV,
  });
  requireSuccess("consumer bun add", install);
  return consumerDir;
}

// The walk is recursive because a duplicate one level deeper defeats the root
// pin exactly the same way as a duplicate directly under a top level package.
// One level of `@scope` directories is expanded at every depth, because a
// scoped package sits one directory deeper than an unscoped one and would
// otherwise be scanned as if the scope itself were the package.
function installedPackageDirs(nodeModulesDir: string): ReadonlyArray<string> {
  const level: Array<{ readonly path: string; readonly linked: boolean }> = [];
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (Object.hasOwn(IGNORED_NODE_MODULES_ENTRIES, entry.name)) {
      continue;
    }
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const entryPath = join(nodeModulesDir, entry.name);
    if (!entry.name.startsWith("@")) {
      level.push({ path: entryPath, linked: entry.isSymbolicLink() });
      continue;
    }
    const scopeLinked = entry.isSymbolicLink();
    for (const scoped of readdirSync(entryPath, { withFileTypes: true })) {
      if (!scoped.isDirectory() && !scoped.isSymbolicLink()) {
        continue;
      }
      level.push({
        path: join(entryPath, scoped.name),
        linked: scopeLinked || scoped.isSymbolicLink(),
      });
    }
  }

  const dirs: Array<string> = [];
  for (const packageDir of level) {
    dirs.push(packageDir.path);
    // A linked package is listed but never descended into, because a link
    // pointing back at an ancestor would make the walk cycle.
    if (packageDir.linked) {
      continue;
    }
    const nestedDir = join(packageDir.path, "node_modules");
    if (existsSync(nestedDir)) {
      dirs.push(...installedPackageDirs(nestedDir));
    }
  }
  return dirs;
}

function assertPinnedVersions(consumerDir: string, pins: ReadonlyArray<Pin>): void {
  for (const pin of pins) {
    const installedPath = join(consumerDir, "node_modules", pin.name, "package.json");
    if (!existsSync(installedPath)) {
      fail(
        `assertion "${pin.name} is installed" failed: observed no package at ${displayPath(consumerDir, installedPath)}. ` +
          `Repair: declare "${pin.name}": "${pin.range}" in the root package.json dependencies and refresh bun.lock.`,
      );
    }
    const installed = readManifest(installedPath, `installed ${pin.name} package.json`);
    if (installed.version !== pin.range) {
      fail(
        `assertion "${pin.name} matches the root pin" failed: observed ${installed.version}, expected ${pin.range}. ` +
          `Repair: pin "${pin.name}": "${pin.range}" in the root package.json dependencies so a fresh resolution cannot ` +
          `drift away from the pinned set.`,
      );
    }
    console.log(`[package-smoke] ${pin.name}: ${installed.version} (root pin ${pin.range})`);
  }
}

// A nested copy is the shape the caret-over-prerelease bug takes: the pinned
// version stays hoisted while a dependent keeps its own newer copy, so the two
// halves of the same release load side by side.
function assertNoNestedDuplicates(consumerDir: string, pins: ReadonlyArray<Pin>): void {
  const nodeModulesDir = join(consumerDir, "node_modules");
  const packageDirs = installedPackageDirs(nodeModulesDir);
  for (const packageDir of packageDirs) {
    for (const pin of pins) {
      const nestedPath = join(packageDir, "node_modules", pin.name);
      if (!existsSync(nestedPath)) {
        continue;
      }
      const nested = readManifest(
        join(nestedPath, "package.json"),
        `nested ${pin.name} package.json`,
      );
      fail(
        `assertion "no nested ${pin.name} duplicate" failed: observed ${nested.version} at ` +
          `${displayPath(consumerDir, nestedPath)}, expected the hoisted ${pin.range} to be the only copy. ` +
          `Repair: keep "${pin.name}": "${pin.range}" pinned in the root package.json dependencies so every dependent ` +
          `dedupes to it, then rebuild a broken install from scratch with "${RECOVERY_COMMAND}".`,
      );
    }
  }
  console.log(
    `[package-smoke] nested duplicates: none of ${pins.length} pinned names under ${packageDirs.length} installed ` +
      `packages at any depth`,
  );
}

// `bun pm pack` ships a file that git ignores, so the tarball itself must show
// the bundle and no build output that a misplaced build left under cli/src.
function assertTarballContents(tarball: string): void {
  const list = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8", env: CHILD_ENV });
  requireSuccess("tar -tzf", list);
  // A tar that lists directories ends their entries with "/"; only files count.
  const entries = list.stdout
    .split("\n")
    .filter((entry) => entry.length > 0 && !entry.endsWith("/"));
  if (!entries.includes(PACKED_BUNDLE)) {
    fail(
      `assertion "the tarball ships the bundle" failed: observed no ${PACKED_BUNDLE} among ${entries.length} entries. ` +
        `Repair: keep "${BUNDLE_PATH}" in package.json files and "bun run build:bundle" in prepack.`,
    );
  }
  const extraDist = entries.filter(
    (entry) => entry.startsWith("package/cli/dist/") && entry !== PACKED_BUNDLE,
  );
  const strays = entries.filter((entry) => PACKED_STRAY_OUTPUT.test(entry));
  const maps = entries.filter((entry) => entry.endsWith(".map"));
  const unwanted = [...new Set([...extraDist, ...strays, ...maps])];
  if (unwanted.length > 0) {
    fail(
      `assertion "the tarball holds no map, no other cli/dist file, and no .js under cli/src" failed: observed ` +
        `${unwanted.join(", ")}. Repair: list only "${BUNDLE_PATH}" from cli/dist in package.json files, and delete ` +
        `the build outputs under cli/src.`,
    );
  }
  console.log(
    `[package-smoke] tarball contents: ${entries.length} files, ${BUNDLE_PATH} present, no .map, ` +
      `no other cli/dist file, no .js or .js.map under cli/src`,
  );
}

function assertBinTarget(consumerDir: string): string {
  const binaryPath = join(consumerDir, "node_modules", ".bin", "docks-kit");
  if (!existsSync(binaryPath)) {
    fail(
      `assertion "installed binary exists" failed: observed no executable at ${displayPath(consumerDir, binaryPath)}. ` +
        `Repair: keep the "docks-kit" bin entry in the root package.json and keep ${BUNDLE_PATH} in its files.`,
    );
  }
  const packageDir = realpathSync(join(consumerDir, "node_modules", "docks-kit"));
  const target = relative(packageDir, realpathSync(binaryPath)).split(sep).join("/");
  if (target !== BUNDLE_PATH) {
    fail(
      `assertion "the installed bin runs the bundle" failed: observed ${target}, expected ${BUNDLE_PATH}. ` +
        `Repair: point package.json bin.docks-kit at ${BUNDLE_PATH}.`,
    );
  }
  console.log(`[package-smoke] bin target: ${target}`);
  return binaryPath;
}

// An unrelated folder proves that the bundle finds its package root from its
// own location, not from the working directory.
function assertUnrelatedFolderRuns(workDir: string, binaryPath: string, expected: string): void {
  const unrelatedDir = join(workDir, "unrelated");
  mkdirSync(unrelatedDir, { recursive: true });
  for (const args of UNRELATED_FOLDER_COMMANDS) {
    const label = `docks-kit ${args.join(" ")}`;
    const run = spawnSync(binaryPath, args, {
      cwd: unrelatedDir,
      encoding: "utf8",
      env: CHILD_ENV,
    });
    requireSuccess(`installed ${label} from an unrelated folder`, run);
    if (args[0] === "--version" && run.stdout.trim() !== expected) {
      fail(
        `assertion "installed binary reports the packaged version" failed: observed ` +
          `${JSON.stringify(run.stdout.trim())}, expected ${expected}. Repair: rebuild the tarball from a clean tree ` +
          `so the packed bundle matches the root package.json version.`,
      );
    }
    console.log(`[package-smoke] ${label} (from an unrelated folder): exit ${run.status}`);
  }
}

function median(samples: ReadonlyArray<number>): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function timedRun(
  label: string,
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
): number {
  const start = performance.now();
  const run = spawnSync(command, args, { cwd, encoding: "utf8", env: CHILD_ENV });
  const elapsed = performance.now() - start;
  requireSuccess(label, run);
  return elapsed;
}

// The runs alternate, so a slow phase of the host affects both forms alike.
function assertStartTime(consumerDir: string, binaryPath: string): void {
  const sourceEntry = join(consumerDir, "node_modules", "docks-kit", "cli", "src", "main.ts");
  const bundleSamples: Array<number> = [];
  const sourceSamples: Array<number> = [];
  for (let run = 0; run < START_TIME_RUNS; run++) {
    bundleSamples.push(timedRun("installed bin --version", binaryPath, ["--version"], consumerDir));
    sourceSamples.push(
      timedRun(
        "installed cli/src/main.ts --version",
        process.execPath,
        [sourceEntry, "--version"],
        consumerDir,
      ),
    );
  }
  const bundleMedian = median(bundleSamples);
  const sourceMedian = median(sourceSamples);
  const limit = sourceMedian * START_TIME_MAX_RATIO;
  console.log(
    `[package-smoke] start time, median of ${START_TIME_RUNS} --version runs: bundle ${bundleMedian.toFixed(1)} ms, ` +
      `source ${sourceMedian.toFixed(1)} ms (limit ${limit.toFixed(1)} ms)`,
  );
  if (bundleMedian > limit) {
    fail(
      `assertion "the bundle starts in at most half the time of the source" failed: observed ` +
        `${bundleMedian.toFixed(1)} ms against ${sourceMedian.toFixed(1)} ms. Repair: check that bin runs ` +
        `${BUNDLE_PATH} and that the build still bundles the dependencies.`,
    );
  }
}

function smoke(workDir: string, manifest: Manifest, pins: ReadonlyArray<Pin>): void {
  const tarball = resolveTarball(workDir, manifest.version);
  const consumerDir = installConsumer(workDir, tarball);
  console.log(`[package-smoke] consumer install: ${consumerDir}`);

  assertPinnedVersions(consumerDir, pins);
  assertNoNestedDuplicates(consumerDir, pins);
  const binaryPath = assertBinTarget(consumerDir);
  assertTarballContents(tarball);
  assertUnrelatedFolderRuns(workDir, binaryPath, manifest.version);
  assertStartTime(consumerDir, binaryPath);
}

function main(): void {
  if (process.platform === "win32") {
    fail(
      `the package smoke runs on POSIX hosts only: observed platform win32, where bun writes a different bin shim ` +
        `than node_modules/.bin/docks-kit. Repair: run "bun run smoke:package" on Linux or macOS.`,
    );
  }

  const manifest = readManifest(join(REPO_DIR, "package.json"), "repository package.json");
  const pins: ReadonlyArray<Pin> = Object.entries(manifest.dependencies ?? {}).map(
    ([name, range]) => ({
      name,
      range,
    }),
  );
  if (pins.length === 0) {
    fail(
      `assertion "root package.json declares dependencies" failed: observed an empty dependency set. ` +
        `Repair: declare the runtime dependencies with exact pins in the root package.json.`,
    );
  }
  console.log(
    `[package-smoke] root pins: ${pins.map((pin) => `${pin.name}@${pin.range}`).join(", ")}`,
  );

  // An exported but empty RUNNER_TEMP is not a directory: joining it would
  // build the clean-room tree relative to the current working directory.
  const runnerTemp = process.env.RUNNER_TEMP;
  const workRoot = runnerTemp !== undefined && runnerTemp.length > 0 ? runnerTemp : tmpdir();
  const workDir = mkdtempSync(join(workRoot, "docks-kit-package-smoke-"));
  try {
    smoke(workDir, manifest, pins);
  } finally {
    if (KEEP_WORK_DIR) {
      console.log(`[package-smoke] retained work directory: ${workDir}`);
    } else {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
  console.log("[package-smoke] clean-room consumer install passed");
}

try {
  main();
} catch (error) {
  console.error(`[package-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
