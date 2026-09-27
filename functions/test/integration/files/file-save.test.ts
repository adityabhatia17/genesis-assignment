import { Timestamp } from 'firebase-admin/firestore';
import { FileSaveService } from '../../../src/modules/files/file-save.service.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { firestore } from '../../../src/shared/firebase-admin.js';
import { sha256Hex } from '../../../src/shared/hash.js';

const db = firestore();
const NOW = Date.parse('2026-10-01T12:00:00Z');
const svc = new FileSaveService(db, createFakeClock(NOW));
const FID = 'a'.repeat(20);

async function seed(pid: string, project: Record<string, unknown> = {}) {
  const t = Timestamp.fromMillis(NOW);
  await db.doc(`users/u/projects/${pid}`).set({
    name: 'P',
    description: '',
    locationId: null,
    status: 'active',
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    totalBytes: 5,
    fileCount: 1,
    ...project,
  });
  await db.doc(`users/u/projects/${pid}/files/${FID}`).set({
    path: 'app.js',
    language: 'javascript',
    content: 'var a',
    sizeBytes: 5,
    contentHash: sha256Hex('var a'),
    version: 3,
    source: 'ai',
    updatedAt: t,
    lastGenerationId: 'g',
  });
}

describe('FileSaveService', () => {
  it('saves with the expected version and adds a checkpoint to history', async () => {
    const pid = `psave${Date.now()}`;
    await seed(pid, { snapshotSeq: 2, latestSnapshotId: null });
    const r = await svc.save('u', pid, FID, 'var a = 1;', 3);
    expect(r).toMatchObject({ fileId: FID, path: 'app.js', version: 4, sizeBytes: 10 });
    const p = await db.doc(`users/u/projects/${pid}`).get();
    expect(p.get('workingTreeDirty')).toBe(false);
    expect(p.get('snapshotSeq')).toBe(3);
    expect(p.get('totalBytes')).toBe(10);
    expect((await db.doc(`users/u/projects/${pid}/files/${FID}`).get()).get('source')).toBe(
      'manual',
    );
    const snap = await db
      .doc(`users/u/projects/${pid}/snapshots/${p.get('latestSnapshotId')}`)
      .get();
    expect(snap.data()).toMatchObject({
      seq: 3,
      kind: 'checkpoint',
      label: 'Checkpoint: Saved app.js',
      changedPaths: ['app.js'],
      parentSnapshotId: null,
    });
    expect(
      (await db.doc(`users/u/projects/${pid}/blobs/${r.contentHash}`).get()).get('content'),
    ).toBe('var a = 1;');
  });
  it('rejects a stale version with the current version in details', async () => {
    await seed('p2');
    await expect(svc.save('u', 'p2', FID, 'x', 2)).rejects.toMatchObject({
      code: 'FILE_VERSION_CONFLICT',
      details: { currentVersion: 3 },
    });
  });
  it('is a no-op for identical content', async () => {
    await seed('p3');
    expect((await svc.save('u', 'p3', FID, 'var a', 3)).version).toBe(3);
  });
  it('blocks saves during a live generation but not a stale one', async () => {
    const live = Timestamp.fromMillis(NOW);
    await seed('p4', { activeGeneration: { id: 'g', startedAt: live, heartbeatAt: live } });
    await expect(svc.save('u', 'p4', FID, 'x', 3)).rejects.toMatchObject({
      code: 'GENERATION_IN_PROGRESS',
    });
    const old = Timestamp.fromMillis(NOW - 120_000);
    await seed('p5', { activeGeneration: { id: 'g', startedAt: old, heartbeatAt: old } });
    await expect(svc.save('u', 'p5', FID, 'x', 3)).resolves.toMatchObject({ version: 4 });
  });
  it('enforces size limits and existence', async () => {
    await seed('p6');
    await expect(svc.save('u', 'p6', FID, 'é'.repeat(60_000), 3)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(svc.save('u', 'p6', 'b'.repeat(20), 'x', 1)).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
    await expect(svc.save('u', 'nope', FID, 'x', 1)).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    });
  });
});
