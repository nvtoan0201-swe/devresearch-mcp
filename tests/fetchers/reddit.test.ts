import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { createRedditFetcher } from "../../src/fetchers/reddit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/reddit/search.json"), "utf8"),
);
const COMMENTS_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/reddit/comments.json"), "utf8"),
);
const USER_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/reddit/user.json"), "utf8"),
);

function mockFetchJson(payload: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("reddit fetcher", () => {
  it("normalizes listing children to NormalizedItem[]", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createRedditFetcher({ http: { fetchFn } }, { subreddits: [] });
    const items = await f.search("bun", { limit: 20 });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "reddit_1a2b3c",
      platform: "reddit",
      title: "Ask HN equivalent: what's your opinion of Bun?",
      author: "dev_jane",
      score: 412,
    });
  });

  it("uses permalink for self posts and external url for link posts", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createRedditFetcher({ http: { fetchFn } }, { subreddits: [] });
    const items = await f.search("bun", { limit: 20 });
    const self = items.find((i) => i.id === "reddit_1a2b3c");
    const link = items.find((i) => i.id === "reddit_9z8y7x");
    expect(self?.url).toBe(
      "https://www.reddit.com/r/javascript/comments/1a2b3c/ask_bun/",
    );
    expect(link?.url).toBe("https://lkml.org/lkml/2026/4/10/42");
  });

  it("converts created_utc seconds to ISO timestamp", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createRedditFetcher({ http: { fetchFn } }, { subreddits: [] });
    const items = await f.search("bun", { limit: 20 });
    expect(items[0].ts).toBe(new Date(1775193600 * 1000).toISOString());
  });

  it("uses /r/<subs>/search.json when subreddits configured", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ kind: "Listing", data: { children: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const f = createRedditFetcher(
      { http: { fetchFn } },
      { subreddits: ["rust", "golang"] },
    );
    await f.search("async", { limit: 5 });
    const calledUrl = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("reddit.com/r/rust+golang/search.json");
    expect(calledUrl).toContain("q=async");
    expect(calledUrl).toContain("restrict_sr=on");
    expect(calledUrl).toContain("limit=5");
  });

  it("uses global /search.json when subreddits empty", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ kind: "Listing", data: { children: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const f = createRedditFetcher({ http: { fetchFn } }, { subreddits: [] });
    await f.search("anything", { limit: 5 });
    const calledUrl = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("reddit.com/search.json");
    expect(calledUrl).not.toContain("restrict_sr");
  });

  it("getPost flattens nested replies with depth + parentId", async () => {
    const fetchFn = mockFetchJson(COMMENTS_FIXTURE);
    const f = createRedditFetcher({ http: { fetchFn } }, { subreddits: [] });
    const detail = await f.getPost!("reddit_abc");
    expect(detail.item.id).toBe("reddit_abc");
    expect(detail.item.title).toBe("Rust 1.80 released");
    expect(detail.comments).toHaveLength(3);
    const alice = detail.comments.find((c) => c.author === "alice");
    const bob = detail.comments.find((c) => c.author === "bob");
    const carol = detail.comments.find((c) => c.author === "carol");
    expect(alice?.depth).toBe(0);
    expect(bob?.depth).toBe(1);
    expect(bob?.parentId).toBe(alice?.id);
    expect(carol?.depth).toBe(0);
  });

  it("getUser normalizes about data", async () => {
    const fetchFn = mockFetchJson(USER_FIXTURE);
    const f = createRedditFetcher({ http: { fetchFn } }, { subreddits: [] });
    const u = await f.getUser!("spez");
    expect(u.username).toBe("spez");
    expect(u.karma).toBe(500000);
    expect(u.about).toBe("CEO, reddit");
  });

  it("trending uses /hot.json", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ kind: "Listing", data: { children: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const f = createRedditFetcher(
      { http: { fetchFn } },
      { subreddits: ["rust"] },
    );
    await f.trending!({ limit: 10 });
    const url = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("reddit.com/r/rust/hot.json");
    expect(url).toContain("limit=10");
  });
});
