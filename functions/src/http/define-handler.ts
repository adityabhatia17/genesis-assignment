import type { Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../shared/app-error.js';

/** The authenticated uid (authed routers run after requireAuth; this guards misuse). */
export function requireUid(req: Request): string {
  const uid = req.auth?.uid;
  if (!uid) throw new AppError('UNAUTHENTICATED');
  return uid;
}

export interface RouteSchemas {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
}
type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;
export interface Parsed<S extends RouteSchemas> {
  params: Infer<S['params']>;
  query: Infer<S['query']>;
  body: Infer<S['body']>;
}

/** Parses params/query/body with zod before calling the handler (ZodError → VALIDATION_FAILED). */
export function defineHandler<S extends RouteSchemas>(
  schemas: S,
  fn: (input: Parsed<S>, req: Request, res: Response) => Promise<void> | void,
): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      try {
        const input = {
          params: schemas.params ? schemas.params.parse(req.params) : undefined,
          query: schemas.query ? schemas.query.parse(req.query) : undefined,
          body: schemas.body ? schemas.body.parse(req.body ?? {}) : undefined,
        } as Parsed<S>;
        await fn(input, req, res);
      } catch (err) {
        next(err);
      }
    })();
  };
}
