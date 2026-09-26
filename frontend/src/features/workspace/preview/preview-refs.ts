const isRemote = (ref: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);

/** Same rule as the server validator (functions html-refs.ts normalizeRef). */
export function normalizeRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed || isRemote(trimmed)) return null;
  return (trimmed.split(/[?#]/)[0] ?? '').replace(/^\.\//, '').replace(/^\//, '');
}
