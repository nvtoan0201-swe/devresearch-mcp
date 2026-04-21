import type { Fetcher, FetcherDeps, SearchOptions } from "./types.js";
import type {
  NormalizedItem,
  NormalizedComment,
  PostDetail,
  UserSummary,
  TrendingOptions,
} from "../types.js";
import { httpGetJson } from "./http.js";

interface LobstersStory {
  short_id: string;
  short_id_url?: string;
  created_at?: string;
  title: string;
  url?: string | null;
  score?: number;
  comment_count?: number;
  submitter_user?: string | { username?: string };
  tags?: string[];
  description?: string | null;
  description_plain?: string | null;
}

interface LobstersComment {
  short_id: string;
  comment: string;
  commenting_user?: string | { username?: string };
  score?: number;
  created_at?: string;
  parent_comment?: string | null;
  indent_level?: number;
}

interface LobstersStoryDetail extends LobstersStory {
  comments?: LobstersComment[];
}

interface LobstersUser {
  username: string;
  created_at?: string;
  karma?: number;
  about?: string;
}

function userString(u: LobstersStory["submitter_user"]): string {
  if (!u) return "";
  if (typeof u === "string") return u;
  return u.username ?? "";
}

function commenterString(u: LobstersComment["commenting_user"]): string {
  if (!u) return "";
  if (typeof u === "string") return u;
  return u.username ?? "";
}

export function createLobstersFetcher(deps: FetcherDeps = {}): Fetcher {
  const trending = async (options: TrendingOptions): Promise<NormalizedItem[]> => {
    const limit = options.limit ?? 25;
    const url = "https://lobste.rs/hottest.json";
    const data = await httpGetJson<LobstersStory[] | { stories: LobstersStory[] }>(
      url,
      deps.http,
    );
    const stories = Array.isArray(data) ? data : (data.stories ?? []);
    return stories.slice(0, limit).map(toItem);
  };

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

    trending,

    async getPost(id: string): Promise<PostDetail> {
      const bareId = id.startsWith("lobsters_")
        ? id.slice("lobsters_".length)
        : id;
      const url = `https://lobste.rs/s/${encodeURIComponent(bareId)}.json`;
      const data = await httpGetJson<LobstersStoryDetail>(url, deps.http);
      const item = toItem(data);
      const byShortId = new Map<string, string>();
      for (const c of data.comments ?? []) {
        byShortId.set(c.short_id, `lobsters_c_${c.short_id}`);
      }
      const comments: NormalizedComment[] = (data.comments ?? []).map((c) => ({
        id: `lobsters_c_${c.short_id}`,
        itemId: item.id,
        author: commenterString(c.commenting_user),
        text: c.comment,
        parentId:
          c.parent_comment && byShortId.has(c.parent_comment)
            ? byShortId.get(c.parent_comment)
            : undefined,
        score: typeof c.score === "number" ? c.score : 0,
        ts: c.created_at ? new Date(c.created_at).toISOString() : item.ts,
        depth: typeof c.indent_level === "number" ? c.indent_level - 1 : 0,
      }));
      return { item, comments };
    },

    async getUser(username: string): Promise<UserSummary> {
      const url = `https://lobste.rs/u/${encodeURIComponent(username)}.json`;
      const u = await httpGetJson<LobstersUser>(url, deps.http);
      return {
        platform: "lobsters",
        username: u.username,
        karma: u.karma,
        createdAt: u.created_at,
        about: u.about,
      };
    },
  };
}

function toItem(s: LobstersStory): NormalizedItem {
  const fallbackUrl = s.short_id_url ?? `https://lobste.rs/s/${s.short_id}`;
  const externalUrl =
    typeof s.url === "string" && s.url.length > 0 ? s.url : fallbackUrl;
  const descriptionRaw =
    (typeof s.description_plain === "string" && s.description_plain.length > 0
      ? s.description_plain
      : typeof s.description === "string" && s.description.length > 0
        ? s.description
        : undefined) ?? undefined;
  const excerpt = descriptionRaw ? descriptionRaw.slice(0, 300) : undefined;
  return {
    id: `lobsters_${s.short_id}`,
    platform: "lobsters",
    url: externalUrl,
    title: s.title ?? "",
    author: userString(s.submitter_user),
    score: typeof s.score === "number" ? s.score : 0,
    ts: s.created_at
      ? new Date(s.created_at).toISOString()
      : new Date(0).toISOString(),
    excerpt,
    numComments:
      typeof s.comment_count === "number" ? s.comment_count : undefined,
    tags: Array.isArray(s.tags) && s.tags.length > 0 ? s.tags : undefined,
    raw: s,
  };
}
