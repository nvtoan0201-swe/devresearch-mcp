import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  expandHome,
  defaultConfigDir,
  defaultConfigPath,
  defaultCachePath,
} from "../src/config/paths.js";
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
    expect(defaultConfigPath()).toBe(
      path.join(os.homedir(), ".devresearch-mcp", "config.toml"),
    );
  });
  it("defaultCachePath is cache.db under config dir", () => {
    expect(defaultCachePath()).toBe(
      path.join(os.homedir(), ".devresearch-mcp", "cache.db"),
    );
  });
});

describe("loadConfig", () => {
  let tmpDir: string;
  let tmpConfigPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devresearch-mcp-test-"));
    tmpConfigPath = path.join(tmpDir, "config.toml");
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
    fs.writeFileSync(
      tmpConfigPath,
      `
[cache]
ttl_hours = 48
`,
    );
    const cfg = loadConfig(tmpConfigPath);
    expect(cfg.cache.ttl_hours).toBe(48);
    expect(cfg.sources.enabled).toEqual(["hn", "reddit", "lobsters"]);
  });

  it("throws with clear message on invalid TOML", () => {
    fs.writeFileSync(tmpConfigPath, "this is not toml ][");
    expect(() => loadConfig(tmpConfigPath)).toThrow(/parse|TOML|invalid/i);
  });

  it("throws on schema violation (negative ttl)", () => {
    fs.writeFileSync(
      tmpConfigPath,
      `
[cache]
ttl_hours = -1
`,
    );
    expect(() => loadConfig(tmpConfigPath)).toThrow();
  });
});
