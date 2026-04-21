import type { Db } from "./storage/db.js";
import type { Config } from "./config/schema.js";
import type { Fetcher } from "./fetchers/types.js";
import type {
  NormalizedItem,
  Platform,
  PlatformError,
  PostDetail,
} from "./types.js";
import { searchAll } from "./orchestrator.js";
import { scoreItem, type HeuristicScores } from "./scoring/heuristics.js";

export type ResearchDepth = "normal" | "deep";

export interface RunResearchInput {
  topic: string;
  fetchers: Map<Platform, Fetcher>;
  db: Db;
  config: Config;
  options?: {
    limit?: number;
    windowDays?: number;
    depth?: ResearchDepth;
  };
  now?: Date;
}

export interface ResearchTopPost {
  platform: Platform;
  title: string;
  url: string;
  score: number;
  posted_at: string;
  heuristic_scores: HeuristicScores;
  top_comments: string[];
}

export type HypeSignal =
  | "strong_hype"
  | "mild_hype"
  | "balanced"
  | "substantive";

export interface ResearchAggregate {
  avg_velocity: number;
  avg_dissent: number;
  avg_expert_engagement: number;
  avg_buzzword_density: number;
  avg_depth: number;
  avg_longevity: number;
  hype_signal: HypeSignal;
  hype_reasoning: string;
}

export interface ResearchResult {
  topic: string;
  confidence: "high" | "medium" | "low";
  discussions: {
    total: number;
    by_platform: Partial<Record<Platform, number>>;
  };
  top_posts: ResearchTopPost[];
  aggregate: ResearchAggregate;
  errors?: Partial<Record<Platform, PlatformError>>;
  guidance: string;
}

const GUIDANCE =
  "Synthesize the summary from top_posts[].top_comments — identify pro/con camps, " +
  "key voices, and misconceptions. Cross-check aggregate.hype_signal against " +
  "buzzword_density, expert_engagement, and velocity. If confidence='low', caveat accordingly.";

export async function runResearch(
  input: RunResearchInput,
): Promise<ResearchResult> {
  const depth = input.options?.depth ?? "normal";
  const topN = depth === "deep" ? 12 : 6;
  const now = input.now ?? new Date();

  const searchRes = await searchAll({
    query: input.topic,
    fetchers: input.fetchers,
    db: input.db,
    options: {
      limit: input.options?.limit,
      windowDays: input.options?.windowDays,
    },
    now,
  });

  const canonicals = pickCanonicalPerCluster(searchRes.items, searchRes.clusters);
  const topItems = canonicals.sort((a, b) => b.score - a.score).slice(0, topN);

  const details = await Promise.all(
    topItems.map((item) => loadDetail(item, input.fetchers)),
  );

  const topPosts: ResearchTopPost[] = details.map(({ detail }) => ({
    platform: detail.item.platform,
    title: detail.item.title,
    url: detail.item.url,
    score: detail.item.score,
    posted_at: detail.item.ts,
    heuristic_scores: scoreItem(detail, { now }),
    top_comments: pickTopComments(detail, 5),
  }));

  return {
    topic: input.topic,
    confidence: computeConfidence(topPosts.length, searchRes.items.length),
    discussions: {
      total: searchRes.items.length,
      by_platform: countByPlatform(searchRes.items),
    },
    top_posts: topPosts,
    aggregate: buildAggregate(topPosts),
    errors: Object.keys(searchRes.errors).length ? searchRes.errors : undefined,
    guidance: GUIDANCE,
  };
}

function pickCanonicalPerCluster(
  items: NormalizedItem[],
  clusters: Map<string, string>,
): NormalizedItem[] {
  const byCluster = new Map<string, NormalizedItem>();
  for (const it of items) {
    const cid = clusters.get(it.id) ?? it.id;
    const existing = byCluster.get(cid);
    if (!existing || it.score > existing.score) {
      byCluster.set(cid, it);
    }
  }
  return [...byCluster.values()];
}

async function loadDetail(
  item: NormalizedItem,
  fetchers: Map<Platform, Fetcher>,
): Promise<{ detail: PostDetail }> {
  const fetcher = fetchers.get(item.platform);
  if (fetcher?.getPost) {
    try {
      const detail = await fetcher.getPost(item.id);
      return { detail };
    } catch {
      // fall through to minimal detail
    }
  }
  return { detail: { item, comments: [] } };
}

function pickTopComments(detail: PostDetail, k: number): string[] {
  return [...detail.comments]
    .filter((c) => c.text && c.text.trim().length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((c) => c.text.slice(0, 500));
}

function buildAggregate(posts: ResearchTopPost[]): ResearchAggregate {
  if (posts.length === 0) {
    return {
      avg_velocity: 0,
      avg_dissent: 0,
      avg_expert_engagement: 0,
      avg_buzzword_density: 0,
      avg_depth: 0,
      avg_longevity: 0,
      hype_signal: "balanced",
      hype_reasoning: "No posts found — cannot assess hype signal.",
    };
  }
  const avg = (pick: (s: HeuristicScores) => number): number =>
    posts.reduce((acc, p) => acc + pick(p.heuristic_scores), 0) / posts.length;
  const a = {
    avg_velocity: avg((s) => s.velocity),
    avg_dissent: avg((s) => s.dissent),
    avg_expert_engagement: avg((s) => s.expert),
    avg_buzzword_density: avg((s) => s.buzzwordDensity),
    avg_depth: avg((s) => s.depth),
    avg_longevity: avg((s) => s.longevity),
  };
  const { signal, reasoning } = classifyHype(a);
  return { ...a, hype_signal: signal, hype_reasoning: reasoning };
}

function classifyHype(a: {
  avg_velocity: number;
  avg_buzzword_density: number;
  avg_expert_engagement: number;
}): { signal: HypeSignal; reasoning: string } {
  if (
    a.avg_buzzword_density > 0.4 &&
    a.avg_velocity > 0.6 &&
    a.avg_expert_engagement < 0.3
  ) {
    return {
      signal: "strong_hype",
      reasoning:
        "High buzzword density + high velocity + low expert engagement — classic hype pattern.",
    };
  }
  if (a.avg_buzzword_density > 0.25 && a.avg_velocity > 0.5) {
    return {
      signal: "mild_hype",
      reasoning:
        "Elevated buzzwords and velocity, but some expert voices present — partial hype.",
    };
  }
  if (a.avg_expert_engagement > 0.5 && a.avg_buzzword_density < 0.15) {
    return {
      signal: "substantive",
      reasoning:
        "Low buzzword density, high expert engagement — substantive discussion.",
    };
  }
  return {
    signal: "balanced",
    reasoning: "Signals mixed — no dominant hype or substance pattern.",
  };
}

function countByPlatform(
  items: NormalizedItem[],
): Partial<Record<Platform, number>> {
  const out: Partial<Record<Platform, number>> = {};
  for (const it of items) {
    out[it.platform] = (out[it.platform] ?? 0) + 1;
  }
  return out;
}

function computeConfidence(
  samples: number,
  total: number,
): "high" | "medium" | "low" {
  if (samples === 0) return "low";
  if (total >= 10 && samples >= 5) return "high";
  if (total >= 3) return "medium";
  return "low";
}
