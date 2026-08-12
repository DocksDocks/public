import { existsSync, readFileSync } from "node:fs"

export function readGolden<Case>(goldenPath: string): {
  readonly version: 1
  readonly cases: Record<string, Case>
} {
  if (!existsSync(goldenPath)) {
    console.error(`${goldenPath} does not exist; run with --update-goldens first`)
    process.exit(1)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(goldenPath, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${goldenPath}: malformed golden JSON: ${message}`)
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("cases" in parsed) ||
    typeof parsed.cases !== "object" ||
    parsed.cases === null ||
    Array.isArray(parsed.cases)
  ) {
    throw new Error(`${goldenPath}: expected a version-1 object with object-valued cases`)
  }

  return parsed as { readonly version: 1; readonly cases: Record<string, Case> }
}

export function selectProveRedMismatch<Case>(goldenCases: Readonly<Record<string, Case>>) {
  let comparedCases = 0
  let comparatorMismatches = 0

  return {
    expectedFor(label: string): Case {
      const other = Object.keys(goldenCases).find((candidate) => candidate !== label)
      if (other === undefined) throw new Error("prove-red needs at least two golden cases")
      return goldenCases[other]!
    },
    recordComparison(mismatched: boolean): void {
      comparedCases++
      if (mismatched) comparatorMismatches++
    },
    result(): {
      readonly comparedCases: number
      readonly comparatorMismatches: number
      readonly succeeded: boolean
    } {
      return {
        comparedCases,
        comparatorMismatches,
        succeeded: comparedCases > 0 && comparatorMismatches > 0
      }
    }
  }
}
