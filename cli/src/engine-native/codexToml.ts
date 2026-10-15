/**
 * Line-based Codex TOML passes: top-level setting replacement, the SoT
 * top-level and table merges used by `sync codex`, and `--codex-model` /
 * `--codex-effort`. A TOML library would reformat user configs and break the
 * golden contract. The key is used as a raw regex fragment, preserving the
 * historical record-oriented behavior.
 */
import { p } from "./exec";
import { existsSync, readFileSync } from "node:fs";

import { resolveEffort } from "../efforts";
import { replaceFile } from "./atomicWrite";
import { codexHome } from "./codexPaths";
import type { Ctx } from "./index";
import type { SettingEdit } from "./sharedTypes";

export function isTomlHeaderLine(line: string): boolean {
  return /^[ \t]*\[/.test(line);
}

/** Offset just past the quoted string that starts at `start`, or the line end when it stays open. */
function skipQuoted(line: string, start: number): number {
  const quote = line[start];
  let offset = start + 1;
  while (offset < line.length) {
    if (quote === '"' && line[offset] === "\\") {
      offset += 2;
      continue;
    }
    if (line[offset] === quote) return offset + 1;
    offset++;
  }
  return offset;
}

/** Offset of the `=` that ends the key on a key line, or undefined for other lines. */
function keyValueSeparator(line: string): number | undefined {
  if (/^[ \t]*($|#|\[)/.test(line)) return undefined;
  let offset = 0;
  while (offset < line.length) {
    const char = line[offset]!;
    if (char === "=") return offset;
    offset = char === '"' || char === "'" ? skipQuoted(line, offset) : offset + 1;
  }
  return undefined;
}

/**
 * Mark each line that continues a value opened on an earlier line: the body of
 * a `"""` or `'''` string, or the rest of an array or inline table that spans
 * lines. A marked line is never a table header or a key line.
 */
export function tomlContinuationLines(lines: ReadonlyArray<string>): Array<boolean> {
  const continuation: Array<boolean> = [];
  let openString: string | undefined;
  let depth = 0;
  const scanValue = (line: string, start: number): void => {
    let offset = start;
    while (offset < line.length) {
      if (openString !== undefined) {
        if (openString === '"""' && line[offset] === "\\") {
          offset += 2;
        } else if (line.startsWith(openString, offset)) {
          // A closing delimiter can carry up to two extra quotes of string content.
          let end = offset + 3;
          while (end < offset + 5 && line[end] === openString[0]) end++;
          offset = end;
          openString = undefined;
        } else {
          offset++;
        }
        continue;
      }
      const char = line[offset]!;
      if (char === "#") return;
      if (line.startsWith('"""', offset) || line.startsWith("'''", offset)) {
        openString = line.slice(offset, offset + 3);
        offset += 3;
        continue;
      }
      if (char === '"' || char === "'") {
        offset = skipQuoted(line, offset);
        continue;
      }
      if (char === "[" || char === "{") depth++;
      else if ((char === "]" || char === "}") && depth > 0) depth--;
      offset++;
    }
  };
  for (const line of lines) {
    if (openString !== undefined || depth > 0) {
      continuation.push(true);
      scanValue(line, 0);
      continue;
    }
    continuation.push(false);
    const separator = keyValueSeparator(line);
    if (separator !== undefined) scanValue(line, separator + 1);
  }
  return continuation;
}

export function replaceTopLevelSetting(content: string, key: string, replacement: string): string {
  // A leading BOM would hide the first key or header from the line patterns.
  const lines = content.replace(/^\uFEFF/, "").split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // awk records exclude a trailing empty split artifact
  const continuation = tomlContinuationLines(lines);
  const keyRe = new RegExp(`^[ \\t]*${key}[ \\t]*=`);
  const out: Array<string> = [];
  let inTable = false;
  let replaced = false;
  // The continuation lines of a replaced key's value go with the key line.
  let dropping = false;
  for (const [index, line] of lines.entries()) {
    if (continuation[index] === true) {
      if (!dropping) out.push(line);
      continue;
    }
    dropping = false;
    if (isTomlHeaderLine(line)) {
      if (!replaced) {
        out.push(replacement);
        replaced = true;
      }
      inTable = true;
      out.push(line);
      continue;
    }
    if (!inTable && keyRe.test(line)) {
      if (!replaced) {
        out.push(replacement);
        replaced = true;
      }
      dropping = true;
      continue;
    }
    out.push(line);
  }
  if (!replaced) out.push(replacement);
  return `${out.join("\n")}\n`;
}

export function replaceTopLevelSettingInFile(
  file: string,
  key: string,
  replacement: string,
): boolean {
  const before = readFileSync(file, "utf8");
  const next = replaceTopLevelSetting(before, key, replacement);
  if (next === before) return false;
  replaceFile(file, next);
  return true;
}

type CodexSettingEdit = SettingEdit<"model" | "model_reasoning_effort">;

/**
 * `deployedBefore` is the config text a sync read before its merge. The merge
 * already wrote the modifier value, so only that earlier text shows whether the
 * modifier changed the deployed setting.
 */
function syncCodexSetting(ctx: Ctx, edit: CodexSettingEdit, deployedBefore?: string): void {
  const { change, echo, verbose, warn } = ctx.services.logger;
  const userCodexSettings = p(codexHome(ctx.home), "config.toml");

  if (!existsSync(userCodexSettings)) {
    // A dry-run sync already previewed installing the file, so the edit is not skipped.
    // The `docks-kit model codex <m>` command creates no file, so the skip stands.
    if (ctx.dryRun && ctx.syncCodex) {
      echo(`[dry-run] (${edit.tag}) set ${edit.key} = "${edit.value}" in ${userCodexSettings}`);
      return;
    }
    warn(`(${edit.tag}) ${userCodexSettings} missing — skipped`);
    return;
  }

  if (ctx.dryRun) {
    echo(`[dry-run] (${edit.tag}) set ${edit.key} = "${edit.value}" in ${userCodexSettings}`);
    return;
  }

  const line = `${edit.key} = "${edit.value}"`;
  const wrote = replaceTopLevelSettingInFile(userCodexSettings, edit.key, line);
  const changedSinceMerge =
    deployedBefore !== undefined &&
    replaceTopLevelSetting(deployedBefore, edit.key, line) !== deployedBefore;
  if (wrote || changedSinceMerge) {
    change(edit.changed);
    ctx.nextStepTriggers.codexRestart = true;
  } else {
    verbose(edit.unchanged);
  }
}

export function syncCodexModel(ctx: Ctx, model: string, deployedBefore?: string): void {
  if (model === "") return;
  syncCodexSetting(
    ctx,
    {
      tag: "--codex-model",
      key: "model",
      value: model,
      changed: `Model: deployed Codex model set to ${model} (SoT unchanged; flag-less sync reverts)`,
      unchanged: `Model: deployed Codex model already ${model}`,
    },
    deployedBefore,
  );
}

export function syncCodexEffort(ctx: Ctx, effort: string, deployedBefore?: string): void {
  if (effort === "") return;
  const resolved = resolveEffort("codex", effort);
  const useDefault = effort === "default";
  syncCodexSetting(
    ctx,
    {
      tag: "--codex-effort",
      key: "model_reasoning_effort",
      value: resolved,
      changed: useDefault
        ? `Effort: deployed Codex model_reasoning_effort set to ${resolved} (SoT default)`
        : `Effort: deployed Codex model_reasoning_effort set to ${resolved} (SoT unchanged; flag-less sync reverts)`,
      unchanged: `Effort: deployed Codex model_reasoning_effort already ${resolved}`,
    },
    deployedBefore,
  );
}

export function mergeTopLevelSettings(sotConfigText: string, userConfig: string): void {
  for (const line of sotConfigText.split("\n")) {
    if (isTomlHeaderLine(line)) break;
    if (/^[ \t]*($|#)/.test(line)) continue;
    const setting = /^[ \t]*([A-Za-z0-9_.-]+)[ \t]*=/.exec(line);
    if (setting === null) continue;
    replaceTopLevelSettingInFile(userConfig, setting[1]!, line);
  }
}

interface TomlTableHeader {
  readonly path: string;
}

const TOML_BASIC_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

function tomlBasicEscape(
  line: string,
  offset: number,
): { readonly next: number; readonly value: string } | undefined {
  const escaped = line[offset];
  const simple = escaped === undefined ? undefined : TOML_BASIC_ESCAPES[escaped];
  if (simple !== undefined) return { next: offset + 1, value: simple };
  const digits = escaped === "u" ? 4 : escaped === "U" ? 8 : 0;
  if (digits === 0) return undefined;
  const hex = line.slice(offset + 1, offset + 1 + digits);
  if (hex.length !== digits || !/^[0-9A-Fa-f]+$/.test(hex)) return undefined;
  const codePoint = Number.parseInt(hex, 16);
  if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return undefined;
  return { next: offset + 1 + digits, value: String.fromCodePoint(codePoint) };
}

/** Decode a table header to the TOML path that determines managed ownership. */
function tomlTableHeader(line: string): TomlTableHeader | undefined {
  let offset = 0;
  const skipWhitespace = (): void => {
    while (line[offset] === " " || line[offset] === "\t") offset++;
  };

  skipWhitespace();
  if (line[offset] !== "[") return undefined;
  offset++;
  const array = line[offset] === "[";
  if (array) offset++;

  const keys: Array<string> = [];
  while (true) {
    skipWhitespace();
    const quote = line[offset];
    let key = "";
    if (quote === '"' || quote === "'") {
      offset++;
      let closed = false;
      while (offset < line.length) {
        const char = line[offset]!;
        if (char === quote) {
          offset++;
          closed = true;
          break;
        }
        if (quote === '"' && char === "\\") {
          const escape = tomlBasicEscape(line, offset + 1);
          if (escape === undefined) return undefined;
          key += escape.value;
          offset = escape.next;
          continue;
        }
        if (char === "\n" || char === "\r") return undefined;
        key += char;
        offset++;
      }
      if (!closed) return undefined;
    } else {
      const start = offset;
      while (offset < line.length && /[A-Za-z0-9_-]/.test(line[offset]!)) offset++;
      if (offset === start) return undefined;
      key = line.slice(start, offset);
    }
    keys.push(key);

    skipWhitespace();
    if (line[offset] === ".") {
      offset++;
      continue;
    }
    if (line[offset] !== "]") return undefined;
    offset++;
    if (array) {
      if (line[offset] !== "]") return undefined;
      offset++;
    }
    skipWhitespace();
    if (offset < line.length && line[offset] !== "#") return undefined;
    return { path: JSON.stringify(keys) };
  }
}

function mergeTableSettingsText(sotConfigText: string, userConfigText: string): string {
  const sotLines = sotConfigText.split("\n");
  const sotContinuation = tomlContinuationLines(sotLines);
  const sotHeaders = sotLines.map((line, offset) =>
    sotContinuation[offset] === true ? undefined : tomlTableHeader(line),
  );
  let merged = userConfigText;
  for (let tableOffset = 0; tableOffset < sotLines.length; tableOffset++) {
    const managedHeader = sotHeaders[tableOffset];
    if (managedHeader === undefined) continue;

    const block: Array<string> = [];
    for (let blockOffset = tableOffset; blockOffset < sotLines.length; blockOffset++) {
      if (blockOffset !== tableOffset && sotHeaders[blockOffset] !== undefined) break;
      block.push(sotLines[blockOffset]!);
    }
    const tableBlock = block.join("\n").replace(/\n+$/, "");

    const userLines = merged.split("\n");
    if (userLines[userLines.length - 1] === "") userLines.pop();
    const userContinuation = tomlContinuationLines(userLines);
    let skip = false;
    const kept: Array<string> = [];
    // Blank and comment lines after the last key of a removed block. They belong
    // to the next block or are disabled config, so they stay in the file.
    let trailingComments: Array<string> = [];
    const keepTrailingComments = (): void => {
      const firstContent = trailingComments.findIndex((line) => !/^[ \t]*$/.test(line));
      if (firstContent !== -1) kept.push(...trailingComments.slice(firstContent));
      trailingComments = [];
    };
    for (const [index, line] of userLines.entries()) {
      const continued = userContinuation[index] === true;
      const header = continued ? undefined : tomlTableHeader(line);
      if (header !== undefined) {
        if (skip) keepTrailingComments();
        skip = header.path === managedHeader.path;
        if (skip) continue;
      }
      if (!skip) kept.push(line);
      else if (!continued && /^[ \t]*($|#)/.test(line)) trailingComments.push(line);
      else trailingComments = [];
    }
    if (skip) keepTrailingComments();
    merged = `${kept.join("\n")}\n\n${tableBlock}\n`;
  }
  return merged;
}

export function mergeTableSettings(sotConfigText: string, userConfig: string): void {
  replaceFile(userConfig, mergeTableSettingsText(sotConfigText, readFileSync(userConfig, "utf8")));
}
