import { logger } from "../logger";

/** Token bucket; `take()` resolves when a request may be sent. Process-local by design. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly perSecond: number,
    private readonly burst: number = Math.max(1, Math.ceil(perSecond)),
  ) {
    this.tokens = burst;
  }

  take(): Promise<void> {
    const next = this.queue.then(() => this.acquire());
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Pause everyone, e.g. after a 429 with Retry-After. */
  penalize(ms: number): void {
    this.tokens = Math.min(this.tokens, 0) - (ms / 1000) * this.perSecond;
  }

  private async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const wait = ((1 - this.tokens) / this.perSecond) * 1000;
      await sleep(Math.ceil(wait));
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${url.replace(/api_key=[^&]+/, "api_key=***")}`);
  }
}

export interface FetchJsonOptions {
  limiter?: RateLimiter;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  retries?: number;
  timeoutMs?: number;
}

/** fetch + JSON with timeout, 429/5xx retries and exponential backoff. */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  let attempt = 0;
  for (;;) {
    await opts.limiter?.take();
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...opts.headers },
        body: opts.body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
    } catch (err) {
      if (attempt++ >= retries) throw err;
      await sleep(backoff(attempt));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt + 1);
      if (res.status === 429) opts.limiter?.penalize(wait);
      if (attempt++ >= retries) throw new HttpError(res.status, url, await res.text());
      logger.debug({ status: res.status, wait }, "retrying provider request");
      await sleep(Math.min(wait, 60_000));
      continue;
    }
    if (!res.ok) throw new HttpError(res.status, url, await res.text());
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

function backoff(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** attempt + Math.random() * 250);
}

export const USER_AGENT = "Spoter/0.1 (+https://github.com/BurgiSimon/spoter)";
