import type { RuntimeConfig } from '../../config/runtime-config.js';
import { LIMITS } from '../../contracts/limits.js';
import type { ProjectRecord } from '../projects/project-access.js';
import type { DailyBudgetRepo } from './budget.repo.js';
import { GLOBAL_SUBJECT, variantsRules } from './variants-limits.js';
import type { RateLimiter } from './rate-limiter.js';

export type FallbackReason =
  | 'disabled'
  | 'budget'
  | 'user_limit'
  | 'global_limit'
  | 'busy'
  | 'not_first';

export type Admission =
  | { mode: 'variants'; reservedCents: number }
  | { mode: 'single'; reason: FallbackReason };

/** A project qualifies for variants only before its first snapshot. */
export const isFirstGeneration = (p: Pick<ProjectRecord, 'latestSnapshotId' | 'snapshotSeq'>): boolean =>
  p.latestSnapshotId === null && p.snapshotSeq === 0;

/** Per-instance cap on variants runs (D34). Paired enter/leave; leave clamps at zero. */
export class InstanceGate {
  private held = 0;

  constructor(private readonly max = LIMITS.variants.maxConcurrentRunsPerInstance) {}

  tryEnter(): boolean {
    if (this.held >= this.max) return false;
    this.held += 1;
    return true;
  }

  leave(): void {
    if (this.held > 0) this.held -= 1;
  }
}

export class VariantsAdmission {
  constructor(
    private readonly d: {
      limiter: RateLimiter;
      budget: DailyBudgetRepo;
      gate: InstanceGate;
      cfg: Pick<
        RuntimeConfig,
        | 'variantsUserPer10Min'
        | 'variantsUserPerDay'
        | 'variantsGlobalPerDay'
        | 'variantsDailyBudgetCents'
      >;
    },
  ) {}

  async check(i: {
    uid: string;
    project: ProjectRecord;
    variantsAvailable: boolean;
  }): Promise<Admission> {
    if (!i.variantsAvailable) return { mode: 'single', reason: 'disabled' };
    if (!isFirstGeneration(i.project)) return { mode: 'single', reason: 'not_first' };
    if (!this.d.gate.tryEnter()) return { mode: 'single', reason: 'busy' };

    const reserve = LIMITS.variants.runReserveCents;
    if (!(await this.d.budget.reserve(reserve, this.d.cfg.variantsDailyBudgetCents))) {
      this.d.gate.leave();
      return { mode: 'single', reason: 'budget' };
    }
    const rules = variantsRules(this.d.cfg);
    const result = await this.d.limiter.consumeAll([
      { rule: rules.burst, subject: i.uid },
      { rule: rules.day, subject: i.uid },
      { rule: rules.global, subject: GLOBAL_SUBJECT },
    ]);
    if (!result.allowed) {
      await this.d.budget.release(reserve);
      this.d.gate.leave();
      return {
        mode: 'single',
        reason: result.deniedRule === rules.global.name ? 'global_limit' : 'user_limit',
      };
    }
    return { mode: 'variants', reservedCents: reserve };
  }

  /** Returns the variants rate-limit units. Does not touch the dollar budget. */
  async refund(uid: string): Promise<void> {
    const rules = variantsRules(this.d.cfg);
    await Promise.all([
      this.d.limiter.refund({ rule: rules.burst, subject: uid }),
      this.d.limiter.refund({ rule: rules.day, subject: uid }),
      this.d.limiter.refund({ rule: rules.global, subject: GLOBAL_SUBJECT }),
    ]);
  }

  /** Admission succeeded but the run never started. */
  async releaseOnStartFailure(reservedCents: number): Promise<void> {
    await this.d.budget.release(reservedCents);
    this.d.gate.leave();
  }

  /** The run finished. Replace the reservation with the real cost. */
  settle(reservedCents: number, actualCents: number): Promise<void> {
    return this.d.budget.settle(reservedCents, actualCents);
  }

  /** The run finished (success or failure). */
  releaseSlot(): void {
    this.d.gate.leave();
  }
}
