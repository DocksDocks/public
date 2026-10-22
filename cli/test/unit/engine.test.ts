import { Effect } from "effect";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const originalBun = Object.getOwnPropertyDescriptor(globalThis, "Bun");
  const bun = { isStandaloneExecutable: false };
  Object.defineProperty(globalThis, "Bun", { configurable: true, value: bun });
  return {
    originalBun,
    bun,
    runEngineNative: vi.fn(),
    spawnSync: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
vi.mock("../../src/engine-native", () => ({ runEngineNative: mocks.runEngineNative }));

import { EngineCaptureError, engine, engineCapture } from "../../src/engine";
import { ENV_GLOBAL_KEYS } from "../../src/engine-native/engineCtx";
import { EngineServicesLive } from "../../src/services";

beforeEach(() => {
  mocks.runEngineNative.mockReset();
  mocks.spawnSync.mockReset();
  vi.stubEnv("DOCKS_KIT_ENGINE", "");
  vi.stubEnv("DOCKS_KIT_HOME", "");
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  vi.spyOn(process, "arch", "get").mockReturnValue("x64");
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${String(code)}`);
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(() => {
  if (mocks.originalBun === undefined) Reflect.deleteProperty(globalThis, "Bun");
  else Object.defineProperty(globalThis, "Bun", mocks.originalBun);
});

describe("compiled runtime capture", () => {
  it("runs a standalone executable without prepending the source entrypoint", async () => {
    mocks.bun.isStandaloneExecutable = true;
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      output: [null, "compiled result\n", null],
      pid: 123,
      signal: null,
      status: 0,
      stderr: null,
      stdout: "compiled result\n",
    });
    try {
      // Static imports evaluate before this runtime predicate changes.
      vi.resetModules();
      const { engineCapture: standaloneCapture } = await import("../../src/engine");
      await expect(Effect.runPromise(standaloneCapture(["status"]))).resolves.toBe(
        "compiled result\n",
      );
      expect(mocks.spawnSync).toHaveBeenCalledWith(
        process.execPath,
        ["status"],
        expect.objectContaining({
          env: expect.objectContaining({ DOCKS_KIT_ENGINE: "native-capture" }),
        }),
      );
    } finally {
      mocks.bun.isStandaloneExecutable = false;
      vi.resetModules();
    }
  });
});

describe("supported host boundary", () => {
  it.each([
    ["linux", "x64"],
    ["linux", "arm64"],
    ["darwin", "arm64"],
    ["win32", "x64"],
  ] as const)(
    "admits %s/%s and exits with the native engine's failure code",
    async (platform, arch) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      vi.spyOn(process, "arch", "get").mockReturnValue(arch);
      mocks.runEngineNative.mockResolvedValue(37);

      await expect(
        Effect.runPromise(Effect.provide(engine(["status"]), EngineServicesLive)),
      ).rejects.toThrow("exit 37");
      expect(console.error).not.toHaveBeenCalled();
    },
  );
});

describe("unsupported host boundary", () => {
  it.each([
    ["darwin", "x64"],
    ["win32", "arm64"],
    ["freebsd", "arm64"],
    ["linux", "ia32"],
    ["win32", "ia32"],
  ] as const)("rejects unsupported %s/%s hosts", async (platform, arch) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    vi.spyOn(process, "arch", "get").mockReturnValue(arch);

    await expect(Effect.runPromise(engineCapture(["status"]))).rejects.toThrow("exit 2");
    expect(console.error).toHaveBeenCalledWith(
      `unsupported host ${platform}/${arch}; docks-kit supports Linux on x64 and arm64, macOS on arm64, and Windows on x64`,
    );
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });
});

describe("EngineNative Effect seam", () => {
  beforeEach(() => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.spyOn(process, "arch", "get").mockReturnValue("x64");
  });

  it("rejects a removed Bash engine before running the native engine", async () => {
    vi.stubEnv("DOCKS_KIT_ENGINE", "bash");

    await expect(
      Effect.runPromise(Effect.provide(engine(["status"]), EngineServicesLive)),
    ).rejects.toThrow("exit 2");
    expect(console.error).toHaveBeenCalledWith(
      "bash engine removed — recover at tag bash-engine-final",
    );
    expect(mocks.runEngineNative).not.toHaveBeenCalled();
  });

  it("exits with the EngineNative non-zero code", async () => {
    mocks.runEngineNative.mockResolvedValue(3);

    await expect(
      Effect.runPromise(Effect.provide(engine(["status"]), EngineServicesLive)),
    ).rejects.toThrow("exit 3");
  });

  it("maps a rejected EngineNative Promise to a user-facing CLI failure", async () => {
    mocks.runEngineNative.mockRejectedValue(new Error("native engine failed"));

    await expect(
      Effect.runPromise(Effect.provide(engine(["status"]), EngineServicesLive)),
    ).rejects.toMatchObject({
      _tag: "UserError",
      message: "engine operation 'status' failed: native engine failed",
    });
  });

  it("reports the default operation and unknown cause when the native engine rejects silently", async () => {
    mocks.runEngineNative.mockRejectedValue(new Error(""));

    await expect(
      Effect.runPromise(Effect.provide(engine([]), EngineServicesLive)),
    ).rejects.toMatchObject({
      _tag: "UserError",
      message: "engine operation 'default' failed: unknown error",
    });
  });

  it("returns the captured stdout and invokes the raw child with isolated output channels", async () => {
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      output: [null, '{"toolchain":[]}\n', null],
      pid: 123,
      signal: null,
      status: 0,
      stderr: null,
      stdout: '{"toolchain":[]}\n',
    });

    await expect(Effect.runPromise(engineCapture(["toolchain", "check", "--json"]))).resolves.toBe(
      '{"toolchain":[]}\n',
    );
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringMatching(/\/cli\/src\/main\.ts$/), "toolchain", "check", "--json"],
      expect.objectContaining({
        encoding: "utf8",
        env: expect.objectContaining({ DOCKS_KIT_ENGINE: "native-capture" }),
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
    expect(process.stderr.write).not.toHaveBeenCalled();
  });

  it("runs the public engine with env globals disabled", async () => {
    mocks.runEngineNative.mockResolvedValue(0);

    await Effect.runPromise(Effect.provide(engine(["sync", "claude"]), EngineServicesLive));
    expect(mocks.runEngineNative).toHaveBeenCalledWith(["sync", "claude"], expect.anything(), {
      envGlobals: false,
    });
  });

  it("strips env globals from the raw capture child and keeps the other variables", async () => {
    for (const key of ENV_GLOBAL_KEYS) vi.stubEnv(key, "1");
    vi.stubEnv("DOCKS_KIT_SYNC_CONCURRENCY", "2");
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      output: [null, "", null],
      pid: 123,
      signal: null,
      status: 0,
      stderr: null,
      stdout: "",
    });

    await expect(Effect.runPromise(engineCapture(["toolchain", "check"]))).resolves.toBe("");
    const options = mocks.spawnSync.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv };
    for (const key of ENV_GLOBAL_KEYS) expect(options.env).not.toHaveProperty(key);
    expect(options.env).toMatchObject({
      DOCKS_KIT_ENGINE: "native-capture",
      DOCKS_KIT_SYNC_CONCURRENCY: "2",
    });
  });

  it("drops env-global keys from the capture child case-insensitively on win32 only (R04)", async () => {
    // Windows environment names are case-insensitive, so the child would still
    // read `claude_compact_window` as CLAUDE_COMPACT_WINDOW there.
    vi.stubEnv("claude_compact_window", "junk");
    vi.stubEnv("Dry_Run", "1");
    vi.stubEnv("CLAUDE_MODEL", "opus");
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      output: [null, "", null],
      pid: 123,
      signal: null,
      status: 0,
      stderr: null,
      stdout: "",
    });
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const globalKeys = new Set<string>(ENV_GLOBAL_KEYS);
    const childEnvOf = (call: number): NodeJS.ProcessEnv => {
      const options = mocks.spawnSync.mock.calls[call]?.[2] as
        | { env: NodeJS.ProcessEnv }
        | undefined;
      if (options === undefined) throw new Error(`spawnSync call ${call} did not happen`);
      return options.env;
    };

    await expect(Effect.runPromise(engineCapture(["toolchain", "check"]))).resolves.toBe("");
    expect(Object.keys(childEnvOf(0)).filter((name) => globalKeys.has(name.toUpperCase()))).toEqual(
      [],
    );

    // POSIX names stay case-sensitive: only the exact spelling is a global.
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    await expect(Effect.runPromise(engineCapture(["toolchain", "check"]))).resolves.toBe("");
    expect(childEnvOf(1)).toMatchObject({ claude_compact_window: "junk", Dry_Run: "1" });
    expect(childEnvOf(1)).not.toHaveProperty("CLAUDE_MODEL");
  });

  it("fails capture with the child status instead of returning plausible stdout", async () => {
    const diagnostic = "engine capture failed for 'toolchain check --json': exit 7";
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      output: [null, '{"toolchain":[]}\n', null],
      pid: 123,
      signal: null,
      status: 7,
      stderr: null,
      stdout: '{"toolchain":[]}\n',
    });

    await expect(
      Effect.runPromise(engineCapture(["toolchain", "check", "--json"])),
    ).rejects.toMatchObject({
      name: "EngineCaptureError",
      code: 7,
      diagnostic,
    } satisfies Partial<EngineCaptureError>);
    expect(process.stderr.write).toHaveBeenCalledWith(`\x1b[1;31m[err]\x1b[0m ${diagnostic}\n`);
  });

  it("includes the spawn error message in capture diagnostics", async () => {
    mocks.spawnSync.mockReturnValue({
      error: new Error("spawn docks-kit ENOENT"),
      output: [null, "", null],
      pid: 0,
      signal: null,
      status: null,
      stderr: null,
      stdout: "",
    });

    await expect(Effect.runPromise(engineCapture(["status"]))).rejects.toMatchObject({
      code: 1,
      diagnostic: "engine capture failed for 'status': spawn error: spawn docks-kit ENOENT",
    });
  });

  it("includes the terminating signal in capture diagnostics", async () => {
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      output: [null, "", null],
      pid: 123,
      signal: "SIGTERM",
      status: null,
      stderr: null,
      stdout: "",
    });

    await expect(Effect.runPromise(engineCapture(["status"]))).rejects.toMatchObject({
      code: 1,
      diagnostic: "engine capture failed for 'status': signal SIGTERM",
    });
  });
});
