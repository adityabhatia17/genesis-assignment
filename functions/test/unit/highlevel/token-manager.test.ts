import { randomBytes } from 'node:crypto';
import { createTokenCipher } from '../../../src/modules/highlevel/connection/token-cipher.js';
import { TokenManager } from '../../../src/modules/highlevel/connection/token-manager.js';
import {
  TokenEndpointError,
  type TokenEndpointClient,
} from '../../../src/modules/highlevel/oauth/token-endpoint.client.js';
import { AppError } from '../../../src/shared/app-error.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { fakeLogger, InMemoryConnectionRepo } from '../../helpers/fakes.js';

const NOW = 1_800_000_000_000;
const cipher = createTokenCipher(randomBytes(32).toString('base64'));

function setup(opts: {
  expiresInMs: number;
  source?: 'oauth' | 'pit';
  refresh?: TokenEndpointClient['refresh'];
}) {
  const repo = new InMemoryConnectionRepo();
  const clock = createFakeClock(NOW);
  let n = 0;
  const refresh = vi.fn(
    opts.refresh ??
      (async () => {
        n += 1;
        await Promise.resolve();
        return { access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 86_399, scope: '' };
      }),
  );
  const tokens: TokenEndpointClient = {
    exchangeCode: () => Promise.reject(new Error('unused')),
    refresh,
  };
  void repo.saveNewConnection({
    uid: 'u',
    source: opts.source ?? 'oauth',
    locationId: 'loc',
    companyId: null,
    hlUserId: null,
    scopes: ['contacts.readonly'],
    accessToken: cipher.encrypt('a0', 'u', 'access'),
    refreshToken: cipher.encrypt('r0', 'u', 'refresh'),
    expiresAtMs: NOW + opts.expiresInMs,
    locationName: 'X',
    timezone: null,
    nowMs: NOW,
  });
  const make = () =>
    new TokenManager({
      repo,
      tokens,
      cipher,
      clock,
      logger: fakeLogger(),
      sleep: () => Promise.resolve(),
    });
  return { repo, refresh, make, clock };
}

describe('TokenManager', () => {
  it('returns a fresh token without refreshing', async () => {
    const s = setup({ expiresInMs: 3_600_000 });
    expect((await s.make().getAccessGrant('u')).accessToken).toBe('a0');
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('refreshes near expiry and stores rotated tokens encrypted', async () => {
    const s = setup({ expiresInMs: 60_000 });
    const g = await s.make().getAccessGrant('u');
    expect(g.accessToken).toBe('a1');
    const stored = await s.repo.get('u');
    expect(cipher.decrypt(stored!.refreshToken!, 'u', 'refresh')).toBe('r1');
    expect(stored!.refreshLock).toBeNull();
  });

  it('single-flights concurrent callers in one instance', async () => {
    const s = setup({ expiresInMs: 60_000 });
    const tm = s.make();
    const grants = await Promise.all(Array.from({ length: 5 }, () => tm.getAccessGrant('u')));
    expect(new Set(grants.map((g) => g.accessToken))).toEqual(new Set(['a1']));
    expect(s.refresh).toHaveBeenCalledTimes(1);
  });

  it('uses the lease across instances (two managers, one refresh)', async () => {
    const s = setup({ expiresInMs: 60_000 });
    const [g1, g2] = await Promise.all([
      s.make().getAccessGrant('u'),
      s.make().getAccessGrant('u'),
    ]);
    expect(g1.accessToken).toBe('a1');
    expect(g2.accessToken).toBe('a1');
    expect(s.refresh).toHaveBeenCalledTimes(1);
  });

  it('marks reauth on invalid grant', async () => {
    const s = setup({
      expiresInMs: 60_000,
      refresh: () => Promise.reject(new TokenEndpointError(401, 'invalid_grant')),
    });
    await expect(s.make().getAccessGrant('u')).rejects.toMatchObject({
      code: 'HL_REAUTH_REQUIRED',
    });
    expect((await s.repo.get('u'))?.status).toBe('reauth_required');
    expect((await s.repo.getProjection('u'))?.status).toBe('reauth_required');
  });

  it('releases the lease on transient errors and surfaces HL_UNAVAILABLE', async () => {
    const s = setup({
      expiresInMs: 60_000,
      refresh: () => Promise.reject(new TokenEndpointError(503, null)),
    });
    await expect(s.make().getAccessGrant('u')).rejects.toBeInstanceOf(AppError);
    expect((await s.repo.get('u'))?.refreshLock).toBeNull();
    expect((await s.repo.get('u'))?.status).toBe('connected');
  });

  it('never refreshes PIT connections', async () => {
    const s = setup({ expiresInMs: -1_000, source: 'pit' });
    expect((await s.make().getAccessGrant('u')).accessToken).toBe('a0');
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('reports not connected / reauth', async () => {
    const s = setup({ expiresInMs: 3_600_000 });
    await expect(s.make().getAccessGrant('nobody')).rejects.toMatchObject({
      code: 'HL_NOT_CONNECTED',
    });
    await s.repo.markReauthRequired('u', 'test', NOW);
    await expect(s.make().getAccessGrant('u')).rejects.toMatchObject({
      code: 'HL_REAUTH_REQUIRED',
    });
  });

  it('forceRefresh skips when someone already refreshed past the stale expiry', async () => {
    const s = setup({ expiresInMs: 3_600_000 });
    const g = await s.make().forceRefresh('u', NOW - 1);
    expect(g.accessToken).toBe('a0');
    expect(s.refresh).not.toHaveBeenCalled();
  });
});
