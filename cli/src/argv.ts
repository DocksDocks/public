import { GlobalFlag } from "effect/cli";
import { docsCommand } from "./commands/docs";
import { syncCommand } from "./commands/sync";
import { toolchainCommand } from "./commands/toolchain";
import { updateCommand } from "./commands/update";
import { ompCommand } from "./commands/omp";
import { scratchCommand } from "./commands/scratch";
import { tidyCommand } from "./commands/tidy";
import { planCommand } from "./commands/plan";
import {
  buildSurfaces,
  normalizeArgv,
  scanArgv,
  spliceOmpBoundary,
  subcommandName as scanSubcommandName,
  type ArgvSurfaces,
} from "./argvSurface";
import { validateScannedArgv } from "./argvValidate";

export type ArgvOutcome =
  | { readonly kind: "reject"; readonly message: string; readonly exitCode: number }
  | { readonly kind: "accept"; readonly args: ReadonlyArray<string> };

/**
 * The one subcommand list. `main.ts` registers it with Effect, and the argv
 * surfaces below accept the same words. The order is the `--help` order.
 */
export const COMMANDS = [
  syncCommand,
  updateCommand,
  toolchainCommand,
  docsCommand,
  ompCommand,
  scratchCommand,
  tidyCommand,
  planCommand,
] as const;

const SURFACES: ArgvSurfaces = buildSurfaces(COMMANDS, GlobalFlag.BuiltIns);

const reject = (message: string): ArgvOutcome => ({
  kind: "reject",
  message,
  exitCode: 2,
});

/** The resolved subcommand word, or undefined at the root. */
export const subcommandName = (args: ReadonlyArray<string>): string | undefined =>
  scanSubcommandName(args, SURFACES);

// `docks-kit plan` passes every later word to the plan dispatcher, which parses them as plan.mjs did, so a `--`
// after the `plan` word keeps Effect from reading them as flags or adding its own refusal.
const splicePlanBoundary = (args: ReadonlyArray<string>): ReadonlyArray<string> => {
  const index = args.findIndex(
    (token, at) => token === "plan" && subcommandName(args.slice(0, at + 1)) === "plan",
  );
  return [...args.slice(0, index + 1), "--", ...args.slice(index + 1)];
};

const passthroughBoundary = (args: ReadonlyArray<string>): ReadonlyArray<string> => {
  const word = subcommandName(args);
  if (word === "omp") return spliceOmpBoundary(args, SURFACES);
  return word === "plan" ? splicePlanBoundary(args) : args;
};

/** Validate the argument list, then hand back the arguments Effect 4 should parse. */
export const prepareArgv = (args: ReadonlyArray<string>): ArgvOutcome => {
  const boundaryArgs = passthroughBoundary(args);
  const subcommand = subcommandName(boundaryArgs);
  const commandSurface =
    subcommand === undefined ? undefined : SURFACES.commandSurfaces.get(subcommand);
  const { flags, normalizations } = scanArgv(boundaryArgs, commandSurface, SURFACES);
  const message = validateScannedArgv(subcommand, commandSurface, SURFACES, flags);
  if (message !== undefined) return reject(message);
  return { kind: "accept", args: normalizeArgv(boundaryArgs, normalizations) };
};
