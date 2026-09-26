# BE-2 — Firestore security rules

> Read [`00-overview.md`](00-overview.md) first. Schema: [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §3.5. Principle: **clients read their own subtree and write only validated project metadata; everything else is server-written (Admin SDK bypasses rules).**

---

### Task BE-2.1: Security rules

**Files:**
- Modify: `firestore.rules` (replace the temporary deny-all)

**Interfaces:** Consumed by the frontend (project CRUD, all listeners) and verified by BE-2.3.

- [ ] **Step 1: Replace `firestore.rules`**

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // ── helpers ───────────────────────────────────────────────────────────────
    function signedIn() {
      return request.auth != null;
    }

    function isOwner(uid) {
      return signedIn() && request.auth.uid == uid;
    }

    // locationId from the server-written connection projection, or null.
    function connectedLocationId(uid) {
      let p = /databases/$(database)/documents/users/$(uid)/integrations/highlevel;
      return exists(p) ? get(p).data.get('locationId', null) : null;
    }

    function validProjectText(d) {
      return d.name is string && d.name.size() >= 1 && d.name.size() <= 60
        && d.description is string && d.description.size() <= 280;
    }

    function validProjectCreate(uid) {
      let d = request.resource.data;
      let fields = ['name', 'description', 'locationId', 'status', 'createdAt', 'updatedAt', 'deletedAt'];
      return d.keys().hasOnly(fields)
        && d.keys().hasAll(fields)
        && validProjectText(d)
        && d.status == 'active'
        && d.deletedAt == null
        && d.createdAt == request.time
        && d.updatedAt == request.time
        && (d.locationId == null || d.locationId == connectedLocationId(uid));
    }

    function validProjectEdit() {
      let d = request.resource.data;
      return resource.data.status == 'active'
        && d.diff(resource.data).affectedKeys().hasOnly(['name', 'description', 'updatedAt'])
        && validProjectText(d)
        && d.updatedAt == request.time;
    }

    function validSoftDelete() {
      let d = request.resource.data;
      return resource.data.status == 'active'
        && d.diff(resource.data).affectedKeys().hasOnly(['status', 'deletedAt', 'updatedAt'])
        && d.status == 'deleted'
        && d.deletedAt == request.time
        && d.updatedAt == request.time
        && resource.data.get('activeGeneration', null) == null;
    }

    // ── server-only collections ───────────────────────────────────────────────
    match /hlConnections/{uid} {
      allow read, write: if false;   // encrypted HighLevel tokens
    }
    match /oauthStates/{stateHash} {
      allow read, write: if false;
    }
    // ── user subtree ─────────────────────────────────────────────────────────
    match /users/{uid} {
      allow read, write: if false;   // no user profile document in v1

      match /integrations/{integrationId} {
        allow read: if isOwner(uid);
        allow write: if false;
      }

      match /projects/{projectId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && validProjectCreate(uid);
        allow update: if isOwner(uid) && (validProjectEdit() || validSoftDelete());
        allow delete: if false;      // soft delete only

        // files, messages, generations (+ staged, artifacts), snapshots, blobs
        match /{document=**} {
          allow read: if isOwner(uid);
          allow write: if false;
        }
      }
    }
  }
}
```

- [ ] **Step 2: Commit** — `git add firestore.rules && git commit -m "feat(rules): owner-scoped reads, validated project metadata writes, server-only internals"`

---

### Task BE-2.2: Indexes and TTL policies

**Files:**
- Verify: `firestore.indexes.json` (created in BE-0.1 with the `projects (status ASC, updatedAt DESC)` composite index)

- [ ] **Step 1: Confirm** the index file matches BE-0.1 Step 7. No other composite index is needed: messages (`createdAt`), snapshots (`seq`), generations (`createdAt`) and `hlConnections.locationId` use automatic single-field indexes.

- [ ] **Step 2: TTL policies** (after the first deploy creates the collections — console: Firestore → Time-to-live):

| Collection group | Field |
|---|---|
| `oauthStates` | `expiresAt` |

```bash
gcloud firestore fields ttls update expiresAt --collection-group=oauthStates --enable-ttl --project=genesis-builder-7f3a
```

- [ ] **Step 3: Deploy rules and indexes** — `firebase deploy --only firestore` → "✔ firestore: released rules firestore.rules" and "✔ firestore: deployed indexes".

---

### Task BE-2.3: Rules tests

**Files:**
- Create: `functions/test/rules/firestore.rules.test.ts`

**Interfaces:** Consumes `firestore.rules`. Run with `npm run test:rules` from the repo root (Firestore emulator, project `demo-genesis`).

- [ ] **Step 1: Write the tests**

```ts
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
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
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), path), data); });
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
    await seed('users/alice/integrations/highlevel', { provider: 'highlevel', status: 'connected', locationId: 'loc_1' });
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
    await assertSucceeds(updateDoc(ref, { status: 'deleted', deletedAt: serverTimestamp(), updatedAt: serverTimestamp() }));

    await seed('users/alice/projects/busy', {
      name: 'Busy', description: '', locationId: null, status: 'active', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), deletedAt: null,
      activeGeneration: { id: 'g1', startedAt: Timestamp.now(), heartbeatAt: Timestamp.now() },
    });
    await assertFails(updateDoc(doc(alice(), 'users/alice/projects/busy'), { status: 'deleted', deletedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });

  it('lists own active projects, never someone else’s', async () => {
    await addDoc(collection(alice(), 'users/alice/projects'), newProject());
    await assertSucceeds(getDocs(query(collection(alice(), 'users/alice/projects'), where('status', '==', 'active'), orderBy('updatedAt', 'desc'))));
    await assertFails(getDocs(query(collection(alice(), 'users/bob/projects'), where('status', '==', 'active'))));
  });
});

describe('project internals are read-only to clients', () => {
  const sub = ['files/f1', 'messages/m1', 'generations/g1', 'generations/g1/staged/f1', 'generations/g1/artifacts/raw', 'snapshots/s1', 'blobs/b1'];

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
    await assertFails(setDoc(doc(alice(), 'users/alice/integrations/highlevel'), { status: 'connected', locationId: 'evil' }));
  });

  it.each(['hlConnections/alice', 'oauthStates/abc', 'rateLimits/k', 'webhookEvents/w'])('%s is deny-all, even for the owner', async (path) => {
    await seed(path, { x: 1 });
    await assertFails(getDoc(doc(alice(), path)));
    await assertFails(setDoc(doc(alice(), path), { x: 2 }));
  });

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
```

- [ ] **Step 2: Run** — from the repo root: `npm run test:rules`. Expected: all tests pass (≈ 25 assertions groups). If "Could not start Firestore Emulator … Java" appears, install Java 21 (`03-prerequisites.md` §1).

- [ ] **Step 3: Commit** — `git add functions/test/rules && git commit -m "test(rules): cover ownership, schema validation and server-only collections"`
