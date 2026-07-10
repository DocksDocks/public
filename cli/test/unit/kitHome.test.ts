import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { kitHome } from "../../src/kitHome"

describe("kitHome", () => {
  it("describes the package-root requirement for invalid DOCKS_KIT_HOME", () => {
    const dir = mkdtempSync(join(tmpdir(), "docks-kit-home-"))
    const previous = process.env["DOCKS_KIT_HOME"]
    process.env["DOCKS_KIT_HOME"] = dir
    try {
      expect(() => kitHome()).toThrow(
        `DOCKS_KIT_HOME=${dir} is not a docks-kit package root (package.json name must be "docks-kit")`
      )
    } finally {
      if (previous === undefined) delete process.env["DOCKS_KIT_HOME"]
      else process.env["DOCKS_KIT_HOME"] = previous
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
