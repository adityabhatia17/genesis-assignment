import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createHttpApp } from '../../../src/http/create-http-app.js';
import { filesRouter } from '../../../src/modules/files/files.routes.js';
import { generationRouter } from '../../../src/modules/generation/generate.app.js';
import type { GenerationOrchestrator } from '../../../src/modules/generation/orchestrator.js';
import type { FileSaveService } from '../../../src/modules/files/file-save.service.js';
import { oauthAuthedRouter } from '../../../src/modules/highlevel/oauth/oauth.routes.js';
import type { OAuthService } from '../../../src/modules/highlevel/oauth/oauth.service.js';
import { RATE_LIMITS, MemoryRateLimiter } from '../../../src/modules/rate-limit/rate-limiter.js';
import { snapshotsRouter } from '../../../src/modules/snapshots/snapshots.routes.js';
import type { RestoreService } from '../../../src/modules/snapshots/restore.service.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { fakeLogger } from '../../helpers/fakes.js';

const FILE_ID = 'a'.repeat(20);

function appFor(routers: Parameters<typeof createHttpApp>[0]['authedRouters']) {
  return createHttpApp({
    service: 'api',
    version: 't',
    allowedOrigins: [],
    logger: fakeLogger(),
    verifyIdToken: (token) => Promise.resolve({ uid: token }),
    authedRouters: routers,
  });
}

function generationApp(opts: {
  limiter: MemoryRateLimiter;
  enabled?: boolean;
  cap?: number;
  run?: ReturnType<typeof vi.fn>;
}) {
  const run =
    opts.run ??
    vi.fn(
      async (
        _req: unknown,
        res: { status: (code: number) => { json: (body: unknown) => void } },
      ) => {
        res.status(200).json({ data: { ok: true } });
      },
    );
  const app = appFor([
    generationRouter({
      orchestrator: { run } as unknown as GenerationOrchestrator,
      limiter: opts.limiter,
      generationEnabled: opts.enabled ?? true,
      generationDailyGlobalCap: opts.cap ?? 200,
    }),
  ]);
  return { app, run };
}

const auth = (uid: string) => ({ Authorization: `Bearer ${uid}` });
const generationBody = () => ({ clientRequestId: randomUUID(), prompt: 'Build a dashboard' });

async function postGeneration(
  app: ReturnType<typeof appFor>,
  uid: string,
  body: Record<string, unknown> = generationBody(),
) {
  return request(app).post('/v1/projects/p1/generations').set(auth(uid)).send(body);
}

describe('endpoint rate limits', () => {
  it('stops the 11th generation in the window and tells the client when to retry', async () => {
    const { app, run } = generationApp({ limiter: new MemoryRateLimiter(createFakeClock(0)) });
    for (let i = 0; i < RATE_LIMITS.generation.limit; i++) {
      const ok = await postGeneration(app, 'u1');
      expect(ok.status).toBe(200);
    }
    const blocked = await postGeneration(app, 'u1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      message: 'Too many requests — try again shortly.',
      details: { retryAfterMs: 600_000 },
    });
    expect(blocked.headers['retry-after']).toBe('600');
    expect(run).toHaveBeenCalledTimes(RATE_LIMITS.generation.limit);
  });

  it('spends a generation slot on a body the handler will reject', async () => {
    const { app, run } = generationApp({ limiter: new MemoryRateLimiter(createFakeClock(0)) });
    for (let i = 0; i < RATE_LIMITS.generation.limit; i++) {
      const bad = await postGeneration(app, 'u1', { prompt: '' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    }
    const blocked = await postGeneration(app, 'u1');
    expect(blocked.status).toBe(429);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not spend a slot when generation is switched off', async () => {
    const limiter = new MemoryRateLimiter(createFakeClock(0));
    const off = generationApp({ limiter, enabled: false });
    const disabled = await postGeneration(off.app, 'u1');
    expect(disabled.status).toBe(503);
    expect(disabled.body.error.code).toBe('GENERATION_DISABLED');
    expect(disabled.body.error.retryable).toBe(false);
    expect(off.run).not.toHaveBeenCalled();

    const on = generationApp({ limiter, enabled: true });
    const allowed = await postGeneration(on.app, 'u1');
    expect(allowed.status).toBe(200);
    expect(on.run).toHaveBeenCalledTimes(1);
  });

  it('applies the global daily cap across users', async () => {
    const { app, run } = generationApp({
      limiter: new MemoryRateLimiter(createFakeClock(0)),
      cap: 1,
    });
    expect((await postGeneration(app, 'alice')).status).toBe(200);
    const blocked = await postGeneration(app, 'bob');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.body.error.details.retryAfterMs).toBe(86_400_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('allows five OAuth starts per minute and blocks the sixth before the service', async () => {
    const start = vi.fn(async () => ({ authorizeUrl: 'https://example.test/authorize' }));
    const app = appFor([
      oauthAuthedRouter(
        { start } as unknown as OAuthService,
        new MemoryRateLimiter(createFakeClock(0)),
      ),
    ]);
    for (let i = 0; i < RATE_LIMITS.oauthStart.limit; i++) {
      const ok = await request(app).post('/v1/hl/oauth/start').set(auth('u1')).send({});
      expect(ok.status).toBe(200);
    }
    const blocked = await request(app).post('/v1/hl/oauth/start').set(auth('u1')).send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(start).toHaveBeenCalledTimes(RATE_LIMITS.oauthStart.limit);
  });

  it('allows sixty saves per minute and blocks the next one', async () => {
    const save = vi.fn(async () => ({ fileId: FILE_ID, path: 'app.js', version: 2, sizeBytes: 1 }));
    const app = appFor([
      filesRouter(
        { save } as unknown as FileSaveService,
        new MemoryRateLimiter(createFakeClock(0)),
      ),
    ]);
    const body = { content: 'x', expectedVersion: 1 };
    for (let i = 0; i < RATE_LIMITS.fileSave.limit; i++) {
      const ok = await request(app)
        .put(`/v1/projects/p1/files/${FILE_ID}`)
        .set(auth('u1'))
        .send(body);
      expect(ok.status).toBe(200);
    }
    const blocked = await request(app)
      .put(`/v1/projects/p1/files/${FILE_ID}`)
      .set(auth('u1'))
      .send(body);
    expect(blocked.status).toBe(429);
    expect(save).toHaveBeenCalledTimes(RATE_LIMITS.fileSave.limit);
  });

  it('allows ten restores per ten minutes and blocks the next one', async () => {
    const restore = vi.fn(async () => ({ snapshotId: 's2', snapshotSeq: 2 }));
    const app = appFor([
      snapshotsRouter(
        { restore } as unknown as RestoreService,
        new MemoryRateLimiter(createFakeClock(0)),
      ),
    ]);
    for (let i = 0; i < RATE_LIMITS.snapshotRestore.limit; i++) {
      const ok = await request(app).post('/v1/projects/p1/snapshots/s1/restore').set(auth('u1'));
      expect(ok.status).toBe(200);
    }
    const blocked = await request(app).post('/v1/projects/p1/snapshots/s1/restore').set(auth('u1'));
    expect(blocked.status).toBe(429);
    expect(restore).toHaveBeenCalledTimes(RATE_LIMITS.snapshotRestore.limit);
  });
});
