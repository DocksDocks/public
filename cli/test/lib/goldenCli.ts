/** CLI argument and case-selection helpers shared by the golden suites. */
export interface GoldenOptions {
  proveRed: boolean
  updateGoldens: boolean
  filter?: RegExp
}
const ALLOWED_OPTIONS: Record<string, true> = {
  "--prove-red": true,
  "--update-goldens": true
}

export function parseArgs(argv: Array<string>): GoldenOptions {
  const unknown = argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && !Object.hasOwn(ALLOWED_OPTIONS, arg))
  if (unknown.length > 0) {
    console.error(`unknown option(s): ${unknown.join(", ")}`)
    process.exit(2)
  }
  const proveRed = argv.includes("--prove-red")
  const updateGoldens = argv.includes("--update-goldens")
  if (proveRed && updateGoldens) {
    console.error("--prove-red and --update-goldens are mutually exclusive")
    process.exit(2)
  }

  const filterValue = process.env["GOLDEN_FILTER"]
  let filter: RegExp | undefined
  if (filterValue !== undefined && filterValue !== "") {
    try {
      filter = new RegExp(filterValue)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`invalid GOLDEN_FILTER '${filterValue}': ${message}`)
      process.exit(2)
    }
  }

  return { proveRed, updateGoldens, filter }
}

/**
 * GOLDEN_FILTER (regex on the case label) scopes a run to one command surface.
 * Unset = everything.
 */
export function labelSelected(label: string, filter?: RegExp): boolean {
  return filter === undefined || filter.test(label)
}

export function banner(message: string): void {
  console.log(`\n=== ${message} ===`)
}
