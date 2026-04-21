# Phase 4 Implementation Plan — LLM `research` Tool (Haiku 4.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the flagship `research` MCP tool that synthesizes a hype-vs-substance report for a topic by combining Phase 2 clustering, Phase 3 heuristic scoring, and a Haiku 4.5 LLM call.

**Architecture:**
1. A thin `LlmClient` interface (`complete(prompt): Promise<string>`) keeps the caller mock-friendly.
2. `createAnthropicClient(config, apiKey, fetchImpl?)` uses raw `fetch` against `https://api.anthropic.com/v1/messages` — no need to bundle the Anthropic SDK (saves deps, avoids Node compat quirks) and keeps DI clean.
3. `runResearch(input)` orchestrates search → per-cluster `getPost` → `scoreItem` → `buildResearchPrompt` → `client.complete` → parse → merge heuristic signals with LLM narrative.
4. `research` registered alongside existing 4 tools. When no client is injected (missing API key), return a graceful error telling the user to set `ANTHROPIC_API_KEY`.

**Tech Stack:** TypeScript ESM, Node 20+ native `fetch`, zod, vitest with injected fake client.

---

## Task 1: Extend `ConfigSchema` for LLM knobs

**Files:**
- Modify: `src/config/schema.ts`
- Test: `tests/config/schema.test.ts` (extend if exists; else skip — covered implicitly)

- [ ] **Step 1: Extend `llm` section with `api_key_env`, `max_tokens`, `temperature`**

```ts
llm: z
  .object({
    provider: z.enum(["anthropic"]).default("anthropic"),
    model: z.string().default("claude-haiku-4-5"),
    api_key_env: z.string().default("ANTHROPIC_API_KEY"),
    max_tokens: z.number().int().positive().max(8000).default(2000),
    temperature: z.number().min(0).max(1).default(0.2),
  })
  .default({}),
```

- [ ] **Step 2: Commit**

```bash
git add src/config/schema.ts
git commit -m "feat(config): add llm api_key_env / max_tokens / temperature knobs"
```

---

## Task 2: Create `LlmClient` interface + Anthropic HTTP implementation

**Files:**
- Create: `src/llm/client.ts`
- Test: `tests/llm/client.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/llm/client.test.ts
import { describe, it, expect, vi } from "vitest";
import { createAnthropicClient } from "../../src/llm/client.js";
import { ConfigSchema } from "../../src/config/schema.js";

describe("createAnthropicClient", () => {
  it("POSTs to Anthropic messages endpoint and extracts text", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "hello" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createAnthropicClient(ConfigSchema.parse({}), "sk-test", {
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const out = await client.complete("prompt-x");
    expect(out).toBe("hello");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.messages[0].content).toBe("prompt-x");
  });

  it("rejects when API returns non-2xx", async () => {
    const fetchSpy = vi.fn(async () => new Response("boom", { status: 500 }));
    const client = createAnthropicClient(ConfigSchema.parse({}), "sk-test", {
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await expect(client.complete("x")).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/llm/client.ts
import type { Config } from "../config/schema.js";

export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

export interface AnthropicClientOptions {
  fetch?: typeof fetch;
}

interface AnthropicMessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

export function createAnthropicClient(
  config: Config,
  apiKey: string,
  options: AnthropicClientOptions = {},
): LlmClient {
  const fetchImpl = options.fetch ?? fetch;
  const { model, max_tokens, temperature } = config.llm;
  return {
    async complete(prompt: string): Promise<string> {
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens,
          temperature,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 400)}`);
      }
      const json = (await res.json()) as AnthropicMessagesResponse;
      const block = json.content?.find((c) => c.type === "text" && typeof c.text === "string");
      return block?.text ?? "";
    },
  };
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/llm/client.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/llm/client.ts tests/llm/client.test.ts
git commit -m "feat(llm): add Anthropic HTTP client with DI fetch"
```

---

## Task 3: Prompt builder

**Files:**
- Create: `src/llm/prompt.ts`
- Test: `tests/llm/prompt.test.ts`

- [ ] **Step 1: Design bundle input shape**

```ts
export interface ResearchBundle {
  topic: string;
  posts: Array<{
    platform: Platform;
    title: string;
    url: string;
    score: number;
    scores: HeuristicScores;
    topComments: string[]; // already trimmed
  }>;
  aggregate: {
    totalPosts: number;
    avgVelocity: number;
    avgDissent: number;
    avgExpert: number;
    avgBuzzword: number;
    byPlatform: Partial<Record<Platform, number>>;
  };
}
```

- [ ] **Step 2: Write test** asserting prompt mentions topic, platform counts, and requests JSON shape.

- [ ] **Step 3: Implement `buildResearchPrompt(bundle)`** producing a single user message that:
  - States the analyst role + task
  - Embeds per-post block (title, url, platform, score, heuristic scores, 1-2 top comments trimmed to ~400 chars each)
  - States aggregate metrics
  - Ends with explicit JSON schema the model must return, plus instruction "Respond with ONLY valid JSON, no prose"

- [ ] **Step 4: Commit**

```bash
git add src/llm/prompt.ts tests/llm/prompt.test.ts
git commit -m "feat(llm): build research prompt bundling heuristics + sampled comments"
```

---

## Task 4: `runResearch` orchestrator

**Files:**
- Create: `src/llm/research.ts`
- Test: `tests/llm/research.test.ts`

- [ ] **Step 1: Define input/output types**

```ts
export interface RunResearchInput {
  topic: string;
  client: LlmClient;
  fetchers: Map<Platform, Fetcher>;
  db: Db;
  config: Config;
  options?: { limit?: number; windowDays?: number; depth?: "normal" | "deep" };
  now?: Date;
}
export interface ResearchResult { /* matches spec §6.1 research output */ }
```

- [ ] **Step 2: Write orchestrator TDD test** with stubbed fetchers + fake `LlmClient` returning canned JSON. Assert:
  - `client.complete` called once with prompt mentioning topic
  - `hype_assessment.velocity`, `expert_engagement`, `dissent_ratio` derived from heuristics (not LLM)
  - `top_posts` populated from search results
  - Returns `confidence: "low"` when 0 posts found

- [ ] **Step 3: Implement**
  1. `searchAll({ query: topic, fetchers, db, options: { limit, windowDays } })`
  2. Pick top N clusters by max post score (N = `depth === "deep" ? 12 : 6`)
  3. For each canonical post: if `getPost` supported → fetch comments → `scoreItem`; else reuse heuristic from item alone with empty comments
  4. Build `ResearchBundle`
  5. `raw = await client.complete(buildResearchPrompt(bundle))`
  6. Parse JSON (strip fencing if present). On parse error, return minimal heuristic-only result with `confidence: "low"`.
  7. Merge: LLM supplies `summary`, `perspectives`, `hype_assessment.signal|reasoning|red_flags|green_flags`, `misconceptions`. Heuristic layer supplies `discussions.*`, `hype_assessment.velocity|expert_engagement|dissent_ratio`, and a computed `confidence` based on post count.

- [ ] **Step 4: Commit**

```bash
git add src/llm/research.ts tests/llm/research.test.ts
git commit -m "feat(llm): research orchestrator merging heuristics + Haiku synthesis"
```

---

## Task 5: Register `research` MCP tool

**Files:**
- Modify: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Extend `ToolDeps` with optional `llm?: LlmClient`**

- [ ] **Step 2: Add zod `ResearchArgs`**

```ts
const ResearchArgs = z.object({
  topic: z.string().min(1),
  windowDays: z.number().int().positive().max(365).optional(),
  depth: z.enum(["normal", "deep"]).optional(),
});
```

- [ ] **Step 3: Add tool listing + handler**

```ts
{
  name: "research",
  description: "Synthesize a hype-vs-substance analysis for a topic using multi-platform signals + LLM narrative.",
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string" },
      windowDays: { type: "integer", minimum: 1, maximum: 365 },
      depth: { type: "string", enum: ["normal", "deep"] },
    },
    required: ["topic"],
  },
}
```

- [ ] **Step 4: Handler**

```ts
async function handleResearch(args, deps): Promise<McpToolResult> {
  if (!deps.llm) {
    return errorResult(
      `research requires an LLM client — set ${deps.config.llm.api_key_env} in env`,
    );
  }
  const result = await runResearch({
    topic: args.topic,
    client: deps.llm,
    fetchers: deps.fetchers,
    db: deps.db,
    config: deps.config,
    options: { windowDays: args.windowDays, depth: args.depth },
    now: deps.now?.(),
  });
  return textResult(result);
}
```

- [ ] **Step 5: Test** that:
  - `listTools()` now lists 5 tools including `research`
  - `callTool("research", {topic: "x"}, { ..., llm: undefined })` returns `isError: true` mentioning env var
  - `callTool("research", {topic: "x"}, { ..., llm: fakeClient })` returns synthesized JSON

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat(mcp): register research tool with LLM DI"
```

---

## Task 6: Wire LLM client into `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Read API key env var by name from config**

```ts
const apiKeyEnv = config.llm.api_key_env;
const apiKey = process.env[apiKeyEnv];
const llm = apiKey ? createAnthropicClient(config, apiKey) : undefined;
if (!llm) {
  process.stderr.write(
    `devresearch-mcp: ${apiKeyEnv} not set — 'research' tool will be disabled\n`,
  );
}
```

- [ ] **Step 2: Pass `llm` through ToolDeps in the `CallToolRequestSchema` handler.**

- [ ] **Step 3: Update ready log line to show tool count (will now be 5).**

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: inject LLM client into MCP server when API key present"
```

---

## Task 7: Final verification

- [ ] `npm test` — expect 88 + new tests all green
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run build` — clean dist
- [ ] Push to main
