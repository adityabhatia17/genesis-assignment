import { decideOutcome } from '../../../src/modules/generation/outcome.js';
import {
  DEMO_APP_JS,
  DEMO_INDEX_HTML,
  DEMO_STYLES_CSS,
} from '../../../src/modules/generation/llm/fake-scripts.js';
import {
  validateWrite,
  type FileOp,
} from '../../../src/modules/generation/validation/validate-file.js';
import { applyOps } from '../../../src/modules/generation/validation/validate-project.js';

const op = (p: string, c: string) => validateWrite(p, c).op as FileOp;
const demo = [
  op('index.html', DEMO_INDEX_HTML),
  op('styles.css', DEMO_STYLES_CSS),
  op('app.js', DEMO_APP_JS),
];
const empty = new Map();
const base = {
  stopReason: 'end_turn',
  ops: demo,
  rejected: [],
  aborted: [],
  currentTree: empty,
} as const;

describe('decideOutcome', () => {
  it('commits a valid completed stream', () => {
    expect(decideOutcome({ ...base, termination: 'completed' })).toEqual({
      kind: 'commit',
      warnings: [],
    });
  });
  it('commits a no-op for a question', () => {
    expect(decideOutcome({ ...base, termination: 'completed', ops: [] })).toEqual({
      kind: 'commit',
      warnings: [],
    });
  });
  it('fails with applyable partial on cancel/disconnect/timeout/provider error', () => {
    const partial = { stagedPaths: ['app.js', 'index.html', 'styles.css'], applyable: true };
    expect(decideOutcome({ ...base, termination: 'cancelled' })).toMatchObject({
      kind: 'fail',
      status: 'cancelled',
      partial,
    });
    expect(decideOutcome({ ...base, termination: 'disconnected' })).toMatchObject({
      status: 'interrupted',
      partial,
    });
    expect(decideOutcome({ ...base, termination: 'timeout' })).toMatchObject({
      status: 'failed',
      error: { code: 'GENERATION_TIMEOUT' },
    });
    expect(
      decideOutcome({
        ...base,
        termination: 'provider_error',
        providerErrorCode: 'LLM_UNAVAILABLE',
      }),
    ).toMatchObject({ status: 'failed', error: { code: 'LLM_UNAVAILABLE', retryable: true } });
  });
  it('marks partials that would break the project as not applyable', () => {
    const d = decideOutcome({
      ...base,
      termination: 'cancelled',
      ops: [op('index.html', DEMO_INDEX_HTML)],
    });
    expect(d).toMatchObject({ partial: { stagedPaths: ['index.html'], applyable: false } });
    const existing = applyOps(new Map(), demo);
    expect(
      decideOutcome({
        ...base,
        termination: 'cancelled',
        ops: [op('index.html', DEMO_INDEX_HTML)],
        currentTree: existing,
      }),
    ).toMatchObject({ partial: { applyable: true } });
  });
  it('handles refusal, truncation and invalid projects', () => {
    expect(
      decideOutcome({ ...base, termination: 'completed', stopReason: 'refusal' }),
    ).toMatchObject({
      error: { code: 'GENERATION_REFUSED' },
      partial: null,
    });
    expect(
      decideOutcome({
        ...base,
        termination: 'completed',
        stopReason: 'max_tokens',
        ops: [],
        aborted: [{ path: 'app.js', issues: [] }],
      }),
    ).toMatchObject({ error: { code: 'GENERATION_TRUNCATED' } });
    expect(
      decideOutcome({
        ...base,
        termination: 'completed',
        ops: [op('index.html', DEMO_INDEX_HTML)],
      }),
    ).toMatchObject({
      error: { code: 'GENERATION_INVALID_OUTPUT' },
      partial: { applyable: false },
    });
    expect(
      decideOutcome({
        ...base,
        termination: 'completed',
        stopReason: 'model_context_window_exceeded',
      }),
    ).toMatchObject({ error: { code: 'CONTEXT_TOO_LARGE' } });
  });
  it('adds a truncation warning when committing after max_tokens', () => {
    const d = decideOutcome({
      ...base,
      termination: 'completed',
      stopReason: 'max_tokens',
      aborted: [{ path: 'extra.js', issues: [] }],
    });
    expect(d).toMatchObject({
      kind: 'commit',
      warnings: [expect.objectContaining({ code: 'TRUNCATED' })],
    });
  });
});
