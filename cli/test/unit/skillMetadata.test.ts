import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const SKILLS_DIR = join(REPO_DIR, ".agents", "skills")

/**
 * Guards the one intentional line-number touchpoint each project skill keeps.
 *
 * `AGENTS.md` lets a skill carry exactly one coarse `metadata.source_files[]`
 * range per file it cites, as the signal that the skill was written against a
 * known shape of that file. A range that ends past the end of its file can
 * never be exceeded, so it reports nothing forever: an audit found eleven of
 * them, one declaring `1-400` against a 52-line file.
 *
 * A range that ends short of the file is left alone on purpose. Several are
 * deliberate region citations - `SoT/.claude/settings.json 220-270` and
 * `index.ts 180-304` name the part of the file the skill explains, and
 * widening them to the whole file would delete that information.
 */
interface SourceFile {
  readonly path: string
  readonly lines: string
}

const lineCount = (text: string): number =>
  text.split("\n").length - (text.endsWith("\n") ? 1 : 0)

function declaredFiles(skillFile: string): ReadonlyArray<SourceFile> {
  const text = readFileSync(skillFile, "utf8")
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (frontmatter === null) return []
  const parsed = parse(frontmatter[1]) as { metadata?: { source_files?: ReadonlyArray<SourceFile> } }
  return parsed.metadata?.source_files ?? []
}

describe("skill source ranges", () => {
  it("names a file that exists and ends inside it", () => {
    const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => join(SKILLS_DIR, entry.name, "SKILL.md"))
      .filter((file) => existsSync(file))
    expect(skills.length, `no SKILL.md found under ${SKILLS_DIR}`).toBeGreaterThan(0)

    const findings: Array<string> = []
    let checked = 0
    for (const skill of skills) {
      const name = skill.slice(SKILLS_DIR.length + 1)
      for (const declared of declaredFiles(skill)) {
        checked += 1
        const target = join(REPO_DIR, declared.path)
        if (!existsSync(target)) {
          findings.push(`${name} cites ${declared.path}, which no longer exists`)
          continue
        }
        const range = /^(\d+)-(\d+)$/.exec(String(declared.lines))
        if (range === null) {
          findings.push(`${name} declares ${declared.path} lines "${declared.lines}", not "<start>-<end>"`)
          continue
        }
        const start = Number(range[1])
        const end = Number(range[2])
        const real = lineCount(readFileSync(target, "utf8"))
        if (start < 1 || start > end) {
          findings.push(`${name} declares ${declared.path} lines ${start}-${end}, an empty range`)
          continue
        }
        if (end > real) {
          findings.push(`${name} declares ${declared.path} lines ${start}-${end}; the file is ${real} lines`)
        }
      }
    }
    expect(checked, "no source_files entry was checked").toBeGreaterThan(0)
    expect(
      findings,
      `a range past the end of its file can never be exceeded, so it reports no drift:\n${findings.join("\n")}`
    ).toEqual([])
  })
})
