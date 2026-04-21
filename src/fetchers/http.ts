export type HttpErrorCode =
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_HTTP_ERROR"
  | "UPSTREAM_UNREACHABLE"
  | "UNKNOWN";

export interface HttpErrorInit {
  code: HttpErrorCode;
  message: string;
  url: string;
  status?: number;
  retryAfter?: number;
}

export class HttpError extends Error {
  readonly code: HttpErrorCode;
  readonly url: string;
  readonly status?: number;
  readonly retryAfter?: number;

  constructor(init: HttpErrorInit) {
    super(init.message);
    this.name = "HttpError";
    this.code = init.code;
    this.url = init.url;
    this.status = init.status;
    this.retryAfter = init.retryAfter;
  }
}

export interface HttpOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  jitterMs?: number;
  userAgent?: string;
  headers?: Record<string, string>;
}

const DEFAULT_UA = "devresearch-mcp/0.2.0 (+https://github.com/nvtoan0201-swe/devresearch-mcp)";
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF = 500;
const DEFAULT_JITTER = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return secs;
  const ts = Date.parse(header);
  if (!Number.isNaN(ts)) {
    const diff = Math.ceil((ts - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
  }
  return undefined;
}

function backoffDelay(attempt: number, base: number, jitter: number, retryAfter?: number): number {
  if (retryAfter !== undefined) return Math.max(0, retryAfter * 1000);
  const jitterAmount = jitter > 0 ? Math.floor(Math.random() * jitter) : 0;
  return base * 2 ** attempt + jitterAmount;
}

async function httpGetRaw(url: string, options: HttpOptions): Promise<Response> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF;
  const jitterMs = options.jitterMs ?? DEFAULT_JITTER;

  const headers: Record<string, string> = {
    "user-agent": options.userAgent ?? DEFAULT_UA,
    accept: "application/json, text/plain, */*",
    ...options.headers,
  };

  let attempt = 0;
  let lastErr: HttpError | undefined;
  while (attempt <= retries) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { headers, signal: ac.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      if (!isRetryable(res.status) || attempt === retries) {
        const body = await safeText(res);
        throw new HttpError({
          code: "UPSTREAM_HTTP_ERROR",
          message: `HTTP ${res.status} ${url}: ${body.slice(0, 200)}`,
          url,
          status: res.status,
          retryAfter,
        });
      }
      lastErr = new HttpError({
        code: "UPSTREAM_HTTP_ERROR",
        message: `HTTP ${res.status} ${url}`,
        url,
        status: res.status,
        retryAfter,
      });
      await sleep(backoffDelay(attempt, backoffMs, jitterMs, retryAfter));
      attempt += 1;
      continue;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof HttpError) {
        throw err;
      }
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || /abort/i.test(err.message));
      if (isAbort) {
        lastErr = new HttpError({
          code: "UPSTREAM_TIMEOUT",
          message: `HTTP timeout after ${timeoutMs}ms: ${url}`,
          url,
        });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lastErr = new HttpError({
          code: "UPSTREAM_UNREACHABLE",
          message: `Network error: ${msg} (${url})`,
          url,
        });
      }
      if (attempt === retries) throw lastErr;
      await sleep(backoffDelay(attempt, backoffMs, jitterMs));
      attempt += 1;
    }
  }
  throw (
    lastErr ??
    new HttpError({ code: "UNKNOWN", message: `HTTP failed: ${url}`, url })
  );
}

export async function httpGetJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const res = await httpGetRaw(url, options);
  return (await res.json()) as T;
}

export async function httpGetText(url: string, options: HttpOptions = {}): Promise<string> {
  const res = await httpGetRaw(url, options);
  return res.text();
}
