import express, { type Router } from 'express';
import { ProjectParams, StartGenerationBody } from '../../contracts/api.js';
import { defineHandler, requireUid } from '../../http/define-handler.js';
import { rateLimit } from '../../http/middleware/rate-limit.js';
import { AppError } from '../../shared/app-error.js';
import { globalGenerationRule, RATE_LIMITS, type RateLimiter } from '../rate-limit/rate-limiter.js';
import type { VariantsAdmission } from '../rate-limit/variants-admission.js';
import type { GenerationOrchestrator } from './orchestrator.js';
import type { VariantsOrchestrator } from './variants/variants.orchestrator.js';
import type { VariantsRepo } from './variants/variants.repo.js';

/** POST /v1/projects/:projectId/generations streams protocol v1. */
export function generationRouter(d: {
  orchestrator: GenerationOrchestrator;
  limiter: RateLimiter;
  generationEnabled: boolean;
  generationDailyGlobalCap: number;
  /** Absent in tests that only exercise single generation. */
  variants?: {
    orchestrator: VariantsOrchestrator;
    admission: VariantsAdmission;
    repo: VariantsRepo;
    enabled: boolean;
  };
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
        const uid = requireUid(req);
        const input = {
          uid,
          projectId: params.projectId,
          generationId: body.clientRequestId,
          prompt: body.prompt,
        };
        if (!d.variants) {
          await d.orchestrator.run(req, res, input);
          return;
        }
        const project = await d.variants.repo.loadProject(uid, params.projectId);
        const admission = await d.variants.admission.check({
          uid,
          project,
          variantsAvailable: d.variants.enabled,
        });
        if (admission.mode === 'single') {
          await d.orchestrator.run(req, res, { ...input, fallbackReason: admission.reason });
          return;
        }
        try {
          await d.variants.orchestrator.run(req, res, {
            ...input,
            reservedCents: admission.reservedCents,
            baseSnapshotId: project.latestSnapshotId,
          });
        } catch (err) {
          await d.variants.admission.releaseOnStartFailure(admission.reservedCents);
          await d.variants.repo
            .failRun(uid, params.projectId, body.clientRequestId, Date.now(), 'The options could not be started.')
            .catch(() => undefined);
          throw err;
        }
      },
    ),
  );
  return r;
}
