import { randomBytes } from 'node:crypto';
import { FirestoreConnectionRepo } from '../../../src/modules/highlevel/connection/connection.repo.js';
import { createTokenCipher } from '../../../src/modules/highlevel/connection/token-cipher.js';
import { firestore } from '../../../src/shared/firebase-admin.js';

const db = firestore();
const repo = new FirestoreConnectionRepo(db);
const cipher = createTokenCipher(randomBytes(32).toString('base64'));
const NOW = Date.parse('2026-10-01T12:00:00Z');

beforeEach(async () => {
  const batch = db.batch();
  for (const uid of ['u1', 'u2', 'u3', 'u4']) {
    batch.delete(db.doc(`hlConnections/${uid}`));
    batch.delete(db.doc(`users/${uid}/integrations/highlevel`));
  }
  await batch.commit();
});

async function seed(uid: string, expiresAtMs: number) {
  await repo.saveNewConnection({
    uid,
    source: 'oauth',
    locationId: 'loc_1',
    companyId: 'co_1',
    hlUserId: 'u_1',
    scopes: ['contacts.readonly'],
    accessToken: cipher.encrypt('a0', uid, 'access'),
    refreshToken: cipher.encrypt('r0', uid, 'refresh'),
    expiresAtMs,
    locationName: 'Demo Clinic',
    timezone: 'America/New_York',
    nowMs: NOW,
  });
}

describe('FirestoreConnectionRepo', () => {
  it('writes the server doc and the client projection', async () => {
    await seed('u1', NOW + 3_600_000);
    expect((await repo.get('u1'))?.locationId).toBe('loc_1');
    expect(await repo.getProjection('u1')).toMatchObject({
      status: 'connected',
      locationName: 'Demo Clinic',
    });
    const proj = (await db.doc('users/u1/integrations/highlevel').get()).data();
    expect(JSON.stringify(proj)).not.toContain('accessToken');
  });

  it('grants one lease at a time and reports fresh tokens', async () => {
    await seed('u2', NOW + 60_000); // 1 min left → needs refresh with 5 min skew
    const a = await repo.tryAcquireRefreshLease('u2', 'A', NOW, 30_000, 300_000, false);
    const b = await repo.tryAcquireRefreshLease('u2', 'B', NOW, 30_000, 300_000, false);
    expect(a.kind).toBe('acquired');
    expect(b.kind).toBe('busy');
    await repo.commitRefresh('u2', 'A', {
      accessToken: cipher.encrypt('a1', 'u2', 'access'),
      refreshToken: cipher.encrypt('r1', 'u2', 'refresh'),
      expiresAtMs: NOW + 86_400_000,
      scopes: [],
      nowMs: NOW,
    });
    const c = await repo.tryAcquireRefreshLease('u2', 'B', NOW, 30_000, 300_000, false);
    expect(c.kind).toBe('fresh');
  });

  it('marks reauth and deletes cleanly', async () => {
    await seed('u3', NOW + 60_000);
    await repo.markReauthRequired('u3', 'invalid_grant', NOW);
    expect((await repo.get('u3'))?.status).toBe('reauth_required');
    expect((await repo.getProjection('u3'))?.status).toBe('reauth_required');
    await repo.deleteConnection('u3', NOW);
    expect(await repo.get('u3')).toBeNull();
    expect((await repo.getProjection('u3'))?.status).toBe('disconnected');
  });

  it('finds uids by location', async () => {
    await seed('u4', NOW + 1);
    expect(await repo.findUidsByLocation('loc_1')).toEqual(expect.arrayContaining(['u4']));
  });
});
