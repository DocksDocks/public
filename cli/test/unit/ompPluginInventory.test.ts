/**
 * `omp plugin list --json` keys marketplace rows on a composite `id`
 * ("<plugin>@<marketplace>") and npm rows on `name` plus `version`. Reading the
 * wrong field turns every run into a failing reinstall, so these rows pin the
 * install / upgrade / skip decision that the inventory drives. The kit plugin
 * row also carries `path`: the kit links its directory unless that entry
 * already resolves to it.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
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
import { ompNextSteps, ompSync } from "../../src/engine-native/ompSync";
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

/**
 * A complete inventory; the kit plugin row resolves to the kit directory under
 * `root`. `docksVersion` and `planVersion` set the marketplace entry versions.
 */
function inventoryPresent(root: string, docksVersion = "0.18.0", planVersion = "0.9.0"): string {
  const kitDir = join(root, ".docks-kit", "omp-plugin");
  mkdirSync(kitDir, { recursive: true });
  return JSON.stringify({
    npm: [
      { name: "pi-intercom", version: PIN },
      { name: "docks-kit-omp", version: "0.0.0", path: kitDir },
    ],
    marketplace: [
      { id: "docks@docks", scope: "user", entries: [{ version: docksVersion }] },
      { id: "plan-lifecycle@docks", scope: "user", entries: [{ version: planVersion }] },
    ],
  });
}
const INVENTORY_EMPTY = JSON.stringify({ npm: [], marketplace: [] });

/** The npm rows of `inventoryPresent` with the given marketplace rows. */
function inventoryWithMarketplace(root: string, marketplace: ReadonlyArray<object>): string {
  const { npm } = JSON.parse(inventoryPresent(root)) as { npm: ReadonlyArray<object> };
  return JSON.stringify({ npm, marketplace });
}

/** The omp argv that links the kit plugin directory under `root`. */
function kitLink(root: string): string {
  return `plugin link ${root}/.docks-kit/omp-plugin`;
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "docks-omp-inventory-"));
  roots.push(root);
  // Pre-register the marketplace so the plugin pass is the only spawn source.
  mkdirSync(join(root, ".omp"), { recursive: true });
  writeFileSync(
    join(root, ".omp", "marketplaces.json"),
    JSON.stringify({ docks: { source: "git" } }),
  );
  return root;
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
    agentsDir: join(root, ".agents"),
    dryRun: options.dryRun ?? false,
    verbose: false,
    prune: false,
    skipPluginRefresh: options.skipPluginRefresh ?? false,
    services,
    nextStepTriggers: { ompRestart: false, ompPluginUpgraded: false },
    failures: [],
  } as unknown as Ctx;
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

/** The upgrade log folder under `root`, as `kitCacheDir` gives it. */
function upgradeLog(root: string): string {
  return join(root, ".cache", "docks-kit", "omp-plugin-upgrades");
}

/** Each upgrade warning line, from its message start to the line end. */
function upgradeWarnings(output: ReadonlyArray<string>): Array<string> {
  return output
    .join("")
    .split("\n")
    .filter((line) => line.includes("running omp sessions lose"))
    .map((line) => line.slice(line.indexOf("omp plugin ")));
}

/** The warning that sync prints for one marketplace upgrade that changed a version. */
function upgradeWarning(id: string, before: string, after: string): string {
  return `omp plugin ${id} ${before} -> ${after}: running omp sessions lose its plugin agents until they run /reload-plugins and read its skills again through skill:// (restart omp instead when the plugin ships hooks, extension modules, or non-MCP tools).`;
}

const UPGRADE_NEXT_STEP =
  "Run /reload-plugins in each running omp session, then read each plugin skill again through skill://. Restart omp instead when an upgraded plugin ships hooks, extension modules, or non-MCP tools.";
const RESTART_NEXT_STEP = "Restart omp to load any refreshed plugins, skills, or tools.";

/** Each line that contains `start`, from `start` to the line end. */
function messageLines(output: ReadonlyArray<string>, start: string): Array<string> {
  return output
    .join("")
    .split("\n")
    .filter((line) => line.includes(start))
    .map((line) => line.slice(line.indexOf(start)));
}

/**
 * Each upgrade that sync logged, as `<id> <before> -> <after>`, sorted. Sync
 * names a file with 16 random hex digits, so the files that a test made are left out.
 */
function loggedUpgrades(root: string): Array<string> {
  return readdirSync(upgradeLog(root))
    .filter((name) => /^\d+-[0-9a-f]{16}\.json$/.test(name))
    .map((name) => {
      const event = JSON.parse(readFileSync(join(upgradeLog(root), name), "utf8")) as {
        id: string;
        before: string;
        after: string;
      };
      return `${event.id} ${event.before} -> ${event.after}`;
    })
    .sort();
}

/**
 * Sets the fake clock when a command in `times` returns, so each operation
 * finishes at a known time. Call it after `respondWithInventory`.
 */
function finishCommandsAt(times: Readonly<Record<string, number>>): void {
  const respond = mocks.spawnProcess.getMockImplementation();
  mocks.spawnProcess.mockImplementation(async (cmd: string, args: ReadonlyArray<string>) => {
    const result: unknown = await respond?.(cmd, args);
    const time = times[args.join(" ")];
    if (time !== undefined) vi.setSystemTime(time);
    return result;
  });
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
    vi.useRealTimers();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    for (const [key, value] of ORIGINAL_OMP_ENV) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("upgrades marketplace plugins already named by a composite id", async () => {
    const root = makeRoot();
    respondWithInventory(inventoryPresent(root));
    const state = await ompSync(makeCtx(root));

    expect(ompCommands()).toEqual([
      "plugin marketplace update docks",
      "plugin list --json",
      "plugin upgrade --scope user docks@docks",
      "plugin upgrade --scope user plan-lifecycle@docks",
      "plugin list --json",
    ]);
    expect(state.pluginsInstalled).toBe(4);
  });

  it("names the version change of each upgraded plugin", async () => {
    const root = makeRoot();
    respondWithInventory([inventoryPresent(root), inventoryPresent(root, "0.19.0")]);
    const output: Array<string> = [];

    await ompSync(makeCtx(root, { output }));

    expect(pluginSummary(output)).toBe(
      "omp plugins synced: docks@docks 0.18.0 -> 0.19.0, plan-lifecycle@docks 0.9.0 (current)",
    );
  });

  it("names the version of each new install and the kit plugin link", async () => {
    const root = makeRoot();
    respondWithInventory([INVENTORY_EMPTY, inventoryPresent(root, "0.19.0")]);
    const output: Array<string> = [];

    await ompSync(makeCtx(root, { output }));

    expect(pluginSummary(output)).toBe(
      `omp plugins synced: docks@docks 0.19.0 (new), plan-lifecycle@docks 0.9.0 (new), pi-intercom ${PIN} (new), docks-kit-omp linked`,
    );
  });

  it("installs a plugin whose only row is project-scoped", async () => {
    // `upgrade --scope user` fails on a project-scope row: the user scope is
    // empty, so the pipeline must install instead.
    respondWithInventory(
      JSON.stringify({
        npm: [{ name: "pi-intercom", version: PIN }],
        marketplace: [
          { id: "docks@docks", scope: "project", entries: [{ scope: "user", version: "0.18.0" }] },
          { id: "plan-lifecycle@docks", scope: "user", entries: [{ version: "0.9.0" }] },
        ],
      }),
    );
    const root = makeRoot();
    const state = await ompSync(makeCtx(root));

    expect(ompCommands()).toEqual([
      "plugin marketplace update docks",
      "plugin list --json",
      "plugin install --scope user docks@docks",
      "plugin upgrade --scope user plan-lifecycle@docks",
      kitLink(root),
      "plugin list --json",
    ]);
    expect(state.pluginsInstalled).toBe(4);
  });

  /**
   * With an XDG data root adopted, the active registry starts absent while the
   * legacy config-root registry still lists docks. omp itself copies the file
   * forward when it resolves the path, so the kit only has to pick a command
   * that triggers that resolution without fetching under
   * `--skip-plugin-refresh`.
   */
  function makeAdoptableRoot(): { root: string; dataHome: string } {
    const root = makeRoot();
    const dataHome = join(root, "xdg");
    mkdirSync(join(dataHome, "omp"), { recursive: true });
    writeFileSync(
      join(root, ".omp", "marketplaces.json"),
      JSON.stringify({ version: 1, marketplaces: [{ name: "docks" }] }),
    );
    return { root, dataHome };
  }

  it("registers docks when neither XDG nor the legacy registry lists it", async () => {
    const { root, dataHome } = makeAdoptableRoot();
    process.env["XDG_DATA_HOME"] = dataHome;
    writeFileSync(
      join(root, ".omp", "marketplaces.json"),
      JSON.stringify({ version: 1, marketplaces: [{ name: "another-marketplace" }] }),
    );
    respondWithInventory(inventoryPresent(root));

    await ompSync(makeCtx(root));

    expect(ompCommands()).toEqual([
      "plugin marketplace add https://github.com/DocksDocks/docks.git",
      "plugin list --json",
      "plugin upgrade --scope user docks@docks",
      "plugin upgrade --scope user plan-lifecycle@docks",
      "plugin list --json",
    ]);
  });

  it("refreshes the marketplace when only the legacy registry lists docks", async () => {
    const { root, dataHome } = makeAdoptableRoot();
    process.env["XDG_DATA_HOME"] = dataHome;
    respondWithInventory(inventoryPresent(root));

    await ompSync(makeCtx(root));

    expect(ompCommands()).toEqual([
      "plugin marketplace update docks",
      "plugin list --json",
      "plugin upgrade --scope user docks@docks",
      "plugin upgrade --scope user plan-lifecycle@docks",
      "plugin list --json",
    ]);
  });

  it("adopts the registry with a read-only list under --skip-plugin-refresh", async () => {
    const { root, dataHome } = makeAdoptableRoot();
    process.env["XDG_DATA_HOME"] = dataHome;
    respondWithInventory(inventoryPresent(root));

    await ompSync(makeCtx(root, { skipPluginRefresh: true }));

    expect(ompCommands()).toEqual(["plugin marketplace list", "plugin list --json"]);
  });

  it("records a failed read-only registry adoption without fetching a marketplace", async () => {
    const { root, dataHome } = makeAdoptableRoot();
    process.env["XDG_DATA_HOME"] = dataHome;
    respondWithInventory(inventoryPresent(root), "plugin marketplace list");
    const ctx = makeCtx(root, { skipPluginRefresh: true });

    const state = await ompSync(ctx);

    expect(ompCommands()).toEqual(["plugin marketplace list", "plugin list --json"]);
    expect(state.pluginsInstalled).toBe(4);
    expect(ctx.failures).toEqual([
      "omp docks marketplace adoption failed: stub omp operation failure; run manually: omp plugin marketplace list",
    ]);
  });

  it("counts only successful installs when a marketplace plugin command fails", async () => {
    respondWithInventory(INVENTORY_EMPTY, "plugin install --scope user docks@docks");
    const root = makeRoot();
    const ctx = makeCtx(root);

    const state = await ompSync(ctx);

    expect(ompCommands()).toEqual([
      "plugin marketplace update docks",
      "plugin list --json",
      "plugin install --scope user docks@docks",
      "plugin install --scope user plan-lifecycle@docks",
      `install pi-intercom@${PIN}`,
      kitLink(root),
      "plugin list --json",
    ]);
    expect(state.pluginsInstalled).toBe(3);
    expect(ctx.failures).toEqual([
      "omp plugin operation failed for docks@docks: stub omp operation failure; run manually: omp plugin install --scope user docks@docks",
    ]);
  });

  it("reinstalls pi-intercom with --force when the installed version misses the pin", async () => {
    respondWithInventory(
      JSON.stringify({ npm: [{ name: "pi-intercom", version: "0.9.0" }], marketplace: [] }),
    );
    const root = makeRoot();
    const state = await ompSync(makeCtx(root));

    expect(ompCommands()).toEqual([
      "plugin marketplace update docks",
      "plugin list --json",
      "plugin install --scope user docks@docks",
      "plugin install --scope user plan-lifecycle@docks",
      `install --force pi-intercom@${PIN}`,
      kitLink(root),
      "plugin list --json",
    ]);
    expect(state.pluginsInstalled).toBe(4);
  });

  it("skips every refresh of present plugins under --skip-plugin-refresh", async () => {
    const root = makeRoot();
    respondWithInventory(inventoryPresent(root));
    const state = await ompSync(makeCtx(root, { skipPluginRefresh: true }));

    expect(ompCommands()).toEqual(["plugin list --json"]);
    expect(state.pluginsInstalled).toBe(4);
  });

  it("still installs a missing plugin under --skip-plugin-refresh", async () => {
    respondWithInventory(
      JSON.stringify({ npm: [], marketplace: [{ id: "docks@docks", scope: "user", entries: [] }] }),
    );
    const root = makeRoot();
    const state = await ompSync(makeCtx(root, { skipPluginRefresh: true }));

    expect(ompCommands()).toEqual([
      "plugin list --json",
      "plugin install --scope user plan-lifecycle@docks",
      `install pi-intercom@${PIN}`,
      kitLink(root),
      "plugin list --json",
    ]);
    expect(state.pluginsInstalled).toBe(4);
  });

  it("deploys config without spawning omp plugins when git is unavailable", async () => {
    respondWithInventory(INVENTORY_EMPTY);
    const root = makeRoot();
    const ctx = makeCtx(root, { missingTool: "git" });

    const state = await ompSync(ctx);

    expect(readFileSync(join(root, ".omp", "agent", "config.yml"), "utf8")).toBe("theme: dark\n");
    expect(ompCommands()).toEqual([]);
    expect(state.pluginsInstalled).toBe(0);
    expect(ctx.failures).toEqual([]);
  });

  it("previews no omp command in a dry run when omp is unavailable", async () => {
    const root = makeRoot();
    // An unregistered marketplace makes the marketplace pass preview its add command.
    rmSync(join(root, ".omp", "marketplaces.json"));
    const output: Array<string> = [];

    await ompSync(makeCtx(root, { missingTool: "omp", dryRun: true, output }));

    const lines = output.join("").split("\n");
    expect(lines.filter((line) => line.startsWith("[dry-run] omp "))).toEqual([]);
    expect(lines.filter((line) => line.includes("omp not installed"))).toHaveLength(1);
    expect(ompCommands()).toEqual([]);
  });

  it("deploys the intercom configuration into the agent directory of a named profile", async () => {
    respondWithInventory(INVENTORY_EMPTY);
    const root = makeRoot();
    process.env["OMP_PROFILE"] = "work";

    await ompSync(makeCtx(root, { missingTool: "omp" }));

    expect(
      readFileSync(
        join(root, ".omp", "profiles", "work", "agent", "intercom", "config.json"),
        "utf8",
      ),
    ).toBe("{}\n");
    expect(existsSync(join(root, ".pi", "agent", "intercom"))).toBe(false);
  });

  it("falls back to the full refresh path when the inventory cannot be parsed", async () => {
    respondWithInventory("not json");
    const root = makeRoot();
    const output: Array<string> = [];
    const state = await ompSync(makeCtx(root, { output }));

    expect(ompCommands()).toEqual([
      "plugin marketplace update docks",
      "plugin list --json",
      "plugin install --scope user docks@docks",
      "plugin install --scope user plan-lifecycle@docks",
      `install pi-intercom@${PIN}`,
      kitLink(root),
      "plugin list --json",
    ]);
    expect(state.pluginsInstalled).toBe(4);
    // The inventory stays unreadable after the operations, so each plugin keeps only its id.
    expect(pluginSummary(output)).toBe(
      "omp plugins synced: docks@docks, plan-lifecycle@docks, pi-intercom, docks-kit-omp linked",
    );
  });

  it("shows versions without (new) when only the second inventory read succeeds", async () => {
    const root = makeRoot();
    respondWithInventory(["not json", inventoryPresent(root)]);
    const output: Array<string> = [];
    await ompSync(makeCtx(root, { output }));

    // The first read failed, so the sync cannot know whether a plugin was new.
    expect(pluginSummary(output)).toBe(
      `omp plugins synced: docks@docks 0.18.0, plan-lifecycle@docks 0.9.0, pi-intercom ${PIN}, docks-kit-omp linked`,
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
    const state = await ompSync(makeCtx(root, { skipPluginRefresh: true }));

    expect(ompCommands()).toEqual([
      "plugin list --json",
      "plugin install --scope user docks@docks",
      "plugin install --scope user plan-lifecycle@docks",
      kitLink(root),
      "plugin list --json",
    ]);
    expect(state.pluginsInstalled).toBe(4);
  });

  it("previews the kit plugin link in a dry run without spawning omp", async () => {
    const root = makeRoot();
    const output: Array<string> = [];

    await ompSync(makeCtx(root, { dryRun: true, output }));

    const lines = output.join("").split("\n");
    expect(lines).toContain(`[dry-run] omp plugin link ${root}/.docks-kit/omp-plugin`);
    expect(ompCommands()).toEqual([]);
  });

  it("warns about and logs a marketplace upgrade that changed the version", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const docksFinishedAt = 1_700_000_000_000;
    const root = makeRoot();
    respondWithInventory([inventoryPresent(root), inventoryPresent(root, "0.19.0")]);
    finishCommandsAt({
      "plugin upgrade --scope user docks@docks": docksFinishedAt,
      "plugin upgrade --scope user plan-lifecycle@docks": docksFinishedAt + 5000,
    });
    const output: Array<string> = [];
    const ctx = makeCtx(root, { output });

    await ompSync(ctx);

    expect(upgradeWarnings(output)).toEqual([upgradeWarning("docks@docks", "0.18.0", "0.19.0")]);
    expect(ctx.nextStepTriggers.ompPluginUpgraded).toBe(true);
    // The omp config files that this first sync deployed also need a restart.
    expect(ompNextSteps(ctx)).toEqual([UPGRADE_NEXT_STEP, RESTART_NEXT_STEP]);
    const files = readdirSync(upgradeLog(root));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(new RegExp(`^${docksFinishedAt}-[0-9a-f]+\\.json$`));
    expect(JSON.parse(readFileSync(join(upgradeLog(root), files[0] ?? ""), "utf8"))).toEqual({
      version: 1,
      id: "docks@docks",
      before: "0.18.0",
      after: "0.19.0",
      finishedAt: new Date(docksFinishedAt).toISOString(),
    });
    if (process.platform !== "win32") {
      expect(statSync(upgradeLog(root)).mode & 0o777).toBe(0o700);
      expect(statSync(join(upgradeLog(root), files[0] ?? "")).mode & 0o777).toBe(0o600);
    }
  });

  it("keeps the event files of two syncs that upgrade different plugins", async () => {
    const root = makeRoot();
    respondWithInventory([inventoryPresent(root), inventoryPresent(root, "0.19.0")]);
    await ompSync(makeCtx(root));
    respondWithInventory([
      inventoryPresent(root, "0.19.0"),
      inventoryPresent(root, "0.19.0", "0.10.0"),
    ]);
    await ompSync(makeCtx(root));

    expect(loggedUpgrades(root)).toEqual([
      "docks@docks 0.18.0 -> 0.19.0",
      "plan-lifecycle@docks 0.9.0 -> 0.10.0",
    ]);
  });

  it("keeps the event files of two overlapping syncs that upgrade different plugins", async () => {
    const root = makeRoot();
    // Each sync takes the next first inventory; both second reads give the same versions.
    respondWithInventory([
      inventoryPresent(root, "0.18.0", "0.10.0"),
      inventoryPresent(root, "0.19.0", "0.9.0"),
      inventoryPresent(root, "0.19.0", "0.10.0"),
    ]);

    await Promise.all([syncPlugins(makeCtx(root)), syncPlugins(makeCtx(root))]);

    // Both first inventory reads ran before either upgrade, so the syncs overlapped.
    expect(ompCommands().slice(0, 2)).toEqual(["plugin list --json", "plugin list --json"]);
    expect(loggedUpgrades(root)).toEqual([
      "docks@docks 0.18.0 -> 0.19.0",
      "plan-lifecycle@docks 0.9.0 -> 0.10.0",
    ]);
  });

  it("warns about and logs each upgrade as unknown when the versions cannot be read after it", async () => {
    const root = makeRoot();
    respondWithInventory([inventoryPresent(root), "not json"]);
    const output: Array<string> = [];
    const ctx = makeCtx(root, { output });

    await ompSync(ctx);

    expect(messageLines(output, "omp plugin versions")).toEqual([
      "omp plugin versions could not be read after the upgrade — each upgraded plugin counts as changed",
    ]);
    expect(upgradeWarnings(output)).toEqual([
      upgradeWarning("docks@docks", "0.18.0", "unknown"),
      upgradeWarning("plan-lifecycle@docks", "0.9.0", "unknown"),
    ]);
    expect(ctx.nextStepTriggers.ompPluginUpgraded).toBe(true);
    expect(loggedUpgrades(root)).toEqual([
      "docks@docks 0.18.0 -> unknown",
      "plan-lifecycle@docks 0.9.0 -> unknown",
    ]);
  });

  it.each([
    ["a version that can be read after the upgrade", "0.19.0"],
    ["a version that cannot be read after the upgrade", "unknown"],
  ])(
    "advises /reload-plugins, skill://, and the restart exception for %s",
    async (_name, after) => {
      const root = makeRoot();
      respondWithInventory([
        inventoryPresent(root),
        after === "unknown" ? "not json" : inventoryPresent(root, after, after),
      ]);
      const output: Array<string> = [];

      await ompSync(makeCtx(root, { output }));

      const warnings = upgradeWarnings(output);
      expect(warnings).toHaveLength(2);
      for (const warning of warnings) {
        expect(warning).toContain(`-> ${after}:`);
        expect(warning).toContain("until they run /reload-plugins");
        expect(warning).toContain("read its skills again through skill://");
        expect(warning).toContain(
          "(restart omp instead when the plugin ships hooks, extension modules, or non-MCP tools)",
        );
      }
    },
  );

  it("prints only the upgrade rule when version-changing upgrades are the only plugin change", async () => {
    const root = makeRoot();
    respondWithInventory([inventoryPresent(root), inventoryPresent(root, "0.19.0", "0.10.0")]);
    const ctx = makeCtx(root);

    await syncPlugins(ctx);

    expect(ompCommands()).toEqual([
      "plugin list --json",
      "plugin upgrade --scope user docks@docks",
      "plugin upgrade --scope user plan-lifecycle@docks",
      "plugin list --json",
    ]);
    expect(ctx.nextStepTriggers.ompPluginUpgraded).toBe(true);
    expect(ctx.nextStepTriggers.ompRestart).toBe(false);
    expect(ompNextSteps(ctx)).toEqual([UPGRADE_NEXT_STEP]);
  });

  it("prints the upgrade rule and the restart advice when the same pass also installs a plugin", async () => {
    const root = makeRoot();
    // pi-intercom is missing before the pass, so the pass installs it.
    const withoutIntercom = JSON.stringify({
      npm: [
        { name: "docks-kit-omp", version: "0.0.0", path: join(root, ".docks-kit", "omp-plugin") },
      ],
      marketplace: [
        { id: "docks@docks", scope: "user", entries: [{ version: "0.18.0" }] },
        { id: "plan-lifecycle@docks", scope: "user", entries: [{ version: "0.9.0" }] },
      ],
    });
    respondWithInventory([withoutIntercom, inventoryPresent(root, "0.19.0", "0.10.0")]);
    const ctx = makeCtx(root);

    await syncPlugins(ctx);

    expect(ompCommands()).toEqual([
      "plugin list --json",
      "plugin upgrade --scope user docks@docks",
      "plugin upgrade --scope user plan-lifecycle@docks",
      `install pi-intercom@${PIN}`,
      "plugin list --json",
    ]);
    expect(ctx.nextStepTriggers.ompPluginUpgraded).toBe(true);
    expect(ctx.nextStepTriggers.ompRestart).toBe(true);
    expect(ompNextSteps(ctx)).toEqual([UPGRADE_NEXT_STEP, RESTART_NEXT_STEP]);
  });

  it.each([
    [
      "a marketplace reinstall at the same versions",
      (root: string) => [inventoryPresent(root)],
      [
        "plugin upgrade --scope user docks@docks",
        "plugin upgrade --scope user plan-lifecycle@docks",
      ],
      false,
      [RESTART_NEXT_STEP],
    ],
    [
      "a marketplace install of a missing plugin next to a version-changing upgrade",
      (root: string) => [
        inventoryWithMarketplace(root, [
          { id: "docks@docks", scope: "user", entries: [{ version: "0.18.0" }] },
        ]),
        inventoryPresent(root, "0.19.0", "0.10.0"),
      ],
      [
        "plugin upgrade --scope user docks@docks",
        "plugin install --scope user plan-lifecycle@docks",
      ],
      true,
      [UPGRADE_NEXT_STEP, RESTART_NEXT_STEP],
    ],
    [
      "an upgrade whose old version the first inventory does not give",
      (root: string) => [
        inventoryWithMarketplace(root, [
          { id: "docks@docks", scope: "user", entries: [] },
          { id: "plan-lifecycle@docks", scope: "user", entries: [{ version: "0.9.0" }] },
        ]),
        inventoryPresent(root, "0.19.0", "0.10.0"),
      ],
      [
        "plugin upgrade --scope user docks@docks",
        "plugin upgrade --scope user plan-lifecycle@docks",
      ],
      true,
      [UPGRADE_NEXT_STEP, RESTART_NEXT_STEP],
    ],
  ])(
    "sets the restart trigger for %s",
    async (_name, inventories, pluginCommands, upgraded, nextSteps) => {
      const root = makeRoot();
      respondWithInventory(inventories(root));
      const ctx = makeCtx(root);

      await syncPlugins(ctx);

      // Only marketplace operations run, so no npm install or link sets the trigger.
      expect(ompCommands()).toEqual([
        "plugin list --json",
        ...pluginCommands,
        "plugin list --json",
      ]);
      expect(ctx.nextStepTriggers.ompRestart).toBe(true);
      expect(ctx.nextStepTriggers.ompPluginUpgraded).toBe(upgraded);
      expect(ompNextSteps(ctx)).toEqual(nextSteps);
    },
  );

  it("warns and keeps the upgrade advice when the upgrade log cannot be written", async () => {
    const root = makeRoot();
    // A file at the log path makes the folder creation fail.
    mkdirSync(join(root, ".cache", "docks-kit"), { recursive: true });
    writeFileSync(upgradeLog(root), "");
    respondWithInventory([inventoryPresent(root), inventoryPresent(root, "0.19.0")]);
    const output: Array<string> = [];
    const ctx = makeCtx(root, { output });

    await ompSync(ctx);

    const [logWarning, ...otherLogWarnings] = messageLines(output, "omp plugin upgrade log");
    expect(otherLogWarnings).toEqual([]);
    expect(logWarning).toMatch(
      /^omp plugin upgrade log not written: .+ — running omp sessions get no reminder for these upgrades; give each of them the advice above$/,
    );
    expect(pluginSummary(output)).toBe(
      "omp plugins synced: docks@docks 0.18.0 -> 0.19.0, plan-lifecycle@docks 0.9.0 (current)",
    );
    expect(upgradeWarnings(output)).toHaveLength(1);
    expect(ctx.failures).toEqual([]);
    expect(ompNextSteps(ctx)).toEqual([UPGRADE_NEXT_STEP, RESTART_NEXT_STEP]);
  });

  it("warns and keeps the new event when the upgrade log cannot be pruned", async () => {
    const root = makeRoot();
    mkdirSync(upgradeLog(root), { recursive: true });
    // The oldest name is a folder, so the prune cannot unlink it.
    mkdirSync(join(upgradeLog(root), "1000-aa.json"));
    for (let index = 1; index < 100; index++) {
      writeFileSync(join(upgradeLog(root), `${1000 + index}-aa.json`), "{}\n");
    }
    respondWithInventory([inventoryPresent(root), inventoryPresent(root, "0.19.0")]);
    const output: Array<string> = [];
    const ctx = makeCtx(root, { output });

    await ompSync(ctx);

    const [logWarning, ...otherLogWarnings] = messageLines(output, "omp plugin upgrade log");
    expect(otherLogWarnings).toEqual([]);
    expect(logWarning).toMatch(
      /^omp plugin upgrade log not pruned: .+ — it can keep more than 100 event files$/,
    );
    expect(readdirSync(upgradeLog(root))).toHaveLength(101);
    expect(loggedUpgrades(root)).toEqual(["docks@docks 0.18.0 -> 0.19.0"]);
    expect(ctx.failures).toEqual([]);
  });

  it("cuts the upgrade log to the newest 100 event files", async () => {
    const root = makeRoot();
    mkdirSync(upgradeLog(root), { recursive: true });
    // A mode that the umask cannot make 0700, so the check below needs the sync's chmod.
    chmodSync(upgradeLog(root), 0o755);
    const old = Array.from({ length: 105 }, (_, index) => `${1000 + index}-aa.json`);
    for (const name of old) writeFileSync(join(upgradeLog(root), name), "{}\n");
    respondWithInventory([inventoryPresent(root), inventoryPresent(root, "0.19.0")]);

    await ompSync(makeCtx(root));

    const files = readdirSync(upgradeLog(root));
    expect(files).toHaveLength(100);
    // 106 files exist after the write, so the six oldest go.
    expect(files.filter((name) => old.includes(name)).sort()).toEqual(old.slice(6).sort());
    // The folder had mode 0755 before the sync, so the sync set 0700.
    if (process.platform !== "win32") {
      expect(statSync(upgradeLog(root)).mode & 0o777).toBe(0o700);
    }
  });

  it.each([
    ["an unchanged upgrade", false, (root: string) => [inventoryPresent(root)]],
    [
      "a new install",
      false,
      (root: string) => [INVENTORY_EMPTY, inventoryPresent(root, "0.19.0", "0.10.0")],
    ],
    [
      "a new install whose versions cannot be read after it",
      false,
      () => [INVENTORY_EMPTY, "not json"],
    ],
    ["a sync that cannot read the inventory", false, () => ["not json"]],
    ["a dry run", true, (root: string) => [inventoryPresent(root, "0.19.0")]],
  ])("prints no upgrade warning and logs nothing for %s", async (_name, dryRun, inventories) => {
    const root = makeRoot();
    respondWithInventory(inventories(root));
    const output: Array<string> = [];
    const ctx = makeCtx(root, { dryRun, output });

    await ompSync(ctx);

    expect(upgradeWarnings(output)).toEqual([]);
    expect(messageLines(output, "omp plugin versions")).toEqual([]);
    expect(ctx.nextStepTriggers.ompPluginUpgraded).toBe(false);
    expect(existsSync(upgradeLog(root))).toBe(false);
  });
});
