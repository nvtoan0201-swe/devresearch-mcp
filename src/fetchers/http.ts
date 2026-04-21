export interface HttpOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  userAgent?: string;
  headers?: Record<string, string>;
}

const DEFAULT_UA = "devresearch-mcp/0.0.1 (+https://github.com/)";
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function httpGetRaw(url: string, options: HttpOptions): Promise<Response> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF;

  const headers: Record<string, string> = {
    "user-agent": options.userAgent ?? DEFAULT_UA,
    accept: "application/json, text/plain, */*",
    ...options.headers,
  };

  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= retries) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { headers, signal: ac.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      if (!isRetryable(res.status) || attempt === retries) {
        const body = await safeText(res);
        throw new Error(`HTTP ${res.status} ${url}: ${body.slice(0, 200)}`);
      }
      await sleep(backoffMs * 2 ** attempt);
      attempt += 1;
      continue;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || /abort/i.test(err.message));
      if (isAbort) {
        if (attempt === retries) {
          throw new Error(`HTTP timeout after ${timeoutMs}ms: ${url}`);
        }
        await sleep(backoffMs * 2 ** attempt);
        attempt += 1;
        continue;
      }
      if (err instanceof Error && err.message.startsWith("HTTP ")) {
        throw err;
      }
      if (attempt === retries) throw err;
      await sleep(backoffMs * 2 ** attempt);
      attempt += 1;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`HTTP failed: ${url}`);
}

export async function httpGetJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const res = await httpGetRaw(url, options);
  return (await res.json()) as T;
}

export async function httpGetText(url: string, options: HttpOptions = {}): Promise<string> {
  const res = await httpGetRaw(url, options);
  return res.text();
}
