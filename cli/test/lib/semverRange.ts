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
  if (operator === ">=") return true;
  if (operator === "~") return pin.major === anchor.major && pin.minor === anchor.minor;
  if (anchor.major === 0 && anchor.minor === 0) {
    return pin.major === 0 && pin.minor === 0 && pin.patch === anchor.patch;
  }
  if (anchor.major === 0) return pin.major === 0 && pin.minor === anchor.minor;
  return pin.major === anchor.major;
}
