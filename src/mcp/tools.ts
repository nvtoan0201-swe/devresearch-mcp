import { z } from "zod";
import type { Db } from "../storage/db.js";
import type { Config } from "../config/schema.js";
import type { Fetcher } from "../fetchers/types.js";
import type { Platform } from "../types.js";
import { searchAll } from "../orchestrator.js";
import { scoreItem } from "../scoring/heuristics.js";
import { runResearch } from "../research.js";

export interface ToolDeps {
  fetchers: Map<Platform, Fetcher>;
  db: Db;
  config: Config;
  now?: () => Date;
}

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const PlatformEnum = z.enum(["hn", "reddit", "lobsters"]);

const SearchArgs = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
  windowDays: z.number().int().positive().max(365).optional(),
  platforms: z.array(PlatformEnum).optional(),
});

const GetPostArgs = z.object({
  platform: PlatformEnum,
  id: z.string().min(1),
});

const GetUserArgs = z.object({
  platform: PlatformEnum,
  username: z.string().min(1),
});

const TrendingArgs = z.object({
  platform: PlatformEnum.optional(),
  limit: z.number().int().positive().max(100).optional(),
  windowDays: z.number().int().positive().max(365).optional(),
});

const ResearchArgs = z.object({
  topic: z.string().min(1),
  windowDays: z.number().int().positive().max(365).optional(),
  depth: z.enum(["normal", "deep"]).optional(),
});

export function listTools(): McpToolDefinition[] {
  return [
    {
      name: "search",
      description:
        "Search developer platforms (HN, Reddit, Lobsters) for a query; returns normalized items clustered by URL/title similarity.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          windowDays: {
            type: "integer",
            minimum: 1,
            maximum: 365,
            description: "Recency window",
          },
          platforms: {
            type: "array",
            items: { type: "string", enum: ["hn", "reddit", "lobsters"] },
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_post",
      description:
        "Fetch a single post and its comment tree from a given platform, plus heuristic hype/substance scores.",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["hn", "reddit", "lobsters"] },
          id: { type: "string" },
        },
        required: ["platform", "id"],
      },
    },
    {
      name: "get_user",
      description: "Fetch profile summary (karma, about) for a user on a platform.",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["hn", "reddit", "lobsters"] },
          username: { type: "string" },
        },
        required: ["platform", "username"],
      },
    },
    {
      name: "trending",
      description:
        "Return currently trending posts from one or all platforms (front page / hot / hottest).",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["hn", "reddit", "lobsters"] },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          windowDays: { type: "integer", minimum: 1, maximum: 365 },
        },
      },
    },
    {
      name: "research",
      description:
        "Gather top discussions for a topic across HN/Reddit/Lobsters, compute heuristic hype-vs-substance signals (velocity, buzzword density, expert engagement, dissent, depth, longevity), and return structured data + top comments. The calling LLM synthesizes the narrative.",
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Topic to research" },
          windowDays: { type: "integer", minimum: 1, maximum: 365 },
          depth: { type: "string", enum: ["normal", "deep"] },
        },
        required: ["topic"],
      },
    },
  ];
}

function textResult(value: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(message: string): McpToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

export async function callTool(
  name: string,
  rawArgs: unknown,
  deps: ToolDeps,
): Promise<McpToolResult> {
  try {
    switch (name) {
      case "search":
        return await handleSearch(SearchArgs.parse(rawArgs ?? {}), deps);
      case "get_post":
        return await handleGetPost(GetPostArgs.parse(rawArgs ?? {}), deps);
      case "get_user":
        return await handleGetUser(GetUserArgs.parse(rawArgs ?? {}), deps);
      case "trending":
        return await handleTrending(TrendingArgs.parse(rawArgs ?? {}), deps);
      case "research":
        return await handleResearch(ResearchArgs.parse(rawArgs ?? {}), deps);
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      const details = err.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return errorResult(`Invalid args for ${name}: ${details}`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(`Tool ${name} failed: ${msg}`);
  }
}

async function handleSearch(
  args: z.infer<typeof SearchArgs>,
  deps: ToolDeps,
): Promise<McpToolResult> {
  const selected = args.platforms
    ? new Map(
        args.platforms
          .map((p) => [p, deps.fetchers.get(p)] as const)
          .filter((e): e is [Platform, Fetcher] => e[1] !== undefined),
      )
    : deps.fetchers;
  const result = await searchAll({
    query: args.query,
    fetchers: selected,
    db: deps.db,
    options: { limit: args.limit, windowDays: args.windowDays },
    now: deps.now?.(),
  });
  const clustered = buildClusteredView(result.items, result.clusters);
  return textResult({
    query: args.query,
    count: result.items.length,
    clusterCount: clustered.length,
    errors: result.errors,
    items: result.items,
    clusters: clustered,
  });
}

function buildClusteredView(
  items: Array<{ id: string; platform: Platform; title: string; url: string; score: number }>,
  clusters: Map<string, string>,
): Array<{ id: string; members: string[]; platforms: Platform[] }> {
  const byCluster = new Map<string, { members: string[]; platforms: Set<Platform> }>();
  for (const it of items) {
    const cid = clusters.get(it.id);
    if (!cid) continue;
    const g = byCluster.get(cid) ?? { members: [], platforms: new Set() };
    g.members.push(it.id);
    g.platforms.add(it.platform);
    byCluster.set(cid, g);
  }
  return [...byCluster.entries()].map(([id, g]) => ({
    id,
    members: g.members,
    platforms: [...g.platforms],
  }));
}

async function handleGetPost(
  args: z.infer<typeof GetPostArgs>,
  deps: ToolDeps,
): Promise<McpToolResult> {
  const fetcher = deps.fetchers.get(args.platform);
  if (!fetcher) return errorResult(`Platform not enabled: ${args.platform}`);
  if (!fetcher.getPost) {
    return errorResult(`Platform ${args.platform} does not support get_post`);
  }
  const detail = await fetcher.getPost(args.id);
  const scores = scoreItem(detail, { now: deps.now?.() });
  return textResult({
    item: detail.item,
    commentCount: detail.comments.length,
    scores,
    comments: detail.comments,
  });
}

async function handleGetUser(
  args: z.infer<typeof GetUserArgs>,
  deps: ToolDeps,
): Promise<McpToolResult> {
  const fetcher = deps.fetchers.get(args.platform);
  if (!fetcher) return errorResult(`Platform not enabled: ${args.platform}`);
  if (!fetcher.getUser) {
    return errorResult(`Platform ${args.platform} does not support get_user`);
  }
  const user = await fetcher.getUser(args.username);
  return textResult(user);
}

async function handleTrending(
  args: z.infer<typeof TrendingArgs>,
  deps: ToolDeps,
): Promise<McpToolResult> {
  const options = { limit: args.limit, windowDays: args.windowDays };
  if (args.platform) {
    const fetcher = deps.fetchers.get(args.platform);
    if (!fetcher) return errorResult(`Platform not enabled: ${args.platform}`);
    if (!fetcher.trending) {
      return errorResult(`Platform ${args.platform} does not support trending`);
    }
    const items = await fetcher.trending(options);
    return textResult({ platform: args.platform, count: items.length, items });
  }

  const errors: Partial<Record<Platform, string>> = {};
  const results = await Promise.all(
    [...deps.fetchers.entries()].map(async ([p, f]) => {
      if (!f.trending) return { platform: p, items: [] };
      try {
        const items = await f.trending(options);
        return { platform: p, items };
      } catch (err) {
        errors[p] = err instanceof Error ? err.message : String(err);
        return { platform: p, items: [] };
      }
    }),
  );
  const merged = results.flatMap((r) => r.items);
  return textResult({ count: merged.length, errors, items: merged });
}

async function handleResearch(
  args: z.infer<typeof ResearchArgs>,
  deps: ToolDeps,
): Promise<McpToolResult> {
  const result = await runResearch({
    topic: args.topic,
    fetchers: deps.fetchers,
    db: deps.db,
    config: deps.config,
    options: { windowDays: args.windowDays, depth: args.depth },
    now: deps.now?.(),
  });
  return textResult(result);
}
