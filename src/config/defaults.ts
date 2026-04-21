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
