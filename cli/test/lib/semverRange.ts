/**
 * Version comparison for the dependency guards. The unit runner is Node.js,
 * which has no `Bun.semver`, so these helpers carry the small part of semver
 * that the guards need.
 */

/**
 * Order two prerelease tails the way semver does: numeric identifiers compare
 * as numbers and rank below alphanumeric ones, a shared prefix leaves the
 * shorter tail lower, and an empty tail is a final release, which outranks
 * every prerelease of the same version tuple.
 */
function comparePrerelease(left: string, right: string): number {
  if (left === right) return 0;
  if (left === "") return 1;
  if (right === "") return -1;
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Number(a) - Number(b);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly tail: string;
}

/**
 * Split `major.minor.patch[-prerelease]` into its parts. Anything else, such
 * as a tag, a URL, or a wildcard, has no version to compare.
 */
export function parseVersion(text: string): Version | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text);
  if (match === null) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    tail: match[4] ?? "",
  };
}

function compareVersions(left: Version, right: Version): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  return comparePrerelease(left.tail, right.tail);
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
export function pinSatisfies(pin: Version, operator: string, anchor: Version): boolean {
  if (compareVersions(pin, anchor) < 0) return false;
  if (operator !== "^" && operator !== "~" && operator !== ">=") return false;
  if (pin.tail !== "") {
    return pin.major === anchor.major && pin.minor === anchor.minor && pin.patch === anchor.patch;
  }
  return withinUpperBound(pin, operator, anchor);
}

/**
 * Apply the upper bound of `^`, `~`, or `>=` to a version at or above the
 * anchor. The prerelease rule stays with the caller: a root pin decides it per
 * comparator, and a peer range decides it once per comparator set.
 */
function withinUpperBound(version: Version, operator: "^" | "~" | ">=", anchor: Version): boolean {
  if (operator === ">=") return true;
  if (operator === "~") return version.major === anchor.major && version.minor === anchor.minor;
  if (anchor.major === 0 && anchor.minor === 0) {
    return version.major === 0 && version.minor === 0 && version.patch === anchor.patch;
  }
  if (anchor.major === 0) return version.major === 0 && version.minor === anchor.minor;
  return version.major === anchor.major;
}

/** One peer that an installed package declares, with the version it resolves. */
export interface PeerRequirement {
  readonly dependent: string;
  readonly peer: string;
  readonly range: string;
  /** The installed version of the peer, or `undefined` when no copy resolves. */
  readonly installed: string | undefined;
}

export interface PeerFinding extends PeerRequirement {
  readonly kind: "unsatisfied" | "unparsed" | "missing";
}

const COMPARATOR = /^(\^|~|>=|<=|>|<|=)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * Decide one comparator, or return `undefined` for a form this module does not
 * parse. `*` admits every version; the set rule below still keeps a
 * prerelease out of it.
 */
function comparatorHolds(version: Version, comparator: string): boolean | undefined {
  if (comparator === "*") return true;
  const match = COMPARATOR.exec(comparator);
  const anchor = match === null ? undefined : parseVersion(match[2] ?? "");
  if (match === null || anchor === undefined) return undefined;
  const operator = match[1] ?? "=";
  if (operator === "^" || operator === "~" || operator === ">=") {
    return compareVersions(version, anchor) >= 0 && withinUpperBound(version, operator, anchor);
  }
  const order = compareVersions(version, anchor);
  if (operator === ">") return order > 0;
  if (operator === "<") return order < 0;
  if (operator === "<=") return order <= 0;
  return order === 0;
}

/**
 * Decide one space-separated comparator set. A prerelease version enters a
 * set only when a comparator of the set names a prerelease of the same
 * `major.minor.patch` tuple, the rule that npm and bun apply.
 */
function comparatorSetHolds(version: Version, set: string): boolean | undefined {
  const comparators = set.trim().split(/\s+/);
  const results = comparators.map((comparator) => comparatorHolds(version, comparator));
  if (results.includes(undefined)) return undefined;
  if (results.includes(false)) return false;
  if (version.tail === "") return true;
  return comparators.some((comparator) => {
    const anchor = parseVersion(COMPARATOR.exec(comparator)?.[2] ?? "");
    return (
      anchor !== undefined &&
      anchor.tail !== "" &&
      anchor.major === version.major &&
      anchor.minor === version.minor &&
      anchor.patch === version.patch
    );
  });
}

/**
 * Report every peer that is missing, installed outside its declared range, or
 * not decidable here: a range form or an installed version that this module
 * cannot parse. An undecidable alternative is a finding even when another
 * alternative holds, so a new form makes the guard fail until the helper
 * learns it.
 */
export function unsatisfiedPeerRanges(
  requirements: ReadonlyArray<PeerRequirement>,
): Array<PeerFinding> {
  const findings: Array<PeerFinding> = [];
  for (const requirement of requirements) {
    if (requirement.installed === undefined) {
      findings.push({ ...requirement, kind: "missing" });
      continue;
    }
    const version = parseVersion(requirement.installed);
    if (version === undefined) {
      findings.push({ ...requirement, kind: "unparsed" });
      continue;
    }
    const results = requirement.range
      .split("||")
      .map((alternative) => comparatorSetHolds(version, alternative));
    if (results.includes(undefined)) {
      findings.push({ ...requirement, kind: "unparsed" });
    } else if (!results.includes(true)) {
      findings.push({ ...requirement, kind: "unsatisfied" });
    }
  }
  return findings;
}
