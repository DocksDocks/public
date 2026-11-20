import { describe, expect, it } from "vitest";

import { outputText } from "../../lib/agentDocs/entry";

// The suites compare decoded output, so the decode must keep every byte: a leading byte-order mark that a helper
// printed must reach the comparison, and a byte that is not UTF-8 must fail the case.
describe("agent-docs output text", () => {
  it("keeps a leading UTF-8 byte-order mark", () => {
    expect(outputText(Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0a]))).toBe("\uFEFFa\n");
  });

  it("refuses a byte that is not UTF-8", () => {
    expect(() => outputText(Buffer.from([0x61, 0xff]))).toThrow(TypeError);
  });
});
