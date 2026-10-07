import type { Firestore } from 'firebase-admin/firestore';
import type { Clock } from '../../shared/clock.js';
import { paths } from '../../shared/firestore-paths.js';

export interface BudgetState {
  readonly spentCents: number;
  readonly reservedCents: number;
}

export const canReserve = (s: BudgetState, cents: number, capCents: number): boolean =>
  s.spentCents + s.reservedCents + cents <= capCents;

/** UTC day, so the counter resets at 00:00 UTC. */
export function dayKey(nowMs: number): string {
  const d = new Date(nowMs);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}${m}${day}`;
}

function readState(data: unknown): BudgetState {
  if (typeof data !== 'object' || data === null) return { spentCents: 0, reservedCents: 0 };
  const spent = (data as { spentCents?: unknown }).spentCents;
  const reserved = (data as { reservedCents?: unknown }).reservedCents;
  return {
    spentCents: typeof spent === 'number' && spent > 0 ? Math.floor(spent) : 0,
    reservedCents: typeof reserved === 'number' && reserved > 0 ? Math.floor(reserved) : 0,
  };
}

const clamp = (n: number) => (n > 0 ? Math.floor(n) : 0);

/**
 * Daily variants spend. A reservation is the worst-case cost of one run.
 * settle replaces it with the real cost. A crash between reserve and settle
 * holds the reservation until the UTC day rolls over.
 */
export class DailyBudgetRepo {
  constructor(
    private readonly db: Firestore,
    private readonly clock: Clock,
  ) {}

  private ref(nowMs: number) {
    return this.db.doc(paths.budgetDay(dayKey(nowMs)));
  }

  reserve(cents: number, capCents: number): Promise<boolean> {
    const ref = this.ref(this.clock.now());
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = readState(snap.exists ? snap.data() : null);
      if (!canReserve(state, cents, capCents)) return false;
      tx.set(ref, { ...state, reservedCents: state.reservedCents + cents });
      return true;
    });
  }

  settle(reservedCents: number, actualCents: number): Promise<void> {
    const ref = this.ref(this.clock.now());
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = readState(snap.exists ? snap.data() : null);
      tx.set(ref, {
        reservedCents: clamp(state.reservedCents - reservedCents),
        spentCents: state.spentCents + clamp(actualCents),
      });
    });
  }

  release(reservedCents: number): Promise<void> {
    const ref = this.ref(this.clock.now());
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = readState(snap.exists ? snap.data() : null);
      tx.set(ref, {
        spentCents: state.spentCents,
        reservedCents: clamp(state.reservedCents - reservedCents),
      });
    });
  }
}
