import type {
  FallbackReason,
  GenerationState,
  VariantsPhase,
} from '@/features/workspace/stores/generation.reducer';

export type ProblemKind =
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'none_qualified'
  | 'provider_busy'
  | 'expired'
  | 'project_changed';

/** Owner-facing copy for the variants stage. One place, so wording changes once. */
export const DOUBLE_CHECK_BEFORE_SELECT = true;

export const STAGE_ORDER = [
  'checklist',
  'generating',
  'scoring',
  'judging',
  'ranking',
] as const satisfies readonly VariantsPhase[];

export const STAGE_LABELS: Record<VariantsPhase, string> = {
  checklist: 'Understanding your request',
  generating: 'Creating versions',
  scoring: 'Testing them',
  judging: 'Reviewing the design',
  ranking: 'Choosing the best two',
};

export function stageLabel(phase: VariantsPhase | null): string {
  return phase ? STAGE_LABELS[phase] : 'Starting';
}

export function stageIndex(phase: VariantsPhase | null): number {
  if (!phase) return 0;
  return STAGE_ORDER.indexOf(phase);
}

export function fallbackNotice(reason: FallbackReason | null): string | null {
  switch (reason) {
    case 'budget':
    case 'global_limit':
      return 'Showing one version for now. Side-by-side options are paused for today.';
    case 'user_limit':
      return "You've used today's side-by-side builds, so this is a single version.";
    case 'busy':
      return "We're busy right now, so this is a single version.";
    default:
      return null;
  }
}

export const LONG_WAIT_MS = 4 * 60_000;

export function problemKind(
  state: Pick<GenerationState, 'status' | 'error' | 'mode'>,
): ProblemKind | null {
  if (state.mode !== 'variants') return null;
  if (state.status === 'cancelled') return 'cancelled';
  if (state.status === 'interrupted') return 'interrupted';
  if (state.status !== 'failed') return null;
  const code = state.error?.code;
  if (code === 'GENERATION_INVALID_OUTPUT') return 'none_qualified';
  if (code === 'LLM_RATE_LIMITED' || code === 'LLM_UNAVAILABLE') return 'provider_busy';
  return 'failed';
}

export const PROBLEM_COPY: Record<ProblemKind, { title: string; description: string }> = {
  failed: {
    title: "We couldn't build your options",
    description: 'Something went wrong before the options were ready.',
  },
  cancelled: {
    title: 'Stopped',
    description: 'The build was stopped before any options were ready.',
  },
  interrupted: {
    title: 'The connection was lost',
    description: 'The build stopped before any option was ready to show.',
  },
  none_qualified: {
    title: "We couldn't finish your options",
    description:
      'Nothing was ready to show. You can try again. This attempt does not use one of your side-by-side builds.',
  },
  provider_busy: {
    title: 'The AI service is busy',
    description: 'Nothing was built. Try again in a moment.',
  },
  expired: {
    title: 'These options are no longer available',
    description: 'They were kept for a week. Start again with the same request.',
  },
  project_changed: {
    title: 'This project changed',
    description:
      'The options were built from an earlier version of the project, so they can no longer be used.',
  },
};
