/**
 * `omp plugin list --json` keys marketplace rows on a composite `id`
 * ("<plugin>@<marketplace>") and npm rows on `name` plus `version`. Reading the
 * wrong field turns every run into a failing reinstall, so these rows pin the
 * install / upgrade / skip decision that the inventory drives. The kit plugin
 * row also carries `path`: the kit links its directory unless that entry
 * already resolves to it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { ompSync } from "../../src/engine-native/ompSync";
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

/** A complete inventory; the kit plugin row resolves to the kit directory under `root`. */
function inventoryPresent(root: string): string {
  const kitDir = join(root, ".docks-kit", "omp-plugin");
  mkdirSync(kitDir, { recursive: true });
  return JSON.stringify({
    npm: [
      { name: "pi-intercom", version: PIN },
      { name: "docks-kit-omp", version: "0.0.0", path: kitDir },
    ],
    marketplace: [
      { id: "docks@docks", scope: "user", entries: [{ version: "0.18.0" }] },
      { id: "plan-lifecycle@docks", scope: "user", entries: [{ version: "0.9.0" }] },
    ],
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
    nextStepTriggers: { ompRestart: false },
    failures: [],
  } as unknown as Ctx;
}

/** Every `omp` argv the pipeline spawned, as one joined string per call. */
function ompCommands(): Array<string> {
  return mocks.spawnProcess.mock.calls.map((call) => (call[1] as ReadonlyArray<string>).join(" "));
}

function respondWithInventory(inventory: string, failingCommand?: string): void {
  mocks.spawnProcess.mockImplementation(async (_cmd: string, args: ReadonlyArray<string>) => {
    const failed = args.join(" ") === failingCommand;
    return {
      error: undefined,
      exitCode: failed ? 1 : 0,
      stdout: args[0] === "plugin" && args[1] === "list" ? inventory : "",
      stderr: failed ? "stub omp operation failure\n" : "",
    };
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
    ]);
    expect(state.pluginsInstalled).toBe(4);
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
    const state = await ompSync(makeCtx(root));

    expect(ompCommands()).toEqual([
      "plugin marketplace update docks",
      "plugin list --json",
      "plugin install --scope user docks@docks",
      "plugin install --scope user plan-lifecycle@docks",
      `install pi-intercom@${PIN}`,
      kitLink(root),
    ]);
    expect(state.pluginsInstalled).toBe(4);
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
});
