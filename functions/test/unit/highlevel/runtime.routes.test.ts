import request from 'supertest';
import { createHttpApp } from '../../../src/http/create-http-app.js';
import { runtimeRouter } from '../../../src/modules/highlevel/runtime/runtime.routes.js';
import { fakeLogger } from '../../helpers/fakes.js';

const makeInvoke = () =>
  vi.fn((_uid: string, _projectId: string, _method: string, _raw: unknown, _log: unknown) =>
    Promise.resolve<unknown>({ ok: true }),
  );

function app(invoke = makeInvoke()) {
  return {
    invoke,
    app: createHttpApp({
      service: 'api',
      version: 't',
      allowedOrigins: [],
      logger: fakeLogger(),
      verifyIdToken: () => Promise.resolve({ uid: 'u1' }),
      authedRouters: [runtimeRouter({ invoke })],
    }),
  };
}

describe('runtime routes', () => {
  it('merges path params and query for GET', async () => {
    const t = app();
    const res = await request(t.app)
      .get('/v1/projects/p1/hl/conversations/v9/messages?limit=5')
      .set('Authorization', 'Bearer x');
    expect(res.body).toEqual({ data: { ok: true } });
    expect(t.invoke).toHaveBeenCalledWith(
      'u1',
      'p1',
      'conversations.messages',
      { limit: '5', conversationId: 'v9' },
      expect.anything(),
    );
  });
  it('registers the seven read methods, including calendars/events', async () => {
    const t = app();
    await request(t.app)
      .get('/v1/projects/p1/hl/contacts?limit=20')
      .set('Authorization', 'Bearer x');
    await request(t.app)
      .get('/v1/projects/p1/hl/calendars/events?from=2026-10-01T00:00:00Z&to=2026-10-08T00:00:00Z')
      .set('Authorization', 'Bearer x');
    expect(t.invoke.mock.calls.map((c) => c[2])).toEqual(['contacts.list', 'calendars.events']);
  });
});
