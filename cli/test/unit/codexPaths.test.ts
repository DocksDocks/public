import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { codexHome } from "../../src/engine-native/codexPaths";

describe("codexHome", () => {
  it("uses CODEX_HOME when it is set, as Codex does", () => {
    expect(codexHome("/home/u", { CODEX_HOME: "/srv/codex" })).toBe("/srv/codex");
    expect(codexHome("/home/u", { CODEX_HOME: "rel/codex" })).toBe(resolve("rel/codex"));
  });

  it("falls back to ~/.codex when CODEX_HOME is unset or empty", () => {
    expect(codexHome("/home/u", {})).toBe("/home/u/.codex");
    expect(codexHome("/home/u", { CODEX_HOME: "" })).toBe("/home/u/.codex");
  });
});
