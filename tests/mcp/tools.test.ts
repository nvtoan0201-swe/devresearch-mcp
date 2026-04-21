import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type Db } from "../../src/storage/db.js";
import { listTools, callTool } from "../../src/mcp/tools.js";
import type { Fetcher } from "../../src/fetchers/types.js";
import type {
  NormalizedItem,
  PostDetail,
  Platform,
  UserSummary,
} from "../../src/types.js";
import { ConfigSchema } from "../../src/config/schema.js";

let tmpDir: string;
let db: Db;
const config = ConfigSchema.parse({});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devresearch-tools-"));
  db = openDb(path.join(tmpDir, "cache.db"));
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function stubFetcher(
  platform: Platform,
  stubs: Partial<Fetcher> = {},
): Fetcher {
  return {
    platform,
    async search() {
      return [];
    },
    ...stubs,
  };
}

function parse(result: { content: Array<{ type: "text"; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

describe("listTools", () => {
  it("advertises 5 tools with schemas", () => {
    const tools = listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_post",
      "get_user",
      "research",
      "search",
      "trending",
    ]);
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
    }
  });
});

describe("callTool search", () => {
  it("fans out across fetchers and clusters results", async () => {
    const item: NormalizedItem = {
      id: "hn_1",
      platform: "hn",
      url: "https://bun.sh/blog/1-2",
      title: "Bun 1.2 is out",
      author: "u",
      score: 100,
      ts: "2026-04-20T00:00:00Z",
      raw: {},
    };
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async search() {
            return [item];
          },
        }),
      ],
    ]);
    const res = await callTool("search", { query: "bun", limit: 10 }, {
      fetchers,
      db,
      config,
    });
    expect(res.isError).toBeUndefined();
    const data = parse(res) as { count: number; clusterCount: number };
    expect(data.count).toBe(1);
    expect(data.clusterCount).toBe(1);
  });

  it("rejects empty query via zod", async () => {
    const res = await callTool("search", { query: "" }, {
      fetchers: new Map(),
      db,
      config,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Invalid args/);
  });
});

describe("callTool get_post", () => {
  it("returns detail + heuristic scores", async () => {
    const detail: PostDetail = {
      item: {
        id: "hn_42",
        platform: "hn",
        url: "https://example.com/x",
        title: "Something",
        author: "a",
        score: 50,
        ts: "2026-04-20T00:00:00Z",
        raw: {},
      },
      comments: [
        {
          id: "hn_43",
          itemId: "hn_42",
          author: "x",
          text: "nice",
          score: 5,
          ts: "2026-04-20T01:00:00Z",
          depth: 0,
        },
      ],
    };
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async getPost() {
            return detail;
          },
        }),
      ],
    ]);
    const res = await callTool(
      "get_post",
      { platform: "hn", id: "hn_42" },
      { fetchers, db, config, now: () => new Date("2026-04-20T03:00:00Z") },
    );
    expect(res.isError).toBeUndefined();
    const data = parse(res) as { scores: { overall: number }; commentCount: number };
    expect(data.commentCount).toBe(1);
    expect(data.scores.overall).toBeGreaterThanOrEqual(0);
    expect(data.scores.overall).toBeLessThanOrEqual(1);
  });

  it("errors when platform has no getPost", async () => {
    const fetchers = new Map<Platform, Fetcher>([["hn", stubFetcher("hn")]]);
    const res = await callTool(
      "get_post",
      { platform: "hn", id: "hn_1" },
      { fetchers, db, config },
    );
    expect(res.isError).toBe(true);
  });
});

describe("callTool get_user", () => {
  it("returns user summary", async () => {
    const summary: UserSummary = {
      platform: "hn",
      username: "pg",
      karma: 150000,
    };
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async getUser() {
            return summary;
          },
        }),
      ],
    ]);
    const res = await callTool(
      "get_user",
      { platform: "hn", username: "pg" },
      { fetchers, db, config },
    );
    expect(res.isError).toBeUndefined();
    const data = parse(res) as UserSummary;
    expect(data.username).toBe("pg");
    expect(data.karma).toBe(150000);
  });
});

describe("callTool trending", () => {
  it("fans out across fetchers when platform omitted", async () => {
    const itemA: NormalizedItem = {
      id: "hn_t1",
      platform: "hn",
      url: "https://a",
      title: "A",
      author: "x",
      score: 10,
      ts: "2026-04-20T00:00:00Z",
      raw: {},
    };
    const itemB: NormalizedItem = {
      id: "reddit_t1",
      platform: "reddit",
      url: "https://b",
      title: "B",
      author: "y",
      score: 20,
      ts: "2026-04-20T00:00:00Z",
      raw: {},
    };
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async trending() {
            return [itemA];
          },
        }),
      ],
      [
        "reddit",
        stubFetcher("reddit", {
          async trending() {
            return [itemB];
          },
        }),
      ],
    ]);
    const res = await callTool(
      "trending",
      { limit: 5 },
      { fetchers, db, config },
    );
    const data = parse(res) as { count: number };
    expect(data.count).toBe(2);
  });

  it("returns error for unknown tool name", async () => {
    const res = await callTool(
      "does_not_exist",
      {},
      { fetchers: new Map(), db, config },
    );
    expect(res.isError).toBe(true);
  });
});

describe("callTool research", () => {
  it("rejects empty topic via zod", async () => {
    const res = await callTool(
      "research",
      { topic: "" },
      { fetchers: new Map(), db, config },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Invalid args/);
  });

  it("returns structured data with heuristic signals (no LLM required)", async () => {
    const item: NormalizedItem = {
      id: "hn_1",
      platform: "hn",
      url: "https://bun.sh/blog/1-2",
      title: "Bun 1.2",
      author: "j",
      score: 300,
      ts: "2026-04-20T00:00:00Z",
      raw: {},
    };
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async search() {
            return [item];
          },
          async getPost() {
            return {
              item,
              comments: [
                {
                  id: "hn_c1",
                  itemId: "hn_1",
                  author: "u",
                  text: "Works great in prod",
                  score: 20,
                  ts: "2026-04-20T01:00:00Z",
                  depth: 0,
                },
              ],
            };
          },
        }),
      ],
    ]);
    const res = await callTool(
      "research",
      { topic: "bun" },
      {
        fetchers,
        db,
        config,
        now: () => new Date("2026-04-20T03:00:00Z"),
      },
    );
    expect(res.isError).toBeUndefined();
    const data = parse(res) as {
      topic: string;
      confidence: string;
      top_posts: Array<{ heuristic_scores: { overall: number } }>;
      aggregate: { hype_signal: string };
      guidance: string;
    };
    expect(data.topic).toBe("bun");
    expect(data.top_posts.length).toBeGreaterThan(0);
    expect(data.top_posts[0].heuristic_scores.overall).toBeGreaterThanOrEqual(0);
    expect([
      "strong_hype",
      "mild_hype",
      "balanced",
      "substantive",
    ]).toContain(data.aggregate.hype_signal);
    expect(data.guidance).toBeTruthy();
  });
});
