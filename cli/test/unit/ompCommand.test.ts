import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  forwardedProfile,
  rejectedForwardedFlag,
  resolveFreeSelector,
} from "../../src/commands/omp";
import { readOmpSessionModel } from "../../src/engine-native/harnesses";
import { kitDbFile } from "../../src/engine-native/kitDb";
import { overlayFileName, type CatalogModel } from "../../src/engine-native/ompOverlay";
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

describe("forwardedProfile", () => {
  it("lists every --profile <name> and --profile=<name> value in argv order", () => {
    expect(forwardedProfile(["-p", "hi"])).toEqual({ ok: true, profiles: [] });
    expect(forwardedProfile(["--profile", "work", "-p", "hi"])).toEqual({
      ok: true,
      profiles: ["work"],
    });
    expect(forwardedProfile(["--profile=work"])).toEqual({ ok: true, profiles: ["work"] });
    expect(forwardedProfile(["--profile", "a", "--profile=b"])).toEqual({
      ok: true,
      profiles: ["a", "b"],
    });
    expect(forwardedProfile(["--profile", "a", "-p", "x", "--profile=b"])).toEqual({
      ok: true,
      profiles: ["a", "b"],
    });
  });

  it("does not stop at -- because omp can read that -- as the value of a flag", () => {
    // In `--system-prompt -- --profile work`, omp takes `--` as the prompt
    // and selects the work profile.
    expect(forwardedProfile(["--system-prompt", "--", "--profile", "work"])).toEqual({
      ok: true,
      profiles: ["work"],
    });
    expect(forwardedProfile(["--", "--profile", "work"])).toEqual({
      ok: true,
      profiles: ["work"],
    });
  });

  it("rejects a missing or empty profile name as omp does", () => {
    for (const args of [["--profile"], ["--profile", "-p", "hi"], ["--profile="]]) {
      expect(forwardedProfile(args)).toEqual({
        ok: false,
        message: "--profile requires a profile name",
      });
    }
  });
});

describe("rejectedForwardedFlag", () => {
  const MODEL_FLAGS = [
    "--config",
    "--model",
    "--smol",
    "--slow",
    "--plan",
    "--models",
    "--provider",
    "--prewalk-into",
    "--plan-yolo-into",
  ] as const;

  const expectRejected = (args: ReadonlyArray<string>, flag: string): string => {
    const result = rejectedForwardedFlag(args);
    expect(result.ok).toBe(false);
    const message = result.ok ? "" : result.message;
    expect(message).toContain(flag);
    expect(message).toContain("--model <selector>");
    expect(message).toContain("--pick");
    expect(message).toContain("run omp directly");
    return message;
  };

  it.each(MODEL_FLAGS)("rejects %s in the --flag value and --flag=value forms", (flag) => {
    expectRejected(["-p", "hi", flag, "paid/x"], flag);
    expectRejected(["-p", "hi", `${flag}=paid/x`], flag);
  });

  it("names PI_CONFIG_FILES for a forwarded --config", () => {
    expect(expectRejected(["--config", "extra.yml"], "--config")).toContain("PI_CONFIG_FILES");
    expect(expectRejected(["--config=extra.yml"], "--config")).toContain("PI_CONFIG_FILES");
  });

  it("rejects a model flag after a forwarded -- because omp can read that -- as a value", () => {
    expectRejected(["-p", "hi", "--", "--smol", "x"], "--smol");
    expectRejected(["--api-key", "--", "--model", "x"], "--model");
  });

  it.each([
    [[]],
    [["--continue"]],
    [["-c"]],
    [["--resume", "abc"]],
    [["-p", "hi"]],
    [["--thinking", "high"]],
    [["--advisor"]],
    [["--prewalk"]],
    [["--plan-yolo"]],
    [["--profile", "work"]],
    [["--api-key", "k"]],
    [["fix the --model docs"]],
  ])("allows %j", (args) => {
    expect(rejectedForwardedFlag(args)).toEqual({ ok: true });
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
      expect(firstName).toBe(
        overlayFileName({ selector, thinking: "high", advisorThinking: "low" }),
      );
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
        `omp\tlaunch --config ${first.home}/.cache/docks-kit/${firstName} --model ${selector}:high -p hello`,
      ]);

      const options = { ...NATIVE, reuseHome: first.home };
      const plain = runPublicCli(["omp", "-p", "again"], "home-fresh", stubDir, options);
      expect(plain.exitCode).toBe(0);
      // Every plain launch checks the remembered model against the live catalog.
      expect(readFileSync(argvLog, "utf8").trim().split("\n")).toEqual([
        "omp\tmodels --json",
        `omp\tlaunch --config ${first.home}/.cache/docks-kit/${firstName} --model ${selector}:high -p again`,
      ]);

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
      // The session runs the --model value it wrote, not a re-read of kit.db,
      // which held the earlier model before this run.
      expect(readFileSync(argvLog, "utf8").trim().split("\n")).toEqual([
        "omp\tmodels --json",
        `omp\tlaunch --config ${first.home}/.cache/docks-kit/${overlayFileName({ selector: levelFreeSelector })} --model ${levelFreeSelector}`,
      ]);
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
    "gives the omp session the overlay and the overlay role models in its environment",
    () => {
      // The session call logs the variables that select a model or load a
      // config, so the test sees what omp and its bash tool inherit.
      const envStub = makeStubDir(
        {
          omp: `if (args[0] === "models" && args[1] === "--json") {
  console.log(JSON.stringify({models:[
    {selector:"${selector}",name:"GLM Free",thinking:["low","high"],contextWindow:204800,cost:{input:0,output:0}}
  ]}))
} else {
  const pick = (name) => process.env[name] ?? null;
  appendFileSync(process.env.HOME + "/.omp-env.log", JSON.stringify({
    PI_CONFIG_FILES: pick("PI_CONFIG_FILES"),
    PI_SMOL_MODEL: pick("PI_SMOL_MODEL"),
    PI_SLOW_MODEL: pick("PI_SLOW_MODEL"),
    PI_PLAN_MODEL: pick("PI_PLAN_MODEL"),
  }) + "\\n")
}`,
        },
        NATIVE,
      );
      const inherited = join("team", "omp-extra.yml");
      const run = runPublicCli(["omp", "--model", "GLM", "-p", "hello"], "home-fresh", envStub, {
        ...NATIVE,
        env: { PI_SMOL_MODEL: "paid/x", PI_CONFIG_FILES: inherited },
      });
      expect(run.exitCode, run.stderr).toBe(0);
      const overlayDir = join(run.home, ".cache", "docks-kit");
      const [overlayName] = readdirSync(overlayDir);
      const overlayPath = join(overlayDir, overlayName!);
      const roles = (parse(readFileSync(overlayPath, "utf8")) as Record<string, unknown>)[
        "modelRoles"
      ] as Record<string, string>;
      const logged = readFileSync(join(run.home, ".omp-env.log"), "utf8").trim().split("\n");
      expect(logged.map((line) => JSON.parse(line) as unknown)).toEqual([
        {
          PI_CONFIG_FILES: [inherited, overlayPath].join(delimiter),
          PI_SMOL_MODEL: roles["smol"],
          PI_SLOW_MODEL: roles["slow"],
          PI_PLAN_MODEL: roles["plan"],
        },
      ]);
      expect(readFileSync(join(run.home, ".golden-argv.log"), "utf8").trim().split("\n")).toEqual([
        "omp\tmodels --json",
        `omp\tlaunch --config ${run.home}/.cache/docks-kit/${overlayName} --model ${selector}:high -p hello`,
      ]);
      // One warning for the exported variable the launcher replaced, none
      // for the two variables the parent did not set.
      const stderrLines = run.stderr.split("\n");
      expect(stderrLines.filter((line) => line.includes("PI_SMOL_MODEL"))).toHaveLength(1);
      expect(stderrLines.filter((line) => line.includes("PI_SLOW_MODEL"))).toEqual([]);
      expect(stderrLines.filter((line) => line.includes("PI_PLAN_MODEL"))).toEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "sends a forwarded omp subcommand word to the free session as message text",
    () => {
      // `launch` first makes omp read `commit` as a prompt instead of running
      // its commit subcommand with its own model selection.
      const run = runPublicCli(["omp", "--model", "GLM", "commit"], "home-fresh", stubDir, NATIVE);
      expect(run.exitCode, run.stderr).toBe(0);
      const [overlayName] = readdirSync(join(run.home, ".cache", "docks-kit"));
      expect(readFileSync(join(run.home, ".golden-argv.log"), "utf8").trim().split("\n")).toEqual([
        "omp\tmodels --json",
        `omp\tlaunch --config ${run.home}/.cache/docks-kit/${overlayName} --model ${selector}:high commit`,
      ]);
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
    "refuses a plain launch whose default model is not in the free catalog",
    () => {
      // The stub catalog does not list DEFAULT_OMP_SESSION_MODEL, as on a host
      // with no opencode login.
      const run = runPublicCli(["omp", "-p", "hello"], "home-fresh", stubDir, NATIVE);
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain(
        "free model 'opencode-zen/muse-spark-1.3-contributor-free' is not available in the omp catalog (renamed, repriced, or provider not logged in); log in to its provider or choose another with --model or --pick",
      );
      expect(readFileSync(join(run.home, ".golden-argv.log"), "utf8")).toBe("omp\tmodels --json\n");
      expect(existsSync(join(run.home, ".cache", "docks-kit"))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "refuses a plain launch whose remembered model left the free catalog",
    () => {
      const first = runPublicCli(["omp", "--model", "GLM"], "home-fresh", stubDir, NATIVE);
      expect(first.exitCode).toBe(0);
      const repriced = makeStubDir(
        {
          omp: `if (args[0] === "models" && args[1] === "--json") {
  console.log(JSON.stringify({models:[
    {selector:"${selector}",name:"GLM",thinking:["low","high"],contextWindow:204800,cost:{input:1,output:1}},
    {selector:"${levelFreeSelector}",name:"Level Free",thinking:[],contextWindow:4096,cost:{input:0,output:0}}
  ]}))
}`,
        },
        NATIVE,
      );
      const run = runPublicCli(["omp"], "home-fresh", repriced, {
        ...NATIVE,
        reuseHome: first.home,
      });
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain(`free model '${selector}' is not available in the omp catalog`);
      expect(readFileSync(join(run.home, ".golden-argv.log"), "utf8")).toBe("omp\tmodels --json\n");
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

  it(
    "resolves --model in the last forwarded profile and checks the model in every candidate profile",
    () => {
      // Each profile has its own login and catalog. `free-model` is ambiguous
      // in the default catalog and unique in the work catalog, and the
      // resolved model is free in both.
      const profiles = makeStubDir(
        {
          omp: `const at = args.indexOf("models");
if (at !== -1 && args[at + 1] === "--json") {
  const profile = args[0] === "--profile" ? args[1] : "default";
  const free = (selector) => ({selector,name:selector,thinking:["high"],contextWindow:4096,cost:{input:0,output:0}});
  const catalogs = {
    default: [free("shared/free-model"), free("shared/free-model-plus")],
    work: [free("shared/free-model")],
  };
  console.log(JSON.stringify({models:catalogs[profile] ?? []}))
}`,
        },
        NATIVE,
      );
      const first = runPublicCli(
        ["omp", "--model", "free-model", "--profile", "work", "-p", "hi"],
        "home-fresh",
        profiles,
        NATIVE,
      );
      expect(first.exitCode, first.stderr).toBe(0);
      expect(readOmpSessionModel(first.home)).toEqual({
        selector: "shared/free-model",
        thinking: "high",
        advisorThinking: "high",
      });
      const argvLog = join(first.home, ".golden-argv.log");
      const [overlayName] = readdirSync(join(first.home, ".cache", "docks-kit"));
      expect(readFileSync(argvLog, "utf8").trim().split("\n")).toEqual([
        "omp\tmodels --json",
        "omp\t--profile work models --json",
        `omp\tlaunch --config ${first.home}/.cache/docks-kit/${overlayName} --model shared/free-model:high --profile work -p hi`,
      ]);

      // A plain launch under --profile=<name> checks the remembered model
      // against every candidate catalog too.
      const plain = runPublicCli(["omp", "--profile=work"], "home-fresh", profiles, {
        ...NATIVE,
        reuseHome: first.home,
      });
      expect(plain.exitCode, plain.stderr).toBe(0);
      expect(readFileSync(argvLog, "utf8").trim().split("\n")).toEqual([
        "omp\tmodels --json",
        "omp\t--profile work models --json",
        `omp\tlaunch --config ${first.home}/.cache/docks-kit/${overlayName} --model shared/free-model:high --profile=work`,
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "refuses a launch whose model is free in the environment profile but not in a forwarded profile",
    () => {
      // omp reads `--` as the --system-prompt value and then selects the
      // work profile, whose catalog does not list the session model.
      const profiles = makeStubDir(
        {
          omp: `const at = args.indexOf("models");
if (at !== -1 && args[at + 1] === "--json") {
  const profile = args[0] === "--profile" ? args[1] : "default";
  const free = (selector) => ({selector,name:selector,thinking:["high"],contextWindow:4096,cost:{input:0,output:0}});
  const catalogs = {
    default: [free("opencode-zen/muse-spark-1.3-contributor-free"), free("shared/free-model")],
    work: [free("shared/free-model")],
  };
  console.log(JSON.stringify({models:catalogs[profile] ?? []}))
}`,
        },
        NATIVE,
      );
      const run = runPublicCli(
        ["omp", "--system-prompt", "--", "--profile", "work", "-p", "hi"],
        "home-fresh",
        profiles,
        NATIVE,
      );
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain(
        "free model 'opencode-zen/muse-spark-1.3-contributor-free' is not available",
      );
      expect(readFileSync(join(run.home, ".golden-argv.log"), "utf8").trim().split("\n")).toEqual([
        "omp\tmodels --json",
        "omp\t--profile work models --json",
      ]);
      expect(existsSync(join(run.home, ".cache", "docks-kit"))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "rejects a forwarded model flag before contacting omp",
    () => {
      const run = runPublicCli(
        ["omp", "-p", "hi", "--smol", "paid/x"],
        "home-fresh",
        stubDir,
        NATIVE,
      );
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("--smol");
      expect(readFileSync(join(run.home, ".golden-argv.log"), "utf8")).toBe("");
      expect(existsSync(kitDbFile(run.home))).toBe(false);
      expect(existsSync(join(run.home, ".cache", "docks-kit"))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "rejects a forwarded --profile without a name before contacting omp",
    () => {
      const run = runPublicCli(
        ["omp", "--model", "GLM", "--profile"],
        "home-fresh",
        stubDir,
        NATIVE,
      );
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("--profile requires a profile name");
      expect(readFileSync(join(run.home, ".golden-argv.log"), "utf8")).toBe("");
      expect(existsSync(kitDbFile(run.home))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );
});
