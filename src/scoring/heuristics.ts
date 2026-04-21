import type { NormalizedItem, NormalizedComment, PostDetail } from "../types.js";

export interface HeuristicScores {
  velocity: number;
  buzzwordDensity: number;
  dissent: number;
  expert: number;
  depth: number;
  longevity: number;
  overall: number;
}

const BUZZWORDS = [
  "revolutionary",
  "game-changer",
  "game changer",
  "10x",
  "disrupt",
  "paradigm",
  "unprecedented",
  "groundbreaking",
  "mind-blowing",
  "next-gen",
  "cutting-edge",
];

const DISSENT_MARKERS = [
  "skeptical",
  "doubt",
  "overhyped",
  "snake oil",
  "misleading",
  "disagree",
  "nonsense",
  "bullshit",
  "not convinced",
  "wrong",
  "fundamentally flawed",
];

function clamp01(x: number): number {
  if (!Number.isFinite(x) || x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);
}

export function velocityScore(item: NormalizedItem, now: Date): number {
  const age = hoursBetween(new Date(item.ts), now);
  const hoursBand = age < 1 ? 1 : age;
  const rate = item.score / hoursBand;
  return clamp01(Math.tanh(rate / 20));
}

export function buzzwordDensity(text: string): number {
  if (!text || text.length === 0) return 0;
  const lower = text.toLowerCase();
  const words = Math.max(1, lower.split(/\s+/).filter(Boolean).length);
  let hits = 0;
  for (const b of BUZZWORDS) {
    const idx = lower.split(b).length - 1;
    if (idx > 0) hits += idx;
  }
  return clamp01((hits / words) * 50);
}

export function dissentRatio(comments: NormalizedComment[]): number {
  const topLevel = comments.filter((c) => c.depth === 0);
  if (topLevel.length === 0) return 0;
  const dissenting = topLevel.filter((c) => {
    const lower = c.text.toLowerCase();
    return DISSENT_MARKERS.some((m) => lower.includes(m));
  });
  return clamp01(dissenting.length / topLevel.length);
}

export function expertEngagement(
  comments: NormalizedComment[],
  karmaThreshold = 10_000,
): number {
  if (comments.length === 0) return 0;
  const experts = comments.filter(
    (c) => typeof c.authorKarma === "number" && c.authorKarma >= karmaThreshold,
  );
  return clamp01(experts.length / comments.length);
}

export function commentDepthScore(comments: NormalizedComment[]): number {
  if (comments.length === 0) return 0;
  const maxDepth = comments.reduce((m, c) => Math.max(m, c.depth), 0);
  return clamp01(maxDepth / 6);
}

export function longevityScore(
  item: NormalizedItem,
  comments: NormalizedComment[],
  now: Date,
): number {
  if (comments.length === 0) return 0;
  const postTs = new Date(item.ts).getTime();
  const latest = comments.reduce(
    (m, c) => Math.max(m, new Date(c.ts).getTime()),
    postTs,
  );
  const spanHours = Math.max(0, (latest - postTs) / 3_600_000);
  const ageHours = Math.max(1, hoursBetween(new Date(item.ts), now));
  return clamp01(spanHours / Math.min(ageHours, 72));
}

export interface ScoreItemOptions {
  now?: Date;
  karmaThreshold?: number;
  weights?: Partial<Record<keyof Omit<HeuristicScores, "overall">, number>>;
}

const DEFAULT_WEIGHTS: Record<keyof Omit<HeuristicScores, "overall">, number> = {
  velocity: 0.2,
  buzzwordDensity: -0.15,
  dissent: 0.15,
  expert: 0.25,
  depth: 0.15,
  longevity: 0.2,
};

export function scoreItem(
  detail: PostDetail,
  options: ScoreItemOptions = {},
): HeuristicScores {
  const now = options.now ?? new Date();
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
  const titleAndBody = [detail.item.title, ...detail.comments.map((c) => c.text)]
    .join(" ")
    .slice(0, 20_000);

  const velocity = velocityScore(detail.item, now);
  const bwd = buzzwordDensity(titleAndBody);
  const dissent = dissentRatio(detail.comments);
  const expert = expertEngagement(detail.comments, options.karmaThreshold);
  const depth = commentDepthScore(detail.comments);
  const longevity = longevityScore(detail.item, detail.comments, now);

  const raw =
    velocity * weights.velocity +
    bwd * weights.buzzwordDensity +
    dissent * weights.dissent +
    expert * weights.expert +
    depth * weights.depth +
    longevity * weights.longevity;
  const total =
    Math.abs(weights.velocity) +
    Math.abs(weights.buzzwordDensity) +
    Math.abs(weights.dissent) +
    Math.abs(weights.expert) +
    Math.abs(weights.depth) +
    Math.abs(weights.longevity);
  const normalized = total === 0 ? 0 : raw / total;
  const overall = clamp01((normalized + 1) / 2);

  return {
    velocity,
    buzzwordDensity: bwd,
    dissent,
    expert,
    depth,
    longevity,
    overall,
  };
}
