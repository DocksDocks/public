import { GlobalFlag } from "effect/unstable/cli";
import { docsCommand } from "./commands/docs";
import { modelCommand } from "./commands/model";
import { modelsCommand } from "./commands/models";
import { pluginsCommand } from "./commands/plugins";
import { skillsCommand } from "./commands/skills";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";
import { toolchainCommand } from "./commands/toolchain";
import { updateCommand } from "./commands/update";
import { ompCommand } from "./commands/omp";
import {
  buildSurfaces,
  normalizeArgv,
  scanArgv,
  spliceOmpBoundary,
  subcommandName as scanSubcommandName,
  type ArgvSurfaces,
  type CommandValue,
} from "./argvSurface";
import { validateScannedArgv } from "./argvValidate";

export type ArgvOutcome =
  | { readonly kind: "reject"; readonly message: string; readonly exitCode: number }
  | { readonly kind: "accept"; readonly args: ReadonlyArray<string> };

const COMMANDS: ReadonlyArray<CommandValue> = [
  syncCommand,
  updateCommand,
  modelCommand,
  toolchainCommand,
  modelsCommand,
  statusCommand,
  pluginsCommand,
  skillsCommand,
  docsCommand,
  ompCommand,
];

const SURFACES: ArgvSurfaces = buildSurfaces(COMMANDS, GlobalFlag.BuiltIns);

const reject = (message: string): ArgvOutcome => ({
  kind: "reject",
  message,
  exitCode: 2,
});

/** The resolved subcommand word, or undefined at the root. */
export const subcommandName = (args: ReadonlyArray<string>): string | undefined =>
  scanSubcommandName(args, SURFACES);

/** Validate the argument list, then hand back the arguments Effect 4 should parse. */
export const prepareArgv = (args: ReadonlyArray<string>): ArgvOutcome => {
  const boundaryArgs = subcommandName(args) === "omp" ? spliceOmpBoundary(args, SURFACES) : args;
  const subcommand = subcommandName(boundaryArgs);
  const commandSurface =
    subcommand === undefined ? undefined : SURFACES.commandSurfaces.get(subcommand);
  const { flags, normalizations } = scanArgv(boundaryArgs, commandSurface, SURFACES);
  const message = validateScannedArgv(subcommand, commandSurface, SURFACES, flags);
  if (message !== undefined) return reject(message);
  return { kind: "accept", args: normalizeArgv(boundaryArgs, normalizations) };
};
