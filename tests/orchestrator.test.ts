import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type Db } from "../src/storage/db.js";
import { searchAll } from "../src/orchestrator.js";
import type { Fetcher } from "../src/fetchers/types.js";
import type { NormalizedItem, Platform } from "../src/types.js";

let tmpDir: string;
let db: Db;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devresearch-orch-"));
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

function fakeFetcher(
  platform: Platform,
  items: NormalizedItem[],
): Fetcher {
  return {
    platform,
    async search() {
      return items;
    },
  };
}

describe("searchAll", () => {
  it("fans out across fetchers and returns all items", async () => {
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        fakeFetcher("hn", [
          {
            id: "hn_1",
            platform: "hn",
            url: "https://a.com/x",
            title: "A",
            author: "u",
            score: 1,
            ts: "2026-04-20T00:00:00Z",
            raw: {},
          },
        ]),
      ],
      [
        "reddit",
        fakeFetcher("reddit", [
          {
            id: "reddit_2",
            platform: "reddit",
            url: "https://b.com/y",
            title: "B",
            author: "v",
            score: 2,
            ts: "2026-04-20T01:00:00Z",
            raw: {},
          },
        ]),
      ],
    ]);
    const out = await searchAll({
      query: "q",
      fetchers,
      db,
      options: { limit: 10 },
      now: new Date("2026-04-21T00:00:00Z"),
    });
    expect(out.items).toHaveLength(2);
    expect(out.clusters.size).toBe(2);
  });

  it("persists items and clusters to cache", async () => {
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        fakeFetcher("hn", [
          {
            id: "hn_1",
            platform: "hn",
            url: "https://a.com/x",
            title: "A",
            author: "u",
            score: 1,
            ts: "2026-04-20T00:00:00Z",
            raw: {},
          },
        ]),
      ],
    ]);
    await searchAll({
      query: "q",
      fetchers,
      db,
      options: { limit: 10 },
      now: new Date("2026-04-21T00:00:00Z"),
    });
    const itemRow = db
      .prepare("SELECT id, cluster_id FROM items WHERE id = ?")
      .get("hn_1") as { id: string; cluster_id: string } | undefined;
    expect(itemRow?.cluster_id).toMatch(/^cl_/);
    const clusterRow = db
      .prepare("SELECT id FROM clusters WHERE id = ?")
      .get(itemRow!.cluster_id) as { id: string } | undefined;
    expect(clusterRow?.id).toBe(itemRow!.cluster_id);
  });

  it("deduplicates cross-platform items with same URL into one cluster", async () => {
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        fakeFetcher("hn", [
          {
            id: "hn_1",
            platform: "hn",
            url: "https://bun.sh/blog/1-2?utm_source=hn",
            title: "Bun 1.2 is out",
            author: "u",
            score: 800,
            ts: "2026-04-20T00:00:00Z",
            raw: {},
          },
        ]),
      ],
      [
        "reddit",
        fakeFetcher("reddit", [
          {
            id: "reddit_2",
            platform: "reddit",
            url: "https://bun.sh/blog/1-2/",
            title: "Bun 1.2: released today",
            author: "v",
            score: 400,
            ts: "2026-04-20T01:00:00Z",
            raw: {},
          },
        ]),
      ],
    ]);
    const out = await searchAll({
      query: "bun",
      fetchers,
      db,
      options: { limit: 10 },
      now: new Date("2026-04-21T00:00:00Z"),
    });
    expect(out.clusters.get("hn_1")).toBe(out.clusters.get("reddit_2"));
  });

  it("continues on fetcher failure and reports in errors", async () => {
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        fakeFetcher("hn", [
          {
            id: "hn_1",
            platform: "hn",
            url: "https://a.com/x",
            title: "A",
            author: "u",
            score: 1,
            ts: "2026-04-20T00:00:00Z",
            raw: {},
          },
        ]),
      ],
      [
        "reddit",
        {
          platform: "reddit",
          async search() {
            throw new Error("reddit down");
          },
        },
      ],
    ]);
    const out = await searchAll({
      query: "q",
      fetchers,
      db,
      options: { limit: 10 },
      now: new Date("2026-04-21T00:00:00Z"),
    });
    expect(out.items).toHaveLength(1);
    expect(out.errors.reddit?.message).toMatch(/reddit down/);
    expect(out.errors.reddit?.code).toBe("UNKNOWN");
    expect(out.errors.reddit?.degraded).toBe(true);
    expect(out.errors.reddit?.suggestion).toMatch(/hn/);
  });
});
