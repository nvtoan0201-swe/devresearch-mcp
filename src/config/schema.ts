import { z } from "zod";

export const ConfigSchema = z.object({
  sources: z
    .object({
      enabled: z
        .array(z.enum(["hn", "reddit", "lobsters"]))
        .default(["hn", "reddit", "lobsters"]),
      reddit: z
        .object({
          subreddits: z
            .array(z.string().min(1))
            .default([
              "programming",
              "rust",
              "golang",
              "javascript",
              "typescript",
              "MachineLearning",
              "LocalLLaMA",
              "webdev",
              "ExperiencedDevs",
              "cpp",
            ]),
        })
        .default({}),
    })
    .default({}),
  cache: z
    .object({
      ttl_hours: z.number().int().positive().default(24),
      path: z.string().default("~/.devresearch-mcp/cache.db"),
    })
    .default({}),
  llm: z
    .object({
      provider: z.enum(["anthropic"]).default("anthropic"),
      model: z.string().default("claude-haiku-4-5"),
    })
    .default({}),
  filters: z
    .object({
      drop_patterns: z
        .array(z.string())
        .default(["^Show HN: My .*", "\\[HIRING\\]", "\\[JOB\\]"]),
    })
    .default({}),
  hype_scoring: z
    .object({
      hype_threshold: z.number().min(0).max(100).default(70),
      substance_threshold: z.number().min(0).max(100).default(60),
      buzzwords: z
        .array(z.string())
        .default(["game changer", "revolutionary", "mind-blowing", "next-gen", "disrupt"]),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
