import type { RequestHandler } from 'express';
import { AppError } from '../../shared/app-error.js';

export type VerifyIdToken = (token: string) => Promise<{ uid: string; email?: string | undefined }>;

export function requireAuth(verify: VerifyIdToken): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
      const token = match?.[1];
      if (!token) {
        next(new AppError('UNAUTHENTICATED'));
        return;
      }
      try {
        const decoded = await verify(token);
        req.auth = { uid: decoded.uid, email: decoded.email };
        next();
      } catch (err) {
        next(new AppError('UNAUTHENTICATED', undefined, undefined, { cause: err }));
      }
    })();
  };
}
