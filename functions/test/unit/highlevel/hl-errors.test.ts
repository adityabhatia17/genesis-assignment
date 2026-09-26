import {
  HlApiError,
  hlErrorToAppError,
  sanitizeHlMessage,
} from '../../../src/modules/highlevel/client/hl-errors.js';

describe('hl error mapping', () => {
  it.each([
    [401, 'HL_REAUTH_REQUIRED'],
    [403, 'HL_FORBIDDEN'],
    [404, 'HL_NOT_FOUND'],
    [400, 'HL_BAD_REQUEST'],
    [422, 'HL_BAD_REQUEST'],
    [429, 'HL_RATE_LIMITED'],
    [500, 'HL_UNAVAILABLE'],
    [0, 'HL_UNAVAILABLE'],
  ])('%i → %s', (status, code) => {
    expect(hlErrorToAppError(new HlApiError(status, 'x', null, null)).code).toBe(code);
  });
  it('detects missing scopes', () => {
    expect(
      hlErrorToAppError(
        new HlApiError(403, 'The token is not authorized for this scope.', null, null),
      ).code,
    ).toBe('HL_SCOPE_MISSING');
  });
  it('sanitizes messages (arrays, tokens, length)', () => {
    expect(sanitizeHlMessage({ message: ['email must be an email', 'phone invalid'] })).toBe(
      'email must be an email; phone invalid',
    );
    expect(
      sanitizeHlMessage({ message: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789 is bad' }),
    ).not.toContain('abcdefghijklmnop');
    expect(sanitizeHlMessage({ message: 'x'.repeat(1000) }).length).toBeLessThanOrEqual(300);
    expect(sanitizeHlMessage(null)).toBe('HighLevel request failed');
  });
});
