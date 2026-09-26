import { LocationContextService } from '../../../src/modules/highlevel/metadata/location-context.service.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { fakeLogger, InMemoryConnectionRepo } from '../../helpers/fakes.js';

function setup(
  route: (path: string) => unknown,
  status: 'connected' | 'reauth_required' = 'connected',
) {
  const connections = new InMemoryConnectionRepo();
  connections.projections.set('u', {
    status,
    locationId: 'loc',
    locationName: 'Demo Clinic',
    timezone: 'America/New_York',
    scopes: [],
  });
  const request = vi.fn((req: { path: string }) => Promise.resolve(route(req.path)));
  const svc = new LocationContextService({
    connections,
    tokens: {
      getAccessGrant: () =>
        Promise.resolve({
          accessToken: 't',
          locationId: 'loc',
          expiresAtMs: 0,
          scopes: ['calendars.readonly', 'contacts.readonly'],
        }),
    },
    hl: { request },
    clock: createFakeClock(0),
    logger: fakeLogger(),
  });
  return { svc, request };
}

describe('LocationContextService', () => {
  it('returns metadata only (names, counts, methods)', async () => {
    const { svc } = setup((p) =>
      p === '/calendars/'
        ? { calendars: [{ id: 'k1', name: 'Consultations' }] }
        : { contacts: [], total: 36 },
    );
    const ctx = await svc.getContext('u');
    expect(ctx).toMatchObject({
      status: 'connected',
      locationName: 'Demo Clinic',
      calendars: ['Consultations'],
      contactsTotal: 36,
      note: null,
    });
    expect(ctx.availableMethods).toEqual(
      expect.arrayContaining(['contacts.list', 'calendars.list']),
    );
    expect(ctx.availableMethods).not.toContain('calendars.events');
  });
  it('caches per location', async () => {
    const { svc, request } = setup(() => ({ calendars: [], contacts: [], total: 0 }));
    await svc.getContext('u');
    await svc.getContext('u');
    expect(request).toHaveBeenCalledTimes(2); // calendars + count, once
  });
  it('degrades gracefully', async () => {
    const { svc } = setup(() => {
      throw new Error('down');
    });
    expect((await svc.getContext('u')).note).toMatch(/unavailable/);
  });
  it('reports not connected', async () => {
    const { svc } = setup(() => ({}), 'reauth_required');
    expect((await svc.getContext('u')).status).toBe('reauth_required');
  });
});
