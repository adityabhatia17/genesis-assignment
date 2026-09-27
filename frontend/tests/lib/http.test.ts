import { ApiError, apiFetch, apiUrl, configureHttp, isApiError } from '@/lib/http';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('http client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    configureHttp({
      baseUrls: { api: 'https://fn.test/api', generate: 'https://fn.test/generate' },
      getIdToken: () => Promise.resolve('token-1'),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('builds URLs and drops empty query values', () => {
    expect(apiUrl('api', '/v1/x', { a: 1, b: undefined, c: null, d: 'y' })).toBe(
      'https://fn.test/api/v1/x?a=1&d=y',
    );
  });

  it('sends the ID token and returns data', async () => {
    fetchMock.mockResolvedValue(json(200, { data: { ok: true } }));
    await expect(
      apiFetch('api', '/v1/health', { method: 'POST', body: { a: 1 } }),
    ).resolves.toEqual({
      ok: true,
    });
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token-1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init?.body).toBe('{"a":1}');
  });

  it('maps the error envelope to ApiError', async () => {
    fetchMock.mockResolvedValue(
      json(409, {
        error: {
          code: 'FILE_VERSION_CONFLICT',
          message: 'Changed',
          retryable: false,
          details: { currentVersion: 3 },
          requestId: 'r1',
        },
      }),
    );
    const error = await apiFetch('api', '/v1/x').catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'FILE_VERSION_CONFLICT',
      status: 409,
      details: { currentVersion: 3 },
      requestId: 'r1',
    });
  });

  it('turns non-envelope failures into INTERNAL and network failures into NETWORK', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 502 }));
    await expect(apiFetch('api', '/v1/x')).rejects.toMatchObject({
      code: 'INTERNAL',
      retryable: true,
    });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(apiFetch('api', '/v1/x')).rejects.toMatchObject({
      code: 'NETWORK',
      retryable: true,
    });
  });

  it('refuses to call without a session', async () => {
    configureHttp({
      baseUrls: { api: 'https://fn.test/api', generate: '' },
      getIdToken: () => Promise.resolve(null),
    });
    await expect(apiFetch('api', '/v1/x')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
