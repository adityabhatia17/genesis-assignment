import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

let env: RulesTestEnvironment;

const newProject = (overrides: Record<string, unknown> = {}) => ({
  name: 'Contacts dashboard',
  description: 'Shows my contacts',
  locationId: null,
  status: 'active',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  deletedAt: null,
  ...overrides,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-genesis',
    firestore: { rules: readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8') },
  });
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
});

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

describe('projects', () => {
  it('owner creates a valid project; others cannot read it', async () => {
    const ref = await assertSucceeds(addDoc(collection(alice(), 'users/alice/projects'), newProject()));
    await assertSucceeds(getDoc(doc(alice(), ref.path)));
    await assertFails(getDoc(doc(bob(), ref.path)));
    await assertFails(getDoc(doc(anon(), ref.path)));
  });

  it('rejects server-owned fields, bad sizes and client-chosen timestamps on create', async () => {
    const col = collection(alice(), 'users/alice/projects');
    await assertFails(addDoc(col, newProject({ latestSnapshotId: 'x' })));
    await assertFails(addDoc(col, newProject({ name: '' })));
    await assertFails(addDoc(col, newProject({ name: 'x'.repeat(61) })));
    await assertFails(addDoc(col, newProject({ description: 'x'.repeat(281) })));
    await assertFails(addDoc(col, newProject({ createdAt: Timestamp.fromDate(new Date('2020-01-01')) })));
    await assertFails(addDoc(col, newProject({ status: 'deleted' })));
  });

  it('cannot create under another user', async () => {
    await assertFails(addDoc(collection(alice(), 'users/bob/projects'), newProject()));
  });

  it('locationId must match the connection projection', async () => {
    const col = collection(alice(), 'users/alice/projects');
    await assertFails(addDoc(col, newProject({ locationId: 'loc_1' })));
    await seed('users/alice/integrations/highlevel', {
      provider: 'highlevel',
      status: 'connected',
      locationId: 'loc_1',
    });
    await assertSucceeds(addDoc(col, newProject({ locationId: 'loc_1' })));
    await assertFails(addDoc(col, newProject({ locationId: 'loc_2' })));
  });

  it('allows rename/description edits only', async () => {
    const ref = await addDoc(collection(alice(), 'users/alice/projects'), newProject());
    await assertSucceeds(updateDoc(ref, { name: 'Renamed', description: 'New', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { latestSnapshotId: 'x', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { activeGeneration: null, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { name: 'x', updatedAt: Timestamp.fromDate(new Date('2020-01-01')) }));
  });

  it('soft delete allowed only when no generation is active; hard delete never', async () => {
    const ref = await addDoc(collection(alice(), 'users/alice/projects'), newProject());
    await assertFails(deleteDoc(ref));
    await assertSucceeds(
      updateDoc(ref, { status: 'deleted', deletedAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    );

    await seed('users/alice/projects/busy', {
      name: 'Busy',
      description: '',
      locationId: null,
      status: 'active',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      deletedAt: null,
      activeGeneration: { id: 'g1', startedAt: Timestamp.now(), heartbeatAt: Timestamp.now() },
    });
    await assertFails(
      updateDoc(doc(alice(), 'users/alice/projects/busy'), {
        status: 'deleted',
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('lists own active projects, never someone else’s', async () => {
    await addDoc(collection(alice(), 'users/alice/projects'), newProject());
    await assertSucceeds(
      getDocs(
        query(collection(alice(), 'users/alice/projects'), where('status', '==', 'active'), orderBy('updatedAt', 'desc')),
      ),
    );
    await assertFails(getDocs(query(collection(alice(), 'users/bob/projects'), where('status', '==', 'active'))));
  });
});

describe('project internals are read-only to clients', () => {
  const sub = [
    'files/f1',
    'messages/m1',
    'generations/g1',
    'generations/g1/staged/f1',
    'generations/g1/artifacts/raw',
    'snapshots/s1',
    'blobs/b1',
  ];

  it.each(sub)('%s: owner reads, nobody writes, strangers cannot read', async (rel) => {
    const path = `users/alice/projects/p1/${rel}`;
    await seed(path, { x: 1 });
    await assertSucceeds(getDoc(doc(alice(), path)));
    await assertFails(getDoc(doc(bob(), path)));
    await assertFails(setDoc(doc(alice(), path), { x: 2 }));
    await assertFails(deleteDoc(doc(alice(), path)));
  });
});

describe('integration projection and server-only collections', () => {
  it('owner reads the projection but cannot write it', async () => {
    await seed('users/alice/integrations/highlevel', { status: 'connected', locationId: 'loc_1' });
    await assertSucceeds(getDoc(doc(alice(), 'users/alice/integrations/highlevel')));
    await assertFails(getDoc(doc(bob(), 'users/alice/integrations/highlevel')));
    await assertFails(
      setDoc(doc(alice(), 'users/alice/integrations/highlevel'), { status: 'connected', locationId: 'evil' }),
    );
  });

  it.each(['hlConnections/alice', 'oauthStates/abc', 'rateLimits/k', 'webhookEvents/w'])(
    '%s is deny-all, even for the owner',
    async (path) => {
      await seed(path, { x: 1 });
      await assertFails(getDoc(doc(alice(), path)));
      await assertFails(setDoc(doc(alice(), path), { x: 2 }));
    },
  );

  it('users/{uid} root document is deny-all', async () => {
    await assertFails(setDoc(doc(alice(), 'users/alice'), { email: 'a@x.com' }));
    await assertFails(getDoc(doc(alice(), 'users/alice')));
  });

  it('events are owner-read-only', async () => {
    await seed('users/alice/events/e1', { type: 'contact.created' });
    await assertSucceeds(getDoc(doc(alice(), 'users/alice/events/e1')));
    await assertFails(setDoc(doc(alice(), 'users/alice/events/e2'), { type: 'x' }));
  });
});
