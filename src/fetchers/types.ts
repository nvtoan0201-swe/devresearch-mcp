import type {
  NormalizedItem,
  Platform,
  PostDetail,
  UserSummary,
  TrendingOptions,
} from "../types.js";
import type { HttpOptions } from "./http.js";

export interface SearchOptions {
  limit?: number;
  windowDays?: number;
}

export interface FetcherDeps {
  http?: HttpOptions;
  now?: () => Date;
}

export interface Fetcher {
  platform: Platform;
  search(query: string, options: SearchOptions): Promise<NormalizedItem[]>;
  getPost?(id: string): Promise<PostDetail>;
  getUser?(username: string): Promise<UserSummary>;
  trending?(options: TrendingOptions): Promise<NormalizedItem[]>;
}
