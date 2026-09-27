import { createPinia, setActivePinia } from 'pinia';
import { toast } from 'vue-sonner';
import type { GenerationEvent } from '@/contracts/sse';
import { ApiError } from '@/lib/http';
import type { GenerationSnapshot } from '@/features/workspace/stores/generation.reducer';
import { events, FAILED_WITH_PARTIAL, HAPPY } from '../../../fixtures/sse';

const stream = vi.fn();
const apply = vi.fn();
const discard = vi.fn();
const cancel = vi.fn();
let watcher: {
  next(s: GenerationSnapshot | null): void;
  error(e: Error): void;
} | null = null;

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/ids', () => ({ newId: () => 'g1' }));
vi.mock('@/services/api/generation-stream', () => ({
  streamGeneration: (...a: unknown[]) => stream(...a) as unknown,
}));
vi.mock('@/services/api/generations.api', () => ({
  applyGeneration: (...a: unknown[]) => apply(...a) as unknown,
  discardGeneration: (...a: unknown[]) => discard(...a) as unknown,
  cancelGeneration: (...a: unknown[]) => cancel(...a) as unknown,
}));
vi.mock('@/services/firestore/generations.repo', () => ({
  watchGeneration: (_u: string, _p: string, _g: string, w: typeof watcher) => {
    watcher = w;
    return () => (watcher = null);
  },
}));

const { useGenerationStore } = await import('@/features/workspace/stores/generation.store');

type StreamArgs = {
  onEvent: (e: GenerationEvent) => void;
  signal: AbortSignal;
};
const replay = (list: GenerationEvent[], outcome: { terminal: boolean; reason: string }) =>
  stream.mockImplementationOnce((o: StreamArgs) => {
    list.forEach(o.onEvent);
    return Promise.resolve(outcome);
  });
const snapshot = (over: Partial<GenerationSnapshot>): GenerationSnapshot => ({
  id: 'g1',
  status: 'streaming',
  prompt: 'Build it',
  error: null,
  partial: null,
  result: null,
  heartbeatAtMs: Date.now(),
  ...over,
});

describe('generation store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    watcher = null;
  });

  it('streams to completion and emits editor events', async () => {
    const store = useGenerationStore();
    store.bindProject('u1', 'p1');
    const started: string[] = [];
    store.bus.on('file-start', ({ path }) => started.push(path));
    const ended = vi.fn();
    store.bus.on('end', ended);
    replay(events('g1', HAPPY), { terminal: true, reason: 'terminal' });
    await store.start('Build it');
    expect(store.state.status).toBe('completed');
    expect(started).toEqual(['index.html', 'app.js']);
    expect(ended).toHaveBeenCalledWith({ outcome: 'completed' });
  });

  it('reconciles from Firestore when the stream drops', async () => {
    const store = useGenerationStore();
    store.bindProject('u1', 'p1');
    replay(events('g1', HAPPY).slice(0, 7), {
      terminal: false,
      reason: 'network',
    });
    await store.start('Build it');
    expect(store.state.status).toBe('reconciling');
    watcher?.next(
      snapshot({
        status: 'interrupted',
        partial: { stagedPaths: ['index.html'], applyable: true },
      }),
    );
    expect(store.state).toMatchObject({
      status: 'interrupted',
      partial: { applyable: true },
    });
    expect(watcher).toBeNull(); // stopped listening once terminal
  });

  it('attaches to the generation another tab is running', async () => {
    const store = useGenerationStore();
    store.bindProject('u1', 'p1');
    stream.mockRejectedValueOnce(
      new ApiError({
        code: 'GENERATION_IN_PROGRESS',
        message: 'busy',
        status: 409,
        retryable: true,
        details: { activeGenerationId: 'g0' },
      }),
    );
    await store.start('Build it');
    expect(store.state).toMatchObject({
      status: 'reconciling',
      origin: 'remote',
      generationId: 'g0',
    });
  });

  it('applies a partial result', async () => {
    const store = useGenerationStore();
    store.bindProject('u1', 'p1');
    replay(events('g1', FAILED_WITH_PARTIAL), {
      terminal: true,
      reason: 'terminal',
    });
    await store.start('Build it');
    apply.mockResolvedValueOnce({
      snapshotId: 's5',
      snapshotSeq: 5,
      appliedPaths: ['index.html'],
      deletedPaths: [],
    });
    await store.applyPartial();
    expect(apply).toHaveBeenCalledWith('p1', 'g1');
    expect(store.state).toMatchObject({
      status: 'completed',
      partial: null,
      result: { snapshotSeq: 5 },
    });
  });

  it('requests cancel without closing the stream', async () => {
    const store = useGenerationStore();
    store.bindProject('u1', 'p1');
    let signal: AbortSignal | undefined;
    stream.mockImplementationOnce((o: StreamArgs) => {
      signal = o.signal;
      o.onEvent(events('g1', HAPPY)[0]!);
      return new Promise(() => undefined);
    });
    void store.start('Build it');
    await vi.waitFor(() => expect(store.state.status).toBe('streaming'));
    cancel.mockResolvedValueOnce({ cancelled: true });
    await store.cancel();
    expect(cancel).toHaveBeenCalledWith('p1', 'g1');
    expect(signal?.aborted).toBe(false);
    expect(store.state.status).toBe('cancelling');
  });

  it('stays quiet when Stop races a generation that already finished', async () => {
    vi.mocked(toast.error).mockClear();
    const store = useGenerationStore();
    store.bindProject('u1', 'p1');
    stream.mockImplementationOnce((o: StreamArgs) => {
      o.onEvent(events('g1', HAPPY)[0]!);
      return new Promise(() => undefined);
    });
    void store.start('Build it');
    await vi.waitFor(() => expect(store.state.status).toBe('streaming'));
    cancel.mockRejectedValueOnce(
      new ApiError({
        code: 'GENERATION_NOT_CANCELLABLE',
        message: 'This generation is no longer running.',
        status: 409,
        retryable: false,
      }),
    );
    await store.cancel();
    expect(toast.error).not.toHaveBeenCalled();
    expect(store.state.status).toBe('streaming');
  });

  it('hydrates only running or unresolved generations', () => {
    const store = useGenerationStore();
    store.bindProject('u1', 'p1');
    store.hydrate(snapshot({ id: 'old', status: 'completed' }));
    expect(store.state.status).toBe('idle');
    store.hydrate(
      snapshot({
        id: 'g7',
        status: 'interrupted',
        partial: { stagedPaths: ['a.js'], applyable: true },
      }),
    );
    expect(store.state).toMatchObject({
      status: 'interrupted',
      generationId: 'g7',
    });
  });
});
