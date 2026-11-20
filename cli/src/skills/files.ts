/**
 * The file service of `docks-kit skill`. Each method mirrors one `fs` call of the former skill-guard script of
 * write-skill, with the same symlink handling. A failed call carries the Node error message,
 * which names the error code and the path. The command entry provides `SkillFiles.layer`.
 */
import fs from "node:fs";

import { Context, Effect, Layer, Predicate } from "effect";

import { FileError } from "../plan/types";

/** One folder entry, as `readdirSync(..., { withFileTypes: true })` sees it: a symlink is not a directory. */
export interface SkillFolderEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

const errorCode = (error: unknown): string | undefined => {
  const code = Predicate.hasProperty(error, "code") ? error.code : undefined;
  return Predicate.isString(code) ? code : undefined;
};

/**
 * The Node message of a failed call on `file`. Node leaves the path out of some messages, such as the EISDIR of a read;
 * the path is then appended in Node's own form, `<message> '<path>'`.
 */
function errorMessage(error: unknown, file: string): string {
  if (!(error instanceof Error)) return String(error);
  return Predicate.hasProperty(error, "path") && Predicate.isString(error.path)
    ? error.message
    : `${error.message} '${file}'`;
}

const fileOperation = <A>(file: string, operation: () => A): Effect.Effect<A, FileError> =>
  Effect.try({
    try: operation,
    catch: (error) => new FileError({ message: errorMessage(error, file), code: errorCode(error) }),
  });

export class SkillFiles extends Context.Service<
  SkillFiles,
  {
    /** `fs.existsSync`, which follows symlinks and never fails. */
    readonly exists: (file: string) => Effect.Effect<boolean>;
    /** `fs.statSync(file).isDirectory()`, which follows symlinks. */
    readonly isDirectory: (file: string) => Effect.Effect<boolean, FileError>;
    /** The entries of a folder, in the order of the system. */
    readonly readFolder: (
      folder: string,
    ) => Effect.Effect<ReadonlyArray<SkillFolderEntry>, FileError>;
    /** The UTF-8 text of a file, a leading byte-order mark included. */
    readonly readFile: (file: string) => Effect.Effect<string, FileError>;
    /** `process.cwd()`. */
    readonly workingFolder: Effect.Effect<string>;
  }
>()("docks-kit/skills/SkillFiles") {
  static readonly layer = Layer.succeed(
    SkillFiles,
    SkillFiles.of({
      exists: (file) => Effect.sync(() => fs.existsSync(file)),
      isDirectory: (file) => fileOperation(file, () => fs.statSync(file).isDirectory()),
      readFolder: (folder) =>
        fileOperation(folder, () =>
          fs.readdirSync(folder, { withFileTypes: true }).map((entry): SkillFolderEntry => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
          })),
        ),
      // Node's readFileSync with an encoding decodes the bytes as Buffer#toString does.
      readFile: (file) => fileOperation(file, () => fs.readFileSync(file).toString("utf8")),
      workingFolder: Effect.sync(() => process.cwd()),
    }),
  );
}
