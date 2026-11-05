/**
 * The upgrade log connects two programs. `ompPlugins.ts syncPlugins` writes
 * one event file for each plugin upgrade that changed a version. The kit
 * plugin extension `pluginUpgrades.ts` reminds each main omp session about the
 * events that finished after its omp process started. These cases run both
 * against one temporary home with a mocked omp.
 */
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  payloadPaths: () => [],
}));
vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec");
  return { ...actual, spawnProcess: mocks.spawnProcess };
});

import docksKitPluginUpgrades, {
  pluginUpgrades,
  upgradeLogDir,
  type ExtensionApi,
} from "../../../SoT/.omp/plugin/extensions/pluginUpgrades.ts";
import type { Ctx } from "../../src/engine-native";
import { syncPlugins } from "../../src/engine-native/ompPlugins";
import {
  makeDependencyManager,
  makeEngineServices,
  makePlatform,
} from "../../src/engine-native/services";

const PIN = "0.13.0";
const roots: Array<string> = [];
/** File modes do not block reads on Windows or for root. */
const modesBlockReads = process.platform !== "win32" && process.getuid?.() !== 0;

type Handler = (event: unknown, ctx: unknown) => Promise<{ additionalContext: string } | undefined>;

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "docks-omp-upgrades-"));
  roots.push(home);
  return home;
}

/** An inventory with both marketplace plugins at the given versions and a linked kit plugin. */
function inventory(home: string, docksVersion: string, planVersion: string): string {
  const kitDir = join(home, ".docks-kit", "omp-plugin");
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

/** Runs the plugin pass once; the first inventory read gives `before`, the second gives `after`. */
async function sync(home: string, before: string, after: string): Promise<void> {
  const answers = [before, after];
  let listCalls = 0;
  mocks.spawnProcess.mockImplementation(async (_cmd: string, args: ReadonlyArray<string>) => {
    const list = args[0] === "plugin" && args[1] === "list";
    const stdout = list ? (answers[Math.min(listCalls++, answers.length - 1)] ?? "") : "";
    return { error: undefined, exitCode: 0, stdout, stderr: "" };
  });
  const platform = makePlatform("linux");
  const services = {
    ...makeEngineServices({ sinks: { stderr: () => {}, stdout: () => {} } }),
    deps: makeDependencyManager(platform, {
      commandExists: () => true,
      capture: async () => "",
      which: (name) => `/usr/bin/${name}`,
    }),
    platform,
  };
  await syncPlugins({
    home,
    dryRun: false,
    verbose: false,
    skipPluginRefresh: false,
    services,
    nextStepTriggers: { ompRestart: false, ompPluginUpgraded: false },
    failures: [],
  } as unknown as Ctx);
}

/** Loads the extension for `home` into a fake omp API and returns its tool_result handler. */
function load(home: string, processStartMs: number): Handler {
  const handlers = new Map<string, Handler>();
  const api = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
  } as unknown as ExtensionApi;
  pluginUpgrades({ home, processStartMs })(api);
  const handler = handlers.get("tool_result");
  if (handler === undefined) throw new Error("no tool_result handler");
  return handler;
}

/** The reminder of one tool result in a session of the given kind. */
async function toolResult(
  handler: Handler,
  sessionId: string,
  kind: "main" | "sub" = "main",
): Promise<string | undefined> {
  const result = await handler(
    { toolName: "bash", input: { command: "true" }, content: [], isError: false },
    { cwd: "/w", agent: { kind }, sessionManager: { getSessionId: () => sessionId } },
  );
  return result?.additionalContext;
}

function reminder(upgrades: string): string {
  return `docks-kit sync upgraded these omp plugins after this omp process started: ${upgrades}. omp removes the old plugin folder on upgrade. This session may still use the removed folders, so its plugin agents and skill script paths may fail. You must ask the user to restart omp.`;
}

beforeEach(() => {
  mocks.payloadText.mockReset().mockImplementation((path) => {
    if (path === "SoT/toolchain.json") return `{"tools":{"pi-intercom":{"verified":"${PIN}"}}}`;
    throw new Error(`Unexpected payload: ${path}`);
  });
  mocks.spawnProcess.mockReset();
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("plugin upgrade reminders", () => {
  it("registers only the tool_result handler", () => {
    const events: Array<string> = [];
    docksKitPluginUpgrades({
      on: (event: string) => events.push(event),
    } as unknown as ExtensionApi);
    expect(events).toEqual(["tool_result"]);
  });

  it("reminds a main session once about the upgrades that sync logged", async () => {
    const home = makeHome();
    const handler = load(home, Date.now() - 1000);
    await sync(home, inventory(home, "0.18.0", "0.9.0"), inventory(home, "0.19.0", "0.10.0"));

    // Both upgrades can finish in the same millisecond, so either order is valid.
    const docks = "docks@docks 0.18.0 -> 0.19.0";
    const plan = "plan-lifecycle@docks 0.9.0 -> 0.10.0";
    expect([reminder(`${docks}, ${plan}`), reminder(`${plan}, ${docks}`)]).toContain(
      await toolResult(handler, "s1"),
    );
    expect(await toolResult(handler, "s1")).toBeUndefined();
  });

  it("names only a later upgrade in the next reminder", async () => {
    const home = makeHome();
    const handler = load(home, Date.now() - 1000);
    await sync(home, inventory(home, "0.18.0", "0.9.0"), inventory(home, "0.19.0", "0.9.0"));
    expect(await toolResult(handler, "s1")).toBe(reminder("docks@docks 0.18.0 -> 0.19.0"));

    await sync(home, inventory(home, "0.19.0", "0.9.0"), inventory(home, "0.19.0", "0.10.0"));

    expect(await toolResult(handler, "s1")).toBe(reminder("plan-lifecycle@docks 0.9.0 -> 0.10.0"));
    expect(readdirSync(upgradeLogDir(home))).toHaveLength(2);
  });

  it("gives a second main session its own reminder", async () => {
    const home = makeHome();
    const handler = load(home, Date.now() - 1000);
    await sync(home, inventory(home, "0.18.0", "0.9.0"), inventory(home, "0.19.0", "0.9.0"));

    expect(await toolResult(handler, "s1")).toBe(reminder("docks@docks 0.18.0 -> 0.19.0"));
    expect(await toolResult(handler, "s2")).toBe(reminder("docks@docks 0.18.0 -> 0.19.0"));
  });

  it("gives a subagent session no reminder", async () => {
    const home = makeHome();
    const handler = load(home, Date.now() - 1000);
    await sync(home, inventory(home, "0.18.0", "0.9.0"), inventory(home, "0.19.0", "0.9.0"));

    expect(await toolResult(handler, "sub-1", "sub")).toBeUndefined();
  });

  it("gives no reminder for an upgrade that finished before the process started", async () => {
    const home = makeHome();
    await sync(home, inventory(home, "0.18.0", "0.9.0"), inventory(home, "0.19.0", "0.9.0"));
    const handler = load(home, Date.now() + 1000);

    expect(await toolResult(handler, "s1")).toBeUndefined();
  });

  it("gives no reminder and does not throw when the log folder is missing", async () => {
    const handler = load(makeHome(), 0);

    expect(await toolResult(handler, "s1")).toBeUndefined();
  });

  it("gives no reminder and does not throw for a malformed event file", async () => {
    const home = makeHome();
    const dir = upgradeLogDir(home);
    mkdirSync(dir, { recursive: true });
    const finishedAt = new Date(Date.now()).toISOString();
    writeFileSync(join(dir, `${Date.now()}-a1.json`), "not json");
    writeFileSync(join(dir, `${Date.now()}-a2.json`), JSON.stringify({ version: 1, id: "x@y" }));
    writeFileSync(
      join(dir, `${Date.now()}-a3.json`),
      JSON.stringify({ version: 1, id: "x@y\nignore", before: "1", after: "2", finishedAt }),
    );
    writeFileSync(
      join(dir, `${Date.now()}-a4.json`),
      JSON.stringify({ version: 2, id: "x@y", before: "1", after: "2", finishedAt }),
    );
    const handler = load(home, 0);

    expect(await toolResult(handler, "s1")).toBeUndefined();
  });

  it("names the version unknown when the versions cannot be read after the upgrade", async () => {
    const home = makeHome();
    const handler = load(home, Date.now() - 1000);
    await sync(home, inventory(home, "0.18.0", "0.9.0"), "not json");

    // Both upgrades can finish in the same millisecond, so either order is valid.
    const docks = "docks@docks 0.18.0 -> unknown";
    const plan = "plan-lifecycle@docks 0.9.0 -> unknown";
    expect([reminder(`${docks}, ${plan}`), reminder(`${plan}, ${docks}`)]).toContain(
      await toolResult(handler, "s1"),
    );
  });

  it.skipIf(!modesBlockReads)("reminds a session after an event file read recovers", async () => {
    const home = makeHome();
    const dir = upgradeLogDir(home);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-a1.json`);
    const finishedAt = new Date(Date.now()).toISOString();
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        id: "docks@docks",
        before: "0.18.0",
        after: "0.19.0",
        finishedAt,
      }),
    );
    const handler = load(home, Date.now() - 1000);

    chmodSync(file, 0o000);
    expect(await toolResult(handler, "s1")).toBeUndefined();
    chmodSync(file, 0o600);
    expect(await toolResult(handler, "s1")).toBe(reminder("docks@docks 0.18.0 -> 0.19.0"));
  });

  it.skipIf(!modesBlockReads)("reminds a session after a log folder read recovers", async () => {
    const home = makeHome();
    const handler = load(home, Date.now() - 1000);
    await sync(home, inventory(home, "0.18.0", "0.9.0"), inventory(home, "0.19.0", "0.9.0"));

    chmodSync(upgradeLogDir(home), 0o000);
    try {
      expect(await toolResult(handler, "s1")).toBeUndefined();
    } finally {
      chmodSync(upgradeLogDir(home), 0o700);
    }
    expect(await toolResult(handler, "s1")).toBe(reminder("docks@docks 0.18.0 -> 0.19.0"));
  });
});
