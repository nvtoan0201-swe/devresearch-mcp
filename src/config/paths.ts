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
