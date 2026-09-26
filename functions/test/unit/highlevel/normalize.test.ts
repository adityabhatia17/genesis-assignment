import {
  displayName,
  messageTypeLabel,
  toIso,
} from '../../../src/modules/highlevel/adapters/normalize.js';
import { mapWithConcurrency } from '../../../src/shared/async.js';

describe('normalizers', () => {
  it('converts dates to ISO', () => {
    expect(toIso(1_700_000_000_000)).toBe('2023-11-14T22:13:20.000Z');
    expect(toIso('1700000000000')).toBe('2023-11-14T22:13:20.000Z');
    expect(toIso('1700000000')).toBe('2023-11-14T22:13:20.000Z');
    expect(toIso('2026-10-01T10:00:00-05:00')).toBe('2026-10-01T15:00:00.000Z');
    expect(toIso('not a date')).toBeNull();
    expect(toIso(undefined)).toBeNull();
  });
  it('builds a non-empty display name', () => {
    expect(displayName({ firstName: 'Ava', lastName: 'Patel' })).toBe('Ava Patel');
    expect(displayName({ contactName: 'Mia Kim' })).toBe('Mia Kim');
    expect(displayName({ email: 'x@y.z' })).toBe('x@y.z');
    expect(displayName({})).toBe('Unnamed contact');
  });
  it('labels message types', () => {
    expect(messageTypeLabel('TYPE_SMS')).toBe('SMS');
    expect(messageTypeLabel(2)).toBeNull();
  });
  it('maps with bounded concurrency preserving order', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
