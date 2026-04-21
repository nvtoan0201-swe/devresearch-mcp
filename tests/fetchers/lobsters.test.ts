import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { createLobstersFetcher } from "../../src/fetchers/lobsters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../fixtures/lobsters/hottest.json"),
    "utf8",
  ),
);

function mockFetchJson(payload: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("lobsters fetcher", () => {
  it("normalizes stories to NormalizedItem[]", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createLobstersFetcher({ http: { fetchFn } });
    const items = await f.search("sqlite", { limit: 20 });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "lobsters_abc123",
      platform: "lobsters",
      title: "SQLite in Node 22 stdlib",
      url: "https://nodejs.org/api/sqlite.html",
      author: "alice",
      score: 87,
    });
  });

  it("falls back to short_id_url when url is empty", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createLobstersFetcher({ http: { fetchFn } });
    const items = await f.search("x", { limit: 20 });
    const selfStory = items.find((i) => i.id === "lobsters_def456");
    expect(selfStory?.url).toBe("https://lobste.rs/s/def456");
  });

  it("hits search.json when query non-empty", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const f = createLobstersFetcher({ http: { fetchFn } });
    await f.search("rust", { limit: 10 });
    const called = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(called).toContain("lobste.rs/search.json");
    expect(called).toContain("q=rust");
  });

  it("hits hottest.json when query empty", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const f = createLobstersFetcher({ http: { fetchFn } });
    await f.search("", { limit: 10 });
    const called = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(called).toContain("lobste.rs/hottest.json");
  });
});
