/// <reference types="bun" />

// Builds the npm package's entry: one minified JavaScript bundle of the CLI
// and its external source map in cli/dist. Identifiers stay unminified so a
// stack trace keeps its names; the closing `//# debugId=` line ties a trace to
// the map, which the release attaches instead of the package shipping it.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** The bundle path relative to the package root, as `bin` names it. */
export const BUNDLE_PATH = "cli/dist/docks-kit.js";

const REPO_DIR = resolve(import.meta.dirname, "..", "..");
const SHEBANG = "#!/usr/bin/env bun";
const DEBUG_ID_LINE = /^\/\/# debugId=[0-9A-Fa-f]+$/;
const SOURCE_MAPPING_URL_LINE = /^\/\/# sourceMappingURL=/m;
const STRAY_OUTPUT = /\.js(\.map)?$/;

// `--outfile` with a source map writes next to the entry in cli/src, so the
// build names its output through `--outdir` and `--entry-naming`.
const BUILD_ARGS: ReadonlyArray<string> = [
  "build",
  "cli/src/main.ts",
  "--target=bun",
  "--minify-whitespace",
  "--minify-syntax",
  "--sourcemap=external",
  "--outdir",
  "cli/dist",
  "--entry-naming",
  "docks-kit.js",
];

/** Every `.js` or `.js.map` file under `srcDir`, relative to it with `/`. The
 * source holds none, so each one is a misplaced build output that git ignores
 * and `bun pm pack` would ship. */
export function strayOutputs(srcDir: string): ReadonlyArray<string> {
  return readdirSync(srcDir, { recursive: true, encoding: "utf8" })
    .filter((entry) => STRAY_OUTPUT.test(entry) && statSync(join(srcDir, entry)).isFile())
    .map((entry) => entry.split(sep).join("/"))
    .sort();
}

/** The ways a bundle's text breaks the package contract; empty when it holds. */
export function bundleProblems(bundle: string): ReadonlyArray<string> {
  const lines = bundle.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const problems: Array<string> = [];
  if (lines[0] !== SHEBANG) problems.push(`the first line is not "${SHEBANG}"`);
  if (!DEBUG_ID_LINE.test(lines.at(-1) ?? "")) {
    problems.push('the last line is not "//# debugId=<hex>"');
  }
  if (SOURCE_MAPPING_URL_LINE.test(bundle))
    problems.push("the bundle holds a sourceMappingURL line");
  return problems;
}

function main(): void {
  const build = spawnSync(process.execPath, BUILD_ARGS, { cwd: REPO_DIR, stdio: "inherit" });
  if (build.error !== undefined || build.status !== 0) {
    console.error(
      `[build-bundle] bun ${BUILD_ARGS.join(" ")} failed: ${build.error?.message ?? `exit ${build.status ?? build.signal}`}`,
    );
    process.exit(1);
  }

  const bundle = readFileSync(join(REPO_DIR, BUNDLE_PATH), "utf8");
  const problems = [
    ...bundleProblems(bundle).map((problem) => `${BUNDLE_PATH}: ${problem}`),
    ...strayOutputs(join(REPO_DIR, "cli", "src")).map(
      (file) => `cli/src/${file}: a build output under the source; delete it`,
    ),
  ];
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[build-bundle] ${problem}`);
    process.exit(1);
  }
  const debugId = (bundle.trimEnd().split("\n").at(-1) ?? "").slice("//# debugId=".length);
  console.log(`[build-bundle] ${BUNDLE_PATH} and ${BUNDLE_PATH}.map, debug id ${debugId}`);
}

if (import.meta.main) main();
