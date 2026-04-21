# devresearch-mcp

Let Claude Code read developer forums for you.

When you ask *"is framework X worth using?"* — instead of Claude guessing from stale training data, it searches **Hacker News**, **Reddit**, and **Lobsters** in real time, reads what developers are actually saying, and answers from evidence.

---

## Install

```bash
claude mcp add devresearch -- npx -y devresearch-mcp
```

Requires Node.js ≥ 20. **No API key. No config.** Restart Claude Code and you're done.

---

## Try it

Ask Claude:

> *"Use devresearch to check if Bun is production-ready"*

Claude will:

1. Search Hacker News, Reddit, and Lobsters for Bun discussions (last 30 days)
2. Pull the top 6 threads with their comment trees
3. Score each post on 6 heuristics — velocity, expert engagement, dissent ratio, buzzword density, comment depth, longevity
4. Summarize: *"34 discussions found. Pro camp cites speed and drop-in compatibility; con camp flags native-module edge cases. Expert engagement is high (62%), buzzword density low — substantive discussion, limited hype."*

---

## What it can do

| Ask Claude... | Tool used |
|---|---|
| *"What's changed in Tanstack Query v5?"* | `research` — aggregates threads + scores hype |
| *"Search HN for WebAssembly discussions"* | `search` — keyword search across all platforms |
| *"What's trending on HN today?"* | `trending` — front page / hot / hottest snapshots |
| *"Show me HN thread 42"* | `get_post` — deep-dive with full comment tree |
| *"What's jarredsumner's karma?"* | `get_user` — profile + karma lookup |

You don't need to remember tool names — ask in plain English, Claude picks the right one.

---

## How hype detection works

Each post is scored locally on 6 signals (no LLM calls):

| Signal | What it measures |
|---|---|
| `velocity` | Score growth rate per hour since posting |
| `buzzword_density` | Frequency of marketing words ("revolutionary", "10x", "game-changer"...) |
| `expert_engagement` | Share of comments from high-karma authors |
| `dissent` | Share of top-level comments expressing disagreement |
| `depth` | Median comment-tree depth (deeper = more technical debate) |
| `longevity` | How long the discussion stayed active |

A post is classified as:

- **strong_hype** — high buzzword + high velocity + low expert engagement
- **mild_hype** — elevated buzzword and velocity with some expert presence
- **substantive** — low buzzword + high expert engagement
- **balanced** — signals don't clearly lean either way

Claude then reads the raw data and writes the final narrative — it can cite specific comments, identify key voices, and flag misconceptions that the heuristics alone would miss.

---

## Cache

Results are cached in a local SQLite database at `~/.devresearch-mcp/cache.db` with a 24-hour TTL. Re-running the same query within a day is instant and uses no network.

---

## Configuration (optional)

Defaults work out of the box. To customize, create `~/.devresearch-mcp/config.toml`:

```toml
[sources.reddit]
subreddits = ["programming", "rust", "LocalLLaMA", "ExperiencedDevs"]

[cache]
ttl_hours = 24

[hype_scoring]
buzzwords = ["game changer", "revolutionary", "next-gen", "paradigm shift"]
```

Override the config path with `DEVRESEARCH_CONFIG=/path/to/file.toml`.

---

## Limitations

- Reddit uses the public JSON endpoints — subject to rate limits; occasional delays.
- Cross-platform duplicate clustering uses URL normalization + title n-grams. Accurate for canonical links, weaker for text-only discussion threads.
- `research` returns at most 6 top posts (`normal`) or 12 (`depth: "deep"`) to keep context usage predictable.
- Heuristic signals are English-biased — buzzword/dissent detection relies on English keyword lists.

---

## License

MIT
