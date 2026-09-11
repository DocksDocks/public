/**
 * Per-case timeout ceilings for the unit suite.
 *
 * Several suites spawn the public CLI as a child, and every spawn pays a cold
 * Bun transpile of the whole CLI tree because the launcher falls through to
 * source. That cost is about one second warm on a developer machine, so the
 * ceilings exist for runner variance rather than for the work itself.
 *
 * The Windows values are higher because `windows-2025` runner throughput
 * varies by roughly a factor of two. Two attempts of the same parity run
 * executed identical bytes and restored the identical Bun cache key, yet the
 * unit suite took 134 seconds on the first attempt and 61 seconds on the
 * second. On the slow attempt one case crossed the 15000 ms default ceiling
 * and one spawn-heavy case crossed the 30000 ms spawn ceiling, while the fast
 * attempt passed every case. Spawn-based cases absorb that variance first.
 *
 * A genuinely hung child still fails the run; the larger Windows ceilings only
 * make it take longer to report.
 */

const WINDOWS = process.platform === "win32"

/** Default ceiling for every case in the unit suite. */
export const TEST_TIMEOUT_MS = WINDOWS ? 45_000 : 15_000

/** Ceiling for a case that spawns the public CLI at least once. */
export const SPAWN_TIMEOUT_MS = WINDOWS ? 90_000 : 30_000
