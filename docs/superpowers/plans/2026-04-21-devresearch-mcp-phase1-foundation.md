# devresearch-mcp Implementation Plan — Phase 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the project with a working MCP server skeleton, SQLite storage, and config loader. End state: running `npm run dev` or `node dist/index.js` launches an MCP server over stdio that Claude Code can connect to; it exposes an empty tool list cleanly; SQLite DB auto-initializes; config file auto-creates with defaults on first run.

**Architecture:** TypeScript + Node, ESM, `@modelcontextprotocol/sdk` over stdio, SQLite via `better-sqlite3`, TOML config parsed with `smol-toml`, Zod for schema validation. Many small files (<200 LOC each).

**Tech Stack:** Node 20+, TypeScript 5.x, Vitest for tests, tsx for dev run.

---

## Phase Roadmap (context for future phases)

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1: Foundation** *(this doc)* | Package setup, MCP skeleton, SQLite, config loader | 🚧 in progress |
| Phase 2: Fetchers + Normalization | HN / Reddit / Lobsters fetchers, MinHash dedup | ⏳ deferred (separate plan after compact) |
| Phase 3: Raw Tools + Heuristics | `search`, `get_post`, `get_user`, `trending`, scoring | ⏳ deferred |
| Phase 4: Research Tool (LLM) | Anthropic client, prompt, zod output, `research` tool | ⏳ deferred |
| Phase 5: Polish + Publish | README, install testing, npm publish | ⏳ deferred |

> **Workflow rule:** Each phase's detailed plan is written only when its turn comes. After Phase 1 implementation completes, the user compacts the context, then Phase 2 plan is written.

---

## File Structure (Phase 1)

Files created in this phase:

| Path | Purpose | Max LOC |
|------|---------|---------|
| `package.json` | npm manifest, bin entry, scripts, deps | 40 |
| `tsconfig.json` | TypeScript config (NodeNext, strict) | 20 |
| `.gitignore` | ignore `node_modules`, `dist`, `cache.db` | 10 |
| `vitest.config.ts` | test runner config | 10 |
| `README.md` | stub readme | 30 |
| `src/index.ts` | MCP server entry (stdio transport, shebang) | 70 |
| `src/config/schema.ts` | Zod schema + derived TS type for config | 60 |
| `src/config/defaults.ts` | default TOML content as string | 40 |
| `src/config/loader.ts` | read file / create defaults / validate | 70 |
| `src/config/paths.ts` | resolve `~/` and config/cache paths | 30 |
| `src/storage/schema.sql` | DDL (all 5 tables + indexes) | 60 |
| `src/storage/db.ts` | SQLite open + init + migrations | 60 |
| `src/types.ts` | shared domain types (placeholders for later phases) | 40 |
| `tests/config.test.ts` | loader unit tests | 80 |
| `tests/db.test.ts` | DB init + schema tests | 50 |

Total Phase 1: ~670 LOC (within spec's 850-1000 total budget).

---

## Tasks

### Task 1: Initialize git + npm package + install deps

**Files:**
- Create: `D:\mcd\package.json`
- Create: `D:\mcd\.gitignore`

- [ ] **Step 1: Init git repo**

Run from `D:\mcd`:
```bash
git init
git branch -M main
```
Expected: "Initialized empty Git repository in D:/mcd/.git/"

- [ ] **Step 2: Write `.gitignore`**

Create `D:\mcd\.gitignore`:
```
node_modules/
dist/
*.log
.env
.env.local
cache.db
cache.db-journal
coverage/
.vitest/
```

- [ ] **Step 3: Write `package.json`**

Create `D:\mcd\package.json`:
```json
{
  "name": "devresearch-mcp",
  "version": "0.0.1",
  "description": "Cross-platform dev research MCP with hype-vs-substance detection (HN + Reddit + Lobsters)",
  "type": "module",
  "bin": {
    "devresearch-mcp": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "keywords": ["mcp", "model-context-protocol", "claude", "research", "hackernews", "reddit", "lobsters"],
  "license": "MIT",
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^11.0.0",
    "smol-toml": "^1.3.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.11.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: Install dependencies**

Run from `D:\mcd`:
```bash
npm install
```
Expected: creates `node_modules/` and `package-lock.json`, no fatal errors. Warnings about `better-sqlite3` native rebuild are normal on Windows.

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json package-lock.json
git commit -m "chore: initialize devresearch-mcp package"
```

---

### Task 2: TypeScript + test tooling config

**Files:**
- Create: `D:\mcd\tsconfig.json`
- Create: `D:\mcd\vitest.config.ts`

- [ ] **Step 1: Write `tsconfig.json`**

Create `D:\mcd\tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": false,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 2: Write `vitest.config.ts`**

Create `D:\mcd\vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 3: Verify typecheck passes on empty src**

Create placeholder `D:\mcd\src\index.ts` with just:
```typescript
export {};
```

Run:
```bash
npm run typecheck
```
Expected: exit code 0, no output.

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json vitest.config.ts src/index.ts
git commit -m "chore: add TypeScript and Vitest config"
```

---

### Task 3: Config schema + defaults + paths (TDD)

**Files:**
- Create: `D:\mcd\src\config\schema.ts`
- Create: `D:\mcd\src\config\defaults.ts`
- Create: `D:\mcd\src\config\paths.ts`
- Test: `D:\mcd\tests\config.test.ts` (partial — paths portion only in this task)

- [ ] **Step 1: Write failing test for paths helper**

Create `D:\mcd\tests\config.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { expandHome, defaultConfigDir, defaultConfigPath, defaultCachePath } from "../src/config/paths.js";

describe("paths", () => {
  it("expandHome expands ~ to home dir", () => {
    expect(expandHome("~/foo")).toBe(path.join(os.homedir(), "foo"));
  });

  it("expandHome leaves non-tilde paths untouched", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
    expect(expandHome("C:/abs/path")).toBe("C:/abs/path");
  });

  it("defaultConfigDir points under home", () => {
    expect(defaultConfigDir()).toBe(path.join(os.homedir(), ".devresearch-mcp"));
  });

  it("defaultConfigPath is config.toml under config dir", () => {
    expect(defaultConfigPath()).toBe(path.join(os.homedir(), ".devresearch-mcp", "config.toml"));
  });

  it("defaultCachePath is cache.db under config dir", () => {
    expect(defaultCachePath()).toBe(path.join(os.homedir(), ".devresearch-mcp", "cache.db"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/config.test.ts
```
Expected: FAIL — module `../src/config/paths.js` does not exist.

- [ ] **Step 3: Implement paths module**

Create `D:\mcd\src\config\paths.ts`:
```typescript
import os from "node:os";
import path from "node:path";

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export function defaultConfigDir(): string {
  return path.join(os.homedir(), ".devresearch-mcp");
}

export function defaultConfigPath(): string {
  return path.join(defaultConfigDir(), "config.toml");
}

export function defaultCachePath(): string {
  return path.join(defaultConfigDir(), "cache.db");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/config.test.ts
```
Expected: 5 passing tests.

- [ ] **Step 5: Write `schema.ts`**

Create `D:\mcd\src\config\schema.ts`:
```typescript
import { z } from "zod";

export const ConfigSchema = z.object({
  sources: z.object({
    enabled: z.array(z.enum(["hn", "reddit", "lobsters"])).default(["hn", "reddit", "lobsters"]),
    reddit: z.object({
      subreddits: z.array(z.string().min(1)).default([
        "programming", "rust", "golang", "javascript", "typescript",
        "MachineLearning", "LocalLLaMA", "webdev", "ExperiencedDevs", "cpp",
      ]),
    }).default({}),
  }).default({}),
  cache: z.object({
    ttl_hours: z.number().int().positive().default(24),
    path: z.string().default("~/.devresearch-mcp/cache.db"),
  }).default({}),
  llm: z.object({
    provider: z.enum(["anthropic"]).default("anthropic"),
    model: z.string().default("claude-haiku-4-5"),
  }).default({}),
  filters: z.object({
    drop_patterns: z.array(z.string()).default([
      "^Show HN: My .*",
      "\\[HIRING\\]",
      "\\[JOB\\]",
    ]),
  }).default({}),
  hype_scoring: z.object({
    hype_threshold: z.number().min(0).max(100).default(70),
    substance_threshold: z.number().min(0).max(100).default(60),
    buzzwords: z.array(z.string()).default([
      "game changer", "revolutionary", "mind-blowing", "next-gen", "disrupt",
    ]),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
```

- [ ] **Step 6: Write `defaults.ts`**

Create `D:\mcd\src\config\defaults.ts`:
```typescript
export const DEFAULT_CONFIG_TOML = `# devresearch-mcp configuration
# See README for full schema + defaults.

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
drop_patterns = ["^Show HN: My .*", "\\\\[HIRING\\\\]", "\\\\[JOB\\\\]"]

[hype_scoring]
hype_threshold = 70
substance_threshold = 60
buzzwords = ["game changer", "revolutionary", "mind-blowing", "next-gen", "disrupt"]
`;
```

- [ ] **Step 7: Commit**

```bash
git add src/config tests/config.test.ts
git commit -m "feat(config): add zod schema, defaults, path helpers"
```

---

### Task 4: Config loader (TDD)

**Files:**
- Create: `D:\mcd\src\config\loader.ts`
- Modify: `D:\mcd\tests\config.test.ts` (add loader test block)

- [ ] **Step 1: Add failing tests for loader**

Append to `D:\mcd\tests\config.test.ts`:
```typescript
import { describe as describeLoader, it as itLoader, expect as expectLoader, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config/loader.js";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

describeLoader("loadConfig", () => {
  const tmpDir = path.join(os.tmpdir(), "devresearch-mcp-test-" + Date.now());
  const tmpConfigPath = path.join(tmpDir, "config.toml");

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  itLoader("creates default config when file missing", () => {
    const cfg = loadConfig(tmpConfigPath);
    expect(fs.existsSync(tmpConfigPath)).toBe(true);
    expect(cfg.sources.enabled).toEqual(["hn", "reddit", "lobsters"]);
    expect(cfg.cache.ttl_hours).toBe(24);
    expect(cfg.llm.model).toBe("claude-haiku-4-5");
  });

  itLoader("reads existing config", () => {
    fs.writeFileSync(tmpConfigPath, `
[cache]
ttl_hours = 48
`);
    const cfg = loadConfig(tmpConfigPath);
    expect(cfg.cache.ttl_hours).toBe(48);
    expect(cfg.sources.enabled).toEqual(["hn", "reddit", "lobsters"]);
  });

  itLoader("throws with clear message on invalid TOML", () => {
    fs.writeFileSync(tmpConfigPath, "this is not toml ][");
    expect(() => loadConfig(tmpConfigPath)).toThrow(/config.*parse/i);
  });

  itLoader("throws on invalid schema", () => {
    fs.writeFileSync(tmpConfigPath, `
[cache]
ttl_hours = -1
`);
    expect(() => loadConfig(tmpConfigPath)).toThrow(/config.*invalid|positive/i);
  });
});
```

Note: top-level `path`, `os`, `fs` imports are already present. Remove duplicates if needed — or consolidate under single `describe` by merging with existing block. Prefer consolidating: rename the outer `describe("paths"...)` to keep. Final file has TWO describe blocks sharing imports.

Clean reformat — replace entire `tests/config.test.ts` with:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandHome, defaultConfigDir, defaultConfigPath, defaultCachePath } from "../src/config/paths.js";
import { loadConfig } from "../src/config/loader.js";

describe("paths", () => {
  it("expandHome expands ~ to home dir", () => {
    expect(expandHome("~/foo")).toBe(path.join(os.homedir(), "foo"));
  });
  it("expandHome leaves non-tilde paths untouched", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
    expect(expandHome("C:/abs/path")).toBe("C:/abs/path");
  });
  it("defaultConfigDir points under home", () => {
    expect(defaultConfigDir()).toBe(path.join(os.homedir(), ".devresearch-mcp"));
  });
  it("defaultConfigPath is config.toml under config dir", () => {
    expect(defaultConfigPath()).toBe(path.join(os.homedir(), ".devresearch-mcp", "config.toml"));
  });
  it("defaultCachePath is cache.db under config dir", () => {
    expect(defaultCachePath()).toBe(path.join(os.homedir(), ".devresearch-mcp", "cache.db"));
  });
});

describe("loadConfig", () => {
  const tmpDir = path.join(os.tmpdir(), "devresearch-mcp-test-" + Date.now());
  const tmpConfigPath = path.join(tmpDir, "config.toml");

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates default config when file missing", () => {
    const cfg = loadConfig(tmpConfigPath);
    expect(fs.existsSync(tmpConfigPath)).toBe(true);
    expect(cfg.sources.enabled).toEqual(["hn", "reddit", "lobsters"]);
    expect(cfg.cache.ttl_hours).toBe(24);
    expect(cfg.llm.model).toBe("claude-haiku-4-5");
  });

  it("reads existing config and merges with defaults", () => {
    fs.writeFileSync(tmpConfigPath, `
[cache]
ttl_hours = 48
`);
    const cfg = loadConfig(tmpConfigPath);
    expect(cfg.cache.ttl_hours).toBe(48);
    expect(cfg.sources.enabled).toEqual(["hn", "reddit", "lobsters"]);
  });

  it("throws with clear message on invalid TOML", () => {
    fs.writeFileSync(tmpConfigPath, "this is not toml ][");
    expect(() => loadConfig(tmpConfigPath)).toThrow(/parse|TOML|invalid/i);
  });

  it("throws on schema violation (negative ttl)", () => {
    fs.writeFileSync(tmpConfigPath, `
[cache]
ttl_hours = -1
`);
    expect(() => loadConfig(tmpConfigPath)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify loader tests fail**

```bash
npm test -- tests/config.test.ts
```
Expected: paths tests pass (5); loader tests fail — `loadConfig` not implemented.

- [ ] **Step 3: Implement `loader.ts`**

Create `D:\mcd\src\config\loader.ts`:
```typescript
import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { ZodError } from "zod";
import { ConfigSchema, type Config } from "./schema.js";
import { DEFAULT_CONFIG_TOML } from "./defaults.js";
import { defaultConfigPath } from "./paths.js";

export function loadConfig(configPath: string = defaultConfigPath()): Config {
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, DEFAULT_CONFIG_TOML, "utf8");
  }

  const raw = fs.readFileSync(configPath, "utf8");

  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Config parse error (${configPath}): ${msg}`);
  }

  try {
    return ConfigSchema.parse(parsed);
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
      throw new Error(`Config invalid (${configPath}):\n${details}`);
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npm test -- tests/config.test.ts
```
Expected: 9 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/config/loader.ts tests/config.test.ts
git commit -m "feat(config): add TOML loader with validation"
```

---

### Task 5: SQLite schema + DB module (TDD)

**Files:**
- Create: `D:\mcd\src\storage\schema.sql`
- Create: `D:\mcd\src\storage\db.ts`
- Create: `D:\mcd\src\types.ts`
- Test: `D:\mcd\tests\db.test.ts`

- [ ] **Step 1: Write `schema.sql`**

Create `D:\mcd\src\storage\schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  last_poll TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  source_id INTEGER,
  url TEXT,
  title TEXT,
  author TEXT,
  score INTEGER,
  ts TEXT,
  cluster_id TEXT,
  raw_json TEXT,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  author TEXT,
  author_karma INTEGER,
  text TEXT,
  parent_id TEXT,
  score INTEGER,
  ts TEXT,
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  canonical_url TEXT,
  canonical_title TEXT,
  topic_tags TEXT,
  first_seen TEXT,
  last_updated TEXT
);

CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,
  content_json TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL DEFAULT 86400
);

CREATE INDEX IF NOT EXISTS idx_items_cluster ON items(cluster_id);
CREATE INDEX IF NOT EXISTS idx_items_ts ON items(ts);
CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_id);
CREATE INDEX IF NOT EXISTS idx_analyses_key ON analyses(key);

INSERT OR IGNORE INTO sources (name, weight) VALUES
  ('hn', 1.0),
  ('reddit', 1.0),
  ('lobsters', 1.0);
```

- [ ] **Step 2: Write failing DB test**

Create `D:\mcd\tests\db.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/storage/db.js";

describe("openDb", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devresearch-mcp-db-"));
    dbPath = path.join(tmpDir, "cache.db");
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates database file", () => {
    const db = openDb(dbPath);
    db.close();
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("creates all required tables", () => {
    const db = openDb(dbPath);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tableNames = rows.map((r) => r.name);
    expect(tableNames).toContain("sources");
    expect(tableNames).toContain("items");
    expect(tableNames).toContain("comments");
    expect(tableNames).toContain("clusters");
    expect(tableNames).toContain("analyses");
    db.close();
  });

  it("seeds default sources", () => {
    const db = openDb(dbPath);
    const names = (
      db.prepare("SELECT name FROM sources ORDER BY name").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(names).toEqual(["hn", "lobsters", "reddit"]);
    db.close();
  });

  it("is idempotent — second open does not error", () => {
    openDb(dbPath).close();
    const db = openDb(dbPath);
    const count = (db.prepare("SELECT COUNT(*) as n FROM sources").get() as { n: number }).n;
    expect(count).toBe(3);
    db.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- tests/db.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `db.ts`**

Create `D:\mcd\src\storage\db.ts`:
```typescript
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

export function openDb(dbPath: string): DatabaseType {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schemaSql);

  return db;
}
```

- [ ] **Step 5: Configure TypeScript to copy schema.sql to dist**

The `db.ts` reads `schema.sql` relative to its compiled location. At build time we need the SQL file alongside the JS. Simplest approach: change `db.ts` to embed the SQL as a string via a generated `.ts` file, OR add a `postbuild` copy step.

Chose the copy approach. Update `package.json` `scripts.build`:
```json
"build": "tsc && node -e \"require('fs').copyFileSync('src/storage/schema.sql', 'dist/storage/schema.sql')\""
```

Edit `D:\mcd\package.json` — replace `"build": "tsc"` with the line above.

- [ ] **Step 6: Run DB tests**

```bash
npm test -- tests/db.test.ts
```
Expected: 4 passing tests. Note: tests run via `tsx`/Vitest so schema.sql is read from `src/storage/`, not `dist/`. This works because `__dirname` resolves to `src/storage/` during test runs.

- [ ] **Step 7: Write `types.ts` placeholder**

Create `D:\mcd\src\types.ts`:
```typescript
export type Platform = "hn" | "reddit" | "lobsters";

export interface NormalizedItem {
  id: string;
  platform: Platform;
  url: string;
  title: string;
  author: string;
  score: number;
  ts: string;
  raw: unknown;
}

export interface NormalizedComment {
  id: string;
  itemId: string;
  author: string;
  authorKarma?: number;
  text: string;
  parentId?: string;
  score: number;
  ts: string;
}
```

- [ ] **Step 8: Commit**

```bash
git add src/storage src/types.ts tests/db.test.ts package.json
git commit -m "feat(storage): add SQLite schema, openDb, and base types"
```

---

### Task 6: MCP server skeleton

**Files:**
- Modify: `D:\mcd\src\index.ts`
- Create: `D:\mcd\README.md`

- [ ] **Step 1: Replace `src/index.ts` with server skeleton**

Overwrite `D:\mcd\src\index.ts`:
```typescript
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config/loader.js";
import { defaultConfigPath, defaultCachePath, expandHome } from "./config/paths.js";
import { openDb } from "./storage/db.js";

async function main(): Promise<void> {
  const configPath = process.env.DEVRESEARCH_CONFIG ?? defaultConfigPath();
  const config = loadConfig(configPath);

  const cachePath = expandHome(config.cache.path || defaultCachePath());
  const db = openDb(cachePath);

  const server = new Server(
    { name: "devresearch-mcp", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    throw new Error(`Unknown tool: ${req.params.name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = (): void => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Log to stderr (stdout is reserved for JSON-RPC traffic)
  process.stderr.write(`devresearch-mcp ready (config=${configPath}, cache=${cachePath})\n`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`devresearch-mcp fatal: ${msg}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Build and verify output**

```bash
npm run build
```
Expected: `dist/index.js`, `dist/config/*.js`, `dist/storage/*.js`, `dist/storage/schema.sql` all present.

Run:
```bash
ls D:/mcd/dist
ls D:/mcd/dist/storage
```
Expected: includes `index.js` in `dist/` and `schema.sql` in `dist/storage/`.

- [ ] **Step 4: Smoke-test the server manually**

Start server (it will wait on stdin for JSON-RPC):
```bash
node D:/mcd/dist/index.js
```

In a separate terminal, or same one via stdin, send a tools/list request. Easiest: pipe it in.

Test one-shot from bash:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node D:/mcd/dist/index.js
```
Expected: the server should read the request and emit a JSON response like `{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}` on stdout, then wait for more input (close stdin to exit). The "ready" message appears on stderr.

Also verify `~/.devresearch-mcp/config.toml` and `~/.devresearch-mcp/cache.db` now exist:
```bash
ls ~/.devresearch-mcp/
```
Expected: both files exist.

- [ ] **Step 5: Write README stub**

Create `D:\mcd\README.md`:
```markdown
# devresearch-mcp

Cross-platform developer research MCP — searches Hacker News, Reddit, and Lobsters, with automatic hype-vs-substance detection from comment analysis.

> **Status:** Phase 1 (foundation) — not functional yet. See `docs/superpowers/specs/2026-04-21-devresearch-mcp-design.md` for design, `docs/superpowers/plans/` for phase plans.

## Install (dev)

```bash
npm install
npm run build
```

## Run (dev)

```bash
npm run dev
```

## Claude Code `.mcp.json` (once published)

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

## License

MIT
```

- [ ] **Step 6: Run full test suite**

```bash
npm test
```
Expected: 13 tests passing (5 paths + 4 loader + 4 db).

- [ ] **Step 7: Commit**

```bash
git add src/index.ts README.md
git commit -m "feat: add MCP server skeleton with stdio transport and empty tool list"
```

---

## Phase 1 Done Criteria

- [ ] `npm install` succeeds on clean clone
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm test` passes — 13 tests green
- [ ] `npm run build` produces working `dist/index.js` + `dist/storage/schema.sql`
- [ ] Piping `tools/list` to the built server returns `{"tools":[]}` JSON-RPC response
- [ ] First run creates `~/.devresearch-mcp/config.toml` (valid TOML) and `~/.devresearch-mcp/cache.db` (5 tables seeded)
- [ ] 4 git commits made with conventional commit messages
- [ ] No code in `dist/` checked in (verified by `.gitignore`)

After Phase 1 completes, user runs `/compact` to reset context before Phase 2 plan is written.

---

## Self-Review Notes

- **Spec coverage (Phase 1 scope only):** §9 schema fully covered; §11 config fully covered; architecture §5 storage + MCP layer done; fetchers (§7), heuristics (§8), tools (§6), LLM (§10) deliberately deferred to later phases.
- **Placeholder scan:** `types.ts` intentionally has placeholder types (no logic) — used by Phase 2. That is documented, not a plan failure.
- **Type consistency:** `Config` type re-used across files; `NormalizedItem` / `NormalizedComment` names match DB column semantics (`author_karma` in DB ↔ `authorKarma` camelCase in TS).
- **Ambiguity check:** The `schema.sql` copy-to-dist step is explicit (Task 5 Step 5) to avoid runtime "schema.sql not found" surprises.
