# devresearch-mcp Implementation Plan — Phase 2: Fetchers + Dedup

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build zero-auth fetchers for Hacker News, Reddit, and Lobsters; normalize results to `NormalizedItem`; deduplicate across platforms via MinHash clustering; persist items + clusters to the SQLite cache with TTL-aware read. End state: a `searchAll(query)` orchestrator that fans out across enabled platforms, returns unique clustered results, and populates the cache.

**Architecture:** One fetcher module per source implementing a common `Fetcher` interface. A shared HTTP helper (timeout + retry on 429/5xx, injectable fetch for tests). Normalization into the Phase 1 `NormalizedItem` type. MinHash-based dedup assigns a shared `cluster_id` to items with similar URL+title. Cache layer upserts items/clusters and exposes TTL check.

**Tech Stack:** Node 20+ built-in `fetch`, TypeScript strict, Vitest with fixture-driven tests (no live network), `node:sqlite` (via Phase 1's `openDb`).

---

## Phase Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 1: Foundation | Package setup, MCP skeleton, SQLite, config loader | ✅ done |
| **Phase 2: Fetchers + Dedup** *(this doc)* | HTTP helper, HN/Reddit/Lobsters fetchers, MinHash, cache writer | 🚧 in progress |
| Phase 3: Raw Tools + Heuristics | `search`, `get_post`, `get_user`, `trending`, hype scoring | ⏳ deferred |
| Phase 4: Research Tool (LLM) | Anthropic client, prompt, zod output, `research` tool | ⏳ deferred |
| Phase 5: Polish + Publish | README, install testing, npm publish | ⏳ deferred |

> **Workflow rule:** After Phase 2 implementation completes, user compacts the context, then Phase 3 plan is written.

---

## File Structure (Phase 2)

New files created in this phase:

| Path | Purpose | Max LOC |
|------|---------|---------|
| `src/fetchers/http.ts` | `httpGetJson`/`httpGetText` with timeout + retry + UA | 80 |
| `src/fetchers/types.ts` | `Fetcher`, `SearchOptions`, `FetcherDeps` types | 40 |
| `src/fetchers/hn.ts` | HN Algolia search → NormalizedItem[] | 80 |
| `src/fetchers/reddit.ts` | Reddit JSON search → NormalizedItem[] | 90 |
| `src/fetchers/lobsters.ts` | Lobsters hottest.json → NormalizedItem[] | 70 |
| `src/fetchers/registry.ts` | `createFetchers(config, deps)` factory | 40 |
| `src/normalize/minhash.ts` | `minhashSignature` + `jaccardSimilarity` | 70 |
| `src/normalize/cluster.ts` | `clusterItems(items) → Map<itemId,clusterId>` | 90 |
| `src/storage/cache.ts` | `upsertItems`, `upsertClusters`, TTL read | 120 |
| `src/orchestrator.ts` | `searchAll(query)` fan-out + dedup + cache | 80 |

Test files:

| Path | Purpose | Max LOC |
|------|---------|---------|
| `tests/fetchers/http.test.ts` | timeout, retry, UA, non-retryable 4xx | 100 |
| `tests/fetchers/hn.test.ts` | Algolia response → NormalizedItem[] | 80 |
| `tests/fetchers/reddit.test.ts` | Reddit JSON → NormalizedItem[] | 80 |
| `tests/fetchers/lobsters.test.ts` | Lobsters JSON → NormalizedItem[] | 60 |
| `tests/normalize/minhash.test.ts` | signature stability, Jaccard bounds | 60 |
| `tests/normalize/cluster.test.ts` | dedup across URL + title variants | 80 |
| `tests/storage/cache.test.ts` | upsert, read-back, TTL expiry | 80 |
| `tests/orchestrator.test.ts` | end-to-end fan-out with mocked fetchers | 60 |
| `tests/fixtures/hn/algolia.json` | canned Algolia response | — |
| `tests/fixtures/reddit/search.json` | canned Reddit search JSON | — |
| `tests/fixtures/lobsters/hottest.json` | canned Lobsters JSON | — |

Total Phase 2: ~760 LOC source + ~600 LOC tests. Within 850-1000 total budget alongside Phase 1.

---

## Done Criteria

- [ ] `npm run typecheck` → 0 errors
- [ ] `npm test` → all Phase 1 + Phase 2 tests pass
- [ ] `npm run build` → clean `dist/` with all new modules
- [ ] `searchAll("rust")` invoked in a dev script returns clustered, cached items from at least HN (network test optional; fixture-driven tests are mandatory)

---

## Tasks

### Task 1: HTTP helper with timeout + retry

**Files:**
- Create: `D:\mcd\src\fetchers\http.ts`
- Test: `D:\mcd\tests\fetchers\http.test.ts`

- [ ] **Step 1: Write the failing test**

Create `D:\mcd\tests\fetchers\http.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { httpGetJson, httpGetText } from "../../src/fetchers/http.js";

function makeResponse(
  status: number,
  body: unknown,
  opts: { contentType?: string } = {},
): Response {
  const headers = new Headers({
    "content-type": opts.contentType ?? "application/json",
  });
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers });
}

describe("httpGetJson", () => {
  it("returns parsed JSON on 200", async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse(200, { ok: true }));
    const out = await httpGetJson<{ ok: boolean }>("https://x.test/", {
      fetchFn,
    });
    expect(out).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("sends custom User-Agent header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse(200, {}));
    await httpGetJson("https://x.test/", { fetchFn, userAgent: "test-ua/1.0" });
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("user-agent")).toBe("test-ua/1.0");
  });

  it("retries on 429 then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, "rate-limited", { contentType: "text/plain" }))
      .mockResolvedValueOnce(makeResponse(200, { ok: 1 }));
    const out = await httpGetJson<{ ok: number }>("https://x.test/", {
      fetchFn,
      retries: 2,
      backoffMs: 1,
    });
    expect(out).toEqual({ ok: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 up to retries limit, then throws", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(makeResponse(500, "boom", { contentType: "text/plain" }));
    await expect(
      httpGetJson("https://x.test/", { fetchFn, retries: 2, backoffMs: 1 }),
    ).rejects.toThrow(/500/);
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does NOT retry on 404", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(makeResponse(404, "not found", { contentType: "text/plain" }));
    await expect(
      httpGetJson("https://x.test/", { fetchFn, retries: 3, backoffMs: 1 }),
    ).rejects.toThrow(/404/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws on timeout", async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    await expect(
      httpGetJson("https://x.test/", { fetchFn, timeoutMs: 5, retries: 0 }),
    ).rejects.toThrow(/timeout|abort/i);
  });
});

describe("httpGetText", () => {
  it("returns raw text", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(makeResponse(200, "hello", { contentType: "text/plain" }));
    const out = await httpGetText("https://x.test/", { fetchFn });
    expect(out).toBe("hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/fetchers/http.test.ts`
Expected: FAIL with "Cannot find module .../src/fetchers/http.js"

- [ ] **Step 3: Implement `src/fetchers/http.ts`**

Create `D:\mcd\src\fetchers\http.ts`:
```typescript
export interface HttpOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  userAgent?: string;
  headers?: Record<string, string>;
}

const DEFAULT_UA = "devresearch-mcp/0.0.1 (+https://github.com/)";
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function httpGetRaw(url: string, options: HttpOptions): Promise<Response> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF;

  const headers: Record<string, string> = {
    "user-agent": options.userAgent ?? DEFAULT_UA,
    accept: "application/json, text/plain, */*",
    ...options.headers,
  };

  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= retries) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { headers, signal: ac.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      if (!isRetryable(res.status) || attempt === retries) {
        const body = await safeText(res);
        throw new Error(`HTTP ${res.status} ${url}: ${body.slice(0, 200)}`);
      }
      await sleep(backoffMs * 2 ** attempt);
      attempt += 1;
      continue;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || /abort/i.test(err.message));
      if (isAbort && attempt === retries) {
        throw new Error(`HTTP timeout after ${timeoutMs}ms: ${url}`);
      }
      if (!isAbort && !(err instanceof Error && err.message.startsWith("HTTP "))) {
        if (attempt === retries) throw err;
      } else if (err instanceof Error && err.message.startsWith("HTTP ")) {
        throw err;
      }
      if (attempt === retries) break;
      await sleep(backoffMs * 2 ** attempt);
      attempt += 1;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`HTTP failed: ${url}`);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function httpGetJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const res = await httpGetRaw(url, options);
  return (await res.json()) as T;
}

export async function httpGetText(url: string, options: HttpOptions = {}): Promise<string> {
  const res = await httpGetRaw(url, options);
  return res.text();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/fetchers/http.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/fetchers/http.ts tests/fetchers/http.test.ts
git commit -m "feat(fetchers): add http helper with timeout and retry"
```

---

### Task 2: Shared fetcher types

**Files:**
- Create: `D:\mcd\src\fetchers\types.ts`

- [ ] **Step 1: Create `src/fetchers/types.ts`**

No test needed (pure type declarations — Task 3 tests them by using them).

Create `D:\mcd\src\fetchers\types.ts`:
```typescript
import type { NormalizedItem, Platform } from "../types.js";
import type { HttpOptions } from "./http.js";

export interface SearchOptions {
  limit?: number;
  windowDays?: number;
}

export interface FetcherDeps {
  http?: HttpOptions;
  now?: () => Date;
}

export interface Fetcher {
  platform: Platform;
  search(query: string, options: SearchOptions): Promise<NormalizedItem[]>;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/fetchers/types.ts
git commit -m "feat(fetchers): add Fetcher interface types"
```

---

### Task 3: HN fetcher (Algolia search)

**Files:**
- Create: `D:\mcd\src\fetchers\hn.ts`
- Create: `D:\mcd\tests\fixtures\hn\algolia.json`
- Test: `D:\mcd\tests\fetchers\hn.test.ts`

HN Algolia endpoint: `https://hn.algolia.com/api/v1/search?query=<q>&tags=story&hitsPerPage=<n>&numericFilters=created_at_i>=<unix>`

- [ ] **Step 1: Create fixture**

Create `D:\mcd\tests\fixtures\hn\algolia.json`:
```json
{
  "hits": [
    {
      "objectID": "40123456",
      "title": "Bun 1.2 is out",
      "url": "https://bun.sh/blog/bun-1.2",
      "author": "dang",
      "points": 892,
      "num_comments": 341,
      "created_at": "2026-04-10T15:00:00.000Z",
      "created_at_i": 1775148000
    },
    {
      "objectID": "40123999",
      "title": "Show HN: A tool we built",
      "url": null,
      "story_text": "We built a tool",
      "author": "shower",
      "points": 12,
      "num_comments": 3,
      "created_at": "2026-04-11T10:00:00.000Z",
      "created_at_i": 1775210400
    }
  ],
  "nbHits": 2,
  "page": 0,
  "nbPages": 1,
  "hitsPerPage": 20
}
```

- [ ] **Step 2: Write the failing test**

Create `D:\mcd\tests\fetchers\hn.test.ts`:
```typescript
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { createHnFetcher } from "../../src/fetchers/hn.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/hn/algolia.json"), "utf8"),
);

function mockFetchJson(payload: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("hn fetcher", () => {
  it("normalizes Algolia hits to NormalizedItem[]", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createHnFetcher({ http: { fetchFn } });
    const items = await f.search("bun", { limit: 10 });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "hn_40123456",
      platform: "hn",
      title: "Bun 1.2 is out",
      url: "https://bun.sh/blog/bun-1.2",
      author: "dang",
      score: 892,
    });
    expect(items[0].ts).toBe("2026-04-10T15:00:00.000Z");
  });

  it("falls back to HN URL when hit has no external url", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createHnFetcher({ http: { fetchFn } });
    const items = await f.search("show", { limit: 10 });
    const showhn = items.find((i) => i.id === "hn_40123999");
    expect(showhn?.url).toBe("https://news.ycombinator.com/item?id=40123999");
  });

  it("builds correct search URL with query + limit + window", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ hits: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const now = new Date("2026-04-21T00:00:00Z");
    const f = createHnFetcher({
      http: { fetchFn },
      now: () => now,
    });
    await f.search("rust", { limit: 5, windowDays: 10 });
    const calledUrl = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("hn.algolia.com/api/v1/search");
    expect(calledUrl).toContain("query=rust");
    expect(calledUrl).toContain("tags=story");
    expect(calledUrl).toContain("hitsPerPage=5");
    // windowDays=10 → cutoff = now - 10d = 2026-04-11T00:00:00Z = 1775174400
    expect(calledUrl).toContain("numericFilters=created_at_i%3E%3D1775174400");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/fetchers/hn.test.ts`
Expected: FAIL with "Cannot find module .../src/fetchers/hn.js"

- [ ] **Step 4: Implement `src/fetchers/hn.ts`**

Create `D:\mcd\src\fetchers\hn.ts`:
```typescript
import type { Fetcher, FetcherDeps, SearchOptions } from "./types.js";
import type { NormalizedItem } from "../types.js";
import { httpGetJson } from "./http.js";

interface AlgoliaHit {
  objectID: string;
  title?: string;
  url?: string | null;
  author?: string;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string;
  created_at_i?: number;
  story_text?: string | null;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

export function createHnFetcher(deps: FetcherDeps = {}): Fetcher {
  const now = deps.now ?? (() => new Date());

  return {
    platform: "hn",
    async search(query, options: SearchOptions): Promise<NormalizedItem[]> {
      const limit = options.limit ?? 20;
      const params = new URLSearchParams({
        query,
        tags: "story",
        hitsPerPage: String(limit),
      });
      if (options.windowDays && options.windowDays > 0) {
        const cutoffSec = Math.floor(
          (now().getTime() - options.windowDays * 86_400_000) / 1000,
        );
        params.set("numericFilters", `created_at_i>=${cutoffSec}`);
      }
      const url = `https://hn.algolia.com/api/v1/search?${params.toString()}`;
      const data = await httpGetJson<AlgoliaResponse>(url, deps.http);
      return data.hits.map(toItem);
    },
  };
}

function toItem(hit: AlgoliaHit): NormalizedItem {
  const hnUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  return {
    id: `hn_${hit.objectID}`,
    platform: "hn",
    url: hit.url && hit.url.length > 0 ? hit.url : hnUrl,
    title: hit.title ?? "",
    author: hit.author ?? "",
    score: typeof hit.points === "number" ? hit.points : 0,
    ts: hit.created_at ?? new Date(0).toISOString(),
    raw: hit,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/fetchers/hn.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/fetchers/hn.ts tests/fetchers/hn.test.ts tests/fixtures/hn/algolia.json
git commit -m "feat(fetchers): add HN Algolia search fetcher"
```

---

### Task 4: Reddit fetcher (JSON search)

**Files:**
- Create: `D:\mcd\src\fetchers\reddit.ts`
- Create: `D:\mcd\tests\fixtures\reddit\search.json`
- Test: `D:\mcd\tests\fetchers\reddit.test.ts`

Endpoint: `https://www.reddit.com/search.json?q=<q>&limit=<n>&restrict_sr=on` when subreddit scope; `https://www.reddit.com/r/<subs>/search.json?q=<q>&restrict_sr=on` for subreddit-filtered.

- [ ] **Step 1: Create fixture**

Create `D:\mcd\tests\fixtures\reddit\search.json`:
```json
{
  "kind": "Listing",
  "data": {
    "after": "t3_abc",
    "children": [
      {
        "kind": "t3",
        "data": {
          "id": "1a2b3c",
          "name": "t3_1a2b3c",
          "title": "Ask HN equivalent: what's your opinion of Bun?",
          "url": "https://www.reddit.com/r/javascript/comments/1a2b3c/ask_bun/",
          "permalink": "/r/javascript/comments/1a2b3c/ask_bun/",
          "author": "dev_jane",
          "score": 412,
          "num_comments": 87,
          "created_utc": 1775193600,
          "subreddit": "javascript",
          "is_self": true,
          "selftext": "What do you think..."
        }
      },
      {
        "kind": "t3",
        "data": {
          "id": "9z8y7x",
          "name": "t3_9z8y7x",
          "title": "Rust in the kernel",
          "url": "https://lkml.org/lkml/2026/4/10/42",
          "permalink": "/r/rust/comments/9z8y7x/rust_in_the_kernel/",
          "author": "kernel_fan",
          "score": 1204,
          "num_comments": 230,
          "created_utc": 1775280000,
          "subreddit": "rust",
          "is_self": false
        }
      }
    ]
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `D:\mcd\tests\fetchers\reddit.test.ts`:
```typescript
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { createRedditFetcher } from "../../src/fetchers/reddit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/reddit/search.json"), "utf8"),
);

function mockFetchJson(payload: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("reddit fetcher", () => {
  it("normalizes listing children to NormalizedItem[]", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createRedditFetcher({ http: { fetchFn } }, { subreddits: [] });
    const items = await f.search("bun", { limit: 20 });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "reddit_1a2b3c",
      platform: "reddit",
      title: "Ask HN equivalent: what's your opinion of Bun?",
      author: "dev_jane",
      score: 412,
    });
  });

  it("uses permalink for self posts and external url for link posts", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createRedditFetcher({ http: { fetchFn } }, { subreddits: [] });
    const items = await f.search("bun", { limit: 20 });
    const self = items.find((i) => i.id === "reddit_1a2b3c");
    const link = items.find((i) => i.id === "reddit_9z8y7x");
    expect(self?.url).toBe(
      "https://www.reddit.com/r/javascript/comments/1a2b3c/ask_bun/",
    );
    expect(link?.url).toBe("https://lkml.org/lkml/2026/4/10/42");
  });

  it("converts created_utc seconds to ISO timestamp", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createRedditFetcher({ http: { fetchFn } }, { subreddits: [] });
    const items = await f.search("bun", { limit: 20 });
    expect(items[0].ts).toBe(new Date(1775193600 * 1000).toISOString());
  });

  it("uses /r/<subs>/search.json when subreddits configured", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ kind: "Listing", data: { children: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const f = createRedditFetcher(
      { http: { fetchFn } },
      { subreddits: ["rust", "golang"] },
    );
    await f.search("async", { limit: 5 });
    const calledUrl = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("reddit.com/r/rust+golang/search.json");
    expect(calledUrl).toContain("q=async");
    expect(calledUrl).toContain("restrict_sr=on");
    expect(calledUrl).toContain("limit=5");
  });

  it("uses global /search.json when subreddits empty", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ kind: "Listing", data: { children: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const f = createRedditFetcher({ http: { fetchFn } }, { subreddits: [] });
    await f.search("anything", { limit: 5 });
    const calledUrl = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("reddit.com/search.json");
    expect(calledUrl).not.toContain("restrict_sr");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/fetchers/reddit.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Implement `src/fetchers/reddit.ts`**

Create `D:\mcd\src\fetchers\reddit.ts`:
```typescript
import type { Fetcher, FetcherDeps, SearchOptions } from "./types.js";
import type { NormalizedItem } from "../types.js";
import { httpGetJson } from "./http.js";

export interface RedditConfig {
  subreddits: string[];
}

interface RedditChild {
  kind: string;
  data: {
    id: string;
    title: string;
    url?: string;
    permalink: string;
    author?: string;
    score?: number;
    created_utc?: number;
    is_self?: boolean;
    subreddit?: string;
  };
}

interface RedditListing {
  kind: string;
  data: {
    children: RedditChild[];
  };
}

export function createRedditFetcher(
  deps: FetcherDeps,
  config: RedditConfig,
): Fetcher {
  return {
    platform: "reddit",
    async search(query, options: SearchOptions): Promise<NormalizedItem[]> {
      const limit = options.limit ?? 25;
      const params = new URLSearchParams({
        q: query,
        limit: String(limit),
        sort: "relevance",
        t: options.windowDays && options.windowDays <= 7 ? "week" : "month",
        raw_json: "1",
      });

      let url: string;
      if (config.subreddits.length > 0) {
        const subs = config.subreddits.map(encodeURIComponent).join("+");
        params.set("restrict_sr", "on");
        url = `https://www.reddit.com/r/${subs}/search.json?${params.toString()}`;
      } else {
        url = `https://www.reddit.com/search.json?${params.toString()}`;
      }

      const data = await httpGetJson<RedditListing>(url, deps.http);
      return (data.data?.children ?? []).map(toItem);
    },
  };
}

function toItem(child: RedditChild): NormalizedItem {
  const d = child.data;
  const permalinkUrl = `https://www.reddit.com${d.permalink}`;
  const externalUrl =
    !d.is_self && typeof d.url === "string" && d.url.length > 0
      ? d.url
      : permalinkUrl;
  return {
    id: `reddit_${d.id}`,
    platform: "reddit",
    url: externalUrl,
    title: d.title ?? "",
    author: d.author ?? "",
    score: typeof d.score === "number" ? d.score : 0,
    ts:
      typeof d.created_utc === "number"
        ? new Date(d.created_utc * 1000).toISOString()
        : new Date(0).toISOString(),
    raw: d,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/fetchers/reddit.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/fetchers/reddit.ts tests/fetchers/reddit.test.ts tests/fixtures/reddit/search.json
git commit -m "feat(fetchers): add Reddit JSON search fetcher"
```

---

### Task 5: Lobsters fetcher (hottest.json)

**Files:**
- Create: `D:\mcd\src\fetchers\lobsters.ts`
- Create: `D:\mcd\tests\fixtures\lobsters\hottest.json`
- Test: `D:\mcd\tests\fetchers\lobsters.test.ts`

Lobsters exposes `https://lobste.rs/hottest.json` and `https://lobste.rs/search.json?q=<q>`. Prefer `search.json` for query; fall back to `hottest.json` for empty-query browsing (used by future `trending` tool).

- [ ] **Step 1: Create fixture**

Create `D:\mcd\tests\fixtures\lobsters\hottest.json`:
```json
[
  {
    "short_id": "abc123",
    "short_id_url": "https://lobste.rs/s/abc123",
    "created_at": "2026-04-15T08:30:00.000-07:00",
    "title": "SQLite in Node 22 stdlib",
    "url": "https://nodejs.org/api/sqlite.html",
    "score": 87,
    "comment_count": 34,
    "submitter_user": "alice",
    "tags": ["nodejs", "sqlite"]
  },
  {
    "short_id": "def456",
    "short_id_url": "https://lobste.rs/s/def456",
    "created_at": "2026-04-16T04:10:00.000-07:00",
    "title": "Discussion: monorepos",
    "url": "",
    "score": 22,
    "comment_count": 54,
    "submitter_user": "bob",
    "tags": ["programming"]
  }
]
```

- [ ] **Step 2: Write the failing test**

Create `D:\mcd\tests\fetchers\lobsters.test.ts`:
```typescript
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { createLobstersFetcher } from "../../src/fetchers/lobsters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../fixtures/lobsters/hottest.json"),
    "utf8",
  ),
);

function mockFetchJson(payload: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("lobsters fetcher", () => {
  it("normalizes stories to NormalizedItem[]", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createLobstersFetcher({ http: { fetchFn } });
    const items = await f.search("sqlite", { limit: 20 });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "lobsters_abc123",
      platform: "lobsters",
      title: "SQLite in Node 22 stdlib",
      url: "https://nodejs.org/api/sqlite.html",
      author: "alice",
      score: 87,
    });
  });

  it("falls back to short_id_url when url is empty", async () => {
    const fetchFn = mockFetchJson(FIXTURE);
    const f = createLobstersFetcher({ http: { fetchFn } });
    const items = await f.search("x", { limit: 20 });
    const selfStory = items.find((i) => i.id === "lobsters_def456");
    expect(selfStory?.url).toBe("https://lobste.rs/s/def456");
  });

  it("hits search.json when query non-empty", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const f = createLobstersFetcher({ http: { fetchFn } });
    await f.search("rust", { limit: 10 });
    const called = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(called).toContain("lobste.rs/search.json");
    expect(called).toContain("q=rust");
  });

  it("hits hottest.json when query empty", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const f = createLobstersFetcher({ http: { fetchFn } });
    await f.search("", { limit: 10 });
    const called = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(called).toContain("lobste.rs/hottest.json");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/fetchers/lobsters.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Implement `src/fetchers/lobsters.ts`**

Create `D:\mcd\src\fetchers\lobsters.ts`:
```typescript
import type { Fetcher, FetcherDeps, SearchOptions } from "./types.js";
import type { NormalizedItem } from "../types.js";
import { httpGetJson } from "./http.js";

interface LobstersStory {
  short_id: string;
  short_id_url?: string;
  created_at?: string;
  title: string;
  url?: string | null;
  score?: number;
  comment_count?: number;
  submitter_user?: string;
  tags?: string[];
}

export function createLobstersFetcher(deps: FetcherDeps = {}): Fetcher {
  return {
    platform: "lobsters",
    async search(query, options: SearchOptions): Promise<NormalizedItem[]> {
      const limit = options.limit ?? 25;
      let url: string;
      if (query.trim().length > 0) {
        const params = new URLSearchParams({
          q: query,
          what: "stories",
          order: "relevance",
        });
        url = `https://lobste.rs/search.json?${params.toString()}`;
      } else {
        url = "https://lobste.rs/hottest.json";
      }
      const data = await httpGetJson<LobstersStory[] | { stories: LobstersStory[] }>(
        url,
        deps.http,
      );
      const stories = Array.isArray(data) ? data : (data.stories ?? []);
      return stories.slice(0, limit).map(toItem);
    },
  };
}

function toItem(s: LobstersStory): NormalizedItem {
  const fallbackUrl = s.short_id_url ?? `https://lobste.rs/s/${s.short_id}`;
  const externalUrl =
    typeof s.url === "string" && s.url.length > 0 ? s.url : fallbackUrl;
  return {
    id: `lobsters_${s.short_id}`,
    platform: "lobsters",
    url: externalUrl,
    title: s.title ?? "",
    author: s.submitter_user ?? "",
    score: typeof s.score === "number" ? s.score : 0,
    ts: s.created_at
      ? new Date(s.created_at).toISOString()
      : new Date(0).toISOString(),
    raw: s,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/fetchers/lobsters.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/fetchers/lobsters.ts tests/fetchers/lobsters.test.ts tests/fixtures/lobsters/hottest.json
git commit -m "feat(fetchers): add Lobsters search and hottest fetcher"
```

---

### Task 6: Fetcher registry

**Files:**
- Create: `D:\mcd\src\fetchers\registry.ts`

- [ ] **Step 1: Implement `src/fetchers/registry.ts`**

Create `D:\mcd\src\fetchers\registry.ts`:
```typescript
import type { Config } from "../config/schema.js";
import type { Platform } from "../types.js";
import type { Fetcher, FetcherDeps } from "./types.js";
import { createHnFetcher } from "./hn.js";
import { createRedditFetcher } from "./reddit.js";
import { createLobstersFetcher } from "./lobsters.js";

export function createFetchers(
  config: Config,
  deps: FetcherDeps = {},
): Map<Platform, Fetcher> {
  const map = new Map<Platform, Fetcher>();
  for (const platform of config.sources.enabled) {
    switch (platform) {
      case "hn":
        map.set("hn", createHnFetcher(deps));
        break;
      case "reddit":
        map.set(
          "reddit",
          createRedditFetcher(deps, {
            subreddits: config.sources.reddit.subreddits,
          }),
        );
        break;
      case "lobsters":
        map.set("lobsters", createLobstersFetcher(deps));
        break;
    }
  }
  return map;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/fetchers/registry.ts
git commit -m "feat(fetchers): add registry factory keyed on enabled platforms"
```

---

### Task 7: MinHash signature + Jaccard similarity

**Files:**
- Create: `D:\mcd\src\normalize\minhash.ts`
- Test: `D:\mcd\tests\normalize\minhash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `D:\mcd\tests\normalize\minhash.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  minhashSignature,
  jaccardSimilarity,
  tokenize,
} from "../../src/normalize/minhash.js";

describe("tokenize", () => {
  it("lowercases and splits on non-word chars", () => {
    expect(tokenize("Hello, World!  Bun-1.2")).toEqual([
      "hello",
      "world",
      "bun",
      "1",
      "2",
    ]);
  });

  it("drops empty tokens", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("minhashSignature", () => {
  it("produces deterministic signature for same input", () => {
    const a = minhashSignature("Bun 1.2 is out", 64);
    const b = minhashSignature("Bun 1.2 is out", 64);
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });

  it("produces different signatures for unrelated inputs", () => {
    const a = minhashSignature("Bun 1.2 is out", 64);
    const b = minhashSignature("Rust async runtime internals", 64);
    expect(a).not.toEqual(b);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical signatures", () => {
    const a = minhashSignature("Bun 1.2 is out", 64);
    expect(jaccardSimilarity(a, a)).toBe(1);
  });

  it("returns high similarity for near-duplicates", () => {
    const a = minhashSignature("Bun 1.2 is out today", 128);
    const b = minhashSignature("Bun 1.2 is out", 128);
    expect(jaccardSimilarity(a, b)).toBeGreaterThan(0.4);
  });

  it("returns low similarity for unrelated inputs", () => {
    const a = minhashSignature("Bun 1.2 is out today", 128);
    const b = minhashSignature("Rust async runtime internals", 128);
    expect(jaccardSimilarity(a, b)).toBeLessThan(0.3);
  });

  it("throws on mismatched signature lengths", () => {
    expect(() =>
      jaccardSimilarity(minhashSignature("a", 64), minhashSignature("a", 128)),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/normalize/minhash.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/normalize/minhash.ts`**

Create `D:\mcd\src\normalize\minhash.ts`:
```typescript
const MERSENNE_PRIME = 2147483647; // 2^31 - 1

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

function hash32(s: string, seed: number): number {
  // FNV-1a 32-bit with seed mix
  let h = 2166136261 ^ seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % MERSENNE_PRIME;
}

export function minhashSignature(text: string, numHashes = 128): number[] {
  const tokens = tokenize(text);
  const sig = new Array<number>(numHashes).fill(MERSENNE_PRIME);
  if (tokens.length === 0) return sig;
  for (let h = 0; h < numHashes; h++) {
    let min = MERSENNE_PRIME;
    for (const tok of tokens) {
      const v = hash32(tok, h + 1);
      if (v < min) min = v;
    }
    sig[h] = min;
  }
  return sig;
}

export function jaccardSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`signature length mismatch: ${a.length} vs ${b.length}`);
  }
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matches += 1;
  }
  return matches / a.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/normalize/minhash.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/normalize/minhash.ts tests/normalize/minhash.test.ts
git commit -m "feat(normalize): add MinHash signature and Jaccard similarity"
```

---

### Task 8: Cluster items

**Files:**
- Create: `D:\mcd\src\normalize\cluster.ts`
- Test: `D:\mcd\tests\normalize\cluster.test.ts`

Clustering approach: normalize URL (strip fragment, trailing slash, utm_* params, lowercase host). If two items share a normalized URL, same cluster. Otherwise compute MinHash of `title` and union items with Jaccard >= threshold.

- [ ] **Step 1: Write the failing test**

Create `D:\mcd\tests\normalize\cluster.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { clusterItems, normalizeUrl } from "../../src/normalize/cluster.js";
import type { NormalizedItem } from "../../src/types.js";

function item(partial: Partial<NormalizedItem>): NormalizedItem {
  return {
    id: "x",
    platform: "hn",
    url: "",
    title: "",
    author: "",
    score: 0,
    ts: "2026-04-20T00:00:00.000Z",
    raw: null,
    ...partial,
  };
}

describe("normalizeUrl", () => {
  it("strips fragment and utm_ params", () => {
    expect(
      normalizeUrl("https://Bun.sh/blog/1-2?utm_source=x&a=1#section"),
    ).toBe("https://bun.sh/blog/1-2?a=1");
  });

  it("strips trailing slash on path", () => {
    expect(normalizeUrl("https://bun.sh/blog/1-2/")).toBe(
      "https://bun.sh/blog/1-2",
    );
  });

  it("keeps non-utm query params sorted", () => {
    expect(normalizeUrl("https://x.test/?b=2&a=1")).toBe(
      "https://x.test/?a=1&b=2",
    );
  });

  it("returns input unchanged when not parseable", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("clusterItems", () => {
  it("groups items sharing normalized URL", () => {
    const items = [
      item({
        id: "hn_1",
        url: "https://bun.sh/blog/1-2?utm_campaign=x",
        title: "Bun 1.2 released",
      }),
      item({
        id: "reddit_2",
        platform: "reddit",
        url: "https://bun.sh/blog/1-2/",
        title: "Bun 1.2: new features",
      }),
      item({
        id: "lobsters_3",
        platform: "lobsters",
        url: "https://github.com/oven-sh/bun",
        title: "Unrelated project page",
      }),
    ];
    const map = clusterItems(items);
    expect(map.get("hn_1")).toBe(map.get("reddit_2"));
    expect(map.get("hn_1")).not.toBe(map.get("lobsters_3"));
  });

  it("groups items with highly similar titles even with different URLs", () => {
    const items = [
      item({
        id: "hn_1",
        url: "https://example.com/a",
        title: "Bun 1.2 is out today with new features",
      }),
      item({
        id: "reddit_2",
        url: "https://othersite.com/different",
        title: "Bun 1.2 is out today with new features",
      }),
    ];
    const map = clusterItems(items, { titleThreshold: 0.5 });
    expect(map.get("hn_1")).toBe(map.get("reddit_2"));
  });

  it("keeps unrelated items in separate clusters", () => {
    const items = [
      item({ id: "hn_1", url: "https://a.com/x", title: "Bun 1.2 released" }),
      item({
        id: "reddit_2",
        url: "https://b.com/y",
        title: "Rust async runtime internals",
      }),
    ];
    const map = clusterItems(items);
    expect(map.get("hn_1")).not.toBe(map.get("reddit_2"));
  });

  it("returns a cluster id for every input item", () => {
    const items = [
      item({ id: "hn_1", url: "https://a.com/x", title: "A" }),
      item({ id: "hn_2", url: "https://b.com/y", title: "B" }),
    ];
    const map = clusterItems(items);
    expect(map.size).toBe(2);
    expect(map.get("hn_1")).toBeDefined();
    expect(map.get("hn_2")).toBeDefined();
  });

  it("cluster id is stable and derived from canonical url", () => {
    const items = [
      item({ id: "hn_1", url: "https://bun.sh/blog/1-2?utm_x=1", title: "t" }),
      item({ id: "reddit_2", url: "https://bun.sh/blog/1-2/", title: "t" }),
    ];
    const map = clusterItems(items);
    const cid = map.get("hn_1");
    expect(cid).toMatch(/^cl_/);
    expect(cid).toBe(map.get("reddit_2"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/normalize/cluster.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/normalize/cluster.ts`**

Create `D:\mcd\src\normalize\cluster.ts`:
```typescript
import type { NormalizedItem } from "../types.js";
import { minhashSignature, jaccardSimilarity } from "./minhash.js";

export interface ClusterOptions {
  titleThreshold?: number;
  numHashes?: number;
}

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    const keep: [string, string][] = [];
    u.searchParams.forEach((v, k) => {
      if (!k.toLowerCase().startsWith("utm_")) keep.push([k, v]);
    });
    keep.sort(([a], [b]) => a.localeCompare(b));
    const query = keep.map(([k, v]) => `${k}=${v}`).join("&");
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    const base = `${u.protocol}//${u.hostname}${pathname}`;
    return query.length > 0 ? `${base}?${query}` : base;
  } catch {
    return raw;
  }
}

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

interface DSU {
  parent: number[];
  find(i: number): number;
  union(a: number, b: number): void;
}

function makeDSU(n: number): DSU {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  return { parent, find, union };
}

export function clusterItems(
  items: NormalizedItem[],
  options: ClusterOptions = {},
): Map<string, string> {
  const titleThreshold = options.titleThreshold ?? 0.7;
  const numHashes = options.numHashes ?? 128;

  const dsu = makeDSU(items.length);
  const normUrls = items.map((i) => normalizeUrl(i.url));
  const sigs = items.map((i) => minhashSignature(i.title, numHashes));

  const urlBucket = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const prev = urlBucket.get(normUrls[i]);
    if (prev !== undefined) {
      dsu.union(i, prev);
    } else {
      urlBucket.set(normUrls[i], i);
    }
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (dsu.find(i) === dsu.find(j)) continue;
      if (jaccardSimilarity(sigs[i], sigs[j]) >= titleThreshold) {
        dsu.union(i, j);
      }
    }
  }

  const rootToCluster = new Map<number, string>();
  const out = new Map<string, string>();
  for (let i = 0; i < items.length; i++) {
    const root = dsu.find(i);
    let cid = rootToCluster.get(root);
    if (!cid) {
      const rootItem = items[root];
      cid = `cl_${shortHash(normalizeUrl(rootItem.url) + "|" + rootItem.title.toLowerCase())}`;
      rootToCluster.set(root, cid);
    }
    out.set(items[i].id, cid);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/normalize/cluster.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/normalize/cluster.ts tests/normalize/cluster.test.ts
git commit -m "feat(normalize): cluster items by normalized URL + title MinHash"
```

---

### Task 9: Cache layer (upsert + TTL read)

**Files:**
- Create: `D:\mcd\src\storage\cache.ts`
- Test: `D:\mcd\tests\storage\cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `D:\mcd\tests\storage\cache.test.ts`:
```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type Db } from "../../src/storage/db.js";
import {
  upsertItems,
  readFreshItems,
  upsertClusters,
} from "../../src/storage/cache.js";
import type { NormalizedItem } from "../../src/types.js";

let tmpDir: string;
let db: Db;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devresearch-cache-"));
  db = openDb(path.join(tmpDir, "cache.db"));
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function item(partial: Partial<NormalizedItem> & { id: string }): NormalizedItem {
  return {
    platform: "hn",
    url: "https://example.com/",
    title: "t",
    author: "a",
    score: 1,
    ts: "2026-04-20T00:00:00.000Z",
    raw: { some: "payload" },
    ...partial,
  };
}

describe("upsertItems + readFreshItems", () => {
  it("inserts items and reads them back", () => {
    const items = [
      item({ id: "hn_1", title: "first" }),
      item({ id: "reddit_2", platform: "reddit", title: "second" }),
    ];
    const clusterMap = new Map([
      ["hn_1", "cl_a"],
      ["reddit_2", "cl_b"],
    ]);
    const now = new Date("2026-04-21T00:00:00Z");
    upsertItems(db, items, clusterMap, now);

    const read = readFreshItems(db, {
      ttlHours: 24,
      now: new Date("2026-04-21T00:01:00Z"),
    });
    expect(read).toHaveLength(2);
    const ids = read.map((i) => i.id).sort();
    expect(ids).toEqual(["hn_1", "reddit_2"]);
  });

  it("updates existing items on conflict (upsert)", () => {
    const i1 = item({ id: "hn_1", title: "first", score: 10 });
    const now = new Date("2026-04-21T00:00:00Z");
    upsertItems(db, [i1], new Map([["hn_1", "cl_a"]]), now);
    const i1b = { ...i1, title: "first v2", score: 999 };
    upsertItems(db, [i1b], new Map([["hn_1", "cl_a"]]), now);

    const read = readFreshItems(db, { ttlHours: 24, now });
    expect(read).toHaveLength(1);
    expect(read[0].title).toBe("first v2");
    expect(read[0].score).toBe(999);
  });

  it("excludes items older than ttl", () => {
    const i1 = item({ id: "hn_1" });
    const fetchedAt = new Date("2026-04-20T00:00:00Z");
    upsertItems(db, [i1], new Map([["hn_1", "cl_a"]]), fetchedAt);

    // 25 hours later, ttl=24 → stale
    const laterNow = new Date("2026-04-21T01:00:00Z");
    expect(readFreshItems(db, { ttlHours: 24, now: laterNow })).toHaveLength(0);

    // 23 hours later → fresh
    const withinNow = new Date("2026-04-20T23:00:00Z");
    expect(readFreshItems(db, { ttlHours: 24, now: withinNow })).toHaveLength(1);
  });

  it("filters by platform when specified", () => {
    const items = [
      item({ id: "hn_1", platform: "hn" }),
      item({ id: "reddit_2", platform: "reddit" }),
    ];
    upsertItems(
      db,
      items,
      new Map([
        ["hn_1", "cl_a"],
        ["reddit_2", "cl_b"],
      ]),
      new Date("2026-04-21T00:00:00Z"),
    );
    const read = readFreshItems(db, {
      ttlHours: 24,
      now: new Date("2026-04-21T00:00:00Z"),
      platforms: ["reddit"],
    });
    expect(read).toHaveLength(1);
    expect(read[0].platform).toBe("reddit");
  });

  it("stores raw_json round-trippable", () => {
    const raw = { nested: { value: 42 }, arr: [1, 2, 3] };
    const i = item({ id: "hn_1", raw });
    upsertItems(
      db,
      [i],
      new Map([["hn_1", "cl_a"]]),
      new Date("2026-04-21T00:00:00Z"),
    );
    const read = readFreshItems(db, {
      ttlHours: 24,
      now: new Date("2026-04-21T00:00:00Z"),
    });
    expect(read[0].raw).toEqual(raw);
  });
});

describe("upsertClusters", () => {
  it("inserts cluster rows", () => {
    upsertClusters(
      db,
      [
        {
          id: "cl_a",
          canonicalUrl: "https://example.com/",
          canonicalTitle: "title",
        },
      ],
      new Date("2026-04-21T00:00:00Z"),
    );
    const rows = db.prepare("SELECT * FROM clusters").all() as Array<{
      id: string;
      canonical_url: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("cl_a");
    expect(rows[0].canonical_url).toBe("https://example.com/");
  });

  it("is idempotent (updates last_updated)", () => {
    upsertClusters(
      db,
      [{ id: "cl_a", canonicalUrl: "u", canonicalTitle: "t" }],
      new Date("2026-04-21T00:00:00Z"),
    );
    upsertClusters(
      db,
      [{ id: "cl_a", canonicalUrl: "u", canonicalTitle: "t2" }],
      new Date("2026-04-22T00:00:00Z"),
    );
    const rows = db.prepare("SELECT * FROM clusters").all() as Array<{
      canonical_title: string;
      last_updated: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].canonical_title).toBe("t2");
    expect(rows[0].last_updated).toBe("2026-04-22T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/storage/cache.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/storage/cache.ts`**

Create `D:\mcd\src\storage\cache.ts`:
```typescript
import type { Db } from "./db.js";
import type { NormalizedItem, Platform } from "../types.js";

export interface ClusterRow {
  id: string;
  canonicalUrl: string;
  canonicalTitle: string;
}

export interface ReadOptions {
  ttlHours: number;
  now: Date;
  platforms?: Platform[];
  limit?: number;
}

const PLATFORMS: Platform[] = ["hn", "reddit", "lobsters"];

function getSourceIdMap(db: Db): Map<Platform, number> {
  const rows = db
    .prepare("SELECT id, name FROM sources")
    .all() as Array<{ id: number; name: string }>;
  const m = new Map<Platform, number>();
  for (const r of rows) {
    if ((PLATFORMS as string[]).includes(r.name)) {
      m.set(r.name as Platform, r.id);
    }
  }
  return m;
}

export function upsertItems(
  db: Db,
  items: NormalizedItem[],
  clusterMap: Map<string, string>,
  fetchedAt: Date,
): void {
  if (items.length === 0) return;
  const sourceIds = getSourceIdMap(db);
  const fetchedAtIso = fetchedAt.toISOString();
  const stmt = db.prepare(`
    INSERT INTO items (id, source_id, url, title, author, score, ts, cluster_id, raw_json, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_id = excluded.source_id,
      url = excluded.url,
      title = excluded.title,
      author = excluded.author,
      score = excluded.score,
      ts = excluded.ts,
      cluster_id = excluded.cluster_id,
      raw_json = excluded.raw_json,
      fetched_at = excluded.fetched_at
  `);
  db.exec("BEGIN");
  try {
    for (const it of items) {
      stmt.run(
        it.id,
        sourceIds.get(it.platform) ?? null,
        it.url,
        it.title,
        it.author,
        it.score,
        it.ts,
        clusterMap.get(it.id) ?? null,
        JSON.stringify(it.raw ?? null),
        fetchedAtIso,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function upsertClusters(
  db: Db,
  clusters: ClusterRow[],
  now: Date,
): void {
  if (clusters.length === 0) return;
  const nowIso = now.toISOString();
  const stmt = db.prepare(`
    INSERT INTO clusters (id, canonical_url, canonical_title, first_seen, last_updated)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      canonical_url = excluded.canonical_url,
      canonical_title = excluded.canonical_title,
      last_updated = excluded.last_updated
  `);
  db.exec("BEGIN");
  try {
    for (const c of clusters) {
      stmt.run(c.id, c.canonicalUrl, c.canonicalTitle, nowIso, nowIso);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function readFreshItems(
  db: Db,
  options: ReadOptions,
): NormalizedItem[] {
  const cutoffIso = new Date(
    options.now.getTime() - options.ttlHours * 3_600_000,
  ).toISOString();
  const sourceIds = getSourceIdMap(db);
  const platforms = options.platforms ?? PLATFORMS;
  const ids = platforms
    .map((p) => sourceIds.get(p))
    .filter((x): x is number => typeof x === "number");
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  const limitClause = options.limit ? "LIMIT ?" : "";
  const params: Array<string | number> = [cutoffIso, ...ids];
  if (options.limit) params.push(options.limit);

  const sql = `
    SELECT i.id, s.name AS platform, i.url, i.title, i.author, i.score, i.ts, i.raw_json
    FROM items i
    JOIN sources s ON s.id = i.source_id
    WHERE i.fetched_at >= ?
      AND i.source_id IN (${placeholders})
    ORDER BY i.ts DESC
    ${limitClause}
  `;
  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    platform: string;
    url: string;
    title: string;
    author: string;
    score: number;
    ts: string;
    raw_json: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    platform: r.platform as Platform,
    url: r.url,
    title: r.title,
    author: r.author,
    score: r.score,
    ts: r.ts,
    raw: r.raw_json ? safeJsonParse(r.raw_json) : null,
  }));
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/storage/cache.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/storage/cache.ts tests/storage/cache.test.ts
git commit -m "feat(storage): add cache upsert/read with TTL"
```

---

### Task 10: Orchestrator — searchAll

**Files:**
- Create: `D:\mcd\src\orchestrator.ts`
- Test: `D:\mcd\tests\orchestrator.test.ts`

Fans out across enabled fetchers, clusters results, writes to cache, returns items in-memory (no LLM, no heuristics — those are Phase 3).

- [ ] **Step 1: Write the failing test**

Create `D:\mcd\tests\orchestrator.test.ts`:
```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type Db } from "../src/storage/db.js";
import { searchAll } from "../src/orchestrator.js";
import type { Fetcher } from "../src/fetchers/types.js";
import type { NormalizedItem, Platform } from "../src/types.js";

let tmpDir: string;
let db: Db;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devresearch-orch-"));
  db = openDb(path.join(tmpDir, "cache.db"));
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function fakeFetcher(
  platform: Platform,
  items: NormalizedItem[],
): Fetcher {
  return {
    platform,
    async search() {
      return items;
    },
  };
}

describe("searchAll", () => {
  it("fans out across fetchers and returns all items", async () => {
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        fakeFetcher("hn", [
          {
            id: "hn_1",
            platform: "hn",
            url: "https://a.com/x",
            title: "A",
            author: "u",
            score: 1,
            ts: "2026-04-20T00:00:00Z",
            raw: {},
          },
        ]),
      ],
      [
        "reddit",
        fakeFetcher("reddit", [
          {
            id: "reddit_2",
            platform: "reddit",
            url: "https://b.com/y",
            title: "B",
            author: "v",
            score: 2,
            ts: "2026-04-20T01:00:00Z",
            raw: {},
          },
        ]),
      ],
    ]);
    const out = await searchAll({
      query: "q",
      fetchers,
      db,
      options: { limit: 10 },
      now: new Date("2026-04-21T00:00:00Z"),
    });
    expect(out.items).toHaveLength(2);
    expect(out.clusters.size).toBe(2);
  });

  it("persists items and clusters to cache", async () => {
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        fakeFetcher("hn", [
          {
            id: "hn_1",
            platform: "hn",
            url: "https://a.com/x",
            title: "A",
            author: "u",
            score: 1,
            ts: "2026-04-20T00:00:00Z",
            raw: {},
          },
        ]),
      ],
    ]);
    await searchAll({
      query: "q",
      fetchers,
      db,
      options: { limit: 10 },
      now: new Date("2026-04-21T00:00:00Z"),
    });
    const itemRow = db
      .prepare("SELECT id, cluster_id FROM items WHERE id = ?")
      .get("hn_1") as { id: string; cluster_id: string } | undefined;
    expect(itemRow?.cluster_id).toMatch(/^cl_/);
    const clusterRow = db
      .prepare("SELECT id FROM clusters WHERE id = ?")
      .get(itemRow!.cluster_id) as { id: string } | undefined;
    expect(clusterRow?.id).toBe(itemRow!.cluster_id);
  });

  it("deduplicates cross-platform items with same URL into one cluster", async () => {
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        fakeFetcher("hn", [
          {
            id: "hn_1",
            platform: "hn",
            url: "https://bun.sh/blog/1-2?utm_source=hn",
            title: "Bun 1.2 is out",
            author: "u",
            score: 800,
            ts: "2026-04-20T00:00:00Z",
            raw: {},
          },
        ]),
      ],
      [
        "reddit",
        fakeFetcher("reddit", [
          {
            id: "reddit_2",
            platform: "reddit",
            url: "https://bun.sh/blog/1-2/",
            title: "Bun 1.2: released today",
            author: "v",
            score: 400,
            ts: "2026-04-20T01:00:00Z",
            raw: {},
          },
        ]),
      ],
    ]);
    const out = await searchAll({
      query: "bun",
      fetchers,
      db,
      options: { limit: 10 },
      now: new Date("2026-04-21T00:00:00Z"),
    });
    expect(out.clusters.get("hn_1")).toBe(out.clusters.get("reddit_2"));
  });

  it("continues on fetcher failure and reports in errors", async () => {
    const fetchers = new Map<Platform, Fetcher>([
      [
        "hn",
        fakeFetcher("hn", [
          {
            id: "hn_1",
            platform: "hn",
            url: "https://a.com/x",
            title: "A",
            author: "u",
            score: 1,
            ts: "2026-04-20T00:00:00Z",
            raw: {},
          },
        ]),
      ],
      [
        "reddit",
        {
          platform: "reddit",
          async search() {
            throw new Error("reddit down");
          },
        },
      ],
    ]);
    const out = await searchAll({
      query: "q",
      fetchers,
      db,
      options: { limit: 10 },
      now: new Date("2026-04-21T00:00:00Z"),
    });
    expect(out.items).toHaveLength(1);
    expect(out.errors.reddit).toMatch(/reddit down/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/orchestrator.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/orchestrator.ts`**

Create `D:\mcd\src\orchestrator.ts`:
```typescript
import type { Db } from "./storage/db.js";
import type { Fetcher, SearchOptions } from "./fetchers/types.js";
import type { NormalizedItem, Platform } from "./types.js";
import { clusterItems, normalizeUrl } from "./normalize/cluster.js";
import {
  upsertItems,
  upsertClusters,
  type ClusterRow,
} from "./storage/cache.js";

export interface SearchAllInput {
  query: string;
  fetchers: Map<Platform, Fetcher>;
  db: Db;
  options: SearchOptions;
  now?: Date;
}

export interface SearchAllResult {
  items: NormalizedItem[];
  clusters: Map<string, string>;
  errors: Partial<Record<Platform, string>>;
}

export async function searchAll(
  input: SearchAllInput,
): Promise<SearchAllResult> {
  const now = input.now ?? new Date();
  const errors: Partial<Record<Platform, string>> = {};
  const items: NormalizedItem[] = [];

  const jobs = [...input.fetchers.entries()].map(
    async ([platform, fetcher]) => {
      try {
        const fetched = await fetcher.search(input.query, input.options);
        return { platform, items: fetched };
      } catch (err) {
        errors[platform] = err instanceof Error ? err.message : String(err);
        return { platform, items: [] as NormalizedItem[] };
      }
    },
  );

  const results = await Promise.all(jobs);
  for (const r of results) {
    for (const it of r.items) items.push(it);
  }

  const clusterMap = clusterItems(items);
  const clusterRows = buildClusterRows(items, clusterMap);

  upsertItems(input.db, items, clusterMap, now);
  upsertClusters(input.db, clusterRows, now);

  return { items, clusters: clusterMap, errors };
}

function buildClusterRows(
  items: NormalizedItem[],
  clusterMap: Map<string, string>,
): ClusterRow[] {
  const byCluster = new Map<string, NormalizedItem>();
  for (const it of items) {
    const cid = clusterMap.get(it.id);
    if (!cid) continue;
    const existing = byCluster.get(cid);
    if (!existing || it.score > existing.score) {
      byCluster.set(cid, it);
    }
  }
  const rows: ClusterRow[] = [];
  for (const [cid, canonical] of byCluster) {
    rows.push({
      id: cid,
      canonicalUrl: normalizeUrl(canonical.url),
      canonicalTitle: canonical.title,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/orchestrator.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all Phase 1 + Phase 2 tests pass (13 + ~45 new = ~58 tests).

- [ ] **Step 6: Run typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: 0 errors, `dist/` populated with all new modules.

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator.ts tests/orchestrator.test.ts
git commit -m "feat: add searchAll orchestrator with dedup and cache"
```

---

## Self-Review

**1. Spec coverage (Phase 2 scope):**
- HN fetcher → Task 3 ✓
- Reddit fetcher → Task 4 ✓
- Lobsters fetcher → Task 5 ✓
- NormalizedItem produced by all fetchers → Tasks 3/4/5 (matches `src/types.ts`) ✓
- MinHash dedup → Tasks 7, 8 ✓
- Cache write with cluster_id + TTL → Task 9 ✓
- Fan-out + orchestration → Task 10 ✓
- Rate-limit-aware HTTP with exponential backoff → Task 1 ✓ (retry with `backoffMs * 2^attempt`)
- Zero-auth on all fetchers → ✓ (no API keys touched)

**2. Out of scope (correctly deferred):**
- `get_post` comments fetch → Phase 3 (when `get_post` tool lands)
- `get_user` → Phase 3
- Heuristic scoring → Phase 3
- LLM / `research` / `compare` → Phase 4

**3. Type consistency check:**
- `NormalizedItem.raw` typed as `unknown` in `types.ts`; all fetchers put raw hit there ✓
- `Platform = "hn" | "reddit" | "lobsters"`; registry, cache, orchestrator all consistent ✓
- `Fetcher.search` signature stable across Tasks 3/4/5 ✓
- Function names: `createHnFetcher`, `createRedditFetcher`, `createLobstersFetcher`, `createFetchers`, `clusterItems`, `normalizeUrl`, `minhashSignature`, `jaccardSimilarity`, `upsertItems`, `upsertClusters`, `readFreshItems`, `searchAll` — all used consistently between declaration and call sites ✓

**4. Placeholder scan:** No TBD/TODO/placeholders. Every step has concrete code or exact command.

---

**End of Phase 2 plan.**
