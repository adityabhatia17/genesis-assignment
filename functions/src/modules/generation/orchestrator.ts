import type { Request, Response } from 'express';
import type { Usage } from '../../contracts/firestore-docs.js';
import { LIMITS } from '../../contracts/limits.js';
import type { Clock } from '../../shared/clock.js';
import { serializeError } from '../../shared/logger.js';
import { GenerationAbort } from './candidate/abort.js';
import type { CandidateRunResult, CandidateRunner } from './candidate/candidate-runner.js';
import type { CandidateSink } from './candidate/candidate-sink.js';
import type { ContextBuilder } from './context/context-builder.js';
import type { CurrentFile } from './context/render-context.js';
import { estimateCostUsd } from './llm/model-provider.js';
import { decideOutcome, type Decision, type Termination } from './outcome.js';
import type { CommitService } from './persistence/commit.service.js';
import type { GenerationsRepo } from './persistence/generations.repo.js';
import { PROMPT_VERSION } from './prompt/system-prompt.v1.js';
import { SseWriter } from './sse/sse-writer.js';
import type { Tree } from './validation/validate-project.js';

export interface OrchestratorDeps {
  generations: GenerationsRepo;
  commits: CommitService;
  context: ContextBuilder;
  runner: CandidateRunner;
  clock: Clock;
  deadlineMs?: number;
  heartbeatMs?: number;
}

export interface RunInput {
  uid: string;
  projectId: string;
  generationId: string;
  prompt: string;
  /** Set when a variants run fell back to one candidate. */
  fallbackReason?:
    | 'disabled'
    | 'budget'
    | 'user_limit'
    | 'global_limit'
    | 'busy'
    | 'not_first';
}

interface HeldContext {
  currentTree: Tree | null;
  stats: {
    fileCount: number;
    historyMessages: number;
    externalIncluded: boolean;
    promptChars: number;
  } | null;
}

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

const STATUS_NOTE = {
  interrupted: '(Connection lost during generation.)',
  failed: '',
  cancelled: '(Generation cancelled.)',
} as const;

export class GenerationOrchestrator {
  constructor(private readonly d: OrchestratorDeps) {}

  /** Throws AppError before the stream opens (→ JSON error); never throws after. */
  async run(req: Request, res: Response, i: RunInput): Promise<void> {
    const { clock, runner, generations } = this.d;
    const log = req.ctx.log.child({ projectId: i.projectId, generationId: i.generationId });
    const startedAt = clock.now();
    const { project, projectDescription } = await generations.start({
      ...i,
      promptVersion: PROMPT_VERSION,
      model: runner.model,
      effort: runner.effort,
      nowMs: startedAt,
    });

    const sse = new SseWriter(res, i.generationId, clock);
    sse.open();
    sse.send('generation.started', {
      projectId: i.projectId,
      model: runner.model,
      promptVersion: PROMPT_VERSION,
      startedAt: new Date(startedAt).toISOString(),
      mode: 'single',
      ...(i.fallbackReason ? { fallbackReason: i.fallbackReason } : {}),
    });
    log.info('generation.start', { promptChars: i.prompt.length });

    const held: HeldContext = { currentTree: null, stats: null };
    let produced: CandidateRunResult;
    const abort = new AbortController();
    let terminalSent = false;
    const stopWatch = generations.watchCancel(
      i.uid,
      i.projectId,
      i.generationId,
      () => abort.abort(new GenerationAbort('cancelled')),
      (err) => log.warn('generation.cancel_watch_failed', { error: serializeError(err) }),
    );
    const onClose = () => {
      if (!terminalSent) abort.abort(new GenerationAbort('disconnected'));
    };
    res.on('close', onClose);
    const heartbeat = setInterval(() => {
      sse.heartbeat();
      generations
        .touch(i.uid, i.projectId, i.generationId, clock.now())
        .catch((err: unknown) =>
          log.warn('generation.heartbeat_failed', { error: serializeError(err) }),
        );
    }, this.d.heartbeatMs ?? LIMITS.heartbeatMs);
    const deadline = setTimeout(
      () => abort.abort(new GenerationAbort('timeout')),
      this.d.deadlineMs ?? LIMITS.generationDeadlineMs,
    );

    const sink: CandidateSink = {
      onThinking: (text) => void sse.send('assistant.thinking', { text }),
      onWritingStarted: () => void sse.send('generation.phase', { phase: 'writing' }),
      onProse: (text) => void sse.send('assistant.delta', { text }),
      onFileStarted: (path, language) => void sse.send('file.started', { path, language, op: 'write' }),
      onFileDelta: (path, text) => void sse.send('file.delta', { path, text }),
      stage: (op, warnings) =>
        generations.stage(i.uid, i.projectId, i.generationId, op, warnings, clock.now()),
      onFileCompleted: (ev) => void sse.send('file.completed', ev),
      onFileDeleted: (ev) => void sse.send('file.deleted', ev),
      afterChunk: () => sse.drain(),
      onProtocolWarning: (code) => log.warn('generation.protocol_warning', { code }),
    };

    try {
      sse.send('generation.phase', { phase: 'context' });
      const ctx = await this.d.context.build({
        uid: i.uid,
        projectId: i.projectId,
        projectName: project.name,
        projectDescription,
        generationId: i.generationId,
        prompt: i.prompt,
      });
      held.currentTree = toTree(ctx.currentFiles);
      held.stats = ctx.stats;
      sse.send('generation.phase', { phase: 'thinking' });
      produced = await runner.run(
        {
          system: ctx.system,
          messages: ctx.messages,
          currentFiles: ctx.currentFiles,
          currentTree: held.currentTree,
          signal: abort.signal,
        },
        sink,
        log,
      );
    } catch (err) {
      log.error('generation.unexpected', { error: serializeError(err) });
      produced = {
        ops: [],
        rejected: [],
        aborted: [],
        warnings: [],
        prose: '',
        raw: '',
        final: null,
        termination: 'provider_error',
        providerErrorCode: 'INTERNAL',
        firstTokenAtMs: null,
      };
    }

    const ran = produced;

    try {
      if (ran.termination === 'completed') sse.send('generation.phase', { phase: 'validating' });
      const decision = decideOutcome({
        termination: ran.termination,
        ...(ran.providerErrorCode ? { providerErrorCode: ran.providerErrorCode } : {}),
        stopReason: ran.final?.stopReason ?? null,
        ops: ran.ops,
        rejected: ran.rejected,
        aborted: ran.aborted,
        currentTree: held.currentTree,
      });
      terminalSent = true;
      await this.finish(decision, sse, ran, held, i, startedAt, ran.termination, log);
    } catch (err) {
      log.error('generation.finalize_failed', { error: serializeError(err) });
      if (!sse.isClosed) {
        const partial = ran.ops.length
          ? { stagedPaths: ran.ops.filter((o) => o.op === 'write').map((o) => o.path).sort(), applyable: false }
          : null;
        sse.send('generation.failed', {
          error: {
            code: 'INTERNAL',
            message: 'Saving the generation failed. Please try again.',
            retryable: true,
          },
          partial,
        });
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      stopWatch();
      res.off('close', onClose);
      await generations
        .saveRawArtifact(i.uid, i.projectId, i.generationId, ran.raw, clock.now())
        .catch((err: unknown) =>
          log.warn('generation.raw_save_failed', { error: serializeError(err) }),
        );
      sse.end();
    }
  }

  private async finish(
    decision: Decision,
    sse: SseWriter,
    ran: CandidateRunResult,
    held: HeldContext,
    i: RunInput,
    startedAt: number,
    termination: Termination,
    log: ReturnType<Request['ctx']['log']['child']>,
  ): Promise<void> {
    const final = ran.final;
    const now = this.d.clock.now();
    const usage: Usage | null = final
      ? { ...final.usage, costUsd: estimateCostUsd(final.model, final.usage) }
      : null;
    const timings = {
      ttftMs: ran.firstTokenAtMs ? ran.firstTokenAtMs - startedAt : null,
      totalMs: now - startedAt,
    };
    const rejected = [...ran.rejected, ...ran.aborted];

    if (decision.kind === 'commit') {
      sse.send('generation.phase', { phase: 'committing' });
      const assistantText =
        ran.prose.trim() ||
        (ran.ops.length ? `Updated ${ran.ops.length} file(s).` : 'No file changes were needed.');
      const result = await this.d.commits.applyTreeChange({
        uid: i.uid,
        projectId: i.projectId,
        nowMs: now,
        ops: ran.ops,
        source: 'ai',
        validateNextTree: true,
        snapshot: {
          kind: 'generation',
          label: i.prompt,
          generationId: i.generationId,
          restoredFromSnapshotId: null,
        },
        lease: { mode: 'must-hold', generationId: i.generationId },
        messages: [
          {
            role: 'assistant',
            content: assistantText,
            generationId: i.generationId,
            meta: { status: 'completed', rejectedPaths: rejected.map((r) => r.path) },
          },
        ],
        generationPatch: {
          generationId: i.generationId,
          build: (r) => ({
            status: 'completed',
            completedAt: new Date(now),
            stopReason: final?.stopReason ?? null,
            error: null,
            partial: null,
            usage,
            timings,
            ...(held.stats ? { context: held.stats } : {}),
            result: {
              snapshotId: r.snapshotId,
              snapshotSeq: r.snapshotSeq,
              changedPaths: r.changedPaths,
              deletedPaths: r.deletedPaths,
              rejected,
              warnings: [...ran.warnings, ...decision.warnings],
              noChanges: r.noChanges,
            },
          }),
        },
      });
      sse.send('generation.completed', {
        snapshotId: result.snapshotId,
        snapshotSeq: result.snapshotSeq,
        changedPaths: result.changedPaths,
        deletedPaths: result.deletedPaths,
        rejected,
        warnings: [...ran.warnings, ...decision.warnings],
        noChanges: result.noChanges,
        usage: usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUsd: 0,
        },
        durationMs: timings.totalMs,
      });
      log.info('generation.complete', {
        model: final?.model,
        stopReason: final?.stopReason,
        changed: result.changedPaths.length,
        ...usage,
        ...timings,
      });
      return;
    }

    const statusNote =
      decision.status === 'failed'
        ? `(Generation failed: ${decision.error?.message ?? 'unknown error'})`
        : STATUS_NOTE[decision.status];
    await this.d.generations.finalizeWithoutCommit({
      uid: i.uid,
      projectId: i.projectId,
      generationId: i.generationId,
      nowMs: now,
      status: decision.status,
      error: decision.error,
      partial: decision.partial,
      stopReason: final?.stopReason ?? null,
      usage,
      timings,
      context: held.stats,
      assistantText: `${ran.prose.trim()}\n\n${statusNote}`.trim(),
    });
    log.info('generation.end', {
      status: decision.status,
      code: decision.error?.code,
      termination,
    });
    if (termination === 'disconnected') return;
    if (decision.status === 'cancelled') {
      sse.send('generation.cancelled', { partial: decision.partial });
      return;
    }
    sse.send('generation.failed', {
      error: decision.error ?? {
        code: 'INTERNAL',
        message: 'Generation failed.',
        retryable: true,
      },
      partial: decision.partial,
    });
  }
}
