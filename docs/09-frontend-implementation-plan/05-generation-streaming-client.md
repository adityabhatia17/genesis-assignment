# FE-4 — Generation streaming client (R-BE5, R-BE6, R-FE3, R-FE6, R-C5)

> Read [`00-overview.md`](00-overview.md) first. Spec: [`../06-frontend-system-design.md`](../06-frontend-system-design.md) §11; protocol: [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §3.2 (SSE v1), §4.6–§4.9, §5.2.

The client handles **every** SSE event type (`generation.started`, `generation.phase`, `assistant.thinking`, `assistant.delta`, `file.started`, `file.delta`, `file.completed`, `file.deleted`, `heartbeat`, `generation.completed`, `generation.failed`), ignores unknown ones, and treats the persisted generation document as the source of truth whenever the stream is lost. User-initiated cancel (R-B1) is implemented: Stop, `POST …/cancel`, and `cancelling` / `cancelled`. The client does not abort the SSE fetch.

---

### Task FE-4.1: SSE client over `fetch`

**Files:**

- Create: `frontend/src/services/api/generation-stream.ts`, `frontend/tests/fixtures/sse.ts`
- Test: `frontend/tests/services/api/generation-stream.test.ts`

**Interfaces:** Produces `streamGeneration({ projectId, clientRequestId, prompt, signal, onEvent, watchdogMs?, onInvalidEvent? }) → Promise<{ terminal: boolean; reason: 'terminal' | 'closed' | 'watchdog' | 'network' | 'aborted' }>`; throws `ApiError` for JSON errors before the stream starts (409 `GENERATION_IN_PROGRESS {activeGenerationId}`, 409 `DUPLICATE_REQUEST`, 429, 400, 503). Test fixtures: `events(generationId, drafts)`, `HAPPY`, `FAILED_WITH_PARTIAL`, `toSse(list)`.

`EventSource` cannot POST or send `Authorization`, so the client uses `fetch` + `eventsource-parser` (framing) + the zod schema from the contracts (payloads).

- [ ] **Step 1: Fixtures and failing tests** (the stream is split at random byte boundaries 20 times)

`frontend/tests/fixtures/sse.ts`:

```ts
import type { GenerationEvent } from '@/contracts/sse';

type Draft = { type: GenerationEvent['type']; data: unknown };

/** Builds a valid protocol-v1 event sequence (seq from 1) like the backend's fake provider emits. */
export function events(generationId: string, drafts: Draft[]): GenerationEvent[] {
  return drafts.map(
    (d, i) =>
      ({
        v: 1,
        seq: i + 1,
        generationId,
        ts: 1_000 + i,
        ...d,
      }) as GenerationEvent,
  );
}

export const HAPPY: Draft[] = [
  {
    type: 'generation.started',
    data: {
      projectId: 'p1',
      model: 'claude-opus-5',
      promptVersion: 'v1',
      startedAt: '2026-10-01T00:00:00Z',
    },
  },
  { type: 'generation.phase', data: { phase: 'thinking' } },
  { type: 'assistant.thinking', data: { text: 'Plan: list contacts.' } },
  { type: 'assistant.delta', data: { text: 'Building a ' } },
  { type: 'assistant.delta', data: { text: 'contact list.' } },
  {
    type: 'file.started',
    data: { path: 'index.html', language: 'html', op: 'write' },
  },
  { type: 'file.delta', data: { path: 'index.html', text: '<!DOCTYPE html>' } },
  {
    type: 'file.completed',
    data: {
      path: 'index.html',
      status: 'valid',
      sizeBytes: 15,
      sha256: 'a'.repeat(64),
      issues: [],
    },
  },
  {
    type: 'file.started',
    data: { path: 'app.js', language: 'javascript', op: 'write' },
  },
  { type: 'file.delta', data: { path: 'app.js', text: 'let x = ;' } },
  {
    type: 'file.completed',
    data: {
      path: 'app.js',
      status: 'rejected',
      sizeBytes: 9,
      sha256: 'b'.repeat(64),
      issues: [
        {
          code: 'JS_SYNTAX',
          message: 'Unexpected token',
          severity: 'error',
          path: 'app.js',
        },
      ],
    },
  },
  { type: 'heartbeat', data: {} },
  { type: 'generation.phase', data: { phase: 'committing' } },
  {
    type: 'generation.completed',
    data: {
      snapshotId: 's4',
      snapshotSeq: 4,
      changedPaths: ['index.html'],
      deletedPaths: [],
      rejected: [
        {
          path: 'app.js',
          issues: [
            {
              code: 'JS_SYNTAX',
              message: 'Unexpected token',
              severity: 'error',
            },
          ],
        },
      ],
      warnings: [],
      noChanges: false,
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: 0.01,
      },
      durationMs: 1200,
    },
  },
];

export const FAILED_WITH_PARTIAL: Draft[] = [
  HAPPY[0]!,
  HAPPY[5]!,
  HAPPY[6]!,
  HAPPY[7]!,
  {
    type: 'generation.failed',
    data: {
      error: {
        code: 'LLM_UNAVAILABLE',
        message: 'The AI service is unavailable right now.',
        retryable: true,
      },
      partial: { stagedPaths: ['index.html'], applyable: true },
    },
  },
];

/** Serializes events as the server writes them (07 §3.2 frame format). */
export const toSse = (list: GenerationEvent[]): string =>
  list.map((e) => `event: ${e.type}\nid: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`).join('');
```

`frontend/tests/services/api/generation-stream.test.ts`:

```ts
// @vitest-environment node
import type { GenerationEvent } from '@/contracts/sse';
import { configureHttp } from '@/lib/http';
import { streamGeneration } from '@/services/api/generation-stream';
import { events, HAPPY, toSse } from '../../fixtures/sse';

/** A response body that yields `text` in random-sized byte chunks (like a real network). */
function sseResponse(text: string, { close = true } = {}): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        if (close) controller.close();
        return;
      }
      const size = 1 + Math.floor(Math.random() * 40);
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

const options = (onEvent: (e: GenerationEvent) => void, signal = new AbortController().signal) => ({
  projectId: 'p1',
  clientRequestId: 'g1',
  prompt: 'Build it',
  signal,
  onEvent,
});

describe('streamGeneration', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    configureHttp({
      baseUrls: {
        api: 'https://fn.test/api',
        generate: 'https://fn.test/generate',
      },
      getIdToken: () => Promise.resolve('t'),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('delivers every event in order regardless of chunk boundaries', async () => {
    const list = events('g1', HAPPY);
    for (let run = 0; run < 20; run += 1) {
      fetchMock.mockResolvedValueOnce(sseResponse(toSse(list)));
      const seen: number[] = [];
      const outcome = await streamGeneration(options((e) => seen.push(e.seq)));
      expect(outcome).toEqual({ terminal: true, reason: 'terminal' });
      expect(seen).toEqual(list.map((e) => e.seq));
    }
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://fn.test/generate/v1/projects/p1/generations');
    expect((init?.headers as Record<string, string>)['Accept']).toBe('text/event-stream');
  });

  it('skips unknown and malformed events (forward compatible)', async () => {
    const list = events('g1', HAPPY);
    const noise = 'event: future.thing\ndata: {"v":1,"type":"future.thing"}\n\ndata: not json\n\n';
    fetchMock.mockResolvedValueOnce(sseResponse(noise + toSse(list)));
    const seen: string[] = [];
    const invalid = vi.fn();
    await streamGeneration({
      ...options((e) => seen.push(e.type)),
      onInvalidEvent: invalid,
    });
    expect(seen).toHaveLength(list.length);
    expect(invalid).toHaveBeenCalledTimes(1);
  });

  it('reports a stream that closes without a terminal event', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(toSse(events('g1', HAPPY).slice(0, 5))));
    await expect(streamGeneration(options(() => undefined))).resolves.toEqual({
      terminal: false,
      reason: 'closed',
    });
  });

  it('aborts on silence (watchdog)', async () => {
    fetchMock.mockImplementationOnce((_url, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener('abort', () =>
                controller.error(new DOMException('aborted', 'AbortError')),
              );
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      ),
    );
    await expect(
      streamGeneration({ ...options(() => undefined), watchdogMs: 20 }),
    ).resolves.toEqual({ terminal: false, reason: 'watchdog' });
  });

  it('throws ApiError for JSON errors before the stream starts', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'GENERATION_IN_PROGRESS',
            message: 'busy',
            retryable: true,
            details: { activeGenerationId: 'g0' },
            requestId: 'r',
          },
        }),
        {
          status: 409,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    await expect(streamGeneration(options(() => undefined))).rejects.toMatchObject({
      code: 'GENERATION_IN_PROGRESS',
      details: { activeGenerationId: 'g0' },
    });
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/services/api/generation-stream.ts`:

```ts
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { LIMITS } from '@/contracts/limits';
import { GenerationEventSchema, isTerminalEvent, type GenerationEvent } from '@/contracts/sse';
import {
  apiUrl,
  authorizedHeaders,
  combineSignals,
  parseErrorResponse,
  toTransportError,
} from '@/lib/http';

export interface StreamGenerationOptions {
  projectId: string;
  clientRequestId: string;
  prompt: string;
  signal: AbortSignal;
  onEvent: (event: GenerationEvent) => void;
  watchdogMs?: number;
  onInvalidEvent?: (sample: string) => void;
}

export type StreamEndReason = 'terminal' | 'closed' | 'watchdog' | 'network' | 'aborted';

export interface StreamOutcome {
  terminal: boolean;
  reason: StreamEndReason;
}

/**
 * POSTs the prompt to the `generate` function and consumes SSE protocol v1 (07 §3.2).
 * Pre-stream failures throw ApiError; once streaming, the outcome says why the stream ended.
 */
export async function streamGeneration(o: StreamGenerationOptions): Promise<StreamOutcome> {
  const watchdogMs = o.watchdogMs ?? LIMITS.sseWatchdogMs;
  const watchdog = new AbortController();
  const signal = combineSignals([o.signal, watchdog.signal]);

  let res: Response;
  try {
    res = await fetch(
      apiUrl('generate', `/v1/projects/${encodeURIComponent(o.projectId)}/generations`),
      {
        method: 'POST',
        headers: {
          ...(await authorizedHeaders()),
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientRequestId: o.clientRequestId,
          prompt: o.prompt,
        }),
        signal,
        cache: 'no-store',
      },
    );
  } catch (error) {
    throw toTransportError(error, o.signal);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok || !contentType.includes('text/event-stream') || !res.body) {
    throw await parseErrorResponse(res);
  }

  let terminal = false;
  let warned = false;
  let timer = setTimeout(() => watchdog.abort(), watchdogMs);
  const parser = createParser({
    onEvent(message: EventSourceMessage) {
      let json: unknown = null;
      try {
        json = JSON.parse(message.data);
      } catch {
        json = null;
      }
      const parsed = GenerationEventSchema.safeParse(json);
      if (!parsed.success) {
        // Unknown event types and invalid payloads are ignored (forward compatible), reported once.
        if (!warned) o.onInvalidEvent?.(message.data.slice(0, 200));
        warned = true;
        return;
      }
      if (isTerminalEvent(parsed.data)) terminal = true;
      o.onEvent(parsed.data);
    },
  });

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      clearTimeout(timer);
      timer = setTimeout(() => watchdog.abort(), watchdogMs);
      parser.feed(value);
      if (terminal) break; // the server ends the response right after the terminal event
    }
  } catch {
    if (o.signal.aborted) return { terminal, reason: 'aborted' };
    if (watchdog.signal.aborted) return { terminal, reason: 'watchdog' };
    return { terminal, reason: 'network' };
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
  return { terminal, reason: terminal ? 'terminal' : 'closed' };
}
```

- [ ] **Step 3: Run** `npm test -- tests/services/api` → PASS. **Commit** — `feat(frontend): add SSE generation client with watchdog`

---

### Task FE-4.2: Generation reducer and labels

**Files:**

- Create: `frontend/src/features/workspace/stores/generation.reducer.ts`, `generation.labels.ts`
- Test: `frontend/tests/features/workspace/stores/generation.reducer.test.ts`

**Interfaces:** Produces `GenerationStatus` (`idle | submitting | streaming | reconciling | completed | failed | interrupted`), `TerminalStatus`, `isTerminal`, `isActive`, `FileOpState`, `GenerationState`, `GenerationSnapshot`, `GenerationSummary`, `GenerationAction` (`submit | attach | event | stream-lost | reconciled | partial-applied | reset`), `initialGenerationState()`, `reduceGeneration(state, action)`; `phaseLabel(state)`, `outcomeTitle(state)`.

- [ ] **Step 1: Failing test**

`frontend/tests/features/workspace/stores/generation.reducer.test.ts`:

```ts
import {
  initialGenerationState,
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
```

- [ ] **Step 2: Implement** (pure: no Vue, no I/O)

`frontend/src/features/workspace/stores/generation.reducer.ts`:

```ts
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
    case 'cancelled':
      return {
        ...common,
        status: 'cancelled',
        error: null,
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
```

`frontend/src/features/workspace/stores/generation.labels.ts`:

```ts
import type { GenerationState } from './generation.reducer';

type LabelInput = Pick<GenerationState, 'status' | 'phase' | 'streamingPath' | 'origin'>;

/** Plain, factual progress text for the status pill and the live message. */
export function phaseLabel(s: LabelInput): string | null {
  switch (s.status) {
    case 'submitting':
      return 'Starting…';
    case 'cancelling':
      return 'Stopping…';
    case 'reconciling':
      return s.origin === 'remote' ? 'Generating in another tab…' : 'Reconnecting…';
    case 'streaming':
      switch (s.phase) {
        case 'context':
          return 'Reading project…';
        case 'thinking':
          return 'Planning…';
        case 'writing':
          return s.streamingPath ? `Writing ${s.streamingPath}…` : 'Writing files…';
        case 'validating':
          return 'Checking files…';
        case 'committing':
          return 'Saving…';
        default:
          return 'Starting…';
      }
    default:
      return null;
  }
}

export function outcomeTitle(s: Pick<GenerationState, 'status' | 'error'>): string | null {
  switch (s.status) {
    case 'failed':
      return s.error?.message ?? 'Generation failed.';
    case 'cancelled':
      return 'Generation cancelled.';
    case 'interrupted':
      return s.error?.message ?? 'The connection was lost during generation.';
    default:
      return null;
  }
}
```

- [ ] **Step 3: Run** → PASS. **Commit** — `feat(frontend): add pure generation reducer and phase labels`

---

### Task FE-4.3: Generation store, editor bus, live message

**Files:**

- Create: `frontend/src/services/api/generations.api.ts`, `frontend/src/services/firestore/generations.repo.ts`, `frontend/src/features/workspace/stores/generation-bus.ts`, `stores/generation.store.ts`, `chat/LiveAssistantMessage.vue`, `chat/ThinkingDisclosure.vue`, `chat/FileOpChips.vue`, `chat/GenerationStatusPill.vue`
- Test: `frontend/tests/features/workspace/stores/generation.store.test.ts`

**Interfaces:**

- Produces: `applyGeneration`, `discardGeneration` (A14–A15); `toGenerationSnapshot(doc)`, `fetchLatestGeneration(uid, projectId)`, `watchGeneration(uid, projectId, generationId, { next, error })`; `createGenerationBus()` with events `file-start {path, language}`, `file-delta {path, text}`, `file-end {path, status}`, `end {outcome}`; `useGenerationStore()` → `state, status, active, applying, discarding, bus, bindProject(uid, projectId), teardown(), start(prompt), applyPartial(), discardPartial(), retry(), dismiss(), hydrate(snapshot)`; constant `STALE_AFTER_MS = 90000`. Do not add `cancel()` or `POST …/cancel` (R-B1).
- Streamed file text goes to the bus (→ Monaco, FE-5.5), never into reactive state.

- [ ] **Step 1: Failing test** (covers completion, stream loss → reconcile, another tab, apply, cancel fallback, hydration)

`frontend/tests/features/workspace/stores/generation.store.test.ts`:

```ts
import { createPinia, setActivePinia } from 'pinia';
import type { GenerationEvent } from '@/contracts/sse';
import { ApiError } from '@/lib/http';
import type { GenerationSnapshot } from '@/features/workspace/stores/generation.reducer';
import { events, FAILED_WITH_PARTIAL, HAPPY } from '../../../fixtures/sse';

const stream = vi.fn();
const cancel = vi.fn();
const apply = vi.fn();
const discard = vi.fn();
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
  cancelGeneration: (...a: unknown[]) => cancel(...a) as unknown,
  applyGeneration: (...a: unknown[]) => apply(...a) as unknown,
  discardGeneration: (...a: unknown[]) => discard(...a) as unknown,
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

  it('cancels, falling back to Firestore when no terminal event arrives', async () => {
    vi.useFakeTimers();
    const store = useGenerationStore();
    store.bindProject('u1', 'p1');
    let signal: AbortSignal | null = null;
    stream.mockImplementationOnce((o: StreamArgs) => {
      signal = o.signal;
      events('g1', HAPPY).slice(0, 3).forEach(o.onEvent);
      return new Promise((resolve) =>
        o.signal.addEventListener('abort', () => resolve({ terminal: false, reason: 'aborted' })),
      );
    });
    void store.start('Build it');
    await vi.advanceTimersByTimeAsync(0);
    cancel.mockResolvedValueOnce({ status: 'cancelling' });
    const cancelling = store.cancel();
    await vi.advanceTimersByTimeAsync(5_001);
    await cancelling;
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(store.state.status).toBe('reconciling');
    watcher?.next(snapshot({ status: 'cancelled', partial: null }));
    expect(store.state.status).toBe('cancelled');
    vi.useRealTimers();
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
```

- [ ] **Step 2: Implement services and store**

`frontend/src/services/api/generations.api.ts`:

```ts
import type { z } from 'zod';
import type { ApplyResult, DiscardResult } from '@/contracts/api';
import { apiFetch } from '@/lib/http';

const base = (projectId: string, generationId: string) =>
  `/v1/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}`;

export function applyGeneration(projectId: string, generationId: string): Promise<ApplyResult> {
  return apiFetch('api', `${base(projectId, generationId)}/apply`, {
    method: 'POST',
    body: {},
  });
}

export function discardGeneration(
  projectId: string,
  generationId: string,
): Promise<z.infer<typeof DiscardResult>> {
  return apiFetch('api', `${base(projectId, generationId)}/discard`, {
    method: 'POST',
    body: {},
  });
}
```

`frontend/src/services/firestore/generations.repo.ts`:

```ts
import { getDocs, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { toMillis } from '@/lib/time';
import type { GenerationSnapshot } from '@/features/workspace/stores/generation.reducer';
import { refs } from './paths';
import type { Generation } from './types';

export function toGenerationSnapshot(g: Generation): GenerationSnapshot {
  const unresolved =
    g.partial !== null && g.partial.appliedAt === null && g.partial.discardedAt === null;
  return {
    id: g.id,
    status: g.status,
    prompt: g.prompt,
    error: g.error,
    partial:
      unresolved && g.partial
        ? { stagedPaths: g.partial.stagedPaths, applyable: g.partial.applyable }
        : null,
    result: g.result
      ? {
          snapshotId: g.result.snapshotId,
          snapshotSeq: g.result.snapshotSeq,
          changedPaths: g.result.changedPaths,
          deletedPaths: g.result.deletedPaths,
          rejected: g.result.rejected,
          noChanges: g.result.noChanges,
        }
      : null,
    heartbeatAtMs: toMillis(g.heartbeatAt),
  };
}

export async function fetchLatestGeneration(
  uid: string,
  projectId: string,
): Promise<GenerationSnapshot | null> {
  const snap = await getDocs(
    query(refs.generations(uid, projectId), orderBy('createdAt', 'desc'), limit(1)),
  );
  const first = snap.docs[0];
  return first ? toGenerationSnapshot(first.data()) : null;
}

export interface GenerationWatcher {
  next(snapshot: GenerationSnapshot | null): void;
  error(error: Error): void;
}

export function watchGeneration(
  uid: string,
  projectId: string,
  generationId: string,
  w: GenerationWatcher,
): () => void {
  return onSnapshot(
    refs.generation(uid, projectId, generationId),
    (snap) => w.next(snap.exists() ? toGenerationSnapshot(snap.data()) : null),
    (error) => w.error(error),
  );
}
```

`frontend/src/features/workspace/stores/generation-bus.ts`:

```ts
import type { FileLanguage } from '@/contracts/paths';
import type { TerminalStatus } from './generation.reducer';

/** Editor-facing stream events. Text never goes through Vue reactivity. */
export interface GenerationBusEvents {
  'file-start': { path: string; language: FileLanguage };
  'file-delta': { path: string; text: string };
  'file-end': { path: string; status: 'valid' | 'rejected' };
  end: { outcome: TerminalStatus };
}

type Handler<T> = (payload: T) => void;

export interface GenerationBus {
  on<K extends keyof GenerationBusEvents>(
    type: K,
    handler: Handler<GenerationBusEvents[K]>,
  ): () => void;
  emit<K extends keyof GenerationBusEvents>(type: K, payload: GenerationBusEvents[K]): void;
}

export function createGenerationBus(): GenerationBus {
  type AnyHandler = (payload: unknown) => void;
  const handlers = new Map<keyof GenerationBusEvents, Set<AnyHandler>>();
  return {
    on(type, handler) {
      const fn = handler as AnyHandler;
      const set = handlers.get(type) ?? new Set<AnyHandler>();
      handlers.set(type, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(type, payload) {
      for (const handler of handlers.get(type) ?? []) {
        try {
          handler(payload);
        } catch (error) {
          console.error('[generation-bus] handler failed', error);
        }
      }
    },
  };
}
```

`frontend/src/features/workspace/stores/generation.store.ts`:

```ts
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { toast } from 'vue-sonner';
import { LIMITS } from '@/contracts/limits';
import type { GenerationEvent } from '@/contracts/sse';
import { retryAfterSeconds, toUserMessage } from '@/lib/errors';
import { isApiError } from '@/lib/http';
import { newId } from '@/lib/ids';
import { streamGeneration } from '@/services/api/generation-stream';
import {
  applyGeneration,
  cancelGeneration,
  discardGeneration,
} from '@/services/api/generations.api';
import { watchGeneration } from '@/services/firestore/generations.repo';
import { createGenerationBus } from './generation-bus';
import {
  initialGenerationState,
  isActive,
  isTerminal,
  reduceGeneration,
  type GenerationAction,
  type GenerationSnapshot,
  type GenerationState,
} from './generation.reducer';

export const CANCEL_GRACE_MS = 5_000;
export const MISSING_DOC_GRACE_MS = 5_000;
/** Server lease staleness (60 s) plus a margin for client clock skew. */
export const STALE_AFTER_MS = LIMITS.staleLeaseMs + 30_000;
export const STALE_CHECK_MS = 15_000;

export const useGenerationStore = defineStore('generation', () => {
  const state = shallowRef<GenerationState>(initialGenerationState());
  const applying = ref(false);
  const discarding = ref(false);
  const bus = createGenerationBus();

  let uid: string | null = null;
  let projectId: string | null = null;
  let streamAbort: AbortController | null = null;
  let stopWatching: (() => void) | null = null;
  let terminalWaiters: (() => void)[] = [];
  const handledIds = new Set<string>();

  const status = computed(() => state.value.status);
  const active = computed(() => isActive(state.value.status));

  function dispatch(action: GenerationAction): void {
    const prev = state.value;
    const next = reduceGeneration(prev, action);
    if (next === prev) return;
    state.value = next;
    if (isTerminal(next.status) && !isTerminal(prev.status)) {
      bus.emit('end', { outcome: next.status });
      const waiters = terminalWaiters;
      terminalWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  function onStreamEvent(event: GenerationEvent): void {
    const before = state.value.lastSeq;
    dispatch({ type: 'event', event, at: Date.now() });
    if (state.value.lastSeq === before) return; // ignored: foreign, duplicate or late
    if (event.type === 'file.started')
      bus.emit('file-start', {
        path: event.data.path,
        language: event.data.language,
      });
    else if (event.type === 'file.delta') bus.emit('file-delta', event.data);
    else if (event.type === 'file.completed')
      bus.emit('file-end', {
        path: event.data.path,
        status: event.data.status,
      });
  }

  function project(): { uid: string; projectId: string } {
    if (!uid || !projectId) throw new Error('Generation store is not bound to a project');
    return { uid, projectId };
  }

  function bindProject(nextUid: string, nextProjectId: string): void {
    if (uid === nextUid && projectId === nextProjectId) return;
    teardown();
    uid = nextUid;
    projectId = nextProjectId;
  }

  /** Leaving the workspace: closing the stream makes the server finish the generation as interrupted. */
  function teardown(): void {
    streamAbort?.abort();
    streamAbort = null;
    stopWatching?.();
    stopWatching = null;
    terminalWaiters = [];
    handledIds.clear();
    state.value = initialGenerationState();
    uid = null;
    projectId = null;
  }

  async function start(prompt: string): Promise<void> {
    const { projectId: pid } = project();
    if (active.value) return;
    const generationId = newId(); // doubles as clientRequestId (idempotency key)
    handledIds.add(generationId);
    dispatch({ type: 'submit', generationId, prompt, at: Date.now() });
    const controller = new AbortController();
    streamAbort = controller;
    try {
      const outcome = await streamGeneration({
        projectId: pid,
        clientRequestId: generationId,
        prompt,
        signal: controller.signal,
        onEvent: onStreamEvent,
        onInvalidEvent: (sample) => console.warn('[generation] ignored invalid SSE event', sample),
      });
      const stillCurrent = state.value.generationId === generationId;
      if (stillCurrent && !outcome.terminal && outcome.reason !== 'aborted') {
        dispatch({ type: 'stream-lost' });
        reconcile(generationId);
      }
    } catch (error) {
      if (state.value.generationId === generationId) handleStartError(error, generationId);
    } finally {
      if (streamAbort === controller) streamAbort = null;
    }
  }

  function handleStartError(error: unknown, generationId: string): void {
    const code = isApiError(error) ? error.code : null;
    switch (code) {
      case 'GENERATION_IN_PROGRESS': {
        const activeId = isApiError(error) ? error.details['activeGenerationId'] : undefined;
        toast.info('A generation is already running for this project.');
        if (typeof activeId === 'string') attach(activeId, '');
        else dispatch({ type: 'reset' });
        return;
      }
      case 'DUPLICATE_REQUEST':
      case 'NETWORK':
      case 'TIMEOUT':
        // The request may have reached the server: the generation document decides.
        dispatch({ type: 'stream-lost' });
        reconcile(generationId);
        return;
      case 'ABORTED':
        dispatch({ type: 'reset' });
        return;
      default:
        toast.error(toUserMessage(error));
        dispatch({ type: 'reset' });
    }
  }

  function attach(generationId: string, prompt: string): void {
    handledIds.add(generationId);
    dispatch({ type: 'attach', generationId, prompt, at: Date.now() });
    reconcile(generationId);
  }

  /** Follows the persisted generation document until it reaches a terminal status. */
  function reconcile(generationId: string): void {
    const { uid: u, projectId: pid } = project();
    stopWatching?.();
    let latest: GenerationSnapshot | null = null;
    let missingTimer: ReturnType<typeof setTimeout> | null = null;
    let finalizeRequested = false;
    let stopped = false;
    let unsubscribe: (() => void) | null = null;

    const cleanup = (): void => {
      stopped = true;
      unsubscribe?.();
      clearInterval(staleTimer);
      if (missingTimer) clearTimeout(missingTimer);
      if (stopWatching === cleanup) stopWatching = null;
    };

    // A generation whose heartbeat stopped belongs to a dead instance: the next
    // start/apply treats the lease as stale and finalizes it as interrupted (07 §4.8).
    const checkStale = (): void => {
      const snapshot = latest;
      if (!snapshot || snapshot.status !== 'streaming' || finalizeRequested) return;
      if (snapshot.heartbeatAtMs === null || Date.now() - snapshot.heartbeatAtMs <= STALE_AFTER_MS)
        return;
      finalizeRequested = true;
      dispatch({
        type: 'reconciled',
        snapshot: {
          ...snapshot,
          status: 'interrupted',
          error: null,
          partial: snapshot.partial,
        },
      });
    };
    const staleTimer = setInterval(checkStale, STALE_CHECK_MS);
    stopWatching = cleanup;

    unsubscribe = watchGeneration(u, pid, generationId, {
      next: (snapshot) => {
        if (!snapshot) {
          missingTimer ??= setTimeout(() => {
            cleanup();
            toast.error("Couldn't start the generation. Check your connection and try again.");
            dispatch({ type: 'reset' });
          }, MISSING_DOC_GRACE_MS);
          return;
        }
        if (missingTimer) {
          clearTimeout(missingTimer);
          missingTimer = null;
        }
        latest = snapshot;
        dispatch({ type: 'reconciled', snapshot });
        if (isTerminal(state.value.status) || state.value.generationId !== generationId) cleanup();
        else checkStale();
      },
      error: (error) => toast.error(toUserMessage(error)),
    });
    if (stopped) unsubscribe();
  }

  function waitForTerminal(ms: number): Promise<boolean> {
    if (isTerminal(state.value.status)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        terminalWaiters = terminalWaiters.filter((w) => w !== done);
        resolve(false);
      }, ms);
      terminalWaiters.push(done);
    });
  }

  function abortAndReconcile(generationId: string): void {
    streamAbort?.abort();
    streamAbort = null;
    if (isTerminal(state.value.status)) return;
    dispatch({ type: 'stream-lost' });
    if (!stopWatching) reconcile(generationId);
  }

  async function applyPartial(): Promise<void> {
    const { projectId: pid } = project();
    const { generationId, partial } = state.value;
    if (!generationId || !partial?.applyable || applying.value) return;
    applying.value = true;
    try {
      const result = await applyGeneration(pid, generationId);
      dispatch({ type: 'partial-applied', result });
      const n = result.appliedPaths.length + result.deletedPaths.length;
      toast.success(
        `Applied ${n} file change${n === 1 ? '' : 's'} · Snapshot #${result.snapshotSeq}`,
      );
    } catch (error) {
      const issues = isApiError(error) ? error.details['issues'] : undefined;
      const first = Array.isArray(issues)
        ? (issues[0] as { message?: unknown } | undefined)
        : undefined;
      const detail = typeof first?.message === 'string' ? ` ${first.message}` : '';
      toast.error(`${toUserMessage(error)}${detail}`);
    } finally {
      applying.value = false;
    }
  }

  async function discardPartial(): Promise<void> {
    const { projectId: pid } = project();
    const { generationId } = state.value;
    if (!generationId || discarding.value) return;
    discarding.value = true;
    try {
      await discardGeneration(pid, generationId);
      dispatch({ type: 'reset' });
      toast.success('Discarded the unfinished files.');
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      discarding.value = false;
    }
  }

  function retry(): void {
    const prompt = state.value.prompt;
    if (!prompt || active.value) return;
    dispatch({ type: 'reset' });
    void start(prompt);
  }

  function dismiss(): void {
    if (isTerminal(state.value.status)) dispatch({ type: 'reset' });
  }

  /**
   * Called with the project's latest generation (page load) or its activeGeneration (another tab).
   * Shows running generations and unresolved partial results; ignores everything else.
   */
  function hydrate(snapshot: GenerationSnapshot): void {
    if (state.value.status !== 'idle' || handledIds.has(snapshot.id)) return;
    if (snapshot.status === 'streaming') {
      attach(snapshot.id, snapshot.prompt);
      return;
    }
    if (snapshot.status === 'completed' || !snapshot.partial?.applyable) return;
    handledIds.add(snapshot.id);
    dispatch({
      type: 'attach',
      generationId: snapshot.id,
      prompt: snapshot.prompt,
      at: Date.now(),
    });
    dispatch({ type: 'reconciled', snapshot });
  }

  return {
    state,
    status,
    active,
    applying,
    discarding,
    bus,
    bindProject,
    teardown,
    start,
    cancel,
    applyPartial,
    discardPartial,
    retry,
    dismiss,
    hydrate,
  };
});
```

- [ ] **Step 3: Live UI**

`frontend/src/features/workspace/chat/LiveAssistantMessage.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { Spinner } from '@/components/ui/spinner';
import { phaseLabel } from '../stores/generation.labels';
import type { GenerationState } from '../stores/generation.reducer';
import FileOpChips from './FileOpChips.vue';
import ThinkingDisclosure from './ThinkingDisclosure.vue';

const props = defineProps<{ state: GenerationState }>();
const emit = defineEmits<{ 'open-file': [path: string] }>();

const label = computed(() => phaseLabel(props.state));
const files = computed(() => props.state.fileOrder.flatMap((p) => props.state.files[p] ?? []));
const streaming = computed(() => props.state.status === 'streaming');
</script>

<template>
  <div class="px-1" data-testid="live-message">
    <p class="mb-1 text-[11px] font-medium text-muted-foreground">Genesis</p>
    <p v-if="label" class="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
      <Spinner class="size-3.5" />{{ label }}
    </p>
    <ThinkingDisclosure v-if="props.state.thinking" :text="props.state.thinking" class="mb-2" />
    <p v-if="props.state.prose" class="text-sm whitespace-pre-wrap">
      {{ props.state.prose
      }}<span
        v-if="streaming"
        class="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-foreground/60 motion-safe:animate-pulse"
        aria-hidden="true"
      />
    </p>
    <FileOpChips
      v-if="files.length"
      :files="files"
      class="mt-2"
      @open="emit('open-file', $event)"
    />
  </div>
</template>
```

`frontend/src/features/workspace/chat/ThinkingDisclosure.vue`:

```vue
<script setup lang="ts">
import { ChevronRightIcon } from '@lucide/vue';
import { ref } from 'vue';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const props = defineProps<{ text: string }>();
const open = ref(false);
</script>

<template>
  <Collapsible v-model:open="open" class="rounded-md border bg-muted/30">
    <CollapsibleTrigger
      class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
    >
      <ChevronRightIcon
        :class="[
          'size-3.5 transition-transform motion-reduce:transition-none',
          open && 'rotate-90',
        ]"
      />
      Planning
    </CollapsibleTrigger>
    <CollapsibleContent>
      <p
        class="max-h-48 overflow-y-auto px-3 pb-2.5 text-xs whitespace-pre-wrap text-muted-foreground"
      >
        {{ props.text }}
      </p>
    </CollapsibleContent>
  </Collapsible>
</template>
```

`frontend/src/features/workspace/chat/FileOpChips.vue`:

```vue
<script setup lang="ts">
import { CheckIcon, Trash2Icon, XIcon } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { FileOpState } from '../stores/generation.reducer';

const props = defineProps<{ files: FileOpState[] }>();
const emit = defineEmits<{ open: [path: string] }>();

const label = (f: FileOpState): string =>
  ({
    streaming: 'writing',
    valid: 'written',
    rejected: 'rejected',
    deleted: 'deleted',
  })[f.status];
</script>

<template>
  <ul class="flex flex-wrap gap-1.5" aria-label="Files in this generation">
    <li v-for="file in props.files" :key="file.path">
      <Tooltip :disabled="file.issues.length === 0">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            :aria-label="`${file.path}, ${label(file)}`"
            @click="emit('open', file.path)"
          >
            <Badge
              :variant="file.status === 'rejected' ? 'destructive' : 'outline'"
              class="gap-1 font-mono text-[11px]"
            >
              <Spinner v-if="file.status === 'streaming'" class="size-3" />
              <CheckIcon v-else-if="file.status === 'valid'" class="size-3 text-success" />
              <Trash2Icon v-else-if="file.status === 'deleted'" class="size-3" />
              <XIcon v-else class="size-3" />
              {{ file.path }}
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent class="max-w-72">
          <p v-for="issue in file.issues" :key="issue.code + issue.message">
            {{ issue.message }}
          </p>
        </TooltipContent>
      </Tooltip>
    </li>
  </ul>
</template>
```

`frontend/src/features/workspace/chat/GenerationStatusPill.vue`:

```vue
<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { phaseLabel } from '../stores/generation.labels';
import { useGenerationStore } from '../stores/generation.store';

const { state } = storeToRefs(useGenerationStore());
const label = computed(() => phaseLabel(state.value));
</script>

<template>
  <div aria-live="polite" class="contents">
    <Badge v-if="label" variant="secondary" class="gap-1.5 font-normal">
      <Spinner class="size-3" />{{ label }}
    </Badge>
  </div>
</template>
```

- [ ] **Step 4: Run** → PASS. With emulators + `LLM_PROVIDER=fake`: send a prompt → pill "Reading project…" → "Planning…" → "Writing index.html…" → "Saving…"; prose streams with a caret; chips turn from spinner to check. **Commit** — `feat(frontend): add generation store and live assistant message`

---

### Task FE-4.4: Cancel (bonus R-B1)

Implemented (R-B1): Stop button, `cancel()` store action, and `POST …/cancel`. Interrupted/failed generations still offer Apply / Discard / Retry (FE-4.5). A 409 `GENERATION_NOT_CANCELLABLE` is ignored when the run already finished.

### Task FE-4.5: Outcome banner — Apply / Discard / Retry (R-C5)

**Files:**

- Create: `frontend/src/features/workspace/chat/GenerationOutcomeBanner.vue`
- Test: `frontend/tests/features/workspace/chat/GenerationOutcomeBanner.test.ts`

**Interfaces:** Reads `useGenerationStore().state`; calls `applyPartial`, `discardPartial`, `retry`, `dismiss`.

| Outcome                                                     | Banner                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| failed / cancelled / interrupted **with** applyable partial | "N files were completed…" + **Apply N files** · **Discard** · **Retry** |
| failed without partial                                      | error message + **Retry** (if retryable) + **Dismiss**                  |
| completed with rejected files                               | warning list `path — first issue` + **Dismiss**                         |

- [ ] **Step 1: Failing test**

`frontend/tests/features/workspace/chat/GenerationOutcomeBanner.test.ts`:

```ts
import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import {
  initialGenerationState,
  type GenerationState,
} from '@/features/workspace/stores/generation.reducer';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
const { useGenerationStore } = await import('@/features/workspace/stores/generation.store');
const { default: Banner } = await import('@/features/workspace/chat/GenerationOutcomeBanner.vue');

function render(state: Partial<GenerationState>) {
  const pinia = createTestingPinia({ createSpy: vi.fn });
  const store = useGenerationStore(pinia);
  store.state = { ...initialGenerationState(), ...state };
  return { wrapper: mount(Banner, { global: { plugins: [pinia] } }), store };
}

describe('GenerationOutcomeBanner', () => {
  it('offers Apply / Discard / Retry for an interrupted generation with finished files', async () => {
    const { wrapper, store } = render({
      status: 'interrupted',
      prompt: 'Build it',
      error: {
        code: 'GENERATION_INTERRUPTED',
        message: 'The connection was lost during generation.',
        retryable: true,
      },
      partial: { stagedPaths: ['index.html', 'styles.css'], applyable: true },
    });
    expect(wrapper.text()).toContain('2 files were completed');
    const button = (label: string) =>
      wrapper.findAll('button').find((b) => b.text().includes(label))!;
    await button('Apply 2 files').trigger('click');
    await button('Discard').trigger('click');
    await button('Retry').trigger('click');
    expect(store.applyPartial).toHaveBeenCalled();
    expect(store.discardPartial).toHaveBeenCalled();
    expect(store.retry).toHaveBeenCalled();
  });

  it('lists rejected files after a completed generation', () => {
    const { wrapper } = render({
      status: 'completed',
      result: {
        snapshotId: 's',
        snapshotSeq: 2,
        changedPaths: [],
        deletedPaths: [],
        noChanges: false,
        rejected: [
          {
            path: 'app.js',
            issues: [
              {
                code: 'JS_SYNTAX',
                message: 'Unexpected token',
                severity: 'error',
              },
            ],
          },
        ],
      },
    });
    expect(wrapper.get('[data-testid="rejected-banner"]').text()).toContain(
      'app.js — Unexpected token',
    );
  });

  it('renders nothing while idle', () => {
    expect(render({}).wrapper.html()).toBe('<!--v-if-->');
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/features/workspace/chat/GenerationOutcomeBanner.vue`:

```vue
<script setup lang="ts">
import { RotateCcwIcon, TriangleAlertIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { outcomeTitle } from '../stores/generation.labels';
import { useGenerationStore } from '../stores/generation.store';

const store = useGenerationStore();
const { state, applying, discarding } = storeToRefs(store);

const title = computed(() => outcomeTitle(state.value));
const staged = computed(() => state.value.partial?.stagedPaths.length ?? 0);
const applyable = computed(() => state.value.partial?.applyable === true && staged.value > 0);
const rejected = computed(() =>
  state.value.status === 'completed' ? (state.value.result?.rejected ?? []) : [],
);
const retryable = computed(
  () => state.value.status === 'cancelled' || state.value.error?.retryable !== false,
);
</script>

<template>
  <Alert v-if="title" variant="destructive" class="mx-4 mb-3" data-testid="outcome-banner">
    <TriangleAlertIcon />
    <AlertTitle>{{ title }}</AlertTitle>
    <AlertDescription class="flex flex-col gap-2">
      <p v-if="applyable">
        {{ staged }} {{ staged === 1 ? 'file was' : 'files were' }} completed before it stopped:
        {{ state.partial?.stagedPaths.join(', ') }}.
      </p>
      <div class="flex flex-wrap gap-2">
        <template v-if="applyable">
          <Button size="sm" :disabled="applying || discarding" @click="store.applyPartial()">
            <Spinner v-if="applying" />Apply {{ staged }}
            {{ staged === 1 ? 'file' : 'files' }}
          </Button>
          <Button
            size="sm"
            variant="outline"
            :disabled="applying || discarding"
            @click="store.discardPartial()"
          >
            <Spinner v-if="discarding" />Discard
          </Button>
        </template>
        <Button
          v-if="retryable"
          size="sm"
          variant="outline"
          :disabled="applying"
          @click="store.retry()"
        >
          <RotateCcwIcon />Retry
        </Button>
        <Button v-if="!applyable" size="sm" variant="ghost" @click="store.dismiss()"
          >Dismiss</Button
        >
      </div>
    </AlertDescription>
  </Alert>
  <Alert v-else-if="rejected.length" class="mx-4 mb-3" data-testid="rejected-banner">
    <TriangleAlertIcon class="text-warning" />
    <AlertTitle
      >{{ rejected.length }}
      {{ rejected.length === 1 ? 'file was' : 'files were' }}
      rejected</AlertTitle
    >
    <AlertDescription>
      <ul class="list-disc pl-4">
        <li v-for="r in rejected" :key="r.path">
          <span class="font-mono">{{ r.path }}</span> —
          {{ r.issues[0]?.message ?? 'Invalid file' }}
        </li>
      </ul>
      <Button size="sm" variant="ghost" class="mt-1 -ml-2" @click="store.dismiss()">Dismiss</Button>
    </AlertDescription>
  </Alert>
</template>
```

- [ ] **Step 3: Run** → PASS. Manual: fake `#error` script → banner "The AI service is unavailable right now." + Apply 1 file; Apply → toast "Applied 1 file change · Snapshot #n" and the file appears. **Commit** — `feat(frontend): add generation outcome banner with apply, discard and retry`

---

### Task FE-4.6: Disconnections, other tabs and leaving the page (R-FE6)

**Files:**

- Create: `frontend/src/features/workspace/composables/useGeneration.ts`
- Modify: `frontend/src/features/workspace/WorkspacePage.vue` (call `useGeneration()`, as in FE-3.1)

**Interfaces:** Consumes `fetchLatestGeneration`, `useGenerationStore().hydrate/bindProject/teardown`, `confirmAction`.

Behaviour: on load, a running generation (another tab, or this tab before a refresh) is attached and followed; a generation that stopped with applyable files shows the banner; a generation started by another tab while this one is open is picked up from `project.activeGeneration`. Leaving with a local running generation or unsaved edits asks first (router guard + `beforeunload`). A stream that ends without a terminal event or stays silent for 45 s → "Reconnecting…" → the generation document decides; a heartbeat older than 90 s is treated as interrupted so the partial result becomes applyable.

- [ ] **Step 1: Implement**

`frontend/src/features/workspace/composables/useGeneration.ts`:

```ts
import { useEventListener } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { onBeforeUnmount, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { confirmAction } from '@/composables/useConfirm';
import { fetchLatestGeneration } from '@/services/firestore/generations.repo';
import { isActive } from '../stores/generation.reducer';
import { useGenerationStore } from '../stores/generation.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useWorkspace } from '../workspace-context';

/**
 * Binds the generation store to the open project: shows generations started elsewhere or left
 * unresolved (FE-4.6), and protects running generations and unsaved edits when leaving.
 */
export function useGeneration(): void {
  const ws = useWorkspace();
  const store = useGenerationStore();
  const workspace = useWorkspaceStore();
  const { state } = storeToRefs(store);
  store.bindProject(ws.uid, ws.projectId);

  // Page load: a still-running generation, or one that stopped with applyable files.
  fetchLatestGeneration(ws.uid, ws.projectId)
    .then((latest) => {
      if (latest) store.hydrate(latest);
    })
    .catch((error: unknown) =>
      console.warn('[generation] could not read the latest generation', error),
    );

  // Another tab (or session) starts generating while this one is open.
  watch(
    () => ws.project.value?.activeGeneration?.id ?? null,
    (id) => {
      if (!id) return;
      store.hydrate({
        id,
        status: 'streaming',
        prompt: '',
        error: null,
        partial: null,
        result: null,
        heartbeatAtMs: null,
      });
    },
  );

  onBeforeRouteLeave(async () => {
    if (workspace.dirtyPaths.length > 0) {
      const ok = await confirmAction({
        title: 'Leave with unsaved changes?',
        description: `Unsaved edits in ${workspace.dirtyPaths.join(', ')} will be lost.`,
        confirmLabel: 'Leave',
        destructive: true,
      });
      if (!ok) return false;
    }
    if (isActive(state.value.status) && state.value.origin === 'local') {
      return confirmAction({
        title: 'Leave while generating?',
        description:
          'The generation continues on the server. If the connection drops, finished files can be applied when you come back.',
        confirmLabel: 'Leave',
        destructive: true,
      });
    }
    return true;
  });

  useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
    if (
      workspace.dirtyPaths.length > 0 ||
      (isActive(state.value.status) && state.value.origin === 'local')
    ) {
      event.preventDefault();
    }
  });

  onBeforeUnmount(() => store.teardown());
}
```

- [ ] **Step 2: Verify the disconnection matrix manually** (emulators, fake provider `#slow`):

| Action mid-stream                               | Expected                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| DevTools → Network → Offline                    | pill "Reconnecting…"; offline banner; back online → banner "The connection was lost during generation." + Apply/Discard/Retry |
| Refresh the tab                                 | after reload the banner (or the running generation) is shown                                                                  |
| Open the project in a second tab and send there | first tab shows "Generating in another tab…", editor read-only, then the result                                               |
| Kill the functions emulator                     | after ~90 s the generation is finalized as interrupted                                                                        |

- [ ] **Step 3: Commit** — `feat(frontend): reconcile interrupted generations and guard leaving mid-generation`
