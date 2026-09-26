import { z } from 'zod';
import { AppError } from '../../../shared/app-error.js';

export class HlApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly traceId: string | null,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = 'HlApiError';
  }
}

const ErrorBody = z
  .object({
    message: z.union([z.string(), z.array(z.string())]).optional(),
    error: z.string().optional(),
    traceId: z.string().optional(),
  })
  .passthrough();

export function sanitizeHlMessage(body: unknown): string {
  const parsed = ErrorBody.safeParse(body);
  const raw = parsed.success ? (parsed.data.message ?? parsed.data.error) : undefined;
  const text = Array.isArray(raw) ? raw.join('; ') : raw;
  if (!text) return 'HighLevel request failed';
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9._-]{32,}/g, '[redacted]')
    .slice(0, 300);
}

export function extractTraceId(body: unknown): string | null {
  const parsed = ErrorBody.safeParse(body);
  return parsed.success ? (parsed.data.traceId ?? null) : null;
}

export function hlErrorToAppError(err: HlApiError): AppError {
  const cause = { cause: err };
  if (err.status === 401) return new AppError('HL_REAUTH_REQUIRED', undefined, undefined, cause);
  if (err.status === 403) {
    return new AppError(
      /scope/i.test(err.message) ? 'HL_SCOPE_MISSING' : 'HL_FORBIDDEN',
      undefined,
      undefined,
      cause,
    );
  }
  if (err.status === 404) return new AppError('HL_NOT_FOUND', undefined, undefined, cause);
  if (err.status === 400 || err.status === 422)
    return new AppError('HL_BAD_REQUEST', err.message, undefined, cause);
  if (err.status === 429) {
    return new AppError(
      'HL_RATE_LIMITED',
      undefined,
      err.retryAfterMs ? { retryAfterMs: err.retryAfterMs } : undefined,
      cause,
    );
  }
  return new AppError('HL_UNAVAILABLE', undefined, undefined, cause);
}
