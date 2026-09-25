import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { resolveFreeSelector } from "../../src/commands/omp";
import { readOmpSessionModel } from "../../src/engine-native/harnesses";
import { kitDbFile } from "../../src/engine-native/kitDb";
import type { CatalogModel } from "../../src/engine-native/ompOverlay";
import { runPublicCli } from "../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir } from "../lib/goldenResources";
import { SPAWN_TIMEOUT_MS } from "../lib/spawnTimeout";

const NATIVE = { nativeHost: true } as const;
afterAll(cleanupTemporaryDirs);

const FREE: ReadonlyArray<CatalogModel> = [
  {
    selector: "opencode-zen/muse-spark-1.3-contributor-free",
    name: "Muse Spark 1.3 Free",
    thinking: ["minimal", "low", "medium", "high", "xhigh"],
    contextWindow: 1048576,
  },
  {
    selector: "opencode-zen/glm-4.7-free",
    name: "GLM 4.7 Free",
    thinking: ["minimal", "low", "medium"],
    contextWindow: 204800,
  },
];

describe("resolveFreeSelector", () => {
  it("prefers an exact selector over another free selector that contains it", () => {
    const resolved = resolveFreeSelector(" opencode-zen/glm-4.7-free ", [
      ...FREE,
      { ...FREE[1]!, selector: "opencode-zen/glm-4.7-free-extended" },
    ]);
    expect(resolved).toEqual({ ok: true, model: FREE[1] });
  });

  it("matches a unique case-insensitive substring", () => {
    const resolved = resolveFreeSelector("SPARK", FREE);
    expect(resolved).toEqual({ ok: true, model: FREE[0] });
  });

  it("rejects an ambiguous substring by listing the matches", () => {
    expect(resolveFreeSelector("opencode-zen", FREE)).toEqual({
      ok: false,
      message:
        "Model 'opencode-zen' is ambiguous; matches: opencode-zen/muse-spark-1.3-contributor-free, opencode-zen/glm-4.7-free. Pass the exact selector.",
    });
  });

  it("rejects an unknown selector without choosing a paid model", () => {
    expect(resolveFreeSelector("opencode-zen/kimi-paid", FREE)).toEqual({
      ok: false,
      message:
        "Model 'opencode-zen/kimi-paid' is not in the free catalog. Free models: opencode-zen/muse-spark-1.3-contributor-free, opencode-zen/glm-4.7-free",
    });
  });

  it("rejects a blank model selector", () => {
    expect(resolveFreeSelector(" \t ", FREE)).toEqual({
      ok: false,
      message: "Model selector must not be empty or blank",
    });
  });
});

describe("omp command", () => {
  const selector = "opencode-zen/glm-4.7-free";
  const levelFreeSelector = "provider/level-free";
  const stubDir = makeStubDir(
    {
      omp: `if (args[0] === "models" && args[1] === "--json") {
  console.log(JSON.stringify({models:[
    {selector:"${selector}",name:"GLM Free",thinking:["low","high"],contextWindow:204800,cost:{input:0,output:0}},
    {selector:"${levelFreeSelector}",name:"Level Free",thinking:[],contextWindow:4096,cost:{input:0,output:0}},
    {selector:"provider/paid",name:"Paid",thinking:["high"],contextWindow:4096,cost:{input:0,output:1}}
  ]}))
}`,
    },
    NATIVE,
  );

  it(
    "starts with a private free overlay, remembers it, then switches without rewriting it",
    () => {
      const first = runPublicCli(
        ["omp", "--model", "GLM", "-p", "hello"],
        "home-fresh",
        stubDir,
        NATIVE,
      );
      expect(first.exitCode).toBe(0);
      expect(first.stderr).toContain(
        `Starting omp with ${selector} at high thinking, advisor at low (session only; deployed config unchanged)`,
      );
      expect(first.stdout).toBe("");
      expect(readOmpSessionModel(first.home)).toEqual({
        selector,
        thinking: "high",
        advisorThinking: "low",
      });

      const overlayDir = join(first.home, ".cache", "docks-kit");
      const [firstName] = readdirSync(overlayDir);
      expect(firstName).toMatch(/^omp-free-[A-Za-z0-9._-]+\.yml$/);
      const firstPath = join(overlayDir, firstName!);
      if (process.platform !== "win32") {
        expect(statSync(overlayDir).mode & 0o777).toBe(0o700);
        expect(statSync(firstPath).mode & 0o777).toBe(0o600);
      }
      const firstOverlay = readFileSync(firstPath, "utf8");
      expect(parse(firstOverlay)).toMatchObject({
        defaultThinkingLevel: "high",
        modelRoles: { default: `${selector}:high`, advisor: `${selector}:low` },
        retry: { fallbackChains: { default: [], advisor: [] } },
      });
      const argvLog = join(first.home, ".golden-argv.log");
      expect(readFileSync(argvLog, "utf8").trim().split("\n")).toEqual([
        "omp\tmodels --json",
        `omp\t--config ${first.home}/.cache/docks-kit/${firstName} -p hello`,
      ]);

      const options = { ...NATIVE, reuseHome: first.home };
      const plain = runPublicCli(["omp", "-p", "again"], "home-fresh", stubDir, options);
      expect(plain.exitCode).toBe(0);
      expect(readFileSync(argvLog, "utf8").trim()).toBe(
        `omp\t--config ${first.home}/.cache/docks-kit/${firstName} -p again`,
      );

      const switched = runPublicCli(
        ["omp", "--model", levelFreeSelector],
        "home-fresh",
        stubDir,
        options,
      );
      expect(switched.exitCode).toBe(0);
      expect(switched.stderr).toContain(
        `Starting omp with ${levelFreeSelector} at the model default thinking level (session only; deployed config unchanged)`,
      );
      expect(readOmpSessionModel(first.home)).toEqual({ selector: levelFreeSelector });
      const names = readdirSync(overlayDir);
      expect(names).toHaveLength(2);
      const secondPath = join(
        overlayDir,
        names.find((name) => name !== firstName)!,
      );
      const second = parse(readFileSync(secondPath, "utf8")) as Record<string, unknown>;
      expect(second).not.toHaveProperty("defaultThinkingLevel");
      expect(second).not.toHaveProperty("task");
      expect((second["modelRoles"] as Record<string, string>)["default"]).toBe(levelFreeSelector);
      expect((second["modelRoles"] as Record<string, string>)["advisor"]).toBe(levelFreeSelector);
      expect(readFileSync(firstPath, "utf8")).toBe(firstOverlay);
      expect(existsSync(join(first.home, ".omp", "agent"))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "refuses a noninteractive picker before contacting omp or creating session state",
    () => {
      const run = runPublicCli(["omp", "--pick"], "home-fresh", stubDir, NATIVE);
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("Picking needs a terminal; pass --model <selector> instead");
      expect(readFileSync(join(run.home, ".golden-argv.log"), "utf8")).toBe("");
      expect(existsSync(kitDbFile(run.home))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "rejects a malformed catalog before saving a model or starting omp",
    () => {
      const badCatalog = makeStubDir(
        { omp: `if (args[0] === "models") console.log("not JSON")` },
        NATIVE,
      );
      const run = runPublicCli(["omp", "--model", "GLM"], "home-fresh", badCatalog, NATIVE);
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain(
        "'omp models --json' returned output that is not JSON; verify the omp version, then retry",
      );
      expect(readFileSync(join(run.home, ".golden-argv.log"), "utf8")).toBe("omp\tmodels --json\n");
      expect(existsSync(kitDbFile(run.home))).toBe(false);
      expect(existsSync(join(run.home, ".cache", "docks-kit"))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );
});
