import { describe, it, expect, vi } from "vitest";
import { httpGetJson, httpGetText } from "../../src/fetchers/http.js";

function makeResponse(
  status: number,
  body: unknown,
  opts: { contentType?: string } = {},
): Response {
  const headers = new Headers({
    "content-type": opts.contentType ?? "application/json",
  });
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers });
}

describe("httpGetJson", () => {
  it("returns parsed JSON on 200", async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse(200, { ok: true }));
    const out = await httpGetJson<{ ok: boolean }>("https://x.test/", {
      fetchFn,
    });
    expect(out).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("sends custom User-Agent header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse(200, {}));
    await httpGetJson("https://x.test/", { fetchFn, userAgent: "test-ua/1.0" });
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("user-agent")).toBe("test-ua/1.0");
  });

  it("retries on 429 then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, "rate-limited", { contentType: "text/plain" }))
      .mockResolvedValueOnce(makeResponse(200, { ok: 1 }));
    const out = await httpGetJson<{ ok: number }>("https://x.test/", {
      fetchFn,
      retries: 2,
      backoffMs: 1,
    });
    expect(out).toEqual({ ok: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 up to retries limit, then throws", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(makeResponse(500, "boom", { contentType: "text/plain" }));
    await expect(
      httpGetJson("https://x.test/", { fetchFn, retries: 2, backoffMs: 1 }),
    ).rejects.toThrow(/500/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 404", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(makeResponse(404, "not found", { contentType: "text/plain" }));
    await expect(
      httpGetJson("https://x.test/", { fetchFn, retries: 3, backoffMs: 1 }),
    ).rejects.toThrow(/404/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws on timeout", async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    await expect(
      httpGetJson("https://x.test/", { fetchFn, timeoutMs: 5, retries: 0 }),
    ).rejects.toThrow(/timeout|abort/i);
  });
});

describe("httpGetText", () => {
  it("returns raw text", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(makeResponse(200, "hello", { contentType: "text/plain" }));
    const out = await httpGetText("https://x.test/", { fetchFn });
    expect(out).toBe("hello");
  });
});
