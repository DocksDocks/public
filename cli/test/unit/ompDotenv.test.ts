import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Ctx } from "../../src/engine-native";
import { DEPENDENCIES } from "../../src/engine-native/deps";
import { mergeDotenv } from "../../src/engine-native/ompDotenv";
import { syncMergedDotenv } from "../../src/engine-native/ompFileDeploy";
import { makeLogger } from "../../src/engine-native/logger";
import { makePlatform, type EngineServices } from "../../src/engine-native/services";
import { kitHome } from "../../src/kitHome";

const SOT = "# why the kit sets it\nPI_DISABLE_UUTILS_BUILTINS=1\n";
const KIT_LINE = "PI_DISABLE_UUTILS_BUILTINS=1";
const posixOnly = process.platform === "win32" ? it.skip : it;

const roots: Array<string> = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function testCtx(
  home: string,
  dryRun: boolean,
  output: Array<string>,
  platform: NodeJS.Platform,
): Ctx {
  const services: EngineServices = {
    logger: makeLogger({
      stderr: (chunk) => output.push(chunk),
      progress: () => {},
      stdout: (chunk) => output.push(chunk),
    }),
    platform: makePlatform(platform),
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: vi.fn(() => ({ state: "missing" as const })),
      version: async () => "",
      versionReading: async () => ({ kind: "version" as const, value: "" }),
      path: async () => "",
      warnMissing: () => {},
    },
  };
  return {
    repoDir: kitHome(),
    home,
    agentsDir: join(home, ".agents"),
    interactive: false,
    dryRun,
    verbose: false,
    skipBubblewrap: false,
    skipPluginRefresh: false,
    reconcile: false,
    prune: false,
    claudeCompactWindow: "",
    claudePermissive: false,
    claudePlugins: [],
    claudeModel: "",
    claudeEffort: "",
    claudeAdvisor: "",
    codexModel: "",
    codexEffort: "",
    syncConcurrency: 3,
    targetFilterSet: true,
    syncClaude: false,
    syncCodex: false,
    syncAgents: false,
    syncOmp: true,
    nextStepTriggers: {
      claudePlugins: false,
      claudeRestart: false,
      codexRestart: false,
      skillsRestart: false,
      ompRestart: false,
    },
    services,
    failures: [],
  };
}

/** Runs the deploy step on `target` with the embedded SoT and returns its messages. */
function sync(target: string, dryRun = false, platform: NodeJS.Platform = "linux"): string {
  const output: Array<string> = [];
  const ctx = testCtx(join(target, ".."), dryRun, output, platform);
  syncMergedDotenv(ctx, "SoT/.omp/agent.env", target);
  return output.join("");
}

function dotenvTarget(content?: string): string {
  const root = mkdtempSync(join(tmpdir(), "omp-dotenv-"));
  roots.push(root);
  const dir = join(root, "agent");
  mkdirSync(dir, { recursive: true });
  const target = join(dir, ".env");
  if (content !== undefined) writeFileSync(target, content);
  return target;
}

describe("omp agent dotenv merge", () => {
  it("keeps user keys, comments, blank lines, and order, and appends a missing kit key", () => {
    const deployed = "# my keys\nOPENAI_API_KEY=sk-test\n\nexport ZED=2 # note\n";

    const merged = mergeDotenv(SOT, deployed);

    expect(merged.text).toBe(`${deployed}${KIT_LINE}\n`);
    expect(merged.changedKeys).toEqual(["PI_DISABLE_UUTILS_BUILTINS"]);
  });

  it("replaces a kit key that has another value in its place", () => {
    const merged = mergeDotenv(SOT, "A=1\nPI_DISABLE_UUTILS_BUILTINS=0\nB=2\n");

    expect(merged.text).toBe(`A=1\n${KIT_LINE}\nB=2\n`);
    expect(merged.changedKeys).toEqual(["PI_DISABLE_UUTILS_BUILTINS"]);
  });

  it("replaces the export form and a form with spaces around the equals sign", () => {
    expect(mergeDotenv(SOT, "export PI_DISABLE_UUTILS_BUILTINS=false\nA=1\n").text).toBe(
      `${KIT_LINE}\nA=1\n`,
    );
    expect(mergeDotenv(SOT, "  PI_DISABLE_UUTILS_BUILTINS = 0\n").text).toBe(`${KIT_LINE}\n`);
  });

  it("adds a line end before the appended key when the file has none", () => {
    expect(mergeDotenv(SOT, "OPENAI_API_KEY=sk-test").text).toBe(
      `OPENAI_API_KEY=sk-test\n${KIT_LINE}\n`,
    );
  });

  it("writes only the kit assignments into an empty file", () => {
    expect(mergeDotenv(SOT, "").text).toBe(`${KIT_LINE}\n`);
  });

  it.each(['"', "'", "`"])(
    "does not match the key inside a multi-line %s value of another key",
    (quote) => {
      const deployed = `CERT=${quote}line one\nPI_DISABLE_UUTILS_BUILTINS=0\nline three${quote}\nB=2\n`;

      const merged = mergeDotenv(SOT, deployed);

      expect(merged.text).toBe(`${deployed}${KIT_LINE}\n`);
    },
  );

  it("still matches the key on the line after an unclosed quote", () => {
    const merged = mergeDotenv(SOT, 'A="open\nPI_DISABLE_UUTILS_BUILTINS=0\n');

    expect(merged.text).toBe(`A="open\n${KIT_LINE}\n`);
  });

  it("changes nothing on a second run", () => {
    const first = mergeDotenv(SOT, "export PI_DISABLE_UUTILS_BUILTINS=0\nOPENAI_API_KEY=sk-test");
    const second = mergeDotenv(SOT, first.text);

    expect(second.text).toBe(first.text);
    expect(second.changedKeys).toEqual([]);
  });

  it("keeps CRLF line ends", () => {
    expect(mergeDotenv(SOT, "A=1\r\nPI_DISABLE_UUTILS_BUILTINS=1\r\n").changedKeys).toEqual([]);
    expect(mergeDotenv(SOT, "A=1\r\n").text).toBe(`A=1\r\n${KIT_LINE}\r\n`);
  });
});

describe("omp agent dotenv deploy", () => {
  posixOnly("creates a new file with mode 0600 and only the kit assignment", () => {
    const target = dotenvTarget();

    const output = sync(target);

    expect(readFileSync(target, "utf8")).toBe(`${KIT_LINE}\n`);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(output).toContain("omp .env installed (keys: PI_DISABLE_UUTILS_BUILTINS)");
  });

  posixOnly("keeps the mode of an existing file", () => {
    const target = dotenvTarget("OPENAI_API_KEY=sk-test\n");
    chmodSync(target, 0o640);

    sync(target);

    expect(readFileSync(target, "utf8")).toBe(`OPENAI_API_KEY=sk-test\n${KIT_LINE}\n`);
    expect(statSync(target).mode & 0o777).toBe(0o640);
  });

  it("never shows a deployed value in its messages", () => {
    const target = dotenvTarget(
      "OPENAI_API_KEY=sk-secret-one\nPI_DISABLE_UUTILS_BUILTINS=sk-secret-two\n",
    );

    const output = sync(target) + sync(target);

    expect(output).toContain("omp .env merged (keys: PI_DISABLE_UUTILS_BUILTINS)");
    expect(output).not.toContain("sk-secret");
    expect(readFileSync(target, "utf8")).toBe(`OPENAI_API_KEY=sk-secret-one\n${KIT_LINE}\n`);
    expect(existsSync(`${target}.bak`)).toBe(false);
  });

  it("reports already in sync on a second run and leaves the file as it is", () => {
    const target = dotenvTarget("# mine\nOPENAI_API_KEY=sk-test");
    sync(target);
    const after = readFileSync(target, "utf8");

    const output = sync(target);

    expect(output).toContain("omp .env already in sync");
    expect(readFileSync(target, "utf8")).toBe(after);
  });

  it("writes nothing in a dry run", () => {
    const existing = dotenvTarget("OPENAI_API_KEY=sk-test\n");
    const missing = dotenvTarget();

    const output = sync(existing, true) + sync(missing, true);

    expect(readFileSync(existing, "utf8")).toBe("OPENAI_API_KEY=sk-test\n");
    expect(existsSync(missing)).toBe(false);
    expect(output).toContain(
      `[dry-run] merge embedded:SoT/.omp/agent.env -> ${missing} (keys: PI_DISABLE_UUTILS_BUILTINS)`,
    );
    expect(output).not.toContain("sk-test");
  });

  it("leaves the agent .env untouched on Windows", () => {
    const existing = dotenvTarget("OPENAI_API_KEY=sk-test\nPI_DISABLE_UUTILS_BUILTINS=0\n");
    const missing = dotenvTarget();

    const output = sync(existing, false, "win32") + sync(missing, false, "win32");

    expect(readFileSync(existing, "utf8")).toBe(
      "OPENAI_API_KEY=sk-test\nPI_DISABLE_UUTILS_BUILTINS=0\n",
    );
    expect(existsSync(missing)).toBe(false);
    expect(output).toContain("omp .env skipped on Windows (POSIX lock issue only)");
    expect(output).not.toContain("sk-test");
  });
});
