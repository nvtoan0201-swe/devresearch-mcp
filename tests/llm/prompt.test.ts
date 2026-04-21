import { describe, it, expect } from "vitest";
import {
  buildResearchPrompt,
  type ResearchBundle,
} from "../../src/llm/prompt.js";
import type { HeuristicScores } from "../../src/scoring/heuristics.js";

function scores(overrides: Partial<HeuristicScores> = {}): HeuristicScores {
  return {
    velocity: 0.5,
    buzzwordDensity: 0.1,
    dissent: 0.2,
    expert: 0.3,
    depth: 0.4,
    longevity: 0.5,
    overall: 0.5,
    ...overrides,
  };
}

const baseBundle: ResearchBundle = {
  topic: "bun runtime",
  posts: [
    {
      platform: "hn",
      title: "Bun 1.2 release",
      url: "https://bun.sh/blog/1-2",
      score: 450,
      scores: scores({ velocity: 0.9, buzzwordDensity: 0.4 }),
      topComments: [
        "This is pretty revolutionary.",
        "Skeptical — Node.js is still more mature for production.",
      ],
    },
    {
      platform: "reddit",
      title: "Thoughts on Bun in prod?",
      url: "https://reddit.com/r/node/x",
      score: 120,
      scores: scores({ dissent: 0.6, expert: 0.5 }),
      topComments: ["Been using Bun 6 months in prod, works fine."],
    },
  ],
  aggregate: {
    totalPosts: 2,
    avgVelocity: 0.7,
    avgDissent: 0.4,
    avgExpert: 0.4,
    avgBuzzword: 0.25,
    avgDepth: 0.4,
    avgLongevity: 0.5,
    byPlatform: { hn: 1, reddit: 1 },
  },
};

describe("buildResearchPrompt", () => {
  it("embeds topic, aggregate, and per-post blocks", () => {
    const prompt = buildResearchPrompt(baseBundle);
    expect(prompt).toContain(`"bun runtime"`);
    expect(prompt).toContain("Posts: 2");
    expect(prompt).toContain("hn=1");
    expect(prompt).toContain("reddit=1");
    expect(prompt).toContain("Bun 1.2 release");
    expect(prompt).toContain("Thoughts on Bun in prod?");
    expect(prompt).toContain("revolutionary");
    expect(prompt).toContain("Skeptical");
  });

  it("requests JSON-only output with the documented shape", () => {
    const prompt = buildResearchPrompt(baseBundle);
    expect(prompt).toMatch(/ONLY valid JSON/);
    expect(prompt).toContain("hype_assessment");
    expect(prompt).toContain("perspectives");
    expect(prompt).toContain("misconceptions");
  });

  it("handles zero posts gracefully", () => {
    const empty: ResearchBundle = {
      topic: "obscure thing",
      posts: [],
      aggregate: {
        totalPosts: 0,
        avgVelocity: 0,
        avgDissent: 0,
        avgExpert: 0,
        avgBuzzword: 0,
        avgDepth: 0,
        avgLongevity: 0,
        byPlatform: {},
      },
    };
    const prompt = buildResearchPrompt(empty);
    expect(prompt).toContain("(no posts found)");
    expect(prompt).toContain("Posts: 0");
  });

  it("truncates long comments to ~400 chars", () => {
    const longText = "a".repeat(1000);
    const b: ResearchBundle = {
      ...baseBundle,
      posts: [
        {
          ...baseBundle.posts[0],
          topComments: [longText],
        },
      ],
    };
    const prompt = buildResearchPrompt(b);
    expect(prompt).toContain("…");
    expect(prompt).not.toContain("a".repeat(500));
  });
});
