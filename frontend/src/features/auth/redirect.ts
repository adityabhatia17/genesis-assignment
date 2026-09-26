/** Only same-app absolute paths are allowed after sign-in (prevents open redirects). */
export function safeRedirect(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}
