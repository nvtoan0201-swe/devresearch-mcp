import { describe, it, expect, vi } from "vitest";
import {
  httpGetJson,
  httpGetText,
  HttpError,
} from "../../src/fetchers/http.js";

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

describe("HttpError shape", () => {
  it("surfaces UPSTREAM_HTTP_ERROR with status on non-retryable 4xx", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response("nope", {
          status: 404,
          headers: { "content-type": "text/plain" },
        }),
      );
    const err = await httpGetJson("https://x.test/", {
      fetchFn,
      retries: 0,
      backoffMs: 1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.code).toBe("UPSTREAM_HTTP_ERROR");
    expect(err.status).toBe(404);
  });

  it("surfaces UPSTREAM_TIMEOUT when aborted", async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const err = await httpGetJson("https://x.test/", {
      fetchFn,
      timeoutMs: 5,
      retries: 0,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.code).toBe("UPSTREAM_TIMEOUT");
  });

  it("surfaces UPSTREAM_UNREACHABLE on network error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const err = await httpGetJson("https://x.test/", {
      fetchFn,
      retries: 0,
      backoffMs: 1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.code).toBe("UPSTREAM_UNREACHABLE");
    expect(err.message).toMatch(/fetch failed/);
  });

  it("parses numeric Retry-After on final 429", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("rate-limited", {
        status: 429,
        headers: { "retry-after": "42", "content-type": "text/plain" },
      }),
    );
    const err = await httpGetJson("https://x.test/", {
      fetchFn,
      retries: 0,
      backoffMs: 1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.retryAfter).toBe(42);
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
