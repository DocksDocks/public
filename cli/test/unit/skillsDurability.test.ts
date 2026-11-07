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
   * Each `writeFileSync` on a path that starts with one of these prefixes
   * writes half of the data and then throws `EIO`, as an interrupted write does.
   * A prefix covers the file and its temporary siblings.
   */
  interruptWritesUnder: [] as ReadonlyArray<string>,
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
      if (
        typeof file === "number" ||
        !faults.interruptWritesUnder.some((prefix) =>
          resolve(String(file)).startsWith(resolve(prefix)),
        )
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

/** `output`, when given, collects the stdout and stderr text of the sync. */
function makeCtx(root: string, prune: boolean, output?: Array<string>): Ctx {
  const platform = makePlatform("linux");
  const write = (chunk: string): void => {
    output?.push(chunk);
  };
  const services = {
    ...makeEngineServices({ sinks: { stderr: write, stdout: write } }),
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

/** An installed skill that the owned record names (D-E2). */
function seedOrphan(root: string): { canonical: string; snapshot: string } {
  const canonical = join(root, ".agents", "skills", "orphan");
  mkdirSync(canonical, { recursive: true });
  writeFileSync(join(canonical, "SKILL.md"), "# orphan\n");
  const snapshot = join(root, ".agents", ".kit-owned-skills");
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
    faults.interruptWritesUnder = [];
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
    const kept = join(root, ".agents", "skills", "keep");
    // D-E2: the kit owns `keep` only when its install creates the directory.
    mocks.spawnProcess.mockImplementation(async () => {
      mkdirSync(kept, { recursive: true });
      writeFileSync(join(kept, "SKILL.md"), "# keep\n");
      return { error: undefined, exitCode: 0, stdout: "", stderr: "" };
    });
    mocks.declaredSkills = "acme/keep\n";

    faults.interruptWritesUnder = [snapshot];
    await expect(skillsSync(makeCtx(root, false))).rejects.toThrow(/^EIO/);
    expect(readFileSync(snapshot, "utf8")).toBe("acme/orphan\n");

    faults.interruptWritesUnder = [];
    await skillsSync(makeCtx(root, true));

    expect(existsSync(canonical)).toBe(false);
    expect(existsSync(kept)).toBe(true);
    expect(readFileSync(snapshot, "utf8")).toBe("acme/keep\n");
    expect(mocks.spawnProcess).toHaveBeenCalledTimes(1);
  });

  /**
   * D-E2: three record files under `~/.agents`, one slug per line.
   * - `.kit-pending-skills`: before `npx skills add`, sync adds the slug when
   *   the canonical skill directory does not exist. After the install, a slug
   *   whose directory exists moves to the owned record; else it leaves the
   *   pending record. At sync start, a leftover pending slug moves to the owned
   *   record when its directory exists; else sync drops it.
   * - `.kit-owned-skills`: the only record that lets `--prune` remove a skill.
   * - `.kit-managed-skills`: the legacy snapshot. Sync reads it and never
   *   writes it; its entries never let `--prune` remove a skill.
   */
  describe("skill ownership records", () => {
    function records(root: string): { owned: string; pending: string; legacy: string } {
      const agents = join(root, ".agents");
      return {
        owned: join(agents, ".kit-owned-skills"),
        pending: join(agents, ".kit-pending-skills"),
        legacy: join(agents, ".kit-managed-skills"),
      };
    }

    /** The slugs of a record file; none when the file does not exist. */
    function recordedSlugs(file: string): Array<string> {
      if (!existsSync(file)) return [];
      return readFileSync(file, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
    }

    function makeHome(): string {
      const root = mkdtempSync(join(tmpdir(), "docks-skills-owned-"));
      roots.push(root);
      return root;
    }

    /** A canonical skill directory with SKILL.md, as the skills CLI or a user makes it. */
    function makeCanonical(root: string, base: string): string {
      const canonical = join(root, ".agents", "skills", base);
      mkdirSync(canonical, { recursive: true });
      writeFileSync(join(canonical, "SKILL.md"), `# ${base}\n`);
      return canonical;
    }

    /** `npx skills add <owner>/<name>` succeeds and creates `~/.agents/skills/<name>`. */
    function installsSucceed(root: string): void {
      mocks.spawnProcess.mockImplementation(async (_command: string, args: Array<string>) => {
        const slug = args[args.indexOf("add") + 1] ?? "";
        makeCanonical(root, slug.slice(slug.lastIndexOf("/") + 1));
        return { error: undefined, exitCode: 0, stdout: "", stderr: "" };
      });
    }

    function textLines(output: ReadonlyArray<string>): Array<string> {
      return output.join("").split("\n");
    }

    it("records each installed skill before the next install starts", async () => {
      const root = makeHome();
      const { owned, pending } = records(root);
      mocks.declaredSkills = "acme/first\nacme/second\n";
      mocks.spawnProcess.mockImplementation(async (_command: string, args: Array<string>) => {
        const slug = args[args.indexOf("add") + 1] ?? "";
        // The sync stops while the second install runs.
        if (slug === "acme/second") throw new Error("stopped during the install of acme/second");
        makeCanonical(root, "first");
        return { error: undefined, exitCode: 0, stdout: "", stderr: "" };
      });

      await expect(skillsSync(makeCtx(root, false))).rejects.toThrow(/^stopped/);
      expect(recordedSlugs(pending)).toEqual(["acme/second"]);

      mocks.spawnProcess.mockReset();
      mocks.declaredSkills = "";
      await skillsSync(makeCtx(root, true));

      expect(existsSync(join(root, ".agents", "skills", "first"))).toBe(false);
      expect(recordedSlugs(owned)).toEqual([]);
      expect(recordedSlugs(pending)).toEqual([]);
      expect(mocks.spawnProcess).not.toHaveBeenCalled();
    });

    it("prunes a skill whose install the owned record did not record", async () => {
      const root = makeHome();
      const { owned, pending, legacy } = records(root);
      mocks.declaredSkills = "acme/fresh\n";
      installsSucceed(root);
      const canonical = join(root, ".agents", "skills", "fresh");

      // The sync stops after the install and before it records the skill. The
      // legacy snapshot is in the list, so a kit that still writes it stops there too.
      faults.interruptWritesUnder = [owned, legacy];
      await expect(skillsSync(makeCtx(root, false))).rejects.toThrow(/^EIO/);
      expect(existsSync(join(canonical, "SKILL.md"))).toBe(true);

      faults.interruptWritesUnder = [];
      mocks.declaredSkills = "";
      await skillsSync(makeCtx(root, true));

      expect(existsSync(canonical)).toBe(false);
      expect(recordedSlugs(owned)).toEqual([]);
      expect(recordedSlugs(pending)).toEqual([]);
    });

    it("never records a skill directory that existed before the install", async () => {
      const root = makeHome();
      const { owned, pending, legacy } = records(root);
      mocks.declaredSkills = "acme/demo\n";
      const canonical = makeCanonical(root, "demo");
      const output: Array<string> = [];

      await skillsSync(makeCtx(root, false, output));

      expect(mocks.spawnProcess).not.toHaveBeenCalled();
      expect(recordedSlugs(owned)).toEqual([]);
      expect(recordedSlugs(pending)).toEqual([]);
      expect(existsSync(legacy)).toBe(false);
      // One warning tells the user that --prune keeps the directory.
      expect(
        textLines(output).filter((line) => line.includes("demo") && line.includes("--prune")),
      ).toHaveLength(1);

      mocks.declaredSkills = "";
      await skillsSync(makeCtx(root, true));

      expect(readFileSync(join(canonical, "SKILL.md"), "utf8")).toBe("# demo\n");
    });

    it("drops a pending slug whose install failed", async () => {
      const root = makeHome();
      const { owned, pending, legacy } = records(root);
      mocks.declaredSkills = "acme/demo\n";
      // An earlier sync stopped before the install of `acme/old` made its directory.
      mkdirSync(join(root, ".agents", "skills"), { recursive: true });
      writeFileSync(pending, "acme/old\n");
      mocks.spawnProcess.mockResolvedValue({
        error: undefined,
        exitCode: 1,
        stdout: "",
        stderr: "",
      });

      await skillsSync(makeCtx(root, false));

      expect(mocks.spawnProcess).toHaveBeenCalledTimes(1);
      expect(existsSync(join(root, ".agents", "skills", "demo"))).toBe(false);
      expect(recordedSlugs(pending)).toEqual([]);
      expect(recordedSlugs(owned)).toEqual([]);
      expect(existsSync(legacy)).toBe(false);

      installsSucceed(root);
      await skillsSync(makeCtx(root, false));

      expect(recordedSlugs(owned)).toEqual(["acme/demo"]);
      expect(recordedSlugs(pending)).toEqual([]);
    });

    it("keeps a legacy snapshot entry on prune and names it", async () => {
      const root = makeHome();
      const { legacy } = records(root);
      const dropped = makeCanonical(root, "old");
      makeCanonical(root, "stays");
      writeFileSync(legacy, "acme/old\nacme/stays\n");
      mocks.declaredSkills = "acme/stays\n";
      const output: Array<string> = [];

      await skillsSync(makeCtx(root, true, output));

      expect(readFileSync(join(dropped, "SKILL.md"), "utf8")).toBe("# old\n");
      expect(readFileSync(legacy, "utf8")).toBe("acme/old\nacme/stays\n");
      const keepLines = textLines(output)
        .filter((line) => line.includes("keep acme/"))
        .map((line) => line.slice(line.indexOf("keep acme/")));
      expect(keepLines).toEqual([
        "keep acme/old: an older kit recorded it, so the kit cannot prove it installed it; remove it by hand if the kit did",
      ]);
      expect(mocks.spawnProcess).not.toHaveBeenCalled();
    });
  });
});
