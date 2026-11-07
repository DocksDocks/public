/**
 * The line grammar of the line-based TOML passes: table header lines, key
 * lines, and the lines that continue a value from an earlier line. The module
 * imports nothing, so `manifests.ts` can read a Codex config without a runtime
 * cycle through `codexToml.ts` and `efforts.ts`.
 */

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
export function keyValueSeparator(line: string): number | undefined {
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
