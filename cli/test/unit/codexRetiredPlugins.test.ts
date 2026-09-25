import { afterAll, describe, expect, it } from "vitest";
import { removeRetiredPluginTablesText } from "../../src/engine-native/codexSync";
import { cleanup, readArgvLog, runEngine } from "../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir } from "../lib/goldenResources";

afterAll(cleanupTemporaryDirs);

describe("removeRetiredPluginTablesText", () => {
  it("removes retired effect-kit while keeping neighboring enabled plugins", () => {
    const input = `[plugins."docks@docks"]
enabled = true

[plugins."effect-kit@docks"]
enabled = true

[plugins."plan-lifecycle@docks"]
enabled = true
`;

    expect(removeRetiredPluginTablesText(input)).toBe(`[plugins."docks@docks"]
enabled = true

[plugins."plan-lifecycle@docks"]
enabled = true
`);
  });

  it("removes a retired final table without changing the preceding content", () => {
    const input = `model = "user-choice"

[agents]
max_threads = 4

[plugins."session-relay@docks"]
enabled = true
`;

    expect(removeRetiredPluginTablesText(input)).toBe(`model = "user-choice"

[agents]
max_threads = 4

`);
  });

  it("preserves a user table following a retired disabled plugin", () => {
    const input = `model = "user-choice"

[plugins."session-relay@docks"]
enabled = false
[custom]
keep = true
`;

    expect(removeRetiredPluginTablesText(input)).toBe(`model = "user-choice"

[custom]
keep = true
`);
  });

  it("leaves a config without retired plugin tables byte-identical", () => {
    const config =
      '# personal\nmodel = "user-choice"\n\n[plugins."custom@local"]\nenabled = true # user choice\n';

    expect(removeRetiredPluginTablesText(config)).toBe(config);
  });
});

describe("Codex plugin inventory fallback", () => {
  it("refreshes enabled plugins when the CLI returns unusable inventory", () => {
    const badInventory = `if (args[0] === "--version") {
  console.log("codex-cli 0.144.4")
} else if (args[0] === "plugin" && args[1] === "list") {
  console.log('{"installed":"unavailable"}')
}`;
    const nativeHost = { nativeHost: true } as const;
    const run = runEngine(
      ["sync", "codex", "--skip-plugin-refresh"],
      "home-fresh",
      makeStubDir({ codex: badInventory }, nativeHost),
      nativeHost,
    );

    try {
      expect(run.exitCode, run.output).toBe(0);
      expect(run.output).toContain(
        "Codex plugin inventory unavailable — falling back to the full refresh path",
      );
      expect(readArgvLog(run).match(/^codex\tplugin (list --json|add .+)$/gm)).toEqual([
        "codex\tplugin list --json",
        "codex\tplugin add docks@docks",
        "codex\tplugin add plan-lifecycle@docks",
      ]);
    } finally {
      cleanup([run]);
    }
  });
});
