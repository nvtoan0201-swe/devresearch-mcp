import type { Fetcher, FetcherDeps, SearchOptions } from "./types.js";
import type { NormalizedItem } from "../types.js";
import { httpGetJson } from "./http.js";

interface LobstersStory {
  short_id: string;
  short_id_url?: string;
  created_at?: string;
  title: string;
  url?: string | null;
  score?: number;
  comment_count?: number;
  submitter_user?: string;
  tags?: string[];
}

export function createLobstersFetcher(deps: FetcherDeps = {}): Fetcher {
  return {
    platform: "lobsters",
    async search(query, options: SearchOptions): Promise<NormalizedItem[]> {
      const limit = options.limit ?? 25;
      let url: string;
      if (query.trim().length > 0) {
        const params = new URLSearchParams({
          q: query,
          what: "stories",
          order: "relevance",
        });
        url = `https://lobste.rs/search.json?${params.toString()}`;
      } else {
        url = "https://lobste.rs/hottest.json";
      }
      const data = await httpGetJson<LobstersStory[] | { stories: LobstersStory[] }>(
        url,
        deps.http,
      );
      const stories = Array.isArray(data) ? data : (data.stories ?? []);
      return stories.slice(0, limit).map(toItem);
    },
  };
}

function toItem(s: LobstersStory): NormalizedItem {
  const fallbackUrl = s.short_id_url ?? `https://lobste.rs/s/${s.short_id}`;
  const externalUrl =
    typeof s.url === "string" && s.url.length > 0 ? s.url : fallbackUrl;
  return {
    id: `lobsters_${s.short_id}`,
    platform: "lobsters",
    url: externalUrl,
    title: s.title ?? "",
    author: s.submitter_user ?? "",
    score: typeof s.score === "number" ? s.score : 0,
    ts: s.created_at
      ? new Date(s.created_at).toISOString()
      : new Date(0).toISOString(),
    raw: s,
  };
}
