import { Timestamp } from 'firebase-admin/firestore';
import {
  DEMO_APP_JS,
  DEMO_INDEX_HTML,
  DEMO_STYLES_CSS,
} from '../../../src/modules/generation/llm/fake-scripts.js';
import { CommitService } from '../../../src/modules/generation/persistence/commit.service.js';
import {
  validateWrite,
  type FileOp,
} from '../../../src/modules/generation/validation/validate-file.js';
import { BlobsRepo } from '../../../src/modules/snapshots/blobs.repo.js';
import { firestore } from '../../../src/shared/firebase-admin.js';
import { wipeProject } from '../../helpers/generation-harness.js';

const db = firestore();
const commits = new CommitService(db, new BlobsRepo(db));
const NOW = Date.parse('2026-10-01T12:00:00Z');
const op = (p: string, c: string) => validateWrite(p, c).op as FileOp;
const demoOps = () => [
  op('index.html', DEMO_INDEX_HTML),
  op('styles.css', DEMO_STYLES_CSS),
  op('app.js', DEMO_APP_JS),
];

async function seedProject(uid: string, pid: string, extra: Record<string, unknown> = {}) {
  await wipeProject(uid, pid);
  await db.doc(`users/${uid}/projects/${pid}`).set({
    name: 'P',
    description: '',
    locationId: null,
    status: 'active',
    createdAt: Timestamp.fromMillis(NOW),
    updatedAt: Timestamp.fromMillis(NOW),
    deletedAt: null,
    ...extra,
  });
}
const base = (uid: string, pid: string, ops: FileOp[]) => ({
  uid,
  projectId: pid,
  nowMs: NOW,
  ops,
  source: 'ai' as const,
  validateNextTree: true,
  messages: [],
  snapshot: {
    kind: 'generation' as const,
    label: 'Build it',
    generationId: null,
    restoredFromSnapshotId: null,
  },
  lease: { mode: 'must-be-free' as const },
});

describe('CommitService.applyTreeChange', () => {
  it('creates files, blobs and snapshot #1, then dedupes blobs on refinement', async () => {
    await seedProject('u', 'p1');
    const r1 = await commits.applyTreeChange(base('u', 'p1', demoOps()));
    expect(r1).toMatchObject({
      snapshotSeq: 1,
      changedPaths: ['app.js', 'index.html', 'styles.css'],
      noChanges: false,
    });
    const r2 = await commits.applyTreeChange(
      base('u', 'p1', [op('app.js', `${DEMO_APP_JS}\n// v2`)]),
    );
    expect(r2).toMatchObject({ snapshotSeq: 2, changedPaths: ['app.js'], deletedPaths: [] });
    expect((await db.collection('users/u/projects/p1/blobs').get()).size).toBe(4);
    const r3 = await commits.applyTreeChange(
      base('u', 'p1', [op('app.js', `${DEMO_APP_JS}\n// v2`)]),
    );
    expect(r3).toMatchObject({ snapshotSeq: 3, noChanges: true, changedPaths: [] });
  });

  it('checkpoints a dirty tree first', async () => {
    await seedProject('u', 'p2');
    await commits.applyTreeChange(base('u', 'p2', demoOps()));
    await db.doc('users/u/projects/p2').update({ workingTreeDirty: true });
    const r = await commits.applyTreeChange(base('u', 'p2', [op('styles.css', 'body{color:red}')]));
    expect(r.checkpointSnapshotId).not.toBeNull();
    expect(r.snapshotSeq).toBe(3);
    expect((await db.doc('users/u/projects/p2').get()).get('workingTreeDirty')).toBe(false);
  });

  it('enforces the lease and whole-tree validation', async () => {
    await seedProject('u', 'p3', {
      activeGeneration: {
        id: 'g1',
        startedAt: Timestamp.fromMillis(NOW),
        heartbeatAt: Timestamp.fromMillis(NOW),
      },
    });
    await expect(commits.applyTreeChange(base('u', 'p3', demoOps()))).rejects.toMatchObject({
      code: 'GENERATION_IN_PROGRESS',
    });
    await expect(
      commits.applyTreeChange({
        ...base('u', 'p3', demoOps()),
        lease: { mode: 'must-hold', generationId: 'other' },
      }),
    ).rejects.toMatchObject({ code: 'GENERATION_INTERRUPTED' });
    await expect(
      commits.applyTreeChange({
        ...base('u', 'p3', [op('index.html', DEMO_INDEX_HTML)]),
        lease: { mode: 'must-hold', generationId: 'g1' },
      }),
    ).rejects.toMatchObject({ code: 'GENERATION_INVALID_OUTPUT' });
    expect((await db.collection('users/u/projects/p3/files').get()).size).toBe(0);
  });
});
