import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { snapshotTree } from "../lib/goldenSnapshot"

function withSnapshotRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "golden-snapshot-test-"))
  try {
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("snapshotTree", () => {
  it("hashes binary CRLF bytes without text normalization", () => {
    withSnapshotRoot((root) => {
      writeFileSync(join(root, "with-crlf.mp3"), Buffer.from([0x61, 0x0d, 0x0a, 0x62]))
      writeFileSync(join(root, "with-lf.mp3"), Buffer.from([0x61, 0x0a, 0x62]))

      const tree = snapshotTree(root)
      expect(tree["with-crlf.mp3"]).not.toBe(tree["with-lf.mp3"])
    })
  })

  it("still canonicalizes CRLF in explicitly textual artifacts", () => {
    withSnapshotRoot((root) => {
      writeFileSync(join(root, "with-crlf.txt"), "a\r\nb")
      writeFileSync(join(root, "with-lf.txt"), "a\nb")

      const tree = snapshotTree(root)
      expect(tree["with-crlf.txt"]).toBe(tree["with-lf.txt"])
    })
  })

  it("normalizes absolute symlink targets under the snapshot home", () => {
    withSnapshotRoot((root) => {
      mkdirSync(join(root, "links"))
      symlinkSync(join(root, "destination"), join(root, "links", "current"))

      expect(snapshotTree(root)["links/current"]).toBe("link:<HOME>/destination")
    })
  })
})
