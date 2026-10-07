import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Timestamp } from 'firebase-admin/firestore';
import request from 'supertest';
import { createHttpApp } from '../../src/http/create-http-app.js';
import { ContextBuilder } from '../../src/modules/generation/context/context-builder.js';
import { generationRouter } from '../../src/modules/generation/generate.app.js';
import { MemoryRateLimiter } from '../../src/modules/rate-limit/rate-limiter.js';
import { CandidateRunner } from '../../src/modules/generation/candidate/candidate-runner.js';
import { FakeProvider } from '../../src/modules/generation/llm/fake.provider.js';
import { GenerationOrchestrator } from '../../src/modules/generation/orchestrator.js';
import { CommitService } from '../../src/modules/generation/persistence/commit.service.js';
import { GenerationsRepo } from '../../src/modules/generation/persistence/generations.repo.js';
import { generationControlRouter } from '../../src/modules/generation/routes/generation-control.routes.js';
import { BlobsRepo } from '../../src/modules/snapshots/blobs.repo.js';
import { systemClock } from '../../src/shared/clock.js';
import { firestore } from '../../src/shared/firebase-admin.js';
import { fakeLogger } from './fakes.js';
import { parseSse } from './parse-sse.js';

export const db = firestore();

/** Drops a project's tree so scenario ids can be reused against a long-lived emulator. */
export async function wipeProject(uid: string, pid: string): Promise<void> {
  const root = `users/${uid}/projects/${pid}`;
  const gens = await db.collection(`${root}/generations`).listDocuments();
  for (const g of gens) {
    const staged = await g.collection('staged').listDocuments();
    const batch = db.batch();
    for (const d of staged) batch.delete(d);
    batch.delete(g.collection('artifacts').doc('raw'));
    batch.delete(g);
    await batch.commit();
  }
  for (const col of ['files', 'blobs', 'snapshots', 'messages'] as const) {
    const docs = await db.collection(`${root}/${col}`).listDocuments();
    if (docs.length === 0) continue;
    const batch = db.batch();
    for (const d of docs) batch.delete(d);
    await batch.commit();
  }
}

export function makeApps(opts: { deadlineMs?: number; chunkDelayMs?: number } = {}) {
  const generations = new GenerationsRepo(db);
  const commits = new CommitService(db, new BlobsRepo(db));
  const locationContext = {
    getContext: () =>
      Promise.resolve({
        status: 'disconnected' as const,
        locationName: null,
        timezone: null,
        calendars: [],
        contactsTotal: null,
        availableMethods: [],
        note: 'HighLevel is not connected yet.',
      }),
  };
  const provider = new FakeProvider({ chunkDelayMs: opts.chunkDelayMs ?? 0 });
  const orchestrator = new GenerationOrchestrator({
    generations,
    commits,
    context: new ContextBuilder(db, locationContext),
    runner: new CandidateRunner(provider, systemClock, fakeLogger()),
    clock: systemClock,
    deadlineMs: opts.deadlineMs,
    heartbeatMs: 1_000,
  });
  const common = {
    version: 't',
    allowedOrigins: [],
    logger: fakeLogger(),
    verifyIdToken: (t: string) => Promise.resolve({ uid: t }),
  };
  const generate = createHttpApp({
    ...common,
    service: 'generate',
    authedRouters: [
      generationRouter({
        orchestrator,
        limiter: new MemoryRateLimiter(systemClock),
        generationEnabled: true,
        generationDailyGlobalCap: 200,
      }),
    ],
  });
  const api = createHttpApp({
    ...common,
    service: 'api',
    authedRouters: [generationControlRouter({ generations, commits, clock: systemClock })],
  });
  return { generate, api };
}

export async function seedProject(uid: string, pid: string, extra: Record<string, unknown> = {}) {
  await wipeProject(uid, pid);
  const now = Timestamp.now();
  await db.doc(`users/${uid}/projects/${pid}`).set({
    name: 'Demo',
    description: '',
    locationId: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...extra,
  });
}

export async function generate(
  app: http.RequestListener | ReturnType<typeof makeApps>['generate'],
  uid: string,
  pid: string,
  prompt: string,
  id = crypto.randomUUID(),
) {
  const res = await request(app)
    .post(`/v1/projects/${pid}/generations`)
    .set('Authorization', `Bearer ${uid}`)
    .set('Accept', 'text/event-stream')
    .send({ clientRequestId: id, prompt });
  const frames = res.headers['content-type']?.includes('text/event-stream')
    ? parseSse(res.text)
    : [];
  return {
    res,
    id,
    frames,
    types: frames.map((f) => f.event),
    last: frames.at(-1)?.data as { type: string; data: Record<string, unknown> } | undefined,
  };
}

export async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Starts a real HTTP server so a test can disconnect mid-stream. */
export async function startAndDisconnect(
  app: ReturnType<typeof makeApps>['generate'],
  uid: string,
  pid: string,
  prompt: string,
  afterBytes = 2_000,
) {
  const server = http.createServer(app).listen(0);
  const port = (server.address() as AddressInfo).port;
  const id = crypto.randomUUID();
  await new Promise<void>((resolve) => {
    const req = http.request(
      {
        port,
        method: 'POST',
        path: `/v1/projects/${pid}/generations`,
        headers: {
          Authorization: `Bearer ${uid}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
      },
      (res) => {
        let n = 0;
        res.on('data', (c: Buffer) => {
          n += c.length;
          if (n > afterBytes) {
            req.destroy();
            resolve();
          }
        });
      },
    );
    req.end(JSON.stringify({ clientRequestId: id, prompt }));
  });
  return { id, close: () => new Promise<void>((r) => server.close(() => r())) };
}
