import { defaultMessage, isRetryable, type ErrorCode } from '../../contracts/errors.js';
import type { GenerationError, Issue, PartialResult } from '../../contracts/firestore-docs.js';
import type { FileOp } from './validation/validate-file.js';
import { applyOps, validateProject, type Tree } from './validation/validate-project.js';

export type Termination = 'completed' | 'cancelled' | 'disconnected' | 'timeout' | 'provider_error';
export interface RejectedFile {
  path: string;
  issues: Issue[];
}

export interface OutcomeInput {
  termination: Termination;
  providerErrorCode?: ErrorCode;
  stopReason: string | null;
  ops: readonly FileOp[];
  rejected: readonly RejectedFile[];
  aborted: readonly RejectedFile[];
  currentTree: Tree | null;
}

export type Decision =
  | { kind: 'commit'; warnings: Issue[] }
  | {
      kind: 'fail';
      status: 'failed' | 'cancelled' | 'interrupted';
      error: GenerationError | null;
      partial: PartialResult | null;
      issues?: Issue[];
    };

const err = (code: ErrorCode, message = defaultMessage(code)): GenerationError => ({
  code,
  message,
  retryable: isRetryable(code),
});

function partialOf(i: OutcomeInput): PartialResult | null {
  const stagedPaths = i.ops
    .filter((o) => o.op === 'write')
    .map((o) => o.path)
    .sort();
  if (stagedPaths.length === 0 || !i.currentTree)
    return stagedPaths.length ? { stagedPaths, applyable: false } : null;
  const valid = validateProject(applyOps(i.currentTree, i.ops)).every(
    (x) => x.severity !== 'error',
  );
  return { stagedPaths, applyable: valid };
}

export function decideOutcome(i: OutcomeInput): Decision {
  switch (i.termination) {
    case 'cancelled':
      return { kind: 'fail', status: 'cancelled', error: null, partial: partialOf(i) };
    case 'disconnected':
      return {
        kind: 'fail',
        status: 'interrupted',
        error: err('GENERATION_INTERRUPTED'),
        partial: partialOf(i),
      };
    case 'timeout':
      return {
        kind: 'fail',
        status: 'failed',
        error: err('GENERATION_TIMEOUT'),
        partial: partialOf(i),
      };
    case 'provider_error':
      return {
        kind: 'fail',
        status: 'failed',
        error: err(i.providerErrorCode ?? 'INTERNAL'),
        partial: partialOf(i),
      };
    case 'completed':
      break;
  }
  if (i.stopReason === 'refusal')
    return { kind: 'fail', status: 'failed', error: err('GENERATION_REFUSED'), partial: null };
  if (i.stopReason === 'model_context_window_exceeded')
    return { kind: 'fail', status: 'failed', error: err('CONTEXT_TOO_LARGE'), partial: null };

  const bad = [...i.rejected, ...i.aborted];
  if (i.ops.length === 0) {
    if (bad.length === 0 && i.stopReason !== 'max_tokens') return { kind: 'commit', warnings: [] };
    const code: ErrorCode =
      i.stopReason === 'max_tokens' ? 'GENERATION_TRUNCATED' : 'GENERATION_INVALID_OUTPUT';
    return {
      kind: 'fail',
      status: 'failed',
      error: err(code),
      partial: null,
      issues: bad.flatMap((b) => b.issues),
    };
  }

  const tree = i.currentTree ?? new Map();
  const projectIssues = validateProject(applyOps(tree, i.ops));
  const errors = projectIssues.filter((x) => x.severity === 'error');
  if (errors.length > 0) {
    const code: ErrorCode =
      i.stopReason === 'max_tokens' ? 'GENERATION_TRUNCATED' : 'GENERATION_INVALID_OUTPUT';
    return {
      kind: 'fail',
      status: 'failed',
      error: err(
        code,
        `${defaultMessage(code)} ${errors.map((e) => e.message).join(' ')}`.slice(0, 500),
      ),
      partial: {
        stagedPaths: i.ops
          .filter((o) => o.op === 'write')
          .map((o) => o.path)
          .sort(),
        applyable: false,
      },
      issues: [...errors, ...bad.flatMap((b) => b.issues)],
    };
  }
  const warnings = projectIssues.filter((x) => x.severity === 'warning');
  if (i.stopReason === 'max_tokens')
    warnings.push({
      code: 'TRUNCATED',
      severity: 'warning',
      message: 'The response hit the length limit; unfinished files were skipped.',
    });
  return { kind: 'commit', warnings };
}
