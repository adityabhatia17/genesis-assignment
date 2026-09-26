import { ERROR_CATALOG, ERROR_CODES, httpStatusFor, isRetryable } from '../../../src/contracts/errors.js';

describe('error catalog', () => {
  it('has an entry for every code', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_CATALOG[code]).toBeDefined();
      expect(ERROR_CATALOG[code].message.length).toBeGreaterThan(0);
    }
  });
  it('maps representative codes to HTTP statuses', () => {
    expect(httpStatusFor('UNAUTHENTICATED')).toBe(401);
    expect(httpStatusFor('GENERATION_IN_PROGRESS')).toBe(409);
    expect(httpStatusFor('LLM_RATE_LIMITED')).toBe(429);
    expect(httpStatusFor('HL_UNAVAILABLE')).toBe(502);
    expect(isRetryable('HL_RATE_LIMITED')).toBe(true);
    expect(isRetryable('HL_REAUTH_REQUIRED')).toBe(false);
  });
});
