import express, { type Express, type RequestHandler, type Router } from 'express';
import type { Logger } from '../shared/logger.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { noStore } from './middleware/no-store.js';
import { requestContext } from './middleware/request-context.js';
import { requireAuth, type VerifyIdToken } from './middleware/require-auth.js';
import { sendData } from './respond.js';

export interface HttpAppOptions {
  readonly service: 'api' | 'generate' | 'webhook';
  readonly version: string;
  readonly allowedOrigins: readonly string[];
  readonly logger: Logger;
  readonly verifyIdToken: VerifyIdToken;
  readonly publicRouters?: readonly Router[];
  readonly authedRouters?: readonly Router[];
}

/**
 * Parses JSON when the Functions runtime has not already populated `req.body`
 * (supertest unit tests). Skips when Cloud Functions already parsed the body.
 */
const parseJsonIfNeeded: RequestHandler = (req, res, next) => {
  if (req.body !== undefined && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    next();
    return;
  }
  express.json({ limit: '1mb' })(req, res, next);
};

export function createHttpApp(opts: HttpAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(requestContext(opts.logger));
  app.use(corsMiddleware(opts.allowedOrigins));
  app.use(noStore);
  app.use(parseJsonIfNeeded);

  app.get('/v1/health', (_req, res) => {
    sendData(res, { ok: true, service: opts.service, version: opts.version });
  });
  for (const r of opts.publicRouters ?? []) app.use(r);

  const authed = express.Router();
  authed.use(requireAuth(opts.verifyIdToken));
  for (const r of opts.authedRouters ?? []) authed.use(r);
  app.use(authed);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
