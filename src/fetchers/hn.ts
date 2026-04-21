import type { Fetcher, FetcherDeps, SearchOptions } from "./types.js";
import type { NormalizedItem } from "../types.js";
import { httpGetJson } from "./http.js";

interface AlgoliaHit {
  objectID: string;
  title?: string;
  url?: string | null;
  author?: string;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string;
  created_at_i?: number;
  story_text?: string | null;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

export function createHnFetcher(deps: FetcherDeps = {}): Fetcher {
  const now = deps.now ?? (() => new Date());

  return {
    platform: "hn",
    async search(query, options: SearchOptions): Promise<NormalizedItem[]> {
      const limit = options.limit ?? 20;
      const params = new URLSearchParams({
        query,
        tags: "story",
        hitsPerPage: String(limit),
      });
      if (options.windowDays && options.windowDays > 0) {
        const cutoffSec = Math.floor(
          (now().getTime() - options.windowDays * 86_400_000) / 1000,
        );
        params.set("numericFilters", `created_at_i>=${cutoffSec}`);
      }
      const url = `https://hn.algolia.com/api/v1/search?${params.toString()}`;
      const data = await httpGetJson<AlgoliaResponse>(url, deps.http);
      return data.hits.map(toItem);
    },
  };
}

function toItem(hit: AlgoliaHit): NormalizedItem {
  const hnUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  return {
    id: `hn_${hit.objectID}`,
    platform: "hn",
    url: hit.url && hit.url.length > 0 ? hit.url : hnUrl,
    title: hit.title ?? "",
    author: hit.author ?? "",
    score: typeof hit.points === "number" ? hit.points : 0,
    ts: hit.created_at ?? new Date(0).toISOString(),
    raw: hit,
  };
}
