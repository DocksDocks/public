/**
 * EngineNative universal-skill manifest parsing: cleaned slugs, one per line.
 * Split from skillsSync.ts. Pure logic with no process state.
 */

/** skills::_normalize_manifest — cleaned slugs, one per line. */
export function normalizeManifest(content: string): Array<string> {
  const out: Array<string> = []
  for (const line of content.split("\n")) {
    if (/^[ \t]*#/.test(line)) continue
    if (/^[ \t]*$/.test(line)) continue
    const cleaned = line.replace(/[ \t]*#.*$/, "").replace(/[ \t\r]+/g, "")
    if (cleaned.length > 0) out.push(cleaned)
  }
  return out
}
