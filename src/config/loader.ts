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
      const details = err.issues
        .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      throw new Error(`Config invalid (${configPath}):\n${details}`);
    }
    throw err;
  }
}
