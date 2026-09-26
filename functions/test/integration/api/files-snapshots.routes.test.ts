import { Timestamp } from 'firebase-admin/firestore';
import request from 'supertest';
import { createHttpApp } from '../../../src/http/create-http-app.js';
import { FileSaveService } from '../../../src/modules/files/file-save.service.js';
import { filesRouter } from '../../../src/modules/files/files.routes.js';
import { CommitService } from '../../../src/modules/generation/persistence/commit.service.js';
import { BlobsRepo } from '../../../src/modules/snapshots/blobs.repo.js';
import { RestoreService } from '../../../src/modules/snapshots/restore.service.js';
import { snapshotsRouter } from '../../../src/modules/snapshots/snapshots.routes.js';
import { systemClock } from '../../../src/shared/clock.js';
import { firestore } from '../../../src/shared/firebase-admin.js';
import { sha256Hex } from '../../../src/shared/hash.js';
import { fakeLogger } from '../../helpers/fakes.js';

const db = firestore();
const blobs = new BlobsRepo(db);
const app = createHttpApp({
  service: 'api',
  version: 't',
  allowedOrigins: [],
  logger: fakeLogger(),
  verifyIdToken: (t) => Promise.resolve({ uid: t }),
  authedRouters: [
    filesRouter(new FileSaveService(db, systemClock)),
    snapshotsRouter(new RestoreService(db, blobs, new CommitService(db, blobs), systemClock)),
  ],
});
const FID = 'c'.repeat(20);

beforeAll(async () => {
  const t = Timestamp.now();
  await db.doc('users/owner/projects/h1').set({
    name: 'P',
    description: '',
    locationId: null,
    status: 'active',
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    totalBytes: 1,
  });
  await db.doc(`users/owner/projects/h1/files/${FID}`).set({
    path: 'app.js',
    language: 'javascript',
    content: 'x',
    sizeBytes: 1,
    contentHash: sha256Hex('x'),
    version: 1,
    source: 'ai',
    updatedAt: t,
    lastGenerationId: null,
  });
});

describe('files and snapshots HTTP contracts', () => {
  it('validates params and body', async () => {
    const badId = await request(app)
      .put('/v1/projects/h1/files/not-a-file-id')
      .set('Authorization', 'Bearer owner')
      .send({ content: 'y', expectedVersion: 1 });
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe('VALIDATION_FAILED');
    const badVersion = await request(app)
      .put(`/v1/projects/h1/files/${FID}`)
      .set('Authorization', 'Bearer owner')
      .send({ content: 'y', expectedVersion: 0 });
    expect(badVersion.status).toBe(400);
  });

  it('scopes to the caller (another user sees 404)', async () => {
    const res = await request(app)
      .put(`/v1/projects/h1/files/${FID}`)
      .set('Authorization', 'Bearer stranger')
      .send({ content: 'y', expectedVersion: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('saves, then reports conflicts with the current version', async () => {
    const ok = await request(app)
      .put(`/v1/projects/h1/files/${FID}`)
      .set('Authorization', 'Bearer owner')
      .send({ content: 'y', expectedVersion: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ fileId: FID, path: 'app.js', version: 2 });
    const stale = await request(app)
      .put(`/v1/projects/h1/files/${FID}`)
      .set('Authorization', 'Bearer owner')
      .send({ content: 'z', expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'FILE_VERSION_CONFLICT',
      details: { currentVersion: 2 },
    });
  });

  it('returns 404 for an unknown snapshot', async () => {
    const res = await request(app)
      .post('/v1/projects/h1/snapshots/nope/restore')
      .set('Authorization', 'Bearer owner')
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SNAPSHOT_NOT_FOUND');
  });
});
