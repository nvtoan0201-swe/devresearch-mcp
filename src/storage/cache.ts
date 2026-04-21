import type { Db } from "./db.js";
import type { NormalizedItem, Platform } from "../types.js";

export interface ClusterRow {
  id: string;
  canonicalUrl: string;
  canonicalTitle: string;
}

export interface ReadOptions {
  ttlHours: number;
  now: Date;
  platforms?: Platform[];
  limit?: number;
}

const PLATFORMS: Platform[] = ["hn", "reddit", "lobsters"];

function getSourceIdMap(db: Db): Map<Platform, number> {
  const rows = db
    .prepare("SELECT id, name FROM sources")
    .all() as Array<{ id: number; name: string }>;
  const m = new Map<Platform, number>();
  for (const r of rows) {
    if ((PLATFORMS as string[]).includes(r.name)) {
      m.set(r.name as Platform, r.id);
    }
  }
  return m;
}

export function upsertItems(
  db: Db,
  items: NormalizedItem[],
  clusterMap: Map<string, string>,
  fetchedAt: Date,
): void {
  if (items.length === 0) return;
  const sourceIds = getSourceIdMap(db);
  const fetchedAtIso = fetchedAt.toISOString();
  const stmt = db.prepare(`
    INSERT INTO items (id, source_id, url, title, author, score, ts, cluster_id, raw_json, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_id = excluded.source_id,
      url = excluded.url,
      title = excluded.title,
      author = excluded.author,
      score = excluded.score,
      ts = excluded.ts,
      cluster_id = excluded.cluster_id,
      raw_json = excluded.raw_json,
      fetched_at = excluded.fetched_at
  `);
  db.exec("BEGIN");
  try {
    for (const it of items) {
      stmt.run(
        it.id,
        sourceIds.get(it.platform) ?? null,
        it.url,
        it.title,
        it.author,
        it.score,
        it.ts,
        clusterMap.get(it.id) ?? null,
        JSON.stringify(it.raw ?? null),
        fetchedAtIso,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function upsertClusters(
  db: Db,
  clusters: ClusterRow[],
  now: Date,
): void {
  if (clusters.length === 0) return;
  const nowIso = now.toISOString();
  const stmt = db.prepare(`
    INSERT INTO clusters (id, canonical_url, canonical_title, first_seen, last_updated)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      canonical_url = excluded.canonical_url,
      canonical_title = excluded.canonical_title,
      last_updated = excluded.last_updated
  `);
  db.exec("BEGIN");
  try {
    for (const c of clusters) {
      stmt.run(c.id, c.canonicalUrl, c.canonicalTitle, nowIso, nowIso);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function readFreshItems(
  db: Db,
  options: ReadOptions,
): NormalizedItem[] {
  const cutoffIso = new Date(
    options.now.getTime() - options.ttlHours * 3_600_000,
  ).toISOString();
  const sourceIds = getSourceIdMap(db);
  const platforms = options.platforms ?? PLATFORMS;
  const ids = platforms
    .map((p) => sourceIds.get(p))
    .filter((x): x is number => typeof x === "number");
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  const limitClause = options.limit ? "LIMIT ?" : "";
  const params: Array<string | number> = [cutoffIso, ...ids];
  if (options.limit) params.push(options.limit);

  const sql = `
    SELECT i.id, s.name AS platform, i.url, i.title, i.author, i.score, i.ts, i.raw_json
    FROM items i
    JOIN sources s ON s.id = i.source_id
    WHERE i.fetched_at >= ?
      AND i.source_id IN (${placeholders})
    ORDER BY i.ts DESC
    ${limitClause}
  `;
  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    platform: string;
    url: string;
    title: string;
    author: string;
    score: number;
    ts: string;
    raw_json: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    platform: r.platform as Platform,
    url: r.url,
    title: r.title,
    author: r.author,
    score: r.score,
    ts: r.ts,
    raw: r.raw_json ? safeJsonParse(r.raw_json) : null,
  }));
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
