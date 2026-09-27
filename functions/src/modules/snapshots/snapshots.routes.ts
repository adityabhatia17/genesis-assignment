import express, { type Router } from 'express';
import { RestoreParams } from '../../contracts/api.js';
import { defineHandler, requireUid } from '../../http/define-handler.js';
import { rateLimit } from '../../http/middleware/rate-limit.js';
import { sendData } from '../../http/respond.js';
import { RATE_LIMITS, type RateLimiter } from '../rate-limit/rate-limiter.js';
import type { RestoreService } from './restore.service.js';

/** POST /v1/projects/:projectId/snapshots/:snapshotId/restore. */
export function snapshotsRouter(service: RestoreService, limiter: RateLimiter): Router {
  const r = express.Router();
  r.post(
    '/v1/projects/:projectId/snapshots/:snapshotId/restore',
    rateLimit(limiter, RATE_LIMITS.snapshotRestore),
    defineHandler({ params: RestoreParams }, async ({ params }, req, res) => {
      sendData(res, await service.restore(requireUid(req), params.projectId, params.snapshotId));
    }),
  );
  return r;
}
