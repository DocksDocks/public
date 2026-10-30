/**
 * Key merge for the omp agent dotenv file, `<agentDir>/.env`. The file can
 * hold the user's API keys, so the merge never replaces the whole file. It
 * replaces each line that assigns a kit key and appends each missing kit key.
 * Every other line stays verbatim, in its order.
 *
 * The scan follows the dotenv grammar that omp reads through `node:util`
 * `parseEnv`: an optional `export ` prefix, and a value in single quotes,
 * double quotes, or backticks that can continue on the next lines. A key name
 * inside such a multi-line value is not an assignment.
 */

/** One assignment: its key and the first and last line of its value. */
interface DotenvEntry {
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

export interface DotenvMerge {
  readonly text: string;
  /** Kit keys whose line the merge replaced or appended, in SoT order. */
  readonly changedKeys: ReadonlyArray<string>;
}

/** Scans the assignments. Each line is read without carriage returns, as `parseEnv` reads it. */
function scanEntries(lines: ReadonlyArray<string>): Array<DotenvEntry> {
  const entries: Array<DotenvEntry> = [];
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? "").replaceAll("\r", "");
    const trimmed = line.trimStart();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    let key = line.slice(0, equals).trim();
    if (key.startsWith("export ")) key = key.slice("export ".length).trim();
    const value = line.slice(equals + 1).trimStart();
    const quote = value.charAt(0);
    let end = index;
    // An unclosed quote with no closing quote on a later line ends at its own line.
    if (quote !== "" && "'\"`".includes(quote) && !value.includes(quote, 1)) {
      const closing = lines.findIndex((next, at) => at > index && next.includes(quote));
      if (closing !== -1) end = closing;
    }
    if (key !== "") entries.push({ key, start: index, end });
    index = end;
  }
  return entries;
}

/**
 * Merges the kit assignments of `sotText` into `deployedText`. SoT comments
 * and blank lines are not deployed. A file that uses CRLF line ends keeps them.
 */
export function mergeDotenv(sotText: string, deployedText: string): DotenvMerge {
  const sotLines = sotText.replaceAll("\r", "").split("\n");
  const kitAssignments = new Map<string, ReadonlyArray<string>>();
  for (const entry of scanEntries(sotLines)) {
    kitAssignments.set(entry.key, sotLines.slice(entry.start, entry.end + 1));
  }

  const lines = deployedText.split("\n");
  const present = new Set<string>();
  const changed = new Set<string>();
  // Replace from the end, so a splice does not move the lines of an earlier entry.
  for (const entry of scanEntries(lines).reverse()) {
    const kitLines = kitAssignments.get(entry.key);
    if (kitLines === undefined) continue;
    present.add(entry.key);
    const carriageReturn = (lines[entry.end] ?? "").endsWith("\r") ? "\r" : "";
    const replacement = kitLines.map((line) => line + carriageReturn);
    if (lines.slice(entry.start, entry.end + 1).join("\n") === replacement.join("\n")) continue;
    lines.splice(entry.start, entry.end - entry.start + 1, ...replacement);
    changed.add(entry.key);
  }

  let text = lines.join("\n");
  const lineEnd = deployedText.includes("\r\n") ? "\r\n" : "\n";
  for (const [key, kitLines] of kitAssignments) {
    if (present.has(key)) continue;
    if (text !== "" && !text.endsWith("\n")) text += lineEnd;
    text += kitLines.join(lineEnd) + lineEnd;
    changed.add(key);
  }
  return { text, changedKeys: [...kitAssignments.keys()].filter((key) => changed.has(key)) };
}
