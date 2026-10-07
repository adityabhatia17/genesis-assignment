# BV-8 — Operations, rollout and the conditional worker entry

> **As built.** `generate` is 2 GiB, concurrency 10, max 5 instances. Kill switches are `VARIANTS_ENABLED`, a budget of zero and the per-instance gate. The deployed environment sets `VARIANTS_ENABLED=true`, `VARIANTS_CHECKLIST_MODEL=claude-haiku-4-5` and `VARIANTS_JUDGE_MODEL=claude-opus-5`. Only five log events exist: `variants.ready`, `variants.failed`, `variants.refund_failed`, `variants.settle_failed` and `variants.cancel_watch_failed`. The planned events for admission, checklist, candidate, scored, judge, ranked, selected, budget and refund are not logged. The Cloud Tasks worker (BV-8.4) is not built. The decision to build it is D37 in the feature document.

> Read [`00-overview.md`](00-overview.md) first. Design: [`../13-variants-feature.md`](../13-variants-feature.md) D21, D24, D25, §8, §9. Existing: `functions/src/index.ts`, `shared/logger.ts`, `../10-delivery-git-and-deployment.md`.

**Outcome:** the function is sized for a variants run, every run leaves a cost and outcome record without leaking content, the feature rolls out behind flags with a verified order, and the Cloud Tasks entry is specified for the case where D25 resolves to "worker".

**Reminder (workspace rule):** nothing in this phase deploys by itself. Rollout steps are a checklist for a later, explicit "deploy" request.

---

### Task BV-8.1: Function sizing and concurrency

**Files:**

- Modify: `functions/src/index.ts`

**Interfaces:**

- Produces: new options for the `generate` function.

- [ ] **Step 1: Resources.** A variants run holds 4 model streams, up to 2 sandbox child processes (each capped at 256 MB) and the parent. Raise memory and lower per-instance concurrency:

```ts
export const generate = onRequest(
  {
    timeoutSeconds: 540,
    memory: '2GiB',          // was 1GiB: parent + 2 sandboxes (≤ 256 MB each) + 4 streams
    concurrency: 10,         // was 20: single generations are light, variants runs are heavy (cap 2, D34)
    maxInstances: 5,
    minInstances: GENERATE_MIN_INSTANCES,
    invoker: 'public',
    secrets: [ANTHROPIC_API_KEY, HL_CLIENT_ID, HL_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  …
);
```

Capacity with these values: 10 requests × 5 instances = 50 concurrent generation requests overall, of which at most 2 per instance (10 total) are variants runs. The Anthropic stream gate is per instance (12). The single-mode path is unaffected except by the lower request concurrency; if that proves limiting, move variants to its own function (`generateVariants`) with its own sizing, behind the same route logic. That split is mechanical because the start route already chooses the orchestrator.

- [ ] **Step 2: The sandbox entry must be shipped.** The compiled `sandbox-entry.js` and its `jsdom` and `css-tree` dependencies are part of the deployed function bundle (they are normal dependencies). Confirm the entry path resolves in the deployed layout (`lib/…`), not only under `ts` in the emulator.

- [ ] **Step 3: Scale notes (no code).** At 10× today's users the in-request design fits the instance limits; at 100× it needs more instances and a higher Anthropic rate-limit tier arranged ahead of time (`13` §8.5).

**Done when:** `firebase deploy --only functions --dry-run`-style validation of the options passes, and the variants cap (2 per instance) is smaller than the instance's request concurrency.

---

### Task BV-8.2: Logging and cost records

**Files:**

- Modify: variants modules (calls to the existing `createLogger` child loggers)

**Interfaces:**

- Produces: structured log events and the run-document cost block.

- [ ] **Step 1: Events** (all logged with `requestId`, `projectId`, `generationId` already on the logger context; **no prompts, files, quotes or record values**):

| Event                | Fields                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `variants.admission` | `mode`, `reason?`, `reservedCents`                                                                    |
| `variants.checklist` | `origin` (model/template), `items`, `dropped`, `model`, `costCents`, `durationMs`                     |
| `variants.candidate` | `cid`, `direction`, `attempts`, `status`, `files`, `bytes`, `termination`, `costCents`, `durationMs`  |
| `variants.scored`    | `cid`, `total`, `eligible`, gates passed/failed list (names only), per-part points, `sandboxFailures` |
| `variants.judge`     | `status`, `passes`, `singlePass`, `unverifiedEvidence` (count), `disagreements` (count), `costCents`  |
| `variants.ranked`    | `top` ids and totals, `others` count, `notice`                                                        |
| `variants.selected`  | `cid`, `rank`, `topPickWasSelected`                                                                   |
| `variants.budget`    | `reservedCents`, `actualCents`, `daySpentCents` (after settle)                                        |
| `variants.refund`    | `reason`                                                                                              |

- [ ] **Step 2: Cost block** on the run document (`variants.cost`): `{ candidatesCents, checklistCents, judgeCents, totalCents }` plus `usage` (summed tokens). This is the data that replaces the estimated per-run cost in `13` §8.4 with measured values.

- [ ] **Step 3: Alerts (documentation only).** Create log-based metrics or alerts on `variants.budget` crossing 80% of the daily cap, `variants.scored` with `sandboxFailures > 0` rate, and a rising share of `fallback` admissions. Defined in the deploy doc, not in code.

**Done when:** a completed run can be explained from logs and the run document alone (what ran, what it cost, why it ranked as it did), without any generated content in logs.

---

### Task BV-8.3: Flags and rollout order

**Files:**

- Modify: `functions/.env.example`, `../10-delivery-git-and-deployment.md` (a short variants section)

- [ ] **Step 1: Flag defaults.** `VARIANTS_ENABLED=false`. With it off, behaviour is exactly today's.

- [ ] **Step 2: Order** (each step is a gate before the next):
  1. Emulator with `LLM_PROVIDER=fake`, `VARIANTS_ENABLED=true`: the whole path runs without paid keys (fake providers, fake structured client, real sandbox).
  2. **Sandbox isolation checks** (BV-5.1 step 3) on the target runtime; decide between the in-process child and a separate credential-less service.
  3. **Checklist quality evaluation** (BV-4.5 step 5) with the real light model on 20–30 prompts.
  4. Real Claude on staging with a tiny budget (`VARIANTS_DAILY_BUDGET_CENTS=200`): confirm real cost per run, the actual deployed generation model, the judge model difference, and the timeline against the 540 s function limit.
  5. Compare objective scores with the team's own preferences on 10–15 generated prompts; adjust weights in `SCORE_WEIGHTS` only through code review (they are contracts).
  6. Production with the agreed budget (`1000` cents), `VARIANTS_GLOBAL_PER_DAY=10`, per-user 2 per 10 minutes and 3 per day. Production deploy happens only on an explicit request.

- [ ] **Step 3: Kill switches.** `VARIANTS_ENABLED=false` turns off new runs immediately (admission falls back to single mode). Existing `awaiting_selection` runs remain selectable (the select route does not check the flag). Setting the budget to `0` also diverts every request to single mode with reason `budget`.

**Done when:** the rollout order is written into the delivery doc and each step has an owner-visible pass/fail criterion.

---

### Task BV-8.4: Cloud Tasks entry (conditional on D25 = worker)

> Build this only if D25 resolves to "Cloud Tasks worker", or if the in-request entry's disconnect behaviour (D36) proves unacceptable. The core (`VariantsOrchestrator.execute`, `RunEvents`) is already independent of HTTP, so this is an additional entry point, not a rewrite.

**Files:**

- Create: `functions/src/variants-worker.ts` (exports the worker function; imported in `index.ts`)
- Create: `functions/src/modules/generation/variants/firestore-run-events.ts`
- Modify: `functions/src/modules/generation/generate.app.ts`, `functions/src/index.ts`, `functions/src/composition.ts`

**Interfaces:**

- Produces: `export const variantsWorker = onTaskDispatched({...}, handler)`; `FirestoreRunEvents implements RunEvents`; a 202 path in the start route.

- [ ] **Step 1: Worker function.**

```ts
export const variantsWorker = onTaskDispatched(
  {
    region: 'us-central1',
    memory: '2GiB',
    cpu: 2,
    timeoutSeconds: 900,
    retryConfig: { maxAttempts: 1 }, // a failed run is finalised, not replayed
    rateLimits: { maxConcurrentDispatches: 4, maxDispatchesPerSecond: 1 },
    secrets: [ANTHROPIC_API_KEY, HL_CLIENT_ID, HL_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  async (req) => getVariantsWorker().handle(req.data), // { uid, projectId, generationId, prompt, reservedCents }
);
```

- [ ] **Step 2: Enqueue from the start route.** After admission returns `variants`, the route calls `generations.start({ mode: 'variants' })` (lease, user message), then enqueues a task named after the `generationId` (task names deduplicate) and returns **`202 { generationId }`** as JSON, not an SSE stream. A failed enqueue finalises the run `failed` and refunds, as in BV-7.4.

- [ ] **Step 3: `FirestoreRunEvents`.** Implements `RunEvents` by writing a small `progress` object on the run document (`{ phase, candidates: { c0: stage, … }, updatedAt }`), throttled to one write per second. `ready`, `failed` and `cancelled` are the run's own status/ranking fields, which the saved run already carries. The frontend then listens to the run document through Firestore (already allowed by the rules) instead of SSE.

- [ ] **Step 4: Differences from the in-request entry.**
  - The worker must **not** abort on client disconnect (there is no client); only cancel (`requestCancel` flag via `watchCancel`) and the hard deadline abort it.
  - `generations.start` and `touch` heartbeats are unchanged, so stale detection still works for a dead worker.
  - Retry policy `maxAttempts: 1` plus the existing idempotent start keeps a retried task from running twice.
  - `execute` is called with the worker's own `AbortSignal` built from the deadline and the cancel watch.

- [ ] **Step 5: Frontend impact (for the frontend plan).** The generation request returns `202`; progress comes from the run document; the result is read from `GET …/variants` or the run's `variants.ranking`. The SSE path remains for single-mode generation and for variants when the worker is disabled by config (`VARIANTS_ENTRY=inrequest|worker`).

**Done when:** with `VARIANTS_ENTRY=worker`, closing the browser after the request does not interrupt the run, and the same run reaches `awaiting_selection`; with `inrequest` nothing changes.

---

### Task BV-8.5: Contract sync and documentation updates

**Files:**

- Modify: `../07-end-to-end-system-design.md` (§3 contracts, state machines), `../13-variants-feature.md`, `../00-index.md`

- [ ] **Step 1:** Run `node ../scripts/sync-contracts.mjs` from `functions/` after BV-1 so the frontend copy of the contracts matches.

- [ ] **Step 2: Fold the new decisions into `13`.** Items from this plan that refine or correct the design doc:
  - **D27–D36** (this plan's overview) added to `13` §3.
  - `13` §5: `variants.ready` carries ids, ranks and scores, **not files** (D29); candidates are `c0`…`c3` (D30).
  - `13` §6.3: merged checklist count is 3–12 (D31); `dateRangeCall` is baseline-only (D32).
  - `13` §9: client disconnect aborts in the in-request entry (D36); selection requires an unchanged base snapshot (D35).
  - `13` §12: record the outcomes of the open prerequisites (deployed model, sandbox verification, checklist evaluation).

- [ ] **Step 3: `07` §3 and §5.** Add the new SSE events, run status `awaiting_selection`, candidate documents, the routes (`GET …/variants`, `POST …/variants/select`) and the new error codes to the canonical contract text, so `07` stays the source of truth.

**Done when:** the contract copy in the frontend matches the backend, and no document states a behaviour this plan changed.
