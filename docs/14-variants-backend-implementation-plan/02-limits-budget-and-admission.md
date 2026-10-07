# BV-2 — Variants limits, daily budget and admission

> **As built.** Admission is in `modules/rate-limit/variants-admission.ts`, wired in `generate.app.ts` and `src/composition.ts`. It checks the switch, the daily budget, the global and per-user run limits and the per-instance gate (D34). A denial returns a single generation with a `fallbackReason`. The budget reserves `runReserveCents` and settles from `actualCents`. `actualCents` is the candidates plus the checklist. It does not include the judge, and a model with no price counts as zero. The refund runs when fewer than two candidates produced a score. A variants run also takes one unit of the normal generation limits (D28).

> Read [`00-overview.md`](00-overview.md) first. Design: [`../13-variants-feature.md`](../13-variants-feature.md) D21, D24, §8; this plan D27, D28, D34. Existing code: `modules/rate-limit/rate-limiter.ts`, `http/middleware/rate-limit.ts`, `modules/generation/generate.app.ts`.

**Outcome:** a request for a first generation is **admitted** as either a variants run (with a budget reservation and consumed limits) or a normal single generation with a stated fallback reason. Limits are consumed atomically (no leak between rules), refundable, and the daily dollar budget is enforced with reserve-then-settle.

How the existing gate fits (D28): the three existing middleware in `generate.app.ts` stay as the outer gate, so a variants run consumes 1 unit of the normal generation limits and a global-cap denial returns `RATE_LIMITED` as today. Admission runs **after** them, inside the handler.

---

### Task BV-2.1: Limiter — atomic multi-rule consume and refund

**Files:**

- Modify: `functions/src/modules/rate-limit/rate-limiter.ts`

**Interfaces:**

- Consumes: `RateLimitRule`, `nextWindow`, `rateLimitKey`, `paths.rateLimit`.
- Produces:
  - `interface ConsumeRequest { rule: RateLimitRule; subject: string }`
  - `interface ConsumeAllResult { allowed: boolean; deniedRule: string | null; retryAfterMs: number }`
  - `RateLimiter.consumeAll(requests: readonly ConsumeRequest[]): Promise<ConsumeAllResult>`
  - `RateLimiter.refund(request: ConsumeRequest): Promise<void>`
  - `refundWindow(state, now, rule): WindowState | null` (pure)

- [ ] **Step 1: Extend the interface**

```ts
export interface RateLimiter {
  consume(rule: RateLimitRule, subject: string): Promise<ConsumeResult>;
  /** All-or-nothing: either every rule is consumed or none is. */
  consumeAll(requests: readonly ConsumeRequest[]): Promise<ConsumeAllResult>;
  /** Gives one unit back if the window that was charged is still open. Never goes below zero. */
  refund(request: ConsumeRequest): Promise<void>;
}
```

- [ ] **Step 2: Pure refund helper**

```ts
/** Returns the next state, or null when there is nothing to refund (window over or count is 0). */
export function refundWindow(
  state: WindowState | null,
  now: number,
  rule: RateLimitRule,
): WindowState | null {
  if (!state || now >= state.windowStartMs + rule.windowMs || state.count <= 0) return null;
  return { windowStartMs: state.windowStartMs, count: state.count - 1 };
}
```

- [ ] **Step 3: `FirestoreRateLimiter.consumeAll`** — one transaction: read every rule's document first (Firestore requires reads before writes), compute `nextWindow` for each, and write only if **all** are allowed. The first denied rule determines `deniedRule` and `retryAfterMs`.

```ts
consumeAll(requests: readonly ConsumeRequest[]): Promise<ConsumeAllResult> {
  const refs = requests.map((r) => this.db.doc(paths.rateLimit(rateLimitKey(r.subject, r.rule.name))));
  return this.db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);
    const now = this.clock.now();
    const decisions = requests.map((r, i) =>
      nextWindow(snaps[i]?.exists ? readWindowState(snaps[i]?.data()) : null, now, r.rule),
    );
    const denied = decisions.findIndex((d) => !d.allowed);
    if (denied >= 0) {
      return {
        allowed: false,
        deniedRule: requests[denied]!.rule.name,
        retryAfterMs: decisions[denied]!.retryAfterMs,
      };
    }
    decisions.forEach((d, i) => tx.set(refs[i]!, { ...d.next }));
    return { allowed: true, deniedRule: null, retryAfterMs: 0 };
  });
}
```

- [ ] **Step 4: `FirestoreRateLimiter.refund`** — transaction: read, `refundWindow`, `tx.set` if not null. `MemoryRateLimiter` gets the same two methods over its map.

**Done when:** `consumeAll` leaves every counter unchanged when any rule denies; `refund` never produces a negative count; the existing `consume` and its callers are untouched.

---

### Task BV-2.2: Variants rules

**Files:**

- Create: `functions/src/modules/rate-limit/variants-limits.ts`

**Interfaces:**

- Consumes: `RuntimeConfig`, `RateLimitRule`.
- Produces: `variantsRules(config): { burst: RateLimitRule; day: RateLimitRule; global: RateLimitRule }`, `GLOBAL_SUBJECT`.

- [ ] **Step 1: Implement**

```ts
import type { RuntimeConfig } from '../../config/runtime-config.js';
import type { RateLimitRule } from './rate-limiter.js';

const MINUTE = 60_000;
export const GLOBAL_SUBJECT = 'global';

export function variantsRules(
  c: Pick<RuntimeConfig, 'variantsUserPer10Min' | 'variantsUserPerDay' | 'variantsGlobalPerDay'>,
): { burst: RateLimitRule; day: RateLimitRule; global: RateLimitRule } {
  return {
    burst: { name: 'variantsBurst', limit: c.variantsUserPer10Min, windowMs: 10 * MINUTE },
    day: { name: 'variantsDay', limit: c.variantsUserPerDay, windowMs: 24 * 60 * MINUTE },
    global: {
      name: 'variantsGlobalDay',
      limit: c.variantsGlobalPerDay,
      windowMs: 24 * 60 * MINUTE,
    },
  };
}
```

**Done when:** the three rules have names distinct from the existing ones (`generation`, `generationDay`, `generationGlobalDay`), so counters never collide.

---

### Task BV-2.3: Daily budget (reserve, settle, release)

**Files:**

- Create: `functions/src/modules/rate-limit/budget.repo.ts`
- Modify: `functions/src/shared/firestore-paths.ts` (`budgetDay`)

**Interfaces:**

- Consumes: `Firestore`, `Clock`, `paths`.
- Produces:
  - `interface BudgetState { spentCents: number; reservedCents: number }`
  - `canReserve(state, cents, capCents): boolean` (pure)
  - `class DailyBudgetRepo { reserve(cents, capCents): Promise<boolean>; settle(reservedCents, actualCents): Promise<void>; release(reservedCents): Promise<void> }`
  - `dayKey(nowMs): string` (UTC `YYYYMMDD`)

- [ ] **Step 1: Path** — `budgetDay: (key: string) => \`rateLimits/variantsBudget\_${key}\``. It lives next to the other rate-limit documents, which clients cannot read (rules are deny-by-default for `rateLimits`).

- [ ] **Step 2: Pure math**

```ts
export const canReserve = (s: BudgetState, cents: number, capCents: number): boolean =>
  s.spentCents + s.reservedCents + cents <= capCents;
```

A reservation is the worst-case run cost (`LIMITS.variants.runReserveCents`, 250). At a $10 cap, at most four runs can be in flight at once, and once real spend is settled the reserved amount is released, so many more runs can fit across the day.

- [ ] **Step 3: Repo** — each method is one transaction on the day's document (create-if-absent with `{ spentCents: 0, reservedCents: 0 }`):

```ts
reserve(cents, capCents); // allowed → reservedCents += cents; returns true; denied → returns false, no write
settle(reserved, actual); // reservedCents -= reserved; spentCents += actual (both clamped at ≥ 0)
release(reserved); // reservedCents -= reserved (run failed before spending anything)
```

`settle` is called in the orchestrator's `finally` with the **actual** cost from recorded usage (BV-7.3), so spend is exact even when a run fails midway. A crash between reserve and settle leaves a stuck reservation until the end of the UTC day; document this and let the next day start clean (the day key changes). No sweeper in v1.

**Done when:** the budget cannot be exceeded by concurrent reservations (transaction), and a denied reservation writes nothing.

---

### Task BV-2.4: Admission service

**Files:**

- Create: `functions/src/modules/rate-limit/variants-admission.ts`

**Interfaces:**

- Consumes: `RateLimiter`, `DailyBudgetRepo`, `variantsRules`, `RuntimeConfig`, `ProjectRecord`, `LIMITS.variants`.
- Produces:
  - `type FallbackReason = 'disabled' | 'budget' | 'user_limit' | 'global_limit' | 'busy' | 'not_first'`
  - `type Admission = { mode: 'variants'; reservedCents: number } | { mode: 'single'; reason: FallbackReason }`
  - `class VariantsAdmission { check(input): Promise<Admission>; refund(uid): Promise<void>; releaseOnStartFailure(reserved): Promise<void> }`
  - `class InstanceGate { tryEnter(): boolean; leave(): void }` (D34)

- [ ] **Step 1: First-generation test** (pure): a project qualifies when `latestSnapshotId === null` and `snapshotSeq === 0` (no snapshot has ever been made). A project with a pending, unselected variants run still qualifies (its run is `awaiting_selection`); starting a new run in that case is allowed and the old run is left to expire.

- [ ] **Step 2: Decision order** (cheapest and least-side-effecting first):

```ts
async check(i: { uid: string; project: ProjectRecord; variantsAvailable: boolean }): Promise<Admission> {
  if (!i.variantsAvailable) return { mode: 'single', reason: 'disabled' }; // config + startup check
  if (i.project.latestSnapshotId !== null || i.project.snapshotSeq > 0)
    return { mode: 'single', reason: 'not_first' };
  if (!this.gate.tryEnter()) return { mode: 'single', reason: 'busy' };      // D34, released on any exit below

  const reserve = LIMITS.variants.runReserveCents;
  if (!(await this.budget.reserve(reserve, this.cfg.variantsDailyBudgetCents))) {
    this.gate.leave();
    return { mode: 'single', reason: 'budget' };
  }
  const rules = variantsRules(this.cfg);
  const r = await this.limiter.consumeAll([
    { rule: rules.burst, subject: i.uid },
    { rule: rules.day, subject: i.uid },
    { rule: rules.global, subject: GLOBAL_SUBJECT },
  ]);
  if (!r.allowed) {
    await this.budget.release(reserve);
    this.gate.leave();
    return { mode: 'single', reason: r.deniedRule === rules.global.name ? 'global_limit' : 'user_limit' };
  }
  return { mode: 'variants', reservedCents: reserve }; // gate stays entered until the run ends
}
```

The order puts the budget and instance gate before limiter consumption, and `consumeAll` makes the three variants rules all-or-nothing. If anything after admission fails before the run starts (for example `generations.start` throws `GENERATION_IN_PROGRESS`), the route calls `refund(uid)` and `releaseOnStartFailure(reserved)` so nothing leaks.

- [ ] **Step 3: Refund**

```ts
async refund(uid: string): Promise<void> {
  const rules = variantsRules(this.cfg);
  await Promise.all([
    this.limiter.refund({ rule: rules.burst, subject: uid }),
    this.limiter.refund({ rule: rules.day, subject: uid }),
    this.limiter.refund({ rule: rules.global, subject: GLOBAL_SUBJECT }),
  ]);
}
```

Refund policy (D21), enforced by the orchestrator: refund when **fewer than 2** candidates qualify, when the run fails before any candidate finishes, or when the run fails with a system error. **No refund** for user cancellation. A refund does not return the budget: spend is real once settled.

- [ ] **Step 4: `InstanceGate`** — a counter with `maxConcurrentRunsPerInstance` (2) from `LIMITS.variants`. `leave()` is idempotent per run (the orchestrator calls it in `finally`).

**Done when:** every denial path returns a `single` admission with the right reason and leaves budget, counters and the gate exactly as they were; the `variants` path holds one budget reservation and one gate slot until the orchestrator releases them.
