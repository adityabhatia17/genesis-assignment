import type { ApplyResult, SelectCandidateResult } from '@/contracts/api';
import type { Issue, PartialResult } from '@/contracts/firestore-docs';
import type { FileLanguage } from '@/contracts/paths';
import type { GenerationEvent, GenerationPhase } from '@/contracts/sse';
import type { RankedEntry } from '@/contracts/variants';

export type GenerationStatus =
  | 'idle'
  | 'submitting'
  | 'streaming'
  | 'cancelling'
  | 'reconciling'
  | 'awaiting_selection'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export type TerminalStatus = 'completed' | 'failed' | 'interrupted' | 'cancelled';

export const isTerminal = (s: GenerationStatus): s is TerminalStatus =>
  s === 'completed' || s === 'failed' || s === 'interrupted' || s === 'cancelled';
export const isActive = (s: GenerationStatus): boolean =>
  s === 'submitting' || s === 'streaming' || s === 'reconciling' || s === 'cancelling';
/** The run has options ready and is waiting for the owner. Not active, not terminal. */
export const isAwaitingSelection = (s: GenerationStatus): boolean => s === 'awaiting_selection';

export type FallbackReason =
  | 'disabled'
  | 'budget'
  | 'user_limit'
  | 'global_limit'
  | 'busy'
  | 'not_first';
export type VariantsPhase = 'checklist' | 'generating' | 'scoring' | 'judging' | 'ranking';
export type CandidateStage =
  | 'queued'
  | 'generating'
  | 'retrying'
  | 'validating'
  | 'scoring'
  | 'done'
  | 'failed';

export interface VariantsProgress {
  phase: VariantsPhase | null;
  candidates: Readonly<Record<string, CandidateStage>>;
  top: readonly RankedEntry[] | null;
  notice: 'only_one_option' | 'unjudged' | null;
}

export interface VariantsSnapshot {
  resolution: 'selected' | 'discarded' | null;
  baseSnapshotId: string | null;
  notice: 'only_one_option' | 'unjudged' | null;
  top: readonly RankedEntry[] | null;
}

export interface FileOpState {
  path: string;
  op: 'write' | 'delete';
  language: FileLanguage | null;
  status: 'streaming' | 'valid' | 'rejected' | 'deleted';
  chars: number;
  issues: Issue[];
}

export interface GenerationErrorState {
  code: string;
  message: string;
  retryable: boolean;
}

export interface GenerationSummary {
  snapshotId: string;
  snapshotSeq: number;
  changedPaths: string[];
  deletedPaths: string[];
  rejected: { path: string; issues: Issue[] }[];
  noChanges: boolean;
}

export interface GenerationState {
  status: GenerationStatus;
  generationId: string | null;
  prompt: string;
  /** 'remote' = started in another tab or an earlier session; this tab only observes it. */
  origin: 'local' | 'remote';
  phase: GenerationPhase | null;
  thinking: string;
  prose: string;
  files: Readonly<Record<string, FileOpState>>;
  fileOrder: readonly string[];
  streamingPath: string | null;
  error: GenerationErrorState | null;
  /** Unresolved partial result (null once applied or discarded). */
  partial: PartialResult | null;
  result: GenerationSummary | null;
  lastSeq: number;
  lastEventAt: number | null;
  startedAt: number | null;
  mode: 'single' | 'variants' | null;
  fallbackReason: FallbackReason | null;
  variants: VariantsProgress | null;
}

/** What the reducer needs from a persisted generation document (see generations.repo.ts). */
export interface GenerationSnapshot {
  id: string;
  status: 'streaming' | 'awaiting_selection' | TerminalStatus;
  prompt: string;
  error: GenerationErrorState | null;
  partial: PartialResult | null;
  result: GenerationSummary | null;
  heartbeatAtMs: number | null;
  /** Absent on snapshots built before variants. Treat as single. */
  mode?: 'single' | 'variants';
  variants?: VariantsSnapshot | null;
}

export type GenerationAction =
  | { type: 'submit'; generationId: string; prompt: string; at: number }
  | { type: 'attach'; generationId: string; prompt: string; at: number }
  | { type: 'event'; event: GenerationEvent; at: number }
  | { type: 'cancel-requested' }
  | { type: 'cancel-failed' }
  | { type: 'stream-lost' }
  | { type: 'reconciled'; snapshot: GenerationSnapshot }
  | { type: 'partial-applied'; result: ApplyResult }
  | { type: 'variants-loaded'; top: readonly RankedEntry[]; notice: VariantsProgress['notice'] }
  | { type: 'variants-selected'; result: SelectCandidateResult }
  | { type: 'reset' };

export function initialGenerationState(): GenerationState {
  return {
    status: 'idle',
    generationId: null,
    prompt: '',
    origin: 'local',
    phase: null,
    thinking: '',
    prose: '',
    files: {},
    fileOrder: [],
    streamingPath: null,
    error: null,
    partial: null,
    result: null,
    lastSeq: 0,
    lastEventAt: null,
    startedAt: null,
    mode: null,
    fallbackReason: null,
    variants: null,
  };
}

const INTERRUPTED: GenerationErrorState = {
  code: 'GENERATION_INTERRUPTED',
  message: 'The connection was lost during generation.',
  retryable: true,
};
const FAILED: GenerationErrorState = {
  code: 'INTERNAL',
  message: 'Something went wrong. Please try again.',
  retryable: true,
};

const withFile = (state: GenerationState, file: FileOpState): Partial<GenerationState> => ({
  files: { ...state.files, [file.path]: file },
  fileOrder: state.fileOrder.includes(file.path)
    ? state.fileOrder
    : [...state.fileOrder, file.path],
});

/** SSE protocol v1 (07 §3.2). Ignores foreign, duplicate and late events. */
function reduceEvent(state: GenerationState, e: GenerationEvent, at: number): GenerationState {
  const receiving =
    state.status === 'submitting' || state.status === 'streaming' || state.status === 'cancelling';
  if (!receiving || e.generationId !== state.generationId || e.seq <= state.lastSeq) return state;
  const base: GenerationState = {
    ...state,
    lastSeq: e.seq,
    lastEventAt: at,
    status: state.status === 'submitting' ? 'streaming' : state.status,
  };
  const end = { phase: null, streamingPath: null } as const;

  switch (e.type) {
    case 'generation.started':
      return {
        ...base,
        phase: 'context',
        mode: e.data.mode ?? 'single',
        fallbackReason: e.data.fallbackReason ?? null,
        variants:
          (e.data.mode ?? 'single') === 'variants'
            ? { phase: null, candidates: {}, top: null, notice: null }
            : null,
      };
    case 'generation.phase':
      return { ...base, phase: e.data.phase };
    case 'assistant.thinking':
      return { ...base, thinking: state.thinking + e.data.text };
    case 'assistant.delta':
      return { ...base, prose: state.prose + e.data.text };
    case 'file.started':
      return {
        ...base,
        phase: 'writing',
        streamingPath: e.data.path,
        ...withFile(state, {
          path: e.data.path,
          op: 'write',
          language: e.data.language,
          status: 'streaming',
          chars: 0,
          issues: [],
        }),
      };
    case 'file.delta': {
      const file = state.files[e.data.path];
      if (!file) return base;
      return {
        ...base,
        ...withFile(state, { ...file, chars: file.chars + e.data.text.length }),
      };
    }
    case 'file.completed': {
      const file = state.files[e.data.path];
      return {
        ...base,
        streamingPath: state.streamingPath === e.data.path ? null : state.streamingPath,
        ...withFile(state, {
          path: e.data.path,
          op: 'write',
          language: file?.language ?? null,
          status: e.data.status,
          chars: file?.chars ?? 0,
          issues: e.data.issues,
        }),
      };
    }
    case 'file.deleted':
      return {
        ...base,
        ...withFile(state, {
          path: e.data.path,
          op: 'delete',
          language: null,
          status: e.data.status === 'valid' ? 'deleted' : 'rejected',
          chars: 0,
          issues: e.data.issues,
        }),
      };
    case 'heartbeat':
      return base;
    case 'generation.completed':
      return {
        ...base,
        ...end,
        status: 'completed',
        error: null,
        partial: null,
        result: {
          snapshotId: e.data.snapshotId,
          snapshotSeq: e.data.snapshotSeq,
          changedPaths: e.data.changedPaths,
          deletedPaths: e.data.deletedPaths,
          rejected: e.data.rejected,
          noChanges: e.data.noChanges,
        },
      };
    case 'generation.failed':
      return {
        ...base,
        ...end,
        status: 'failed',
        error: e.data.error,
        partial: e.data.partial,
      };
    case 'generation.cancelled':
      return {
        ...base,
        ...end,
        status: 'cancelled',
        error: null,
        partial: e.data.partial,
      };
    case 'variants.phase': {
      if (!state.variants) return base;
      return { ...base, variants: { ...state.variants, phase: e.data.phase } };
    }
    case 'candidate.progress': {
      if (!state.variants) return base;
      return {
        ...base,
        variants: {
          ...state.variants,
          candidates: { ...state.variants.candidates, [e.data.candidateId]: e.data.stage },
        },
      };
    }
    case 'variants.ready':
      return {
        ...base,
        ...end,
        status: 'awaiting_selection',
        variants: {
          phase: null,
          candidates: state.variants?.candidates ?? {},
          top: e.data.top,
          notice: e.data.notice,
        },
      };
  }
}

/** Applies the persisted outcome after the stream was lost, or for a generation seen from another tab. */
function reduceReconciled(state: GenerationState, g: GenerationSnapshot): GenerationState {
  if (g.id !== state.generationId || !isActive(state.status)) return state;
  if (g.status === 'streaming') {
    return state.status === 'submitting' ? { ...state, status: 'reconciling' } : state;
  }
  const common: GenerationState = {
    ...state,
    phase: null,
    streamingPath: null,
    prompt: state.prompt || g.prompt,
  };
  if (g.status === 'awaiting_selection') {
    return {
      ...common,
      status: 'awaiting_selection',
      mode: g.mode ?? state.mode ?? 'variants',
      error: null,
      partial: null,
      result: null,
      variants: {
        phase: null,
        candidates: state.variants?.candidates ?? {},
        top: g.variants?.top ?? state.variants?.top ?? null,
        notice: g.variants?.notice ?? state.variants?.notice ?? null,
      },
    };
  }
  switch (g.status) {
    case 'completed':
      return {
        ...common,
        status: 'completed',
        error: null,
        partial: null,
        result: g.result,
      };
    case 'failed':
      return {
        ...common,
        status: 'failed',
        error: g.error ?? FAILED,
        partial: g.partial,
      };
    case 'interrupted':
      return {
        ...common,
        status: 'interrupted',
        error: g.error ?? INTERRUPTED,
        partial: g.partial,
      };
    case 'cancelled':
      return {
        ...common,
        status: 'cancelled',
        error: null,
        partial: g.partial,
      };
  }
}

export function reduceGeneration(
  state: GenerationState,
  action: GenerationAction,
): GenerationState {
  switch (action.type) {
    case 'submit':
      return {
        ...initialGenerationState(),
        status: 'submitting',
        generationId: action.generationId,
        prompt: action.prompt,
        startedAt: action.at,
      };
    case 'attach':
      return {
        ...initialGenerationState(),
        status: 'reconciling',
        origin: 'remote',
        generationId: action.generationId,
        prompt: action.prompt,
        startedAt: action.at,
      };
    case 'event':
      return reduceEvent(state, action.event, action.at);
    case 'cancel-requested':
      return state.status === 'submitting' ||
        state.status === 'streaming' ||
        state.status === 'reconciling'
        ? { ...state, status: 'cancelling' }
        : state;
    case 'cancel-failed':
      if (state.status !== 'cancelling') return state;
      return { ...state, status: state.origin === 'remote' ? 'reconciling' : 'streaming' };
    case 'stream-lost':
      return isActive(state.status) ? { ...state, status: 'reconciling' } : state;
    case 'reconciled':
      return reduceReconciled(state, action.snapshot);
    case 'variants-loaded': {
      const open =
        state.status === 'interrupted' ||
        state.status === 'awaiting_selection' ||
        state.status === 'reconciling' ||
        state.status === 'failed';
      if (!open || action.top.length === 0) return state;
      return {
        ...state,
        status: 'awaiting_selection',
        mode: 'variants',
        error: null,
        phase: null,
        streamingPath: null,
        variants: {
          phase: null,
          candidates: state.variants?.candidates ?? {},
          top: action.top,
          notice: action.notice,
        },
      };
    }
    case 'variants-selected':
      return {
        ...state,
        status: 'completed',
        error: null,
        partial: null,
        phase: null,
        streamingPath: null,
        result: {
          snapshotId: action.result.snapshotId,
          snapshotSeq: action.result.snapshotSeq,
          changedPaths: action.result.appliedPaths,
          deletedPaths: [],
          rejected: [],
          noChanges: false,
        },
      };
    case 'partial-applied':
      return {
        ...state,
        status: 'completed',
        error: null,
        partial: null,
        result: {
          snapshotId: action.result.snapshotId,
          snapshotSeq: action.result.snapshotSeq,
          changedPaths: action.result.appliedPaths,
          deletedPaths: action.result.deletedPaths,
          rejected: [],
          noChanges: false,
        },
      };
    case 'reset':
      return initialGenerationState();
  }
}
