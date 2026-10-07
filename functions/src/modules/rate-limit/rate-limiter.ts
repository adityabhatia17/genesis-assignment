import type { Firestore } from 'firebase-admin/firestore';
import { LIMITS } from '../../contracts/limits.js';
import type { Clock } from '../../shared/clock.js';
import { paths } from '../../shared/firestore-paths.js';

export interface RateLimitRule {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

export interface ConsumeResult {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

export interface WindowState {
  readonly windowStartMs: number;
  readonly count: number;
}

export interface ConsumeRequest {
  readonly rule: RateLimitRule;
  readonly subject: string;
}

export interface ConsumeAllResult {
  readonly allowed: boolean;
  readonly deniedRule: string | null;
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  consume(rule: RateLimitRule, subject: string): Promise<ConsumeResult>;
  /** All-or-nothing: either every rule is consumed or none is. */
  consumeAll(requests: readonly ConsumeRequest[]): Promise<ConsumeAllResult>;
  /** Gives one unit back if the window that was charged is still open. */
  refund(request: ConsumeRequest): Promise<void>;
}

const MINUTE = 60_000;
const TEN_MINUTES = 10 * MINUTE;
const DAY = 24 * 60 * MINUTE;

/** Fixed windows from ARCHITECTURE §16, plus save/restore and the global generation day. */
export const RATE_LIMITS = {
  generation: { name: 'generation', limit: 10, windowMs: TEN_MINUTES },
  /** One account cannot spend the whole global day. 200 / 40 = 5 accounts. */
  generationDay: { name: 'generationDay', limit: 40, windowMs: DAY },
  /** At least the preview bridge budget, shared across that user's tabs. */
  hlProxy: { name: 'hlProxy', limit: 2 * LIMITS.bridgeCallsPerMinute, windowMs: MINUTE },
  oauthStart: { name: 'oauthStart', limit: 5, windowMs: MINUTE },
  fileSave: { name: 'fileSave', limit: 60, windowMs: MINUTE },
  snapshotRestore: { name: 'snapshotRestore', limit: 10, windowMs: TEN_MINUTES },
} as const satisfies Record<string, RateLimitRule>;

export function globalGenerationRule(cap: number): RateLimitRule {
  return { name: 'generationGlobalDay', limit: cap, windowMs: DAY };
}

export function rateLimitKey(subject: string, ruleName: string): string {
  const clean = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
  return `${clean(subject)}_${clean(ruleName)}`;
}

/**
 * Fixed window. A request on the boundary starts a new window.
 * A denial leaves the stored count unchanged.
 */
export function nextWindow(
  state: WindowState | null,
  now: number,
  rule: RateLimitRule,
): { allowed: boolean; retryAfterMs: number; next: WindowState } {
  const open = state !== null && now < state.windowStartMs + rule.windowMs;
  const windowStartMs = open ? state.windowStartMs : now;
  const count = open ? state.count : 0;
  if (count >= rule.limit) {
    return {
      allowed: false,
      retryAfterMs: Math.max(0, windowStartMs + rule.windowMs - now),
      next: { windowStartMs, count },
    };
  }
  return { allowed: true, retryAfterMs: 0, next: { windowStartMs, count: count + 1 } };
}

/** Returns the next state, or null when there is nothing to refund. */
export function refundWindow(
  state: WindowState | null,
  now: number,
  rule: RateLimitRule,
): WindowState | null {
  if (!state || now >= state.windowStartMs + rule.windowMs || state.count <= 0) return null;
  return { windowStartMs: state.windowStartMs, count: state.count - 1 };
}

function field(data: object, key: 'windowStartMs' | 'count'): unknown {
  if (!Object.hasOwn(data, key)) return undefined;
  return (data as Record<string, unknown>)[key];
}

export function readWindowState(data: unknown): WindowState | null {
  if (typeof data !== 'object' || data === null) return null;
  const windowStartMs = field(data, 'windowStartMs');
  const count = field(data, 'count');
  if (typeof windowStartMs !== 'number' || typeof count !== 'number') return null;
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(count)) return null;
  return { windowStartMs, count };
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, WindowState>();

  constructor(private readonly clock: Clock) {}

  consume(rule: RateLimitRule, subject: string): Promise<ConsumeResult> {
    const key = rateLimitKey(subject, rule.name);
    const decision = nextWindow(this.buckets.get(key) ?? null, this.clock.now(), rule);
    if (decision.allowed) this.buckets.set(key, decision.next);
    return Promise.resolve({ allowed: decision.allowed, retryAfterMs: decision.retryAfterMs });
  }

  consumeAll(requests: readonly ConsumeRequest[]): Promise<ConsumeAllResult> {
    const now = this.clock.now();
    const decisions = requests.map((r) =>
      nextWindow(this.buckets.get(rateLimitKey(r.subject, r.rule.name)) ?? null, now, r.rule),
    );
    const denied = decisions.findIndex((d) => !d.allowed);
    if (denied >= 0) {
      return Promise.resolve({
        allowed: false,
        deniedRule: requests[denied]!.rule.name,
        retryAfterMs: decisions[denied]!.retryAfterMs,
      });
    }
    requests.forEach((r, i) => this.buckets.set(rateLimitKey(r.subject, r.rule.name), decisions[i]!.next));
    return Promise.resolve({ allowed: true, deniedRule: null, retryAfterMs: 0 });
  }

  refund(request: ConsumeRequest): Promise<void> {
    const key = rateLimitKey(request.subject, request.rule.name);
    const next = refundWindow(this.buckets.get(key) ?? null, this.clock.now(), request.rule);
    if (next) this.buckets.set(key, next);
    else if ((this.buckets.get(key)?.count ?? 0) <= 0) this.buckets.delete(key);
    return Promise.resolve();
  }
}

export class FirestoreRateLimiter implements RateLimiter {
  constructor(
    private readonly db: Firestore,
    private readonly clock: Clock,
  ) {}

  consume(rule: RateLimitRule, subject: string): Promise<ConsumeResult> {
    const ref = this.db.doc(paths.rateLimit(rateLimitKey(subject, rule.name)));
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const decision = nextWindow(
        snap.exists ? readWindowState(snap.data()) : null,
        this.clock.now(),
        rule,
      );
      if (decision.allowed) tx.set(ref, { ...decision.next });
      return { allowed: decision.allowed, retryAfterMs: decision.retryAfterMs };
    });
  }

  consumeAll(requests: readonly ConsumeRequest[]): Promise<ConsumeAllResult> {
    if (requests.length === 0) return Promise.resolve({ allowed: true, deniedRule: null, retryAfterMs: 0 });
    const refs = requests.map((r) =>
      this.db.doc(paths.rateLimit(rateLimitKey(r.subject, r.rule.name))),
    );
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

  refund(request: ConsumeRequest): Promise<void> {
    const ref = this.db.doc(paths.rateLimit(rateLimitKey(request.subject, request.rule.name)));
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = refundWindow(
        snap.exists ? readWindowState(snap.data()) : null,
        this.clock.now(),
        request.rule,
      );
      if (next) tx.set(ref, { ...next });
    });
  }
}
