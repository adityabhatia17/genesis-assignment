import { sleep as defaultSleep } from '../../../shared/async.js';
import type { Logger } from '../../../shared/logger.js';
import { extractTraceId, HlApiError, sanitizeHlMessage } from './hl-errors.js';

export type HlVersion = '2021-07-28' | '2021-04-15';
export const HL_VERSION = {
  contacts: '2021-07-28',
  locations: '2021-07-28',
  conversations: '2021-04-15',
  calendars: '2021-04-15',
} as const satisfies Record<string, HlVersion>;

export interface HlRequest {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  version: HlVersion;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  accessToken: string;
  locationId: string;
  timeoutMs?: number;
}

export interface HlHttp {
  request(req: HlRequest): Promise<unknown>;
}

export interface HlHttpOptions {
  baseUrl: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const templatePath = (path: string) => path.replace(/\/[A-Za-z0-9_-]{12,}(?=\/|$)/g, '/:id');
const backoffMs = (attempt: number) =>
  Math.min(2_000, 300 * 2 ** attempt) + Math.floor(Math.random() * 150);
const parseRetryAfter = (h: string | null): number | null => {
  if (!h) return null;
  const secs = Number(h);
  return Number.isFinite(secs) ? Math.min(10_000, Math.max(0, secs * 1000)) : null;
};

export function createHlHttpClient(o: HlHttpOptions): HlHttp {
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => defaultSleep(ms));
  const maxRetries = o.maxRetries ?? 2;

  return {
    async request(r) {
      const url = new URL(o.baseUrl + r.path);
      for (const [k, v] of Object.entries(r.query ?? {}))
        if (v !== undefined) url.searchParams.set(k, String(v));
      const isWrite = r.method !== 'GET';

      for (let attempt = 0; ; attempt += 1) {
        const started = Date.now();
        let res: Response;
        try {
          res = await doFetch(url, {
            method: r.method,
            headers: {
              Authorization: `Bearer ${r.accessToken}`,
              Version: r.version,
              Accept: 'application/json',
              ...(r.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            body: r.body !== undefined ? JSON.stringify(r.body) : undefined,
            signal: AbortSignal.timeout(r.timeoutMs ?? 15_000),
          });
        } catch {
          // Network error / timeout: a write may already have been applied, so never retry writes.
          if (!isWrite && attempt < maxRetries) {
            await sleep(backoffMs(attempt));
            continue;
          }
          throw new HlApiError(0, 'Network error calling HighLevel', null, null);
        }

        const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
        o.logger.info('hl.call', {
          method: r.method,
          path: templatePath(r.path),
          status: res.status,
          ms: Date.now() - started,
          rateRemaining: res.headers.get('x-ratelimit-remaining'),
          dailyRemaining: res.headers.get('x-ratelimit-daily-remaining'),
        });
        if (res.ok) {
          const text = await res.text();
          return text ? (JSON.parse(text) as unknown) : null;
        }
        const body: unknown = await res.json().catch(() => null);
        const retryable = res.status === 429 || (res.status >= 500 && !isWrite);
        if (retryable && attempt < maxRetries) {
          await sleep(retryAfterMs ?? backoffMs(attempt));
          continue;
        }
        throw new HlApiError(
          res.status,
          sanitizeHlMessage(body),
          extractTraceId(body),
          retryAfterMs,
        );
      }
    },
  };
}
