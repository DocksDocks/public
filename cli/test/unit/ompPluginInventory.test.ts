/**
 * `omp plugin list --json` keys marketplace rows on a composite `id`
 * ("<plugin>@<marketplace>") with a `scope`, and npm rows on `name` plus
 * `version`. The marketplace rows drive the retirement of the old docks
 * marketplace plugins: the sync uninstalls each user-scope row, warns about
 * each project-scope row, and then removes the `docks` marketplace. The npm
 * rows drive the pi-intercom install and the kit plugin link: the kit links
 * its directory unless the kit plugin entry already resolves to it.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ExecModule from "../../src/engine-native/exec";

const mocks = vi.hoisted(() => ({
  payloadText: vi.fn<(path: string) => string>(),
  spawnProcess: vi.fn(),
}));

vi.mock("../../src/payload", () => ({
  payloadText: mocks.payloadText,
  payloadDisplayPath: (path: string) => `embedded:${path}`,
  // The kit plugin files are covered by ompKitPlugin.test.ts.
  payloadPaths: () => [],
}));
vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec");
  return { ...actual, spawnProcess: mocks.spawnProcess };
});
vi.mock("../../src/engine-native/bun", () => ({
  bunBootstrap: async () => ({ kind: "ready", executable: "bun" }),
}));

import type { Ctx } from "../../src/engine-native";
import { syncPlugins } from "../../src/engine-native/ompPlugins";
import {
  ompNextSteps,
  ompSync,
  ompWriteFolders,
  type OmpState,
} from "../../src/engine-native/ompSync";
import {
  makeDependencyManager,
  makeEngineServices,
  makePlatform,
} from "../../src/engine-native/services";

const PIN = "0.13.0";
const roots: Array<string> = [];
/**
 * `ompSync` resolves its deploy roots from `process.env`, so an ambient
 * override on the developer's machine would send these writes outside the
 * temporary root. Each case starts from a cleared set.
 */
const OMP_ENV_KEYS = [
  "XDG_DATA_HOME",
  "OMP_PROFILE",
  "PI_PROFILE",
  "PI_CONFIG_DIR",
  "PI_CODING_AGENT_DIR",
] as const;
const ORIGINAL_OMP_ENV = new Map(OMP_ENV_KEYS.map((key) => [key, process.env[key]] as const));

const DOCKS_USER_ROW = { id: "docks@docks", scope: "user", entries: [{ version: "0.29.2" }] };
const PLAN_USER_ROW = {
  id: "plan-lifecycle@docks",
  scope: "user",
  entries: [{ version: "0.27.0" }],
};
const UNINSTALL_DOCKS = "plugin uninstall --scope user docks@docks";
const UNINSTALL_PLAN = "plugin uninstall --scope user plan-lifecycle@docks";
const REMOVE_MARKETPLACE = "plugin marketplace remove docks";
const RESTART_NEXT_STEP = "Restart omp to load any refreshed plugins, skills, or tools.";

/**
 * An inventory whose npm rows hold pi-intercom at the pin and the kit plugin
 * linked to the kit directory under `root`, with the given marketplace rows.
 */
function inventory(root: string, marketplace: ReadonlyArray<object> = []): string {
  const kitDir = join(root, ".docks-kit", "omp-plugin");
  mkdirSync(kitDir, { recursive: true });
  return JSON.stringify({
    npm: [
      { name: "pi-intercom", version: PIN },
      { name: "docks-kit-omp", version: "0.0.0", path: kitDir },
    ],
    marketplace,
  });
}
const INVENTORY_EMPTY = JSON.stringify({ npm: [], marketplace: [] });

/** The omp argv that links the kit plugin directory under `root`. */
function kitLink(root: string): string {
  return `plugin link ${root}/.docks-kit/omp-plugin`;
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "docks-omp-inventory-"));
  roots.push(root);
  mkdirSync(join(root, ".omp"), { recursive: true });
  return root;
}

/** Writes `<dir>/marketplaces.json` with one entry for each name. */
function writeRegistry(dir: string, names: ReadonlyArray<string>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "marketplaces.json"),
    JSON.stringify({ version: 1, marketplaces: names.map((name) => ({ name })) }),
  );
}

/**
 * Sets an XDG data root whose omp folder exists, so omp and the sync use it
 * as the active data root. The legacy registry stays in `<root>/.omp`.
 */
function useXdgDataRoot(root: string): string {
  const dataHome = join(root, "xdg");
  mkdirSync(join(dataHome, "omp"), { recursive: true });
  process.env["XDG_DATA_HOME"] = dataHome;
  return join(dataHome, "omp");
}

function makeCtx(
  root: string,
  options: {
    skipPluginRefresh?: boolean;
    missingTool?: "omp" | "git";
    dryRun?: boolean;
    output?: Array<string>;
  } = {},
): Ctx {
  const platform = makePlatform("linux");
  const write = (chunk: string): void => {
    options.output?.push(chunk);
  };
  const services = {
    ...makeEngineServices({ sinks: { stderr: write, stdout: write } }),
    deps: makeDependencyManager(platform, {
      commandExists: (name) => name !== options.missingTool,
      capture: async () => "",
      which: (name) => `/usr/bin/${name}`,
    }),
    platform,
  };
  return {
    home: root,
    dryRun: options.dryRun ?? false,
    verbose: false,
    skipPluginRefresh: options.skipPluginRefresh ?? false,
    services,
    nextStepTriggers: { ompRestart: false },
    failures: [],
  } as unknown as Ctx;
}

/** Run the omp pipeline in the folders that a sync of `ctx` resolves, as `runSync` does. */
function syncOmp(ctx: Ctx): Promise<OmpState> {
  return ompSync(ctx, ompWriteFolders(ctx));
}

/** Run the plugin pass on the omp paths that a sync of `ctx` resolves. */
function syncOmpPlugins(ctx: Ctx): Promise<number> {
  return syncPlugins(ctx, ompWriteFolders(ctx).paths);
}

/** Every `omp` argv the pipeline spawned, as one joined string per call. */
function ompCommands(): Array<string> {
  return mocks.spawnProcess.mock.calls.map((call) => (call[1] as ReadonlyArray<string>).join(" "));
}

/**
 * Answers each `plugin list --json` call with the next inventory; the last
 * inventory answers every later call. `failingCommand` exits 1.
 */
function respondWithInventory(
  inventories: string | ReadonlyArray<string>,
  failingCommand?: string,
): void {
  const answers = typeof inventories === "string" ? [inventories] : inventories;
  let listCalls = 0;
  mocks.spawnProcess.mockImplementation(async (_cmd: string, args: ReadonlyArray<string>) => {
    const failed = args.join(" ") === failingCommand;
    const list = args[0] === "plugin" && args[1] === "list";
    const stdout = list ? (answers[Math.min(listCalls++, answers.length - 1)] ?? "") : "";
    return {
      error: undefined,
      exitCode: failed ? 1 : 0,
      stdout,
      stderr: failed ? "stub omp operation failure\n" : "",
    };
  });
}

/** The text of the plugin summary line, from its message start to the line end. */
function pluginSummary(output: ReadonlyArray<string>): string | undefined {
  const line = output
    .join("")
    .split("\n")
    .find((candidate) => candidate.includes("omp plugins synced"));
  return line?.slice(line.indexOf("omp plugins synced"));
}

/** Each line that contains `start`, from `start` to the line end. */
function messageLines(output: ReadonlyArray<string>, start: string): Array<string> {
  return output
    .join("")
    .split("\n")
    .filter((line) => line.includes(start))
    .map((line) => line.slice(line.indexOf(start)));
}

/** The folder of the retired upgrade log under `root`, as `kitCacheDir` gives it. */
function upgradeLog(root: string): string {
  return join(root, ".cache", "docks-kit", "omp-plugin-upgrades");
}

describe("omp plugin inventory", () => {
  beforeEach(() => {
    mocks.payloadText.mockReset().mockImplementation((path) => {
      if (path === "SoT/.omp/AGENTS.md") return "# omp\n";
      if (path === "SoT/.omp/mcp.json") return "{}\n";
      if (path === "SoT/.omp/models.yml") return "providers: {}\n";
      if (path === "SoT/.omp/config.yml") return "theme: dark\n";
      if (path === "SoT/.omp/intercom.json") return "{}\n";
      if (path === "SoT/toolchain.json") return `{"tools":{"pi-intercom":{"verified":"${PIN}"}}}`;
      throw new Error(`Unexpected payload: ${path}`);
    });
    mocks.spawnProcess.mockReset();
    for (const key of OMP_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    for (const [key, value] of ORIGINAL_OMP_ENV) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe("retirement of the docks marketplace plugins", () => {
    it.each([
      ["a sync", false],
      ["a sync with --skip-plugin-refresh", true],
    ])("uninstalls each user-scope retired plugin in %s", async (_name, skipPluginRefresh) => {
      const root = makeRoot();
      respondWithInventory(inventory(root, [DOCKS_USER_ROW, PLAN_USER_ROW]));
      const output: Array<string> = [];
      const ctx = makeCtx(root, { skipPluginRefresh, output });

      const installed = await syncOmpPlugins(ctx);

      expect(ompCommands()).toEqual(["plugin list --json", UNINSTALL_DOCKS, UNINSTALL_PLAN]);
      expect(installed).toBe(2);
      expect(pluginSummary(output)).toBe(
        "omp plugins synced: docks@docks uninstalled, plan-lifecycle@docks uninstalled",
      );
      expect(ctx.failures).toEqual([]);
      expect(ctx.nextStepTriggers.ompRestart).toBe(true);
      expect(ompNextSteps(ctx)).toEqual([RESTART_NEXT_STEP]);
    });

    it("warns about a project-scope row and runs nothing for it", async () => {
      const root = makeRoot();
      respondWithInventory(
        inventory(root, [
          { id: "docks@docks", scope: "project", entries: [{ version: "0.29.2" }] },
          PLAN_USER_ROW,
        ]),
      );
      const output: Array<string> = [];
      const ctx = makeCtx(root, { output });

      await syncOmpPlugins(ctx);

      expect(ompCommands()).toEqual(["plugin list --json", UNINSTALL_PLAN]);
      expect(messageLines(output, "omp plugin docks@docks")).toEqual([
        "omp plugin docks@docks is installed at project scope and docks-kit no longer ships it; run from that project: omp plugin uninstall --scope project docks@docks",
      ]);
      expect(ctx.failures).toEqual([]);
    });

    it("uninstalls the user-scope row and warns about the project-scope row of one plugin", async () => {
      const root = makeRoot();
      respondWithInventory(
        inventory(root, [{ ...DOCKS_USER_ROW, scope: "project" }, DOCKS_USER_ROW]),
      );
      const output: Array<string> = [];

      await syncOmpPlugins(makeCtx(root, { output }));

      expect(ompCommands()).toEqual(["plugin list --json", UNINSTALL_DOCKS]);
      expect(messageLines(output, "omp plugin docks@docks is installed")).toHaveLength(1);
    });

    it("removes the marketplace after the uninstalls when the active registry lists docks", async () => {
      const root = makeRoot();
      writeRegistry(join(root, ".omp"), ["docks"]);
      respondWithInventory(inventory(root, [DOCKS_USER_ROW, PLAN_USER_ROW]));
      const output: Array<string> = [];

      await syncOmpPlugins(makeCtx(root, { output }));

      expect(ompCommands()).toEqual([
        "plugin list --json",
        UNINSTALL_DOCKS,
        UNINSTALL_PLAN,
        REMOVE_MARKETPLACE,
      ]);
      expect(pluginSummary(output)).toBe(
        "omp plugins synced: docks@docks uninstalled, plan-lifecycle@docks uninstalled, docks marketplace removed",
      );
    });

    it("reads a registry that keys each marketplace by its name", async () => {
      const root = makeRoot();
      writeFileSync(
        join(root, ".omp", "marketplaces.json"),
        JSON.stringify({ docks: { source: "git" } }),
      );
      respondWithInventory(inventory(root));

      await syncOmpPlugins(makeCtx(root));

      expect(ompCommands()).toEqual(["plugin list --json", REMOVE_MARKETPLACE]);
    });

    it("removes the marketplace when the active XDG registry lists docks", async () => {
      const root = makeRoot();
      writeRegistry(useXdgDataRoot(root), ["docks"]);
      writeRegistry(join(root, ".omp"), ["another-marketplace"]);
      respondWithInventory(inventory(root));

      await syncOmpPlugins(makeCtx(root));

      expect(ompCommands()).toEqual(["plugin list --json", REMOVE_MARKETPLACE]);
    });

    it("removes the marketplace when only the legacy registry lists docks and no active registry exists", async () => {
      const root = makeRoot();
      useXdgDataRoot(root);
      writeRegistry(join(root, ".omp"), ["docks"]);
      respondWithInventory(inventory(root, [DOCKS_USER_ROW]));

      await syncOmpPlugins(makeCtx(root));

      expect(ompCommands()).toEqual(["plugin list --json", UNINSTALL_DOCKS, REMOVE_MARKETPLACE]);
    });

    it("removes no marketplace when the active registry exists without docks and the legacy registry lists it", async () => {
      const root = makeRoot();
      writeRegistry(useXdgDataRoot(root), ["another-marketplace"]);
      writeRegistry(join(root, ".omp"), ["docks"]);
      respondWithInventory(inventory(root, [DOCKS_USER_ROW, PLAN_USER_ROW]));

      await syncOmpPlugins(makeCtx(root));

      expect(ompCommands()).toEqual(["plugin list --json", UNINSTALL_DOCKS, UNINSTALL_PLAN]);
    });

    it("removes no marketplace when no registry lists docks", async () => {
      const root = makeRoot();
      writeRegistry(join(root, ".omp"), ["another-marketplace"]);
      respondWithInventory(inventory(root));
      const ctx = makeCtx(root);

      await syncOmpPlugins(ctx);

      expect(ompCommands()).toEqual(["plugin list --json"]);
      expect(ctx.nextStepTriggers.ompRestart).toBe(false);
    });

    it("warns and removes no marketplace when the active registry cannot be parsed", async () => {
      const root = makeRoot();
      const registry = join(root, ".omp", "marketplaces.json");
      writeFileSync(registry, '{ "docks": ');
      respondWithInventory(inventory(root, [DOCKS_USER_ROW]));
      const output: Array<string> = [];

      await syncOmpPlugins(makeCtx(root, { output }));

      expect(ompCommands()).toEqual(["plugin list --json", UNINSTALL_DOCKS]);
      expect(
        messageLines(output, `omp marketplace registry ${registry} cannot be read`),
      ).toHaveLength(1);
    });

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "warns and does not fall back to the legacy registry when the active registry cannot be read",
      async () => {
        const root = makeRoot();
        const dataRoot = useXdgDataRoot(root);
        writeRegistry(dataRoot, ["docks"]);
        writeRegistry(join(root, ".omp"), ["docks"]);
        respondWithInventory(inventory(root, [DOCKS_USER_ROW]));
        const output: Array<string> = [];
        // No search permission on the folder: the registry exists, but its read fails with EACCES.
        chmodSync(dataRoot, 0o000);
        try {
          await syncOmpPlugins(makeCtx(root, { output }));
        } finally {
          chmodSync(dataRoot, 0o700);
        }

        expect(ompCommands()).toEqual(["plugin list --json", UNINSTALL_DOCKS]);
        expect(
          messageLines(output, `omp marketplace registry ${join(dataRoot, "marketplaces.json")}`),
        ).toHaveLength(1);
      },
    );

    it("removes no marketplace after a failed uninstall", async () => {
      const root = makeRoot();
      writeRegistry(join(root, ".omp"), ["docks"]);
      respondWithInventory(inventory(root, [DOCKS_USER_ROW, PLAN_USER_ROW]), UNINSTALL_DOCKS);
      const output: Array<string> = [];
      const ctx = makeCtx(root, { output });

      await syncOmpPlugins(ctx);

      expect(ompCommands()).toEqual(["plugin list --json", UNINSTALL_DOCKS, UNINSTALL_PLAN]);
      expect(ctx.failures).toEqual([
        "omp plugin operation failed for docks@docks: stub omp operation failure; run manually: omp plugin uninstall --scope user docks@docks",
      ]);
      expect(pluginSummary(output)).toBe("omp plugins synced: plan-lifecycle@docks uninstalled");
      expect(ctx.nextStepTriggers.ompRestart).toBe(true);
    });

    it("records a failed marketplace removal", async () => {
      const root = makeRoot();
      writeRegistry(join(root, ".omp"), ["docks"]);
      respondWithInventory(inventory(root), REMOVE_MARKETPLACE);
      const ctx = makeCtx(root);

      await syncOmpPlugins(ctx);

      expect(ompCommands()).toEqual(["plugin list --json", REMOVE_MARKETPLACE]);
      expect(ctx.failures).toEqual([
        "omp plugin operation failed for docks marketplace: stub omp operation failure; run manually: omp plugin marketplace remove docks",
      ]);
    });

    it("warns and skips the retirement when the inventory cannot be read", async () => {
      const root = makeRoot();
      writeRegistry(join(root, ".omp"), ["docks"]);
      respondWithInventory("not json");
      const output: Array<string> = [];
      const ctx = makeCtx(root, { output });

      await syncOmpPlugins(ctx);

      expect(ompCommands()).toEqual([
        "plugin list --json",
        `install pi-intercom@${PIN}`,
        kitLink(root),
        "plugin list --json",
      ]);
      expect(messageLines(output, "omp plugin inventory")).toEqual([
        "omp plugin inventory unavailable — retirement of the docks marketplace plugins skipped until the next sync; pi-intercom and the kit plugin take the full refresh path",
      ]);
      expect(ctx.failures).toEqual([]);
    });

    it.each([
      ["an empty inventory", (): string => INVENTORY_EMPTY],
      ["an unreadable inventory", (): string => "not json"],
      ["an inventory without the retired plugins", (root: string): string => inventory(root)],
    ])("installs no marketplace plugin and adds no marketplace for %s", async (_name, answer) => {
      const root = makeRoot();
      respondWithInventory(answer(root));

      await syncOmp(makeCtx(root));

      expect(
        ompCommands().filter((command) =>
          /^plugin (install|upgrade) |^plugin marketplace (add|update|list)/.test(command),
        ),
      ).toEqual([]);
    });

    it("runs no omp mutation on a second sync after a successful retirement", async () => {
      const root = makeRoot();
      writeRegistry(join(root, ".omp"), ["docks"]);
      respondWithInventory(inventory(root, [DOCKS_USER_ROW, PLAN_USER_ROW]));
      await syncOmp(makeCtx(root));
      expect(ompCommands()).toEqual([
        "plugin list --json",
        UNINSTALL_DOCKS,
        UNINSTALL_PLAN,
        REMOVE_MARKETPLACE,
      ]);

      // The state that the omp commands of the first sync left.
      writeRegistry(join(root, ".omp"), []);
      mocks.spawnProcess.mockReset();
      respondWithInventory(inventory(root));
      const output: Array<string> = [];
      const ctx = makeCtx(root, { output });
      await syncOmp(ctx);

      expect(ompCommands()).toEqual(["plugin list --json"]);
      expect(pluginSummary(output)).toBeUndefined();
      expect(ctx.failures).toEqual([]);
      expect(ctx.nextStepTriggers.ompRestart).toBe(false);
    });

    it("removes the retired upgrade log folder in a real sync", async () => {
      const root = makeRoot();
      mkdirSync(upgradeLog(root), { recursive: true });
      writeFileSync(join(upgradeLog(root), "1000-aa.json"), "{}\n");
      respondWithInventory(inventory(root));

      await syncOmp(makeCtx(root));

      expect(existsSync(upgradeLog(root))).toBe(false);
      expect(existsSync(join(root, ".cache", "docks-kit"))).toBe(true);
    });

    it("keeps the retired upgrade log folder in a dry run", async () => {
      const root = makeRoot();
      mkdirSync(upgradeLog(root), { recursive: true });

      await syncOmp(makeCtx(root, { dryRun: true }));

      expect(existsSync(upgradeLog(root))).toBe(true);
    });

    it.each([
      ["lists docks", ["docks"], true],
      ["does not list docks", ["another-marketplace"], false],
    ])(
      "previews the retirement in a dry run when the registry %s",
      async (_name, names, removal) => {
        const root = makeRoot();
        writeRegistry(join(root, ".omp"), names);
        const output: Array<string> = [];

        await syncOmp(makeCtx(root, { dryRun: true, output }));

        const lines = output
          .join("")
          .split("\n")
          .filter((line) => line.startsWith("[dry-run] omp "));
        expect(lines).toEqual([
          `[dry-run] omp ${UNINSTALL_DOCKS}`,
          `[dry-run] omp ${UNINSTALL_PLAN}`,
          ...(removal ? [`[dry-run] omp ${REMOVE_MARKETPLACE}`] : []),
          `[dry-run] omp install pi-intercom@${PIN}`,
          `[dry-run] omp ${kitLink(root)}`,
        ]);
        expect(ompCommands()).toEqual([]);
      },
    );
  });

  it("names the version of a new pi-intercom install and the kit plugin link", async () => {
    const root = makeRoot();
    respondWithInventory([INVENTORY_EMPTY, inventory(root)]);
    const output: Array<string> = [];

    const state = await syncOmp(makeCtx(root, { output }));

    expect(ompCommands()).toEqual([
      "plugin list --json",
      `install pi-intercom@${PIN}`,
      kitLink(root),
      "plugin list --json",
    ]);
    expect(state.pluginsInstalled).toBe(2);
    expect(pluginSummary(output)).toBe(
      `omp plugins synced: pi-intercom ${PIN} (new), docks-kit-omp linked`,
    );
  });

  it("counts only successful installs when a plugin command fails", async () => {
    respondWithInventory(INVENTORY_EMPTY, `install pi-intercom@${PIN}`);
    const root = makeRoot();
    const ctx = makeCtx(root);

    const state = await syncOmp(ctx);

    expect(ompCommands()).toEqual([
      "plugin list --json",
      `install pi-intercom@${PIN}`,
      kitLink(root),
    ]);
    expect(state.pluginsInstalled).toBe(1);
    expect(ctx.failures).toEqual([
      `omp plugin operation failed for pi-intercom: stub omp operation failure; run manually: omp install pi-intercom@${PIN}`,
    ]);
  });

  it("reinstalls pi-intercom with --force when the installed version misses the pin", async () => {
    respondWithInventory(
      JSON.stringify({ npm: [{ name: "pi-intercom", version: "0.9.0" }], marketplace: [] }),
    );
    const root = makeRoot();
    const state = await syncOmp(makeCtx(root));

    expect(ompCommands()).toEqual([
      "plugin list --json",
      `install --force pi-intercom@${PIN}`,
      kitLink(root),
      "plugin list --json",
    ]);
    expect(state.pluginsInstalled).toBe(2);
  });

  it("skips the pi-intercom refresh under --skip-plugin-refresh", async () => {
    const root = makeRoot();
    const kitDir = join(root, ".docks-kit", "omp-plugin");
    mkdirSync(kitDir, { recursive: true });
    respondWithInventory(
      JSON.stringify({
        npm: [
          { name: "pi-intercom", version: "0.9.0" },
          { name: "docks-kit-omp", version: "0.0.0", path: kitDir },
        ],
        marketplace: [],
      }),
    );
    const state = await syncOmp(makeCtx(root, { skipPluginRefresh: true }));

    expect(ompCommands()).toEqual(["plugin list --json"]);
    expect(state.pluginsInstalled).toBe(2);
  });

  it("still installs a missing pi-intercom under --skip-plugin-refresh", async () => {
    respondWithInventory(INVENTORY_EMPTY);
    const root = makeRoot();
    const state = await syncOmp(makeCtx(root, { skipPluginRefresh: true }));

    expect(ompCommands()).toEqual([
      "plugin list --json",
      `install pi-intercom@${PIN}`,
      kitLink(root),
      "plugin list --json",
    ]);
    expect(state.pluginsInstalled).toBe(2);
  });

  it("deploys config without spawning omp plugins when git is unavailable", async () => {
    respondWithInventory(INVENTORY_EMPTY);
    const root = makeRoot();
    writeRegistry(join(root, ".omp"), ["docks"]);
    const ctx = makeCtx(root, { missingTool: "git" });

    const state = await syncOmp(ctx);

    expect(readFileSync(join(root, ".omp", "agent", "config.yml"), "utf8")).toBe("theme: dark\n");
    expect(ompCommands()).toEqual([]);
    expect(state.pluginsInstalled).toBe(0);
    expect(ctx.failures).toEqual([]);
  });

  it("previews no omp command in a dry run when omp is unavailable", async () => {
    const root = makeRoot();
    // A registry that lists docks would make a dry run with omp preview its removal.
    writeRegistry(join(root, ".omp"), ["docks"]);
    const output: Array<string> = [];

    await syncOmp(makeCtx(root, { missingTool: "omp", dryRun: true, output }));

    const lines = output.join("").split("\n");
    expect(lines.filter((line) => line.startsWith("[dry-run] omp "))).toEqual([]);
    expect(lines.filter((line) => line.includes("omp not installed"))).toHaveLength(1);
    expect(ompCommands()).toEqual([]);
  });

  it("deploys the intercom configuration into the agent directory of a named profile", async () => {
    respondWithInventory(INVENTORY_EMPTY);
    const root = makeRoot();
    process.env["OMP_PROFILE"] = "work";

    await syncOmp(makeCtx(root, { missingTool: "omp" }));

    expect(
      readFileSync(
        join(root, ".omp", "profiles", "work", "agent", "intercom", "config.json"),
        "utf8",
      ),
    ).toBe("{}\n");
    expect(existsSync(join(root, ".pi", "agent", "intercom"))).toBe(false);
  });

  it("keeps only the ids in the summary when the inventory cannot be read", async () => {
    respondWithInventory("not json");
    const root = makeRoot();
    const output: Array<string> = [];
    const state = await syncOmp(makeCtx(root, { output }));

    expect(state.pluginsInstalled).toBe(2);
    expect(pluginSummary(output)).toBe("omp plugins synced: pi-intercom, docks-kit-omp linked");
  });

  it("shows versions without (new) when only the second inventory read succeeds", async () => {
    const root = makeRoot();
    respondWithInventory(["not json", inventory(root)]);
    const output: Array<string> = [];
    await syncOmp(makeCtx(root, { output }));

    // The first read failed, so the sync cannot know whether a plugin was new.
    expect(pluginSummary(output)).toBe(
      `omp plugins synced: pi-intercom ${PIN}, docks-kit-omp linked`,
    );
  });

  it("links the kit plugin again when omp's entry resolves elsewhere", async () => {
    const root = makeRoot();
    const elsewhere = join(root, "old-plugin");
    mkdirSync(elsewhere);
    respondWithInventory(
      JSON.stringify({
        npm: [
          { name: "pi-intercom", version: PIN },
          { name: "docks-kit-omp", version: "0.0.0", path: elsewhere },
        ],
        marketplace: [],
      }),
    );
    const output: Array<string> = [];
    const ctx = makeCtx(root, { skipPluginRefresh: true, output });
    const state = await syncOmpPlugins(ctx);

    // A link names no version, so no second inventory read runs.
    expect(ompCommands()).toEqual(["plugin list --json", kitLink(root)]);
    expect(state).toBe(2);
    expect(pluginSummary(output)).toBe("omp plugins synced: docks-kit-omp linked");
    expect(ctx.nextStepTriggers.ompRestart).toBe(true);
  });

  it("previews the kit plugin link in a dry run without spawning omp", async () => {
    const root = makeRoot();
    const output: Array<string> = [];

    await syncOmp(makeCtx(root, { dryRun: true, output }));

    const lines = output.join("").split("\n");
    expect(lines).toContain(`[dry-run] omp plugin link ${root}/.docks-kit/omp-plugin`);
    expect(ompCommands()).toEqual([]);
  });
});
