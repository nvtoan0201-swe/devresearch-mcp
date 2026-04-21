import type { Platform } from "../types.js";
import type { HeuristicScores } from "../scoring/heuristics.js";

export interface ResearchPostSample {
  platform: Platform;
  title: string;
  url: string;
  score: number;
  scores: HeuristicScores;
  topComments: string[];
}

export interface ResearchAggregate {
  totalPosts: number;
  avgVelocity: number;
  avgDissent: number;
  avgExpert: number;
  avgBuzzword: number;
  avgDepth: number;
  avgLongevity: number;
  byPlatform: Partial<Record<Platform, number>>;
}

export interface ResearchBundle {
  topic: string;
  posts: ResearchPostSample[];
  aggregate: ResearchAggregate;
}

function trimComment(text: string, max = 400): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max - 1) + "…";
}

function renderPost(p: ResearchPostSample, i: number): string {
  const s = p.scores;
  const comments = p.topComments
    .slice(0, 3)
    .map((c, idx) => `  - [c${idx + 1}] ${trimComment(c)}`)
    .join("\n");
  return [
    `### Post ${i + 1} — ${p.platform}`,
    `Title: ${p.title}`,
    `URL: ${p.url}`,
    `Score: ${p.score}`,
    `Heuristics: velocity=${s.velocity.toFixed(2)}, buzzword=${s.buzzwordDensity.toFixed(2)}, dissent=${s.dissent.toFixed(2)}, expert=${s.expert.toFixed(2)}, depth=${s.depth.toFixed(2)}, longevity=${s.longevity.toFixed(2)}, overall=${s.overall.toFixed(2)}`,
    comments ? `Top comments:\n${comments}` : "Top comments: (none)",
  ].join("\n");
}

function renderAggregate(a: ResearchAggregate): string {
  const perPlatform = Object.entries(a.byPlatform)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ") || "(none)";
  return [
    `Posts: ${a.totalPosts}`,
    `By platform: ${perPlatform}`,
    `Avg velocity: ${a.avgVelocity.toFixed(2)}`,
    `Avg dissent: ${a.avgDissent.toFixed(2)}`,
    `Avg expert: ${a.avgExpert.toFixed(2)}`,
    `Avg buzzword density: ${a.avgBuzzword.toFixed(2)}`,
    `Avg comment depth: ${a.avgDepth.toFixed(2)}`,
    `Avg longevity: ${a.avgLongevity.toFixed(2)}`,
  ].join("\n");
}

export const RESEARCH_JSON_SCHEMA = `{
  "summary": string (3-5 sentence plain prose overview),
  "perspectives": {
    "pro_camp": { "main_points": string[], "key_voices": string[], "strength": "strong" | "medium" | "weak" },
    "con_camp": { "main_points": string[], "key_voices": string[], "strength": "strong" | "medium" | "weak" },
    "disagreement_depth": "surface" | "technical" | "philosophical"
  },
  "hype_assessment": {
    "signal": "strong_hype" | "mild_hype" | "balanced" | "under_hyped",
    "reasoning": string (2-3 sentences),
    "red_flags": string[],
    "green_flags": string[]
  },
  "misconceptions": Array<{ "wrong_take": string, "correction": string, "source_quote": string }>
}`;

export function buildResearchPrompt(bundle: ResearchBundle): string {
  const postsBlock = bundle.posts.length
    ? bundle.posts.map(renderPost).join("\n\n")
    : "(no posts found)";
  return [
    `You are a research analyst evaluating hype-vs-substance for the topic: "${bundle.topic}".`,
    `Analyze the evidence below — pre-computed heuristic signals plus sampled top comments from HN / Reddit / Lobsters — and produce a structured JSON report.`,
    ``,
    `## Aggregate signals`,
    renderAggregate(bundle.aggregate),
    ``,
    `## Posts`,
    postsBlock,
    ``,
    `## Output format`,
    `Respond with ONLY valid JSON (no prose, no markdown fences) matching this TypeScript shape:`,
    RESEARCH_JSON_SCHEMA,
    ``,
    `Guidelines:`,
    `- Be concrete. Cite behaviors or phrases you saw in the comments; don't invent sources.`,
    `- If pro/con camps are weak or absent, say so via "strength": "weak" and empty arrays.`,
    `- "signal" should reflect the full picture: high velocity + low dissent + high buzzword density → lean hype; high expert engagement + deep threads + dissent engaged with → lean balanced/under_hyped.`,
    `- "misconceptions" must be claims that other commenters explicitly correct in the data. If none, return [].`,
  ].join("\n");
}
