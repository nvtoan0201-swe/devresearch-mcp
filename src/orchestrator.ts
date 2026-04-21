import type { Db } from "./storage/db.js";
import type { Fetcher, SearchOptions } from "./fetchers/types.js";
import type { NormalizedItem, Platform } from "./types.js";
import { clusterItems, normalizeUrl } from "./normalize/cluster.js";
import {
  upsertItems,
  upsertClusters,
  type ClusterRow,
} from "./storage/cache.js";

export interface SearchAllInput {
  query: string;
  fetchers: Map<Platform, Fetcher>;
  db: Db;
  options: SearchOptions;
  now?: Date;
}

export interface SearchAllResult {
  items: NormalizedItem[];
  clusters: Map<string, string>;
  errors: Partial<Record<Platform, string>>;
}

export async function searchAll(
  input: SearchAllInput,
): Promise<SearchAllResult> {
  const now = input.now ?? new Date();
  const errors: Partial<Record<Platform, string>> = {};
  const items: NormalizedItem[] = [];

  const jobs = [...input.fetchers.entries()].map(
    async ([platform, fetcher]) => {
      try {
        const fetched = await fetcher.search(input.query, input.options);
        return { platform, items: fetched };
      } catch (err) {
        errors[platform] = err instanceof Error ? err.message : String(err);
        return { platform, items: [] as NormalizedItem[] };
      }
    },
  );

  const results = await Promise.all(jobs);
  for (const r of results) {
    for (const it of r.items) items.push(it);
  }

  const clusterMap = clusterItems(items);
  const clusterRows = buildClusterRows(items, clusterMap);

  upsertItems(input.db, items, clusterMap, now);
  upsertClusters(input.db, clusterRows, now);

  return { items, clusters: clusterMap, errors };
}

function buildClusterRows(
  items: NormalizedItem[],
  clusterMap: Map<string, string>,
): ClusterRow[] {
  const byCluster = new Map<string, NormalizedItem>();
  for (const it of items) {
    const cid = clusterMap.get(it.id);
    if (!cid) continue;
    const existing = byCluster.get(cid);
    if (!existing || it.score > existing.score) {
      byCluster.set(cid, it);
    }
  }
  const rows: ClusterRow[] = [];
  for (const [cid, canonical] of byCluster) {
    rows.push({
      id: cid,
      canonicalUrl: normalizeUrl(canonical.url),
      canonicalTitle: canonical.title,
    });
  }
  return rows;
}
