import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  lstatSync: vi.fn(),
  symlinkSync: vi.fn()
}))

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return { ...actual, lstatSync: mocks.lstatSync, symlinkSync: mocks.symlinkSync }
})

import { linkOrCopy } from "../../src/engine-native/skillsSync"

describe("skills platform behavior", () => {
  beforeEach(() => {
    mocks.lstatSync.mockReset().mockReturnValue({ isSymbolicLink: () => true })
    mocks.symlinkSync.mockReset()
  })

  it("uses a portable directory symlink", () => {
    expect(linkOrCopy("target", "link")).toBe(true)
    expect(mocks.symlinkSync).toHaveBeenCalledWith("target", "link")
  })
})
