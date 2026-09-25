import { describe, expect, it } from "vitest";

import { parseCompactWindow } from "../../src/engine-native/parseModifiers";

describe("compact-window token parsing", () => {
  it("normalizes token counts and rejects invalid input", () => {
    expect(parseCompactWindow("680000")).toBe("680000");
    expect(parseCompactWindow("680k")).toBe("680000");
    expect(parseCompactWindow("680K")).toBe("680000");
    expect(parseCompactWindow("0k")).toBe("0");
    expect(parseCompactWindow("001k")).toBe("1000");
    for (const invalid of ["", "k", "abc", "12.5k", "-5", "680 k", "680k "]) {
      expect(parseCompactWindow(invalid), invalid).toBeUndefined();
    }
  });
});
