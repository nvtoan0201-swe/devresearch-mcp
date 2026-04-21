import type { Db } from "../storage/db.js";
import type { Config } from "../config/schema.js";
import type { Fetcher } from "../fetchers/types.js";
import type {
  NormalizedItem,
  Platform,
  PostDetail,
} from "../types.js";
import { searchAll } from "../orchestrator.js";
import { scoreItem, type HeuristicScores } from "../scoring/heuristics.js";
import type { LlmClient } from "./client.js";
import {
  buildResearchPrompt,
  type ResearchBundle,
  type ResearchPostSample,
  type ResearchAggregate,
} from "./prompt.js";

export type ResearchDepth = "normal" | "deep";

export interface RunResearchInput {
  topic: string;
  client: LlmClient;
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
  title: string;
  url: string;
  score: number;
  platform: Platform;
  top_comment_preview: string;
}

export interface ResearchDiscussions {
  total: number;
  by_platform: Partial<Record<Platform, number>>;
  top_posts: ResearchTopPost[];
}

export interface ResearchPerspectiveCamp {
  main_points: string[];
  key_voices: string[];
  strength: "strong" | "medium" | "weak";
}

export interface ResearchPerspectives {
  pro_camp: ResearchPerspectiveCamp;
  con_camp: ResearchPerspectiveCamp;
  disagreement_depth: "surface" | "technical" | "philosophical";
}

export interface ResearchHypeAssessment {
  signal: "strong_hype" | "mild_hype" | "balanced" | "under_hyped";
  reasoning: string;
  red_flags: string[];
  green_flags: string[];
  velocity: number;
  expert_engagement: number;
  dissent_ratio: number;
}

export interface ResearchMisconception {
  wrong_take: string;
  correction: string;
  source_quote: string;
}

export interface ResearchResult {
  topic: string;
  summary: string;
  discussions: ResearchDiscussions;
  perspectives: ResearchPerspectives;
  hype_assessment: ResearchHypeAssessment;
  misconceptions: ResearchMisconception[];
  confidence: "high" | "medium" | "low";
  errors?: Partial<Record<Platform, string>>;
}

const EMPTY_CAMP: ResearchPerspectiveCamp = {
  main_points: [],
  key_voices: [],
  strength: "weak",
};

const DEFAULT_SYNTHESIS = {
  summary: "",
  perspectives: {
    pro_camp: EMPTY_CAMP,
    con_camp: EMPTY_CAMP,
    disagreement_depth: "surface" as const,
  },
  hype_assessment: {
    signal: "balanced" as const,
    reasoning: "",
    red_flags: [] as string[],
    green_flags: [] as string[],
  },
  misconceptions: [] as ResearchMisconception[],
};

interface LlmSynthesis {
  summary: string;
  perspectives: ResearchPerspectives;
  hype_assessment: Pick<
    ResearchHypeAssessment,
    "signal" | "reasoning" | "red_flags" | "green_flags"
  >;
  misconceptions: ResearchMisconception[];
}

export async function runResearch(
  input: RunResearchInput,
): Promise<ResearchResult> {
  const depth: ResearchDepth = input.options?.depth ?? "normal";
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

  const canonicals = pickCanonicalPerCluster(
    searchRes.items,
    searchRes.clusters,
  );
  const topItems = canonicals
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const details = await Promise.all(
    topItems.map((item) => loadDetail(item, input.fetchers)),
  );

  const samples: ResearchPostSample[] = details.map(({ detail }) => {
    const s = scoreItem(detail, { now });
    return {
      platform: detail.item.platform,
      title: detail.item.title,
      url: detail.item.url,
      score: detail.item.score,
      scores: s,
      topComments: pickTopComments(detail, 3),
    };
  });

  const aggregate = buildAggregate(searchRes.items, samples);
  const bundle: ResearchBundle = {
    topic: input.topic,
    posts: samples,
    aggregate,
  };

  const synthesis = await runSynthesis(bundle, input.client);

  const discussions: ResearchDiscussions = {
    total: searchRes.items.length,
    by_platform: countByPlatform(searchRes.items),
    top_posts: samples.map((s) => ({
      title: s.title,
      url: s.url,
      score: s.score,
      platform: s.platform,
      top_comment_preview: (s.topComments[0] ?? "").slice(0, 200),
    })),
  };

  const heuristicSignals = {
    velocity: aggregate.avgVelocity,
    expert_engagement: aggregate.avgExpert,
    dissent_ratio: aggregate.avgDissent,
  };

  return {
    topic: input.topic,
    summary: synthesis.summary,
    discussions,
    perspectives: synthesis.perspectives,
    hype_assessment: { ...synthesis.hype_assessment, ...heuristicSignals },
    misconceptions: synthesis.misconceptions,
    confidence: computeConfidence(samples.length, searchRes.items.length),
    errors: Object.keys(searchRes.errors).length ? searchRes.errors : undefined,
  };
}

async function runSynthesis(
  bundle: ResearchBundle,
  client: LlmClient,
): Promise<LlmSynthesis> {
  if (bundle.posts.length === 0) {
    return {
      summary: `No discussions found for "${bundle.topic}" in the selected window.`,
      perspectives: {
        pro_camp: EMPTY_CAMP,
        con_camp: EMPTY_CAMP,
        disagreement_depth: "surface",
      },
      hype_assessment: {
        signal: "balanced",
        reasoning:
          "No evidence gathered — hype signal cannot be assessed.",
        red_flags: [],
        green_flags: [],
      },
      misconceptions: [],
    };
  }
  const prompt = buildResearchPrompt(bundle);
  let raw: string;
  try {
    raw = await client.complete(prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...DEFAULT_SYNTHESIS,
      summary: `LLM synthesis failed: ${msg}`,
    };
  }
  return parseSynthesis(raw) ?? {
    ...DEFAULT_SYNTHESIS,
    summary:
      "Synthesis parse failed — returning heuristic-only view of the discussions.",
  };
}

function parseSynthesis(raw: string): LlmSynthesis | null {
  const stripped = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const hype = (obj.hype_assessment ?? {}) as Record<string, unknown>;
  const persp = (obj.perspectives ?? {}) as Record<string, unknown>;
  return {
    summary: typeof obj.summary === "string" ? obj.summary : "",
    perspectives: {
      pro_camp: normalizeCamp(persp.pro_camp),
      con_camp: normalizeCamp(persp.con_camp),
      disagreement_depth: normalizeDepth(persp.disagreement_depth),
    },
    hype_assessment: {
      signal: normalizeSignal(hype.signal),
      reasoning: typeof hype.reasoning === "string" ? hype.reasoning : "",
      red_flags: asStringArray(hype.red_flags),
      green_flags: asStringArray(hype.green_flags),
    },
    misconceptions: asMisconceptions(obj.misconceptions),
  };
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
  const m = fence.exec(trimmed);
  return m ? m[1].trim() : trimmed;
}

function normalizeCamp(v: unknown): ResearchPerspectiveCamp {
  if (!v || typeof v !== "object") return EMPTY_CAMP;
  const o = v as Record<string, unknown>;
  const strength = o.strength;
  return {
    main_points: asStringArray(o.main_points),
    key_voices: asStringArray(o.key_voices),
    strength:
      strength === "strong" || strength === "medium" || strength === "weak"
        ? strength
        : "weak",
  };
}

function normalizeDepth(v: unknown): ResearchPerspectives["disagreement_depth"] {
  return v === "technical" || v === "philosophical" ? v : "surface";
}

function normalizeSignal(v: unknown): ResearchHypeAssessment["signal"] {
  if (
    v === "strong_hype" ||
    v === "mild_hype" ||
    v === "balanced" ||
    v === "under_hyped"
  ) {
    return v;
  }
  return "balanced";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asMisconceptions(v: unknown): ResearchMisconception[] {
  if (!Array.isArray(v)) return [];
  const out: ResearchMisconception[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const wrong = typeof o.wrong_take === "string" ? o.wrong_take : "";
    const fix = typeof o.correction === "string" ? o.correction : "";
    const quote = typeof o.source_quote === "string" ? o.source_quote : "";
    if (wrong && fix) out.push({ wrong_take: wrong, correction: fix, source_quote: quote });
  }
  return out;
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
    .map((c) => c.text);
}

function buildAggregate(
  allItems: NormalizedItem[],
  samples: ResearchPostSample[],
): ResearchAggregate {
  const byPlatform = countByPlatform(allItems);
  if (samples.length === 0) {
    return {
      totalPosts: allItems.length,
      avgVelocity: 0,
      avgDissent: 0,
      avgExpert: 0,
      avgBuzzword: 0,
      avgDepth: 0,
      avgLongevity: 0,
      byPlatform,
    };
  }
  const sum = (pick: (s: HeuristicScores) => number): number =>
    samples.reduce((acc, p) => acc + pick(p.scores), 0) / samples.length;
  return {
    totalPosts: allItems.length,
    avgVelocity: sum((s) => s.velocity),
    avgDissent: sum((s) => s.dissent),
    avgExpert: sum((s) => s.expert),
    avgBuzzword: sum((s) => s.buzzwordDensity),
    avgDepth: sum((s) => s.depth),
    avgLongevity: sum((s) => s.longevity),
    byPlatform,
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
