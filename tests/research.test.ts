import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type Db } from "../src/storage/db.js";
import { runResearch } from "../src/research.js";
import { ConfigSchema } from "../src/config/schema.js";
import type { Fetcher } from "../src/fetchers/types.js";
import type {
  NormalizedItem,
  Platform,
  PostDetail,
} from "../src/types.js";

let tmpDir: string;
let db: Db;
const config = ConfigSchema.parse({});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devresearch-research-"));
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

function stubFetcher(platform: Platform, stubs: Partial<Fetcher> = {}): Fetcher {
  return {
    platform,
    async search() {
      return [];
    },
    ...stubs,
  };
}

function makeItem(id: string, platform: Platform, score: number): NormalizedItem {
  return {
    id,
    platform,
    url: `https://example.com/${id}`,
    title: `Post ${id}`,
    author: "x",
    score,
    ts: "2026-04-20T00:00:00.000Z",
    raw: {},
  };
}

function makeDetail(item: NormalizedItem, commentTexts: string[]): PostDetail {
  return {
    item,
    comments: commentTexts.map((t, i) => ({
      id: `${item.id}_c${i}`,
      itemId: item.id,
      author: "u",
      text: t,
      score: 10 - i,
      ts: "2026-04-20T01:00:00.000Z",
      depth: 0,
    })),
  };
}

describe("runResearch (no-LLM)", () => {
  it("returns structured data with heuristic signals and top comments", async () => {
    const items = [
      makeItem("hn_1", "hn", 400),
      makeItem("reddit_1", "reddit", 150),
    ];
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async search() {
            return [items[0]];
          },
          async getPost() {
            return makeDetail(items[0], ["Revolutionary", "Skeptical take"]);
          },
        }),
      ],
      [
        "reddit",
        stubFetcher("reddit", {
          async search() {
            return [items[1]];
          },
          async getPost() {
            return makeDetail(items[1], ["Works in prod for us"]);
          },
        }),
      ],
    ]);

    const res = await runResearch({
      topic: "bun runtime",
      fetchers,
      db,
      config,
      now: new Date("2026-04-20T03:00:00Z"),
    });

    expect(res.topic).toBe("bun runtime");
    expect(res.discussions.total).toBe(2);
    expect(res.discussions.by_platform.hn).toBe(1);
    expect(res.discussions.by_platform.reddit).toBe(1);
    expect(res.top_posts).toHaveLength(2);
    expect(res.top_posts[0].heuristic_scores.overall).toBeGreaterThanOrEqual(0);
    expect(res.top_posts[0].top_comments.length).toBeGreaterThan(0);
    expect(["strong_hype", "mild_hype", "balanced", "substantive"]).toContain(
      res.aggregate.hype_signal,
    );
    expect(res.confidence).toBe("low"); // total=2 → low
    expect(res.guidance).toBeTruthy();
  });

  it("returns low confidence with empty top_posts when no discussions found", async () => {
    const fetchers = new Map<Platform, Fetcher>([["hn", stubFetcher("hn")]]);
    const res = await runResearch({
      topic: "nothing here",
      fetchers,
      db,
      config,
    });
    expect(res.confidence).toBe("low");
    expect(res.top_posts).toHaveLength(0);
    expect(res.discussions.total).toBe(0);
    expect(res.aggregate.hype_signal).toBe("balanced");
  });

  it("surfaces fetcher errors via errors field", async () => {
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async search() {
            throw new Error("network down");
          },
        }),
      ],
    ]);
    const res = await runResearch({
      topic: "x",
      fetchers,
      db,
      config,
    });
    expect(res.errors?.hn).toMatch(/network down/);
  });

  it("honors depth option — deep takes top 12 instead of top 6", async () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      makeItem(`hn_${i}`, "hn", 100 - i),
    );
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async search() {
            return items;
          },
          async getPost(id) {
            const item = items.find((x) => x.id === id) ?? items[0];
            return makeDetail(item, ["c"]);
          },
        }),
      ],
    ]);

    const normal = await runResearch({
      topic: "x",
      fetchers,
      db,
      config,
    });
    expect(normal.top_posts.length).toBe(6);

    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "devresearch-r2-"));
    const db2 = openDb(path.join(tmpDir2, "cache.db"));
    const deep = await runResearch({
      topic: "x",
      fetchers,
      db: db2,
      config,
      options: { depth: "deep" },
    });
    expect(deep.top_posts.length).toBe(12);
    db2.close();
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });

  it("classifies a hype signal when buzzwords + velocity are high and expert is low", async () => {
    const item = makeItem("hn_1", "hn", 1000);
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async search() {
            return [item];
          },
          async getPost() {
            return {
              item: {
                ...item,
                title:
                  "Revolutionary game-changer 10x disrupt paradigm unprecedented",
              },
              comments: [
                "Revolutionary and game-changing, 10x better, paradigm shift",
                "Groundbreaking and next-gen, truly disrupt the space",
                "Cutting-edge mind-blowing unprecedented",
              ].map((t, i) => ({
                id: `hn_1_c${i}`,
                itemId: "hn_1",
                author: "u",
                text: t,
                score: 5,
                ts: "2026-04-20T01:00:00.000Z",
                depth: 0,
              })),
            };
          },
        }),
      ],
    ]);

    const res = await runResearch({
      topic: "x",
      fetchers,
      db,
      config,
      now: new Date("2026-04-20T01:30:00Z"),
    });
    expect(["strong_hype", "mild_hype"]).toContain(res.aggregate.hype_signal);
  });
});
