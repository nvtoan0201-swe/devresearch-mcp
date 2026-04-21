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
