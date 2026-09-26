import type { ApplyResult } from '@/contracts/api';
import type { Issue, PartialResult } from '@/contracts/firestore-docs';
import type { FileLanguage } from '@/contracts/paths';
import type { GenerationEvent, GenerationPhase } from '@/contracts/sse';

export type GenerationStatus =
  | 'idle'
  | 'submitting'
  | 'streaming'
  | 'cancelling'
  | 'reconciling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export type TerminalStatus = 'completed' | 'failed' | 'interrupted';

export const isTerminal = (s: GenerationStatus): s is TerminalStatus =>
  s === 'completed' || s === 'failed' || s === 'interrupted';
export const isActive = (s: GenerationStatus): boolean =>
  s === 'submitting' || s === 'streaming' || s === 'reconciling';

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
}

/** What the reducer needs from a persisted generation document (see generations.repo.ts). */
export interface GenerationSnapshot {
  id: string;
  status: 'streaming' | TerminalStatus;
  prompt: string;
  error: GenerationErrorState | null;
  partial: PartialResult | null;
  result: GenerationSummary | null;
  heartbeatAtMs: number | null;
}

export type GenerationAction =
  | { type: 'submit'; generationId: string; prompt: string; at: number }
  | { type: 'attach'; generationId: string; prompt: string; at: number }
  | { type: 'event'; event: GenerationEvent; at: number }
  | { type: 'cancel-requested' }
  | { type: 'stream-lost' }
  | { type: 'reconciled'; snapshot: GenerationSnapshot }
  | { type: 'partial-applied'; result: ApplyResult }
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
      return { ...base, phase: 'context' };
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
    case 'stream-lost':
      return isActive(state.status) ? { ...state, status: 'reconciling' } : state;
    case 'reconciled':
      return reduceReconciled(state, action.snapshot);
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
