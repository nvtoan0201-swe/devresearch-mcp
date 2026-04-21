import type { Fetcher, FetcherDeps, SearchOptions } from "./types.js";
import type { NormalizedItem } from "../types.js";
import { httpGetJson } from "./http.js";

export interface RedditConfig {
  subreddits: string[];
}

interface RedditChild {
  kind: string;
  data: {
    id: string;
    title: string;
    url?: string;
    permalink: string;
    author?: string;
    score?: number;
    created_utc?: number;
    is_self?: boolean;
    subreddit?: string;
  };
}

interface RedditListing {
  kind: string;
  data: {
    children: RedditChild[];
  };
}

export function createRedditFetcher(
  deps: FetcherDeps,
  config: RedditConfig,
): Fetcher {
  return {
    platform: "reddit",
    async search(query, options: SearchOptions): Promise<NormalizedItem[]> {
      const limit = options.limit ?? 25;
      const params = new URLSearchParams({
        q: query,
        limit: String(limit),
        sort: "relevance",
        t: options.windowDays && options.windowDays <= 7 ? "week" : "month",
        raw_json: "1",
      });

      let url: string;
      if (config.subreddits.length > 0) {
        const subs = config.subreddits.map(encodeURIComponent).join("+");
        params.set("restrict_sr", "on");
        url = `https://www.reddit.com/r/${subs}/search.json?${params.toString()}`;
      } else {
        url = `https://www.reddit.com/search.json?${params.toString()}`;
      }

      const data = await httpGetJson<RedditListing>(url, deps.http);
      return (data.data?.children ?? []).map(toItem);
    },
  };
}

function toItem(child: RedditChild): NormalizedItem {
  const d = child.data;
  const permalinkUrl = `https://www.reddit.com${d.permalink}`;
  const externalUrl =
    !d.is_self && typeof d.url === "string" && d.url.length > 0
      ? d.url
      : permalinkUrl;
  return {
    id: `reddit_${d.id}`,
    platform: "reddit",
    url: externalUrl,
    title: d.title ?? "",
    author: d.author ?? "",
    score: typeof d.score === "number" ? d.score : 0,
    ts:
      typeof d.created_utc === "number"
        ? new Date(d.created_utc * 1000).toISOString()
        : new Date(0).toISOString(),
    raw: d,
  };
}
