import { Timestamp } from 'firebase-admin/firestore';
import request from 'supertest';
import {
  db,
  generate,
  makeApps,
  seedProject,
  startAndDisconnect,
  waitFor,
} from '../../helpers/generation-harness.js';

const gen = (uid: string, pid: string, id: string) =>
  db.doc(`users/${uid}/projects/${pid}/generations/${id}`).get();
const project = (uid: string, pid: string) => db.doc(`users/${uid}/projects/${pid}`).get();
const files = async (uid: string, pid: string) =>
  (await db.collection(`users/${uid}/projects/${pid}/files`).get()).docs
    .map((d) => d.get('path') as string)
    .sort();

describe('generation scenarios', () => {
  const { generate: app, api } = makeApps();

  it('1 first generation streams, commits and snapshots', async () => {
    await seedProject('u1', 'p');
    const r = await generate(app, 'u1', 'p', 'Build a contact dashboard');
    expect(r.types[0]).toBe('generation.started');
    expect(r.types).toEqual(
      expect.arrayContaining([
        'assistant.thinking',
        'assistant.delta',
        'file.started',
        'file.delta',
        'file.completed',
      ]),
    );
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: { snapshotSeq: 1, changedPaths: ['app.js', 'index.html', 'styles.css'] },
    });
    const seqs = r.frames.map((f) => (f.data as { seq: number }).seq);
    expect(seqs).toEqual(seqs.map((_, k) => k + 1));
    expect(await files('u1', 'p')).toEqual(['app.js', 'index.html', 'styles.css']);
    expect((await gen('u1', 'p', r.id)).get('status')).toBe('completed');
    expect((await project('u1', 'p')).get('activeGeneration')).toBeNull();
    const roles = (
      await db.collection('users/u1/projects/p/messages').orderBy('createdAt').get()
    ).docs.map((d) => d.get('role') as string);
    expect(roles).toEqual(['user', 'assistant']);
  });

  it('2 refinement changes one file and reuses blobs', async () => {
    const r = await generate(app, 'u1', 'p', 'Rename the title #refine');
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: { snapshotSeq: 2, changedPaths: ['index.html'] },
    });
  });

  it('3 a question commits a no-op snapshot', async () => {
    const r = await generate(app, 'u1', 'p', 'What does this do? #question');
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: { noChanges: true, snapshotSeq: 3 },
    });
  });

  it('4 an invalid extra file is rejected but the project commits', async () => {
    await seedProject('u2', 'p');
    const r = await generate(app, 'u2', 'p', 'Dashboard #extra-invalid');
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: { rejected: [{ path: 'NOTES.md' }] },
    });
  });

  it('5 a reference to a rejected file fails and commits nothing (raw saved)', async () => {
    await seedProject('u3', 'p');
    const r = await generate(app, 'u3', 'p', 'Dashboard #badjs');
    expect(r.last).toMatchObject({
      type: 'generation.failed',
      data: { error: { code: 'GENERATION_INVALID_OUTPUT' }, partial: { applyable: false } },
    });
    expect(await files('u3', 'p')).toEqual([]);
    expect(
      (await db.doc(`users/u3/projects/p/generations/${r.id}/artifacts/raw`).get()).get('text'),
    ).toContain('⟦FILE');
  });

  it('6 max_tokens mid-file fails as truncated on an empty project', async () => {
    await seedProject('u4', 'p');
    const r = await generate(app, 'u4', 'p', 'Dashboard #truncate');
    expect(r.last).toMatchObject({
      type: 'generation.failed',
      data: { error: { code: 'GENERATION_TRUNCATED' } },
    });
    expect(
      r.frames.some((f) =>
        (f.data as { data: { issues?: { code: string }[] } }).data.issues?.some(
          (x) => x.code === 'FILE_UNTERMINATED',
        ),
      ),
    ).toBe(true);
  });

  it('7 provider error after one file keeps an applyable partial that can be applied', async () => {
    const r = await generate(app, 'u1', 'p', 'Refine #error');
    expect(r.last).toMatchObject({
      type: 'generation.failed',
      data: {
        error: { code: 'LLM_UNAVAILABLE', retryable: true },
        partial: { stagedPaths: ['index.html'], applyable: true },
      },
    });
    const applied = await request(api)
      .post(`/v1/projects/p/generations/${r.id}/apply`)
      .set('Authorization', 'Bearer u1');
    expect(applied.status).toBe(200);
    expect(applied.body.data.appliedPaths).toEqual(['index.html']);
    const again = await request(api)
      .post(`/v1/projects/p/generations/${r.id}/apply`)
      .set('Authorization', 'Bearer u1');
    expect(again.body.error.code).toBe('GENERATION_NOT_APPLYABLE');
  });

  it('8 client disconnect finalizes as interrupted', async () => {
    const slow = makeApps({ chunkDelayMs: 30 });
    await seedProject('u6', 'p');
    const run = await startAndDisconnect(slow.generate, 'u6', 'p', 'x #slow');
    const status = await waitFor(async () => {
      const s = (await gen('u6', 'p', run.id)).get('status') as string;
      return s === 'streaming' ? undefined : s;
    });
    expect(status).toBe('interrupted');
    expect((await project('u6', 'p')).get('activeGeneration')).toBeNull();
    await run.close();
  });

  it('10 a second start while one is running is rejected', async () => {
    const now = Timestamp.now();
    await seedProject('u7', 'p', {
      activeGeneration: { id: 'live', startedAt: now, heartbeatAt: now },
    });
    const r = await generate(app, 'u7', 'p', 'x');
    expect(r.res.status).toBe(409);
    expect(r.res.body.error).toMatchObject({
      code: 'GENERATION_IN_PROGRESS',
      details: { activeGenerationId: 'live' },
    });
  });

  it('11 duplicate clientRequestId is rejected', async () => {
    await seedProject('u8', 'p');
    const first = await generate(app, 'u8', 'p', 'x #question');
    const dup = await generate(app, 'u8', 'p', 'x #question', first.id);
    expect(dup.res.status).toBe(409);
    expect(dup.res.body.error.code).toBe('DUPLICATE_REQUEST');
  });

  it('12 a stale lease is taken over and the old generation marked interrupted', async () => {
    const old = Timestamp.fromMillis(Date.now() - 120_000);
    await seedProject('u9', 'p', {
      activeGeneration: { id: 'old', startedAt: old, heartbeatAt: old },
    });
    await db
      .doc('users/u9/projects/p/generations/old')
      .set({ status: 'streaming', prompt: 'x', heartbeatAt: old });
    const r = await generate(app, 'u9', 'p', 'Dashboard');
    expect(r.last?.type).toBe('generation.completed');
    expect((await gen('u9', 'p', 'old')).get('status')).toBe('interrupted');
  });

  it('13 a dirty tree gets a checkpoint snapshot before the new one', async () => {
    await db.doc('users/u1/projects/p').update({ workingTreeDirty: true });
    const before = (await project('u1', 'p')).get('snapshotSeq') as number;
    const r = await generate(app, 'u1', 'p', 'Rename again #refine');
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: { snapshotSeq: before + 2 },
    });
    const kinds = (
      await db.collection('users/u1/projects/p/snapshots').orderBy('seq', 'desc').limit(2).get()
    ).docs.map((d) => d.get('kind') as string);
    expect(kinds).toEqual(['generation', 'checkpoint']);
  });

  it('14 the deadline stops a long generation', async () => {
    const slow = makeApps({ chunkDelayMs: 50, deadlineMs: 300 });
    await seedProject('u10', 'p');
    const r = await generate(slow.generate, 'u10', 'p', 'x #slow');
    expect(r.last).toMatchObject({
      type: 'generation.failed',
      data: { error: { code: 'GENERATION_TIMEOUT' } },
    });
  });

  it('15 refusal fails without partial', async () => {
    await seedProject('u11', 'p');
    const r = await generate(app, 'u11', 'p', 'x #refuse');
    expect(r.last).toMatchObject({
      type: 'generation.failed',
      data: { error: { code: 'GENERATION_REFUSED' }, partial: null },
    });
  });

  it('16 deletes apply, deleting index.html is rejected', async () => {
    await seedProject('u12', 'p');
    await generate(app, 'u12', 'p', 'Dashboard with a helper #with-old');
    expect(await files('u12', 'p')).toContain('old.js');
    const r = await generate(app, 'u12', 'p', 'cleanup #delete');
    const deleted = r.frames
      .filter((f) => f.event === 'file.deleted')
      .map((f) => (f.data as { data: { path: string; status: string } }).data);
    expect(deleted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'old.js', status: 'valid' }),
        expect.objectContaining({ path: 'index.html', status: 'rejected' }),
      ]),
    );
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: { deletedPaths: ['old.js'], rejected: [{ path: 'index.html' }] },
    });
    const remaining = await files('u12', 'p');
    expect(remaining).toContain('index.html');
    expect(remaining).not.toContain('old.js');
  });
});
