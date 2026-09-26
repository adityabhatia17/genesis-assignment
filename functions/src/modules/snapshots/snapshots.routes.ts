import express, { type Router } from 'express';
import { RestoreParams } from '../../contracts/api.js';
import { defineHandler, requireUid } from '../../http/define-handler.js';
import { sendData } from '../../http/respond.js';
import type { RestoreService } from './restore.service.js';

/** POST /v1/projects/:projectId/snapshots/:snapshotId/restore. Endpoint rate limits are out of v1 (R-B4). */
export function snapshotsRouter(service: RestoreService): Router {
  const r = express.Router();
  r.post(
    '/v1/projects/:projectId/snapshots/:snapshotId/restore',
    defineHandler({ params: RestoreParams }, async ({ params }, req, res) => {
      sendData(res, await service.restore(requireUid(req), params.projectId, params.snapshotId));
    }),
  );
  return r;
}
