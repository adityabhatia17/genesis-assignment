import type { Request, RequestHandler } from 'express';
import type { RateLimiter, RateLimitRule } from '../../modules/rate-limit/rate-limiter.js';
import { AppError } from '../../shared/app-error.js';
import { requireUid } from '../define-handler.js';

/** After requireAuth. A denial is 429 RATE_LIMITED and does not call the handler. */
export function rateLimit(
  limiter: RateLimiter,
  rule: RateLimitRule,
  subject: (req: Request) => string = (req) => requireUid(req),
): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      try {
        const result = await limiter.consume(rule, subject(req));
        if (!result.allowed) {
          next(new AppError('RATE_LIMITED', undefined, { retryAfterMs: result.retryAfterMs }));
          return;
        }
        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}
