import type { Config } from "../config/schema.js";
import type { Platform } from "../types.js";
import type { Fetcher, FetcherDeps } from "./types.js";
import { createHnFetcher } from "./hn.js";
import { createRedditFetcher } from "./reddit.js";
import { createLobstersFetcher } from "./lobsters.js";

export function createFetchers(
  config: Config,
  deps: FetcherDeps = {},
): Map<Platform, Fetcher> {
  const map = new Map<Platform, Fetcher>();
  for (const platform of config.sources.enabled) {
    switch (platform) {
      case "hn":
        map.set("hn", createHnFetcher(deps));
        break;
      case "reddit":
        map.set(
          "reddit",
          createRedditFetcher(deps, {
            subreddits: config.sources.reddit.subreddits,
          }),
        );
        break;
      case "lobsters":
        map.set("lobsters", createLobstersFetcher(deps));
        break;
    }
  }
  return map;
}
