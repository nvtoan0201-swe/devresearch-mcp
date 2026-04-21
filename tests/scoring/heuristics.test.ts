import { describe, it, expect } from "vitest";
import {
  velocityScore,
  buzzwordDensity,
  dissentRatio,
  expertEngagement,
  commentDepthScore,
  longevityScore,
  scoreItem,
} from "../../src/scoring/heuristics.js";
import type { NormalizedComment, NormalizedItem, PostDetail } from "../../src/types.js";

function makeItem(partial: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    id: "hn_1",
    platform: "hn",
    url: "https://example.com/",
    title: "t",
    author: "a",
    score: 100,
    ts: "2026-04-20T00:00:00.000Z",
    raw: {},
    ...partial,
  };
}

function makeComment(partial: Partial<NormalizedComment> & { id: string }): NormalizedComment {
  return {
    itemId: "hn_1",
    author: "x",
    text: "",
    score: 1,
    ts: "2026-04-20T01:00:00.000Z",
    depth: 0,
    ...partial,
  };
}

describe("velocityScore", () => {
  it("is higher for fresh high-score posts", () => {
    const now = new Date("2026-04-20T02:00:00Z");
    const fresh = velocityScore(makeItem({ score: 200, ts: "2026-04-20T01:00:00.000Z" }), now);
    const old = velocityScore(makeItem({ score: 200, ts: "2026-04-15T01:00:00.000Z" }), now);
    expect(fresh).toBeGreaterThan(old);
  });
  it("stays within [0,1]", () => {
    const v = velocityScore(makeItem({ score: 99999, ts: "2026-04-20T00:00:00.000Z" }), new Date("2026-04-20T00:10:00Z"));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe("buzzwordDensity", () => {
  it("returns 0 for empty text", () => {
    expect(buzzwordDensity("")).toBe(0);
  });
  it("flags buzzwordy text", () => {
    const d = buzzwordDensity(
      "This revolutionary unprecedented groundbreaking 10x disrupt tool",
    );
    expect(d).toBeGreaterThan(0.3);
  });
  it("ignores plain text", () => {
    const d = buzzwordDensity(
      "A simple library for parsing csv files and writing output",
    );
    expect(d).toBe(0);
  });
});

describe("dissentRatio", () => {
  it("is zero when nothing is critical", () => {
    const comments = [
      makeComment({ id: "c1", text: "Love it" }),
      makeComment({ id: "c2", text: "Nice work" }),
    ];
    expect(dissentRatio(comments)).toBe(0);
  });
  it("counts top-level dissent only", () => {
    const comments = [
      makeComment({ id: "c1", text: "This seems overhyped", depth: 0 }),
      makeComment({ id: "c2", text: "I doubt this works", depth: 0 }),
      makeComment({ id: "c3", text: "Great", depth: 0 }),
      makeComment({ id: "c4", text: "overhyped nested", depth: 1 }),
    ];
    expect(dissentRatio(comments)).toBeCloseTo(2 / 3, 3);
  });
});

describe("expertEngagement", () => {
  it("counts commenters meeting karma threshold", () => {
    const comments = [
      makeComment({ id: "c1", authorKarma: 50000 }),
      makeComment({ id: "c2", authorKarma: 500 }),
      makeComment({ id: "c3" }),
    ];
    expect(expertEngagement(comments, 10000)).toBeCloseTo(1 / 3, 3);
  });
});

describe("commentDepthScore + longevityScore", () => {
  it("depth scales with max depth", () => {
    const shallow = [makeComment({ id: "c1", depth: 1 })];
    const deep = [makeComment({ id: "c1", depth: 5 })];
    expect(commentDepthScore(deep)).toBeGreaterThan(commentDepthScore(shallow));
  });
  it("longevity grows with last-comment recency relative to post age", () => {
    const item = makeItem({ ts: "2026-04-20T00:00:00.000Z" });
    const now = new Date("2026-04-22T00:00:00Z");
    const brief = [makeComment({ id: "c1", ts: "2026-04-20T00:30:00.000Z" })];
    const long = [makeComment({ id: "c1", ts: "2026-04-21T12:00:00.000Z" })];
    expect(longevityScore(item, long, now)).toBeGreaterThan(
      longevityScore(item, brief, now),
    );
  });
});

describe("scoreItem", () => {
  it("returns all fields in [0,1]", () => {
    const detail: PostDetail = {
      item: makeItem(),
      comments: [
        makeComment({ id: "c1", text: "Solid work", depth: 0, authorKarma: 30000 }),
        makeComment({ id: "c2", text: "This is overhyped", depth: 0 }),
        makeComment({ id: "c3", text: "Agree", depth: 1 }),
      ],
    };
    const s = scoreItem(detail, { now: new Date("2026-04-20T03:00:00Z") });
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
