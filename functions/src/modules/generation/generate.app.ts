import express, { type Router } from 'express';
import { ProjectParams, StartGenerationBody } from '../../contracts/api.js';
import { defineHandler, requireUid } from '../../http/define-handler.js';
import { rateLimit } from '../../http/middleware/rate-limit.js';
import { AppError } from '../../shared/app-error.js';
import { globalGenerationRule, RATE_LIMITS, type RateLimiter } from '../rate-limit/rate-limiter.js';
import type { GenerationOrchestrator } from './orchestrator.js';

/** POST /v1/projects/:projectId/generations streams protocol v1. */
export function generationRouter(d: {
  orchestrator: GenerationOrchestrator;
  limiter: RateLimiter;
  generationEnabled: boolean;
  generationDailyGlobalCap: number;
}): Router {
  const r = express.Router();
  r.post(
    '/v1/projects/:projectId/generations',
    (_req, _res, next) => {
      if (!d.generationEnabled) {
        next(new AppError('GENERATION_DISABLED'));
        return;
      }
      next();
    },
    rateLimit(d.limiter, RATE_LIMITS.generation),
    rateLimit(d.limiter, RATE_LIMITS.generationDay),
    rateLimit(d.limiter, globalGenerationRule(d.generationDailyGlobalCap), () => 'global'),
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
