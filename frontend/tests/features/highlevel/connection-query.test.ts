import { oauthErrorMessage, readOAuthReturn } from '@/features/highlevel/connection-query';

describe('readOAuthReturn', () => {
  it('reads success and known reasons', () => {
    expect(readOAuthReturn({ hl: 'connected' })).toEqual({ kind: 'connected' });
    expect(readOAuthReturn({ hl: 'error', reason: 'denied' })).toEqual({
      kind: 'error',
      reason: 'denied',
    });
  });
  it('treats unknown reasons as internal and ignores unrelated queries', () => {
    expect(readOAuthReturn({ hl: 'error', reason: '<script>' })).toEqual({
      kind: 'error',
      reason: 'internal',
    });
    expect(readOAuthReturn({})).toBeNull();
  });
  it('has a message for the agency-token case', () => {
    expect(oauthErrorMessage('not_location_token')).toMatch(/sub-account/);
  });
});
