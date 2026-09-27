import { FirebaseError } from 'firebase/app';
import { retryAfterSeconds, toUserMessage } from '@/lib/errors';
import { ApiError } from '@/lib/http';

describe('error mapping', () => {
  it('prefers the server message, then the catalog, never raw errors', () => {
    expect(
      toUserMessage(
        new ApiError({ code: 'PREVIEW_LIMIT', message: '', status: 429, retryable: true }),
      ),
    ).toMatch(/Too many/);
    expect(
      toUserMessage(
        new ApiError({
          code: 'HL_BAD_REQUEST',
          message: 'Email is invalid',
          status: 422,
          retryable: false,
        }),
      ),
    ).toBe('Email is invalid');
    expect(toUserMessage(new FirebaseError('permission-denied', 'raw'))).toBe(
      "You don't have access to this.",
    );
    expect(toUserMessage(new Error('stack trace…'))).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('reads Retry-After from details', () => {
    const e = new ApiError({
      code: 'PREVIEW_LIMIT',
      message: 'x',
      status: 429,
      retryable: true,
      details: { retryAfterMs: 2_500 },
    });
    expect(retryAfterSeconds(e)).toBe(3);
    expect(retryAfterSeconds(new Error('x'))).toBeNull();
  });
});
