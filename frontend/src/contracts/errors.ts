// GENERATED FILE — DO NOT EDIT.
// Source of truth: functions/src/contracts. Run `npm run contracts:sync` from the repo root.

import { z } from 'zod';

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'PROJECT_NOT_FOUND',
  'FILE_NOT_FOUND',
  'SNAPSHOT_NOT_FOUND',
  'GENERATION_NOT_FOUND',
  'GENERATION_IN_PROGRESS',
  'DUPLICATE_REQUEST',
  'FILE_VERSION_CONFLICT',
  'SNAPSHOT_ALREADY_CURRENT',
  'GENERATION_NOT_APPLYABLE',
  'GENERATION_NOT_CANCELLABLE',
  'GENERATION_NOT_AWAITING_SELECTION',
  'CANDIDATE_NOT_FOUND',
  'CANDIDATE_NOT_SELECTABLE',
  'GENERATION_DISABLED',
  'PROJECT_LOCATION_MISMATCH',
  'GENERATION_INVALID_OUTPUT',
  'GENERATION_REFUSED',
  'GENERATION_TRUNCATED',
  'GENERATION_TIMEOUT',
  'GENERATION_INTERRUPTED',
  'CONTEXT_TOO_LARGE',
  'LLM_RATE_LIMITED',
  'LLM_UNAVAILABLE',
  'HL_NOT_CONNECTED',
  'HL_REAUTH_REQUIRED',
  'HL_SCOPE_MISSING',
  'HL_FORBIDDEN',
  'HL_NOT_FOUND',
  'HL_BAD_REQUEST',
  'HL_RATE_LIMITED',
  'HL_UNAVAILABLE',
  'OAUTH_STATE_INVALID',
  'OAUTH_DENIED',
  'OAUTH_EXCHANGE_FAILED',
  'OAUTH_NOT_LOCATION_TOKEN',
  'PREVIEW_LIMIT',
  'PREVIEW_TIMEOUT',
  'RATE_LIMITED',
  'UNKNOWN_METHOD',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export const ErrorCodeSchema = z.enum(ERROR_CODES);

interface ErrorSpec {
  readonly status: number;
  readonly retryable: boolean;
  readonly message: string;
}

export const ERROR_CATALOG: Readonly<Record<ErrorCode, ErrorSpec>> = {
  UNAUTHENTICATED: { status: 401, retryable: false, message: 'Please sign in again.' },
  FORBIDDEN: { status: 403, retryable: false, message: "You don't have access to this." },
  NOT_FOUND: { status: 404, retryable: false, message: 'Not found.' },
  VALIDATION_FAILED: { status: 400, retryable: false, message: 'Some input was invalid.' },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false, message: "That's larger than allowed." },
  PROJECT_NOT_FOUND: { status: 404, retryable: false, message: 'Project not found.' },
  FILE_NOT_FOUND: { status: 404, retryable: false, message: 'File not found.' },
  SNAPSHOT_NOT_FOUND: { status: 404, retryable: false, message: 'History not found.' },
  GENERATION_NOT_FOUND: { status: 404, retryable: false, message: 'Generation not found.' },
  GENERATION_IN_PROGRESS: {
    status: 409,
    retryable: true,
    message: 'A generation is already running for this project.',
  },
  DUPLICATE_REQUEST: {
    status: 409,
    retryable: false,
    message: 'This request was already submitted.',
  },
  FILE_VERSION_CONFLICT: {
    status: 409,
    retryable: false,
    message: 'This file changed since you opened it.',
  },
  SNAPSHOT_ALREADY_CURRENT: {
    status: 409,
    retryable: false,
    message: 'That history point is already the current version.',
  },
  GENERATION_NOT_APPLYABLE: {
    status: 409,
    retryable: false,
    message: "There's nothing to apply from this generation.",
  },
  GENERATION_NOT_CANCELLABLE: {
    status: 409,
    retryable: false,
    message: 'This generation is no longer running.',
  },
  GENERATION_NOT_AWAITING_SELECTION: {
    status: 409,
    retryable: false,
    message: 'There is nothing to choose for this generation.',
  },
  CANDIDATE_NOT_FOUND: { status: 404, retryable: false, message: 'That option was not found.' },
  CANDIDATE_NOT_SELECTABLE: {
    status: 409,
    retryable: false,
    message: 'That option can no longer be chosen.',
  },
  GENERATION_DISABLED: {
    status: 503,
    retryable: false,
    message: 'Generation is temporarily unavailable.',
  },
  PROJECT_LOCATION_MISMATCH: {
    status: 409,
    retryable: false,
    message:
      'This project was built for a different HighLevel location. Reconnect that location or create a new project.',
  },
  GENERATION_INVALID_OUTPUT: {
    status: 422,
    retryable: true,
    message: "The AI response couldn't be used safely.",
  },
  GENERATION_REFUSED: {
    status: 422,
    retryable: false,
    message: 'The AI declined this request. Try rephrasing.',
  },
  GENERATION_TRUNCATED: {
    status: 422,
    retryable: true,
    message: 'The response was cut off before finishing.',
  },
  GENERATION_TIMEOUT: {
    status: 504,
    retryable: true,
    message: 'Generation took too long and was stopped.',
  },
  GENERATION_INTERRUPTED: {
    status: 503,
    retryable: true,
    message: 'The connection was lost during generation.',
  },
  CONTEXT_TOO_LARGE: {
    status: 413,
    retryable: false,
    message: 'The project is too large to send to the AI.',
  },
  LLM_RATE_LIMITED: {
    status: 429,
    retryable: true,
    message: 'The AI service is busy — try again shortly.',
  },
  LLM_UNAVAILABLE: {
    status: 503,
    retryable: true,
    message: 'The AI service is unavailable right now.',
  },
  HL_NOT_CONNECTED: {
    status: 409,
    retryable: false,
    message: 'Connect HighLevel to use live data.',
  },
  HL_REAUTH_REQUIRED: {
    status: 409,
    retryable: false,
    message: 'Your HighLevel connection expired — reconnect.',
  },
  HL_SCOPE_MISSING: {
    status: 403,
    retryable: false,
    message: "Genesis isn't allowed to do that in HighLevel. Reconnect to grant access.",
  },
  HL_FORBIDDEN: { status: 403, retryable: false, message: 'HighLevel refused this request.' },
  HL_NOT_FOUND: { status: 404, retryable: false, message: "That HighLevel record wasn't found." },
  HL_BAD_REQUEST: { status: 422, retryable: false, message: 'HighLevel rejected the request.' },
  HL_RATE_LIMITED: {
    status: 429,
    retryable: true,
    message: 'HighLevel is rate limiting requests — try again shortly.',
  },
  HL_UNAVAILABLE: { status: 502, retryable: true, message: 'HighLevel is unavailable right now.' },
  OAUTH_STATE_INVALID: {
    status: 400,
    retryable: false,
    message: 'The connection link expired. Please try again.',
  },
  OAUTH_DENIED: { status: 400, retryable: false, message: 'Connection was cancelled.' },
  OAUTH_EXCHANGE_FAILED: {
    status: 502,
    retryable: true,
    message: "HighLevel didn't accept the connection. Please try again.",
  },
  OAUTH_NOT_LOCATION_TOKEN: {
    status: 400,
    retryable: false,
    message: 'Please choose a sub-account (location), not an agency.',
  },
  PREVIEW_LIMIT: {
    status: 429,
    retryable: true,
    message: 'Too many HighLevel calls from the preview.',
  },
  PREVIEW_TIMEOUT: { status: 504, retryable: true, message: 'HighLevel call timed out.' },
  RATE_LIMITED: {
    status: 429,
    retryable: true,
    message: 'Too many requests — try again shortly.',
  },
  UNKNOWN_METHOD: { status: 400, retryable: false, message: 'Unknown SDK method.' },
  INTERNAL: { status: 500, retryable: true, message: 'Something went wrong. Please try again.' },
};

export const httpStatusFor = (code: ErrorCode): number => ERROR_CATALOG[code].status;
export const isRetryable = (code: ErrorCode): boolean => ERROR_CATALOG[code].retryable;
export const defaultMessage = (code: ErrorCode): string => ERROR_CATALOG[code].message;

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
