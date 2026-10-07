# BV-1 — Contracts and configuration

> **As built.** `functions/src/contracts/variants.ts` and the variants additions to `limits.ts`, `errors.ts`, `sse.ts`, `api.ts` and `firestore-docs.ts` exist, and the frontend has the synced copies. Parameters are in `config/params.ts` and `config/runtime-config.ts`. The budget is `VARIANTS_DAILY_BUDGET_CENTS`. SSE has `variants.phase` (phases `checklist`, `generating`, `scoring`, `judging`; `ranking` is defined and not sent), `candidate.progress` and `variants.ready`. There is no `variants.started`. The error codes are `CANDIDATE_NOT_SELECTABLE`, `CANDIDATE_NOT_FOUND` and `GENERATION_NOT_AWAITING_SELECTION`. Denied admission falls back with `fallbackReason`. `LIMITS.variants` holds time constants (`generationPhaseDeadlineMs`, `attemptDeadlineMs`, `scoringTimeoutMs`) and `tieMargin` that no code reads. The frontend copies still carry an older "GENERATED" header until `npm run contracts:sync` is run.

> Read [`00-overview.md`](00-overview.md) first. Design: [`../13-variants-feature.md`](../13-variants-feature.md) §3 (decisions), §5 (contract impact). Existing contracts: [`../08-backend-implementation-plan/02-contracts.md`](../08-backend-implementation-plan/02-contracts.md); prose in `07` §3.

**Outcome:** every new type, constant, event, error code and configuration value exists in `functions/src/contracts/` and `config/`, imports only `zod` (contracts), and syncs to the frontend. Nothing else in the backend changes behaviour yet.

---

### Task BV-1.1: Limits

**Files:**

- Modify: `functions/src/contracts/limits.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `LIMITS.variants` (below).

- [ ] **Step 1: Add the variants block to `LIMITS`**

Time budget (typical total 1.5–3 min; hard ceiling stays inside the 540 s function timeout with ≥ 100 s of margin): context + checklist ≤ 25 s, all candidates finish generating by 300 s, scoring is pipelined (≤ 45 s after each candidate finishes), judge ≤ 60 s, ranking and save ≤ 15 s.

```ts
  variants: {
    count: 4,
    /** Candidate 0 starts first and writes the prompt cache; the others wait this long (or for its first token). */
    staggerMs: 1_500,
    checklistTimeoutMs: 20_000,
    /** All candidates (including retries) must finish generating by this elapsed time. */
    generationPhaseDeadlineMs: 300_000,
    attemptDeadlineMs: 180_000,
    /** A retry may only start while the run has used less than this. */
    retryStartLatestMs: 150_000,
    scoringTimeoutMs: 45_000,
    judgeTimeoutMs: 60_000,
    /** Hard stop for the whole run (checklist + generation + scoring + judge + save); the function timeout is 540 s. */
    runHardDeadlineMs: 480_000,
    scoringConcurrency: 2,
    scenarioTimeoutMs: 8_000,
    sandboxMemoryMb: 256,
    judgeSourceBudgetBytes: 30_000,
    minShownScore: 25,
    tieMargin: 3,
    judgeDisagreementMax: 15,
    candidateTtlDays: 7,
    /** Reserved against the daily budget at admission, then settled with the real cost. */
    runReserveCents: 250,
    maxConcurrentRunsPerInstance: 2,
    maxConcurrentLlmStreams: 12,
    checklistItemsMax: 8,
    checklistNiceMax: 2,
    checklistMergedMin: 3,
    checklistMergedMax: 12,
  },
```

**Done when:** `LIMITS.variants` compiles with `as const` and the existing `LIMITS` keys are untouched.

---

### Task BV-1.2: Firestore document types

**Files:**

- Modify: `functions/src/contracts/firestore-docs.ts`

**Interfaces:**

- Consumes: `Usage`, `Issue`, `GenerationStatus`.
- Produces: `'awaiting_selection'` in `GENERATION_STATUSES` (not in `TERMINAL_GENERATION_STATUSES`), `GenerationMode`, `VariantsRunState`, `CandidateDoc<T>`, `CandidateStatus`.

- [ ] **Step 1: Extend statuses and the generation document**

```ts
export const GENERATION_STATUSES = [
  'streaming',
  'awaiting_selection',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
] as const;
// TERMINAL_GENERATION_STATUSES unchanged: awaiting_selection is not terminal.

export type GenerationMode = 'single' | 'variants';

export interface VariantsRunState<T> {
  count: number;
  /** The project's latest snapshot when the run started (null for a first generation). Selection requires it to be unchanged (D35). */
  baseSnapshotId: string | null;
  directionsVersion: string;
  checklistPromptVersion: string;
  judgePromptVersion: string;
  calendarCount: number;
  checklist: Checklist | null; // from contracts/variants.ts
  ranking: VariantsRanking | null; // from contracts/variants.ts
  notice: 'only_one_option' | 'unjudged' | null;
  resolution: 'selected' | 'discarded' | null;
  selection: {
    candidateId: string;
    rank: number;
    topPickWasSelected: boolean;
    scores: Record<string, number>; // candidateId → total, for every top entry
    selectedAt: T;
  } | null;
  cost: { candidatesCents: number; checklistCents: number; judgeCents: number; totalCents: number };
  reservedCents: number;
}

// GenerationDoc<T> gains:
//   mode: GenerationMode;                 // absent on old docs ⇒ 'single'
//   variants?: VariantsRunState<T> | null;
```

- [ ] **Step 2: Add the candidate document**

```ts
export const CANDIDATE_STATUSES = [
  'pending',
  'generating',
  'retrying',
  'generated',
  'scoring',
  'scored',
  'disqualified',
  'failed',
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export interface CandidateDoc<T> {
  index: number; // 0..3
  direction: { id: string; label: string };
  status: CandidateStatus;
  attempts: number;
  startedAt: T | null;
  completedAt: T | null;
  stopReason: string | null;
  error: GenerationError | null; // set for failed
  usage: Usage | null; // summed over attempts
  fileCount: number;
  totalBytes: number;
  warnings: Issue[];
  score: CandidateScore | null; // from contracts/variants.ts
  expireAt: T; // TTL (BV-7.2)
}
```

Staged candidate files reuse `StagedFileDoc<T>` plus an `expireAt: T` field.

**Done when:** old generation documents (no `mode`) still type-check as `single`; `awaiting_selection` is a valid `GenerationStatus` and is not terminal.

---

### Task BV-1.3: Checklist, probes, score and ranking schemas

**Files:**

- Create: `functions/src/contracts/variants.ts`

**Interfaces:**

- Consumes: `RUNTIME_METHOD_NAMES`, `IssueSchema`, `UsageSchema`.
- Produces: `RuntimeMethodSchema`, `LlmProbeSchema`, `BaselineProbeSchema`, `ChecklistItemSchema`, `ChecklistSchema`, `LlmChecklistSchema`, `SCORE_PARTS`, `SCORE_WEIGHTS`, `GROUP_OF`, `CandidateScoreSchema`, `VariantsRankingSchema`, and the inferred types.

- [ ] **Step 1: Implement**

```ts
import { z } from 'zod';
import { RUNTIME_METHOD_NAMES } from './hl-runtime.js';

export const RuntimeMethodSchema = z.enum(RUNTIME_METHOD_NAMES);
const Method = RuntimeMethodSchema;

/** Probes the checklist model may choose from (the vocabulary offered in its prompt). */
export const LlmProbeSchema = z.discriminatedUnion('probe', [
  z.strictObject({ probe: z.literal('calls'), method: Method }),
  z.strictObject({
    probe: z.literal('rendersFields'),
    method: Method,
    fields: z.array(z.string().min(1)).min(1).max(8),
  }),
  z.strictObject({
    probe: z.literal('sortedBy'),
    method: Method,
    field: z.string().min(1),
    direction: z.enum(['asc', 'desc']),
  }),
  z.strictObject({
    probe: z.literal('searchCallsWith'),
    method: Method,
    param: z.literal('query'),
  }),
  z.strictObject({
    probe: z.literal('hasControl'),
    control: z.enum(['search', 'filter', 'refresh', 'dateRange']),
  }),
]);

/** Probes only code adds (baseline items). Never offered to the model (D32). */
export const BaselineProbeSchema = z.discriminatedUnion('probe', [
  z.strictObject({ probe: z.literal('state.loading') }),
  z.strictObject({ probe: z.literal('state.empty') }),
  z.strictObject({ probe: z.literal('state.error') }),
  z.strictObject({ probe: z.literal('loadMoreAppends'), method: Method }),
  z.strictObject({ probe: z.literal('dateRangeCall'), method: z.literal('calendars.events') }),
]);

export const ProbeSchema = z.union([LlmProbeSchema, BaselineProbeSchema]);
export type Probe = z.infer<typeof ProbeSchema>;

const CheckSchema = z.union([
  z.object({ type: z.literal('probe'), probe: ProbeSchema }),
  z.object({ type: z.literal('judge') }),
]);

export const ChecklistItemSchema = z.strictObject({
  id: z.string().regex(/^[A-Z]\d{1,2}$/),
  text: z.string().min(1).max(140),
  kind: z.enum(['core', 'nice']),
  source: z.enum(['explicit', 'implied', 'baseline']),
  check: CheckSchema,
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

/** What the checklist model returns: no baseline items, no baseline probes. */
export const LlmChecklistSchema = z.strictObject({
  appType: z.enum(['list', 'detail', 'summary', 'mixed']),
  primaryMethods: z.array(Method).min(1).max(4),
  items: z
    .array(
      ChecklistItemSchema.extend({
        source: z.enum(['explicit', 'implied']),
        check: z.union([
          z.object({ type: z.literal('probe'), probe: LlmProbeSchema }),
          z.object({ type: z.literal('judge') }),
        ]),
      }),
    )
    .min(1)
    .max(8),
  unsupported: z.array(z.strictObject({ request: z.string(), reason: z.string() })).max(5),
});
export type LlmChecklist = z.infer<typeof LlmChecklistSchema>;

/** The merged checklist stored on the run. */
export const ChecklistSchema = z.strictObject({
  appType: LlmChecklistSchema.shape.appType,
  primaryMethods: LlmChecklistSchema.shape.primaryMethods,
  items: z.array(ChecklistItemSchema).min(3).max(12),
  unsupported: LlmChecklistSchema.shape.unsupported,
  origin: z.enum(['model', 'template']),
});
export type Checklist = z.infer<typeof ChecklistSchema>;

/** Score parts (D10). `robustness` feeds the total but has no owner-facing group. */
export const SCORE_PARTS = [
  'dataAccuracy',
  'stateHandling',
  'request',
  'visual',
  'clarity',
  'a11y',
  'robustness',
] as const;
export type ScorePart = (typeof SCORE_PARTS)[number];

export const SCORE_WEIGHTS = {
  dataAccuracy: 20,
  stateHandling: 15,
  request: 15,
  visual: 20,
  clarity: 10,
  a11y: 10,
  robustness: 10,
} as const satisfies Record<ScorePart, number>;

export const SCORE_GROUPS = ['works', 'looks', 'request', 'easy'] as const;
export type ScoreGroup = (typeof SCORE_GROUPS)[number];
export const GROUP_OF: Record<ScorePart, ScoreGroup | null> = {
  dataAccuracy: 'works',
  stateHandling: 'works',
  visual: 'looks',
  a11y: 'looks',
  request: 'request',
  clarity: 'easy',
  robustness: null,
};

export const GATES = ['validOutput', 'boots', 'usesRealData', 'safe'] as const;
export type GateName = (typeof GATES)[number];

const Pts = z.object({ points: z.number().min(0), max: z.number().min(0) });

export const CandidateScoreSchema = z.object({
  total: z.number().int().min(0).max(100),
  parts: z.record(
    z.enum(SCORE_PARTS),
    z.object({
      points: z.number().min(0),
      max: z.number().min(0),
      det: z.number().min(0),
      judge: z.number().min(0),
    }),
  ),
  groups: z.object({ works: Pts, looks: Pts, request: Pts, easy: Pts }),
  gates: z.array(
    z.object({ gate: z.enum(GATES), passed: z.boolean(), detail: z.string().max(300) }),
  ),
  checklist: z.array(
    z.object({
      id: z.string(),
      passed: z.boolean().nullable(),
      points: z.number().min(0),
      evidence: z.string().max(300),
    }),
  ),
  judge: z.object({
    status: z.enum(['judged', 'unjudged', 'not_run']),
    reason: z.string().max(200).nullable(),
  }),
  eligible: z.boolean(),
});
export type CandidateScore = z.infer<typeof CandidateScoreSchema>;

export const RankedEntrySchema = z.object({
  candidateId: z.string().regex(/^c[0-9]$/),
  rank: z.number().int().min(1),
  topPick: z.boolean(),
  total: z.number().int(),
  groups: CandidateScoreSchema.shape.groups,
  direction: z.object({ id: z.string(), label: z.string() }),
});
export const VariantsRankingSchema = z.object({
  top: z.array(RankedEntrySchema).max(2),
  /** Eligible candidates not shown (kept for analysis). */
  others: z.array(z.object({ candidateId: z.string(), total: z.number().int() })),
  reasons: z.array(z.string()).max(10),
});
export type VariantsRanking = z.infer<typeof VariantsRankingSchema>;
```

**Done when:** the schemas compile; `LlmChecklistSchema` rejects a baseline probe; `SCORE_WEIGHTS` sums to 100; `GROUP_OF` covers every part.

---

### Task BV-1.4: SSE events

**Files:**

- Modify: `functions/src/contracts/sse.ts`

**Interfaces:**

- Consumes: `VariantsRankingSchema`, `RankedEntrySchema`, `UsageSchema`.
- Produces: events `variants.phase`, `candidate.progress`, `variants.ready`; `generation.started.data` gains `mode` and `fallbackReason`; `variants.ready` becomes terminal.

- [ ] **Step 1: Extend `generation.started`**

```ts
envelope(
  'generation.started',
  z.object({
    projectId: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    startedAt: z.string(),
    mode: z.enum(['single', 'variants']).default('single'),
    /** Present when variants were expected but the run fell back (D27). */
    fallbackReason: z
      .enum(['disabled', 'budget', 'user_limit', 'global_limit', 'busy', 'not_first'])
      .optional(),
  }),
),
```

Protocol v1 stays at `v: 1`: all additions are new event types or optional fields; clients must ignore unknown event types (verify the frontend SSE client does so, see the frontend plan).

- [ ] **Step 2: Add the three events**

```ts
const CandidateIdSchema = z.string().regex(/^c[0-9]$/);

envelope(
  'variants.phase',
  z.object({ phase: z.enum(['checklist', 'generating', 'scoring', 'judging', 'ranking']) }),
),
envelope(
  'candidate.progress',
  z.object({
    candidateId: CandidateIdSchema,
    stage: z.enum(['queued', 'generating', 'retrying', 'validating', 'scoring', 'done', 'failed']),
    filesDone: z.number().int().min(0).optional(),
  }),
),
envelope(
  'variants.ready',
  z.object({
    top: z.array(RankedEntrySchema).max(2),
    notice: z.enum(['only_one_option', 'unjudged']).nullable(),
    usage: UsageSchema, // summed across the run
    durationMs: z.number().min(0),
  }),
),
```

- [ ] **Step 3: Terminal set**

```ts
export const TERMINAL_EVENT_TYPES = [
  'generation.completed',
  'generation.failed',
  'generation.cancelled',
  'variants.ready', // ends the stream; the run itself is then awaiting_selection
] as const;
```

Invariants for a variants stream: no `file.*`, `assistant.*` or `generation.phase` events; heartbeats continue; exactly one terminal event.

**Done when:** `GenerationEventSchema` parses all three new events; `SseWriter.send('variants.ready', …)` type-checks with no changes to `SseWriter`.

---

### Task BV-1.5: DTOs and error codes

**Files:**

- Modify: `functions/src/contracts/errors.ts`, `functions/src/contracts/api.ts`, `functions/src/contracts/index.ts`

**Interfaces:**

- Produces: error codes `CANDIDATE_NOT_FOUND`, `CANDIDATE_NOT_SELECTABLE`, `GENERATION_NOT_AWAITING_SELECTION`; `VariantsParams`, `SelectCandidateBody`, `SelectCandidateResult`, `VariantsResultDto`.

- [ ] **Step 1: Error codes** (append to `ERROR_CODES`, then the catalog)

```ts
CANDIDATE_NOT_FOUND: { status: 404, retryable: false, message: 'That option was not found.' },
CANDIDATE_NOT_SELECTABLE: {
  status: 409,
  retryable: false,
  message: 'That option can no longer be chosen.',
},
GENERATION_NOT_AWAITING_SELECTION: {
  status: 409,
  retryable: false,
  message: 'There is nothing to choose for this generation.',
},
```

- [ ] **Step 2: DTOs**

```ts
export const VariantsParams = GenerationParams;
export const SelectCandidateBody = z.strictObject({
  candidateId: z.string().regex(/^c[0-9]$/),
});
export const SelectCandidateResult = z.object({
  snapshotId: z.string(),
  snapshotSeq: z.number().int(),
  candidateId: z.string(),
  appliedPaths: z.array(z.string()),
});

export const VariantsResultDto = z.object({
  generationId: z.string(),
  status: z.enum([
    'streaming',
    'awaiting_selection',
    'completed',
    'failed',
    'interrupted',
    'cancelled',
  ]),
  resolution: z.enum(['selected', 'discarded']).nullable(),
  selectedCandidateId: z.string().nullable(),
  top: z.array(RankedEntrySchema),
  notice: z.enum(['only_one_option', 'unjudged']).nullable(),
  error: z
    .object({ code: ErrorCodeSchema, message: z.string(), retryable: z.boolean() })
    .nullable(),
});
```

- [ ] **Step 3: Export everything from `contracts/index.ts`**, then sync.

```bash
node ../scripts/sync-contracts.mjs      # from functions/ (BE-1.6 script)
```

**Done when:** `ErrorCode` includes the three codes with HTTP statuses; contracts are copied to `frontend/src/contracts/` without drift.

---

### Task BV-1.6: Configuration parameters

**Files:**

- Modify: `functions/src/config/params.ts`, `functions/src/config/runtime-config.ts`

**Interfaces:**

- Produces on `RuntimeConfig`: `variantsEnabled`, `variantsCount`, `variantsUserPer10Min`, `variantsUserPerDay`, `variantsGlobalPerDay`, `variantsDailyBudgetCents`, `variantsChecklistModel`, `variantsJudgeModel`.

- [ ] **Step 1: Parameters** (after the existing `GENERATION_*` params)

```ts
export const VARIANTS_ENABLED = defineString('VARIANTS_ENABLED', { default: 'false' });
export const VARIANTS_COUNT = defineInt('VARIANTS_COUNT', { default: 4 });
export const VARIANTS_USER_PER_10MIN = defineInt('VARIANTS_USER_PER_10MIN', { default: 2 });
export const VARIANTS_USER_PER_DAY = defineInt('VARIANTS_USER_PER_DAY', { default: 3 });
export const VARIANTS_GLOBAL_PER_DAY = defineInt('VARIANTS_GLOBAL_PER_DAY', { default: 10 });
/** $10.00 → 1000. Integer cents avoid float drift in the counter. */
export const VARIANTS_DAILY_BUDGET_CENTS = defineInt('VARIANTS_DAILY_BUDGET_CENTS', {
  default: 1000,
});
export const VARIANTS_CHECKLIST_MODEL = defineString('VARIANTS_CHECKLIST_MODEL', {
  default: 'claude-haiku-4-5',
});
/** No default on purpose: it must differ from ANTHROPIC_MODEL (D23) and be chosen deliberately. */
export const VARIANTS_JUDGE_MODEL = defineString('VARIANTS_JUDGE_MODEL', { default: '' });
```

- [ ] **Step 2: Runtime schema** (add to `RawSchema`, `RuntimeConfig`, `parseRuntimeConfig`, `loadRuntimeConfig`)

```ts
VARIANTS_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
VARIANTS_COUNT: z.coerce.number().int().min(2).max(4).default(4),
VARIANTS_USER_PER_10MIN: z.coerce.number().int().min(1).default(2),
VARIANTS_USER_PER_DAY: z.coerce.number().int().min(1).default(3),
VARIANTS_GLOBAL_PER_DAY: z.coerce.number().int().min(0).default(10),
VARIANTS_DAILY_BUDGET_CENTS: z.coerce.number().int().min(0).default(1000),
VARIANTS_CHECKLIST_MODEL: z.string().min(1).default('claude-haiku-4-5'),
VARIANTS_JUDGE_MODEL: z.string().default(''),
```

- [ ] **Step 3: Startup check** (next to `modelConfigError`): `variantsConfigError(config): string | null` returns a reason when `variantsEnabled` and (judge model is empty, or equals `anthropicModel`, or `llmProvider !== 'fake'` and no `ANTHROPIC_API_KEY`). The generate app logs it and treats variants as disabled (D27 fallback reason `disabled`).

- [ ] **Step 4:** Add the new keys to `functions/.env.example` and the emulator `.env.local` notes (`LLM_PROVIDER=fake`, `VARIANTS_ENABLED=true`, `VARIANTS_JUDGE_MODEL=fake-judge`).

**Done when:** with no new env values, `loadRuntimeConfig()` yields variants disabled; enabling it with an empty or equal judge model reports a config error and the feature stays off.
