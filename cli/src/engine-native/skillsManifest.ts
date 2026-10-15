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
 * skill directory after the skill. It reads `@<skill>` only in the
 * `<owner>/<repo>@<skill>` form (skills@1.7.0 parseSource), so an `@` in a local
 * path or URL stays part of the name. Any other slug means one skill named after
 * its last path segment. The name goes through the CLI's `sanitizeName` rule.
 */
export function skillBase(slug: string): string {
  const selector = /^[^/]+\/[^/@]+@(.+)$/.exec(slug)?.[1];
  const nativeForm = !slug.includes(":") && !slug.startsWith(".") && !slug.startsWith("/");
  const name =
    selector !== undefined && nativeForm ? selector : slug.slice(slug.lastIndexOf("/") + 1);
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 255);
  return sanitized === "" ? "unnamed-skill" : sanitized;
}
