# Phase 3 Implementation Plan — Raw MCP Tools + Heuristic Scoring

**Goal:** Expose `search`, `get_post`, `get_user`, `trending` as MCP tools, backed by per-platform fetcher extensions and a heuristic scoring layer (velocity, buzzword density, dissent ratio, expert engagement, comment depth, discussion longevity).

**Architecture:**
- Extend `Fetcher` interface with optional `getPost(id)`, `getUser(username)`, `trending(options)` — each fetcher implements what its API supports.
- New `src/scoring/heuristics.ts` — pure functions taking `NormalizedItem` + comments/user context, returning signal scores in `[0, 1]`.
- New `src/mcp/tools.ts` — registers 4 tools on an MCP `Server`. Each tool takes JSON args, validates via zod, dispatches to orchestrator/fetchers, returns `content: [{ type: "text", text: JSON.stringify(...) }]`.
- `src/index.ts` wires `createMcpTools(...)` into `ListToolsRequestSchema` + `CallToolRequestSchema`.

**Tech stack:** zod (already installed) for tool arg validation, no new deps.

**Files touched:**
- `src/fetchers/types.ts` — add optional interfaces
- `src/fetchers/{hn,reddit,lobsters}.ts` — add getPost/getUser/trending
- `src/scoring/heuristics.ts` — NEW
- `src/mcp/tools.ts` — NEW
- `src/index.ts` — wire tools
- `src/types.ts` — add `PostDetail`, `UserSummary` types
- tests: `tests/fetchers/*.test.ts` new cases; `tests/scoring/heuristics.test.ts`; `tests/mcp/tools.test.ts`

---

## Task 1 — Extend types + Fetcher interface

- `src/types.ts`: add
  ```ts
  export interface PostDetail {
    item: NormalizedItem;
    comments: NormalizedComment[];
  }
  export interface UserSummary {
    platform: Platform;
    username: string;
    karma?: number;
    createdAt?: string;
    about?: string;
  }
  export interface TrendingOptions {
    limit?: number;
    windowDays?: number;
  }
  ```
- `src/fetchers/types.ts`: extend `Fetcher` with optional `getPost?`, `getUser?`, `trending?`.

## Task 2 — HN extras

- `getPost(id)`: Algolia `https://hn.algolia.com/api/v1/items/<id>` which returns tree `{ children: [...] }`. Flatten recursively into `NormalizedComment[]`.
- `getUser(username)`: `https://hn.algolia.com/api/v1/users/<username>` → `{ karma, about, created_at }`.
- `trending({limit, windowDays})`: Algolia search with `tags=front_page` (or `story` + `points>N`). Reuse same mapper.
- Tests: fixtures for item tree + user JSON; assert flattened comments + user karma.

## Task 3 — Reddit extras

- `getPost(id)`: `https://www.reddit.com/comments/<id>.json?raw_json=1` returns `[postListing, commentsListing]`. First = post, second = comment tree (recursive `replies.data.children`).
- `getUser(username)`: `https://www.reddit.com/user/<username>/about.json` → `{ data: { total_karma, created_utc } }`.
- `trending`: `https://www.reddit.com/r/<subs>/hot.json?limit=N` or global `/hot.json`.
- Tests: fixture for nested comment tree; assert depth preserved via `parentId`.

## Task 4 — Lobsters extras

- `getPost(short_id)`: `https://lobste.rs/s/<id>.json` returns `{ story, comments: [...] }` (flat list with `indent_level`, `parent_comment`).
- `getUser(username)`: `https://lobste.rs/u/<username>.json` → `{ karma, created_at }`.
- `trending`: existing `hottest.json`.
- Tests: fixture with 2-level comment thread.

## Task 5 — Heuristics module

`src/scoring/heuristics.ts` — pure functions, all returning `[0,1]`:
- `velocityScore(item, now)` — `score / max(1, hoursSincePost)`, normalized by `tanh(x/10)`.
- `buzzwordDensity(text)` — count hits of `['revolutionary','game-changer','10x','disrupt','paradigm','unprecedented','groundbreaking']` per 100 words; cap at 1.
- `dissentRatio(comments)` — `|topLevel with negative sentiment keywords| / |topLevel|`; keywords `['skeptical','doubt','overhyped','snake oil','wrong','misleading','bullshit','nonsense','disagree']`.
- `expertEngagement(comments)` — fraction of commenters whose author karma ≥ threshold (e.g. 10k for HN, lobsters karma>200).
- `commentDepth(comments)` — max depth / log10(count+1); capped.
- `longevity(item, now)` — hours the post has drawn activity (newest comment ts − post ts) normalized by 48h.

Top-level `scoreItem(detail, now)` returns `{ velocity, buzzwordDensity, dissent, expert, depth, longevity, overall }` where `overall` = weighted average.

## Task 6 — MCP tools module

`src/mcp/tools.ts`:
```ts
export interface ToolDeps { fetchers: Map<Platform, Fetcher>; db: Db; config: Config; }
export function listTools(): Tool[]      // array of MCP tool definitions
export async function callTool(name, args, deps): Promise<{content:[{type:"text",text:string}]}>
```
Tools:
- `search(query, limit?, windowDays?, platforms?)` → delegates to `searchAll`.
- `get_post(platform, id)` → `fetcher.getPost(id)` + `scoreItem`.
- `get_user(platform, username)` → `fetcher.getUser(username)`.
- `trending(platform?, limit?, windowDays?)` → if platform: `fetcher.trending`; else fan-out across all.
All args validated with zod.

## Task 7 — Wire into src/index.ts

- Import `listTools`/`callTool`.
- Register fetchers via `createFetchers(config)`.
- `ListToolsRequestSchema` handler → `{tools: listTools()}`.
- `CallToolRequestSchema` handler → `callTool(name, args, deps)` with error envelope `{isError: true, content:[{type:"text",text:msg}]}`.

## Task 8 — Tests + verification

- Add fixtures for each new endpoint.
- Unit: heuristics (deterministic scores), per-fetcher new methods, tools dispatch.
- Integration: call `callTool("search", ...)` end-to-end with mocked fetchers.
- Run `npm test`, `npm run typecheck`, `npm run build`.
