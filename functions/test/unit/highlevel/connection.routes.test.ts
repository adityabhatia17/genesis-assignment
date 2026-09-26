import request from 'supertest';
import { createHttpApp } from '../../../src/http/create-http-app.js';
import { connectionRouter } from '../../../src/modules/highlevel/connection/connection.routes.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { fakeLogger, InMemoryConnectionRepo } from '../../helpers/fakes.js';

it('disconnects the caller only', async () => {
  const repo = new InMemoryConnectionRepo();
  repo.projections.set('u1', {
    status: 'connected',
    locationId: 'l',
    locationName: 'n',
    timezone: null,
    scopes: [],
  });
  const app = createHttpApp({
    service: 'api',
    version: 't',
    allowedOrigins: [],
    logger: fakeLogger(),
    verifyIdToken: () => Promise.resolve({ uid: 'u1' }),
    authedRouters: [connectionRouter(repo, createFakeClock(0))],
  });
  const res = await request(app).delete('/v1/hl/connection').set('Authorization', 'Bearer t');
  expect(res.body).toEqual({ data: { status: 'disconnected' } });
  expect((await repo.getProjection('u1'))?.status).toBe('disconnected');
});
