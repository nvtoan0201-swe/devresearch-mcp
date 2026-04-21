# devresearch-mcp

Cross-platform developer research MCP — searches Hacker News, Reddit, and Lobsters, with automatic hype-vs-substance detection from comment analysis.

> **Status:** Phase 1 (foundation) — not functional yet. See `docs/superpowers/specs/2026-04-21-devresearch-mcp-design.md` for the full design and `docs/superpowers/plans/` for phase plans.

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
