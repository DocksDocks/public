import { describe, expect, it } from "vitest";
import { startTimeWithinLimit } from "../../scripts/package-smoke";

// Medians measured by `smoke:package` on Linux x64 with Bun 1.4.4: the
// installed bin, the installed cli/src/main.ts, and `bun -e 0`.
const MEASURED = { bundle: 60.3, source: 162.0, bun: 3.8 } as const;

describe("start-time gate", () => {
  it("passes the measured medians", () => {
    expect(startTimeWithinLimit(MEASURED)).toBe(true);
  });

  // A loaded host delays every process start alike, so the delay must not
  // decide the verdict.
  it.each([0, 40, 200])("keeps the verdict when every start is %i ms later", (delay) => {
    expect(
      startTimeWithinLimit({
        bundle: MEASURED.bundle + delay,
        source: MEASURED.source + delay,
        bun: MEASURED.bun + delay,
      }),
    ).toBe(true);
  });

  it("fails a bundle that saves less than half of the source's own start", () => {
    expect(startTimeWithinLimit({ bundle: 100, source: 162, bun: 12 })).toBe(false);
  });
});
