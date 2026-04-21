import type { NormalizedItem, Platform } from "../types.js";
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
}
