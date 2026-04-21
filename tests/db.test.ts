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
      db.prepare("SELECT name FROM sources ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(names).toEqual(["hn", "lobsters", "reddit"]);
    db.close();
  });

  it("is idempotent — second open does not error", () => {
    openDb(dbPath).close();
    const db = openDb(dbPath);
    const count = (
      db.prepare("SELECT COUNT(*) as n FROM sources").get() as { n: number }
    ).n;
    expect(count).toBe(3);
    db.close();
  });
});
