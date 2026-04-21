import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type Db } from "../../src/storage/db.js";
import {
  upsertItems,
  readFreshItems,
  upsertClusters,
} from "../../src/storage/cache.js";
import type { NormalizedItem } from "../../src/types.js";

let tmpDir: string;
let db: Db;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devresearch-cache-"));
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

function item(partial: Partial<NormalizedItem> & { id: string }): NormalizedItem {
  return {
    platform: "hn",
    url: "https://example.com/",
    title: "t",
    author: "a",
    score: 1,
    ts: "2026-04-20T00:00:00.000Z",
    raw: { some: "payload" },
    ...partial,
  };
}

describe("upsertItems + readFreshItems", () => {
  it("inserts items and reads them back", () => {
    const items = [
      item({ id: "hn_1", title: "first" }),
      item({ id: "reddit_2", platform: "reddit", title: "second" }),
    ];
    const clusterMap = new Map([
      ["hn_1", "cl_a"],
      ["reddit_2", "cl_b"],
    ]);
    const now = new Date("2026-04-21T00:00:00Z");
    upsertItems(db, items, clusterMap, now);

    const read = readFreshItems(db, {
      ttlHours: 24,
      now: new Date("2026-04-21T00:01:00Z"),
    });
    expect(read).toHaveLength(2);
    const ids = read.map((i) => i.id).sort();
    expect(ids).toEqual(["hn_1", "reddit_2"]);
  });

  it("updates existing items on conflict (upsert)", () => {
    const i1 = item({ id: "hn_1", title: "first", score: 10 });
    const now = new Date("2026-04-21T00:00:00Z");
    upsertItems(db, [i1], new Map([["hn_1", "cl_a"]]), now);
    const i1b = { ...i1, title: "first v2", score: 999 };
    upsertItems(db, [i1b], new Map([["hn_1", "cl_a"]]), now);

    const read = readFreshItems(db, { ttlHours: 24, now });
    expect(read).toHaveLength(1);
    expect(read[0].title).toBe("first v2");
    expect(read[0].score).toBe(999);
  });

  it("excludes items older than ttl", () => {
    const i1 = item({ id: "hn_1" });
    const fetchedAt = new Date("2026-04-20T00:00:00Z");
    upsertItems(db, [i1], new Map([["hn_1", "cl_a"]]), fetchedAt);

    const laterNow = new Date("2026-04-21T01:00:00Z");
    expect(readFreshItems(db, { ttlHours: 24, now: laterNow })).toHaveLength(0);

    const withinNow = new Date("2026-04-20T23:00:00Z");
    expect(readFreshItems(db, { ttlHours: 24, now: withinNow })).toHaveLength(1);
  });

  it("filters by platform when specified", () => {
    const items = [
      item({ id: "hn_1", platform: "hn" }),
      item({ id: "reddit_2", platform: "reddit" }),
    ];
    upsertItems(
      db,
      items,
      new Map([
        ["hn_1", "cl_a"],
        ["reddit_2", "cl_b"],
      ]),
      new Date("2026-04-21T00:00:00Z"),
    );
    const read = readFreshItems(db, {
      ttlHours: 24,
      now: new Date("2026-04-21T00:00:00Z"),
      platforms: ["reddit"],
    });
    expect(read).toHaveLength(1);
    expect(read[0].platform).toBe("reddit");
  });

  it("stores raw_json round-trippable", () => {
    const raw = { nested: { value: 42 }, arr: [1, 2, 3] };
    const i = item({ id: "hn_1", raw });
    upsertItems(
      db,
      [i],
      new Map([["hn_1", "cl_a"]]),
      new Date("2026-04-21T00:00:00Z"),
    );
    const read = readFreshItems(db, {
      ttlHours: 24,
      now: new Date("2026-04-21T00:00:00Z"),
    });
    expect(read[0].raw).toEqual(raw);
  });
});

describe("upsertClusters", () => {
  it("inserts cluster rows", () => {
    upsertClusters(
      db,
      [
        {
          id: "cl_a",
          canonicalUrl: "https://example.com/",
          canonicalTitle: "title",
        },
      ],
      new Date("2026-04-21T00:00:00Z"),
    );
    const rows = db.prepare("SELECT * FROM clusters").all() as Array<{
      id: string;
      canonical_url: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("cl_a");
    expect(rows[0].canonical_url).toBe("https://example.com/");
  });

  it("is idempotent (updates last_updated)", () => {
    upsertClusters(
      db,
      [{ id: "cl_a", canonicalUrl: "u", canonicalTitle: "t" }],
      new Date("2026-04-21T00:00:00Z"),
    );
    upsertClusters(
      db,
      [{ id: "cl_a", canonicalUrl: "u", canonicalTitle: "t2" }],
      new Date("2026-04-22T00:00:00Z"),
    );
    const rows = db.prepare("SELECT * FROM clusters").all() as Array<{
      canonical_title: string;
      last_updated: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].canonical_title).toBe("t2");
    expect(rows[0].last_updated).toBe("2026-04-22T00:00:00.000Z");
  });
});
