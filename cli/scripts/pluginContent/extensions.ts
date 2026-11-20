import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import config from "../../src/skills/config.json" with { type: "json" };
import { pluginDir } from "../../src/skills/frontmatter.ts";

/**
 * The extension load check of the DocksDocks/docks gate (`scripts/ci.mjs
 * gateExtensions`), ported to the kit plugin. Each `omp.extensions` entry of
 * the plugin `package.json` is a module with a default function export, the
 * factory that omp calls. omp skips a missing entry without a message, so this
 * check imports each entry itself.
 */

/** The files that omp loads for a folder entry, in order. */
const EXTENSION_INDEX_FILES = ["index.ts", "index.js", "index.mjs", "index.cjs"];

const isFile = (file: string): boolean =>
  statSync(file, { throwIfNoEntry: false })?.isFile() === true;

const outside = (root: string, file: string): boolean =>
  relative(root, file).split(sep)[0] === "..";

/**
 * The problem of one entry, or null when omp can load it. The install copies
 * only the plugin folder, so the entry path, its real path, and the real path
 * of the loaded file must be inside the real plugin folder. A folder entry
 * loads its first `index.*` file, as omp does.
 */
async function extensionProblem(root: string, entry: string): Promise<string | null> {
  const target = resolve(root, entry);
  if (outside(resolve(root), target)) return "is outside the plugin folder";
  const modulePath =
    statSync(target, { throwIfNoEntry: false })?.isDirectory() === true
      ? (EXTENSION_INDEX_FILES.map((name) => join(target, name)).find(isFile) ?? target)
      : target;
  if (!isFile(modulePath)) {
    return `is not a file (a folder entry needs one of ${EXTENSION_INDEX_FILES.join(", ")})`;
  }
  const realRoot = realpathSync(root);
  if (outside(realRoot, realpathSync(target)) || outside(realRoot, realpathSync(modulePath))) {
    return "is outside the plugin folder after symbolic links resolve";
  }
  let loaded: { readonly default?: unknown };
  try {
    // The entry comes from the manifest at run time, so a static import cannot name it.
    loaded = await import(pathToFileURL(modulePath).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `throws at import: ${message.replace(/\s+/gu, " ")}`;
  }
  return typeof loaded.default === "function" ? null : "has no default function export";
}

/** One message per `omp.extensions` entry that omp cannot load. */
export async function checkExtensions(repoRoot: string): Promise<Array<string>> {
  const root = pluginDir(repoRoot);
  const manifest = `${config.pluginDir}/package.json`;
  const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  // An absent property means no extensions. A present property, also null, must be a list.
  const omp: object = Object(
    typeof parsed === "object" && parsed !== null && "omp" in parsed ? parsed.omp : undefined,
  );
  const extensions: unknown = "extensions" in omp ? omp.extensions : [];
  const isStringList = (value: unknown): value is ReadonlyArray<string> =>
    Array.isArray(value) && value.every((entry) => typeof entry === "string");
  if (!isStringList(extensions)) {
    return [`${manifest}: omp.extensions must be an array of strings`];
  }
  const failures: Array<string> = [];
  for (const entry of extensions) {
    const problem = await extensionProblem(root, entry);
    if (problem !== null) failures.push(`${manifest}: omp.extensions entry ${entry} ${problem}`);
  }
  return failures;
}
