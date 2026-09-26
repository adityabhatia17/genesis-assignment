import { Timestamp } from 'firebase-admin/firestore';
import { CommitService } from '../../../src/modules/generation/persistence/commit.service.js';
import {
  DEMO_APP_JS,
  DEMO_INDEX_HTML,
  DEMO_STYLES_CSS,
} from '../../../src/modules/generation/llm/fake-scripts.js';
import {
  validateWrite,
  type FileOp,
} from '../../../src/modules/generation/validation/validate-file.js';
import { BlobsRepo } from '../../../src/modules/snapshots/blobs.repo.js';
import { RestoreService } from '../../../src/modules/snapshots/restore.service.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { firestore } from '../../../src/shared/firebase-admin.js';
import { wipeProject } from '../../helpers/generation-harness.js';

const db = firestore();
const blobs = new BlobsRepo(db);
const commits = new CommitService(db, blobs);
const clock = createFakeClock(Date.parse('2026-10-01T12:00:00Z'));
const restore = new RestoreService(db, blobs, commits, clock);
const op = (p: string, c: string) => validateWrite(p, c).op as FileOp;
const commit = (pid: string, ops: FileOp[]) =>
  commits.applyTreeChange({
    uid: 'u',
    projectId: pid,
    nowMs: clock.now(),
    ops,
    source: 'ai',
    validateNextTree: false,
    messages: [],
    snapshot: { kind: 'generation', label: 'x', generationId: null, restoredFromSnapshotId: null },
    lease: { mode: 'must-be-free' },
  });
const pathsOf = async (pid: string) =>
  (await db.collection(`users/u/projects/${pid}/files`).get()).docs
    .map((d) => d.get('path') as string)
    .sort();

async function seed(pid: string) {
  await wipeProject('u', pid);
  const t = Timestamp.fromMillis(clock.now());
  await db.doc(`users/u/projects/${pid}`).set({
    name: 'P',
    description: '',
    locationId: null,
    status: 'active',
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  });
  const s1 = await commit(pid, [
    op('index.html', DEMO_INDEX_HTML),
    op('styles.css', DEMO_STYLES_CSS),
    op('app.js', DEMO_APP_JS),
  ]);
  const s2 = await commit(pid, [
    op('extra.js', 'var extra = 1;'),
    op('app.js', `${DEMO_APP_JS}\n// v2`),
  ]);
  return { s1, s2 };
}

describe('RestoreService', () => {
  it('restores files, removes extras and appends a restore snapshot', async () => {
    const { s1 } = await seed('r1');
    const r = await restore.restore('u', 'r1', s1.snapshotId);
    expect(r).toMatchObject({
      snapshotSeq: 3,
      restoredFromSnapshotId: s1.snapshotId,
      checkpointSnapshotId: null,
    });
    expect(await pathsOf('r1')).toEqual(['app.js', 'index.html', 'styles.css']);
    const snap = await db.doc(`users/u/projects/r1/snapshots/${r.snapshotId}`).get();
    expect(snap.get('kind')).toBe('restore');
    expect(snap.get('deletedPaths')).toEqual(['extra.js']);
  });
  it('checkpoints unsnapshotted edits before restoring', async () => {
    const { s1 } = await seed('r2');
    await db.doc('users/u/projects/r2').update({ workingTreeDirty: true });
    const r = await restore.restore('u', 'r2', s1.snapshotId);
    expect(r.checkpointSnapshotId).not.toBeNull();
    expect(r.snapshotSeq).toBe(4);
  });
  it('refuses to restore the current clean snapshot and unknown ids', async () => {
    const { s2 } = await seed('r3');
    await expect(restore.restore('u', 'r3', s2.snapshotId)).rejects.toMatchObject({
      code: 'SNAPSHOT_ALREADY_CURRENT',
    });
    await expect(restore.restore('u', 'r3', 'missing')).rejects.toMatchObject({
      code: 'SNAPSHOT_NOT_FOUND',
    });
  });
  it('refuses while a generation is live', async () => {
    const { s1 } = await seed('r4');
    const t = Timestamp.fromMillis(clock.now());
    await db.doc('users/u/projects/r4').update({
      activeGeneration: { id: 'g', startedAt: t, heartbeatAt: t },
    });
    await expect(restore.restore('u', 'r4', s1.snapshotId)).rejects.toMatchObject({
      code: 'GENERATION_IN_PROGRESS',
    });
  });
});
