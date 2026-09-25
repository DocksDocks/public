import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Ctx } from "../../src/engine-native";
import { makeEngineServices } from "../../src/engine-native/services";
import { latestUpstream, outdatedReport } from "../../src/engine-native/toolchain";
import { verifiedVersion } from "../lib/toolchainManifest";

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

  it("rejects a GitHub release tag without the manifest prefix", async () => {
    const result = await latestUpstream("bun", {
      home,
      refresh: false,
      now: NOW,
      fetchImpl: async () => jsonResponse({ tag_name: "v1.4.3" }),
      env: {},
    });

    expect(result).toEqual({ ok: false, reason: "unexpected tag v1.4.3" });
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
    const bunRow = output.split("\n").find((line) => line.startsWith("bun "));
    expect(bunRow).toMatch(
      /^bun\s+managed\s+\S+\s+-\s+lookup failed: HTTP 403 github oven-sh\/bun$/,
    );
    expect(bunRow?.trim().split(/\s+/)[2]).toBe(verifiedVersion("bun"));
    expect(output).toMatch(
      /^omp\s+check\s+\S+\s+-\s+lookup failed: HTTP 403 github can1357\/oh-my-pi$/m,
    );
    expect(output).toContain("Report only: update a verified pin after testing that release");
  });

  it("distinguishes a newer release from a release matching the verified pin", async () => {
    const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
      const address = String(url);
      if (address.includes("/repos/oven-sh/bun/")) return jsonResponse({ tag_name: "bun-v1.4.3" });
      if (address.includes("/repos/can1357/oh-my-pi/"))
        return jsonResponse({ tag_name: `v${verifiedVersion("omp")}` });
      if (address === "https://registry.npmjs.org/typescript")
        return jsonResponse({ versions: { "6.0.3": {} } });
      return jsonResponse({ version: "0.0.1" });
    };
    const stdout: Array<string> = [];

    expect(await outdatedReport(makeCtx(stdout), { refresh: false, fetchImpl })).toBe(0);
    const output = stdout.join("");
    expect(output).toMatch(/^bun\s+managed\s+1\.4\.2\s+1\.4\.3\s+newer\s+github oven-sh\/bun$/m);
    const ompPin = verifiedVersion("omp").replaceAll(".", "\\.");
    expect(output).toMatch(
      new RegExp(
        `^omp\\s+check\\s+${ompPin}\\s+${ompPin}\\s+current\\s+github can1357/oh-my-pi$`,
        "m",
      ),
    );
  });

  it("uses cached success within 24 h but refreshes on request", async () => {
    const fetchImpl = vi
      .fn(async () => jsonResponse({ version: "1.7.0" }))
      .mockResolvedValueOnce(jsonResponse({ version: "1.7.0" }))
      .mockResolvedValueOnce(jsonResponse({ version: "1.8.0" }));

    const first = await latestUpstream("skills-cli", { home, refresh: false, now: NOW, fetchImpl });
    const cached = await latestUpstream("skills-cli", {
      home,
      refresh: false,
      now: NOW + 23 * 3600_000,
      fetchImpl,
    });
    expect(first).toEqual({ ok: true, version: "1.7.0" });
    expect(cached).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const refreshed = await latestUpstream("skills-cli", {
      home,
      refresh: true,
      now: NOW + 23 * 3600_000,
      fetchImpl,
    });
    expect(refreshed).toEqual({ ok: true, version: "1.8.0" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a transport failure rather than caching it", async () => {
    const fetchImpl = vi
      .fn(async () => jsonResponse({ version: "1.7.0" }))
      .mockRejectedValueOnce(new Error("network unavailable"));

    const failed = await latestUpstream("skills-cli", {
      home,
      refresh: false,
      now: NOW,
      fetchImpl,
    });
    const recovered = await latestUpstream("skills-cli", {
      home,
      refresh: false,
      now: NOW,
      fetchImpl,
    });

    expect(failed).toEqual({ ok: false, reason: "network unavailable" });
    expect(recovered).toEqual({ ok: true, version: "1.7.0" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
