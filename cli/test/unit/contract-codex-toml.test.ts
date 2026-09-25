import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  mergeTableSettings,
  mergeTopLevelSettings,
  replaceTopLevelSetting,
} from "../../src/engine-native/codexToml";
import { topLevelTomlString } from "../../src/manifests";

describe("codex TOML contract", () => {
  it("collapses duplicate top-level keys into one replacement", () => {
    const next = replaceTopLevelSetting('model = "a"\nmodel = "b"\n', "model", 'model = "c"');

    expect(next).toBe('model = "c"\n');
  });

  it("keeps a table-scoped key while replacing the top-level key", () => {
    const next = replaceTopLevelSetting(
      'model = "top"\n[table]\nmodel = "inner"\n',
      "model",
      'model = "new"',
    );

    expect(next).toBe('model = "new"\n[table]\nmodel = "inner"\n');
  });

  it("inserts before the first table when the key is absent", () => {
    const next = replaceTopLevelSetting("[table]\nkey = 1\n", "model", 'model = "x"');

    expect(next).toBe('model = "x"\n[table]\nkey = 1\n');
  });

  it("writes one trailing newline when adding a setting to an empty config", () => {
    expect(replaceTopLevelSetting("", "model", 'model = "x"')).toBe('model = "x"\n');
  });

  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docks-kit-contract-toml-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function userFile(content: string): string {
    const file = join(dir, "config.toml");
    writeFileSync(file, content);
    return file;
  }

  it("replaces SoT top-level keys without importing table keys or deleting user settings", () => {
    const file = userFile('model = "old"\nuser_pref = true\n[table]\nkey = 1\n');

    mergeTopLevelSettings('model = "new"\nother = 2\n[table]\nkey = 99\n', file);

    expect(readFileSync(file, "utf8")).toBe(
      'model = "new"\nuser_pref = true\nother = 2\n[table]\nkey = 1\n',
    );
  });

  it.each([
    ["empty", ""],
    ["comments only", "# no managed settings\n"],
    ["malformed header", 'not a setting\n[table]\nmodel = "other"\n'],
  ])("leaves the user config intact when the SoT header is %s", (_case, sot) => {
    const before = 'model = "user"\n[custom]\nkeep = true\n';
    const file = userFile(before);

    mergeTopLevelSettings(sot, file);

    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("replaces the managed table once and keeps user tables", () => {
    const file = userFile('[mcp_servers.foo]\ncommand = "old"\n\n[custom]\nkeep = true\n');

    mergeTableSettings('[mcp_servers.foo]\ncommand = "new"\n', file);

    expect(readFileSync(file, "utf8")).toBe(
      '[custom]\nkeep = true\n\n[mcp_servers.foo]\ncommand = "new"\n',
    );
  });

  it("reads the deployed top-level model rather than a table-scoped model", () => {
    expect(
      topLevelTomlString('  model = "user-choice" # note\n[table]\nmodel = "other"\n', "model"),
    ).toBe("user-choice");
  });

  it("returns undefined for empty input and table-scoped keys", () => {
    expect(topLevelTomlString("", "model")).toBeUndefined();
    expect(topLevelTomlString('[table]\nmodel = "x"\n', "model")).toBeUndefined();
  });

  it("ignores a non-string model", () => {
    expect(topLevelTomlString("model = 42\n", "model")).toBeUndefined();
  });
});
