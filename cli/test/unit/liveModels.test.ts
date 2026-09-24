import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeHarnessSelection } from "../../src/engine-native/harnesses";
import {
  curatedCatalog,
  resolveCatalog,
  type LiveCatalogInputs,
} from "../../src/engine-native/liveModels";

const NOW = Date.parse("2026-09-24T12:00:00.000Z");
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "docks-live-models-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function inputs(overrides: Partial<Omit<LiveCatalogInputs, "home">> = {}): LiveCatalogInputs {
  return {
    home,
    refresh: false,
    fetch: async () => {
      throw new Error("Unexpected network request");
    },
    which: () => "",
    capture: async () => {
      throw new Error("Unexpected command capture");
    },
    now: () => NOW,
    ...overrides,
  };
}

function writeCredentials(expiresAt: number): void {
  mkdirSync(join(home, ".claude"));
  writeFileSync(
    join(home, ".claude", ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "test-token", expiresAt } }),
  );
}

describe("live model catalogs", () => {
  it("paginates the Anthropic API and merges live IDs after curated aliases", async () => {
    writeHarnessSelection(home, ["claude"]);
    writeCredentials(NOW + 3600_000);
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return Response.json(
        requests.length === 1
          ? {
              data: [{ id: "claude-opus-5-5", display_name: "Live Opus" }],
              has_more: true,
              last_id: "claude-opus-5-5",
            }
          : {
              data: [{ id: "claude-new-1", display_name: "New from API" }],
              has_more: false,
              last_id: "claude-new-1",
            },
      );
    });

    const result = await resolveCatalog("claude", inputs({ fetch }));
    const curated = curatedCatalog("claude");
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.anthropic.com/v1/models?limit=1000",
      "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-opus-5-5",
    ]);
    expect(requests[0]?.init?.headers).toEqual({
      Authorization: "Bearer test-token",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
    });
    expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      tool: "claude",
      source: "anthropic-api",
      verified: curated.verified,
      fetchedAt: new Date(NOW).toISOString(),
      models: [
        ...curated.models.filter((model) => model.kind === "alias"),
        {
          id: "claude-opus-5-5",
          kind: "id",
          note: curated.models.find((model) => model.id === "claude-opus-5-5")?.note,
        },
        { id: "claude-new-1", kind: "id", note: "New from API" },
      ],
    });
  });

  it("reuses the Claude cache inside six hours and bypasses it on refresh", async () => {
    writeHarnessSelection(home, ["claude"]);
    writeCredentials(NOW + 6 * 3600_000);
    let now = NOW;
    const fetch = vi.fn(async () =>
      Response.json({
        data: [{ id: "claude-cache-1", display_name: "Fresh model" }],
        has_more: false,
      }),
    );
    const first = await resolveCatalog("claude", inputs({ fetch, now: () => now }));
    expect(fetch).toHaveBeenCalledTimes(1);

    fetch.mockClear();
    now += 3600_000;
    const cached = await resolveCatalog("claude", inputs({ fetch, now: () => now }));
    expect(fetch).not.toHaveBeenCalled();
    expect(cached.source).toBe("anthropic-api");
    expect(cached.fetchedAt).toBe(first.fetchedAt);
    expect(cached.models).toEqual(first.models);

    const refreshed = await resolveCatalog(
      "claude",
      inputs({ fetch, now: () => now, refresh: true }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(refreshed.fetchedAt).toBe(new Date(now).toISOString());
    expect(refreshed.models).toContainEqual({
      id: "claude-cache-1",
      kind: "id",
      note: "Fresh model",
    });
  });

  it("uses curated models without fetching when the Claude Code login has expired", async () => {
    writeHarnessSelection(home, ["claude"]);
    writeCredentials(NOW);
    const fetch = vi.fn(async () => {
      throw new Error("Expired credentials must not fetch");
    });

    expect(await resolveCatalog("claude", inputs({ fetch }))).toEqual({
      ...curatedCatalog("claude"),
      fallbackReason: "Claude Code login expired; start claude once to refresh it",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back without caching when the Anthropic API returns no models", async () => {
    writeHarnessSelection(home, ["claude"]);
    writeCredentials(NOW + 3600_000);
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 }),
    );

    const first = await resolveCatalog("claude", inputs({ fetch }));
    await resolveCatalog("claude", inputs({ fetch }));

    expect(first).toEqual({
      ...curatedCatalog("claude"),
      fallbackReason: "Anthropic API returned no models",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("ignores hidden Codex cache models and keeps curated notes on matching IDs", async () => {
    writeHarnessSelection(home, ["codex"]);
    mkdirSync(join(home, ".codex"));
    writeFileSync(
      join(home, ".codex", "models_cache.json"),
      JSON.stringify({
        fetched_at: "2026-09-24T10:00:00.000Z",
        models: [
          { slug: "gpt-6-sol", display_name: "Live name", visibility: "list" },
          { slug: "gpt-reserve", display_name: "Not public", visibility: "hide" },
          { slug: "gpt-new", display_name: "New public model", visibility: "list" },
        ],
      }),
    );

    const result = await resolveCatalog("codex", inputs());
    expect(result).toEqual({
      tool: "codex",
      source: "codex-cache",
      verified: curatedCatalog("codex").verified,
      fetchedAt: "2026-09-24T10:00:00.000Z",
      models: [
        {
          id: "gpt-6-sol",
          kind: "id",
          note: curatedCatalog("codex").models.find((model) => model.id === "gpt-6-sol")?.note,
        },
        { id: "gpt-new", kind: "id", note: "New public model" },
      ],
    });
  });

  it("falls back to the curated list when the Codex cache lists no public models", async () => {
    writeHarnessSelection(home, ["codex"]);
    mkdirSync(join(home, ".codex"));
    writeFileSync(
      join(home, ".codex", "models_cache.json"),
      JSON.stringify({
        fetched_at: "2026-09-24T10:00:00.000Z",
        models: [{ slug: "gpt-reserve", display_name: "Not public", visibility: "hide" }],
      }),
    );

    expect(await resolveCatalog("codex", inputs())).toEqual({
      ...curatedCatalog("codex"),
      fallbackReason: "Codex model cache lists no models",
    });
  });

  it("does not look up Claude when the selected harness is only Codex", async () => {
    writeHarnessSelection(home, ["codex"]);

    expect(await resolveCatalog("claude", inputs())).toEqual({
      ...curatedCatalog("claude"),
      fallbackReason: "claude harness not enabled (docks-kit harnesses)",
    });
  });

  it("uses an empty curated catalog when omp is missing", async () => {
    writeHarnessSelection(home, ["omp"]);
    const capture = vi.fn(async () => {
      throw new Error("Missing omp must not be captured");
    });

    expect(await resolveCatalog("omp", inputs({ capture }))).toEqual({
      tool: "omp",
      source: "curated",
      verified: "?",
      models: [],
      fallbackReason: "omp not found on PATH",
    });
    expect(capture).not.toHaveBeenCalled();
  });
});
