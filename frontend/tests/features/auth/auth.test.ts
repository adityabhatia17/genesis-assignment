import { FirebaseError } from 'firebase/app';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { authFormSchema } from '@/features/auth/auth.schemas';
import { safeRedirect } from '@/features/auth/redirect';

describe('auth schemas', () => {
  it('sign-in only needs an email and a password', () => {
    expect(
      authFormSchema('sign-in').safeParse({ email: ' a@b.co ', password: 'x', confirm: '' })
        .success,
    ).toBe(true);
  });
  it('sign-up enforces length and matching confirmation', () => {
    const result = authFormSchema('sign-up').safeParse({
      email: 'a@b.co',
      password: 'short',
      confirm: 'other',
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['password', 'confirm']));
  });
});

describe('authErrorMessage', () => {
  it.each([
    ['auth/email-already-in-use', 'An account with this email already exists.'],
    ['auth/invalid-credential', 'Email or password is incorrect.'],
    ['auth/too-many-requests', 'Too many attempts. Try again in a few minutes.'],
    ['auth/unknown', 'Something went wrong. Please try again.'],
  ])('%s', (code, message) => {
    expect(authErrorMessage(new FirebaseError(code, 'raw'))).toBe(message);
  });
});

describe('safeRedirect', () => {
  it('allows only same-app paths', () => {
    expect(safeRedirect('/projects/p1')).toBe('/projects/p1');
    expect(safeRedirect('//evil.example')).toBeNull();
    expect(safeRedirect('/\\evil.example')).toBeNull();
    expect(safeRedirect('https://evil.example')).toBeNull();
    expect(safeRedirect(['/a'])).toBeNull();
  });
});
