import { ApiErrorBodySchema, defaultMessage, type ErrorCode } from '@/contracts/errors';

export type ApiTarget = 'api' | 'generate';
/** Server codes plus client-only transport failures. */
export type ClientErrorCode = ErrorCode | 'NETWORK' | 'TIMEOUT' | 'ABORTED';

export interface ApiErrorInit {
  code: ClientErrorCode;
  message: string;
  status: number;
  retryable: boolean;
  details?: Record<string, unknown> | undefined;
  requestId?: string | null;
}

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
  readonly requestId: string | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable;
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export interface HttpConfig {
  baseUrls: Readonly<Record<ApiTarget, string>>;
  getIdToken: () => Promise<string | null>;
}

let config: HttpConfig | null = null;

/** Called once from main.ts (and from tests) — keeps this module free of Firebase imports. */
export function configureHttp(next: HttpConfig): void {
  config = next;
}

function currentConfig(): HttpConfig {
  if (!config) throw new Error('HTTP client is not configured; call configureHttp() first.');
  return config;
}

export type QueryParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

export function apiUrl(target: ApiTarget, path: string, query?: QueryParams): string {
  const url = new URL(currentConfig().baseUrls[target] + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function authorizedHeaders(): Promise<Record<string, string>> {
  const token = await currentConfig().getIdToken();
  if (!token) {
    throw new ApiError({
      code: 'UNAUTHENTICATED',
      message: defaultMessage('UNAUTHENTICATED'),
      status: 401,
      retryable: false,
    });
  }
  return { Authorization: `Bearer ${token}`, 'X-Request-Id': crypto.randomUUID() };
}

/** AbortSignal.any() without requiring the newest browsers. */
export function combineSignals(signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export function toTransportError(error: unknown, callerSignal?: AbortSignal): ApiError {
  if (isApiError(error)) return error;
  if (callerSignal?.aborted) {
    return new ApiError({
      code: 'ABORTED',
      message: 'Request cancelled.',
      status: 0,
      retryable: false,
    });
  }
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (name === 'TimeoutError') {
    return new ApiError({
      code: 'TIMEOUT',
      message: 'The request took too long. Please try again.',
      status: 0,
      retryable: true,
    });
  }
  return new ApiError({
    code: 'NETWORK',
    message: 'Network error — check your connection.',
    status: 0,
    retryable: true,
  });
}

export async function parseErrorResponse(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ApiErrorBodySchema.safeParse(body);
  if (parsed.success) {
    const e = parsed.data.error;
    return new ApiError({
      code: e.code,
      message: e.message,
      status: res.status,
      retryable: e.retryable,
      details: e.details,
      requestId: e.requestId,
    });
  }
  return new ApiError({
    code: 'INTERNAL',
    message: defaultMessage('INTERNAL'),
    status: res.status,
    retryable: res.status >= 500 || res.status === 429,
    requestId: res.headers.get('x-request-id'),
  });
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** JSON request against the `api`/`generate` functions; resolves `data`, throws `ApiError`. */
export async function apiFetch<T>(
  target: ApiTarget,
  path: string,
  req: ApiRequest = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(await authorizedHeaders()),
    Accept: 'application/json',
  };
  if (req.body !== undefined) headers['Content-Type'] = 'application/json';
  const signal = combineSignals([
    req.signal,
    AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  ]);

  let res: Response;
  try {
    res = await fetch(apiUrl(target, path, req.query), {
      method: req.method ?? 'GET',
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    throw toTransportError(error, req.signal);
  }
  if (!res.ok) throw await parseErrorResponse(res);

  const json: unknown = await res.json().catch(() => null);
  if (json === null || typeof json !== 'object' || !('data' in json)) {
    throw new ApiError({
      code: 'INTERNAL',
      message: defaultMessage('INTERNAL'),
      status: res.status,
      retryable: true,
      requestId: res.headers.get('x-request-id'),
    });
  }
  return (json as { data: T }).data;
}
