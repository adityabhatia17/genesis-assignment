import { FirebaseError } from 'firebase/app';

const GENERIC = 'Something went wrong. Please try again.';
const WRONG_CREDENTIALS = 'Email or password is incorrect.';

const MESSAGES: Readonly<Record<string, string>> = {
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/invalid-credential': WRONG_CREDENTIALS,
  'auth/invalid-login-credentials': WRONG_CREDENTIALS,
  'auth/wrong-password': WRONG_CREDENTIALS,
  'auth/user-not-found': WRONG_CREDENTIALS,
  'auth/weak-password': 'Choose a stronger password (at least 8 characters).',
  'auth/password-does-not-meet-requirements': 'Choose a stronger password (at least 8 characters).',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  'auth/network-request-failed': 'Network error — check your connection.',
  'auth/user-disabled': 'This account has been disabled.',
};

export function authErrorMessage(error: unknown): string {
  return error instanceof FirebaseError ? (MESSAGES[error.code] ?? GENERIC) : GENERIC;
}
