import { formatRelative, toMillis } from '@/lib/time';

describe('time helpers', () => {
  const now = Date.UTC(2026, 9, 1, 12);
  it('formats relative times', () => {
    expect(formatRelative(now - 10_000, now, 'en')).toBe('just now');
    expect(formatRelative(now - 5 * 60_000, now, 'en')).toBe('5 minutes ago');
    expect(formatRelative(now - 3 * 3_600_000, now, 'en')).toBe('3 hours ago');
    expect(formatRelative(now - 86_400_000, now, 'en')).toBe('yesterday');
  });
  it('accepts Firestore timestamps, dates, numbers and null', () => {
    expect(toMillis({ toMillis: () => 5 })).toBe(5);
    expect(toMillis(new Date(7))).toBe(7);
    expect(toMillis(null)).toBeNull();
  });
});
