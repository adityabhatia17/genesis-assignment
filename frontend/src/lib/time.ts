export type TimestampLike = { toMillis(): number } | Date | number | null | undefined;

export function toMillis(value: TimestampLike): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return value.toMillis();
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function formatRelative(ms: number, nowMs: number, locale?: string): string {
  const diff = ms - nowMs;
  if (Math.abs(diff) < 45_000) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size || unit === 'minute')
      return rtf.format(Math.round(diff / size), unit);
  }
  return 'just now';
}

export function formatAbsolute(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}
