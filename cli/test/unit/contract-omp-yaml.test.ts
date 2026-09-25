import { describe, expect, it } from "vitest";

import { mergeOmpConfig, mergeOmpModels } from "../../src/engine-native/ompYaml";

describe("omp YAML document boundaries", () => {
  it("names the file when models.yml or SoT config.yml is malformed", () => {
    expect(() => mergeOmpModels("value: 1\n", "[unterminated\n")).toThrow(
      /Invalid deployed omp models\.yml YAML:/,
    );
    expect(() => mergeOmpConfig("[unterminated\n", "value: 1\n")).toThrow(
      /Invalid SoT omp config\.yml YAML:/,
    );
  });

  it("rejects a non-null deployed scalar instead of overwriting user config", () => {
    expect(() => mergeOmpConfig("managed: true\n", "invalid-root\n")).toThrow(
      "Deployed omp config.yml YAML root must be a mapping",
    );
  });

  it("rejects a missing SoT document when the deployed file has data", () => {
    expect(() => mergeOmpConfig("", "value: 1\n")).toThrow(
      /SoT omp config\.yml YAML root must be a mapping/,
    );
  });
});
