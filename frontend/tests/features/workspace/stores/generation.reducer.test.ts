import {
  initialGenerationState,
  isActive,
  isAwaitingSelection,
  isTerminal,
  reduceGeneration,
  type GenerationAction,
  type GenerationState,
} from '@/features/workspace/stores/generation.reducer';
import { phaseLabel } from '@/features/workspace/stores/generation.labels';
import { events, FAILED_WITH_PARTIAL, HAPPY } from '../../../fixtures/sse';

const run = (actions: GenerationAction[], from = initialGenerationState()): GenerationState =>
  actions.reduce(reduceGeneration, from);
const submit: GenerationAction = {
  type: 'submit',
  generationId: 'g1',
  prompt: 'Build it',
  at: 0,
};
const feed = (list: ReturnType<typeof events>): GenerationAction[] =>
  list.map((event) => ({ type: 'event', event, at: 1 }));

describe('generation reducer', () => {
  it('accumulates a full stream', () => {
    const s = run([submit, ...feed(events('g1', HAPPY))]);
    expect(s.status).toBe('completed');
    expect(s.prose).toBe('Building a contact list.');
    expect(s.thinking).toBe('Plan: list contacts.');
    expect(s.fileOrder).toEqual(['index.html', 'app.js']);
    expect(s.files['index.html']).toMatchObject({ status: 'valid', chars: 15 });
    expect(s.files['app.js']).toMatchObject({ status: 'rejected' });
    expect(s.result).toMatchObject({
      snapshotSeq: 4,
      changedPaths: ['index.html'],
    });
  });

  it('ignores foreign, duplicate and out-of-order events', () => {
    const list = events('g1', HAPPY);
    const s1 = run([submit, ...feed(list.slice(0, 5))]);
    const s2 = run([...feed([list[3]!, list[4]!]), ...feed(events('other', HAPPY))], s1);
    expect(s2).toBe(s1);
  });

  it('keeps the partial result of a failed generation', () => {
    const s = run([submit, ...feed(events('g1', FAILED_WITH_PARTIAL))]);
    expect(s.status).toBe('failed');
    expect(s.error?.code).toBe('LLM_UNAVAILABLE');
    expect(s.partial).toEqual({ stagedPaths: ['index.html'], applyable: true });
  });

  it('reconciles from the persisted document after the stream drops', () => {
    const streaming = run([
      submit,
      ...feed(events('g1', HAPPY).slice(0, 7)),
      { type: 'stream-lost' },
    ]);
    expect(streaming.status).toBe('reconciling');
    expect(phaseLabel(streaming)).toBe('Reconnecting…');
    const done = reduceGeneration(streaming, {
      type: 'reconciled',
      snapshot: {
        id: 'g1',
        status: 'interrupted',
        prompt: 'Build it',
        error: null,
        partial: { stagedPaths: ['index.html'], applyable: true },
        result: null,
        heartbeatAtMs: 0,
      },
    });
    expect(done).toMatchObject({
      status: 'interrupted',
      error: { code: 'GENERATION_INTERRUPTED' },
      partial: { applyable: true },
    });
  });

  it('marks cancellation and applies a partial result', () => {
    const cancelling = run([
      submit,
      ...feed(events('g1', HAPPY).slice(0, 2)),
      { type: 'cancel-requested' },
    ]);
    expect(phaseLabel(cancelling)).toBe('Stopping…');
    const cancelled = reduceGeneration(cancelling, {
      type: 'event',
      at: 4,
      event: {
        v: 1,
        seq: 99,
        generationId: 'g1',
        ts: 4,
        type: 'generation.cancelled',
        data: { partial: { stagedPaths: ['index.html'], applyable: true } },
      },
    });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.partial).toEqual({ stagedPaths: ['index.html'], applyable: true });
    const applied = reduceGeneration(cancelling, {
      type: 'partial-applied',
      result: {
        snapshotId: 's9',
        snapshotSeq: 9,
        appliedPaths: ['index.html'],
        deletedPaths: [],
      },
    });
    expect(applied).toMatchObject({
      status: 'completed',
      partial: null,
      result: { snapshotSeq: 9 },
    });
  });

  it('tracks a variants run until the options are ready', () => {
    const top = [
      {
        candidateId: 'c0' as const,
        rank: 1,
        topPick: true,
        total: 80,
        groups: {
          works: { points: 30, max: 35 },
          looks: { points: 24, max: 30 },
          request: { points: 12, max: 15 },
          easy: { points: 8, max: 10 },
        },
        direction: { id: 'agenda', label: 'Agenda by day' },
      },
    ];
    const s = run([
      submit,
      ...feed(
        events('g1', [
          {
            type: 'generation.started',
            data: {
              projectId: 'p1',
              model: 'm',
              promptVersion: 'v1',
              startedAt: '2026-10-07T00:00:00Z',
              mode: 'variants',
            },
          },
          { type: 'variants.phase', data: { phase: 'generating' } },
          { type: 'candidate.progress', data: { candidateId: 'c0', stage: 'done' } },
          {
            type: 'variants.ready',
            data: { top, notice: null, usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, durationMs: 10 },
          },
        ]),
      ),
    ]);
    expect(s.status).toBe('awaiting_selection');
    expect(s.mode).toBe('variants');
    expect(s.variants?.top).toEqual(top);
    expect(s.variants?.candidates.c0).toBe('done');
    expect(isAwaitingSelection(s.status)).toBe(true);
    expect(isActive(s.status)).toBe(false);
    expect(isTerminal(s.status)).toBe(false);
    expect(phaseLabel(s)).toBe('Choose a version');
  });

  it('labels each phase in plain words', () => {
    const s = run([submit, ...feed(events('g1', HAPPY).slice(0, 6))]);
    expect(phaseLabel(s)).toBe('Writing index.html…');
    expect(
      phaseLabel({
        status: 'reconciling',
        phase: null,
        streamingPath: null,
        origin: 'remote',
      }),
    ).toBe('Generating in another tab…');
  });
});
