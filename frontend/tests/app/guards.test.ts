import { resolveNavigation } from '@/app/guards';

describe('resolveNavigation', () => {
  const base = { requiresAuth: false, guestOnly: false, signedIn: false, fullPath: '/projects/p1' };
  it('sends signed-out users to sign-in with a redirect back', () => {
    expect(resolveNavigation({ ...base, requiresAuth: true })).toEqual({
      name: 'sign-in',
      query: { redirect: '/projects/p1' },
    });
  });
  it('keeps signed-in users away from auth pages', () => {
    expect(resolveNavigation({ ...base, guestOnly: true, signedIn: true })).toEqual({
      name: 'dashboard',
    });
  });
  it('allows everything else', () => {
    expect(resolveNavigation({ ...base, requiresAuth: true, signedIn: true })).toBe(true);
    expect(resolveNavigation(base)).toBe(true);
  });
});
