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
          env: expect.objectContaining({ DOCKS_KIT_ENGINE: "native-raw" }),
        }),
      );
    } finally {
      mocks.bun.isStandaloneExecutable = false;
      vi.resetModules();
    }
  });
});

describe("supported host boundary", () => {
  it.each(["x64", "arm64"] as const)(
    "admits win32/%s and exits with the native engine's failure code",
    async (arch) => {
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
    ["freebsd", "arm64"],
    ["linux", "ia32"],
    ["win32", "ia32"],
  ] as const)("rejects unsupported %s/%s hosts", async (platform, arch) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    vi.spyOn(process, "arch", "get").mockReturnValue(arch);

    await expect(Effect.runPromise(engineCapture(["status"]))).rejects.toThrow("exit 2");
    expect(console.error).toHaveBeenCalledWith(
      `unsupported host ${platform}/${arch}; docks-kit supports only Linux, macOS, and Windows on x64 or arm64`,
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
        env: expect.objectContaining({ DOCKS_KIT_ENGINE: "native-raw" }),
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
    expect(process.stderr.write).not.toHaveBeenCalled();
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
