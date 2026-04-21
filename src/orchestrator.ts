import type { Db } from "./storage/db.js";
import type { Fetcher, SearchOptions } from "./fetchers/types.js";
import type { NormalizedItem, Platform, PlatformError } from "./types.js";
import { clusterItems, normalizeUrl } from "./normalize/cluster.js";
import { HttpError } from "./fetchers/http.js";
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
  errors: Partial<Record<Platform, PlatformError>>;
}

export function toPlatformError(err: unknown, degraded: boolean): PlatformError {
  if (err instanceof HttpError) {
    return {
      code: err.code,
      message: err.message,
      status: err.status,
      retryAfter: err.retryAfter,
      degraded,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: "UNKNOWN", message, degraded };
}

export async function searchAll(
  input: SearchAllInput,
): Promise<SearchAllResult> {
  const now = input.now ?? new Date();
  const errors: Partial<Record<Platform, PlatformError>> = {};
  const items: NormalizedItem[] = [];
  const succeeded: Platform[] = [];

  const jobs = [...input.fetchers.entries()].map(
    async ([platform, fetcher]) => {
      try {
        const fetched = await fetcher.search(input.query, input.options);
        return { platform, items: fetched, err: undefined as unknown };
      } catch (err) {
        return { platform, items: [] as NormalizedItem[], err };
      }
    },
  );

  const results = await Promise.all(jobs);
  for (const r of results) {
    if (r.err !== undefined) continue;
    succeeded.push(r.platform);
    for (const it of r.items) items.push(it);
  }
  const anySucceeded = succeeded.length > 0;
  for (const r of results) {
    if (r.err === undefined) continue;
    const pe = toPlatformError(r.err, anySucceeded);
    if (anySucceeded) {
      pe.suggestion = `Try platforms: [${succeeded.map((p) => `"${p}"`).join(", ")}]`;
    }
    errors[r.platform] = pe;
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
