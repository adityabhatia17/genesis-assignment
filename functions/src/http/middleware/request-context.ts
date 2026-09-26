import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../../shared/logger.js';

export interface RequestContext {
  readonly requestId: string;
  readonly startedAt: number;
  readonly log: Logger;
}
export interface AuthContext {
  readonly uid: string;
  readonly email?: string | undefined;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx: RequestContext;
    auth?: AuthContext;
  }
}

const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    req.ctx = {
      requestId,
      startedAt: Date.now(),
      log: logger.child({ requestId, route: `${req.method} ${req.path}` }),
    };
    res.setHeader('X-Request-Id', requestId);
    next();
  };
}
