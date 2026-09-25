import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, readArgvLog, runEngine, runPublicCli } from "../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir, materializeVariant } from "../lib/goldenResources";
import { stableStringify } from "../lib/goldenSnapshot";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const NATIVE_HOST = { nativeHost: true } as const;

afterAll(cleanupTemporaryDirs);

function claudeInstalledPlugins(): string {
  const settings = JSON.parse(
    readFileSync(join(REPO_DIR, "SoT", ".claude", "settings.json"), "utf8"),
  ) as {
    enabledPlugins: Record<string, boolean>;
  };
  return stableStringify({
    plugins: Object.fromEntries(
      Object.keys(settings.enabledPlugins).map((pluginId) => [
        pluginId,
        [{ scope: "user", version: "test" }],
      ]),
    ),
  });
}

describe("refresh-only plugin skip", () => {
  it("skips warmed refreshes through the public CLI without skipping inventory", () => {
    const variant = materializeVariant("home-drift", {
      ".claude/plugins/installed_plugins.json": claudeInstalledPlugins(),
    });
    const stubs = makeStubDir({}, NATIVE_HOST);
    const run = runPublicCli(
      ["sync", "claude", "codex", "--skip-plugin-refresh"],
      variant,
      stubs,
      NATIVE_HOST,
    );
    try {
      expect(run.exitCode, run.stderr).toBe(0);
      const argv = readFileSync(join(run.home, ".golden-argv.log"), "utf8");
      expect(argv).not.toContain("claude\tplugin marketplace update");
      expect(argv).not.toContain("claude\tplugin update");
      expect(argv).not.toContain("codex\tplugin add");
      expect(argv.match(/^codex\tplugin list --json$/gm)).toEqual(["codex\tplugin list --json"]);
    } finally {
      rmSync(run.home, { recursive: true, force: true });
      rmSync(variant, { recursive: true, force: true });
    }
  });

  it("still installs missing Claude and Codex plugins", () => {
    const codexMissingPlugins = `if (args[0] === "--version") {
  console.log("codex-cli 0.144.4")
} else if (args[0] === "plugin" && args[1] === "list") {
  console.log('{"installed":[{"pluginId":"docks@docks","version":"0.12.5","installed":true,"enabled":true}],"available":[]}')
}`;
    const run = runEngine(
      ["sync", "claude", "codex", "--skip-plugin-refresh"],
      "home-drift",
      makeStubDir({ codex: codexMissingPlugins }, NATIVE_HOST),
      NATIVE_HOST,
    );
    try {
      expect(run.exitCode, run.output).toBe(0);
      expect(run.output).toContain("In a Claude Code session, run /reload-plugins");
      const argv = readArgvLog(run);
      expect(
        argv.match(/^claude\tplugin (?:marketplace update docks|install docks@docks)$/gm),
      ).toEqual(["claude\tplugin marketplace update docks", "claude\tplugin install docks@docks"]);
      expect(
        argv.match(
          /^claude\tplugin (?:marketplace update claude-plugins-official|install php-lsp@claude-plugins-official)$/gm,
        ),
      ).toEqual([
        "claude\tplugin marketplace update claude-plugins-official",
        "claude\tplugin install php-lsp@claude-plugins-official",
      ]);
      expect(argv).not.toContain("claude\tplugin update");
      expect(argv.match(/^codex\tplugin add .+$/gm)).toEqual([
        "codex\tplugin add plan-lifecycle@docks",
      ]);
    } finally {
      cleanup([run]);
    }
  });

  it("installs a user copy when a kit plugin exists only in a project", () => {
    const installed = JSON.parse(claudeInstalledPlugins()) as {
      plugins: Record<string, Array<Record<string, string>>>;
    };
    installed.plugins["docks@docks"] = [
      { scope: "project", projectPath: join(tmpdir(), "docks", "one-project"), version: "test" },
    ];
    const variant = materializeVariant("home-drift", {
      ".claude/plugins/installed_plugins.json": stableStringify(installed),
    });
    const run = runEngine(
      ["sync", "claude", "--skip-plugin-refresh"],
      variant,
      makeStubDir({}, NATIVE_HOST),
      NATIVE_HOST,
    );
    try {
      expect(run.exitCode, run.output).toBe(0);
      expect(run.output).toContain("In a Claude Code session, run /reload-plugins");
      const argv = readArgvLog(run);
      expect(argv.match(/^claude\tplugin install .+$/gm)).toEqual([
        "claude\tplugin install docks@docks",
      ]);
      expect(argv).not.toContain("claude\tplugin update docks@docks --scope user");
    } finally {
      cleanup([run]);
      rmSync(variant, { recursive: true, force: true });
    }
  });
});

describe("kit-scoped plugin refresh", () => {
  it("refreshes only SoT marketplaces and SoT user-scope plugins", () => {
    const installed = JSON.parse(claudeInstalledPlugins()) as {
      plugins: Record<string, Array<Record<string, string>>>;
    };
    const kitPluginIds = Object.keys(installed.plugins).sort();
    installed.plugins["user-plugin@userplace"] = [{ scope: "user", version: "1.0.0" }];
    installed.plugins["n8n-mcp-skills@n8n-mcp-skills"] = [
      {
        scope: "project",
        projectPath: join(tmpdir(), "docks", "projects", "n8n-workflows"),
        version: "test",
      },
    ];
    const variant = materializeVariant("home-drift", {
      ".claude/plugins/installed_plugins.json": stableStringify(installed),
      ".claude/plugins/known_marketplaces.json": stableStringify({
        docks: { source: "DocksDocks/docks" },
        userplace: { source: "user/userplace" },
        "n8n-mcp-skills": { source: "czlonkowski/n8n-skills" },
      }),
    });
    const run = runEngine(["sync", "claude"], variant, makeStubDir({}, NATIVE_HOST), NATIVE_HOST);
    try {
      expect(run.exitCode, run.output).toBe(0);
      const argv = readArgvLog(run);
      expect(argv.match(/^claude\tplugin marketplace update.*$/gm)).toEqual([
        "claude\tplugin marketplace update claude-plugins-official",
        "claude\tplugin marketplace update docks",
      ]);
      expect(argv.match(/^claude\tplugin update .+$/gm)).toEqual(
        kitPluginIds.map((id) => `claude\tplugin update ${id} --scope user`),
      );
      expect(argv.indexOf("claude\tplugin marketplace update docks")).toBeLessThan(
        argv.indexOf("claude\tplugin update docks@docks"),
      );
    } finally {
      cleanup([run]);
      rmSync(variant, { recursive: true, force: true });
    }
  });
});

describe("project-scoped plugin preservation", () => {
  it("keeps marketplaces used by project-scoped plugins during prune", () => {
    const installed = JSON.parse(claudeInstalledPlugins()) as {
      plugins: Record<string, Array<Record<string, string>>>;
    };
    installed.plugins["user-plugin@userplace"] = [{ scope: "user", version: "1.0.0" }];
    installed.plugins["n8n-mcp-skills@n8n-mcp-skills"] = [
      {
        scope: "project",
        projectPath: join(tmpdir(), "docks", "projects", "n8n-workflows"),
        version: "test",
      },
    ];
    const variant = materializeVariant("home-drift", {
      ".claude/plugins/installed_plugins.json": stableStringify(installed),
      ".claude/plugins/known_marketplaces.json": stableStringify({
        "claude-plugins-official": { source: "anthropics/claude-plugins-official" },
        userplace: { source: "user/userplace" },
        "n8n-mcp-skills": { source: "czlonkowski/n8n-skills" },
      }),
    });
    const run = runEngine(
      ["sync", "claude", "--prune"],
      variant,
      makeStubDir({}, NATIVE_HOST),
      NATIVE_HOST,
    );
    try {
      expect(run.exitCode, run.output).toBe(0);
      const argv = readArgvLog(run);
      expect(argv.match(/^claude\tplugin uninstall .+$/gm)).toEqual([
        "claude\tplugin uninstall -y --scope user user-plugin@userplace",
      ]);
      expect(argv.match(/^claude\tplugin marketplace remove .+$/gm)).toEqual([
        "claude\tplugin marketplace remove userplace",
      ]);
    } finally {
      cleanup([run]);
      rmSync(variant, { recursive: true, force: true });
    }
  });
});

describe("first-time optional Claude marketplace", () => {
  it("adds n8n before its marketplace can be refreshed", () => {
    const claude = `const { existsSync, mkdirSync, readFileSync, writeFileSync } = process.getBuiltinModule("node:fs")
const { dirname, join } = process.getBuiltinModule("node:path")
const knownFile = join(process.env["HOME"] ?? "", ".claude", "plugins", "known_marketplaces.json")
const known = existsSync(knownFile) ? JSON.parse(readFileSync(knownFile, "utf8")) : {}
if (args[0] === "--version") {
  console.log("2.1.280 (Claude Code)")
} else if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "add") {
  const name = args[3] === "czlonkowski/n8n-skills" ? "n8n-mcp-skills" : "docks"
  known[name] = { source: args[3] }
  mkdirSync(dirname(knownFile), { recursive: true })
  writeFileSync(knownFile, JSON.stringify(known))
} else if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "update") {
  if (args[3] !== "claude-plugins-official" && !Object.hasOwn(known, args[3])) {
    console.error(\`Marketplace '\${args[3]}' not found\`)
    process.exitCode = 1
  }
}`;
    const stubs = makeStubDir({ claude }, NATIVE_HOST);
    const first = runEngine(
      ["sync", "claude", "--claude-plugin=n8n"],
      "home-fresh",
      stubs,
      NATIVE_HOST,
    );
    try {
      expect(first.exitCode, first.output).toBe(0);
      expect(first.output).not.toContain("--- Failures ---");
      expect(first.output).toContain("Optional plugin opted in: n8n-mcp-skills@n8n-mcp-skills");
      const firstArgv = readArgvLog(first);
      const add = "claude\tplugin marketplace add czlonkowski/n8n-skills";
      const update = "claude\tplugin marketplace update n8n-mcp-skills";
      expect(firstArgv).toContain(add);
      expect(firstArgv).not.toContain(update);
      expect(firstArgv.indexOf(add)).toBeLessThan(
        firstArgv.indexOf("claude\tplugin install n8n-mcp-skills@n8n-mcp-skills"),
      );

      const second = runEngine(["sync", "claude", "--claude-plugin=n8n"], "home-fresh", stubs, {
        ...NATIVE_HOST,
        reuseHome: first.home,
      });
      expect(second.exitCode, second.output).toBe(0);
      expect(second.output).not.toContain("--- Failures ---");
      const secondArgv = readArgvLog(second);
      expect(secondArgv).toContain(update);
      expect(secondArgv).not.toContain(add);
      expect(`${firstArgv}${secondArgv}`.indexOf(add)).toBeLessThan(
        `${firstArgv}${secondArgv}`.indexOf(update),
      );
    } finally {
      cleanup([first]);
    }
  });
});

describe("optional Claude plugin failures", () => {
  it("fails the sync without installing n8n if its marketplace cannot be added", () => {
    const claude = `if (args[0] === "--version") {
  console.log("2.1.204 (Claude Code)")
} else if (args.join(" ") === "plugin marketplace add czlonkowski/n8n-skills") {
  console.error("marketplace unavailable")
  process.exitCode = 17
}`;
    const run = runEngine(
      ["sync", "claude", "--claude-plugin=n8n"],
      "home-fresh",
      makeStubDir({ claude }, NATIVE_HOST),
      NATIVE_HOST,
    );
    try {
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain(
        "Failed to add marketplace czlonkowski/n8n-skills for n8n-mcp-skills@n8n-mcp-skills",
      );
      expect(run.output).toContain("--- Failures ---");
      expect(run.output).not.toContain("Optional plugin opted in: n8n-mcp-skills@n8n-mcp-skills");
      const argv = readArgvLog(run);
      expect(argv).toContain("claude\tplugin marketplace add czlonkowski/n8n-skills");
      expect(argv).not.toContain("claude\tplugin install n8n-mcp-skills@n8n-mcp-skills");
      expect(argv).not.toContain("claude\tplugin enable n8n-mcp-skills@n8n-mcp-skills");
    } finally {
      cleanup([run]);
    }
  });
});
