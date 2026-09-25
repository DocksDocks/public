import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  mergeTableSettings,
  mergeTopLevelSettings,
  replaceTopLevelSetting,
} from "../../src/engine-native/codexToml";
import { topLevelTomlString } from "../../src/manifests";

function parseToml(content: string): Record<string, unknown> {
  const parsed = nodeSpawnSync(
    "bun",
    ["-e", "console.log(JSON.stringify(Bun.TOML.parse(await Bun.stdin.text())))"],
    { input: content, encoding: "utf8" },
  );
  expect(parsed.status, parsed.stderr).toBe(0);
  return JSON.parse(parsed.stdout) as Record<string, unknown>;
}

describe("codex TOML contract", () => {
  it("collapses duplicate top-level keys into one replacement", () => {
    const next = replaceTopLevelSetting('model = "a"\nmodel = "b"\n', "model", 'model = "c"');

    expect(next).toBe('model = "c"\n');
  });

  it("replaces an indented top-level key without leaving a duplicate", () => {
    const next = replaceTopLevelSetting('  model = "x"\n', "model", 'model = "y"');

    expect(next).toBe('model = "y"\n');
    expect(parseToml(next)).toEqual({ model: "y" });
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

  it.each([
    ["table", "  [table]\nvalue = 1\n", { model: "x", table: { value: 1 } }],
    ["array of tables", "  [[items]]\nvalue = 1\n", { model: "x", items: [{ value: 1 }] }],
  ])("inserts a top-level key before an indented %s", (_kind, content, parsed) => {
    const next = replaceTopLevelSetting(content, "model", 'model = "x"');

    expect(next).toBe(`model = "x"\n${content}`);
    expect(parseToml(next)).toEqual(parsed);
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

  it("copies an indented SoT key but stops at an indented SoT table", () => {
    const file = userFile("  [custom]\nkeep = true\n");

    mergeTopLevelSettings('  model = "kit"\n  [managed]\nrogue = 9\n', file);

    const next = readFileSync(file, "utf8");
    expect(next).toBe('  model = "kit"\n  [custom]\nkeep = true\n');
    expect(parseToml(next)).toEqual({ model: "kit", custom: { keep: true } });
  });

  it("replaces an indented deployed key before an indented table", () => {
    const file = userFile('  model = "user"\n  [custom]\nkeep = true\n');

    mergeTopLevelSettings('model = "kit"\n', file);

    const next = readFileSync(file, "utf8");
    expect(next).toBe('model = "kit"\n  [custom]\nkeep = true\n');
    expect(parseToml(next)).toEqual({ model: "kit", custom: { keep: true } });
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
