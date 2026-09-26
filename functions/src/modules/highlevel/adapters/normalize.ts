export function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v !== 'string' || v.trim() === '') return null;
  const s = v.trim();
  if (/^\d{13}$/.test(s)) return new Date(Number(s)).toISOString();
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const isoToMs = (iso: string): number => Date.parse(iso);

export const nullIfBlank = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

export const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null;

export function displayName(r: {
  contactName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
}): string {
  const full = [nullIfBlank(r.firstName), nullIfBlank(r.lastName)].filter(Boolean).join(' ');
  return (
    nullIfBlank(r.contactName) ??
    (full || null) ??
    nullIfBlank(r.name) ??
    nullIfBlank(r.email) ??
    nullIfBlank(r.phone) ??
    'Unnamed contact'
  );
}

export function messageTypeLabel(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null;
  return v.startsWith('TYPE_') ? v.slice(5) : v;
}
