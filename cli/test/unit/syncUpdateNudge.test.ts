import type { SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ExecModule from "../../src/engine-native/exec";

const mocks = vi.hoisted(() => ({ spawnHost: vi.fn() }));

vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec");
  return { ...actual, spawnHost: mocks.spawnHost };
});

import { updateNudge } from "../../src/commands/sync";
import { makeLogger } from "../../src/engine-native/logger";

let kitCheckout = "";

function gitResult(stdout: string): SpawnSyncReturns<string> {
  return { pid: 1, output: [], stdout, stderr: "", status: 0, signal: null };
}

beforeEach(() => {
  kitCheckout = mkdtempSync(join(tmpdir(), "docks-kit-nudge-"));
  writeFileSync(join(kitCheckout, "package.json"), '{ "name": "docks-kit" }\n');
  mkdirSync(join(kitCheckout, ".git"));
  vi.stubEnv("DOCKS_KIT_HOME", kitCheckout);
  mocks.spawnHost.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(kitCheckout, { recursive: true, force: true });
});

function runNudge(): string {
  const stderr: Array<string> = [];
  updateNudge(makeLogger({ stderr: (chunk) => stderr.push(chunk), progress: () => {} }));
  return stderr.join("");
}

describe("sync update nudge", () => {
  it("runs git through spawnHost", () => {
    mocks.spawnHost.mockReturnValueOnce(gitResult("")).mockReturnValueOnce(gitResult("0\n"));

    expect(runNudge()).toBe("");

    expect(mocks.spawnHost.mock.calls).toEqual([
      ["git", ["-C", kitCheckout, "fetch", "--quiet"], { stdio: "ignore", timeout: 4000 }],
      [
        "git",
        ["-C", kitCheckout, "rev-list", "--count", "HEAD..@{u}"],
        { stdio: ["ignore", "pipe", "ignore"] },
      ],
    ]);
  });

  it("warns when the kit checkout is behind its upstream", () => {
    mocks.spawnHost.mockReturnValueOnce(gitResult("")).mockReturnValueOnce(gitResult("3\n"));

    expect(runNudge()).toContain(
      "kit checkout is 3 commit(s) behind its upstream — run: docks-kit update",
    );
  });
});
