import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_OMP_SESSION_MODEL,
  HARNESSES,
  engineHome,
  readHarnessSelection,
  readOmpSessionModel,
  writeHarnessSelection,
  writeOmpSessionModel,
  type Harness,
} from "../../src/engine-native/harnesses";
import { kitDbFile } from "../../src/engine-native/kitDb";

let home = "";

function legacyFile(): string {
  return join(home, ".docks-kit", "state.json");
}

function writeLegacyState(content: string): void {
  mkdirSync(join(home, ".docks-kit"), { recursive: true });
  writeFileSync(legacyFile(), content);
}

describe("harness selection state", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "docks-harness-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("returns undefined when the state file is absent", () => {
    expect(readHarnessSelection(home)).toBeUndefined();
  });

  it("imports a valid legacy state.json once and renames it", () => {
    writeLegacyState(
      JSON.stringify({
        version: 1,
        harnesses: ["omp", "unknown", "codex", "codex"],
        ompSession: { selector: "a/b", thinking: "high" },
      }),
    );

    expect(readHarnessSelection(home)).toEqual(["codex", "omp"]);
    expect(readOmpSessionModel(home)).toEqual({ selector: "a/b", thinking: "high" });
    expect(existsSync(legacyFile())).toBe(false);
    expect(existsSync(`${legacyFile()}.migrated`)).toBe(true);
  });

  it("imports nothing from an invalid legacy file and still renames it", () => {
    writeLegacyState("{invalid");

    expect(readHarnessSelection(home)).toBeUndefined();
    expect(existsSync(legacyFile())).toBe(false);
    expect(existsSync(`${legacyFile()}.migrated`)).toBe(true);
  });

  it("creates no store when a read finds neither file", () => {
    expect(readHarnessSelection(home)).toBeUndefined();
    expect(readOmpSessionModel(home)).toBeUndefined();
    expect(existsSync(kitDbFile(home))).toBe(false);
  });

  it("refuses a store from a newer schema", () => {
    writeHarnessSelection(home, ["claude"]);
    const db = new DatabaseSync(kitDbFile(home));
    db.exec("PRAGMA user_version = 99");
    db.close();

    expect(readHarnessSelection(home)).toBeUndefined();
    expect(readOmpSessionModel(home)).toBeUndefined();
    expect(() => writeHarnessSelection(home, ["codex"])).toThrow(/schema 99/);
    const after = new DatabaseSync(kitDbFile(home), { readOnly: true });
    const version = after.prepare("PRAGMA user_version").get()?.["user_version"];
    const rows = after.prepare("SELECT harness FROM harness_selection").all();
    after.close();
    expect(version).toBe(99);
    expect(rows).toEqual([{ harness: "claude" }]);
  });

  it("migrates once and keeps rows across opens", () => {
    writeHarnessSelection(home, ["agents", "claude"]);
    writeOmpSessionModel(home, { selector: "a/b" });

    expect(readHarnessSelection(home)).toEqual(["claude", "agents"]);
    const db = new DatabaseSync(kitDbFile(home), { readOnly: true });
    const version = db.prepare("PRAGMA user_version").get()?.["user_version"];
    db.close();
    expect(version).toBe(1);
    expect(readOmpSessionModel(home)).toEqual({ selector: "a/b" });
  });

  it("writes and reads harnesses in canonical order without duplicates", () => {
    writeHarnessSelection(home, ["omp", "claude", "omp", "agents", "codex"]);

    expect(readHarnessSelection(home)).toEqual(HARNESSES);
  });

  it("refuses to write an empty harness selection", () => {
    expect(() => writeHarnessSelection(home, [])).toThrow(/empty harness selection/i);
  });

  it("refuses to write a selection containing only unknown harness names", () => {
    const unknown = ["unknown"] as unknown as ReadonlyArray<Harness>;

    expect(() => writeHarnessSelection(home, unknown)).toThrow(/known harness/i);
  });

  it("writes the store under the selected home with mode 0600", () => {
    writeHarnessSelection(home, ["claude"]);

    const stateFile = kitDbFile(home);
    expect(stateFile).toBe(`${home}/.docks-kit/kit.db`);
    expect(existsSync(stateFile)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(stateFile).mode & 0o777).toBe(0o600);
    }
  });

  it("tightens an existing permissive state directory to 0700", () => {
    if (process.platform === "win32") return;
    mkdirSync(`${home}/.docks-kit`, { recursive: true, mode: 0o755 });
    chmodSync(`${home}/.docks-kit`, 0o755);

    writeHarnessSelection(home, ["omp"]);

    expect(statSync(`${home}/.docks-kit`).mode & 0o777).toBe(0o700);
  });

  it("keeps every state read and write inside the selected home", () => {
    expect(kitDbFile(home).startsWith(home)).toBe(true);

    writeHarnessSelection(home, ["agents"]);
    expect(readHarnessSelection(home)).toEqual(["agents"]);
  });

  it("resolves the engine home from HOME with a homedir fallback", () => {
    expect(engineHome({ HOME: "/fixture/home" })).toBe("/fixture/home");
    expect(engineHome({})).toBe(homedir());
    expect(engineHome({ HOME: "" })).toBe(homedir());
  });
});

describe("omp session model state", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "docks-omp-session-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("keeps a stored ompSession when a harness selection is written", () => {
    writeOmpSessionModel(home, {
      selector: "provider/model-free",
      thinking: "xhigh",
      advisorThinking: "medium",
    });

    writeHarnessSelection(home, ["claude"]);

    expect(readOmpSessionModel(home)).toEqual({
      selector: "provider/model-free",
      thinking: "xhigh",
      advisorThinking: "medium",
    });
    expect(readHarnessSelection(home)).toEqual(["claude"]);
  });

  it("keeps stored harnesses when an omp session model is written", () => {
    writeHarnessSelection(home, ["codex", "agents"]);

    writeOmpSessionModel(home, { selector: "provider/model-free", thinking: "low" });

    expect(readHarnessSelection(home)).toEqual(["codex", "agents"]);
    expect(readOmpSessionModel(home)).toEqual({ selector: "provider/model-free", thinking: "low" });
  });

  it("returns undefined for a missing state file", () => {
    expect(readOmpSessionModel(home)).toBeUndefined();
  });

  it("drops a blank legacy level while keeping the valid one on import", () => {
    writeLegacyState(
      JSON.stringify({
        version: 1,
        ompSession: { selector: "provider/model-free", thinking: "  ", advisorThinking: "low" },
      }),
    );

    expect(readOmpSessionModel(home)).toEqual({
      selector: "provider/model-free",
      advisorThinking: "low",
    });
  });

  it("round-trips a written model with all three fields", () => {
    writeOmpSessionModel(home, {
      selector: "provider/model-free",
      thinking: "medium",
      advisorThinking: "low",
    });

    expect(readOmpSessionModel(home)).toEqual({
      selector: "provider/model-free",
      thinking: "medium",
      advisorThinking: "low",
    });
  });

  it("round-trips a level-free model with both level fields absent", () => {
    writeOmpSessionModel(home, { selector: "provider/model-free" });

    const stored = readOmpSessionModel(home);
    expect(stored).toEqual({ selector: "provider/model-free" });
    expect(stored).not.toHaveProperty("thinking");
    expect(stored).not.toHaveProperty("advisorThinking");
  });

  it("leaves no stale level behind when a level-free model overwrites a levelled one", () => {
    writeOmpSessionModel(home, {
      selector: "provider/model-free",
      thinking: "xhigh",
      advisorThinking: "medium",
    });

    writeOmpSessionModel(home, { selector: "provider/other-free" });

    const stored = readOmpSessionModel(home);
    expect(stored).toEqual({ selector: "provider/other-free" });
    expect(stored).not.toHaveProperty("thinking");
    expect(stored).not.toHaveProperty("advisorThinking");
  });

  it("rejects a blank selector", () => {
    expect(() => writeOmpSessionModel(home, { selector: "  ", thinking: "xhigh" })).toThrow(
      /selector/i,
    );
  });

  it("exposes the free session default", () => {
    expect(DEFAULT_OMP_SESSION_MODEL.selector).toBe("opencode-zen/muse-spark-1.3-contributor-free");
    expect(DEFAULT_OMP_SESSION_MODEL.thinking).toBe("xhigh");
    expect(DEFAULT_OMP_SESSION_MODEL.advisorThinking).toBe("medium");
  });

  it("writes the store and directory with private modes", () => {
    writeOmpSessionModel(home, { selector: "provider/model-free", thinking: "xhigh" });

    expect(existsSync(kitDbFile(home))).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(kitDbFile(home)).mode & 0o777).toBe(0o600);
      expect(statSync(join(home, ".docks-kit")).mode & 0o777).toBe(0o700);
    }
  });
});
