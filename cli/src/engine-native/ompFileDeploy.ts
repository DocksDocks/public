/**
 * EngineNative omp file deploy: private file modes, whole-file sync, and
 * merged-YAML sync for the agent directory. Split from ompSync.ts; the
 * orchestration still lives there.
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename } from "node:path";

import { payloadDisplayPath, payloadText, type PayloadPath } from "../payload";
import type { Ctx } from "./index";

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
  writePrivateFile(`${target}.tmp`, merged);
  renameSync(`${target}.tmp`, target);
  chmodSync(target, 0o600);
  change(`omp ${name} merged (backup at ${name}.bak)`);
  ctx.nextStepTriggers.ompRestart = true;
}
