export type Platform = "hn" | "reddit" | "lobsters";

export interface NormalizedItem {
  id: string;
  platform: Platform;
  url: string;
  title: string;
  author: string;
  score: number;
  ts: string;
  excerpt?: string;
  numComments?: number;
  subreddit?: string;
  tags?: string[];
  raw: unknown;
}

export type PlatformErrorCode =
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_HTTP_ERROR"
  | "UPSTREAM_UNREACHABLE"
  | "UNKNOWN";

export interface PlatformError {
  code: PlatformErrorCode;
  message: string;
  status?: number;
  retryAfter?: number;
  degraded: boolean;
  suggestion?: string;
}

export interface NormalizedComment {
  id: string;
  itemId: string;
  author: string;
  authorKarma?: number;
  text: string;
  parentId?: string;
  score: number;
  ts: string;
  depth: number;
}

export interface PostDetail {
  item: NormalizedItem;
  comments: NormalizedComment[];
}

export interface UserSummary {
  platform: Platform;
  username: string;
  karma?: number;
  createdAt?: string;
  about?: string;
}

export interface TrendingOptions {
  limit?: number;
  windowDays?: number;
}
