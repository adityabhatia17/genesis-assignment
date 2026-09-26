import type { Request, Response } from 'express';
import type { Issue, Usage } from '../../contracts/firestore-docs.js';
import { LIMITS } from '../../contracts/limits.js';
import { languageForPath } from '../../contracts/paths.js';
import type { Clock } from '../../shared/clock.js';
import { sha256Hex, utf8Bytes } from '../../shared/hash.js';
import { serializeError, type Logger } from '../../shared/logger.js';
import type { ContextBuilder } from './context/context-builder.js';
import type { CurrentFile } from './context/render-context.js';
import {
  estimateCostUsd,
  ProviderError,
  type ModelProvider,
  type ProviderResult,
} from './llm/model-provider.js';
import { decideOutcome, type Decision, type RejectedFile, type Termination } from './outcome.js';
import type { CommitService } from './persistence/commit.service.js';
import type { GenerationsRepo } from './persistence/generations.repo.js';
import { PROMPT_VERSION } from './prompt/system-prompt.v1.js';
import { FileStreamParser, type ParserEvent } from './protocol/file-stream-parser.js';
import { SseWriter } from './sse/sse-writer.js';
import { validateDelete, validateWrite, type FileOp } from './validation/validate-file.js';
import type { Tree } from './validation/validate-project.js';

class GenerationAbort extends Error {
  constructor(readonly kind: 'cancelled' | 'disconnected' | 'timeout') {
    super(kind);
    this.name = 'GenerationAbort';
  }
}

export interface OrchestratorDeps {
  generations: GenerationsRepo;
  commits: CommitService;
  context: ContextBuilder;
  provider: ModelProvider;
  clock: Clock;
  deadlineMs?: number;
  heartbeatMs?: number;
}

export interface RunInput {
  uid: string;
  projectId: string;
  generationId: string;
  prompt: string;
}

/** Mutable per-run state. */
class RunState {
  prose = '';
  raw = '';
  firstTokenAtMs: number | null = null;
  readonly ops = new Map<string, FileOp>();
  readonly rejected: RejectedFile[] = [];
  readonly aborted: RejectedFile[] = [];
  readonly warnings: Issue[] = [];
  readonly suppressed = new Set<string>();
  currentTree: Tree | null = null;
  currentFiles: Map<string, CurrentFile> | null = null;
  stats: {
    fileCount: number;
    historyMessages: number;
    externalIncluded: boolean;
    promptChars: number;
  } | null = null;
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
    const { clock, provider, generations } = this.d;
    const log = req.ctx.log.child({ projectId: i.projectId, generationId: i.generationId });
    const startedAt = clock.now();
    const { project, projectDescription } = await generations.start({
      ...i,
      promptVersion: PROMPT_VERSION,
      model: provider.model,
      effort: provider.effort,
      nowMs: startedAt,
    });

    const sse = new SseWriter(res, i.generationId, clock);
    sse.open();
    sse.send('generation.started', {
      projectId: i.projectId,
      model: provider.model,
      promptVersion: PROMPT_VERSION,
      startedAt: new Date(startedAt).toISOString(),
    });
    log.info('generation.start', { promptChars: i.prompt.length });

    const state = new RunState();
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

    let final: ProviderResult | null = null;
    let termination: Termination = 'completed';
    let providerErrorCode: ProviderError['code'] | undefined;

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
      state.currentFiles = ctx.currentFiles;
      state.currentTree = toTree(ctx.currentFiles);
      state.stats = ctx.stats;

      sse.send('generation.phase', { phase: 'thinking' });
      const stream = provider.stream({
        system: ctx.system,
        messages: ctx.messages,
        signal: abort.signal,
      });
      const parser = new FileStreamParser();
      let writing = false;
      for await (const ev of stream) {
        state.firstTokenAtMs ??= clock.now();
        if (ev.type === 'thinking_delta') {
          sse.send('assistant.thinking', { text: ev.text });
          continue;
        }
        if (!writing) {
          writing = true;
          sse.send('generation.phase', { phase: 'writing' });
        }
        state.raw += ev.text;
        for (const pe of parser.push(ev.text)) await this.onParserEvent(pe, sse, state, i, log);
        await sse.drain();
      }
      for (const pe of parser.finish()) await this.onParserEvent(pe, sse, state, i, log);
      final = await stream.final();
    } catch (err) {
      const reason: unknown = abort.signal.reason;
      if (abort.signal.aborted && reason instanceof GenerationAbort) termination = reason.kind;
      else if (err instanceof ProviderError) {
        termination = 'provider_error';
        providerErrorCode = err.code;
      } else {
        termination = 'provider_error';
        providerErrorCode = 'INTERNAL';
        log.error('generation.unexpected', { error: serializeError(err) });
      }
    }

    try {
      if (termination === 'completed') sse.send('generation.phase', { phase: 'validating' });
      const decision = decideOutcome({
        termination,
        providerErrorCode,
        stopReason: final?.stopReason ?? null,
        ops: [...state.ops.values()],
        rejected: state.rejected,
        aborted: state.aborted,
        currentTree: state.currentTree,
      });
      terminalSent = true;
      await this.finish(decision, sse, state, i, startedAt, final, termination, log);
    } catch (err) {
      log.error('generation.finalize_failed', { error: serializeError(err) });
      if (!sse.isClosed) {
        const partial = state.ops.size
          ? { stagedPaths: [...state.ops.keys()].sort(), applyable: false }
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
        .saveRawArtifact(i.uid, i.projectId, i.generationId, state.raw, clock.now())
        .catch((err: unknown) =>
          log.warn('generation.raw_save_failed', { error: serializeError(err) }),
        );
      sse.end();
    }
  }

  private async onParserEvent(
    pe: ParserEvent,
    sse: SseWriter,
    s: RunState,
    i: RunInput,
    log: Logger,
  ): Promise<void> {
    switch (pe.type) {
      case 'prose':
        s.prose += pe.text;
        sse.send('assistant.delta', { text: pe.text });
        return;
      case 'file_start': {
        const language = languageForPath(pe.path);
        if (!language) {
          s.suppressed.add(pe.path);
          return;
        }
        sse.send('file.started', { path: pe.path, language, op: 'write' });
        return;
      }
      case 'file_chunk':
        if (!s.suppressed.has(pe.path)) sse.send('file.delta', { path: pe.path, text: pe.text });
        return;
      case 'file_end': {
        const v = validateWrite(pe.path, pe.content);
        const warnings = v.issues.filter((x) => x.severity === 'warning');
        if (v.op) {
          s.ops.set(v.op.path, v.op);
          s.warnings.push(...warnings);
          await this.d.generations.stage(
            i.uid,
            i.projectId,
            i.generationId,
            v.op,
            warnings,
            this.d.clock.now(),
          );
        } else {
          s.rejected.push({ path: pe.path, issues: v.issues });
        }
        sse.send('file.completed', {
          path: pe.path,
          status: v.op ? 'valid' : 'rejected',
          sizeBytes: utf8Bytes(pe.content),
          sha256: sha256Hex(pe.content),
          issues: v.issues,
        });
        return;
      }
      case 'file_delete': {
        const existing = new Set([...(s.currentFiles?.keys() ?? []), ...s.ops.keys()]);
        const v = validateDelete(pe.path, existing);
        if (v.op) {
          s.ops.set(pe.path, v.op);
          await this.d.generations.stage(
            i.uid,
            i.projectId,
            i.generationId,
            v.op,
            [],
            this.d.clock.now(),
          );
        } else if (!v.ok) {
          s.rejected.push({ path: pe.path, issues: v.issues });
        } else {
          s.warnings.push(...v.issues);
        }
        sse.send('file.deleted', {
          path: pe.path,
          status: v.ok ? 'valid' : 'rejected',
          issues: v.issues,
        });
        return;
      }
      case 'file_abort': {
        const issues: Issue[] = [
          {
            code: 'FILE_UNTERMINATED',
            severity: 'error',
            message: 'The file was cut off before it finished.',
            path: pe.path,
          },
        ];
        s.aborted.push({ path: pe.path, issues });
        if (!s.suppressed.has(pe.path)) {
          sse.send('file.completed', {
            path: pe.path,
            status: 'rejected',
            sizeBytes: utf8Bytes(pe.content),
            sha256: sha256Hex(pe.content),
            issues,
          });
        }
        return;
      }
      case 'protocol_warning':
        log.warn('generation.protocol_warning', { code: pe.code });
        return;
    }
  }

  private async finish(
    decision: Decision,
    sse: SseWriter,
    s: RunState,
    i: RunInput,
    startedAt: number,
    final: ProviderResult | null,
    termination: Termination,
    log: Logger,
  ): Promise<void> {
    const now = this.d.clock.now();
    const usage: Usage | null = final
      ? { ...final.usage, costUsd: estimateCostUsd(final.model, final.usage) }
      : null;
    const timings = {
      ttftMs: s.firstTokenAtMs ? s.firstTokenAtMs - startedAt : null,
      totalMs: now - startedAt,
    };
    const rejected = [...s.rejected, ...s.aborted];

    if (decision.kind === 'commit') {
      sse.send('generation.phase', { phase: 'committing' });
      const assistantText =
        s.prose.trim() ||
        (s.ops.size ? `Updated ${s.ops.size} file(s).` : 'No file changes were needed.');
      const result = await this.d.commits.applyTreeChange({
        uid: i.uid,
        projectId: i.projectId,
        nowMs: now,
        ops: [...s.ops.values()],
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
            ...(s.stats ? { context: s.stats } : {}),
            result: {
              snapshotId: r.snapshotId,
              snapshotSeq: r.snapshotSeq,
              changedPaths: r.changedPaths,
              deletedPaths: r.deletedPaths,
              rejected,
              warnings: [...s.warnings, ...decision.warnings],
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
        warnings: [...s.warnings, ...decision.warnings],
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
      context: s.stats,
      assistantText: `${s.prose.trim()}\n\n${statusNote}`.trim(),
    });
    log.info('generation.end', {
      status: decision.status,
      code: decision.error?.code,
      termination,
    });
    if (termination === 'disconnected') return;
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
