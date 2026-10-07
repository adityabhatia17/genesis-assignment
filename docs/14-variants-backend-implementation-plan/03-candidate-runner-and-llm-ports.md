# BV-3 — Candidate runner and LLM ports

> **As built.** The runner is `variants/candidate-pipeline.ts`. It stages the candidate's files under `candidates/{cid}/staged` and does not commit. A retry happens for validation failure, an empty write set or a provider error. The retry message is a fixed line. It does not carry the issue list, does not clear staged files, and has no per-attempt deadline. The structured client is `llm/structured-client.ts`. The gated provider is `llm/gated-provider.ts`. `decideOutcome` is not reused: outcome mapping lives inside the pipeline. The direction block is written inline as `Design direction — <label>`. There is no `directionSystemBlock` export.

> Read [`00-overview.md`](00-overview.md) first. Existing code: `modules/generation/orchestrator.ts` (its `RunState` and `onParserEvent`), `llm/model-provider.ts`, `llm/anthropic.provider.ts`, `shared/async.ts`. Existing design: [`../05-backend-system-design.md`](../05-backend-system-design.md) §8.

**Outcome:** the parse-validate-stage loop that today lives inside `GenerationOrchestrator.run` is a reusable `CandidateRunner` driven by a sink. The single-candidate flow uses it with **identical observable behaviour** (same SSE events in the same order, same Firestore writes). Variants use it four times in parallel. Two new LLM ports exist for non-streaming JSON calls (checklist, judge) and for global stream concurrency.

---

### Task BV-3.1: Extract `CandidateRunner`

**Files:**

- Create: `functions/src/modules/generation/candidate/candidate-sink.ts`
- Create: `functions/src/modules/generation/candidate/candidate-runner.ts`
- (Adapter edit in BV-3.2.)

**Interfaces:**

- Consumes: `ModelProvider`, `FileStreamParser`, `validateWrite`, `validateDelete`, `decideOutcome`'s inputs (`RejectedFile`, `Termination`), `Tree`, `CurrentFile`, `GenerationAbort`-style abort reasons.
- Produces:
  - `interface CandidateSink` (below)
  - `interface CandidateRunInput { system: SystemBlock[]; messages: ChatTurn[]; currentFiles: Map<string, CurrentFile>; currentTree: Tree; signal: AbortSignal }`
  - `interface CandidateRunResult { ops: FileOp[]; rejected: RejectedFile[]; aborted: RejectedFile[]; warnings: Issue[]; prose: string; raw: string; final: ProviderResult | null; termination: Termination; providerErrorCode?: ProviderError['code']; firstTokenAtMs: number | null }`
  - `class CandidateRunner { constructor(provider: ModelProvider, clock: Clock, log: Logger); run(input, sink): Promise<CandidateRunResult> }`

- [ ] **Step 1: Define the sink** — everything the old orchestrator did inline with `sse` and `generations` becomes a callback. All callbacks may be async; the runner awaits them in order (preserving backpressure via `sse.drain()` in the single-mode sink).

```ts
export interface CandidateSink {
  onFirstToken?(): void;
  onThinking?(text: string): void | Promise<void>;
  onWritingStarted?(): void | Promise<void>;
  onProse?(text: string): void | Promise<void>;
  onFileStarted?(path: string, language: FileLanguage): void | Promise<void>;
  onFileDelta?(path: string, text: string): void | Promise<void>;
  /** Called for valid ops so the sink can stage them durably. */
  stage(op: FileOp, warnings: Issue[]): Promise<void>;
  onFileCompleted?(ev: {
    path: string;
    status: 'valid' | 'rejected';
    sizeBytes: number;
    sha256: string;
    issues: Issue[];
  }): void | Promise<void>;
  onFileDeleted?(ev: {
    path: string;
    status: 'valid' | 'rejected';
    issues: Issue[];
  }): void | Promise<void>;
  /** After each chunk batch; the single-mode sink waits for the socket to drain here. */
  afterChunk?(): Promise<void>;
  onProtocolWarning?(code: string): void;
}
```

- [ ] **Step 2: Move the logic.** Copy `RunState` and the body of `onParserEvent` from `orchestrator.ts` into `CandidateRunner` unchanged in behaviour, replacing each `sse.send(...)` and `this.d.generations.stage(...)` with the matching sink call. The run loop is the existing one:

```ts
async run(i: CandidateRunInput, sink: CandidateSink): Promise<CandidateRunResult> {
  const s = new RunState(i.currentFiles, i.currentTree);
  let final: ProviderResult | null = null;
  let termination: Termination = 'completed';
  let providerErrorCode: ProviderError['code'] | undefined;
  try {
    const stream = this.provider.stream({ system: i.system, messages: i.messages, signal: i.signal });
    const parser = new FileStreamParser();
    let writing = false;
    for await (const ev of stream) {
      if (s.firstTokenAtMs === null) { s.firstTokenAtMs = this.clock.now(); sink.onFirstToken?.(); }
      if (ev.type === 'thinking_delta') { await sink.onThinking?.(ev.text); continue; }
      if (!writing) { writing = true; await sink.onWritingStarted?.(); }
      s.raw += ev.text;
      for (const pe of parser.push(ev.text)) await this.onParserEvent(pe, sink, s);
      await sink.afterChunk?.();
    }
    for (const pe of parser.finish()) await this.onParserEvent(pe, sink, s);
    final = await stream.final();
  } catch (err) {
    ({ termination, providerErrorCode } = classify(err, i.signal)); // same rules as today's catch block
  }
  return { ...s.toResult(), final, termination, providerErrorCode };
}
```

`classify` reproduces the current mapping exactly: an aborted signal whose reason is a `GenerationAbort` wins (`cancelled` | `disconnected` | `timeout`); a `ProviderError` becomes `provider_error` with its code; anything else becomes `provider_error` / `INTERNAL`. Move `GenerationAbort` into `candidate/abort.ts` so both orchestrators share it.

- [ ] **Step 3: What does _not_ move.** Lease handling, heartbeats, SSE opening, deadlines, cancel watching, outcome decision, commit and finalization stay in the orchestrators. The runner knows nothing about Firestore or HTTP.

**Done when:** `candidate-runner.ts` has no import from `express`, `firebase-admin` or the repos; the single-mode flow can be expressed entirely as runner + sink.

---

### Task BV-3.2: Adapt `GenerationOrchestrator` to the runner

**Files:**

- Modify: `functions/src/modules/generation/orchestrator.ts`

**Interfaces:**

- Consumes: `CandidateRunner`, `CandidateSink`.
- Produces: unchanged public API (`GenerationOrchestrator.run(req, res, input)`), unchanged SSE and Firestore behaviour.

- [ ] **Step 1:** Replace the inner `try { … for await … } catch` block and `onParserEvent` with a call to `runner.run(...)` and a `SingleModeSink` built from `sse` and `generations`:

```ts
const sink: CandidateSink = {
  onFirstToken: () => {
    state.firstTokenAtMs ??= clock.now();
  },
  onThinking: (text) => void sse.send('assistant.thinking', { text }),
  onWritingStarted: () => void sse.send('generation.phase', { phase: 'writing' }),
  onProse: (text) => void sse.send('assistant.delta', { text }),
  onFileStarted: (path, language) => void sse.send('file.started', { path, language, op: 'write' }),
  onFileDelta: (path, text) => void sse.send('file.delta', { path, text }),
  stage: (op, warnings) =>
    generations.stage(i.uid, i.projectId, i.generationId, op, warnings, clock.now()),
  onFileCompleted: (ev) => void sse.send('file.completed', ev),
  onFileDeleted: (ev) => void sse.send('file.deleted', ev),
  afterChunk: () => sse.drain(),
  onProtocolWarning: (code) => log.warn('generation.protocol_warning', { code }),
};
const result = await this.runner.run(
  {
    system: ctx.system,
    messages: ctx.messages,
    currentFiles: ctx.currentFiles,
    currentTree: state.currentTree,
    signal: abort.signal,
  },
  sink,
);
```

- [ ] **Step 2:** Feed `result.ops`, `result.rejected`, `result.aborted`, `result.warnings`, `result.prose`, `result.raw`, `result.final`, `result.termination` and `result.providerErrorCode` into the existing `decideOutcome` and `finish` code unchanged. `RunState` in the orchestrator keeps only what `finish` still needs (`stats`, `firstTokenAtMs`, `raw`).

- [ ] **Step 3:** `OrchestratorDeps` gains `runner: CandidateRunner` (constructed in `composition.ts` from the provider and clock, BV-7.7). Public constructor use elsewhere is only in composition.

**Done when:** a single generation produces the same SSE sequence and the same Firestore documents as before this task (compare against the existing scenario matrix `BE-6.8`, which is the regression gate for this refactor).

---

### Task BV-3.3: Structured (JSON) client

**Files:**

- Create: `functions/src/modules/generation/llm/structured-client.ts`
- Create: `functions/src/modules/generation/llm/anthropic-structured.client.ts`
- Create: `functions/src/modules/generation/llm/fake-structured.client.ts`

**Interfaces:**

- Consumes: `z`, `Anthropic`, `mapProviderError`, `ProviderError`, `TokenUsage`, `estimateCostUsd`.
- Produces:
  - `interface StructuredRequest<T> { model: string; system: string; user: string; schema: z.ZodType<T>; schemaName: string; maxTokens: number; signal: AbortSignal; timeoutMs: number }`
  - `interface StructuredResult<T> { data: T; usage: TokenUsage; model: string; repaired: boolean }`
  - `interface StructuredClient { complete<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> }`
  - `class AnthropicStructuredClient implements StructuredClient`, `class FakeStructuredClient implements StructuredClient`

- [ ] **Step 1: Port**

```ts
export interface StructuredClient {
  complete<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}
```

- [ ] **Step 2: Anthropic implementation.** Non-streaming `messages.create` with a **single forced tool** whose input schema is the JSON Schema of `req.schema` (via `z.toJSONSchema`), `tool_choice: { type: 'tool', name: req.schemaName }`, **no thinking** (forced tool choice is incompatible with extended thinking, and these calls are short), `max_tokens: req.maxTokens`, request `signal`, and the shared client's retry settings. Read the `tool_use` block's `input`, `req.schema.safeParse` it, and on failure make **one** repair call that includes the zod error text and asks for corrected JSON; if it still fails, throw `ProviderError('INTERNAL', 'Structured output invalid')`. Map SDK errors with the existing `mapProviderError`. Wrap the whole call in `withTimeout(…, req.timeoutMs, …)`.

```ts
const msg = await this.client.messages.create(
  {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
    tools: [
      {
        name: req.schemaName,
        description: 'Return the result.',
        input_schema: z.toJSONSchema(req.schema) as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: req.schemaName },
  },
  { signal: req.signal },
);
```

Assumption to verify on first run: the installed SDK version (`0.128.0`) accepts these parameters for the chosen light and judge models. If a model rejects forced `tool_choice`, fall back to a JSON-only instruction plus `safeParse` and the same single repair call; the port hides the difference.

- [ ] **Step 3: Fake implementation** for emulators (`LLM_PROVIDER=fake`): returns canned data keyed by `schemaName` (`checklist` → a fixed checklist derived from the prompt's first words; `judge` → deterministic scores from a hash of the candidate sources), zero usage. This keeps the whole variants pipeline runnable without paid keys, as the rest of the system is.

- [ ] **Step 4: Prices.** `PRICES` in `model-provider.ts` already lists `claude-haiku-4-5`, `claude-sonnet-5`, `claude-opus-5` and `claude-opus-5-5`. Add the judge and checklist models when the deployed values are confirmed (open prerequisite). `estimateCostUsd` returns 0 for unknown models, so **unknown model ⇒ cost 0 ⇒ the budget undercounts**. Add a guard: `estimateCostUsd` callers in variants use `estimateCostCents(model, usage)` that **throws** for an unknown model when `VARIANTS_ENABLED`, caught at startup by `variantsConfigError` (extend it to check that the checklist and judge models have a price).

**Done when:** both clients satisfy `StructuredClient`; an invalid structured response costs at most one repair call; an unknown priced model keeps variants disabled with a logged reason.

---

### Task BV-3.4: Gated provider (global stream concurrency and rate-limit backoff)

**Files:**

- Create: `functions/src/modules/generation/llm/gated-provider.ts`

**Interfaces:**

- Consumes: `ModelProvider`, `LIMITS.variants.maxConcurrentLlmStreams`, `retry` from `shared/async.ts`.
- Produces: `class GatedProvider implements ModelProvider` (wraps another provider), `class Semaphore { acquire(signal?): Promise<() => void> }`.

- [ ] **Step 1: Semaphore** — a FIFO counter with `acquire(signal)` returning a release function; an aborted waiter is removed from the queue.

- [ ] **Step 2: Wrapper.** `stream()` returns a `ModelStream` whose first iteration acquires a slot and whose `final()` or iterator completion/error releases it exactly once. The wrapper retries **only the stream start** when the provider throws `LLM_RATE_LIMITED` or `LLM_UNAVAILABLE` **before any token was yielded** (3 attempts, base 1.5 s, jittered, the existing `retry` helper). Once any token has been yielded, errors propagate (the file parser has already consumed output, and a retry would duplicate it).

```ts
async *[Symbol.asyncIterator]() {
  const release = await sem.acquire(input.signal);
  let yielded = false;
  try {
    const inner = await retry(() => Promise.resolve(inner0()), { attempts: 3, baseMs: 1_500, shouldRetry: () => !yielded });
    for await (const ev of inner) { yielded = true; yield ev; }
  } finally { release(); }
}
```

(Implement so a retry creates a fresh underlying stream and replaces `final()` accordingly; the exact shape is left to the implementer as long as release happens once and tokens are never duplicated.)

- [ ] **Step 3:** Used only by variants candidates (BV-7.7 wires a `GatedProvider` around the same `AnthropicProvider` instance). The single-mode path keeps the bare provider so its behaviour is unchanged.

**Done when:** at most `maxConcurrentLlmStreams` model streams are open per instance; a 429 on stream start is retried with backoff; a stream that already produced tokens is never silently restarted.
