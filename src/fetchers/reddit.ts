import type { Fetcher, FetcherDeps, SearchOptions } from "./types.js";
import type {
  NormalizedItem,
  NormalizedComment,
  PostDetail,
  UserSummary,
  TrendingOptions,
} from "../types.js";
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
    selftext?: string;
  };
}

interface RedditListing {
  kind: string;
  data: {
    children: RedditChild[];
  };
}

interface RedditCommentData {
  id: string;
  body?: string;
  author?: string;
  score?: number;
  created_utc?: number;
  parent_id?: string;
  link_id?: string;
  depth?: number;
  replies?: RedditListing | "";
}

interface RedditCommentChild {
  kind: string;
  data: RedditCommentData;
}

interface RedditUserAbout {
  data: {
    name: string;
    total_karma?: number;
    link_karma?: number;
    comment_karma?: number;
    created_utc?: number;
    subreddit?: { public_description?: string };
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

    async trending(options: TrendingOptions): Promise<NormalizedItem[]> {
      const limit = options.limit ?? 25;
      const params = new URLSearchParams({
        limit: String(limit),
        raw_json: "1",
      });
      const url =
        config.subreddits.length > 0
          ? `https://www.reddit.com/r/${config.subreddits.map(encodeURIComponent).join("+")}/hot.json?${params.toString()}`
          : `https://www.reddit.com/hot.json?${params.toString()}`;
      const data = await httpGetJson<RedditListing>(url, deps.http);
      return (data.data?.children ?? []).map(toItem);
    },

    async getPost(id: string): Promise<PostDetail> {
      const bareId = id.startsWith("reddit_") ? id.slice("reddit_".length) : id;
      const url = `https://www.reddit.com/comments/${encodeURIComponent(bareId)}.json?raw_json=1`;
      const data = await httpGetJson<[RedditListing, RedditListing]>(url, deps.http);
      const postListing = data[0];
      const commentsListing = data[1];
      const postChild = postListing.data.children[0];
      if (!postChild) throw new Error(`Reddit post not found: ${id}`);
      const item = toItem(postChild);
      const comments: NormalizedComment[] = [];
      const walk = (
        children: RedditListing["data"]["children"] | RedditCommentChild[],
        depth: number,
        parentId: string | undefined,
      ): void => {
        for (const c of children as RedditCommentChild[]) {
          if (c.kind !== "t1") continue;
          const d = c.data;
          if (!d.body) continue;
          const cid = `reddit_${d.id}`;
          comments.push({
            id: cid,
            itemId: item.id,
            author: d.author ?? "",
            text: d.body,
            parentId,
            score: typeof d.score === "number" ? d.score : 0,
            ts:
              typeof d.created_utc === "number"
                ? new Date(d.created_utc * 1000).toISOString()
                : item.ts,
            depth,
          });
          if (d.replies && typeof d.replies === "object") {
            walk(d.replies.data.children, depth + 1, cid);
          }
        }
      };
      walk(commentsListing.data.children, 0, undefined);
      return { item, comments };
    },

    async getUser(username: string): Promise<UserSummary> {
      const url = `https://www.reddit.com/user/${encodeURIComponent(username)}/about.json?raw_json=1`;
      const data = await httpGetJson<RedditUserAbout>(url, deps.http);
      const d = data.data;
      return {
        platform: "reddit",
        username: d.name,
        karma:
          typeof d.total_karma === "number"
            ? d.total_karma
            : (d.link_karma ?? 0) + (d.comment_karma ?? 0),
        createdAt:
          typeof d.created_utc === "number"
            ? new Date(d.created_utc * 1000).toISOString()
            : undefined,
        about: d.subreddit?.public_description,
      };
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
