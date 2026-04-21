import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { createHnFetcher } from "../../src/fetchers/hn.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/hn/algolia.json"), "utf8"),
);
const ITEM_TREE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/hn/item_tree.json"), "utf8"),
);
const USER_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/hn/user.json"), "utf8"),
);

function mockFetchJson(payload: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("hn fetcher", () => {
  it("normalizes Algolia hits to NormalizedItem[]", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createHnFetcher({ http: { fetchFn } });
    const items = await f.search("bun", { limit: 10 });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "hn_40123456",
      platform: "hn",
      title: "Bun 1.2 is out",
      url: "https://bun.sh/blog/bun-1.2",
      author: "dang",
      score: 892,
    });
    expect(items[0].ts).toBe("2026-04-10T15:00:00.000Z");
  });

  it("falls back to HN URL when hit has no external url", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createHnFetcher({ http: { fetchFn } });
    const items = await f.search("show", { limit: 10 });
    const showhn = items.find((i) => i.id === "hn_40123999");
    expect(showhn?.url).toBe("https://news.ycombinator.com/item?id=40123999");
  });

  it("builds correct search URL with query + limit + window", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ hits: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const now = new Date("2026-04-21T00:00:00Z");
    const f = createHnFetcher({
      http: { fetchFn },
      now: () => now,
    });
    await f.search("rust", { limit: 5, windowDays: 10 });
    const calledUrl = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("hn.algolia.com/api/v1/search");
    expect(calledUrl).toContain("query=rust");
    expect(calledUrl).toContain("tags=story");
    expect(calledUrl).toContain("hitsPerPage=5");
    expect(calledUrl).toContain("numericFilters=created_at_i%3E%3D1775865600");
  });

  it("getPost flattens comment tree with depth + parentId", async () => {
    const fetchFn = mockFetchJson(ITEM_TREE);
    const f = createHnFetcher({ http: { fetchFn } });
    const detail = await f.getPost!("hn_111");
    expect(detail.item.id).toBe("hn_111");
    expect(detail.item.title).toBe("Bun 1.2 released");
    expect(detail.comments).toHaveLength(3);
    const alice = detail.comments.find((c) => c.author === "alice");
    const bob = detail.comments.find((c) => c.author === "bob");
    expect(alice?.depth).toBe(0);
    expect(bob?.depth).toBe(1);
    expect(bob?.parentId).toBe(alice?.id);
    expect(alice?.text).toContain("great");
    expect(alice?.text).not.toContain("<b>");
  });

  it("getUser returns karma and about", async () => {
    const fetchFn = mockFetchJson(USER_FIXTURE);
    const f = createHnFetcher({ http: { fetchFn } });
    const u = await f.getUser!("pg");
    expect(u.platform).toBe("hn");
    expect(u.username).toBe("pg");
    expect(u.karma).toBe(155000);
    expect(u.about).toBe("Co-founder of Y Combinator.");
  });

  it("trending calls front_page tag", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ hits: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const f = createHnFetcher({ http: { fetchFn } });
    await f.trending!({ limit: 5 });
    const url = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("tags=front_page");
  });
});
