/**
 * Codex home resolution. Codex reads CODEX_HOME when it is set and not empty,
 * and otherwise uses ~/.codex, so every kit read or write of Codex state uses
 * the same rule.
 */
import { isAbsolute, resolve } from "node:path";

import { p } from "./exec";

export function codexHome(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env["CODEX_HOME"];
  if (override === undefined || override === "") return p(home, ".codex");
  return isAbsolute(override) ? override : resolve(override);
}
