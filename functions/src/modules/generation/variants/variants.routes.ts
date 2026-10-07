import express, { type Router } from 'express';
import { GenerationParams, SelectCandidateBody, VariantsParams } from '../../../contracts/api.js';
import { defineHandler, requireUid } from '../../../http/define-handler.js';
import { sendData } from '../../../http/respond.js';
import { AppError } from '../../../shared/app-error.js';
import type { Clock } from '../../../shared/clock.js';
import type { CommitService } from '../persistence/commit.service.js';
import type { VariantsRepo } from './variants.repo.js';

export function variantsRouter(d: { repo: VariantsRepo; commits: CommitService; clock: Clock }): Router {
  const r = express.Router();
  const base = '/v1/projects/:projectId/generations/:generationId';

  r.get(
    `${base}/variants`,
    defineHandler({ params: VariantsParams }, async ({ params }, req, res) => {
      const view = await d.repo.readSelection(requireUid(req), params.projectId, params.generationId);
      sendData(res, {
        generationId: params.generationId,
        status: view.status,
        resolution: view.resolution,
        selectedCandidateId: view.selectedId,
        top: view.ranking?.top ?? [],
        notice: view.notice,
        error: view.error,
      });
    }),
  );

  r.post(
    `${base}/variants/select`,
    defineHandler({ params: GenerationParams, body: SelectCandidateBody }, async ({ params, body }, req, res) => {
      const uid = requireUid(req);
      const view = await d.repo.readSelection(uid, params.projectId, params.generationId);
      if (view.selectedId === body.candidateId && view.snapshotId && view.snapshotSeq !== null) {
        sendData(res, {
          snapshotId: view.snapshotId,
          snapshotSeq: view.snapshotSeq,
          candidateId: body.candidateId,
          appliedPaths: [],
        });
        return;
      }
      if (view.status !== 'awaiting_selection' || !view.ranking) {
        throw new AppError('GENERATION_NOT_AWAITING_SELECTION');
      }
      const offered = view.ranking.top.find((entry) => entry.candidateId === body.candidateId);
      if (!offered) throw new AppError('CANDIDATE_NOT_SELECTABLE', undefined, { reason: 'not_offered' });
      const ops = await d.repo.listFiles(uid, params.projectId, params.generationId, body.candidateId);
      if (ops.length === 0) throw new AppError('CANDIDATE_NOT_FOUND');
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
          label: view.prompt,
          generationId: params.generationId,
          restoredFromSnapshotId: null,
        },
        lease: { mode: 'must-be-free' },
        precondition: (project) => {
          if (project.latestSnapshotId !== view.baseSnapshotId) {
            throw new AppError('CANDIDATE_NOT_SELECTABLE', undefined, { reason: 'project_changed' });
          }
        },
        messages: [
          {
            role: 'assistant',
            content: `Applied the ${offered.direction.label} option.`,
            generationId: params.generationId,
            meta: { status: 'completed' },
          },
        ],
        generationPatch: {
          generationId: params.generationId,
          build: (committed) => ({
            status: 'completed',
            completedAt: new Date(now),
            error: null,
            'variants.resolution': 'selected',
            'variants.selection': {
              candidateId: body.candidateId,
              rank: offered.rank,
              topPickWasSelected: offered.topPick,
              scores: { total: offered.total },
              selectedAt: new Date(now),
            },
            result: {
              snapshotId: committed.snapshotId,
              snapshotSeq: committed.snapshotSeq,
              changedPaths: committed.changedPaths,
              deletedPaths: committed.deletedPaths,
              rejected: [],
              warnings: [],
              noChanges: committed.noChanges,
            },
          }),
        },
      });
      sendData(res, {
        snapshotId: result.snapshotId,
        snapshotSeq: result.snapshotSeq,
        candidateId: body.candidateId,
        appliedPaths: ops.filter((op) => op.op === 'write').map((op) => op.path),
      });
    }),
  );

  r.post(
    `${base}/variants/discard`,
    defineHandler({ params: GenerationParams }, async ({ params }, req, res) => {
      await d.repo.discard(requireUid(req), params.projectId, params.generationId, d.clock.now());
      sendData(res, { discarded: true as const });
    }),
  );

  return r;
}
