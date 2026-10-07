import type { Issue } from '../../../contracts/firestore-docs.js';
import { languageForPath } from '../../../contracts/paths.js';
import type { Clock } from '../../../shared/clock.js';
import { sha256Hex, utf8Bytes } from '../../../shared/hash.js';
import { serializeError, type Logger } from '../../../shared/logger.js';
import type { ChatTurn, CurrentFile, SystemBlock } from '../context/render-context.js';
import { ProviderError, type ModelProvider, type ProviderResult } from '../llm/model-provider.js';
import type { RejectedFile, Termination } from '../outcome.js';
import { FileStreamParser, type ParserEvent } from '../protocol/file-stream-parser.js';
import { validateDelete, validateWrite, type FileOp } from '../validation/validate-file.js';
import type { Tree } from '../validation/validate-project.js';
import { GenerationAbort } from './abort.js';
import type { CandidateSink } from './candidate-sink.js';

export interface CandidateRunInput {
  system: SystemBlock[];
  messages: ChatTurn[];
  currentFiles: Map<string, CurrentFile>;
  currentTree: Tree;
  signal: AbortSignal;
}

export interface CandidateRunResult {
  ops: FileOp[];
  rejected: RejectedFile[];
  aborted: RejectedFile[];
  warnings: Issue[];
  prose: string;
  raw: string;
  final: ProviderResult | null;
  termination: Termination;
  providerErrorCode?: ProviderError['code'];
  firstTokenAtMs: number | null;
}

class RunState {
  prose = '';
  raw = '';
  firstTokenAtMs: number | null = null;
  readonly ops = new Map<string, FileOp>();
  readonly rejected: RejectedFile[] = [];
  readonly aborted: RejectedFile[] = [];
  readonly warnings: Issue[] = [];
  readonly suppressed = new Set<string>();

  constructor(
    readonly currentFiles: Map<string, CurrentFile>,
    readonly currentTree: Tree,
  ) {}
}

export function classifyAbort(
  err: unknown,
  signal: AbortSignal,
): { termination: Termination; providerErrorCode?: ProviderError['code'] } {
  const reason: unknown = signal.reason;
  if (signal.aborted && reason instanceof GenerationAbort) return { termination: reason.kind };
  if (err instanceof ProviderError) return { termination: 'provider_error', providerErrorCode: err.code };
  return { termination: 'provider_error', providerErrorCode: 'INTERNAL' };
}

export class CandidateRunner {
  constructor(
    private readonly provider: ModelProvider,
    private readonly clock: Clock,
    private readonly log: Logger,
  ) {}

  get model(): string {
    return this.provider.model;
  }
  get effort(): string {
    return this.provider.effort;
  }

  async run(i: CandidateRunInput, sink: CandidateSink, log: Logger = this.log): Promise<CandidateRunResult> {
    const s = new RunState(i.currentFiles, i.currentTree);
    let final: ProviderResult | null = null;
    let termination: Termination = 'completed';
    let providerErrorCode: ProviderError['code'] | undefined;
    try {
      const stream = this.provider.stream({
        system: i.system,
        messages: i.messages,
        signal: i.signal,
      });
      const parser = new FileStreamParser();
      let writing = false;
      for await (const ev of stream) {
        if (s.firstTokenAtMs === null) {
          s.firstTokenAtMs = this.clock.now();
          sink.onFirstToken?.();
        }
        if (ev.type === 'thinking_delta') {
          await sink.onThinking?.(ev.text);
          continue;
        }
        if (!writing) {
          writing = true;
          await sink.onWritingStarted?.();
        }
        s.raw += ev.text;
        for (const pe of parser.push(ev.text)) await this.onParserEvent(pe, sink, s);
        await sink.afterChunk?.();
      }
      for (const pe of parser.finish()) await this.onParserEvent(pe, sink, s);
      final = await stream.final();
    } catch (err) {
      const classified = classifyAbort(err, i.signal);
      termination = classified.termination;
      providerErrorCode = classified.providerErrorCode;
      if (
        termination === 'provider_error' &&
        providerErrorCode === 'INTERNAL' &&
        !(err instanceof ProviderError)
      ) {
        log.error('generation.unexpected', { error: serializeError(err) });
      }
    }
    return {
      ops: [...s.ops.values()],
      rejected: s.rejected,
      aborted: s.aborted,
      warnings: s.warnings,
      prose: s.prose,
      raw: s.raw,
      final,
      termination,
      ...(providerErrorCode ? { providerErrorCode } : {}),
      firstTokenAtMs: s.firstTokenAtMs,
    };
  }

  private async onParserEvent(pe: ParserEvent, sink: CandidateSink, s: RunState): Promise<void> {
    switch (pe.type) {
      case 'prose':
        s.prose += pe.text;
        await sink.onProse?.(pe.text);
        return;
      case 'file_start': {
        const language = languageForPath(pe.path);
        if (!language) {
          s.suppressed.add(pe.path);
          return;
        }
        await sink.onFileStarted?.(pe.path, language);
        return;
      }
      case 'file_chunk':
        if (!s.suppressed.has(pe.path)) await sink.onFileDelta?.(pe.path, pe.text);
        return;
      case 'file_end': {
        const v = validateWrite(pe.path, pe.content);
        const warnings = v.issues.filter((x) => x.severity === 'warning');
        if (v.op) {
          s.ops.set(v.op.path, v.op);
          s.warnings.push(...warnings);
          await sink.stage(v.op, warnings);
        } else {
          s.rejected.push({ path: pe.path, issues: v.issues });
        }
        await sink.onFileCompleted?.({
          path: pe.path,
          status: v.op ? 'valid' : 'rejected',
          sizeBytes: utf8Bytes(pe.content),
          sha256: sha256Hex(pe.content),
          issues: v.issues,
        });
        return;
      }
      case 'file_delete': {
        const existing = new Set([...s.currentFiles.keys(), ...s.ops.keys()]);
        const v = validateDelete(pe.path, existing);
        if (v.op) {
          s.ops.set(pe.path, v.op);
          await sink.stage(v.op, []);
        } else if (!v.ok) {
          s.rejected.push({ path: pe.path, issues: v.issues });
        } else {
          s.warnings.push(...v.issues);
        }
        await sink.onFileDeleted?.({
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
          await sink.onFileCompleted?.({
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
        sink.onProtocolWarning?.(pe.code);
        return;
    }
  }
}
