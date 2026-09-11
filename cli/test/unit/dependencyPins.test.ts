/**
 * Guards the dependency pins that a published install depends on.
 *
 * A checkout installs with `bun.lock` and `--frozen-lockfile`, so every
 * transitive version is already decided. A published install has no lockfile:
 * `bun add -g docks-kit`, `bunx`, and `npm i -g` resolve the whole tree fresh
 * from the registry. A caret over a prerelease, such as
 * `@effect/platform-bun` depending on `@effect/platform-node-shared`
 * at `^4.0.0-rc.109`, then admits a newer release candidate than the `effect`
 * version this kit pins, and the mixed pair fails at startup with
 * `Cannot find module 'effect/ByteSize'`. The cure is an exact root pin for
 * every prerelease transitive, and these tests fail at authoring time when a
 * new one appears.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const MODULES_DIR = join(REPO_DIR, "node_modules")
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const PRERELEASE_BASE = /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/

type Dependencies = Readonly<Record<string, string>>
type Manifests = Readonly<Record<string, Dependencies>>

interface Finding {
  readonly parent: string
  readonly dependency: string
  readonly range: string
  readonly kind: "unpinned" | "unsatisfied"
}

/**
 * Order two prerelease tails the way semver does: numeric identifiers compare
 * as numbers and rank below alphanumeric ones, a shared prefix leaves the
 * shorter tail lower, and an empty tail is a final release, which outranks
 * every prerelease of the same version tuple.
 */
function comparePrerelease(left: string, right: string): number {
  if (left === right) return 0
  if (left === "") return 1
  if (right === "") return -1
  const leftParts = left.split(".")
  const rightParts = right.split(".")
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const a = leftParts[index]
    const b = rightParts[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) return Number(a) - Number(b)
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a < b ? -1 : 1
  }
  return 0
}

interface Version {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly tail: string
}

/**
 * Split `major.minor.patch[-prerelease]` into its parts. Anything else, such
 * as a tag, a URL, or a wildcard, has no version to compare.
 */
function parseVersion(text: string): Version | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text)
  if (match === null) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), tail: match[4] ?? "" }
}

function compareVersions(left: Version, right: Version): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  return comparePrerelease(left.tail, right.tail)
}

/**
 * Decide whether an exact root pin satisfies a single-comparator range. Only
 * the operators a real manifest uses are accepted: `^` holds the major, `~`
 * holds the major and the minor, and `>=` holds nothing beyond the lower
 * bound. A compound range, an upper bound, or any other operator is treated as
 * not satisfied, because this guard does not carry a full semver solver.
 *
 * Two rules of the real resolvers decide the prerelease cases that this guard
 * exists for. A pin that carries a prerelease tail enters a range only when
 * its `major.minor.patch` tuple equals the comparator tuple, so the pin
 * `4.1.0-rc.1` stays outside `^4.0.0-rc.109` and bun resolves a second copy. A
 * caret narrows as the leading zeros grow: `^0.4.2` means `>=0.4.2 <0.5.0` and
 * `^0.0.3` means `>=0.0.3 <0.0.4`.
 */
function pinSatisfies(pin: Version, operator: string, anchor: Version): boolean {
  if (compareVersions(pin, anchor) < 0) return false
  if (operator !== "^" && operator !== "~" && operator !== ">=") return false
  if (pin.tail !== "") {
    return pin.major === anchor.major && pin.minor === anchor.minor && pin.patch === anchor.patch
  }
  if (operator === ">=") return true
  if (operator === "~") return pin.major === anchor.major && pin.minor === anchor.minor
  if (anchor.major === 0 && anchor.minor === 0) {
    return pin.major === 0 && pin.minor === 0 && pin.patch === anchor.patch
  }
  if (anchor.major === 0) return pin.major === 0 && pin.minor === anchor.minor
  return pin.major === anchor.major
}

/**
 * Judge one alternative of a declared range. An exact alternative pins itself,
 * and an alternative that anchors on a final release admits no prerelease
 * sibling, so both leave the tree held. Every other alternative floats over a
 * prerelease and needs an exact root pin that satisfies this alternative.
 */
function alternativeKind(alternative: string, pinText: string | undefined): Finding["kind"] | undefined {
  const trimmed = alternative.trim()
  if (EXACT_VERSION.test(trimmed)) return undefined
  const anchorText = trimmed.replace(/^(?:\^|~|>=|<=|>|<|=)?\s*v?/, "").split(/\s/)[0] ?? ""
  if (!PRERELEASE_BASE.test(anchorText)) return undefined
  if (pinText === undefined || !EXACT_VERSION.test(pinText)) return "unpinned"
  const operator = /^(\^|~|>=|<=|>|<|=)?\s*v?[0-9A-Za-z.-]+$/.exec(trimmed)?.[1] ?? ""
  const pin = parseVersion(pinText)
  const anchor = parseVersion(anchorText)
  if (pin !== undefined && anchor !== undefined && pinSatisfies(pin, operator, anchor)) return undefined
  return "unsatisfied"
}

/**
 * Report every transitive dependency that floats over a prerelease version,
 * either because no exact root pin holds it in place, or because the pin that
 * exists does not satisfy the range and therefore leaves the resolver free to
 * pick another prerelease build.
 *
 * A declared range splits on `||` before anything else, because a resolver
 * weighs every alternative and picks the highest version any of them admits.
 * The range `^3.9.0 || ^4.0.0-rc.109` floats over a prerelease through its
 * second alternative, and a scan that read only the first would miss it. One
 * finding per dependency is enough to name the parent that needs a pin.
 */
function unpinnedPrereleaseTransitives(rootDependencies: Dependencies, manifests: Manifests): Array<Finding> {
  const findings: Array<Finding> = []
  for (const [parent, dependencies] of Object.entries(manifests)) {
    for (const [dependency, range] of Object.entries(dependencies)) {
      const pinText = rootDependencies[dependency]?.trim()
      for (const alternative of range.split("||")) {
        const kind = alternativeKind(alternative, pinText)
        if (kind === undefined) continue
        findings.push({ parent, dependency, range, kind })
        break
      }
    }
  }
  return findings
}

function readManifest(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}

function dependenciesOf(manifest: Record<string, unknown>): Dependencies {
  const declared = manifest.dependencies
  if (typeof declared !== "object" || declared === null) return {}
  return declared as Dependencies
}

interface Installed {
  /** Absolute path of the resolved `package.json`. */
  readonly path: string
  /** Path below `node_modules`, which reads as the package location. */
  readonly label: string
}

/**
 * Resolve an installed package the way Node does for this closure: the
 * parent's own `node_modules` first, then the `node_modules` of every ancestor
 * walking outward, then the hoisted copy at the repository root. The parent
 * label already spells that chain of nesting, so cutting its last
 * `/node_modules/` segment steps one level out.
 */
function installedPackage(name: string, parent: string | undefined): Installed | undefined {
  const labels: Array<string> = []
  let scope = parent
  while (scope !== undefined) {
    labels.push(`${scope}/node_modules/${name}`)
    const cut = scope.lastIndexOf("/node_modules/")
    scope = cut === -1 ? undefined : scope.slice(0, cut)
  }
  labels.push(name)
  for (const label of labels) {
    const path = join(MODULES_DIR, label, "package.json")
    if (existsSync(path)) return { path, label }
  }
  return undefined
}

/**
 * List every installed package as a label below the root `node_modules`, at
 * every depth, so `@effect/platform-bun` and
 * `@effect/platform-bun/node_modules/ws` both appear. A nested copy that
 * defeats a root pin can sit at any depth, and a walk that stops at the top
 * level would not see it. `.bin` and `.cache` are package-manager
 * bookkeeping, not packages. A symbolic link is listed but never descended
 * into, because a workspace link points back into the tree and would make the
 * walk cycle.
 */
function installedPackages(): Array<string> {
  const labels: Array<string> = []
  const collect = (prefix: string): void => {
    for (const entry of readdirSync(join(MODULES_DIR, prefix), { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (entry.name === ".bin" || entry.name === ".cache") continue
      const scopeLink = entry.isSymbolicLink()
      const packages = entry.name.startsWith("@")
        ? readdirSync(join(MODULES_DIR, prefix, entry.name), { withFileTypes: true })
          .filter((scoped) => scoped.isDirectory() || scoped.isSymbolicLink())
          .map((scoped) => ({ name: `${entry.name}/${scoped.name}`, link: scopeLink || scoped.isSymbolicLink() }))
        : [{ name: entry.name, link: scopeLink }]
      for (const pkg of packages) {
        const label = prefix === "" ? pkg.name : `${prefix}/${pkg.name}`
        labels.push(label)
        if (pkg.link) continue
        const nested = join(MODULES_DIR, label, "node_modules")
        if (existsSync(nested) && lstatSync(nested).isDirectory()) collect(`${label}/node_modules`)
      }
    }
  }
  collect("")
  return labels
}

/**
 * Collect the ranges a fresh install can resolve for one package:
 * `dependencies`, `optionalDependencies`, which bun and npm both install when
 * the platform matches, and `peerDependencies`, which npm 7 and later installs
 * automatically when the peer is absent. A peer that `peerDependenciesMeta`
 * marks optional is left out, because nothing installs it unless a consumer
 * asks for it. `devDependencies` is left out as well: it never travels with a
 * published package.
 */
function installableRanges(manifest: Record<string, unknown>): Dependencies {
  const meta = typeof manifest.peerDependenciesMeta === "object" && manifest.peerDependenciesMeta !== null
    ? (manifest.peerDependenciesMeta as Record<string, { readonly optional?: boolean }>)
    : {}
  const ranges: Record<string, string> = { ...dependenciesOf(manifest) }
  const optional = manifest.optionalDependencies
  if (typeof optional === "object" && optional !== null) Object.assign(ranges, optional as Dependencies)
  const peers = manifest.peerDependencies
  if (typeof peers === "object" && peers !== null) {
    for (const [name, range] of Object.entries(peers as Dependencies)) {
      if (meta[name]?.optional === true) continue
      ranges[name] = range
    }
  }
  return ranges
}

/**
 * Walk the installed closure from the root dependency names, reading the
 * installable ranges of every package it reaches. The visited set holds
 * resolved manifest paths, not package names, so a nested duplicate is read
 * as well as the hoisted copy it shadows.
 */
function runtimeClosure(rootDependencies: Dependencies): Manifests {
  const manifests: Record<string, Dependencies> = {}
  const visited = new Set<string>()
  const queue: Array<{ readonly name: string; readonly parent: string | undefined }> = Object.keys(rootDependencies)
    .map((name) => ({ name, parent: undefined }))
  while (queue.length > 0) {
    const entry = queue.shift() as { readonly name: string; readonly parent: string | undefined }
    const installed = installedPackage(entry.name, entry.parent)
    if (installed === undefined || visited.has(installed.path)) continue
    visited.add(installed.path)
    const ranges = installableRanges(readManifest(installed.path))
    manifests[installed.label] = ranges
    for (const child of Object.keys(ranges)) queue.push({ name: child, parent: installed.label })
  }
  return manifests
}

const rootManifest = readManifest(join(REPO_DIR, "package.json"))
const rootDependencies = dependenciesOf(rootManifest)

describe("root dependency pins", () => {
  it("pins every runtime dependency exactly and leaves no prerelease transitive floating", () => {
    for (const [name, range] of Object.entries(rootDependencies)) {
      expect(range, `dependencies.${name} must be an exact version, found ${range}`).toMatch(EXACT_VERSION)
    }
    const findings = unpinnedPrereleaseTransitives(rootDependencies, runtimeClosure(rootDependencies))
    const listed = findings
      .map((finding) => {
        const pin = rootDependencies[finding.dependency]
        const held = pin === undefined ? "the root pins it nowhere" : `the root pin is ${pin}`
        return `${finding.kind}: ${finding.parent} requires ${finding.dependency}@${finding.range}, ${held}`
      })
      .join(", ")
    expect(findings, `every prerelease transitive needs a root pin that satisfies the range: ${listed}`).toEqual([])
  })

  it("reports a caret over a prerelease until an exact root pin satisfies it", () => {
    const withoutPin = {
      "@effect/platform-bun": "4.0.0-rc.109",
      effect: "4.0.0-rc.109"
    }
    const manifests = {
      "@effect/platform-bun": { "@effect/platform-node-shared": "^4.0.0-rc.109" }
    }
    expect(unpinnedPrereleaseTransitives(withoutPin, manifests)).toEqual([
      {
        parent: "@effect/platform-bun",
        dependency: "@effect/platform-node-shared",
        range: "^4.0.0-rc.109",
        kind: "unpinned"
      }
    ])
    const withPin = { ...withoutPin, "@effect/platform-node-shared": "4.0.0-rc.109" }
    expect(unpinnedPrereleaseTransitives(withPin, manifests)).toEqual([])
    const laterRange = {
      "@effect/platform-bun": { "@effect/platform-node-shared": "^4.0.0-rc.115" }
    }
    expect(unpinnedPrereleaseTransitives(withPin, laterRange)).toEqual([
      {
        parent: "@effect/platform-bun",
        dependency: "@effect/platform-node-shared",
        range: "^4.0.0-rc.115",
        kind: "unsatisfied"
      }
    ])
    const laterPin = { ...withPin, "@effect/platform-node-shared": "4.0.0-rc.115" }
    expect(unpinnedPrereleaseTransitives(laterPin, laterRange)).toEqual([])
    const higherPin = { ...withPin, "@effect/platform-node-shared": "4.1.0" }
    expect(unpinnedPrereleaseTransitives(higherPin, manifests)).toEqual([])
    const olderPin = { ...withPin, "@effect/platform-node-shared": "4.0.0-rc.108" }
    expect(unpinnedPrereleaseTransitives(olderPin, manifests)).toEqual([
      {
        parent: "@effect/platform-bun",
        dependency: "@effect/platform-node-shared",
        range: "^4.0.0-rc.109",
        kind: "unsatisfied"
      }
    ])
    const majorPin = { ...withPin, "@effect/platform-node-shared": "5.0.0" }
    expect(unpinnedPrereleaseTransitives(majorPin, manifests)[0]?.kind).toBe("unsatisfied")
    const tildeRange = {
      "@effect/platform-bun": { "@effect/platform-node-shared": "~4.0.0-rc.109" }
    }
    expect(unpinnedPrereleaseTransitives({ ...withPin, "@effect/platform-node-shared": "4.0.5" }, tildeRange)).toEqual([])
    expect(unpinnedPrereleaseTransitives(higherPin, tildeRange)[0]?.kind).toBe("unsatisfied")
    const laterTuplePin = { ...withPin, "@effect/platform-node-shared": "4.1.0-rc.1" }
    expect(
      unpinnedPrereleaseTransitives(laterTuplePin, manifests)[0]?.kind,
      "the prerelease pin 4.1.0-rc.1 carries another version tuple than ^4.0.0-rc.109 and is rejected"
    ).toBe("unsatisfied")
    const laterPatchPin = { ...withPin, "@effect/platform-node-shared": "4.0.1-rc.1" }
    expect(
      unpinnedPrereleaseTransitives(laterPatchPin, manifests)[0]?.kind,
      "the prerelease pin 4.0.1-rc.1 carries another version tuple than ^4.0.0-rc.109 and is rejected"
    ).toBe("unsatisfied")
    const zeroMajorRange = {
      "@effect/platform-bun": { "@effect/platform-node-shared": "^0.2.0-rc.1" }
    }
    const outsideMinorPin = { ...withPin, "@effect/platform-node-shared": "0.3.0" }
    expect(
      unpinnedPrereleaseTransitives(outsideMinorPin, zeroMajorRange)[0]?.kind,
      "a zero major caret narrows to the minor, so the pin 0.3.0 sits outside ^0.2.0-rc.1"
    ).toBe("unsatisfied")
    const insideMinorPin = { ...withPin, "@effect/platform-node-shared": "0.2.4" }
    expect(unpinnedPrereleaseTransitives(insideMinorPin, zeroMajorRange)).toEqual([])
    const alternationRange = {
      "@effect/platform-bun": { "@effect/platform-node-shared": "^3.9.0 || ^4.0.0-rc.109" }
    }
    const firstBranchPin = { ...withoutPin, "@effect/platform-node-shared": "3.9.5" }
    expect(
      unpinnedPrereleaseTransitives(firstBranchPin, alternationRange),
      "the second alternative floats over a prerelease, and the pin 3.9.5 holds only the first"
    ).toEqual([
      {
        parent: "@effect/platform-bun",
        dependency: "@effect/platform-node-shared",
        range: "^3.9.0 || ^4.0.0-rc.109",
        kind: "unsatisfied"
      }
    ])
    expect(unpinnedPrereleaseTransitives(withPin, alternationRange)).toEqual([])
  })

  it("installs every root dependency at its pinned version with no nested copy at any depth", () => {
    const parents = installedPackages()
    const shadows: Array<string> = []
    for (const [name, pin] of Object.entries(rootDependencies)) {
      const installed = installedPackage(name, undefined)
      expect(installed, `${name} is not installed under node_modules`).toBeDefined()
      expect(readManifest((installed as Installed).path).version, `${name} must be installed at ${pin}`).toBe(pin)
      for (const parent of parents) {
        const nested = join(MODULES_DIR, parent, "node_modules", name, "package.json")
        if (!existsSync(nested)) continue
        const version = String(readManifest(nested).version)
        shadows.push(`${parent}/node_modules/${name}@${version} shadows the pinned ${pin}`)
      }
    }
    expect(shadows, `nested copies defeat the root pins: ${shadows.join(", ")}`).toEqual([])
  })

  /**
   * A published install seats two halves of one release when one parent
   * declares `4.0.0-rc.115` while another declares `4.0.0-rc.109`. Both
   * declarations are exact, so the range scan sees nothing float. The pin
   * checks above skip the package as well, because it is no root dependency.
   * Only the installed closure shows the split, so this walk compares the
   * version of every installed copy at every depth.
   */
  it("installs no package at two distinct versions when either carries a prerelease tail", () => {
    const copies = new Map<string, Map<string, string>>()
    for (const label of installedPackages()) {
      const cut = label.lastIndexOf("/node_modules/")
      const name = cut === -1 ? label : label.slice(cut + "/node_modules/".length)
      const path = join(MODULES_DIR, label, "package.json")
      if (!existsSync(path)) continue
      const version = String(readManifest(path).version)
      const seen = copies.get(name) ?? new Map<string, string>()
      if (!seen.has(version)) seen.set(version, label)
      copies.set(name, seen)
    }
    const split: Array<string> = []
    for (const [name, seen] of copies) {
      if (seen.size < 2) continue
      if (!Array.from(seen.keys()).some((version) => PRERELEASE_BASE.test(version))) continue
      const listed = Array.from(seen).map(([version, label]) => `${version} at ${label}`).join(" and ")
      split.push(`${name} is installed at ${listed}`)
    }
    expect(split, `a prerelease package at two versions loads two halves of one release: ${split.join(", ")}`)
      .toEqual([])
  })
})
