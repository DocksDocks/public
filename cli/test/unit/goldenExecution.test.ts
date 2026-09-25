import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { checkedSpawnExitCode, runEngine } from "../lib/goldenExecution";
import {
  childHostId,
  cleanupTemporaryDirs,
  makeStubDir,
  readStubHost,
} from "../lib/goldenResources";

describe("checkedSpawnExitCode", () => {
  it("classifies an ETIMEDOUT spawn error before a numeric status", () => {
    const error = Object.assign(new Error("spawnSync bash ETIMEDOUT"), { code: "ETIMEDOUT" });
    expect(() => checkedSpawnExitCode("bash", { status: 130, signal: "SIGTERM", error })).toThrow(
      "bash timed out: Error: spawnSync bash ETIMEDOUT",
    );
  });

  it("reports the killing signal when no status is available", () => {
    expect(() => checkedSpawnExitCode("bash", { status: null, signal: "SIGTERM" })).toThrow(
      "bash terminated by signal SIGTERM",
    );
  });

  it("rejects a result with neither status nor signal", () => {
    expect(() => checkedSpawnExitCode("bash", { status: null, signal: null })).toThrow(
      "bash completed without status or signal",
    );
  });
});

describe("stub host pairing", () => {
  afterAll(() => {
    cleanupTemporaryDirs();
  });

  it("records the native host so a native run pairs on any recording host", () => {
    expect(readStubHost(makeStubDir({}, { nativeHost: true }))).toBe(childHostId(true));
  });

  it("fails before spawning when the planted host is not the host the child runs as", () => {
    // Written, not recorded on a foreign machine: the canonical child is always
    // Linux, so a Windows marker is a mismatch on every runner - including a
    // Linux one, where the native and canonical hosts are the same id.
    const stubs = makeStubDir();
    writeFileSync(join(stubs, ".golden-stub-host"), "windows\n");

    expect(() => runEngine(["--version"], "home-fresh", stubs)).toThrow(
      /stub host mismatch: stubs were planted for windows but this child runs as linux/,
    );
  });
});
