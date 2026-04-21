import type { Fetcher, FetcherDeps, SearchOptions } from "./types.js";
import type {
  NormalizedItem,
  NormalizedComment,
  PostDetail,
  UserSummary,
  TrendingOptions,
} from "../types.js";
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

interface AlgoliaItemNode {
  id: number;
  type?: string;
  author?: string | null;
  text?: string | null;
  title?: string | null;
  url?: string | null;
  points?: number | null;
  created_at?: string | null;
  parent_id?: number | null;
  story_id?: number | null;
  children?: AlgoliaItemNode[];
}

interface AlgoliaUser {
  username: string;
  karma?: number;
  about?: string | null;
  created_at?: string | null;
}

export function createHnFetcher(deps: FetcherDeps = {}): Fetcher {
  const now = deps.now ?? (() => new Date());

  const runSearch = async (
    query: string,
    options: SearchOptions,
    tag: string,
  ): Promise<NormalizedItem[]> => {
    const limit = options.limit ?? 20;
    const params = new URLSearchParams({
      query,
      tags: tag,
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
  };

  return {
    platform: "hn",
    async search(query, options) {
      return runSearch(query, options, "story");
    },
    async trending(options: TrendingOptions) {
      return runSearch("", { limit: options.limit, windowDays: options.windowDays }, "front_page");
    },
    async getPost(id: string): Promise<PostDetail> {
      const bareId = id.startsWith("hn_") ? id.slice(3) : id;
      const url = `https://hn.algolia.com/api/v1/items/${encodeURIComponent(bareId)}`;
      const root = await httpGetJson<AlgoliaItemNode>(url, deps.http);
      const item: NormalizedItem = {
        id: `hn_${root.id}`,
        platform: "hn",
        url:
          root.url && root.url.length > 0
            ? root.url
            : `https://news.ycombinator.com/item?id=${root.id}`,
        title: root.title ?? "",
        author: root.author ?? "",
        score: typeof root.points === "number" ? root.points : 0,
        ts: root.created_at ?? new Date(0).toISOString(),
        raw: root,
      };
      const comments: NormalizedComment[] = [];
      const walk = (node: AlgoliaItemNode, depth: number, parentId?: string): void => {
        for (const child of node.children ?? []) {
          if (child.type === "comment" && child.text) {
            const cid = `hn_${child.id}`;
            comments.push({
              id: cid,
              itemId: item.id,
              author: child.author ?? "",
              text: stripHtml(child.text),
              parentId,
              score: 0,
              ts: child.created_at ?? item.ts,
              depth,
            });
            walk(child, depth + 1, cid);
          } else {
            walk(child, depth, parentId);
          }
        }
      };
      walk(root, 0);
      return { item, comments };
    },
    async getUser(username: string): Promise<UserSummary> {
      const url = `https://hn.algolia.com/api/v1/users/${encodeURIComponent(username)}`;
      const u = await httpGetJson<AlgoliaUser>(url, deps.http);
      return {
        platform: "hn",
        username: u.username,
        karma: u.karma,
        createdAt: u.created_at ?? undefined,
        about: u.about ? stripHtml(u.about) : undefined,
      };
    },
  };
}

function stripHtml(s: string): string {
  return s
    .replace(/<\/?p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
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
