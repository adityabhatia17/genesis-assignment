import { defaultMessage, httpStatusFor, isRetryable, type ErrorCode } from '../contracts/errors.js';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message ?? defaultMessage(code), options);
    this.name = 'AppError';
    this.code = code;
    this.status = httpStatusFor(code);
    this.retryable = isRetryable(code);
    this.details = details;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
