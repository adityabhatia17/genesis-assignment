import type { Firestore } from 'firebase-admin/firestore';
import {
  FirestoreRateLimiter,
  MemoryRateLimiter,
  RATE_LIMITS,
  globalGenerationRule,
  nextWindow,
  rateLimitKey,
  readWindowState,
} from '../../../src/modules/rate-limit/rate-limiter.js';
import { paths } from '../../../src/shared/firestore-paths.js';
import { createFakeClock } from '../../../src/shared/clock.js';

const rule = { name: 'probe', limit: 2, windowMs: 1_000 };

describe('nextWindow', () => {
  it('opens a window, fills it, and refuses without raising the count', () => {
    const first = nextWindow(null, 0, rule);
    expect(first).toEqual({ allowed: true, retryAfterMs: 0, next: { windowStartMs: 0, count: 1 } });
    const second = nextWindow(first.next, 100, rule);
    expect(second.allowed).toBe(true);
    expect(second.next.count).toBe(2);
    const denied = nextWindow(second.next, 100, rule);
    expect(denied).toEqual({
      allowed: false,
      retryAfterMs: 900,
      next: { windowStartMs: 0, count: 2 },
    });
  });

  it('starts a new window on the boundary', () => {
    const opened = nextWindow({ windowStartMs: 0, count: 2 }, 1_000, rule);
    expect(opened).toEqual({
      allowed: true,
      retryAfterMs: 0,
      next: { windowStartMs: 1_000, count: 1 },
    });
  });

  it('denies a zero cap without inventing a stored count', () => {
    expect(nextWindow(null, 50, { name: 'none', limit: 0, windowMs: 1_000 })).toMatchObject({
      allowed: false,
      retryAfterMs: 1_000,
    });
  });
});

describe('rate limit keys and stored shape', () => {
  it('locks the route budgets', () => {
    expect(RATE_LIMITS.generation).toEqual({ name: 'generation', limit: 10, windowMs: 600_000 });
    expect(RATE_LIMITS.generationDay).toEqual({
      name: 'generationDay',
      limit: 40,
      windowMs: 86_400_000,
    });
    expect(RATE_LIMITS.hlProxy.limit).toBeGreaterThanOrEqual(120);
    expect(RATE_LIMITS.hlProxy).toEqual({ name: 'hlProxy', limit: 240, windowMs: 60_000 });
    expect(RATE_LIMITS.oauthStart).toEqual({ name: 'oauthStart', limit: 5, windowMs: 60_000 });
    expect(RATE_LIMITS.fileSave).toEqual({ name: 'fileSave', limit: 60, windowMs: 60_000 });
    expect(RATE_LIMITS.snapshotRestore).toEqual({
      name: 'snapshotRestore',
      limit: 10,
      windowMs: 600_000,
    });
    expect(globalGenerationRule(200)).toEqual({
      name: 'generationGlobalDay',
      limit: 200,
      windowMs: 86_400_000,
    });
  });

  it('replaces characters that cannot appear in a document id', () => {
    expect(rateLimitKey('user/1', 'generation')).toBe('user_1_generation');
    expect(rateLimitKey('alice', 'generation')).not.toBe(rateLimitKey('bob', 'generation'));
  });

  it('ignores a corrupt counter so one bad document cannot lock the route', () => {
    expect(readWindowState(undefined)).toBeNull();
    expect(readWindowState({ count: '2', windowStartMs: 0 })).toBeNull();
    expect(readWindowState({ count: 2, windowStartMs: 0 })).toEqual({ count: 2, windowStartMs: 0 });
  });
});

describe('MemoryRateLimiter', () => {
  it('isolates subjects and resets after the window', async () => {
    const clock = createFakeClock(0);
    const limiter = new MemoryRateLimiter(clock);
    expect(await limiter.consume(rule, 'a')).toMatchObject({ allowed: true });
    expect(await limiter.consume(rule, 'b')).toMatchObject({ allowed: true });
    expect(await limiter.consume(rule, 'a')).toMatchObject({ allowed: true });
    expect(await limiter.consume(rule, 'a')).toEqual({ allowed: false, retryAfterMs: 1_000 });
    clock.advance(1_000);
    expect(await limiter.consume(rule, 'a')).toEqual({ allowed: true, retryAfterMs: 0 });
  });
});

describe('FirestoreRateLimiter', () => {
  function fakeDb() {
    const docs = new Map<string, Record<string, unknown>>();
    const db = {
      doc: (path: string) => ({ path }),
      runTransaction: async <T>(
        fn: (tx: {
          get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => unknown }>;
          set: (ref: { path: string }, data: Record<string, unknown>) => void;
        }) => Promise<T>,
      ): Promise<T> =>
        fn({
          get: async (ref) => ({
            exists: docs.has(ref.path),
            data: () => docs.get(ref.path),
          }),
          set: (ref, data) => {
            docs.set(ref.path, data);
          },
        }),
    };
    return { db: db as unknown as Firestore, docs };
  }

  it('writes only allowed calls and leaves a denial unchanged', async () => {
    const clock = createFakeClock(5_000);
    const { db, docs } = fakeDb();
    const limiter = new FirestoreRateLimiter(db, clock);
    const id = paths.rateLimit(rateLimitKey('u1', rule.name));

    expect(await limiter.consume(rule, 'u1')).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(docs.get(id)).toEqual({ windowStartMs: 5_000, count: 1 });
    expect(await limiter.consume(rule, 'u1')).toMatchObject({ allowed: true });
    expect(await limiter.consume(rule, 'u1')).toEqual({ allowed: false, retryAfterMs: 1_000 });
    expect(docs.get(id)).toEqual({ windowStartMs: 5_000, count: 2 });

    clock.advance(1_000);
    expect(await limiter.consume(rule, 'u1')).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(docs.get(id)).toEqual({ windowStartMs: 6_000, count: 1 });
  });

  it('replaces a corrupt document on the next allowed call', async () => {
    const { db, docs } = fakeDb();
    const id = paths.rateLimit(rateLimitKey('u1', rule.name));
    docs.set(id, { count: 'nope' });
    const limiter = new FirestoreRateLimiter(db, createFakeClock(0));
    expect(await limiter.consume(rule, 'u1')).toMatchObject({ allowed: true });
    expect(docs.get(id)).toEqual({ windowStartMs: 0, count: 1 });
  });
});
