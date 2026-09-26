import { AppError, isAppError } from '../../../src/shared/app-error.js';

describe('AppError', () => {
  it('derives status, retryable and default message from the catalog', () => {
    const e = new AppError('FILE_VERSION_CONFLICT', undefined, { currentVersion: 4 });
    expect(e.status).toBe(409);
    expect(e.retryable).toBe(false);
    expect(e.message).toBe('This file changed since you opened it.');
    expect(e.details).toEqual({ currentVersion: 4 });
    expect(isAppError(e)).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
  });
});
