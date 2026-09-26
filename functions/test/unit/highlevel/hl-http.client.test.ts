import { createHlHttpClient } from '../../../src/modules/highlevel/client/hl-http.client.js';
import { HlApiError } from '../../../src/modules/highlevel/client/hl-errors.js';
import { fakeLogger } from '../../helpers/fakes.js';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
function scripted(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = replies.shift() ?? { status: 500 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers,
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe('hl http client', () => {
  it('sends bearer, Version and JSON body; drops undefined query values', async () => {
    const s = scripted([{ status: 200, body: { ok: 1 } }]);
    const hl = createHlHttpClient({
      baseUrl: 'https://hl.test',
      logger: fakeLogger(),
      fetchImpl: s.impl,
      sleep: async () => {},
    });
    await hl.request({
      method: 'POST',
      path: '/contacts/search',
      version: '2021-07-28',
      query: { a: 1, b: undefined },
      body: { x: 1 },
      accessToken: 'tok',
      locationId: 'loc',
    });
    const { url, init } = s.calls[0]!;
    expect(url).toBe('https://hl.test/contacts/search?a=1');
    const h = new Headers(init.headers);
    expect(h.get('authorization')).toBe('Bearer tok');
    expect(h.get('version')).toBe('2021-07-28');
    expect(h.get('content-type')).toBe('application/json');
    expect(init.body).toBe('{"x":1}');
  });
  it('retries GET on 429 honoring Retry-After, then succeeds', async () => {
    const s = scripted([
      { status: 429, headers: { 'retry-after': '1' } },
      { status: 200, body: { ok: 1 } },
    ]);
    const sleeps: number[] = [];
    const hl = createHlHttpClient({
      baseUrl: 'https://hl.test',
      logger: fakeLogger(),
      fetchImpl: s.impl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await expect(
      hl.request({
        method: 'GET',
        path: '/calendars/',
        version: '2021-04-15',
        accessToken: 't',
        locationId: 'l',
      }),
    ).resolves.toEqual({ ok: 1 });
    expect(sleeps).toEqual([1000]);
  });
  it('does not retry POST after a 5xx', async () => {
    const s = scripted([
      { status: 502, body: { message: 'bad gateway' } },
      { status: 200, body: {} },
    ]);
    const hl = createHlHttpClient({
      baseUrl: 'https://hl.test',
      logger: fakeLogger(),
      fetchImpl: s.impl,
      sleep: async () => {},
    });
    await expect(
      hl.request({
        method: 'POST',
        path: '/contacts/',
        version: '2021-07-28',
        body: {},
        accessToken: 't',
        locationId: 'l',
      }),
    ).rejects.toBeInstanceOf(HlApiError);
    expect(s.calls).toHaveLength(1);
  });
  it('raises HlApiError with status and trace id', async () => {
    const s = scripted([{ status: 404, body: { message: 'Contact not found', traceId: 'tr-1' } }]);
    const hl = createHlHttpClient({
      baseUrl: 'https://hl.test',
      logger: fakeLogger(),
      fetchImpl: s.impl,
      sleep: async () => {},
    });
    const err = await hl
      .request({
        method: 'GET',
        path: '/contacts/x',
        version: '2021-07-28',
        accessToken: 't',
        locationId: 'l',
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 404, traceId: 'tr-1' });
  });
});
