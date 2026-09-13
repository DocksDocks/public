import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { mergeOmpConfig, mergeOmpModels } from "../../src/engine-native/ompYaml";

describe("omp YAML merge contract", () => {
  it("returns SoT bytes for empty and whitespace deployed files", () => {
    const sot = "# managed\nvalue: 1\n";

    expect(mergeOmpConfig(sot, "")).toBe(sot);
    expect(mergeOmpConfig(sot, " \n\t\n")).toBe(sot);
    expect(mergeOmpModels(sot, "")).toBe(sot);
  });

  it("returns SoT text for a null deployed scalar", () => {
    const sot = "value: 1\n";

    expect(mergeOmpConfig(sot, "null\n")).toBe(sot);
  });

  it("lets SoT win on scalar and sequence conflicts", () => {
    expect(parse(mergeOmpConfig("theme: kit\n", "theme: user\n"))).toEqual({ theme: "kit" });
    expect(
      parse(mergeOmpConfig("models:\n  - kit/model\n", "models:\n  - user/a\n  - user/b\n")),
    ).toEqual({
      models: ["kit/model"],
    });
  });

  it("merges nested mappings and keeps deployed-only keys", () => {
    const merged = mergeOmpConfig("a: { b: 1 }\n", "a: { c: 2 }\nuserOnly: true\n");

    expect(parse(merged)).toEqual({ a: { b: 1, c: 2 }, userOnly: true });
  });

  it("drops slash keys under retry.fallbackChains in config only", () => {
    const sot = "retry:\n  fallbackChains:\n    coding:\n      - kit/model\n";
    const deployed =
      'retry:\n  fallbackChains:\n    reviewer:\n      - user/reviewer\n    "provider/*":\n      - user/wildcard\n';

    expect(parse(mergeOmpConfig(sot, deployed))).toEqual({
      retry: { fallbackChains: { coding: ["kit/model"], reviewer: ["user/reviewer"] } },
    });
    expect(parse(mergeOmpModels(sot, deployed))).toEqual({
      retry: {
        fallbackChains: {
          coding: ["kit/model"],
          reviewer: ["user/reviewer"],
          "provider/*": ["user/wildcard"],
        },
      },
    });
  });

  it("keeps slash keys outside retry.fallbackChains", () => {
    const merged = mergeOmpConfig(
      "modelRoles:\n  coding: kit/model\n",
      'modelRoles:\n  "provider/*": user/model\n',
    );

    expect(parse(merged)).toEqual({
      modelRoles: { coding: "kit/model", "provider/*": "user/model" },
    });
  });

  it("names the file in invalid-YAML diagnostics", () => {
    expect(() => mergeOmpConfig("value: 1\n", "[unterminated\n")).toThrow(
      /Invalid deployed omp config\.yml YAML:/,
    );
    expect(() => mergeOmpModels("value: 1\n", "[unterminated\n")).toThrow(
      /Invalid deployed omp models\.yml YAML:/,
    );
    expect(() => mergeOmpConfig("[unterminated\n", "value: 1\n")).toThrow(
      /Invalid SoT omp config\.yml YAML:/,
    );
  });

  it("rejects non-mapping roots with the file name", () => {
    expect(() => mergeOmpConfig("value: 1\n", "- a\n- b\n")).toThrow(
      /Deployed omp config\.yml YAML root must be a mapping/,
    );
    expect(() => mergeOmpConfig("value: 1\n", "42\n")).toThrow(
      /Deployed omp config\.yml YAML root must be a mapping/,
    );
    expect(() => mergeOmpConfig("- a\n", "value: 1\n")).toThrow(
      /SoT omp config\.yml YAML root must be a mapping/,
    );
    expect(() => mergeOmpModels("value: 1\n", "- a\n")).toThrow(
      /Deployed omp models\.yml YAML root must be a mapping/,
    );
  });

  it("rejects an empty SoT document as a non-mapping root", () => {
    expect(() => mergeOmpConfig("", "value: 1\n")).toThrow(
      /SoT omp config\.yml YAML root must be a mapping/,
    );
  });
});
