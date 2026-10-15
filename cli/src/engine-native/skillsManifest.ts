/**
 * EngineNative universal-skill manifest parsing: cleaned slugs, one per line.
 * Split from skillsSync.ts. Pure logic with no process state.
 */

/** skills::_normalize_manifest — cleaned slugs, one per line. */
export function normalizeManifest(content: string): Array<string> {
  const out: Array<string> = [];
  for (const line of content.split("\n")) {
    if (/^[ \t]*#/.test(line)) continue;
    if (/^[ \t]*$/.test(line)) continue;
    const cleaned = line.replace(/[ \t]*#.*$/, "").replace(/[ \t\r]+/g, "");
    if (cleaned.length > 0) out.push(cleaned);
  }
  return out;
}

/**
 * The directory the skills CLI installs for a manifest slug. The CLI names a
 * skill directory after the skill, so an `<owner>/<repo>@<skill>` slug names it
 * directly; a bare `<owner>/<repo>` slug means one skill named after the repo.
 * The name goes through the CLI's `sanitizeName` rule (skills@1.7.0).
 */
export function skillBase(slug: string): string {
  const segment = slug.slice(slug.lastIndexOf("/") + 1);
  const name = segment.slice(segment.lastIndexOf("@") + 1);
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 255);
  return sanitized === "" ? "unnamed-skill" : sanitized;
}
