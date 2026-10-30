/**
 * EngineNative omp file deploy: private file modes, whole-file sync,
 * merged-YAML sync, and the dotenv key merge for the agent directory. Split
 * from ompSync.ts; the orchestration still lives there.
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename } from "node:path";

import { payloadDisplayPath, payloadText, type PayloadPath } from "../payload";
import { replaceFile } from "./atomicWrite";
import type { Ctx } from "./index";
import { mergeDotenv } from "./ompDotenv";

export type OmpTextPayloadPath = Extract<PayloadPath, `SoT/.omp/${string}`>;

// ------------------------------------------------------------ file modes ----

/**
 * `mkdirSync` and `writeFileSync` apply their `mode` only when they create the
 * path, so an existing world-readable directory or file would keep its mode.
 * The explicit chmod reproduces `install -d -m 0700` / `install -m 0600`.
 */
export function ensureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function writePrivateFile(target: string, content: string): void {
  writeFileSync(target, content, { mode: 0o600 });
  chmodSync(target, 0o600);
}

function backupPrivateFile(target: string): void {
  copyFileSync(target, `${target}.bak`);
  chmodSync(`${target}.bak`, 0o600);
}

// --------------------------------------------------------------- config ----

export function syncWholeFile(
  ctx: Ctx,
  sourcePath: OmpTextPayloadPath,
  target: string,
  alreadyMessage: string,
  syncedMessage: string,
): void {
  const { change, echo, verbose } = ctx.services.logger;
  const source = payloadDisplayPath(sourcePath);
  const content = payloadText(sourcePath);

  if (ctx.dryRun) {
    echo(`[dry-run] cp ${source} -> ${target}`);
    return;
  }

  if (existsSync(target) && readFileSync(target, "utf8") === content) {
    verbose(alreadyMessage);
    return;
  }
  if (existsSync(target)) backupPrivateFile(target);
  writePrivateFile(target, content);
  change(syncedMessage);
  ctx.nextStepTriggers.ompRestart = true;
}

export function syncMergedYaml(
  ctx: Ctx,
  sourcePath: OmpTextPayloadPath,
  target: string,
  merge: (sotText: string, deployedText: string) => string,
): void {
  const { change, echo, verbose } = ctx.services.logger;
  const source = payloadDisplayPath(sourcePath);
  const sotText = payloadText(sourcePath);
  const name = basename(sourcePath);

  if (!existsSync(target)) {
    if (ctx.dryRun) {
      echo(`[dry-run] cp ${source} -> ${target}`);
      return;
    }
    writePrivateFile(target, sotText);
    change(`omp ${name} installed`);
    ctx.nextStepTriggers.ompRestart = true;
    return;
  }

  const deployedText = readFileSync(target, "utf8");
  const merged = merge(sotText, deployedText);
  if (merged === deployedText) {
    verbose(`omp ${name} already in sync`);
    return;
  }
  if (ctx.dryRun) {
    echo(`[dry-run] merge ${source} -> ${target} (backup at ${target}.bak)`);
    return;
  }

  backupPrivateFile(target);
  // replaceFile writes through a symlinked config.yml or models.yml, so the link stays.
  replaceFile(target, merged, { mode: 0o600 });
  change(`omp ${name} merged (backup at ${name}.bak)`);
  ctx.nextStepTriggers.ompRestart = true;
}

/**
 * Key merge for `<agentDir>/.env` through `ompDotenv.ts mergeDotenv`. The file
 * can hold API keys, so each message names keys and never shows a value, and
 * no backup copy is made. A new file gets mode 0600. An existing file keeps
 * its mode, and a symlinked target stays a link.
 *
 * Windows gets no merge and the file stays as it is. The kit key prevents a
 * POSIX lock loss: on Linux and macOS, any close of a descriptor drops the
 * fcntl locks of the process. A Windows LockFileEx lock belongs to its own
 * handle, so the key has no benefit there. It would also remove the builtin
 * grep, sed, cat, and jq, which native Windows does not supply.
 */
export function syncMergedDotenv(ctx: Ctx, sourcePath: OmpTextPayloadPath, target: string): void {
  const { change, echo, verbose } = ctx.services.logger;
  const name = basename(target);
  if (ctx.services.platform.raw() === "win32") {
    verbose(`omp ${name} skipped on Windows (POSIX lock issue only)`);
    return;
  }
  const exists = existsSync(target);
  const deployedText = exists ? readFileSync(target, "utf8") : "";
  const { text, changedKeys } = mergeDotenv(payloadText(sourcePath), deployedText);
  if (changedKeys.length === 0) {
    verbose(`omp ${name} already in sync`);
    return;
  }
  const keys = changedKeys.join(", ");
  if (ctx.dryRun) {
    echo(`[dry-run] merge ${payloadDisplayPath(sourcePath)} -> ${target} (keys: ${keys})`);
    return;
  }

  if (exists) replaceFile(target, text);
  else writePrivateFile(target, text);
  change(`omp ${name} ${exists ? "merged" : "installed"} (keys: ${keys})`);
  ctx.nextStepTriggers.ompRestart = true;
}
