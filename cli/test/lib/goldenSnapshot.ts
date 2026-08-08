/**
 * Output normalization and stable snapshot helpers for golden regressions.
 */
import { createHash } from "node:crypto"
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { registeredTemporaryDirs } from "./goldenResources"

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

/**
 * Replace per-run temp paths so two runs' outputs are comparable. Each root is
 * scrubbed in its native and forward-slash spelling. The temp roots also get
 * a basename fallback because their mkdtemp suffix is unique.
 */
export function normalizeOutput(out: string, home: string, stubDir: string): string {
  let normalized = out.replaceAll("\r\n", "\n")
  for (const form of pathForms(home)) normalized = normalized.replaceAll(form, "<HOME>")
  for (const form of pathForms(stubDir)) normalized = normalized.replaceAll(form, "<STUBS>")
  for (const form of pathForms(REPO_DIR)) normalized = normalized.replaceAll(form, "<REPO>")
  return normalized
    .replace(new RegExp(`[^\\s'"]*${escapeRegExp(basename(home))}`, "g"), "<HOME>")
    .replace(new RegExp(`[^\\s'"]*${escapeRegExp(basename(stubDir))}`, "g"), "<STUBS>")
}

function pathForms(path: string): Array<string> {
  const forwardSlash = path.replaceAll("\\", "/")
  return [...new Set([path, forwardSlash])]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export type TreeSnapshot = Record<string, string>

function normalizeTreeBody(
  body: string,
  root: string,
  temporaryDirs: ReadonlyArray<string>
): string {
  let normalized = body.replaceAll("\r\n", "\n")
  for (const form of pathForms(root)) normalized = normalized.replaceAll(form, "<HOME>")
  for (const temporary of temporaryDirs) {
    if (!basename(temporary).startsWith("golden-stubs-")) continue
    for (const form of pathForms(temporary)) normalized = normalized.replaceAll(form, "<STUBS>")
  }
  return normalized
}

export function snapshotTree(root: string, dir = root, acc: TreeSnapshot = {}): TreeSnapshot {
  return snapshotTreeWithTemporaryDirs(root, dir, acc, registeredTemporaryDirs())
}

function snapshotTreeWithTemporaryDirs(
  root: string,
  dir: string,
  acc: TreeSnapshot,
  temporaryDirs: ReadonlyArray<string>
): TreeSnapshot {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    const relative = path.slice(root.length + 1)
    if (relative === ".golden-argv.log") continue
    // `.bun/install` is a runtime artifact of the native side's bun
    // interpreter (module cache keyed off $HOME) — the engine never writes
    // there. `.bun` itself is still recursed (engine bootstraps can create
    // `.bun/bin`) but not recorded as an entry, so a cache-only `.bun`
    // contributes nothing to the diff.
    if (relative === ".bun/install") continue
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      acc[relative] = `link:${readlinkSync(path)}`
    } else if (stat.isDirectory()) {
      if (relative !== ".bun" && relative !== ".local" && relative !== ".local/bin") acc[`${relative}/`] = "dir"
      snapshotTreeWithTemporaryDirs(root, path, acc, temporaryDirs)
    } else {
      // Hash with CRLF and materialized runtime paths canonicalized so line
      // endings and per-run HOME/stub roots are not regressions.
      const body = normalizeTreeBody(readFileSync(path).toString("binary"), root, temporaryDirs)
      acc[relative] = `sha256:${createHash("sha256").update(Buffer.from(body, "binary")).digest("hex")}`
    }
  }
  return acc
}

export function diffTrees(a: TreeSnapshot, b: TreeSnapshot): Array<string> {
  const output: Array<string> = []
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[key] === b[key]) continue
    output.push(`  ${key}: A=${a[key] ?? "(absent)"} B=${b[key] ?? "(absent)"}`)
  }
  return output.sort()
}

export function diffText(label: string, a: string, b: string): Array<string> {
  if (a === b) return []
  const linesA = a.split("\n")
  const linesB = b.split("\n")
  const output: Array<string> = [`  ${label} differs (${linesA.length} vs ${linesB.length} lines):`]
  for (let index = 0; index < Math.max(linesA.length, linesB.length); index++) {
    if (linesA[index] !== linesB[index]) {
      output.push(
        `    line ${index + 1}: A=${JSON.stringify(linesA[index] ?? "")} B=${JSON.stringify(linesB[index] ?? "")}`
      )
      if (output.length > 12) {
        output.push("    …")
        break
      }
    }
  }
  return output
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(stableJson(value), null, 2)}\n`
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableJson(item)])
  )
}
