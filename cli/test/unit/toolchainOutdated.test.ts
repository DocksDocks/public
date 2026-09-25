import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Ctx } from "../../src/engine-native";
import { makeEngineServices } from "../../src/engine-native/services";
import { latestUpstream, outdatedReport } from "../../src/engine-native/toolchain";

let home = "";
const NOW = 1_800_000_000_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeCtx(stdout: Array<string>): Ctx {
  return {
    home,
    services: makeEngineServices({
      sinks: { stderr: () => {}, stdout: (chunk) => stdout.push(chunk) },
    }),
  } as Ctx;
}

describe("toolchain outdated", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "docks-outdated-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("picks the newest stable release on the pinned major line", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://registry.npmjs.org/typescript");
      return jsonResponse({
        versions: { "6.0.3": {}, "6.0.10": {}, "7.0.2": {}, "6.1.0-rc": {} },
      });
    });

    const result = await latestUpstream("tsc", { home, refresh: false, now: NOW, fetchImpl });

    expect(result).toEqual({ ok: true, version: "6.0.10" });
  });

  it("strips the GitHub tag prefix", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ tag_name: "bun-v1.4.3" }));

    const result = await latestUpstream("bun", {
      home,
      refresh: false,
      now: NOW,
      fetchImpl,
      env: {},
    });

    expect(result).toEqual({ ok: true, version: "1.4.3" });
  });

  it("reports a failed lookup in the row and still exits 0", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).startsWith("https://api.github.com/")
        ? jsonResponse({ message: "rate limited" }, 403)
        : jsonResponse({ version: "0.0.1", versions: { "6.0.3": {} } }),
    );
    const stdout: Array<string> = [];

    const code = await outdatedReport(makeCtx(stdout), { refresh: false, fetchImpl });

    const output = stdout.join("");
    expect(code).toBe(0);
    expect(output).toMatch(/^omp .*lookup failed: HTTP 403/m);
    expect(output).toMatch(/^bun .*lookup failed: HTTP 403/m);
    expect(output).toContain("Report only: update a verified pin after testing that release");
  });

  it("serves a second lookup inside 24 h from the cache", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "1.7.0" }));

    await latestUpstream("skills-cli", { home, refresh: false, now: NOW, fetchImpl });
    const cached = await latestUpstream("skills-cli", {
      home,
      refresh: false,
      now: NOW + 23 * 3600_000,
      fetchImpl,
    });

    expect(cached).toEqual({ ok: true, version: "1.7.0" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
