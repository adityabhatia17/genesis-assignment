import { FirestoreOAuthStateRepo } from '../../../src/modules/highlevel/oauth/oauth-state.repo.js';
import { firestore } from '../../../src/shared/firebase-admin.js';

const db = firestore();
const repo = new FirestoreOAuthStateRepo(db);
const NOW = 1_800_000_000_000;

beforeEach(async () => {
  await Promise.all([db.doc('oauthStates/h1').delete(), db.doc('oauthStates/h2').delete()]);
});

describe('FirestoreOAuthStateRepo', () => {
  it('consumes exactly once', async () => {
    await repo.create({
      stateHash: 'h1',
      uid: 'u',
      returnPath: '/dashboard',
      nowMs: NOW,
      ttlMs: 600_000,
    });
    expect(await repo.consume('h1', NOW + 1)).toEqual({ uid: 'u', returnPath: '/dashboard' });
    expect(await repo.consume('h1', NOW + 2)).toBeNull();
  });
  it('rejects expired and unknown states', async () => {
    await repo.create({
      stateHash: 'h2',
      uid: 'u',
      returnPath: '/dashboard',
      nowMs: NOW,
      ttlMs: 600_000,
    });
    expect(await repo.consume('h2', NOW + 600_001)).toBeNull();
    expect(await repo.consume('nope', NOW)).toBeNull();
  });
});
