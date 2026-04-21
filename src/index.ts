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
      // ignore close errors on shutdown
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.stderr.write(
    `devresearch-mcp ready (config=${configPath}, cache=${cachePath})\n`,
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`devresearch-mcp fatal: ${msg}\n`);
  process.exit(1);
});
