import express, { type Router } from 'express';
import { GenerationParams } from '../../../contracts/api.js';
import { defineHandler, requireUid } from '../../../http/define-handler.js';
import { sendData } from '../../../http/respond.js';
import { AppError } from '../../../shared/app-error.js';
import type { Clock } from '../../../shared/clock.js';
import type { CommitService } from '../persistence/commit.service.js';
import type { GenerationsRepo } from '../persistence/generations.repo.js';

export function generationControlRouter(d: {
  generations: GenerationsRepo;
  commits: CommitService;
  clock: Clock;
}): Router {
  const r = express.Router();
  const base = '/v1/projects/:projectId/generations/:generationId';

  r.post(
    `${base}/apply`,
    defineHandler({ params: GenerationParams }, async ({ params }, req, res) => {
      const uid = requireUid(req);
      const gen = await d.generations.get(uid, params.projectId, params.generationId);
      if (!gen) throw new AppError('GENERATION_NOT_FOUND');
      if (gen.status === 'streaming') throw new AppError('GENERATION_IN_PROGRESS');
      if (!gen.partial?.applyable || gen.partial.applied || gen.partial.discarded)
        throw new AppError('GENERATION_NOT_APPLYABLE');
      const ops = await d.generations.listStaged(uid, params.projectId, params.generationId);
      if (ops.length === 0) throw new AppError('GENERATION_NOT_APPLYABLE');
      const now = d.clock.now();
      const result = await d.commits.applyTreeChange({
        uid,
        projectId: params.projectId,
        nowMs: now,
        ops,
        source: 'ai',
        validateNextTree: true,
        snapshot: {
          kind: 'generation',
          label: `Partial: ${gen.prompt}`,
          generationId: params.generationId,
          restoredFromSnapshotId: null,
        },
        lease: { mode: 'must-be-free' },
        messages: [
          {
            role: 'system',
            content: `Applied ${ops.length} file(s) from an unfinished generation.`,
            generationId: params.generationId,
            meta: null,
          },
        ],
        generationPatch: {
          generationId: params.generationId,
          build: (c) => ({
            'partial.appliedAt': new Date(now),
            'partial.appliedSnapshotId': c.snapshotId,
          }),
        },
      });
      sendData(res, {
        snapshotId: result.snapshotId,
        snapshotSeq: result.snapshotSeq,
        appliedPaths: ops.filter((o) => o.op === 'write').map((o) => o.path),
        deletedPaths: result.deletedPaths,
      });
    }),
  );

  r.post(
    `${base}/discard`,
    defineHandler({ params: GenerationParams }, async ({ params }, req, res) => {
      await d.generations.markDiscarded(
        requireUid(req),
        params.projectId,
        params.generationId,
        d.clock.now(),
      );
      sendData(res, { discarded: true as const });
    }),
  );

  return r;
}
