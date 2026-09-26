import type { HlHttp, HlRequest } from '../../src/modules/highlevel/client/hl-http.client.js';
import type { HlCallContext } from '../../src/modules/highlevel/adapters/context.js';

export function fakeHl(route: (req: HlRequest) => unknown) {
  const calls: HlRequest[] = [];
  const hl: HlHttp = {
    request: (req) => {
      calls.push(req);
      return Promise.resolve(route(req));
    },
  };
  const ctx: HlCallContext = {
    hl,
    accessToken: 'tok',
    locationId: 'loc_1',
    loadProjection: () =>
      Promise.resolve({
        status: 'connected',
        locationId: 'loc_1',
        locationName: 'Demo Clinic',
        timezone: 'America/New_York',
        scopes: [],
      }),
  };
  return { ctx, calls };
}
