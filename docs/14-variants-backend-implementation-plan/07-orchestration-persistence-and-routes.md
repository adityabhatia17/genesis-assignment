# BV-7 — Orchestration, persistence and routes

> **As built.** `variants/variants.orchestrator.ts` is one class that runs the checklist, fans out the candidates, scores each candidate as soon as its generation finishes (under a semaphore of `scoringConcurrency`), judges, ranks and saves. `variants.repo.ts` holds `initCandidate`, `patchCandidate`, `markAwaiting`, `failRun`, `readSelection`, `discard` and the staged reads. Routes are in `variants.routes.ts`: `GET …/variants`, `POST …/variants/select` and `POST …/variants/discard`. There is no `execute`, `RunEvents`, `SseRunEvents`, `VariantsResultService` or `VariantsSelectService`. Candidate documents are created one by one when each candidate starts. **Outcomes as built:** two or more scored → `awaiting_selection` and `variants.ready`; one scored → `awaiting_selection` with notice `only_one_option` and a refund; none scored → `failed`, `INTERNAL`, "The options could not be finished.", a refund; closed tab or timeout → `failed` and no ranking is saved; cancel → a throw with no terminal event. There is no on-demand ranking for an interrupted run, and select requires `awaiting_selection`. Select reads the ranking only, then lists the staged files and commits through `applyTreeChange` with the `baseSnapshotId` guard (D35). It does not read the candidate document and does not delete the other candidates' staged files. The client discard goes to the older partial route, and the variants discard route is not used. `markAwaiting` has no status check. Cost is written as candidates plus checklist, with `judgeCents` 0.

> Read [`00-overview.md`](00-overview.md) first. Design: [`../13-variants-feature.md`](../13-variants-feature.md) §4 (flow), §5 (data model), §9 (reliability); this plan D27, D29, D30, D33, D35, D36. Existing code: `orchestrator.ts`, `persistence/generations.repo.ts`, `persistence/commit.service.ts` (`applyTreeChange`), `routes/generation-control.routes.ts`, `generate.app.ts`, `composition.ts`.

**Outcome:** `POST …/generations` on a first-generation project runs the whole variants pipeline and ends the stream with `variants.ready`; the run waits in `awaiting_selection`; `GET …/variants` returns the stored result; `POST …/variants/select` commits exactly one snapshot through the unchanged `CommitService`; discard and expiry work; every failure path ends in a defined state with budget, limits and the instance gate released.

---

### Task BV-7.1: Paths and repositories

**Files:**

- Modify: `functions/src/shared/firestore-paths.ts`
- Modify: `functions/src/modules/generation/persistence/generations.repo.ts` (`StartInput.mode`)
- Create: `functions/src/modules/generation/variants/persistence/variants.repo.ts`

**Interfaces:**

- Produces paths:

```ts
candidates: (uid, pid, gid) => `${project(uid, pid)}/generations/${gid}/candidates`,
candidate: (uid, pid, gid, cid) => `${project(uid, pid)}/generations/${gid}/candidates/${cid}`,
candidateStaged: (uid, pid, gid, cid) => `${project(uid, pid)}/generations/${gid}/candidates/${cid}/staged`,
budgetDay: (key: string) => `rateLimits/variantsBudget_${key}`,
```

- Produces `GenerationsRepo.start` change: `StartInput` gains `mode?: GenerationMode` (default `'single'`); the created document stores `mode` and `variants: null`. Nothing else in `start` changes (lease, stale takeover, idempotency and the user message stay).
- Produces `VariantsRepo`:

```ts
class VariantsRepo {
  /** Sets run.variants (checklist, versions, baseSnapshotId, reserved) and creates candidate docs c0..c{n-1}. */
  initRun(i: {
    uid;
    pid;
    gid;
    count: number;
    baseSnapshotId: string | null;
    calendarCount: number;
    checklist: Checklist;
    directions: DesignDirection[];
    reservedCents: number;
    nowMs: number;
  }): Promise<void>;
  updateCandidate(uid, pid, gid, cid: string, patch: Partial<CandidatePatch>): Promise<void>;
  stageFile(uid, pid, gid, cid, op: FileOp, warnings: Issue[], nowMs: number): Promise<void>; // sets expireAt
  clearStaged(uid, pid, gid, cid): Promise<void>; // before a retry
  listStagedOps(uid, pid, gid, cid): Promise<FileOp[]>; // same mapping as GenerationsRepo.listStaged
  listCandidates(uid, pid, gid): Promise<CandidateRecord[]>;
  getRun(uid, pid, gid): Promise<VariantsRunRecord | null>;
  saveRanking(i: SaveRankingInput): Promise<boolean>; // → 'awaiting_selection'; false if the run is no longer 'streaming'
  discard(uid, pid, gid, nowMs): Promise<void>;
}
```

- [ ] **Step 1: `initRun`** — one batch: `tx.update` the run document (`variants: {…}` per `VariantsRunState`, `variants.baseSnapshotId` from the project at start) and `tx.create` four candidate documents with `status: 'pending'`, `attempts: 0`, `score: null`, `expireAt = now + candidateTtlDays`.

- [ ] **Step 2: `stageFile`** writes `{ path, op, content, sizeBytes, contentHash, language, issues, createdAt, expireAt }` at `candidateStaged/{fileIdForPath(path)}` (same shape as the existing staged document plus `expireAt`).

- [ ] **Step 3: `saveRanking`** — one transaction: require the run `status === 'streaming'`; write `variants.ranking`, `variants.notice`, `variants.cost`, set `status: 'awaiting_selection'`, `completedAt: null`, `usage` (summed), `timings.totalMs`; if `project.activeGeneration.id === gid`, set `activeGeneration: null` (D16). Writes **no** assistant message (the owner has not chosen yet).

- [ ] **Step 4: Stale lease behaviour.** No change to `commit.service.ts` or `start()`: a variants run whose instance died has `status: 'streaming'` and a stale lease; the next `start`/commit marks it `interrupted` with `interruptedPatch([], now)` (empty staged list ⇒ `partial: null`). Its scored candidates remain readable and selectable (BV-7.5 `getResult`).

**Done when:** a first-generation run can be initialised and its candidates listed; `saveRanking` is idempotent-safe (second call returns `false`) and always releases the lease it holds.

---

### Task BV-7.2: TTL policy and rules check

**Files:**

- Modify: `firestore.indexes.json`

- [ ] **Step 1: TTL overrides** (documents, not subcollections, are deleted by TTL, so staged documents carry their own `expireAt`):

```json
"fieldOverrides": [
  { "collectionGroup": "candidates", "fieldPath": "expireAt", "ttl": true, "indexes": [] },
  { "collectionGroup": "staged", "fieldPath": "expireAt", "ttl": true, "indexes": [] }
]
```

Existing `staged` documents (single generations) have no `expireAt`, so they are unaffected.

- [ ] **Step 2: Rules.** No change needed: `match /{document=**}` under `projects/{projectId}` already gives the owner read access to `generations/{gid}/candidates/{cid}` and `…/staged`, and denies all client writes (D29: the frontend reads candidate files from Firestore). Confirm in the rules file; `rateLimits` stays unmatched (deny).

- [ ] **Step 3: Expiry is also checked in code.** TTL deletion can lag by a day, so `select` rejects a candidate whose `expireAt` is in the past (BV-7.5).

**Done when:** the indexes file validates (`firebase deploy --only firestore:indexes --dry-run` shape) and no client write path to candidates exists.

---

### Task BV-7.3: `VariantsOrchestrator`

**Files:**

- Create: `functions/src/modules/generation/variants/variants.orchestrator.ts`
- Create: `functions/src/modules/generation/variants/run-events.ts`
- Create: `functions/src/modules/generation/variants/candidate-pipeline.ts`

**Interfaces:**

- Consumes: `GenerationsRepo`, `VariantsRepo`, `ContextBuilder`, `LocationContextPort`, `ChecklistService`, `CandidateRunner` (with the gated provider), `scoreObjective`, `JudgeService`, `aggregate`, `rankCandidates`, `VariantsAdmission`, `DailyBudgetRepo`, `InstanceGate`, `Clock`, `RuntimeConfig`, `directionsFor`, `directionSystemBlock`, `decideOutcome`, `estimateCostUsd`.
- Produces:
  - `interface RunEvents` — the output channel, so the pipeline does not depend on HTTP:

```ts
interface RunEvents {
  started(d: { mode: 'variants'; count: number }): void;
  phase(p: 'checklist' | 'generating' | 'scoring' | 'judging' | 'ranking'): void;
  candidate(id: string, stage: CandidateStage, filesDone?: number): void;
  ready(d: {
    top: RankedEntry[];
    notice: 'only_one_option' | 'unjudged' | null;
    usage: Usage;
    durationMs: number;
  }): void;
  failed(e: GenerationError): void;
  cancelled(): void;
  heartbeat(): void;
}
```

- `class SseRunEvents implements RunEvents` (wraps `SseWriter`; progress throttled to ≤ 1 event per candidate per second except stage changes)
- `class VariantsOrchestrator { run(req, res, input: RunInput, admission: Extract<Admission, { mode: 'variants' }>): Promise<void>; execute(ctx: ExecuteContext, events: RunEvents): Promise<void> }` — `run` is the HTTP shell (as `GenerationOrchestrator.run`); `execute` is the pipeline and takes only ids, abort signal and events. A later Cloud Tasks entry (BV-8.4) calls `execute` directly.

- [ ] **Step 1: HTTP shell (`run`).** Mirrors `GenerationOrchestrator.run`: `generations.start({ …, mode: 'variants' })` **inside a try** so a thrown `AppError` (`GENERATION_IN_PROGRESS`, `DUPLICATE_REQUEST`, `PROJECT_NOT_FOUND`) releases the admission (`admission.refund(uid)`, `budget.release(reserved)`, `gate.leave()`) and rethrows before the stream opens. Then open `SseWriter`, send `generation.started` (`mode: 'variants'`), start the heartbeat (`generations.touch` every `heartbeatMs`), cancel watch (`generations.watchCancel`), and the abort controller. **Disconnect (D36):** `res.on('close')` aborts with `GenerationAbort('disconnected')` unless a terminal event was sent.

- [ ] **Step 2: Pipeline (`execute`)** — high-level sequence; every phase is time-boxed by the run's hard deadline (`runHardDeadlineMs`):

```ts
async execute(c: ExecuteContext, events: RunEvents) {
  const t0 = this.clock.now();
  const cost = new CostTracker();                                   // cents, per category
  try {
    events.phase('checklist');
    const hl = await this.locationContext.getContext(c.uid);
    const cl = await this.checklists.generate({ prompt: c.prompt, ctx: hl, signal: c.signal });
    cost.add('checklist', cl.usage, cl.model);

    const directions = directionsFor(cl.checklist.appType, this.cfg.variantsCount);
    await this.variants.initRun({ …, count: directions.length, checklist: cl.checklist, directions, reservedCents: c.reservedCents });
    events.started({ mode: 'variants', count: directions.length });

    const built = await this.context.build({ uid, projectId, projectName, projectDescription, generationId, prompt }); // once
    events.phase('generating');
    const results = await this.fanOut({ c, built, directions, checklist: cl.checklist, calendarCount, cost, events });

    if (c.signal.aborted) return await this.finishAborted(c, events, cost, t0);        // cancelled / disconnected / timeout (BV-7.4)
    events.phase('judging');
    const judged = await this.judgeEligible(results, c, cost);                          // skipped when fewer than 2 eligible
    events.phase('ranking');
    await this.finishRanked(c, events, cost, t0, results, judged);                      // aggregate → rank → saveRanking → ready
  } finally {
    await this.releaseRun(c, cost);                                                     // settle budget, gate.leave(), (refund per policy, BV-7.4)
  }
}
```

- [ ] **Step 3: Fan-out with stagger.** Candidate `0` starts immediately. Candidates `1..n-1` wait for the first of: candidate 0's first token, or `staggerMs` (1.5 s), plus `index × 150 ms`, so the prompt cache is written once and read by the rest. They then run concurrently. Use `Promise.allSettled`; a rejected candidate promise is a bug-level failure and is recorded as `failed` with code `INTERNAL`, never thrown out of `fanOut`.

- [ ] **Step 4: One candidate (`candidate-pipeline.ts`).**

```ts
async function runCandidate(i: CandidateJob): Promise<CandidateOutcome> {
  let issuesForRetry: Issue[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await repo.updateCandidate(…, { status: attempt === 1 ? 'generating' : 'retrying', attempts: attempt });
    events.candidate(i.cid, attempt === 1 ? 'generating' : 'retrying');

    const signal = AbortSignal.any([i.runSignal, i.phaseSignal, AbortSignal.timeout(LIMITS.variants.attemptDeadlineMs)]);
    const system = [...i.built.system, directionSystemBlock(i.direction)];
    const messages = attempt === 1 ? i.built.messages : withRetryIssues(i.built.messages, issuesForRetry);
    const run = await runner.run({ system, messages, currentFiles: i.built.currentFiles, currentTree: i.currentTree, signal }, sinkFor(i));
    cost.addGeneration(run.final, i.cid);                         // every attempt counts

    const decision = decideOutcome({ termination: run.termination, providerErrorCode: run.providerErrorCode,
      stopReason: run.final?.stopReason ?? null, ops: run.ops, rejected: run.rejected, aborted: run.aborted, currentTree: i.currentTree });

    if (decision.kind === 'commit') return await scoreAndStore(i, run, decision);               // below
    const retryable = attempt === 1 && isRetryableFailure(decision) && !i.runSignal.aborted
      && i.elapsedMs() < LIMITS.variants.retryStartLatestMs;
    if (!retryable) return await markFailed(i, decision);
    issuesForRetry = decision.issues ?? [];                                                   // D9
    await repo.clearStaged(…);
  }
  return markFailed(...);                                                                     // unreachable guard
}
```

`withRetryIssues` appends a `<previous_attempt_issues>` block (issue codes and messages, at most 10, no code content) to the final user message with a one-line instruction to fix them; it does not resend the previous output. `isRetryableFailure` is true for `GENERATION_INVALID_OUTPUT`, `GENERATION_TRUNCATED`, and provider errors `LLM_RATE_LIMITED`/`LLM_UNAVAILABLE` (when no output was produced); false for `GENERATION_REFUSED`, `CONTEXT_TOO_LARGE`, cancellation, disconnect and timeout.

- [ ] **Step 5: Sink for a candidate.** Implements `CandidateSink` with: `stage` → `variants.stageFile(...)`; `onFileCompleted`/`onFileDeleted` → increment `filesDone` and emit throttled `candidate.progress`; thinking, prose and per-file deltas are **ignored** (D2: no content streaming); `afterChunk` is a no-op.

- [ ] **Step 6: Score and store (`scoreAndStore`).** After a `commit` decision:
  1. Build the candidate's resulting tree: `applyOps(i.currentTree, run.ops)`, flatten to `path → content`.
  2. `events.candidate(cid, 'validating')`, set status `generated` with `fileCount`, `totalBytes`, `warnings`, `usage`.
  3. Acquire one of `scoringConcurrency` (2) scoring slots (a semaphore), `events.candidate(cid, 'scoring')`, call `scoreObjective(...)`; release.
  4. Write a **provisional score** to the candidate immediately: `aggregate({ objective, judged: objectiveTrackingJudged(objective), judgeStatus: 'not_run', judgeReason: null })`, status `scored` (or `disqualified` when not eligible). This makes every scored candidate selectable even if the run dies before the judge (BV-7.5).
  5. `events.candidate(cid, 'done')` and return `{ cid, objective, provisional, judgeInput }`.

  Scoring failure (an exception, not a low score) marks the candidate `failed` with `INTERNAL` and does not affect the others.

- [ ] **Step 7: Judge eligible candidates (`judgeEligible`).** Only candidates with `eligible === true` go to the judge. With **fewer than two**, skip the judge (saves cost; their provisional scores stand, `judge.status: 'not_run'`). Otherwise call `JudgeService.judge(...)` with `runId = generationId`, aggregate each candidate with its `JudgedPoints`, overwrite the stored score, and record cost.

- [ ] **Step 8: Finish ranked (`finishRanked`).**

```ts
const inputs = scored.map((s) => ({ candidateId: s.cid, direction: s.direction, score: s.final }));
const { ranking, notice: oneOnly } = rankCandidates(inputs);
if (ranking.top.length === 0) return await this.failNoCandidate(c, events, cost);          // BV-7.4
const notice = oneOnly ?? (judge.noticeUnjudged ? 'unjudged' : null);
const ok = await this.variants.saveRanking({ …, ranking, notice, cost: cost.cents(), nowMs });
if (!ok) return;                                                                            // run was already finalised elsewhere
if (ranking.top.length < 2) await this.admission.refund(c.uid);                              // D21: fewer than 2 qualified
events.ready({ top: ranking.top, notice, usage: cost.totalUsage(), durationMs: this.clock.now() - t0 });
```

- [ ] **Step 9: Cost tracking (`CostTracker`).** Accumulates per category (`candidates`, `checklist`, `judge`) the `TokenUsage` and cents via `estimateCostUsd(model, usage) × 100` rounded **up** to a whole cent per call, so the budget never undercounts. `releaseRun` calls `budget.settle(reservedCents, actualCents)` and always runs in `finally`.

**Done when:** with the fake providers and fake structured client a first prompt yields a run with candidates `scored`, a stored ranking, status `awaiting_selection`, a `variants.ready` event, a lease released, and a settled budget; the pipeline body (`execute`) imports nothing from `express`.

---

### Task BV-7.4: Cancel, failures and refunds

**Files:**

- Modify: `functions/src/modules/generation/variants/variants.orchestrator.ts` (`finishAborted`, `failNoCandidate`, `releaseRun`)

**Interfaces:**

- Consumes: `GenerationsRepo.finalizeWithoutCommit`, `decideOutcome`-style error mapping, `VariantsAdmission.refund`.

- [ ] **Step 1: Outcome table.** Each ending maps to exactly one run state, one terminal event, one budget settlement and a refund decision:

| Ending                                                                                                               | Run status                                            | Terminal event                                               | Refund variants units | Notes                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| ≥ 2 eligible, ranked                                                                                                 | `awaiting_selection`                                  | `variants.ready`                                             | no                    | Normal path.                                                                                                         |
| Exactly 1 eligible                                                                                                   | `awaiting_selection`                                  | `variants.ready` (`only_one_option`)                         | **yes**               | D21. The owner can retry for free.                                                                                   |
| 0 eligible                                                                                                           | `failed`                                              | `generation.failed` (`GENERATION_INVALID_OUTPUT`, retryable) | **yes**               | `finalizeWithoutCommit`, assistant note "(Generation failed…)".                                                      |
| Failure before any candidate finished (checklist hard failure cannot occur: template fallback; start/context errors) | `failed`                                              | `generation.failed`                                          | **yes**               | Provider outage: `LLM_UNAVAILABLE` or `LLM_RATE_LIMITED` code from the first failure.                                |
| User cancel                                                                                                          | `cancelled`                                           | `generation.cancelled`                                       | no                    | `finalizeWithoutCommit(status: 'cancelled', partial: null)`. Candidates stay `failed`/`scored` and expire by TTL.    |
| Client disconnect (D36)                                                                                              | `interrupted`                                         | none (stream is gone)                                        | no                    | `finalizeWithoutCommit(status: 'interrupted', error: GENERATION_INTERRUPTED)`. Provisional scores remain for `GET`.  |
| Hard deadline (`runHardDeadlineMs`)                                                                                  | `failed`                                              | `generation.failed` (`GENERATION_TIMEOUT`, retryable)        | **yes**               | If ≥ 1 eligible candidate already has a provisional score, rank those instead and send `variants.ready` (preferred). |
| Instance death                                                                                                       | `interrupted` (by next `start`/commit stale takeover) | none                                                         | no                    | Provisional scores remain; `GET` ranks them on demand (BV-7.5).                                                      |

- [ ] **Step 2: Provider-wide failure.** If **every** candidate failed with a provider error (`LLM_RATE_LIMITED` or `LLM_UNAVAILABLE`), the run ends `failed` with that code (the user message is "The AI service is busy"), instead of the generic invalid-output code.

- [ ] **Step 3: Refund implementation.** `releaseRun` accepts a `refund: boolean` decided by the table above and calls `admission.refund(uid)` once; it is idempotent per run (guard flag). Budget settlement is **always** by actual cost, regardless of refund.

- [ ] **Step 4: Preferring partial success at the hard deadline.** When `runHardDeadlineMs` fires, the orchestrator stops waiting for unfinished candidates (aborting them), skips the judge if its own timeout would be exceeded, and ranks whatever has a provisional score.

**Done when:** every row of the table is reachable, leaves no reserved budget and no held gate slot, and never double-refunds.

---

### Task BV-7.5: Select, get and discard services

**Files:**

- Create: `functions/src/modules/generation/variants/variants-select.service.ts`
- Create: `functions/src/modules/generation/variants/variants-result.service.ts`

**Interfaces:**

- Consumes: `VariantsRepo`, `CommitService`, `ProjectAccessPort`, `rankCandidates`, `aggregate`-stored scores, `Clock`.
- Produces:
  - `VariantsResultService.get(uid, pid, gid): Promise<VariantsResultDto>`
  - `VariantsSelectService.select(i: { uid; pid; gid; candidateId }): Promise<SelectCandidateResult>`
  - `VariantsSelectService.discard(uid, pid, gid): Promise<void>`

- [ ] **Step 1: `get`.** Load the run (`mode === 'variants'` else `GENERATION_NOT_FOUND`). If `variants.ranking` exists, return it. If the run is `interrupted` (or `streaming` with a stale heartbeat) and no ranking exists, **compute it on demand**: list candidates with a stored `score`, run `rankCandidates` (pure) over them, set `notice: 'unjudged'` when any score has `judge.status !== 'judged'`, and return it **without persisting**. Statuses `streaming`/`awaiting_selection`/`completed`/`cancelled`/`failed` map straight through; `resolution` and `selectedCandidateId` come from the run.

- [ ] **Step 2: `select` — checks, in order.**
  1. Run exists, `mode === 'variants'`; status is `awaiting_selection`, or `interrupted` with at least one scored candidate; else `GENERATION_NOT_AWAITING_SELECTION`. If the run is already `completed` with the same `selectedCandidateId`, return the stored result (**idempotent**); with a different candidate, `CANDIDATE_NOT_SELECTABLE`.
  2. The candidate id is in the effective ranking's `top` (D30), exists (`CANDIDATE_NOT_FOUND`), has `status: 'scored'`, `score.eligible`, and `expireAt` in the future; else `CANDIDATE_NOT_SELECTABLE`.
  3. `project.latestSnapshotId === run.variants.baseSnapshotId` (D35) via the commit `precondition`; else `CANDIDATE_NOT_SELECTABLE` with `details: { reason: 'project_changed' }`.

- [ ] **Step 3: Commit.** Read staged ops (`listStagedOps`) and call the existing service unchanged:

```ts
const result = await this.commits.applyTreeChange({
  uid,
  projectId: pid,
  nowMs: now,
  ops,
  source: 'ai',
  validateNextTree: true,
  snapshot: {
    kind: 'generation',
    label: run.prompt,
    generationId: gid,
    restoredFromSnapshotId: null,
  },
  lease: { mode: 'must-be-free' },
  precondition: (p) => {
    if (p.latestSnapshotId !== run.variants.baseSnapshotId)
      throw new AppError('CANDIDATE_NOT_SELECTABLE', undefined, { reason: 'project_changed' });
  },
  messages: [
    {
      role: 'assistant',
      content: `Built with the "${direction.label}" design.`,
      generationId: gid,
      meta: { status: 'completed' },
    },
  ],
  generationPatch: {
    generationId: gid,
    build: (r) => ({
      status: 'completed',
      completedAt: new Date(now),
      stopReason: null,
      error: null,
      partial: null,
      result: {
        snapshotId: r.snapshotId,
        snapshotSeq: r.snapshotSeq,
        changedPaths: r.changedPaths,
        deletedPaths: r.deletedPaths,
        rejected: [],
        warnings: cand.warnings,
        noChanges: r.noChanges,
      },
      'variants.resolution': 'selected',
      'variants.selection': {
        candidateId,
        rank,
        topPickWasSelected: rank === 1,
        scores: Object.fromEntries(top.map((t) => [t.candidateId, t.total])),
        selectedAt: new Date(now),
      },
    }),
  },
});
```

`must-be-free` means selection fails with `GENERATION_IN_PROGRESS` while another generation holds a fresh lease. The selection record (rank, whether the top pick was chosen, both scores) is the human-preference data of D20; it is a field on the run document, with no personal data.

- [ ] **Step 4: Cleanup after commit.** Mark the selected candidate `status` unchanged and delete the **staged documents of the other candidates** after the commit succeeds (best effort, outside the transaction); the candidates' own documents and scores stay until TTL for analysis. A failed cleanup is logged and left to TTL.

- [ ] **Step 5: `discard`.** Allowed when `awaiting_selection` (or `interrupted` with candidates). Sets run `status: 'cancelled'`, `variants.resolution: 'discarded'`, writes a system message "Discarded the generated options." (D33), and deletes all candidates' staged documents (best effort). Idempotent: a second call returns success if already discarded.

**Done when:** a second `select` with the same candidate returns the same snapshot id; selecting a candidate that is not in `top`, expired, or from a changed project fails with the right code; one snapshot is created per selected run.

---

### Task BV-7.6: Routes and wiring of the start route

**Files:**

- Modify: `functions/src/modules/generation/generate.app.ts`
- Modify: `functions/src/modules/generation/routes/generation-control.routes.ts`
- Create: `functions/src/modules/generation/variants/variants.routes.ts`
- Modify: `functions/src/modules/generation/orchestrator.ts` (`RunInput.fallbackReason`, `generation.started` `mode`)

**Interfaces:**

- Produces: start route that decides variants vs single; `GET /v1/projects/:projectId/generations/:generationId/variants`; `POST …/variants/select`; extended `…/discard`.

- [ ] **Step 1: Start route (generate app).** The three existing rate-limit middleware stay (D28). The handler becomes:

```ts
defineHandler(
  { params: ProjectParams, body: StartGenerationBody },
  async ({ params, body }, req, res) => {
    const uid = requireUid(req);
    const project = await d.projects.getOwnedActive(uid, params.projectId);
    const admission = await d.admission.check({
      uid,
      project,
      variantsAvailable: d.variantsAvailable,
    });
    const input = {
      uid,
      projectId: params.projectId,
      generationId: body.clientRequestId,
      prompt: body.prompt,
    };
    if (admission.mode === 'variants')
      return void (await d.variants.run(req, res, input, admission));
    await d.orchestrator.run(req, res, {
      ...input,
      ...(admission.reason !== 'not_first' ? { fallbackReason: admission.reason } : {}),
    });
  },
);
```

`GenerationOrchestrator` sends `mode: 'single'` and the optional `fallbackReason` in `generation.started`. Admission failures never throw; unexpected errors bubble as 500 as today. `variantsAvailable = config.variantsEnabled && !variantsConfigError(...)`.

- [ ] **Step 2: Variants routes (api app).**

```ts
r.get(
  `${base}/variants`,
  defineHandler({ params: VariantsParams }, async ({ params }, req, res) =>
    sendData(res, await d.results.get(requireUid(req), params.projectId, params.generationId)),
  ),
);

r.post(
  `${base}/variants/select`,
  defineHandler(
    { params: VariantsParams, body: SelectCandidateBody },
    async ({ params, body }, req, res) =>
      sendData(
        res,
        await d.select.select({
          uid: requireUid(req),
          pid: params.projectId,
          gid: params.generationId,
          candidateId: body.candidateId,
        }),
      ),
  ),
);
```

with `base = '/v1/projects/:projectId/generations/:generationId'`. Both are in the `api` function (60 s timeout; selection is one transaction).

- [ ] **Step 3: Discard.** In `generation-control.routes.ts` the `/discard` handler loads the generation; for `mode === 'variants'` it calls `select.discard(...)`, otherwise the existing `markDiscarded`. `/apply` for a variants run returns the existing `GENERATION_NOT_APPLYABLE` (its `partial` is null). `/cancel` works unchanged for a `streaming` variants run (the orchestrator's cancel watch aborts all candidates).

**Done when:** a request on a non-first project is a normal generation (no behavioural change); a first-generation request returns the variants stream; the three new endpoints respond as specified and reject other users' runs with `GENERATION_NOT_FOUND` (paths are uid-scoped).

---

### Task BV-7.7: Composition

**Files:**

- Modify: `functions/src/composition.ts`

- [ ] **Step 1: In `buildGenerateApp`** (after the provider is built):

```ts
const structured: StructuredClient =
  config.llmProvider === 'fake'
    ? new FakeStructuredClient()
    : new AnthropicStructuredClient(anthropicClient); // the same Anthropic client instance
const gated = new GatedProvider(provider, new Semaphore(LIMITS.variants.maxConcurrentLlmStreams));
const runner = new CandidateRunner(provider, clock, logger); // single mode, bare provider
const variantsRunner = new CandidateRunner(gated, clock, logger); // variants, gated
const budget = new DailyBudgetRepo(db, clock);
const gate = new InstanceGate(LIMITS.variants.maxConcurrentRunsPerInstance);
const admission = new VariantsAdmission({ limiter, budget, gate, cfg: config });
const variants = new VariantsOrchestrator({
  generations,
  repo: new VariantsRepo(db),
  context,
  locationContext,
  checklists: new ChecklistService({
    client: structured,
    model: config.variantsChecklistModel,
    logger,
  }),
  runner: variantsRunner,
  judge: new JudgeService({ client: structured, model: config.variantsJudgeModel, logger }),
  admission,
  budget,
  gate,
  clock,
  cfg: config,
  logger,
});
```

`GenerationOrchestrator` receives `runner`. `generationRouter` receives `admission`, `variants`, `projects: new FirestoreProjectAccess(db)` and `variantsAvailable`.

- [ ] **Step 2: In `buildApiApp`** mount `variantsRouter({ results, select, clock })` with `VariantsResultService` and `VariantsSelectService` (they need `VariantsRepo`, `GenerationsRepo`, `CommitService`, `FirestoreProjectAccess`) and pass `variants`-aware `generationControlRouter`.

- [ ] **Step 3: Anthropic client sharing.** Extract the `new Anthropic({...})` call into a local `const anthropicClient` so the streaming provider and the structured client share one instance (same retry and timeout settings).

**Done when:** the generate and api apps build with variants disabled exactly as before, and with `VARIANTS_ENABLED=true` and `LLM_PROVIDER=fake` the full path runs in the emulator.
