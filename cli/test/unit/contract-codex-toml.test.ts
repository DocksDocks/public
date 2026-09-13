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
  // Pure replacement.
  it("inserts the replacement for empty content with one trailing newline", () => {
    expect(replaceTopLevelSetting("", "model", 'model = "x"')).toBe('model = "x"\n');
  });

  it("replaces one top-level key and ends with a newline", () => {
    const next = replaceTopLevelSetting('model = "a"\nfoo = 1\n', "model", 'model = "b"');

    expect(next).toBe('model = "b"\nfoo = 1\n');
  });

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

    expect(next).toBe("[table]\nkey = 1\n".replace("[table]", 'model = "x"\n[table]'));
  });

  it("treats indented keys as non-top-level and appends", () => {
    const next = replaceTopLevelSetting('  model = "x"\n', "model", 'model = "y"');

    expect(next).toContain('  model = "x"');
    expect(next).toContain('model = "y"');
  });

  // File merges use temp files.
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

  it("copies SoT top-level keys and stops before tables", () => {
    const file = userFile('model = "old"\n[table]\nkey = 1\n');

    mergeTopLevelSettings('model = "new"\nother = 2\n[table]\nkey = 99\n', file);

    const next = readFileSync(file, "utf8");
    expect(next).toContain('model = "new"');
    expect(next).toContain("other = 2");
    expect(next).toContain("key = 1");
    expect(next).not.toContain("key = 99");
  });

  it("leaves the user file alone for empty SoT text", () => {
    const before = 'model = "keep"\n';
    const file = userFile(before);

    mergeTopLevelSettings("", file);

    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("replaces the managed table once and keeps user tables", () => {
    const file = userFile('[mcp_servers.foo]\ncommand = "old"\n\n[custom]\nkeep = true\n');

    mergeTableSettings('[mcp_servers.foo]\ncommand = "new"\n', file);

    const next = readFileSync(file, "utf8");
    expect(next).toContain('command = "new"');
    expect(next).not.toContain('command = "old"');
    expect(next).toContain("[custom]");
    expect(next.match(/\[mcp_servers\.foo\]/g)).toHaveLength(1);
  });

  it("leaves the user file alone for a malformed SoT header", () => {
    const before = "[custom]\nkeep = true\n";
    const file = userFile(before);

    mergeTableSettings("[unclosed\nkey = 1\n", file);

    expect(readFileSync(file, "utf8")).toBe(before);
  });

  // Line parser for top-level strings.
  it("reads the first duplicate top-level value", () => {
    expect(topLevelTomlString('model = "a"\nmodel = "b"\n', "model")).toBe("a");
  });

  it("returns undefined for empty input and table-scoped keys", () => {
    expect(topLevelTomlString("", "model")).toBeUndefined();
    expect(topLevelTomlString('[table]\nmodel = "x"\n', "model")).toBeUndefined();
  });

  it("ignores single-quoted and unquoted values", () => {
    expect(topLevelTomlString("model = 'x'\n", "model")).toBeUndefined();
    expect(topLevelTomlString("model = 42\n", "model")).toBeUndefined();
  });
});
