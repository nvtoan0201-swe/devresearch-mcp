import type { Config } from "../config/schema.js";

export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

export interface AnthropicClientOptions {
  fetch?: typeof fetch;
}

interface AnthropicMessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

export function createAnthropicClient(
  config: Config,
  apiKey: string,
  options: AnthropicClientOptions = {},
): LlmClient {
  const fetchImpl = options.fetch ?? fetch;
  const { model, max_tokens: maxTokens, temperature } = config.llm;
  return {
    async complete(prompt: string): Promise<string> {
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Anthropic API ${res.status}: ${body.slice(0, 400) || res.statusText}`,
        );
      }
      const json = (await res.json()) as AnthropicMessagesResponse;
      const block = json.content?.find(
        (c) => c.type === "text" && typeof c.text === "string",
      );
      return block?.text ?? "";
    },
  };
}
