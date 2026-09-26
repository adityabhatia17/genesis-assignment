import { RUNTIME_METHODS, pathParamNames, type RuntimeMethodName } from '@/contracts/hl-runtime';
import { apiFetch, type QueryParams } from '@/lib/http';

export interface RuntimeRequest {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  query?: QueryParams;
  body?: Record<string, unknown>;
}

/** Maps a runtime SDK call onto its REST route (07 §3.1 A5–A15) using the shared manifest. */
export function buildRuntimeRequest(
  projectId: string,
  method: RuntimeMethodName,
  params: Readonly<Record<string, unknown>>,
): RuntimeRequest {
  const spec = RUNTIME_METHODS[method];
  const rest: Record<string, unknown> = { ...params };
  let path: string = spec.path;
  for (const name of pathParamNames(spec.path)) {
    const value = rest[name];
    if (typeof value !== 'string' || value === '')
      throw new Error(`Missing path parameter "${name}" for ${method}`);
    path = path.replace(`:${name}`, encodeURIComponent(value));
    delete rest[name];
  }
  const url = `/v1/projects/${encodeURIComponent(projectId)}${path}`;
  if (spec.verb === 'GET') {
    const query: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        query[key] = value;
    }
    return { method: 'GET', path: url, query };
  }
  return { method: spec.verb, path: url, body: rest };
}

export function invokeRuntime(
  projectId: string,
  method: RuntimeMethodName,
  params: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<unknown> {
  const req = buildRuntimeRequest(projectId, method, params);
  return apiFetch<unknown>('api', req.path, {
    method: req.method,
    query: req.query,
    body: req.body,
    signal,
  });
}
