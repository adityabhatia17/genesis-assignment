import express, { type Router } from 'express';
import { FileSaveBody, FileSaveParams } from '../../contracts/api.js';
import { defineHandler, requireUid } from '../../http/define-handler.js';
import { rateLimit } from '../../http/middleware/rate-limit.js';
import { sendData } from '../../http/respond.js';
import { RATE_LIMITS, type RateLimiter } from '../rate-limit/rate-limiter.js';
import type { FileSaveService } from './file-save.service.js';

/** PUT /v1/projects/:projectId/files/:fileId. */
export function filesRouter(service: FileSaveService, limiter: RateLimiter): Router {
  const r = express.Router();
  r.put(
    '/v1/projects/:projectId/files/:fileId',
    rateLimit(limiter, RATE_LIMITS.fileSave),
    defineHandler(
      { params: FileSaveParams, body: FileSaveBody },
      async ({ params, body }, req, res) => {
        sendData(
          res,
          await service.save(
            requireUid(req),
            params.projectId,
            params.fileId,
            body.content,
            body.expectedVersion,
          ),
        );
      },
    ),
  );
  return r;
}
