import { describe, it, expect, vi } from "vitest";
import { createAnthropicClient } from "../../src/llm/client.js";
import { ConfigSchema } from "../../src/config/schema.js";

function okResponse(text: string): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("createAnthropicClient", () => {
  it("POSTs to the messages endpoint with correct payload and extracts text", async () => {
    const fetchSpy = vi.fn(async () => okResponse("hello world"));
    const client = createAnthropicClient(
      ConfigSchema.parse({}),
      "sk-test",
      { fetch: fetchSpy as unknown as typeof fetch },
    );
    const out = await client.complete("prompt-x");
    expect(out).toBe("hello world");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body as string) as {
      model: string;
      max_tokens: number;
      temperature: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.max_tokens).toBe(2000);
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toEqual([{ role: "user", content: "prompt-x" }]);
  });

  it("rejects when API returns non-2xx", async () => {
    const fetchSpy = vi.fn(
      async () => new Response("boom", { status: 500, statusText: "err" }),
    );
    const client = createAnthropicClient(
      ConfigSchema.parse({}),
      "sk-test",
      { fetch: fetchSpy as unknown as typeof fetch },
    );
    await expect(client.complete("x")).rejects.toThrow(/500/);
  });

  it("returns empty string when content block missing", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createAnthropicClient(
      ConfigSchema.parse({}),
      "sk-test",
      { fetch: fetchSpy as unknown as typeof fetch },
    );
    expect(await client.complete("x")).toBe("");
  });
});
