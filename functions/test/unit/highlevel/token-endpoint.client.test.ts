import {
  createTokenEndpointClient,
  TokenEndpointError,
} from '../../../src/modules/highlevel/oauth/token-endpoint.client.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const opts = {
  baseUrl: 'https://hl.test',
  clientId: 'cid',
  clientSecret: 'csecret',
  redirectUri: 'https://app/cb',
};

describe('token endpoint client', () => {
  it('exchanges a code with a form-urlencoded body', async () => {
    const f = fakeFetch(200, {
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 86399,
      scope: 'contacts.readonly',
      userType: 'Location',
      locationId: 'loc',
    });
    const client = createTokenEndpointClient({ ...opts, fetchImpl: f.impl });
    const out = await client.exchangeCode('code123');
    expect(out.locationId).toBe('loc');
    const call = f.calls[0]!;
    expect(call.url).toBe('https://hl.test/oauth/token');
    expect(new Headers(call.init.headers).get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(typeof call.init.body).toBe('string');
    const form = new URLSearchParams(call.init.body as string);
    expect(Object.fromEntries(form)).toEqual({
      client_id: 'cid',
      client_secret: 'csecret',
      grant_type: 'authorization_code',
      code: 'code123',
      user_type: 'Location',
      redirect_uri: 'https://app/cb',
    });
  });
  it('refreshes with grant_type=refresh_token', async () => {
    const f = fakeFetch(200, { access_token: 'a2', refresh_token: 'r2', expires_in: 86399 });
    await createTokenEndpointClient({ ...opts, fetchImpl: f.impl }).refresh('r1');
    const refreshBody = f.calls[0]!.init.body;
    expect(typeof refreshBody).toBe('string');
    expect(new URLSearchParams(refreshBody as string).get('grant_type')).toBe('refresh_token');
  });
  it('raises TokenEndpointError flagged as invalid grant on 400/401', async () => {
    const f = fakeFetch(401, {
      error: 'invalid_grant',
      error_description: 'Invalid refresh token',
    });
    const err = await createTokenEndpointClient({ ...opts, fetchImpl: f.impl })
      .refresh('old')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenEndpointError);
    expect((err as TokenEndpointError).isInvalidGrant).toBe(true);
    expect(JSON.stringify(err)).not.toContain('old');
  });
});
