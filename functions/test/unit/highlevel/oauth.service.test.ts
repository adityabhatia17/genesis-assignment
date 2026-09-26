import { randomBytes } from 'node:crypto';
import { OAuthService } from '../../../src/modules/highlevel/oauth/oauth.service.js';
import { createTokenCipher } from '../../../src/modules/highlevel/connection/token-cipher.js';
import type { TokenEndpointClient } from '../../../src/modules/highlevel/oauth/token-endpoint.client.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { fakeLogger, InMemoryConnectionRepo, InMemoryOAuthStateRepo } from '../../helpers/fakes.js';

const config = {
  appBaseUrl: 'https://app.test',
  hlRedirectUri: 'https://fn.test/api/v1/hl/oauth/callback',
  hlScopes: ['contacts.readonly', 'locations.readonly'],
  hlAuthorizeUrl: 'https://marketplace.gohighlevel.com/v2/oauth/chooselocation',
};

function setup(
  token: Partial<Awaited<ReturnType<TokenEndpointClient['exchangeCode']>>> = {},
  failExchange = false,
) {
  const states = new InMemoryOAuthStateRepo();
  const connections = new InMemoryConnectionRepo();
  const clock = createFakeClock(1_800_000_000_000);
  const tokens: TokenEndpointClient = {
    exchangeCode: () =>
      failExchange
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({
            access_token: 'acc',
            refresh_token: 'ref',
            expires_in: 86399,
            scope: 'contacts.readonly locations.readonly',
            userType: 'Location',
            locationId: 'loc_1',
            companyId: 'co',
            userId: 'hlu',
            ...token,
          }),
    refresh: () => Promise.reject(new Error('unused')),
  };
  const service = new OAuthService({
    config,
    clientId: 'cid',
    states,
    tokens,
    connections,
    clock,
    logger: fakeLogger(),
    cipher: createTokenCipher(randomBytes(32).toString('base64')),
    locations: {
      getLocation: () => Promise.resolve({ name: 'Demo Clinic', timezone: 'America/New_York' }),
    },
  });
  return { service, states, connections, clock };
}

const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get('state') ?? '';

describe('OAuthService', () => {
  it('builds the authorize URL', async () => {
    const { service } = setup();
    const { authorizeUrl } = await service.start('u1');
    const u = new URL(authorizeUrl);
    expect(u.origin + u.pathname).toBe(
      'https://marketplace.gohighlevel.com/v2/oauth/chooselocation',
    );
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'cid',
      redirect_uri: config.hlRedirectUri,
      scope: 'contacts.readonly locations.readonly',
      loginWindowOpenMode: 'self',
    });
    expect(stateOf(authorizeUrl)).toHaveLength(43);
  });

  it('connects on a valid callback and redirects with hl=connected', async () => {
    const { service, connections } = setup();
    const state = stateOf((await service.start('u1')).authorizeUrl);
    const redirect = await service.handleCallback({ code: 'c', state });
    expect(redirect).toBe('https://app.test/dashboard?hl=connected');
    expect((await connections.get('u1'))?.locationId).toBe('loc_1');
    expect((await connections.getProjection('u1'))?.locationName).toBe('Demo Clinic');
  });

  it('rejects reused, unknown or missing state', async () => {
    const { service } = setup();
    const state = stateOf((await service.start('u1')).authorizeUrl);
    await service.handleCallback({ code: 'c', state });
    expect(await service.handleCallback({ code: 'c', state })).toContain('reason=state_invalid');
    expect(await service.handleCallback({ code: 'c', state: 'nope' })).toContain(
      'reason=state_invalid',
    );
    expect(await service.handleCallback({ code: 'c' })).toContain('reason=state_invalid');
  });

  it('maps denial, exchange failure and agency tokens', async () => {
    let s = setup();
    let state = stateOf((await s.service.start('u1')).authorizeUrl);
    expect(await s.service.handleCallback({ state, error: 'access_denied' })).toContain(
      'reason=denied',
    );
    s = setup({}, true);
    state = stateOf((await s.service.start('u1')).authorizeUrl);
    expect(await s.service.handleCallback({ code: 'c', state })).toContain(
      'reason=exchange_failed',
    );
    s = setup({ userType: 'Company', locationId: undefined });
    state = stateOf((await s.service.start('u1')).authorizeUrl);
    expect(await s.service.handleCallback({ code: 'c', state })).toContain(
      'reason=not_location_token',
    );
  });
});
