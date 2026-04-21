import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openDb, type Db } from "../../src/storage/db.js";
import { runResearch } from "../../src/llm/research.js";
import { ConfigSchema } from "../../src/config/schema.js";
import type { Fetcher } from "../../src/fetchers/types.js";
import type {
  NormalizedItem,
  Platform,
  PostDetail,
} from "../../src/types.js";
import type { LlmClient } from "../../src/llm/client.js";

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

const VALID_LLM_JSON = JSON.stringify({
  summary: "Bun is moving fast but has rough edges.",
  perspectives: {
    pro_camp: {
      main_points: ["fast runtime", "drop-in node replacement"],
      key_voices: ["jarredsumner"],
      strength: "strong",
    },
    con_camp: {
      main_points: ["prod maturity concerns"],
      key_voices: [],
      strength: "medium",
    },
    disagreement_depth: "technical",
  },
  hype_assessment: {
    signal: "mild_hype",
    reasoning: "High velocity, but expert critique is substantive.",
    red_flags: ["buzzword-heavy marketing"],
    green_flags: ["real benchmarks"],
  },
  misconceptions: [
    {
      wrong_take: "Bun is production-ready everywhere",
      correction: "Edge cases in some ecosystem libs still break",
      source_quote: "I hit issues with native modules...",
    },
  ],
});

describe("runResearch", () => {
  it("searches, scores, calls LLM once, and merges heuristic + synthesis fields", async () => {
    const items = [
      makeItem("hn_1", "hn", 400),
      makeItem("reddit_1", "reddit", 150),
    ];
    const completeSpy = vi.fn(async () => VALID_LLM_JSON);
    const client: LlmClient = { complete: completeSpy };
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async search() {
            return [items[0]];
          },
          async getPost(id) {
            return makeDetail(items[0], ["This is revolutionary", "Skeptical"]);
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
      client,
      fetchers,
      db,
      config,
      now: new Date("2026-04-20T03:00:00Z"),
    });

    expect(completeSpy).toHaveBeenCalledTimes(1);
    const prompt = completeSpy.mock.calls[0][0];
    expect(prompt).toContain("bun runtime");

    expect(res.topic).toBe("bun runtime");
    expect(res.summary).toMatch(/Bun is moving fast/);
    expect(res.discussions.total).toBe(2);
    expect(res.discussions.by_platform.hn).toBe(1);
    expect(res.discussions.by_platform.reddit).toBe(1);
    expect(res.discussions.top_posts).toHaveLength(2);
    expect(res.perspectives.pro_camp.strength).toBe("strong");
    expect(res.hype_assessment.signal).toBe("mild_hype");
    expect(res.hype_assessment.velocity).toBeGreaterThanOrEqual(0);
    expect(res.hype_assessment.velocity).toBeLessThanOrEqual(1);
    expect(res.hype_assessment.expert_engagement).toBeGreaterThanOrEqual(0);
    expect(res.hype_assessment.dissent_ratio).toBeGreaterThanOrEqual(0);
    expect(res.misconceptions).toHaveLength(1);
    expect(res.confidence).toBe("low"); // total=2 → low by rule
  });

  it("returns low confidence with helpful message when no posts found", async () => {
    const completeSpy = vi.fn(async () => VALID_LLM_JSON);
    const client: LlmClient = { complete: completeSpy };
    const fetchers = new Map<Platform, Fetcher>([
      ["hn", stubFetcher("hn")],
    ]);
    const res = await runResearch({
      topic: "nothing here",
      client,
      fetchers,
      db,
      config,
    });
    expect(completeSpy).not.toHaveBeenCalled();
    expect(res.confidence).toBe("low");
    expect(res.summary).toMatch(/No discussions found/);
    expect(res.discussions.total).toBe(0);
  });

  it("tolerates fenced JSON output from the LLM", async () => {
    const items = [makeItem("hn_1", "hn", 400)];
    const fenced = "```json\n" + VALID_LLM_JSON + "\n```";
    const client: LlmClient = { complete: async () => fenced };
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async search() {
            return items;
          },
          async getPost() {
            return makeDetail(items[0], ["c"]);
          },
        }),
      ],
    ]);
    const res = await runResearch({
      topic: "x",
      client,
      fetchers,
      db,
      config,
    });
    expect(res.summary).toMatch(/Bun is moving fast/);
  });

  it("falls back gracefully when LLM returns invalid JSON", async () => {
    const items = [makeItem("hn_1", "hn", 400)];
    const client: LlmClient = { complete: async () => "not json at all" };
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        stubFetcher("hn", {
          async search() {
            return items;
          },
        }),
      ],
    ]);
    const res = await runResearch({
      topic: "x",
      client,
      fetchers,
      db,
      config,
    });
    expect(res.summary).toMatch(/parse failed/);
    expect(res.perspectives.pro_camp.strength).toBe("weak");
    expect(res.hype_assessment.signal).toBe("balanced");
  });

  it("surfaces fetcher errors via the errors field", async () => {
    const completeSpy = vi.fn(async () => VALID_LLM_JSON);
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
      client: { complete: completeSpy },
      fetchers,
      db,
      config,
    });
    expect(res.errors?.hn).toMatch(/network down/);
  });
});
