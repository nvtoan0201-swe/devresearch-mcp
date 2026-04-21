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
const STORY_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/lobsters/story.json"), "utf8"),
);
const USER_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/lobsters/user.json"), "utf8"),
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

  it("getPost returns item + comments with parent linkage", async () => {
    const fetchFn = mockFetchJson(STORY_FIXTURE);
    const f = createLobstersFetcher({ http: { fetchFn } });
    const detail = await f.getPost!("lobsters_xy");
    expect(detail.item.id).toBe("lobsters_xy");
    expect(detail.item.title).toBe("Zig 0.13 released");
    expect(detail.comments).toHaveLength(2);
    const c1 = detail.comments.find((c) => c.author === "bob");
    const c2 = detail.comments.find((c) => c.author === "carol");
    expect(c1?.depth).toBe(0);
    expect(c2?.depth).toBe(1);
    expect(c2?.parentId).toBe(c1?.id);
  });

  it("getUser returns karma + createdAt", async () => {
    const fetchFn = mockFetchJson(USER_FIXTURE);
    const f = createLobstersFetcher({ http: { fetchFn } });
    const u = await f.getUser!("jcs");
    expect(u.username).toBe("jcs");
    expect(u.karma).toBe(25000);
    expect(u.about).toBe("Founder of Lobsters");
  });

  it("trending hits hottest.json", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createLobstersFetcher({ http: { fetchFn } });
    const items = await f.trending!({ limit: 2 });
    expect(items).toHaveLength(2);
  });
});
