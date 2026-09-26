import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../shared/app-error.js';
import { serializeError } from '../../shared/logger.js';

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return new AppError('VALIDATION_FAILED', undefined, { issues });
  }
  if (err instanceof SyntaxError && 'body' in err) return new AppError('VALIDATION_FAILED', 'Malformed JSON body');
  return new AppError('INTERNAL', undefined, undefined, { cause: err });
}

export const notFound: RequestHandler = () => {
  throw new AppError('NOT_FOUND');
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appErr = toAppError(err);
  const log = req.ctx.log;
  if (appErr.status >= 500) {
    log.error('request.failed', { code: appErr.code, error: serializeError(appErr.cause ?? err) });
  } else {
    log.warn('request.rejected', { code: appErr.code });
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  const retryAfterMs = appErr.details?.['retryAfterMs'];
  if (typeof retryAfterMs === 'number') {
    res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
  }
  res.status(appErr.status).json({
    error: {
      code: appErr.code,
      message: appErr.message,
      retryable: appErr.retryable,
      ...(appErr.details ? { details: appErr.details } : {}),
      requestId: req.ctx.requestId,
    },
  });
};
