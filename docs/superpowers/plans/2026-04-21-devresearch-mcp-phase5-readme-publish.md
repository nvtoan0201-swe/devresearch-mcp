# devresearch-mcp Phase 5 — README + npm publish prep

> **For agentic workers:** Execute tasks in order. Each step is bite-sized. Run verifications as specified.

**Goal:** Ship-ready npm package — production README, LICENSE, polished `package.json`, clean `npm pack` output, passing `npm publish --dry-run`.

**Architecture:** No runtime code changes. Pure docs + packaging polish.

**Tech Stack:** npm, Markdown, MIT license.

---

## Task 1: Add LICENSE file

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Write MIT license**

Use standard MIT template, holder = "Toan Nguyen", year = 2026.

- [ ] **Step 2: Verify**

`ls D:/mcd/LICENSE` shows file.

---

## Task 2: Rewrite README.md (production-quality)

**Files:**
- Modify: `README.md` (full rewrite)

Sections required:
1. Title + one-line pitch + npm version badge placeholder
2. What it does (3-4 bullet points, concrete)
3. Install — Claude Code `.mcp.json` block (published usage)
4. Local dev — clone + build + link
5. Configuration — TOML example at `~/.devresearch-mcp/config.toml`, all sections (sources, cache, llm, filters, hype_scoring)
6. Environment variables — `ANTHROPIC_API_KEY`, `DEVRESEARCH_CONFIG`
7. Tools — all 5 (`search`, `get_post`, `get_user`, `trending`, `research`) with input schema + sample output JSON
8. Heuristic scoring — brief explanation of the 7 signals (velocity, dissent, expert, buzzword, depth, longevity, overall)
9. Architecture — one-paragraph summary + file map
10. Limitations
11. License

- [ ] **Step 1: Draft full README**

Write all 11 sections. Use code fences with `json`, `toml`, `bash` tags. Keep it scannable — bullet lists, tables for config, short paragraphs.

- [ ] **Step 2: Verify**

- README is > 200 lines (production doc, not stub)
- Contains one `json` block per tool showing realistic output
- Contains TOML config block
- Contains `npx -y devresearch-mcp` reference

---

## Task 3: Polish package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version to 0.1.0 + add metadata fields**

Changes:
- `"version": "0.1.0"` (first public release)
- Add `"author": "Toan Nguyen"`
- Add `"repository": { "type": "git", "url": "git+https://github.com/toannd/devresearch-mcp.git" }`
- Add `"homepage": "https://github.com/toannd/devresearch-mcp#readme"`
- Add `"bugs": { "url": "https://github.com/toannd/devresearch-mcp/issues" }`
- Expand `"keywords"` to include: `hype-detection`, `research`, `claude-code`, `anthropic`, `developer-tools`
- Ensure `"files": ["dist", "README.md", "LICENSE"]`
- Add `"prepublishOnly": "npm run build && npm test"` script

- [ ] **Step 2: Verify shape**

`node -e "const p=require('./package.json'); console.log(JSON.stringify({bin:p.bin,files:p.files,main:p.main,version:p.version},null,2))"`

Expected: `version: "0.1.0"`, `files` includes dist/README.md/LICENSE, `bin.devresearch-mcp: "./dist/index.js"`.

---

## Task 4: Verify npm pack contents

- [ ] **Step 1: Dry-run pack**

Run: `npm pack --dry-run 2>&1 | head -100`

Expected: package contains only `dist/**`, `README.md`, `LICENSE`, `package.json`. **No** `tests/`, `docs/`, `src/`, `.omc/`, `node_modules/`, `cache.db`.

- [ ] **Step 2: If extra files leak**

Tighten `files` array in `package.json` or add `.npmignore`. Re-verify.

---

## Task 5: Full verification suite

- [ ] **Step 1: Type check**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Tests**

Run: `npm test`
Expected: all passing (103 from Phase 4).

- [ ] **Step 3: Clean build**

Run: `rm -rf dist && npm run build`
Expected: `dist/index.js` + all module subdirs present, `dist/storage/schema.sql` copied.

- [ ] **Step 4: Publish dry-run**

Run: `npm publish --dry-run 2>&1 | tail -40`
Expected: no errors. Confirms package is publishable.

---

## Task 6: Commits

Commit split:
1. `docs: add LICENSE + production README` (Task 1 + 2)
2. `chore(pkg): bump to 0.1.0 + add repo/author metadata` (Task 3)

- [ ] **Step 1: First commit**

```bash
git add LICENSE README.md
git commit -m "docs: add LICENSE and production README with tool reference"
```

- [ ] **Step 2: Second commit**

```bash
git add package.json
git commit -m "chore(pkg): bump to 0.1.0 and add publish metadata"
```

- [ ] **Step 3: Plan commit**

```bash
git add docs/superpowers/plans/2026-04-21-devresearch-mcp-phase5-readme-publish.md
git commit -m "docs: add phase 5 plan for README and publish prep"
```

---

## Done criteria

- LICENSE present, MIT, correct holder
- README has all 11 sections, every tool documented with sample output
- `package.json` version 0.1.0, has repository/homepage/bugs/author
- `npm pack --dry-run` shows clean file list
- `npm publish --dry-run` passes
- Tests green, typecheck clean, build clean
- 3 commits landed on main
