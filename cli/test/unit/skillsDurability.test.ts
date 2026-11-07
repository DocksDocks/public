import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type * as FsModule from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ExecModule from "../../src/engine-native/exec";

const mocks = vi.hoisted(() => ({
  /** The SoT `skills.txt` text. */
  declaredSkills: "",
  failRemovalOf: undefined as string | undefined,
  payloadText: vi.fn<(path: string) => string>(),
  spawnProcess: vi.fn(),
}));

const faults = vi.hoisted(() => ({
  /**
   * While set, each `writeFileSync` on a path that starts with this prefix
   * writes half of the data and then throws `EIO`, as an interrupted write does.
   * The prefix covers the file and its temporary siblings.
   */
  interruptWritesUnder: undefined as string | undefined,
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof FsModule>("node:fs");
  return {
    ...actual,
    rmSync: (path: FsModule.PathLike, options?: FsModule.RmOptions) => {
      // The engine joins with "/" while the test joins natively; compare resolved paths.
      if (
        mocks.failRemovalOf !== undefined &&
        resolve(String(path)) === resolve(mocks.failRemovalOf)
      )
        throw new Error("EBUSY: resource busy");
      actual.rmSync(path, options);
    },
    writeFileSync: (
      file: FsModule.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
      options?: FsModule.WriteFileOptions,
    ) => {
      const prefix = faults.interruptWritesUnder;
      if (
        prefix === undefined ||
        typeof file === "number" ||
        !resolve(String(file)).startsWith(resolve(prefix))
      ) {
        actual.writeFileSync(file, data, options);
        return;
      }
      const bytes =
        typeof data === "string"
          ? Buffer.from(data)
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      actual.writeFileSync(file, bytes.subarray(0, bytes.length >> 1), options);
      throw Object.assign(new Error(`EIO: injected fault, writeFileSync '${String(file)}'`), {
        code: "EIO",
      });
    },
  };
});
vi.mock("../../src/payload", () => ({ payloadText: mocks.payloadText }));
vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec");
  return { ...actual, spawnProcess: mocks.spawnProcess };
});

import type { Ctx } from "../../src/engine-native";
import { linkOrCopy, skillsSync } from "../../src/engine-native/skillsSync";
import {
  makeDependencyManager,
  makeEngineServices,
  makePlatform,
} from "../../src/engine-native/services";

const roots: Array<string> = [];

function makeCtx(root: string, prune: boolean): Ctx {
  const platform = makePlatform("linux");
  const services = {
    ...makeEngineServices({ sinks: { stderr: () => {}, stdout: () => {} } }),
    deps: makeDependencyManager(platform, {
      commandExists: (name) => name === "npx",
      capture: async () => "",
      which: (name) => (name === "npx" ? "/usr/bin/npx" : ""),
    }),
    platform,
  };
  return {
    home: root,
    agentsDir: join(root, ".agents"),
    dryRun: false,
    prune,
    verbose: false,
    services,
    nextStepTriggers: { skillsRestart: false },
    failures: [] as Array<string>,
  } as Ctx;
}

function seedOrphan(root: string): { canonical: string; snapshot: string } {
  const canonical = join(root, ".agents", "skills", "orphan");
  mkdirSync(canonical, { recursive: true });
  writeFileSync(join(canonical, "SKILL.md"), "# orphan\n");
  const snapshot = join(root, ".agents", ".kit-managed-skills");
  writeFileSync(snapshot, "acme/orphan\n");
  return { canonical, snapshot };
}

describe("skills durability", () => {
  beforeEach(() => {
    mocks.declaredSkills = "";
    mocks.failRemovalOf = undefined;
    mocks.spawnProcess.mockReset();
    mocks.payloadText.mockReset().mockImplementation((path) => {
      if (path === "SoT/.agents/skills.txt") return mocks.declaredSkills;
      if (path === "SoT/.claude/settings.json") return '{"enabledPlugins":{}}';
      if (path === "SoT/toolchain.json") return '{"tools":{"skills-cli":{"verified":"1.5.15"}}}';
      throw new Error(`Unexpected payload: ${path}`);
    });
  });

  afterEach(() => {
    faults.interruptWritesUnder = undefined;
    mocks.failRemovalOf = undefined;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("preserves a regular file when the link source and destination resolve to the same path", () => {
    const root = mkdtempSync(join(tmpdir(), "docks-skills-same-path-"));
    roots.push(root);
    const executable = join(root, "bun");
    writeFileSync(executable, "user bun\n");

    expect(linkOrCopy(executable, executable)).toBe("symlink");
    expect(readFileSync(executable, "utf8")).toBe("user bun\n");
    expect(() => readlinkSync(executable)).toThrow();
  });

  it("keeps a dropped slug tracked through a plain sync until a prune removes it", async () => {
    const root = mkdtempSync(join(tmpdir(), "docks-skills-carry-"));
    roots.push(root);
    const { canonical, snapshot } = seedOrphan(root);

    await skillsSync(makeCtx(root, false));
    expect(readFileSync(snapshot, "utf8")).toBe("acme/orphan\n");
    expect(existsSync(canonical)).toBe(true);
    expect(mocks.spawnProcess).not.toHaveBeenCalled();

    await skillsSync(makeCtx(root, true));
    expect(existsSync(canonical)).toBe(false);
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
    expect(readFileSync(snapshot, "utf8")).toBe("");
  });

  it("retains a failed removal in the snapshot and retries it on the next prune", async () => {
    const root = mkdtempSync(join(tmpdir(), "docks-skills-prune-retry-"));
    roots.push(root);
    const ctx = makeCtx(root, true);
    const { canonical, snapshot } = seedOrphan(root);
    mocks.failRemovalOf = canonical;

    await skillsSync(ctx);
    expect(existsSync(canonical)).toBe(true);
    expect(readFileSync(snapshot, "utf8")).toBe("acme/orphan\n");

    mocks.failRemovalOf = undefined;
    await skillsSync(ctx);
    expect(existsSync(canonical)).toBe(false);
    expect(readFileSync(snapshot, "utf8")).toBe("");
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("keeps the previous snapshot when a snapshot write is interrupted", async () => {
    const root = mkdtempSync(join(tmpdir(), "docks-skills-snapshot-write-"));
    roots.push(root);
    const { canonical, snapshot } = seedOrphan(root);
    // An installed canonical skill, so the sync does not spawn an install.
    const kept = join(root, ".agents", "skills", "keep");
    mkdirSync(kept);
    writeFileSync(join(kept, "SKILL.md"), "# keep\n");
    mocks.declaredSkills = "acme/keep\n";

    faults.interruptWritesUnder = snapshot;
    await expect(skillsSync(makeCtx(root, false))).rejects.toThrow(/^EIO/);
    expect(readFileSync(snapshot, "utf8")).toBe("acme/orphan\n");

    faults.interruptWritesUnder = undefined;
    await skillsSync(makeCtx(root, true));

    expect(existsSync(canonical)).toBe(false);
    expect(existsSync(kept)).toBe(true);
    expect(readFileSync(snapshot, "utf8")).toBe("acme/keep\n");
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });
});
