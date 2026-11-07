/**
 * The `omp` child processes of a sync. Every `omp` command that the
 * marketplace and plugin passes run starts through `spawnOmp`, so each child
 * writes into the data root that the sync locked.
 */
import { spawnProcess, type AsyncProcessOptions, type AsyncProcessResult } from "./exec";
import type { OmpPaths } from "./ompPaths";

/**
 * Run `omp args` pinned to the data root of `paths`, the root that the sync
 * locked. omp adopts `$XDG_DATA_HOME/omp` as its data root once that folder
 * exists, and another sync can create it after this sync took its locks.
 * When the locked data root is the config root, the child gets no
 * `XDG_DATA_HOME`, so its resolver keeps the config root. When the locked
 * data root is the XDG root, the child gets the environment of this process.
 */
export function spawnOmp(
  paths: OmpPaths,
  args: ReadonlyArray<string>,
  stdio: AsyncProcessOptions["stdio"],
): Promise<AsyncProcessResult> {
  if (paths.dataRoot !== paths.configRoot) return spawnProcess("omp", args, { stdio });
  const env = { ...process.env };
  delete env["XDG_DATA_HOME"];
  return spawnProcess("omp", args, { stdio, env });
}
