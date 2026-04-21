# devresearch-mcp — Design Spec

**Date**: 2026-04-21
**Status**: Draft (pre-implementation)
**Owner**: @nvtoan
**Goal**: Contribute to MCP community

---

## 1. Summary

A Model Context Protocol (MCP) server that does cross-platform tech research across developer communities (Hacker News, Reddit, Lobsters) with a signature feature: **automatic hype-vs-substance assessment** baked into every synthesized analysis.

Unlike existing research MCPs that are platform-siloed (Reddit-only, HN-only) or broad but shallow (Trend-Pulse covers 37 sources including TikTok, crypto), devresearch-mcp is **dev-only + cross-platform + comment-intelligent**.

The tool surface exposes 6 tools: synthesized analysis (`research`, `compare`), raw data access (`search`, `get_post`, `get_user`), and browse (`trending`). Synthesized tools automatically surface conflicting opinions, expert voices, common misconceptions, and a hype signal — in a single output.

---

## 2. Problem

Developers face two daily pain points:

1. **Feed fatigue**: 30-60 minutes/day across HN + Reddit + X + Lobsters; ~80% is noise (job posts, clickbait, cross-post duplicates).
2. **Comment gold ignored**: the real value lives in comments (expert corrections, production war stories, dissenting takes), but nobody has time to read 500 comments per thread.

A deeper problem follows: **hype-vs-substance confusion**. When a technology trends (Bun, LangChain, a new ORM), is it genuinely useful or just hype? Today, dev answers this by reading comments manually, or guessing. Neither scales.

Existing MCPs solve pieces:
- **Reddit Research MCP** — deep Reddit analysis, but Reddit-only
- **hn-companion-mcp** — HN comment summarization, but HN-only
- **Trend-Pulse** — 37 broad sources with trend velocity, but no comment analysis, no hype verdict, not dev-focused
- **Sentiment MCPs** — ±/neutral scores, but no stance decomposition

None combine **cross-platform + dev-focused + comment-intelligence + hype-verdict**. That is the gap.

---

## 3. Goals & Non-Goals

### Goals (v0.1)
- Provide full research capability across HN + Reddit + Lobsters from Claude Code
- Automatically include hype assessment in synthesized outputs
- Decompose comment opinions into pro/con/misconception structure
- Support both synthesized analysis and raw data drill-down workflows
- Zero-auth install for data sources (no Reddit/HN API keys required)
- Publish to npm with `npx` install path

### Non-Goals (v0.1)
- X/Twitter integration (API cost prohibitive)
- YouTube, podcast, TikTok, general news
- Non-dev content (politics, entertainment, crypto-general)
- Public hosted service (local MCP only)
- Multi-user features, auth, sharing
- Real-time streaming
- Historical trend analytics deeper than 30 days (deferred to v0.2)
- Web dashboard

---

## 4. Positioning

### One-sentence pitch
> *"Like Reddit Research MCP and hn-companion combined, but cross-platform — with a signature twist: it also tells you if the hype is real."*

### Differentiation matrix

| Capability | Reddit Research | hn-companion | Trend-Pulse | **devresearch-mcp** |
|---|---|---|---|---|
| Cross-platform | ❌ Reddit only | ❌ HN only | ✅ 37 sources | ✅ dev-curated |
| Dev-focused | ❌ | ~ (HN is dev-heavy) | ❌ broad | ✅ strict |
| Comment intelligence | ~ partial | ✅ HN only | ❌ | ✅ cross-platform |
| Stance decomposition (pro/con/misconception) | ❌ | ❌ summary only | ❌ | ✅ |
| Hype-vs-substance verdict | ❌ | ❌ | ❌ | ✅ **automatic** |
| Raw drill-down (search, get_post, get_user) | ✅ | ✅ | ❌ | ✅ |
| Head-to-head comparison | ❌ | ❌ | ❌ | ✅ v0.2 |

---

## 5. Architecture

```
┌──────────────────────────────────────────────────┐
│          MCP Server (TypeScript, Node)           │
│          @modelcontextprotocol/sdk               │
└─────────────────────┬────────────────────────────┘
                      │
     ┌────────────────┼─────────────────┐
     │                │                 │
┌────▼─────┐    ┌─────▼─────┐    ┌──────▼──────┐
│ FETCHERS │    │  STORAGE  │    │   INTEL     │
│          │    │           │    │             │
│ HN       │    │ SQLite    │    │ Heuristics  │
│ Reddit   │    │ (BYO)     │    │ + LLM calls │
│ Lobsters │    │           │    │ (BYOK)      │
└──────────┘    └───────────┘    └─────────────┘
```

**Flow per query**:
1. Parse request (topic / query / URL)
2. Check SQLite cache — if fresh (<24h), return cached
3. Otherwise: fan-out fetch across sources
4. Normalize + dedup (MinHash on URL + title) → cluster
5. Compute heuristic metrics (velocity, buzzword count, dissent ratio, expert engagement)
6. If synthesized tool: prompt LLM with pre-computed metrics + comment samples → structured JSON output
7. Cache result (SQLite, 24h TTL)
8. Return to Claude

### Key components

**Fetchers** — one module per source. Same interface: `fetch(query|topic, options) → NormalizedItem[]`. Rate-limit aware with exponential backoff.

**Storage** — SQLite via `better-sqlite3`. Embedded, zero-server, per-user file at `~/.devresearch-mcp/cache.db`.

**Intel Engine** — hybrid:
- **Heuristic layer** (no LLM): pattern counts, velocity math, comment depth ratio, buzzword density, dissent ratio
- **LLM layer** (Haiku 4.5 default): narrative synthesis, stance decomposition, verdict text — only for `research` and `compare`

**MCP Interface** — tool manifest exposed via stdio transport.

---

## 6. Tool Surface (6 tools)

### Synthesized (signature, LLM-powered)

#### `research(topic, window?="30d", depth?="normal"|"deep")`
The flagship tool. Full picture in one call.

```typescript
{
  topic: string,
  summary: string,              // 3-5 sentence overview
  discussions: {
    total: number,
    by_platform: { hn, reddit, lobsters },
    top_posts: Array<{title, url, score, platform, top_comment_preview}>
  },
  perspectives: {
    pro_camp: { main_points, key_voices, strength },
    con_camp: { main_points, key_voices, strength },
    disagreement_depth: "surface" | "technical" | "philosophical"
  },
  hype_assessment: {
    signal: "strong_hype" | "mild_hype" | "balanced" | "under_hyped",
    reasoning: string,          // 2-3 sentence explanation
    red_flags: string[],
    green_flags: string[],
    velocity: "peaking" | "rising" | "plateau" | "decaying",
    expert_engagement: number,  // 0-1 ratio
    dissent_ratio: number       // 0-1 ratio
  },
  misconceptions: Array<{wrong_take, correction, source_quote}>,
  confidence: "high" | "medium" | "low"
}
```

#### `compare(topic_a, topic_b, dimension?)` — v0.2 target
Head-to-head analysis. Same structure but paired, plus `recommendation`.

### Raw (flexible, zero LLM)

#### `search(query, platforms?, window?="30d", limit?=20, sort?)`
Raw post list across platforms. No synthesis. Users/Claude read and decide.

#### `get_post(url_or_id)`
Full post + all top-level comments + reply tree + inline heuristic `hype_signal` per comment (no LLM).

#### `get_user(username, platform, window?="all")`
User profile + karma + recent posts + dominant topics. Useful for vetting expert voices.

### Browse

#### `trending(window?="7d", tags?, limit?=20)`
Current trending items with inline `hype_signal` (heuristic, no LLM).

---

## 7. Data Sources (v0.1)

| Source | Auth | Access Method | Rate Limit | Notes |
|---|---|---|---|---|
| **Hacker News** | None | Algolia Search API (`hn.algolia.com`) + Firebase (`hacker-news.firebaseio.com`) | Unlimited (reasonable use) | Best for keyword search + time-window queries |
| **Reddit** | None | `old.reddit.com/*/.json` | ~60 req/min unauth | Watchlist: r/programming, r/rust, r/golang, r/javascript, r/typescript, r/MachineLearning, r/LocalLLaMA, r/webdev, r/ExperiencedDevs, r/cpp. User-configurable. |
| **Lobsters** | None | RSS + HTML parse for comments | Polite crawl | Smaller volume but high signal |

**Deferred to v0.2+**: GitHub trending, arxiv cs.*, PyPI/npm download trends, curated dev engineering blogs (Cloudflare, Vercel, Anthropic, etc.) via RSS.

**Deferred indefinitely**: X/Twitter (API cost + hostile TOS), YouTube, generic news.

---

## 8. Hype Detection Approach

Hybrid heuristic + LLM. Split by cost.

### Heuristic signals (cheap, always computed)
- **Velocity**: upvote rate per hour over first 24h
- **Buzzword density**: count of hype markers in post/comments ("game changer", "revolutionary", "mind-blowing", "next-gen", "disrupt") per 1000 words
- **Comment depth ratio**: avg comment length / top comment score (long thoughtful comments → substance)
- **Dissent ratio**: % of top-N comments expressing concerns, counter-arguments, or alternatives. Detect via simple lexical heuristics for v0.1 (keywords like "but", "however", "problem is", "issue is", "downside").
- **Cross-post cluster density**: how tightly duplicated across platforms in 24h (tight clustering + high velocity = astroturf suspicion)
- **Expert engagement ratio**: % of top comments from users with karma > threshold (HN karma > 1000, Reddit > 5000)
- **Discussion longevity**: days between first and most recent top-level comment (long tail = substance, burst-then-silent = hype)

### LLM-powered signals (expensive, only in `research`/`compare`)
- **Misconceptions extraction**: "list claims in comments that other commenters correct"
- **Production report detection**: "identify comments sharing real production usage (6+ months)"
- **Verdict narrative**: 2-3 sentence reasoned assessment combining heuristics

### Composite scoring
```
hype_score = f(velocity, buzzword_density, cross_post_density, low_dissent, short_longevity)
substance_score = f(expert_engagement, comment_depth, dissent_ratio, production_reports, longevity)

signal =
  strong_hype       if hype >= 70 and substance <= 40
  mild_hype         if hype >= 50 and substance < hype
  balanced          if |hype - substance| < 20
  under_hyped       if substance >= 60 and hype < 40
```

Formula exposed in config — users can tune weights.

---

## 9. Storage & Caching

**Engine**: SQLite via `better-sqlite3` (synchronous, fast, embedded).

**Location**: `~/.devresearch-mcp/cache.db` (override via env var).

**Schema (v0.1)**:
```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE,
  weight REAL DEFAULT 1.0,
  last_poll TEXT
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,           -- {source}_{external_id}
  source_id INTEGER,
  url TEXT,
  title TEXT,
  author TEXT,
  score INTEGER,
  ts TEXT,
  cluster_id TEXT,
  raw_json TEXT,                  -- full payload
  fetched_at TEXT
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  author TEXT,
  author_karma INTEGER,
  text TEXT,
  parent_id TEXT,
  score INTEGER,
  ts TEXT
);

CREATE TABLE clusters (
  id TEXT PRIMARY KEY,
  canonical_url TEXT,
  canonical_title TEXT,
  topic_tags TEXT,                -- JSON array
  first_seen TEXT,
  last_updated TEXT
);

CREATE TABLE analyses (
  id INTEGER PRIMARY KEY,
  kind TEXT,                      -- "research" | "compare"
  key TEXT UNIQUE,                -- e.g. "research:bun:30d"
  content_json TEXT,
  computed_at TEXT,
  ttl_seconds INTEGER DEFAULT 86400
);

CREATE INDEX idx_items_cluster ON items(cluster_id);
CREATE INDEX idx_items_ts ON items(ts);
CREATE INDEX idx_comments_item ON comments(item_id);
CREATE INDEX idx_analyses_key ON analyses(key);
```

**TTL policy**:
- Raw items: 24h (re-fetch on expiry)
- Analyses: 24h (re-compute)
- Expired rows: lazy delete on next access

---

## 10. LLM Usage & Cost

**Provider**: Anthropic, BYOK via `ANTHROPIC_API_KEY` env var.

**Default model**: `claude-haiku-4-5` (adequate quality, ~3x cheaper than Sonnet).

**When LLM is called**:
- `research(topic)` — 1 call, structured JSON output (prompt contains pre-computed metrics + sampled comments)
- `compare(a, b)` — 1 call
- **No LLM**: `search`, `get_post`, `get_user`, `trending` (heuristic-only)

**Cost estimate per `research` call**:
- Input: ~4000 tokens (metrics summary + ~30 sample comments, truncated)
- Output: ~1500 tokens (structured JSON)
- Haiku 4.5 pricing applied → roughly ~$0.005-0.01 per uncached call
- With 24h cache, typical user triggers <20 unique calls/day → **<$0.20/day**

**Prompt strategy**:
- Single prompt per tool, emits strict JSON (validated via zod)
- Pre-computed heuristic metrics passed as structured input, NOT asked to compute
- LLM's job: narrative synthesis + stance extraction + verdict text
- Fallback: if LLM output fails JSON validation, retry once with repair prompt; return degraded result if still fails

---

## 11. Configuration

**File**: `~/.devresearch-mcp/config.toml` (auto-created on first run with defaults)

```toml
[sources]
enabled = ["hn", "reddit", "lobsters"]

[sources.reddit]
subreddits = [
  "programming", "rust", "golang", "javascript", "typescript",
  "MachineLearning", "LocalLLaMA", "webdev", "ExperiencedDevs", "cpp"
]

[cache]
ttl_hours = 24
path = "~/.devresearch-mcp/cache.db"

[llm]
provider = "anthropic"
model = "claude-haiku-4-5"

[filters]
drop_patterns = ["^Show HN: My .*", "\\[HIRING\\]", "\\[JOB\\]"]

[hype_scoring]
hype_threshold = 70
substance_threshold = 60
buzzwords = ["game changer", "revolutionary", "mind-blowing", "next-gen", "disrupt"]
```

**Claude Code `.mcp.json`**:
```json
{
  "mcpServers": {
    "devresearch": {
      "command": "npx",
      "args": ["-y", "@your-org/devresearch-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

---

## 12. MVP Scope (v0.1)

**Timeline**: 2 weeks part-time (realistic).

**Shipped tools** (5 of 6):
- ✅ `search`
- ✅ `get_post`
- ✅ `get_user`
- ✅ `trending`
- ✅ `research`
- ⏸️ `compare` — defer to v0.2 (200 LOC, easy add once `research` stable)

**Sources**: HN, Reddit, Lobsters only.

**Storage**: SQLite with the schema above.

**LLM**: Anthropic Haiku 4.5 only. No multi-provider abstraction in v0.1.

**Testing**:
- Unit tests for fetchers (golden-file against fixture JSON)
- Integration tests for heuristic scoring (20 manually-labeled threads as eval set)
- No automated test for LLM quality; manual spot-check pre-release

**Docs**: README with `.mcp.json` snippet, 3-command quickstart, 2 example queries.

**Distribution**: Publish to npm as `@<your-org>/devresearch-mcp` (org name TBD).

**LOC budget**: ~850-1000 LOC TypeScript.

---

## 13. Roadmap

### v0.2 (post-MVP, reactive to feedback)
- `compare(a, b, dimension?)` tool
- GitHub trending + arxiv cs + npm/PyPI trending sources
- Curated dev engineering blogs RSS (Cloudflare, Vercel, Anthropic, OpenAI, Stripe)
- Embedding-based clustering (replace MinHash)
- Eval suite in CI

### v0.3 (if traction justifies)
- Historical trend storage (track hype_score over time for topics)
- Watchlist + scheduled polling + alerts
- Multi-LLM provider (OpenAI, local Ollama)
- X/Twitter via RSS-Bridge (optional opt-in, user hosts their own bridge)

### Future (open-ended)
- Web dashboard (complement to MCP)
- VN dev tech sources expansion (Viblo, Tinhte tech, VNExpress số hóa, Kipalog)
- Paid hosted variant (if traction)

---

## 14. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| LLM cost surprise for power users | Medium | Aggressive 24h cache; heuristic-only fallback for raw tools; show estimated cost in README |
| Hype scoring formula subjective | Medium | Expose formula in config; show component breakdown in output; allow weight tuning |
| Reddit API siết thêm | Medium | Fallback to HTML scrape of old.reddit.com; longer cache TTL; document degraded mode |
| Topic disambiguation ("Bun" = runtime or food?) | Low | Context-aware search; if low-confidence, ask Claude to clarify |
| LLM JSON output malformed | Low | Zod schema validation + 1 repair retry; degraded response if fails |
| Competition (Trend-Pulse adds `--dev-only`) | Medium | Ship fast, brand strong, niche taxonomy is hard to copy wholesale |
| User abandons mid-build (hype of my own) | High | MVP scope ruthless; 1-week checkpoint; ship v0.1 even if not perfect |
| Astroturf/SEO-spam detection false negatives | Low | Flag `low_confidence` when data volume low; explicit note in README |

---

## 15. Success Metrics

**v0.1 (2 weeks post-launch)**:
- Published to npm, installable via 1 `.mcp.json` entry
- 5 real users trying it (friends/Discord/Reddit feedback)
- Personal daily-driver for 1 week without fatal bugs
- README + demo recording

**v0.2 (1 month post-launch)**:
- 50+ GitHub stars
- 1+ feature PR from external contributor
- Listed on pulsemcp / mcpmarket / glama directories

**v1.0 (3-6 months, stretch)**:
- 500+ GitHub stars
- Mentioned in an MCP-focused blog post/newsletter
- Used in 1+ downstream project (agent, pipeline)

---

## 16. Open Questions

- **Org name / npm scope**: `@your-org` placeholder — need real decision (personal scope vs. new org).
- **Exact LLM prompt design for `research`**: needs iteration; track first prompt version in repo, evolve via eval set.
- **Lobsters comment fetch approach**: RSS lacks reply trees — need to confirm if HTML scrape acceptable per Lobsters policy; if not, drop to headline-only from this source.
- **Watchlist UX**: reserved for v0.3 but placeholder in schema/config to avoid later migration pain?

---

## Appendix A — Example Output (for reference)

Sample `research("bun runtime")` output (abbreviated):

```json
{
  "topic": "bun runtime",
  "summary": "Bun is a JavaScript runtime positioned as Node alternative, emphasizing startup speed, built-in tooling (bundler, test runner, package manager), and Zig-based performance. Discussion across HN, r/javascript, r/typescript, Lobsters spans 8 months with sustained engagement.",
  "discussions": {
    "total": 49,
    "by_platform": {"hn": 12, "reddit": 34, "lobsters": 3},
    "top_posts": [
      {"title": "Bun 1.2 is out", "url": "...", "score": 892, "platform": "hn"}
    ]
  },
  "perspectives": {
    "pro_camp": {
      "main_points": [
        "Startup time and ESM parsing measurably faster than Node",
        "bun install 10-20x faster than npm in benchmarks",
        "Built-in TS/test/bundler reduces tool fatigue"
      ],
      "key_voices": [
        {"user": "gwr", "karma": 120000, "platform": "hn", "quote": "Migrated 3 production services, 0 regrets"}
      ],
      "strength": "strong"
    },
    "con_camp": {
      "main_points": [
        "Production stability unproven at scale >100k req/s",
        "npm ecosystem compat gaps in edge cases (~5% packages)",
        "Zig internals harder to debug when issues surface"
      ],
      "key_voices": [
        {"user": "mattrose_eng", "karma": 34000, "platform": "hn", "quote": "Use for side projects, wait a year for prod"}
      ],
      "strength": "moderate"
    },
    "disagreement_depth": "technical"
  },
  "hype_assessment": {
    "signal": "balanced",
    "reasoning": "Discussion sustained over 8 months with real production reports; dissent is specific and technical rather than dismissive. Some buzzword-heavy posts exist but are outweighed by benchmark-cited analyses.",
    "red_flags": ["Some 'Bun is the future' posts lack data", "Social velocity occasionally outpaces depth"],
    "green_flags": ["6+ production reports since Q1 2026", "Reproducible benchmarks cited", "Respected experts dissenting openly"],
    "velocity": "plateau",
    "expert_engagement": 0.34,
    "dissent_ratio": 0.22
  },
  "misconceptions": [
    {"wrong_take": "Bun can replace Node 1-to-1 today", "correction": "~5% of npm packages still have compat gaps", "source_quote": "..."},
    {"wrong_take": "Bun bundler is faster than esbuild/vite", "correction": "Benchmarks show comparable, not superior", "source_quote": "..."}
  ],
  "confidence": "high"
}
```

---

**End of spec.**
