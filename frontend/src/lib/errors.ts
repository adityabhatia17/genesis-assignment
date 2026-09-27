import { FirebaseError } from 'firebase/app';
import { ERROR_CATALOG, type ErrorCode } from '@/contracts/errors';
import { isApiError } from './http';

const GENERIC = 'Something went wrong. Please try again.';

const FIRESTORE_MESSAGES: Readonly<Record<string, string>> = {
  'permission-denied': "You don't have access to this.",
  unavailable: "Can't reach the database — check your connection.",
  'deadline-exceeded': 'The request took too long. Please try again.',
  'not-found': 'Not found.',
};

export function messageForCode(code: string): string {
  return code in ERROR_CATALOG ? ERROR_CATALOG[code as ErrorCode].message : GENERIC;
}

/** The only way UI code turns an error into text. Never exposes stacks or raw bodies. */
export function toUserMessage(error: unknown): string {
  if (isApiError(error)) return error.message.trim() || messageForCode(error.code);
  if (error instanceof FirebaseError) {
    const code = error.code.replace(/^firestore\//, '');
    return FIRESTORE_MESSAGES[code] ?? GENERIC;
  }
  return GENERIC;
}

export function retryAfterSeconds(error: unknown): number | null {
  if (!isApiError(error)) return null;
  const ms = error.details['retryAfterMs'];
  return typeof ms === 'number' && ms > 0 ? Math.ceil(ms / 1000) : null;
}

export function errorCodeOf(error: unknown): string | null {
  if (isApiError(error)) return error.code;
  if (error instanceof FirebaseError) return error.code;
  return null;
}
