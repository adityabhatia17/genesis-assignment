import express, { type Router } from 'express';
import { ProjectParams, StartGenerationBody } from '../../contracts/api.js';
import { defineHandler, requireUid } from '../../http/define-handler.js';
import type { GenerationOrchestrator } from './orchestrator.js';

/**
 * POST /v1/projects/:projectId/generations streams protocol v1.
 * Cloud Function rate limits and the kill switch are out of v1 (R-B4).
 */
export function generationRouter(d: { orchestrator: GenerationOrchestrator }): Router {
  const r = express.Router();
  r.post(
    '/v1/projects/:projectId/generations',
    defineHandler(
      { params: ProjectParams, body: StartGenerationBody },
      async ({ params, body }, req, res) => {
        await d.orchestrator.run(req, res, {
          uid: requireUid(req),
          projectId: params.projectId,
          generationId: body.clientRequestId,
          prompt: body.prompt,
        });
      },
    ),
  );
  return r;
}
