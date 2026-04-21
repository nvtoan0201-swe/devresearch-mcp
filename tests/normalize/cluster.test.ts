import { describe, it, expect } from "vitest";
import { clusterItems, normalizeUrl } from "../../src/normalize/cluster.js";
import type { NormalizedItem } from "../../src/types.js";

function item(partial: Partial<NormalizedItem>): NormalizedItem {
  return {
    id: "x",
    platform: "hn",
    url: "",
    title: "",
    author: "",
    score: 0,
    ts: "2026-04-20T00:00:00.000Z",
    raw: null,
    ...partial,
  };
}

describe("normalizeUrl", () => {
  it("strips fragment and utm_ params", () => {
    expect(
      normalizeUrl("https://Bun.sh/blog/1-2?utm_source=x&a=1#section"),
    ).toBe("https://bun.sh/blog/1-2?a=1");
  });

  it("strips trailing slash on path", () => {
    expect(normalizeUrl("https://bun.sh/blog/1-2/")).toBe(
      "https://bun.sh/blog/1-2",
    );
  });

  it("keeps non-utm query params sorted", () => {
    expect(normalizeUrl("https://x.test/?b=2&a=1")).toBe(
      "https://x.test/?a=1&b=2",
    );
  });

  it("returns input unchanged when not parseable", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("clusterItems", () => {
  it("groups items sharing normalized URL", () => {
    const items = [
      item({
        id: "hn_1",
        url: "https://bun.sh/blog/1-2?utm_campaign=x",
        title: "Bun 1.2 released",
      }),
      item({
        id: "reddit_2",
        platform: "reddit",
        url: "https://bun.sh/blog/1-2/",
        title: "Bun 1.2: new features",
      }),
      item({
        id: "lobsters_3",
        platform: "lobsters",
        url: "https://github.com/oven-sh/bun",
        title: "Unrelated project page",
      }),
    ];
    const map = clusterItems(items);
    expect(map.get("hn_1")).toBe(map.get("reddit_2"));
    expect(map.get("hn_1")).not.toBe(map.get("lobsters_3"));
  });

  it("groups items with highly similar titles even with different URLs", () => {
    const items = [
      item({
        id: "hn_1",
        url: "https://example.com/a",
        title: "Bun 1.2 is out today with new features",
      }),
      item({
        id: "reddit_2",
        url: "https://othersite.com/different",
        title: "Bun 1.2 is out today with new features",
      }),
    ];
    const map = clusterItems(items, { titleThreshold: 0.5 });
    expect(map.get("hn_1")).toBe(map.get("reddit_2"));
  });

  it("keeps unrelated items in separate clusters", () => {
    const items = [
      item({ id: "hn_1", url: "https://a.com/x", title: "Bun 1.2 released" }),
      item({
        id: "reddit_2",
        url: "https://b.com/y",
        title: "Rust async runtime internals",
      }),
    ];
    const map = clusterItems(items);
    expect(map.get("hn_1")).not.toBe(map.get("reddit_2"));
  });

  it("returns a cluster id for every input item", () => {
    const items = [
      item({ id: "hn_1", url: "https://a.com/x", title: "A" }),
      item({ id: "hn_2", url: "https://b.com/y", title: "B" }),
    ];
    const map = clusterItems(items);
    expect(map.size).toBe(2);
    expect(map.get("hn_1")).toBeDefined();
    expect(map.get("hn_2")).toBeDefined();
  });

  it("cluster id is stable and derived from canonical url", () => {
    const items = [
      item({ id: "hn_1", url: "https://bun.sh/blog/1-2?utm_x=1", title: "t" }),
      item({ id: "reddit_2", url: "https://bun.sh/blog/1-2/", title: "t" }),
    ];
    const map = clusterItems(items);
    const cid = map.get("hn_1");
    expect(cid).toMatch(/^cl_/);
    expect(cid).toBe(map.get("reddit_2"));
  });
});
