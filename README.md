# devresearch-mcp

[![npm version](https://img.shields.io/npm/v/devresearch-mcp.svg)](https://www.npmjs.com/package/devresearch-mcp)

Cross-platform developer research MCP server — searches **Hacker News**, **Reddit**, and **Lobsters** in one call, clusters duplicate discussions, scores posts on 7 heuristic dimensions, and uses Anthropic Haiku to synthesize a **hype-vs-substance** report.

## What it does

- **Unified search** across HN / Reddit / Lobsters with cross-platform clustering (same story → one result).
- **Heuristic scoring** of individual posts: velocity, dissent ratio, expert engagement, buzzword density, comment depth, longevity, and a composite overall score.
- **Flagship `research` tool**: given a topic, pulls top discussions, computes aggregate signals, and asks Claude Haiku to synthesize pros/cons, red/green flags, and misconceptions.
- **Works offline after seeding**: SQLite-backed cache at `~/.devresearch-mcp/cache.db` keeps repeated queries snappy and lets you browse past research without network.

## Install (for Claude Code users)

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "devresearch": {
      "command": "npx",
      "args": ["-y", "devresearch-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

The `research` tool requires `ANTHROPIC_API_KEY`. Other tools (`search`, `get_post`, `get_user`, `trending`) work without it.

## Local development

```bash
git clone https://github.com/toannd/devresearch-mcp.git
cd devresearch-mcp
npm install
npm run build
npm test
```

Link for local MCP wiring:

```bash
npm link
# then in your MCP config use "command": "devresearch-mcp"
```

## Configuration

Optional config at `~/.devresearch-mcp/config.toml` (override path with `DEVRESEARCH_CONFIG`):

```toml
[sources]
enabled = ["hn", "reddit", "lobsters"]

[sources.reddit]
subreddits = ["programming", "rust", "golang", "javascript", "LocalLLaMA"]

[cache]
ttl_hours = 24
path = "~/.devresearch-mcp/cache.db"

[llm]
provider   = "anthropic"
model      = "claude-haiku-4-5"
api_key_env = "ANTHROPIC_API_KEY"
max_tokens = 2000
temperature = 0.2

[filters]
drop_patterns = ["^Show HN: My .*", "\\[HIRING\\]", "\\[JOB\\]"]

[hype_scoring]
hype_threshold      = 70
substance_threshold = 60
buzzwords = ["game changer", "revolutionary", "mind-blowing", "next-gen", "disrupt"]
```

All sections are optional — sensible defaults ship with the package.

## Environment variables

| Var | Purpose | Required for |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key | `research` tool |
| `DEVRESEARCH_CONFIG` | Override config path | Optional |

## Tools

### `search`

Search all enabled platforms for a query; returns normalized items clustered by URL/title similarity.

**Input:**
```json
{
  "query": "bun runtime",
  "limit": 20,
  "windowDays": 30,
  "platforms": ["hn", "reddit"]
}
```

**Output (abridged):**
```json
{
  "query": "bun runtime",
  "count": 18,
  "clusterCount": 12,
  "items": [
    { "id": "hn_42", "platform": "hn", "title": "Bun 1.2 released", "url": "https://bun.sh/blog/bun-v1.2", "score": 412, "ts": "2026-04-18T12:00:00Z" }
  ],
  "clusters": [
    { "id": "hn_42", "members": ["hn_42", "reddit_abc"], "platforms": ["hn", "reddit"] }
  ]
}
```

### `get_post`

Fetch a single post with its comment tree plus heuristic scores.

**Input:** `{ "platform": "hn", "id": "42" }`

**Output (abridged):**
```json
{
  "item": { "id": "hn_42", "title": "...", "score": 412 },
  "commentCount": 187,
  "scores": {
    "velocity": 0.82, "dissent": 0.31, "expert": 0.54,
    "buzzwordDensity": 0.08, "depth": 0.66, "longevity": 0.40,
    "overall": 0.61
  },
  "comments": [ { "id": "hn_43", "text": "...", "score": 12, "depth": 0 } ]
}
```

### `get_user`

Profile summary (karma, about) for a user on a platform.

**Input:** `{ "platform": "hn", "username": "pg" }`

**Output:**
```json
{ "platform": "hn", "username": "pg", "karma": 155000, "about": "..." }
```

### `trending`

Currently trending posts — front page (HN), `/r/<sub>/hot` (Reddit), `/hottest` (Lobsters). Omit `platform` to fan out.

**Input:** `{ "platform": "hn", "limit": 10 }`

**Output:**
```json
{ "platform": "hn", "count": 10, "items": [ /* NormalizedItem[] */ ] }
```

### `research` (flagship)

Synthesize a hype-vs-substance report on a topic across all enabled platforms.

**Input:**
```json
{ "topic": "rust async traits", "windowDays": 60, "depth": "normal" }
```

`depth`: `"normal"` (top 6 posts) or `"deep"` (top 12).

**Output:**
```json
{
  "topic": "rust async traits",
  "summary": "Async traits stabilized in 1.75 — community sentiment is cautiously positive with ongoing debates about dyn-compatible variants.",
  "discussions": {
    "total": 34,
    "by_platform": { "hn": 12, "reddit": 18, "lobsters": 4 },
    "top_posts": [
      { "title": "...", "url": "...", "score": 812, "platform": "hn", "top_comment_preview": "The ergonomics are finally..." }
    ]
  },
  "perspectives": {
    "pro_camp": { "main_points": ["unblocks many libraries"], "key_voices": ["withoutboats"], "strength": "strong" },
    "con_camp": { "main_points": ["dyn limitations"], "key_voices": [], "strength": "medium" },
    "disagreement_depth": "technical"
  },
  "hype_assessment": {
    "signal": "balanced",
    "reasoning": "High velocity and expert engagement; substantive technical critique dominates.",
    "red_flags": [],
    "green_flags": ["real benchmarks", "RFC-backed decisions"],
    "velocity": 0.72,
    "expert_engagement": 0.58,
    "dissent_ratio": 0.41
  },
  "misconceptions": [
    { "wrong_take": "Async traits are fully equivalent to sync traits", "correction": "dyn-compatibility requires manual `dyn` erasure", "source_quote": "you still can't use them in trait objects..." }
  ],
  "confidence": "high"
}
```

## Heuristic scoring

Seven signals in `[0, 1]`, all computed locally without LLM calls:

| Signal | What it measures |
|---|---|
| `velocity` | Score growth rate per hour since posting |
| `dissent` | Fraction of comments expressing disagreement |
| `expert` | Comment share from high-karma / domain authors |
| `buzzwordDensity` | Hype-word frequency in title + top comments |
| `depth` | Median reply-thread depth (deeper = more substance) |
| `longevity` | Score retention over time (sustained interest) |
| `overall` | Weighted composite — high substance, low hype |

`research` uses heuristic signals as the **ground truth** for numeric fields; the LLM only produces narrative (summary, perspectives, red/green flags, misconceptions).

## Architecture

```
src/
  index.ts              MCP stdio server entry
  config/               TOML loader + zod schema
  fetchers/             Per-platform HTTP clients (hn, reddit, lobsters)
  normalize/            Map raw API shapes → NormalizedItem / PostDetail
  storage/              SQLite cache (better-sqlite3-free, hand-rolled)
  orchestrator.ts       Cross-platform search + clustering
  scoring/              Heuristic signal computation
  llm/                  Anthropic client + prompt builder + research orchestrator
  mcp/                  Tool definitions + dispatch
```

Each fetcher is isolated — adding a new source means implementing the `Fetcher` interface and registering in `src/fetchers/registry.ts`. No shared mutable state; all composition through dependency injection (see `ToolDeps`).

## Limitations

- Reddit uses the public JSON endpoints — no OAuth, rate limits apply.
- Cross-platform clustering uses URL normalization + title n-gram similarity; works well for canonical links, weaker for title-only discussions.
- The `research` tool makes **one** LLM call per invocation (cost-controlled); it does not loop or self-critique.
- `ANTHROPIC_API_KEY` must be set for `research`; other tools degrade gracefully.

## License

MIT — see [LICENSE](./LICENSE).
