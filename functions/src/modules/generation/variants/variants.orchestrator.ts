import type { Request, Response } from 'express';
import type { Usage } from '../../../contracts/firestore-docs.js';
import type { RuntimeMethodName } from '../../../contracts/hl-runtime.js';
import { LIMITS } from '../../../contracts/limits.js';
import type { CandidateScore } from '../../../contracts/variants.js';
import { sleep } from '../../../shared/async.js';
import type { Clock } from '../../../shared/clock.js';
import { serializeError, type Logger } from '../../../shared/logger.js';
import type { VariantsAdmission } from '../../rate-limit/variants-admission.js';
import { GenerationAbort } from '../candidate/abort.js';
import type { CandidateRunner } from '../candidate/candidate-runner.js';
import type { ContextBuilder } from '../context/context-builder.js';
import type { CurrentFile } from '../context/render-context.js';
import { Semaphore } from '../llm/gated-provider.js';
import { estimateCostUsd, hasModelPrice, type TokenUsage } from '../llm/model-provider.js';
import type { GenerationsRepo } from '../persistence/generations.repo.js';
import { PROMPT_VERSION } from '../prompt/system-prompt.v1.js';
import { SseWriter } from '../sse/sse-writer.js';
import type { Tree } from '../validation/validate-project.js';
import { runOneCandidate } from './candidate-pipeline.js';
import type { ChecklistService } from './checklist/checklist.service.js';
import { directionsFor } from './directions.js';
import { scoreCandidate } from './harness/score.js';
import type { JudgeService } from './judge/judge.service.js';
import { rankCandidates } from './rank.js';
import { catalogFor } from './sdk-catalog.js';
import type { VariantsRepo } from './variants.repo.js';

const toTree = (files: Map<string, CurrentFile>): Tree =>
  new Map(
    [...files.values()].map((f) => [
      f.path,
      {
        path: f.path,
        content: f.content,
        sizeBytes: f.sizeBytes,
        sha256: f.contentHash,
        language: f.language,
      },
    ]),
  );

const centsOf = (model: string | null, usage: TokenUsage | null): number => {
  if (!model || !usage || !hasModelPrice(model)) return 0;
  return Math.ceil(estimateCostUsd(model, usage) * 100);
};

const sumUsage = (parts: readonly (TokenUsage | null)[]): Usage => {
  const u = parts
    .filter((p): p is TokenUsage => p !== null)
    .reduce(
      (a, b) => ({
        inputTokens: a.inputTokens + b.inputTokens,
        outputTokens: a.outputTokens + b.outputTokens,
        cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
        cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    );
  return { ...u, costUsd: Math.round((u.outputTokens + u.inputTokens) * 0) };
};

export interface VariantsRunInput {
  uid: string;
  projectId: string;
  generationId: string;
  prompt: string;
  reservedCents: number;
  baseSnapshotId: string | null;
}

export class VariantsOrchestrator {
  constructor(
    private readonly d: {
      generations: GenerationsRepo;
      repo: VariantsRepo;
      context: ContextBuilder;
      runner: CandidateRunner;
      checklist: ChecklistService;
      judge: JudgeService;
      admission: VariantsAdmission;
      clock: Clock;
      log: Logger;
      checklistModel: string;
      judgeModel: string;
      count: number;
      highlevel: (
        uid: string,
      ) => Promise<{ calendarCount: number | null; methods: readonly RuntimeMethodName[] }>;
    },
  ) {}

  async run(req: Request, res: Response, i: VariantsRunInput): Promise<void> {
    const log = req.ctx.log.child({ projectId: i.projectId, generationId: i.generationId });
    const startedAt = this.d.clock.now();
    const started = await this.d.generations.start({
      uid: i.uid,
      projectId: i.projectId,
      generationId: i.generationId,
      prompt: i.prompt,
      promptVersion: PROMPT_VERSION,
      model: this.d.runner.model,
      effort: this.d.runner.effort,
      nowMs: startedAt,
      mode: 'variants',
      variantsSeed: { reservedCents: i.reservedCents, baseSnapshotId: i.baseSnapshotId },
    });

    const sse = new SseWriter(res, i.generationId, this.d.clock);
    sse.open();
    sse.send('generation.started', {
      projectId: i.projectId,
      model: this.d.runner.model,
      promptVersion: PROMPT_VERSION,
      startedAt: new Date(startedAt).toISOString(),
      mode: 'variants',
    });

    const abort = new AbortController();
    let terminal = false;
    const stopWatch = this.d.generations.watchCancel(
      i.uid,
      i.projectId,
      i.generationId,
      () => abort.abort(new GenerationAbort('cancelled')),
      (err) => log.warn('variants.cancel_watch_failed', { error: serializeError(err) }),
    );
    const onClose = () => {
      if (!terminal) abort.abort(new GenerationAbort('disconnected'));
    };
    res.on('close', onClose);
    const heartbeat = setInterval(() => {
      sse.heartbeat();
      void this.d.generations
        .touch(i.uid, i.projectId, i.generationId, this.d.clock.now())
        .catch(() => undefined);
    }, LIMITS.heartbeatMs);
    const deadline = setTimeout(
      () => abort.abort(new GenerationAbort('timeout')),
      LIMITS.variants.runHardDeadlineMs,
    );

    let refund = false;
    let actualCents = 0;
    const usages: (TokenUsage | null)[] = [];

    try {
      sse.send('variants.phase', { phase: 'checklist' });
      const [ctx, hl] = await Promise.all([
        this.d.context.build({
          uid: i.uid,
          projectId: i.projectId,
          projectName: started.project.name,
          projectDescription: started.projectDescription,
          generationId: i.generationId,
          prompt: i.prompt,
        }),
        this.d.highlevel(i.uid),
      ]);
      const built = await this.d.checklist.build({
        prompt: i.prompt,
        calendarCount: hl.calendarCount,
        catalog: catalogFor(hl.methods),
        signal: abort.signal,
      });
      usages.push(built.usage);
      const directions = directionsFor(built.checklist.appType).slice(0, this.d.count);
      sse.send('variants.phase', { phase: 'generating' });

      const slots = new Semaphore(LIMITS.variants.scoringConcurrency);
      let scoringAnnounced = false;
      const scored = await Promise.all(
        directions.map(async (direction, index) => {
          const candidateId = `c${index}`;
          if (index > 0) await sleep(LIMITS.variants.staggerMs + index * 150, abort.signal);
          const draft = await runOneCandidate({
            repo: this.d.repo,
            runner: this.d.runner,
            clock: this.d.clock,
            uid: i.uid,
            pid: i.projectId,
            gid: i.generationId,
            candidateId,
            index,
            direction,
            system: ctx.system,
            messages: ctx.messages,
            currentFiles: ctx.currentFiles,
            currentTree: toTree(ctx.currentFiles),
            signal: abort.signal,
            startedAt,
            onStage: (stage, filesDone) => {
              sse.send('candidate.progress', {
                candidateId,
                stage,
                ...(filesDone !== undefined ? { filesDone } : {}),
              });
            },
          });
          usages.push(draft.usage);
          if (draft.failed || abort.signal.aborted)
            return { draft, score: null as CandidateScore | null };
          const release = await slots.acquire(abort.signal);
          try {
            if (!scoringAnnounced) {
              scoringAnnounced = true;
              sse.send('variants.phase', { phase: 'scoring' });
            }
            sse.send('candidate.progress', { candidateId: draft.candidateId, stage: 'scoring' });
            const score = await scoreCandidate(draft.files, built.checklist);
            await this.d.repo.patchCandidate(
              i.uid,
              i.projectId,
              i.generationId,
              draft.candidateId,
              {
                status: score.eligible ? 'scored' : 'disqualified',
                score,
              },
            );
            return { draft, score };
          } finally {
            release();
          }
        }),
      );
      const drafts = scored.map((s) => s.draft);

      const eligible = scored.flatMap((s) =>
        s.score?.eligible ? [{ draft: s.draft, score: s.score }] : [],
      );
      let judged = eligible.map((s) => s.score);
      let notice: 'only_one_option' | 'unjudged' | null = null;
      if (eligible.length >= 2 && !abort.signal.aborted) {
        sse.send('variants.phase', { phase: 'judging' });
        const result = await this.d.judge.judge({
          runId: i.generationId,
          checklist: built.checklist,
          candidates: eligible.map((s) => ({
            candidateId: s.draft.candidateId,
            files: s.draft.files,
            score: s.score,
          })),
          signal: abort.signal,
        });
        judged = result.scores;
        usages.push(result.usage);
        notice = result.notice;
        await Promise.all(
          eligible.map((s, index) =>
            this.d.repo.patchCandidate(i.uid, i.projectId, i.generationId, s.draft.candidateId, {
              score: judged[index],
            }),
          ),
        );
      }

      const judgedById = new Map(
        eligible.map((s, index) => [s.draft.candidateId, judged[index] ?? s.score]),
      );
      const ranked = rankCandidates(
        scored.flatMap((s) =>
          s.score
            ? [
                {
                  candidateId: s.draft.candidateId,
                  direction: { id: s.draft.direction.id, label: s.draft.direction.label },
                  score: judgedById.get(s.draft.candidateId) ?? s.score,
                },
              ]
            : [],
        ),
      );
      notice = notice ?? ranked.notice;
      const candidateCents = drafts.reduce((n, d) => n + centsOf(d.model, d.usage), 0);
      const checklistCents = centsOf(this.d.checklistModel, built.usage);
      actualCents = candidateCents + checklistCents;
      if (ranked.ranking.top.length < 2) refund = true;

      if (abort.signal.aborted) {
        const reason: unknown = abort.signal.reason;
        const ownerLeft =
          reason instanceof GenerationAbort &&
          (reason.kind === 'disconnected' || reason.kind === 'cancelled');
        if (!ownerLeft) refund = true;
        throw reason instanceof Error ? reason : new Error('aborted');
      }

      if (ranked.ranking.top.length === 0) {
        await this.d.repo.failRun(
          i.uid,
          i.projectId,
          i.generationId,
          this.d.clock.now(),
          'The options could not be finished.',
        );
        terminal = true;
        sse.send('generation.failed', {
          error: {
            code: 'INTERNAL',
            message: 'The options could not be finished.',
            retryable: true,
          },
          partial: null,
        });
      } else {
        await this.d.repo.markAwaiting({
          uid: i.uid,
          pid: i.projectId,
          gid: i.generationId,
          nowMs: this.d.clock.now(),
          ranking: ranked.ranking,
          notice,
          checklist: built.checklist,
          calendarCount: hl.calendarCount ?? 0,
          cost: {
            candidatesCents: candidateCents,
            checklistCents,
            judgeCents: 0,
            totalCents: actualCents,
          },
        });
        terminal = true;
        sse.send('variants.ready', {
          top: ranked.ranking.top,
          notice,
          usage: { ...sumUsage(usages), costUsd: actualCents / 100 },
          durationMs: this.d.clock.now() - startedAt,
        });
      }
      log.info('variants.ready', { shown: ranked.ranking.top.length, refund, cents: actualCents });
    } catch (err) {
      const reason: unknown = abort.signal.reason;
      const ownerLeft =
        reason instanceof GenerationAbort &&
        (reason.kind === 'disconnected' || reason.kind === 'cancelled');
      if (!ownerLeft) refund = true;
      log.error('variants.failed', { error: serializeError(err) });
      if (!terminal) {
        await this.d.repo
          .failRun(
            i.uid,
            i.projectId,
            i.generationId,
            this.d.clock.now(),
            'The options could not be finished.',
          )
          .catch(() => undefined);
        terminal = true;
        if (!sse.isClosed && !ownerLeft) {
          sse.send('generation.failed', {
            error: {
              code: 'INTERNAL',
              message: 'The options could not be finished.',
              retryable: true,
            },
            partial: null,
          });
        }
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      stopWatch();
      res.off('close', onClose);
      if (refund)
        await this.d.admission
          .refund(i.uid)
          .catch((err: unknown) =>
            log.warn('variants.refund_failed', { error: serializeError(err) }),
          );
      await this.d.admission
        .settle(i.reservedCents, actualCents)
        .catch((err: unknown) =>
          log.warn('variants.settle_failed', { error: serializeError(err) }),
        );
      this.d.admission.releaseSlot();
      sse.end();
    }
  }
}
