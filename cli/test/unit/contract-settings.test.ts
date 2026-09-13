import { describe, expect, it } from "vitest";

import { mergeSettings, reconcileSettings } from "../../src/engine-native/settings";
import { deepMerge, parseJson, uniqueStrings, type Json } from "../../src/engine-native/jq";

describe("settings merge contract", () => {
  it("lets SoT win on conflict and keeps user-only keys", () => {
    const merged = mergeSettings(
      { theme: "kit", shared: "sot" },
      { theme: "user", extra: "kept" },
    ) as Record<string, Json>;

    expect(merged["theme"]).toBe("kit");
    expect(merged["shared"]).toBe("sot");
    expect(merged["extra"]).toBe("kept");
  });

  it("merges nested objects instead of replacing them", () => {
    const merged = mergeSettings({ env: { B: "2" } }, { env: { A: "1" } }) as Record<string, Json>;

    expect(merged["env"]).toEqual({ A: "1", B: "2" });
  });

  it("replaces non-permission arrays wholesale with the SoT array", () => {
    const merged = mergeSettings({ hooks: ["sot"] }, { hooks: ["user", "extra"] }) as Record<
      string,
      Json
    >;

    expect(merged["hooks"]).toEqual(["sot"]);
  });

  it("unions permission arrays sorted and deduped", () => {
    const merged = mergeSettings(
      { permissions: { allow: ["b", "a"], deny: [], ask: [] } },
      { permissions: { allow: ["a", "c"], deny: ["x"], ask: [] } },
    ) as Record<string, Record<string, Array<string>>>;

    expect(merged["permissions"]["allow"]).toEqual(["a", "b", "c"]);
    expect(merged["permissions"]["deny"]).toEqual(["x"]);
    expect(merged["permissions"]["ask"]).toEqual([]);
  });

  it("ignores non-string permission entries when unioning", () => {
    const merged = mergeSettings(
      { permissions: { allow: ["b"], deny: [], ask: [] } },
      { permissions: { allow: [42, null, "a"], deny: [], ask: [] } },
    ) as Record<string, Record<string, Array<string>>>;

    expect(merged["permissions"]["allow"]).toEqual(["a", "b"]);
  });

  it("replaces permission arrays wholesale on reconcile", () => {
    const reconciled = reconcileSettings(
      { permissions: { allow: ["sot"], deny: [], ask: [] }, theme: "kit" },
      { permissions: { allow: ["user", "extra"], deny: ["d"], ask: ["q"] }, extra: "kept" },
    ) as Record<string, Json>;

    expect(reconciled["permissions"]).toEqual({ allow: ["sot"], deny: [], ask: [] });
    expect(reconciled["theme"]).toBe("kit");
    expect(reconciled["extra"]).toBe("kept");
  });

  it("returns empty permissions on merge of two empty objects", () => {
    expect(mergeSettings({}, {})).toEqual({ permissions: { allow: [], deny: [], ask: [] } });
  });

  it("returns an empty object on reconcile of two empty objects", () => {
    expect(reconcileSettings({}, {})).toEqual({});
  });

  it("replaces arrays and scalars instead of merging them", () => {
    expect(deepMerge([1] as unknown as Json, [2] as unknown as Json)).toEqual([2]);
    expect(deepMerge({ a: 1 }, [2] as unknown as Json)).toEqual([2]);
  });

  it("sorts and dedupes strings by codepoint", () => {
    expect(uniqueStrings(["b", "a", "b", "A"])).toEqual(["A", "a", "b"]);
  });

  it("rejects invalid JSON while parsing valid documents", () => {
    expect(parseJson("")).toBeUndefined();
    expect(parseJson("{bad")).toBeUndefined();
    expect(parseJson("[unterminated")).toBeUndefined();
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson("null")).toBeNull();
  });

  it("lets the last duplicate JSON key win", () => {
    expect(parseJson('{"a":1,"a":2}')).toEqual({ a: 2 });
  });
});
