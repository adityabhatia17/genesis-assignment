import express, { type Router } from 'express';
import { FileSaveBody, FileSaveParams } from '../../contracts/api.js';
import { defineHandler, requireUid } from '../../http/define-handler.js';
import { sendData } from '../../http/respond.js';
import type { FileSaveService } from './file-save.service.js';

/** PUT /v1/projects/:projectId/files/:fileId. Endpoint rate limits are out of v1 (R-B4). */
export function filesRouter(service: FileSaveService): Router {
  const r = express.Router();
  r.put(
    '/v1/projects/:projectId/files/:fileId',
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
