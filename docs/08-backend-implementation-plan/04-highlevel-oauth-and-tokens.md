# BE-3 — HighLevel OAuth and token lifecycle

> Read [`00-overview.md`](00-overview.md) first. Design: [`../05-backend-system-design.md`](../05-backend-system-design.md) §7.1–7.3. Facts: [`../research/02-highlevel-platform.md`](../research/02-highlevel-platform.md) §2. **Run spikes S1–S4 (`research/02` §12) with the script in BE-3.5 Step 1 before finishing this phase.**

**Outcome:** a user can connect one HighLevel sub-account; tokens are encrypted server-side; the dashboard projection shows the location name; access tokens refresh proactively/reactively with rotation-safe concurrency; users can disconnect; local development can seed a connection from a Private Integration Token.

---

### Task BE-3.1: Token cipher (AES-256-GCM)

**Files:**
- Create: `functions/src/modules/highlevel/connection/token-cipher.ts`
- Test: `functions/test/unit/highlevel/token-cipher.test.ts`

**Interfaces:**
- Produces: `EncryptedValueSchema`, `EncryptedValue = { v: 1; iv: string; tag: string; ct: string }`, `TokenField = 'access' | 'refresh'`, `TokenCipher { encrypt(plain, uid, field); decrypt(value, uid, field) }`, `createTokenCipher(keyBase64)`.

- [ ] **Step 1: Write the failing test**

```ts
import { randomBytes } from 'node:crypto';
import { createTokenCipher } from '../../../src/modules/highlevel/connection/token-cipher.js';

const key = randomBytes(32).toString('base64');

describe('token cipher', () => {
  it('round-trips and never stores plaintext', () => {
    const c = createTokenCipher(key);
    const enc = c.encrypt('secret-token', 'uid1', 'access');
    expect(JSON.stringify(enc)).not.toContain('secret-token');
    expect(c.decrypt(enc, 'uid1', 'access')).toBe('secret-token');
  });
  it('binds ciphertext to user and field (AAD)', () => {
    const c = createTokenCipher(key);
    const enc = c.encrypt('t', 'uid1', 'access');
    expect(() => c.decrypt(enc, 'uid2', 'access')).toThrow();
    expect(() => c.decrypt(enc, 'uid1', 'refresh')).toThrow();
  });
  it('detects tampering', () => {
    const c = createTokenCipher(key);
    const enc = c.encrypt('t', 'u', 'access');
    const tampered = { ...enc, ct: Buffer.from('xx').toString('base64') };
    expect(() => c.decrypt(tampered, 'u', 'access')).toThrow();
  });
  it('requires a 32-byte key', () => {
    expect(() => createTokenCipher(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const EncryptedValueSchema = z.object({ v: z.literal(1), iv: z.string(), tag: z.string(), ct: z.string() });
export type EncryptedValue = z.infer<typeof EncryptedValueSchema>;
export type TokenField = 'access' | 'refresh';

export interface TokenCipher {
  encrypt(plain: string, uid: string, field: TokenField): EncryptedValue;
  decrypt(value: EncryptedValue, uid: string, field: TokenField): string;
}

export function createTokenCipher(keyBase64: string): TokenCipher {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  const aad = (uid: string, field: TokenField) => Buffer.from(`hl:${uid}:${field}`, 'utf8');

  return {
    encrypt(plain, uid, field) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(uid, field));
      const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
    },
    decrypt(value, uid, field) {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
      decipher.setAAD(aad(uid, field));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(value.ct, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}
```

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit** — `feat(functions): add AES-256-GCM token cipher bound to user and field`.

---

### Task BE-3.2: Connection repository (server doc + client projection + refresh lease)

**Files:**
- Create: `functions/src/modules/highlevel/connection/connection.repo.ts`
- Test: `functions/test/integration/highlevel/connection.repo.test.ts` (emulator)

**Interfaces:**
- Consumes: `EncryptedValueSchema`, `paths`.
- Produces:
  - `interface ConnectionRecord { uid; status: 'connected' | 'reauth_required'; source: 'oauth' | 'pit'; locationId; companyId: string | null; hlUserId: string | null; scopes: string[]; accessToken: EncryptedValue; refreshToken: EncryptedValue | null; expiresAtMs: number; refreshLock: { holder: string; leaseUntilMs: number } | null }`
  - `interface NewConnectionInput { uid; source; locationId; companyId; hlUserId; scopes; accessToken; refreshToken; expiresAtMs; locationName: string | null; timezone: string | null; nowMs }`
  - `type LeaseOutcome = { kind: 'fresh'; conn } | { kind: 'acquired'; conn } | { kind: 'busy'; leaseUntilMs } | { kind: 'not_connected' } | { kind: 'reauth' }`
  - `interface ConnectionRepo { get(uid); saveNewConnection(input); tryAcquireRefreshLease(uid, holder, nowMs, leaseMs, skewMs, force); commitRefresh(uid, holder, update); releaseLease(uid, holder); markReauthRequired(uid, code, nowMs); deleteConnection(uid, nowMs); findUidsByLocation(locationId); getProjection(uid) }`
  - `class FirestoreConnectionRepo implements ConnectionRepo`

- [ ] **Step 1: Implement**

```ts
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { AppError } from '../../../shared/app-error.js';
import { paths } from '../../../shared/firestore-paths.js';
import { EncryptedValueSchema, type EncryptedValue } from './token-cipher.js';

const Ts = z.custom<Timestamp>((v) => v instanceof Timestamp, 'Expected Timestamp');

const ConnectionDocSchema = z.object({
  uid: z.string(),
  status: z.enum(['connected', 'reauth_required']),
  source: z.enum(['oauth', 'pit']),
  locationId: z.string(),
  companyId: z.string().nullable(),
  hlUserId: z.string().nullable(),
  scopes: z.array(z.string()),
  accessToken: EncryptedValueSchema,
  refreshToken: EncryptedValueSchema.nullable(),
  keyVersion: z.literal(1),
  expiresAt: Ts,
  refreshLock: z.object({ holder: z.string(), leaseUntil: Ts }).nullable(),
  connectedAt: Ts,
  updatedAt: Ts,
  lastRefreshAt: Ts.nullable(),
  lastErrorCode: z.string().nullable(),
});

export interface ConnectionRecord {
  readonly uid: string;
  readonly status: 'connected' | 'reauth_required';
  readonly source: 'oauth' | 'pit';
  readonly locationId: string;
  readonly companyId: string | null;
  readonly hlUserId: string | null;
  readonly scopes: string[];
  readonly accessToken: EncryptedValue;
  readonly refreshToken: EncryptedValue | null;
  readonly expiresAtMs: number;
  readonly refreshLock: { holder: string; leaseUntilMs: number } | null;
}

export interface NewConnectionInput {
  uid: string;
  source: 'oauth' | 'pit';
  locationId: string;
  companyId: string | null;
  hlUserId: string | null;
  scopes: string[];
  accessToken: EncryptedValue;
  refreshToken: EncryptedValue | null;
  expiresAtMs: number;
  locationName: string | null;
  timezone: string | null;
  nowMs: number;
}

export interface RefreshUpdate {
  accessToken: EncryptedValue;
  refreshToken: EncryptedValue;
  expiresAtMs: number;
  scopes: string[];
  nowMs: number;
}

export type LeaseOutcome =
  | { kind: 'fresh'; conn: ConnectionRecord }
  | { kind: 'acquired'; conn: ConnectionRecord }
  | { kind: 'busy'; leaseUntilMs: number }
  | { kind: 'not_connected' }
  | { kind: 'reauth' };

export interface ConnectionProjection {
  status: 'connected' | 'reauth_required' | 'disconnected';
  locationId: string | null;
  locationName: string | null;
  timezone: string | null;
  scopes: string[];
}

export interface ConnectionRepo {
  get(uid: string): Promise<ConnectionRecord | null>;
  getProjection(uid: string): Promise<ConnectionProjection | null>;
  saveNewConnection(input: NewConnectionInput): Promise<void>;
  tryAcquireRefreshLease(uid: string, holder: string, nowMs: number, leaseMs: number, skewMs: number, force: boolean): Promise<LeaseOutcome>;
  commitRefresh(uid: string, holder: string, update: RefreshUpdate): Promise<void>;
  releaseLease(uid: string, holder: string): Promise<void>;
  markReauthRequired(uid: string, code: string, nowMs: number): Promise<void>;
  deleteConnection(uid: string, nowMs: number): Promise<void>;
  findUidsByLocation(locationId: string): Promise<string[]>;
}

const toRecord = (raw: unknown): ConnectionRecord => {
  const d = ConnectionDocSchema.parse(raw);
  return {
    uid: d.uid,
    status: d.status,
    source: d.source,
    locationId: d.locationId,
    companyId: d.companyId,
    hlUserId: d.hlUserId,
    scopes: d.scopes,
    accessToken: d.accessToken,
    refreshToken: d.refreshToken,
    expiresAtMs: d.expiresAt.toMillis(),
    refreshLock: d.refreshLock ? { holder: d.refreshLock.holder, leaseUntilMs: d.refreshLock.leaseUntil.toMillis() } : null,
  };
};

export class FirestoreConnectionRepo implements ConnectionRepo {
  constructor(private readonly db: Firestore) {}

  private connRef(uid: string) { return this.db.doc(paths.connection(uid)); }
  private projRef(uid: string) { return this.db.doc(paths.integration(uid)); }

  async get(uid: string): Promise<ConnectionRecord | null> {
    const snap = await this.connRef(uid).get();
    return snap.exists ? toRecord(snap.data()) : null;
  }

  async getProjection(uid: string): Promise<ConnectionProjection | null> {
    const snap = await this.projRef(uid).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    return {
      status: (d['status'] as ConnectionProjection['status'] | undefined) ?? 'disconnected',
      locationId: (d['locationId'] as string | null | undefined) ?? null,
      locationName: (d['locationName'] as string | null | undefined) ?? null,
      timezone: (d['timezone'] as string | null | undefined) ?? null,
      scopes: (d['scopes'] as string[] | undefined) ?? [],
    };
  }

  async saveNewConnection(i: NewConnectionInput): Promise<void> {
    const now = Timestamp.fromMillis(i.nowMs);
    const batch = this.db.batch();
    batch.set(this.connRef(i.uid), {
      uid: i.uid, status: 'connected', source: i.source, locationId: i.locationId, companyId: i.companyId, hlUserId: i.hlUserId,
      scopes: i.scopes, accessToken: i.accessToken, refreshToken: i.refreshToken, keyVersion: 1,
      expiresAt: Timestamp.fromMillis(i.expiresAtMs), refreshLock: null, connectedAt: now, updatedAt: now, lastRefreshAt: null, lastErrorCode: null,
    });
    batch.set(this.projRef(i.uid), {
      provider: 'highlevel', status: 'connected', locationId: i.locationId, locationName: i.locationName, timezone: i.timezone,
      scopes: i.scopes, connectedAt: now, updatedAt: now, lastErrorCode: null,
    });
    await batch.commit();
  }

  tryAcquireRefreshLease(uid: string, holder: string, nowMs: number, leaseMs: number, skewMs: number, force: boolean): Promise<LeaseOutcome> {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.connRef(uid));
      if (!snap.exists) return { kind: 'not_connected' } as const;
      const conn = toRecord(snap.data());
      if (conn.status === 'reauth_required') return { kind: 'reauth' } as const;
      if (!force && conn.expiresAtMs - nowMs > skewMs) return { kind: 'fresh', conn } as const;
      if (conn.refreshLock && conn.refreshLock.leaseUntilMs > nowMs && conn.refreshLock.holder !== holder) {
        return { kind: 'busy', leaseUntilMs: conn.refreshLock.leaseUntilMs } as const;
      }
      tx.update(this.connRef(uid), { refreshLock: { holder, leaseUntil: Timestamp.fromMillis(nowMs + leaseMs) } });
      return { kind: 'acquired', conn } as const;
    });
  }

  async commitRefresh(uid: string, holder: string, u: RefreshUpdate): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.connRef(uid));
      if (!snap.exists) throw new AppError('HL_NOT_CONNECTED');
      const current = toRecord(snap.data());
      const now = Timestamp.fromMillis(u.nowMs);
      tx.update(this.connRef(uid), {
        accessToken: u.accessToken, refreshToken: u.refreshToken, expiresAt: Timestamp.fromMillis(u.expiresAtMs),
        scopes: u.scopes.length > 0 ? u.scopes : current.scopes, status: 'connected', refreshLock: null,
        lastRefreshAt: now, updatedAt: now, lastErrorCode: null,
        ...(current.refreshLock?.holder !== holder ? { lastErrorCode: 'lease_lost_but_committed' } : {}),
      });
    });
  }

  async releaseLease(uid: string, holder: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.connRef(uid));
      if (!snap.exists) return;
      const lock = snap.get('refreshLock') as { holder?: string } | null;
      if (lock?.holder === holder) tx.update(this.connRef(uid), { refreshLock: null });
    });
  }

  async markReauthRequired(uid: string, code: string, nowMs: number): Promise<void> {
    const now = Timestamp.fromMillis(nowMs);
    const batch = this.db.batch();
    batch.update(this.connRef(uid), { status: 'reauth_required', refreshLock: null, lastErrorCode: code, updatedAt: now });
    batch.set(this.projRef(uid), { status: 'reauth_required', lastErrorCode: code, updatedAt: now }, { merge: true });
    await batch.commit();
  }

  async deleteConnection(uid: string, nowMs: number): Promise<void> {
    const batch = this.db.batch();
    batch.delete(this.connRef(uid));
    batch.set(this.projRef(uid), {
      provider: 'highlevel', status: 'disconnected', locationId: null, locationName: null, timezone: null, scopes: [],
      connectedAt: null, updatedAt: Timestamp.fromMillis(nowMs), lastErrorCode: null,
    });
    await batch.commit();
  }

  async findUidsByLocation(locationId: string): Promise<string[]> {
    const snap = await this.db.collection(paths.connections()).where('locationId', '==', locationId).select('uid').get();
    return snap.docs.map((d) => d.id);
  }
}
```

- [ ] **Step 2: Write the integration test (emulator)**

```ts
import { randomBytes } from 'node:crypto';
import { FirestoreConnectionRepo } from '../../../src/modules/highlevel/connection/connection.repo.js';
import { createTokenCipher } from '../../../src/modules/highlevel/connection/token-cipher.js';
import { firestore } from '../../../src/shared/firebase-admin.js';

const db = firestore();
const repo = new FirestoreConnectionRepo(db);
const cipher = createTokenCipher(randomBytes(32).toString('base64'));
const NOW = Date.parse('2026-10-01T12:00:00Z');

async function seed(uid: string, expiresAtMs: number) {
  await repo.saveNewConnection({
    uid, source: 'oauth', locationId: 'loc_1', companyId: 'co_1', hlUserId: 'u_1', scopes: ['contacts.readonly'],
    accessToken: cipher.encrypt('a0', uid, 'access'), refreshToken: cipher.encrypt('r0', uid, 'refresh'),
    expiresAtMs, locationName: 'Demo Clinic', timezone: 'America/New_York', nowMs: NOW,
  });
}

describe('FirestoreConnectionRepo', () => {
  it('writes the server doc and the client projection', async () => {
    await seed('u1', NOW + 3_600_000);
    expect((await repo.get('u1'))?.locationId).toBe('loc_1');
    expect(await repo.getProjection('u1')).toMatchObject({ status: 'connected', locationName: 'Demo Clinic' });
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
      accessToken: cipher.encrypt('a1', 'u2', 'access'), refreshToken: cipher.encrypt('r1', 'u2', 'refresh'),
      expiresAtMs: NOW + 86_400_000, scopes: [], nowMs: NOW,
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
```

- [ ] **Step 3: Run** — `npm run test:integration` (repo root) → PASS.

- [ ] **Step 4: Commit** — `feat(functions): add HighLevel connection repository with refresh lease and projection`.

---

### Task BE-3.3: Token endpoint client (form-urlencoded)

**Files:**
- Create: `functions/src/modules/highlevel/oauth/token-endpoint.client.ts`
- Test: `functions/test/unit/highlevel/token-endpoint.client.test.ts`

**Interfaces:**
- Produces: `TokenResponseSchema`, `TokenResponse`, `class TokenEndpointError { status; errorCode; isInvalidGrant }`, `interface TokenEndpointClient { exchangeCode(code); refresh(refreshToken) }`, `createTokenEndpointClient({ baseUrl, clientId, clientSecret, redirectUri, fetchImpl?, timeoutMs? })`.

- [ ] **Step 1: Write the failing test**

```ts
import { createTokenEndpointClient, TokenEndpointError } from '../../../src/modules/highlevel/oauth/token-endpoint.client.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

const opts = { baseUrl: 'https://hl.test', clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://app/cb' };

describe('token endpoint client', () => {
  it('exchanges a code with a form-urlencoded body', async () => {
    const f = fakeFetch(200, { access_token: 'a', refresh_token: 'r', expires_in: 86399, scope: 'contacts.readonly', userType: 'Location', locationId: 'loc' });
    const client = createTokenEndpointClient({ ...opts, fetchImpl: f.impl });
    const out = await client.exchangeCode('code123');
    expect(out.locationId).toBe('loc');
    const call = f.calls[0]!;
    expect(call.url).toBe('https://hl.test/oauth/token');
    expect(new Headers(call.init.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(String(call.init.body));
    expect(Object.fromEntries(form)).toEqual({
      client_id: 'cid', client_secret: 'csecret', grant_type: 'authorization_code', code: 'code123', user_type: 'Location', redirect_uri: 'https://app/cb',
    });
  });
  it('refreshes with grant_type=refresh_token', async () => {
    const f = fakeFetch(200, { access_token: 'a2', refresh_token: 'r2', expires_in: 86399 });
    await createTokenEndpointClient({ ...opts, fetchImpl: f.impl }).refresh('r1');
    expect(new URLSearchParams(String(f.calls[0]!.init.body)).get('grant_type')).toBe('refresh_token');
  });
  it('raises TokenEndpointError flagged as invalid grant on 400/401', async () => {
    const f = fakeFetch(401, { error: 'invalid_grant', error_description: 'Invalid refresh token' });
    const err = await createTokenEndpointClient({ ...opts, fetchImpl: f.impl }).refresh('old').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenEndpointError);
    expect((err as TokenEndpointError).isInvalidGrant).toBe(true);
    expect(JSON.stringify(err)).not.toContain('old');
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { z } from 'zod';

export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.coerce.number().int().positive(),
  refresh_token: z.string().min(1),
  scope: z.string().optional().default(''),
  userType: z.string().optional(),
  locationId: z.string().optional(),
  companyId: z.string().optional(),
  userId: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

const ErrorBodySchema = z.object({ error: z.string().optional(), message: z.unknown().optional() }).passthrough();

export class TokenEndpointError extends Error {
  constructor(readonly status: number, readonly errorCode: string | null) {
    super(`HighLevel token endpoint responded ${status}${errorCode ? ` (${errorCode})` : ''}`);
    this.name = 'TokenEndpointError';
  }
  /** HighLevel rejects a used/revoked refresh token with 400/401; confirmed by spike S4. */
  get isInvalidGrant(): boolean {
    return this.status === 400 || this.status === 401 || this.errorCode === 'invalid_grant';
  }
}

export interface TokenEndpointClient {
  exchangeCode(code: string): Promise<TokenResponse>;
  refresh(refreshToken: string): Promise<TokenResponse>;
}

export interface TokenEndpointOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createTokenEndpointClient(o: TokenEndpointOptions): TokenEndpointClient {
  const doFetch = o.fetchImpl ?? fetch;

  async function post(form: Record<string, string>): Promise<TokenResponse> {
    const res = await doFetch(`${o.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const parsed = ErrorBodySchema.safeParse(json);
      throw new TokenEndpointError(res.status, parsed.success ? (parsed.data.error ?? null) : null);
    }
    return TokenResponseSchema.parse(json);
  }

  const common = { client_id: o.clientId, client_secret: o.clientSecret, user_type: 'Location', redirect_uri: o.redirectUri };
  return {
    exchangeCode: (code) => post({ ...common, grant_type: 'authorization_code', code }),
    refresh: (refreshToken) => post({ ...common, grant_type: 'refresh_token', refresh_token: refreshToken }),
  };
}
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit** — `feat(functions): add form-urlencoded HighLevel token endpoint client`.

---

### Task BE-3.4: OAuth state repository (hashed, single-use, 10 min)

**Files:**
- Create: `functions/src/modules/highlevel/oauth/oauth-state.repo.ts`
- Test: `functions/test/integration/highlevel/oauth-state.repo.test.ts`

**Interfaces:**
- Produces: `interface OAuthStateRepo { create(i: { stateHash; uid; returnPath; nowMs; ttlMs }): Promise<void>; consume(stateHash, nowMs): Promise<{ uid: string; returnPath: string } | null> }`, `class FirestoreOAuthStateRepo`.

- [ ] **Step 1: Implement**

```ts
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { paths } from '../../../shared/firestore-paths.js';

export interface OAuthStateRepo {
  create(i: { stateHash: string; uid: string; returnPath: string; nowMs: number; ttlMs: number }): Promise<void>;
  consume(stateHash: string, nowMs: number): Promise<{ uid: string; returnPath: string } | null>;
}

export class FirestoreOAuthStateRepo implements OAuthStateRepo {
  constructor(private readonly db: Firestore) {}

  async create(i: { stateHash: string; uid: string; returnPath: string; nowMs: number; ttlMs: number }): Promise<void> {
    await this.db.doc(paths.oauthState(i.stateHash)).create({
      uid: i.uid,
      returnPath: i.returnPath,
      createdAt: Timestamp.fromMillis(i.nowMs),
      expiresAt: Timestamp.fromMillis(i.nowMs + i.ttlMs),
      consumedAt: null,
    });
  }

  consume(stateHash: string, nowMs: number): Promise<{ uid: string; returnPath: string } | null> {
    const ref = this.db.doc(paths.oauthState(stateHash));
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const consumedAt = snap.get('consumedAt') as Timestamp | null;
      const expiresAt = snap.get('expiresAt') as Timestamp;
      if (consumedAt !== null || expiresAt.toMillis() <= nowMs) return null;
      tx.update(ref, { consumedAt: Timestamp.fromMillis(nowMs) });
      return { uid: snap.get('uid') as string, returnPath: snap.get('returnPath') as string };
    });
  }
}
```

- [ ] **Step 2: Integration test**

```ts
import { FirestoreOAuthStateRepo } from '../../../src/modules/highlevel/oauth/oauth-state.repo.js';
import { firestore } from '../../../src/shared/firebase-admin.js';

const repo = new FirestoreOAuthStateRepo(firestore());
const NOW = 1_800_000_000_000;

describe('FirestoreOAuthStateRepo', () => {
  it('consumes exactly once', async () => {
    await repo.create({ stateHash: 'h1', uid: 'u', returnPath: '/dashboard', nowMs: NOW, ttlMs: 600_000 });
    expect(await repo.consume('h1', NOW + 1)).toEqual({ uid: 'u', returnPath: '/dashboard' });
    expect(await repo.consume('h1', NOW + 2)).toBeNull();
  });
  it('rejects expired and unknown states', async () => {
    await repo.create({ stateHash: 'h2', uid: 'u', returnPath: '/dashboard', nowMs: NOW, ttlMs: 600_000 });
    expect(await repo.consume('h2', NOW + 600_001)).toBeNull();
    expect(await repo.consume('nope', NOW)).toBeNull();
  });
});
```

- [ ] **Step 3: Run** → PASS. **Step 4: Commit** — `feat(functions): add single-use hashed OAuth state repository`.

---

### Task BE-3.5: OAuth service and routes (+ spike script)

**Files:**
- Create: `functions/scripts/spike-oauth.ts`, `functions/src/modules/highlevel/oauth/location-lookup.ts`, `functions/src/modules/highlevel/oauth/oauth.service.ts`, `functions/src/modules/highlevel/oauth/oauth.routes.ts`
- Modify: `functions/src/composition.ts`
- Test: `functions/test/unit/highlevel/oauth.service.test.ts`, `functions/test/helpers/fakes.ts`

**Interfaces:**
- Consumes: `OAuthStateRepo`, `TokenEndpointClient`, `ConnectionRepo`, `TokenCipher`, `Clock`, `Logger`, `RuntimeConfig`, `LIMITS`, `sha256Hex`, `randomToken`.
- Produces: `interface LocationLookup { getLocation(accessToken, locationId): Promise<{ name: string; timezone: string | null } | null> }`, `createLocationLookup({ baseUrl, fetchImpl? })`; `class OAuthService { start(uid, returnPath?): Promise<{ authorizeUrl }>; handleCallback(query): Promise<string /* redirect URL */> }`; `oauthPublicRouter(service)`, `oauthAuthedRouter(service, limiter)`; test fakes `InMemoryConnectionRepo`, `InMemoryOAuthStateRepo`, `fakeLogger`.

- [ ] **Step 1: Run spikes S1–S4 with a throwaway script**

`functions/scripts/spike-oauth.ts`:
```ts
// Usage: HL_CLIENT_ID=… HL_CLIENT_SECRET=… HL_REDIRECT_URI=… npx tsx scripts/spike-oauth.ts
// Prints an authorize URL; paste the full callback URL back; exchanges the code; refreshes twice; reuses an old token.
// Never prints token values. Stores them in ./spike-tokens.json (git-ignored).
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { createTokenEndpointClient, TokenEndpointError } from '../src/modules/highlevel/oauth/token-endpoint.client.js';

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v; };
const clientId = env('HL_CLIENT_ID');
const redirectUri = env('HL_REDIRECT_URI');
const client = createTokenEndpointClient({ baseUrl: 'https://services.leadconnectorhq.com', clientId, clientSecret: env('HL_CLIENT_SECRET'), redirectUri });
const scopes = 'contacts.readonly contacts.write conversations.readonly conversations/message.readonly conversations/message.write calendars.readonly calendars/events.readonly locations.readonly';
const state = randomBytes(16).toString('base64url');

const url = new URL('https://marketplace.gohighlevel.com/v2/oauth/chooselocation');
Object.entries({ response_type: 'code', redirect_uri: redirectUri, client_id: clientId, scope: scopes, state, loginWindowOpenMode: 'self' })
  .forEach(([k, v]) => url.searchParams.set(k, v));
console.log('\n1) Open:\n', url.toString());

const rl = createInterface({ input: process.stdin, output: process.stdout });
const callback = new URL(await rl.question('\n2) Paste the full callback URL: '));
rl.close();
console.log('S1 state echoed:', callback.searchParams.get('state') === state);

const t1 = await client.exchangeCode(callback.searchParams.get('code') ?? '');
console.log('S2 exchange ok:', { userType: t1.userType, locationId: t1.locationId, expiresIn: t1.expires_in, scope: t1.scope });
const t2 = await client.refresh(t1.refresh_token);
const t3 = await client.refresh(t2.refresh_token);
console.log('S3 rotation ok:', t2.refresh_token !== t1.refresh_token && t3.refresh_token !== t2.refresh_token);
try { await client.refresh(t1.refresh_token); console.log('S4 UNEXPECTED: old refresh token still works'); }
catch (e) { console.log('S4 reuse rejected:', e instanceof TokenEndpointError ? { status: e.status, code: e.errorCode } : String(e)); }
writeFileSync('spike-tokens.json', JSON.stringify({ access_token: t3.access_token, locationId: t1.locationId }, null, 2));
console.log('\nSaved latest access token to spike-tokens.json (git-ignored) for fixture recording.');
```

Record results (state echoed? error body for reuse?) in `research/02` §12 and adjust `TokenEndpointError.isInvalidGrant` if S4 shows a different status/code.

- [ ] **Step 2: Create test fakes `functions/test/helpers/fakes.ts`**

```ts
import type { ConnectionProjection, ConnectionRecord, ConnectionRepo, LeaseOutcome, NewConnectionInput, RefreshUpdate } from '../../src/modules/highlevel/connection/connection.repo.js';
import type { OAuthStateRepo } from '../../src/modules/highlevel/oauth/oauth-state.repo.js';
import type { Logger } from '../../src/shared/logger.js';

export const fakeLogger = (): Logger => {
  const l: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, child: () => l };
  return l;
};

export class InMemoryConnectionRepo implements ConnectionRepo {
  readonly docs = new Map<string, ConnectionRecord>();
  readonly projections = new Map<string, ConnectionProjection>();

  get(uid: string) { return Promise.resolve(this.docs.get(uid) ?? null); }
  getProjection(uid: string) { return Promise.resolve(this.projections.get(uid) ?? null); }
  saveNewConnection(i: NewConnectionInput) {
    this.docs.set(i.uid, {
      uid: i.uid, status: 'connected', source: i.source, locationId: i.locationId, companyId: i.companyId, hlUserId: i.hlUserId,
      scopes: i.scopes, accessToken: i.accessToken, refreshToken: i.refreshToken, expiresAtMs: i.expiresAtMs, refreshLock: null,
    });
    this.projections.set(i.uid, { status: 'connected', locationId: i.locationId, locationName: i.locationName, timezone: i.timezone, scopes: i.scopes });
    return Promise.resolve();
  }
  // Synchronous body ⇒ atomic in JS, like a Firestore transaction.
  tryAcquireRefreshLease(uid: string, holder: string, nowMs: number, leaseMs: number, skewMs: number, force: boolean): Promise<LeaseOutcome> {
    const conn = this.docs.get(uid);
    if (!conn) return Promise.resolve({ kind: 'not_connected' });
    if (conn.status === 'reauth_required') return Promise.resolve({ kind: 'reauth' });
    if (!force && conn.expiresAtMs - nowMs > skewMs) return Promise.resolve({ kind: 'fresh', conn });
    if (conn.refreshLock && conn.refreshLock.leaseUntilMs > nowMs && conn.refreshLock.holder !== holder) {
      return Promise.resolve({ kind: 'busy', leaseUntilMs: conn.refreshLock.leaseUntilMs });
    }
    this.docs.set(uid, { ...conn, refreshLock: { holder, leaseUntilMs: nowMs + leaseMs } });
    return Promise.resolve({ kind: 'acquired', conn });
  }
  commitRefresh(uid: string, _holder: string, u: RefreshUpdate) {
    const conn = this.docs.get(uid);
    if (!conn) return Promise.reject(new Error('missing'));
    this.docs.set(uid, { ...conn, accessToken: u.accessToken, refreshToken: u.refreshToken, expiresAtMs: u.expiresAtMs, status: 'connected', refreshLock: null });
    return Promise.resolve();
  }
  releaseLease(uid: string, holder: string) {
    const conn = this.docs.get(uid);
    if (conn?.refreshLock?.holder === holder) this.docs.set(uid, { ...conn, refreshLock: null });
    return Promise.resolve();
  }
  markReauthRequired(uid: string) {
    const conn = this.docs.get(uid);
    if (conn) this.docs.set(uid, { ...conn, status: 'reauth_required', refreshLock: null });
    const p = this.projections.get(uid);
    if (p) this.projections.set(uid, { ...p, status: 'reauth_required' });
    return Promise.resolve();
  }
  deleteConnection(uid: string) {
    this.docs.delete(uid);
    this.projections.set(uid, { status: 'disconnected', locationId: null, locationName: null, timezone: null, scopes: [] });
    return Promise.resolve();
  }
  findUidsByLocation(locationId: string) {
    return Promise.resolve([...this.docs.values()].filter((d) => d.locationId === locationId).map((d) => d.uid));
  }
}

export class InMemoryOAuthStateRepo implements OAuthStateRepo {
  readonly states = new Map<string, { uid: string; returnPath: string; expiresAtMs: number; consumed: boolean }>();
  create(i: { stateHash: string; uid: string; returnPath: string; nowMs: number; ttlMs: number }) {
    this.states.set(i.stateHash, { uid: i.uid, returnPath: i.returnPath, expiresAtMs: i.nowMs + i.ttlMs, consumed: false });
    return Promise.resolve();
  }
  consume(stateHash: string, nowMs: number) {
    const s = this.states.get(stateHash);
    if (!s || s.consumed || s.expiresAtMs <= nowMs) return Promise.resolve(null);
    s.consumed = true;
    return Promise.resolve({ uid: s.uid, returnPath: s.returnPath });
  }
}
```

- [ ] **Step 3: Write the failing service test**

```ts
import { randomBytes } from 'node:crypto';
import { OAuthService } from '../../../src/modules/highlevel/oauth/oauth.service.js';
import { createTokenCipher } from '../../../src/modules/highlevel/connection/token-cipher.js';
import type { TokenEndpointClient } from '../../../src/modules/highlevel/oauth/token-endpoint.client.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { fakeLogger, InMemoryConnectionRepo, InMemoryOAuthStateRepo } from '../../helpers/fakes.js';

const config = {
  appBaseUrl: 'https://app.test',
  hlRedirectUri: 'https://fn.test/api/v1/hl/oauth/callback',
  hlScopes: ['contacts.readonly', 'locations.readonly'],
  hlAuthorizeUrl: 'https://marketplace.gohighlevel.com/v2/oauth/chooselocation',
};

function setup(token: Partial<Awaited<ReturnType<TokenEndpointClient['exchangeCode']>>> = {}, failExchange = false) {
  const states = new InMemoryOAuthStateRepo();
  const connections = new InMemoryConnectionRepo();
  const clock = createFakeClock(1_800_000_000_000);
  const tokens: TokenEndpointClient = {
    exchangeCode: () => failExchange ? Promise.reject(new Error('boom')) : Promise.resolve({
      access_token: 'acc', refresh_token: 'ref', expires_in: 86399, scope: 'contacts.readonly locations.readonly',
      userType: 'Location', locationId: 'loc_1', companyId: 'co', userId: 'hlu', ...token,
    }),
    refresh: () => Promise.reject(new Error('unused')),
  };
  const service = new OAuthService({
    config, clientId: 'cid', states, tokens, connections, clock, logger: fakeLogger(),
    cipher: createTokenCipher(randomBytes(32).toString('base64')),
    locations: { getLocation: () => Promise.resolve({ name: 'Demo Clinic', timezone: 'America/New_York' }) },
  });
  return { service, states, connections, clock };
}

const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get('state') ?? '';

describe('OAuthService', () => {
  it('builds the authorize URL', async () => {
    const { service } = setup();
    const { authorizeUrl } = await service.start('u1');
    const u = new URL(authorizeUrl);
    expect(u.origin + u.pathname).toBe('https://marketplace.gohighlevel.com/v2/oauth/chooselocation');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'cid', redirect_uri: config.hlRedirectUri, scope: 'contacts.readonly locations.readonly', loginWindowOpenMode: 'self',
    });
    expect(stateOf(authorizeUrl)).toHaveLength(43);
  });

  it('connects on a valid callback and redirects with hl=connected', async () => {
    const { service, connections } = setup();
    const state = stateOf((await service.start('u1')).authorizeUrl);
    const redirect = await service.handleCallback({ code: 'c', state });
    expect(redirect).toBe('https://app.test/dashboard?hl=connected');
    expect((await connections.get('u1'))?.locationId).toBe('loc_1');
    expect((await connections.getProjection('u1'))?.locationName).toBe('Demo Clinic');
  });

  it('rejects reused, unknown or missing state', async () => {
    const { service } = setup();
    const state = stateOf((await service.start('u1')).authorizeUrl);
    await service.handleCallback({ code: 'c', state });
    expect(await service.handleCallback({ code: 'c', state })).toContain('reason=state_invalid');
    expect(await service.handleCallback({ code: 'c', state: 'nope' })).toContain('reason=state_invalid');
    expect(await service.handleCallback({ code: 'c' })).toContain('reason=state_invalid');
  });

  it('maps denial, exchange failure and agency tokens', async () => {
    let s = setup();
    let state = stateOf((await s.service.start('u1')).authorizeUrl);
    expect(await s.service.handleCallback({ state, error: 'access_denied' })).toContain('reason=denied');
    s = setup({}, true);
    state = stateOf((await s.service.start('u1')).authorizeUrl);
    expect(await s.service.handleCallback({ code: 'c', state })).toContain('reason=exchange_failed');
    s = setup({ userType: 'Company', locationId: undefined });
    state = stateOf((await s.service.start('u1')).authorizeUrl);
    expect(await s.service.handleCallback({ code: 'c', state })).toContain('reason=not_location_token');
  });
});
```

- [ ] **Step 4: Implement `location-lookup.ts`**

```ts
import { z } from 'zod';

const LocationResponse = z.object({
  location: z.object({ id: z.string(), name: z.string().optional(), timezone: z.string().nullable().optional() }).passthrough(),
});

export interface LocationLookup {
  getLocation(accessToken: string, locationId: string): Promise<{ name: string; timezone: string | null } | null>;
}

export function createLocationLookup(o: { baseUrl: string; fetchImpl?: typeof fetch }): LocationLookup {
  const doFetch = o.fetchImpl ?? fetch;
  return {
    async getLocation(accessToken, locationId) {
      const res = await doFetch(`${o.baseUrl}/locations/${encodeURIComponent(locationId)}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Version: '2021-07-28', Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const parsed = LocationResponse.safeParse(await res.json());
      if (!parsed.success) return null;
      return { name: parsed.data.location.name ?? locationId, timezone: parsed.data.location.timezone ?? null };
    },
  };
}
```

- [ ] **Step 5: Implement `oauth.service.ts`**

```ts
import { LIMITS } from '../../../contracts/limits.js';
import type { OAuthRedirectReason } from '../../../contracts/api.js';
import type { RuntimeConfig } from '../../../config/runtime-config.js';
import type { Clock } from '../../../shared/clock.js';
import { randomToken, sha256Hex, uidHash } from '../../../shared/hash.js';
import { serializeError, type Logger } from '../../../shared/logger.js';
import type { ConnectionRepo } from '../connection/connection.repo.js';
import type { TokenCipher } from '../connection/token-cipher.js';
import type { LocationLookup } from './location-lookup.js';
import type { OAuthStateRepo } from './oauth-state.repo.js';
import type { TokenEndpointClient, TokenResponse } from './token-endpoint.client.js';

export interface OAuthServiceDeps {
  config: Pick<RuntimeConfig, 'appBaseUrl' | 'hlRedirectUri' | 'hlScopes' | 'hlAuthorizeUrl'>;
  clientId: string;
  states: OAuthStateRepo;
  tokens: TokenEndpointClient;
  connections: ConnectionRepo;
  locations: LocationLookup;
  cipher: TokenCipher;
  clock: Clock;
  logger: Logger;
}

export class OAuthService {
  constructor(private readonly d: OAuthServiceDeps) {}

  async start(uid: string, returnPath = '/dashboard'): Promise<{ authorizeUrl: string }> {
    const state = randomToken(32);
    await this.d.states.create({ stateHash: sha256Hex(state), uid, returnPath, nowMs: this.d.clock.now(), ttlMs: LIMITS.oauthStateTtlMs });
    const url = new URL(this.d.config.hlAuthorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.d.config.hlRedirectUri);
    url.searchParams.set('client_id', this.d.clientId);
    url.searchParams.set('scope', this.d.config.hlScopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('loginWindowOpenMode', 'self');
    this.d.logger.info('oauth.start', { uidHash: uidHash(uid) });
    return { authorizeUrl: url.toString() };
  }

  /** Returns the absolute URL to redirect the browser to. Never throws. */
  async handleCallback(q: { code?: string | undefined; state?: string | undefined; error?: string | undefined }): Promise<string> {
    try {
      if (!q.state) return this.redirect('/dashboard', 'state_invalid');
      const consumed = await this.d.states.consume(sha256Hex(q.state), this.d.clock.now());
      if (!consumed) return this.redirect('/dashboard', 'state_invalid');
      if (q.error || !q.code) return this.redirect(consumed.returnPath, 'denied');

      let token: TokenResponse;
      try {
        token = await this.d.tokens.exchangeCode(q.code);
      } catch (err) {
        this.d.logger.warn('oauth.callback.exchange_failed', { error: serializeError(err) });
        return this.redirect(consumed.returnPath, 'exchange_failed');
      }
      if (!token.locationId || (token.userType !== undefined && token.userType !== 'Location')) {
        return this.redirect(consumed.returnPath, 'not_location_token');
      }

      const uid = consumed.uid;
      const location = await this.d.locations.getLocation(token.access_token, token.locationId).catch(() => null);
      const now = this.d.clock.now();
      await this.d.connections.saveNewConnection({
        uid,
        source: 'oauth',
        locationId: token.locationId,
        companyId: token.companyId ?? null,
        hlUserId: token.userId ?? null,
        scopes: token.scope.split(/\s+/).filter(Boolean),
        accessToken: this.d.cipher.encrypt(token.access_token, uid, 'access'),
        refreshToken: this.d.cipher.encrypt(token.refresh_token, uid, 'refresh'),
        expiresAtMs: now + token.expires_in * 1000,
        locationName: location?.name ?? null,
        timezone: location?.timezone ?? null,
        nowMs: now,
      });
      this.d.logger.info('oauth.callback.ok', { uidHash: uidHash(uid), locationId: token.locationId });
      return this.redirect(consumed.returnPath, null);
    } catch (err) {
      this.d.logger.error('oauth.callback.internal', { error: serializeError(err) });
      return this.redirect('/dashboard', 'internal');
    }
  }

  private redirect(returnPath: string, reason: OAuthRedirectReason | null): string {
    const url = new URL(returnPath, `${this.d.config.appBaseUrl}/`);
    if (reason) {
      url.searchParams.set('hl', 'error');
      url.searchParams.set('reason', reason);
    } else {
      url.searchParams.set('hl', 'connected');
    }
    return url.toString();
  }
}
```

- [ ] **Step 6: Implement `oauth.routes.ts`**

```ts
import express, { type Router } from 'express';
import { OAuthCallbackQuery, OAuthStartBody } from '../../../contracts/api.js';
import { defineHandler, requireUid } from '../../../http/define-handler.js';
import { rateLimit } from '../../../http/middleware/rate-limit.js';
import { sendData } from '../../../http/respond.js';
import { RATE_LIMITS, type RateLimiter } from '../../rate-limit/rate-limiter.js';
import type { OAuthService } from './oauth.service.js';

export function oauthPublicRouter(service: OAuthService): Router {
  const r = express.Router();
  r.get('/v1/hl/oauth/callback', async (req, res) => {
    const parsed = OAuthCallbackQuery.safeParse(req.query);
    const target = await service.handleCallback(parsed.success ? parsed.data : {});
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, target);
  });
  return r;
}

export function oauthAuthedRouter(service: OAuthService, limiter: RateLimiter): Router {
  const r = express.Router();
  r.post(
    '/v1/hl/oauth/start',
    rateLimit(limiter, RATE_LIMITS.oauthStart),
    defineHandler({ body: OAuthStartBody }, async ({ body }, req, res) => {
      sendData(res, await service.start(requireUid(req), body.returnPath));
    }),
  );
  return r;
}
```

- [ ] **Step 7: Wire into `composition.ts` (api)**

Add inside `buildApiApp` (and import what's used):
```ts
const db = firestore();
const clock = systemClock;
const secrets = loadSecrets({ anthropic: false });
const cipher = createTokenCipher(secrets.tokenEncryptionKey);
const connections = new FirestoreConnectionRepo(db);
const tokenEndpoint = createTokenEndpointClient({
  baseUrl: config.hlApiBaseUrl, clientId: secrets.hlClientId, clientSecret: secrets.hlClientSecret, redirectUri: config.hlRedirectUri,
});
const limiter = new FirestoreRateLimiter(db, clock);
const oauth = new OAuthService({
  config, clientId: secrets.hlClientId, states: new FirestoreOAuthStateRepo(db), tokens: tokenEndpoint, connections,
  locations: createLocationLookup({ baseUrl: config.hlApiBaseUrl }), cipher, clock, logger,
});
publicRouters.push(oauthPublicRouter(oauth));
authedRouters.push(oauthAuthedRouter(oauth, limiter));
```

- [ ] **Step 8: Run all tests; lint; typecheck** → PASS/clean.

- [ ] **Step 9: Commit** — `feat(functions): add HighLevel OAuth start/callback with encrypted connection storage`.

---

### Task BE-3.6: Token manager (single-flight + lease, HTTP outside transactions)

**Files:**
- Create: `functions/src/modules/highlevel/connection/token-manager.ts`
- Test: `functions/test/unit/highlevel/token-manager.test.ts`

**Interfaces:**
- Consumes: `ConnectionRepo`, `TokenEndpointClient` (+ `TokenEndpointError`), `TokenCipher`, `Clock`, `Logger`, `sleep`, `retry`.
- Produces: `interface AccessGrant { accessToken: string; locationId: string; expiresAtMs: number; scopes: readonly string[] }`; `class TokenManager { getAccessGrant(uid): Promise<AccessGrant>; forceRefresh(uid, staleExpiresAtMs): Promise<AccessGrant>; markReauth(uid, code): Promise<void> }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { randomBytes } from 'node:crypto';
import { createTokenCipher } from '../../../src/modules/highlevel/connection/token-cipher.js';
import { TokenManager } from '../../../src/modules/highlevel/connection/token-manager.js';
import { TokenEndpointError, type TokenEndpointClient } from '../../../src/modules/highlevel/oauth/token-endpoint.client.js';
import { AppError } from '../../../src/shared/app-error.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { fakeLogger, InMemoryConnectionRepo } from '../../helpers/fakes.js';

const NOW = 1_800_000_000_000;
const cipher = createTokenCipher(randomBytes(32).toString('base64'));

function setup(opts: { expiresInMs: number; source?: 'oauth' | 'pit'; refresh?: TokenEndpointClient['refresh'] }) {
  const repo = new InMemoryConnectionRepo();
  const clock = createFakeClock(NOW);
  let n = 0;
  const refresh = vi.fn(opts.refresh ?? (async () => { n += 1; await Promise.resolve(); return { access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 86_399, scope: '' }; }));
  const tokens: TokenEndpointClient = { exchangeCode: () => Promise.reject(new Error('unused')), refresh };
  void repo.saveNewConnection({
    uid: 'u', source: opts.source ?? 'oauth', locationId: 'loc', companyId: null, hlUserId: null, scopes: ['contacts.readonly'],
    accessToken: cipher.encrypt('a0', 'u', 'access'), refreshToken: cipher.encrypt('r0', 'u', 'refresh'),
    expiresAtMs: NOW + opts.expiresInMs, locationName: 'X', timezone: null, nowMs: NOW,
  });
  const make = () => new TokenManager({ repo, tokens, cipher, clock, logger: fakeLogger(), sleep: () => Promise.resolve() });
  return { repo, refresh, make, clock };
}

describe('TokenManager', () => {
  it('returns a fresh token without refreshing', async () => {
    const s = setup({ expiresInMs: 3_600_000 });
    expect((await s.make().getAccessGrant('u')).accessToken).toBe('a0');
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('refreshes near expiry and stores rotated tokens encrypted', async () => {
    const s = setup({ expiresInMs: 60_000 });
    const g = await s.make().getAccessGrant('u');
    expect(g.accessToken).toBe('a1');
    const stored = await s.repo.get('u');
    expect(cipher.decrypt(stored!.refreshToken!, 'u', 'refresh')).toBe('r1');
    expect(stored!.refreshLock).toBeNull();
  });

  it('single-flights concurrent callers in one instance', async () => {
    const s = setup({ expiresInMs: 60_000 });
    const tm = s.make();
    const grants = await Promise.all(Array.from({ length: 5 }, () => tm.getAccessGrant('u')));
    expect(new Set(grants.map((g) => g.accessToken))).toEqual(new Set(['a1']));
    expect(s.refresh).toHaveBeenCalledTimes(1);
  });

  it('uses the lease across instances (two managers, one refresh)', async () => {
    const s = setup({ expiresInMs: 60_000 });
    const [g1, g2] = await Promise.all([s.make().getAccessGrant('u'), s.make().getAccessGrant('u')]);
    expect(g1.accessToken).toBe('a1');
    expect(g2.accessToken).toBe('a1');
    expect(s.refresh).toHaveBeenCalledTimes(1);
  });

  it('marks reauth on invalid grant', async () => {
    const s = setup({ expiresInMs: 60_000, refresh: () => Promise.reject(new TokenEndpointError(401, 'invalid_grant')) });
    await expect(s.make().getAccessGrant('u')).rejects.toMatchObject({ code: 'HL_REAUTH_REQUIRED' });
    expect((await s.repo.get('u'))?.status).toBe('reauth_required');
    expect((await s.repo.getProjection('u'))?.status).toBe('reauth_required');
  });

  it('releases the lease on transient errors and surfaces HL_UNAVAILABLE', async () => {
    const s = setup({ expiresInMs: 60_000, refresh: () => Promise.reject(new TokenEndpointError(503, null)) });
    await expect(s.make().getAccessGrant('u')).rejects.toBeInstanceOf(AppError);
    expect((await s.repo.get('u'))?.refreshLock).toBeNull();
    expect((await s.repo.get('u'))?.status).toBe('connected');
  });

  it('never refreshes PIT connections', async () => {
    const s = setup({ expiresInMs: -1_000, source: 'pit' });
    expect((await s.make().getAccessGrant('u')).accessToken).toBe('a0');
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('reports not connected / reauth', async () => {
    const s = setup({ expiresInMs: 3_600_000 });
    await expect(s.make().getAccessGrant('nobody')).rejects.toMatchObject({ code: 'HL_NOT_CONNECTED' });
    await s.repo.markReauthRequired('u');
    await expect(s.make().getAccessGrant('u')).rejects.toMatchObject({ code: 'HL_REAUTH_REQUIRED' });
  });

  it('forceRefresh skips when someone already refreshed past the stale expiry', async () => {
    const s = setup({ expiresInMs: 3_600_000 });
    const g = await s.make().forceRefresh('u', NOW - 1);
    expect(g.accessToken).toBe('a0');
    expect(s.refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../shared/app-error.js';
import { retry, sleep as defaultSleep } from '../../../shared/async.js';
import type { Clock } from '../../../shared/clock.js';
import { uidHash } from '../../../shared/hash.js';
import { serializeError, type Logger } from '../../../shared/logger.js';
import { TokenEndpointError, type TokenEndpointClient } from '../oauth/token-endpoint.client.js';
import type { ConnectionRecord, ConnectionRepo } from './connection.repo.js';
import type { TokenCipher } from './token-cipher.js';

export interface AccessGrant {
  readonly accessToken: string;
  readonly locationId: string;
  readonly expiresAtMs: number;
  readonly scopes: readonly string[];
}

export interface TokenManagerDeps {
  repo: ConnectionRepo;
  tokens: TokenEndpointClient;
  cipher: TokenCipher;
  clock: Clock;
  logger: Logger;
  sleep?: (ms: number) => Promise<void>;
  leaseMs?: number;
  skewMs?: number;
  maxWaitAttempts?: number;
}

export class TokenManager {
  private readonly inflight = new Map<string, Promise<AccessGrant>>();
  private readonly leaseMs: number;
  private readonly skewMs: number;
  private readonly maxWaitAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly d: TokenManagerDeps) {
    this.leaseMs = d.leaseMs ?? 30_000;
    this.skewMs = d.skewMs ?? 5 * 60_000;
    this.maxWaitAttempts = d.maxWaitAttempts ?? 20;
    this.sleep = d.sleep ?? ((ms) => defaultSleep(ms));
  }

  async getAccessGrant(uid: string): Promise<AccessGrant> {
    const conn = await this.d.repo.get(uid);
    if (!conn) throw new AppError('HL_NOT_CONNECTED');
    if (conn.status === 'reauth_required') throw new AppError('HL_REAUTH_REQUIRED');
    if (conn.source === 'pit' || conn.expiresAtMs - this.d.clock.now() > this.skewMs) return this.grant(conn);
    return this.singleFlight(uid, false);
  }

  /** Called after HighLevel answered 401 with a token that expires at `staleExpiresAtMs`. */
  async forceRefresh(uid: string, staleExpiresAtMs: number): Promise<AccessGrant> {
    const conn = await this.d.repo.get(uid);
    if (!conn) throw new AppError('HL_NOT_CONNECTED');
    if (conn.status === 'reauth_required') throw new AppError('HL_REAUTH_REQUIRED');
    if (conn.expiresAtMs > staleExpiresAtMs) return this.grant(conn);
    if (conn.source === 'pit') throw await this.markReauth(uid, 'pit_rejected');
    return this.singleFlight(uid, true);
  }

  async markReauth(uid: string, code: string): Promise<AppError> {
    await this.d.repo.markReauthRequired(uid, code, this.d.clock.now());
    this.d.logger.warn('token.reauth_required', { uidHash: uidHash(uid), code });
    return new AppError('HL_REAUTH_REQUIRED');
  }

  private singleFlight(uid: string, force: boolean): Promise<AccessGrant> {
    const existing = this.inflight.get(uid);
    if (existing) return existing;
    const p = this.refreshWithLease(uid, force).finally(() => this.inflight.delete(uid));
    this.inflight.set(uid, p);
    return p;
  }

  private async refreshWithLease(uid: string, force: boolean): Promise<AccessGrant> {
    const holder = randomUUID();
    for (let attempt = 0; attempt < this.maxWaitAttempts; attempt += 1) {
      const outcome = await this.d.repo.tryAcquireRefreshLease(uid, holder, this.d.clock.now(), this.leaseMs, this.skewMs, force && attempt === 0);
      switch (outcome.kind) {
        case 'fresh':
          return this.grant(outcome.conn);
        case 'acquired':
          return this.performRefresh(uid, holder, outcome.conn);
        case 'busy':
          this.d.logger.debug('token.refresh.busy', { uidHash: uidHash(uid), attempt });
          await this.sleep(Math.min(1_000, 150 * 2 ** attempt) + Math.floor(Math.random() * 100));
          break;
        case 'not_connected':
          throw new AppError('HL_NOT_CONNECTED');
        case 'reauth':
          throw new AppError('HL_REAUTH_REQUIRED');
      }
    }
    throw new AppError('HL_UNAVAILABLE', 'Token refresh did not complete in time');
  }

  private async performRefresh(uid: string, holder: string, conn: ConnectionRecord): Promise<AccessGrant> {
    if (!conn.refreshToken) throw await this.markReauth(uid, 'missing_refresh_token');
    const refreshToken = this.d.cipher.decrypt(conn.refreshToken, uid, 'refresh');
    let result;
    try {
      result = await this.d.tokens.refresh(refreshToken); // network call OUTSIDE any transaction
    } catch (err) {
      if (err instanceof TokenEndpointError && err.isInvalidGrant) {
        const latest = await this.d.repo.get(uid);
        if (latest && latest.status === 'connected' && latest.expiresAtMs > conn.expiresAtMs) {
          await this.d.repo.releaseLease(uid, holder);
          return this.grant(latest); // someone else rotated first
        }
        throw await this.markReauth(uid, 'invalid_grant');
      }
      await this.d.repo.releaseLease(uid, holder);
      this.d.logger.warn('token.refresh.failed', { uidHash: uidHash(uid), error: serializeError(err) });
      throw new AppError('HL_UNAVAILABLE', undefined, undefined, { cause: err });
    }

    const now = this.d.clock.now();
    const expiresAtMs = now + result.expires_in * 1000;
    await retry(
      () => this.d.repo.commitRefresh(uid, holder, {
        accessToken: this.d.cipher.encrypt(result.access_token, uid, 'access'),
        refreshToken: this.d.cipher.encrypt(result.refresh_token, uid, 'refresh'),
        expiresAtMs,
        scopes: result.scope.split(/\s+/).filter(Boolean),
        nowMs: now,
      }),
      { attempts: 3, baseMs: 200 },
    );
    this.d.logger.info('token.refresh.ok', { uidHash: uidHash(uid) });
    return { accessToken: result.access_token, locationId: conn.locationId, expiresAtMs, scopes: conn.scopes };
  }

  private grant(conn: ConnectionRecord): AccessGrant {
    let accessToken: string;
    try {
      accessToken = this.d.cipher.decrypt(conn.accessToken, conn.uid, 'access');
    } catch (err) {
      this.d.logger.error('cipher.decrypt_failed', { uidHash: uidHash(conn.uid), error: serializeError(err) });
      throw new AppError('HL_REAUTH_REQUIRED');
    }
    return { accessToken, locationId: conn.locationId, expiresAtMs: conn.expiresAtMs, scopes: conn.scopes };
  }
}
```

- [ ] **Step 3: Run tests** → PASS (9 tests). **Step 4: Commit** — `feat(functions): add rotation-safe token manager with single-flight and lease`.

---

### Task BE-3.7: Disconnect route

**Files:**
- Create: `functions/src/modules/highlevel/connection/connection.routes.ts`
- Modify: `functions/src/composition.ts`
- Test: `functions/test/unit/highlevel/connection.routes.test.ts`

**Interfaces:**
- Produces: `connectionRouter(repo, clock): Router` → `DELETE /v1/hl/connection` → `{ data: { status: 'disconnected' } }`.

- [ ] **Step 1: Test**

```ts
import request from 'supertest';
import { createHttpApp } from '../../../src/http/create-http-app.js';
import { connectionRouter } from '../../../src/modules/highlevel/connection/connection.routes.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { fakeLogger, InMemoryConnectionRepo } from '../../helpers/fakes.js';

it('disconnects the caller only', async () => {
  const repo = new InMemoryConnectionRepo();
  repo.projections.set('u1', { status: 'connected', locationId: 'l', locationName: 'n', timezone: null, scopes: [] });
  const app = createHttpApp({
    service: 'api', version: 't', allowedOrigins: [], logger: fakeLogger(),
    verifyIdToken: () => Promise.resolve({ uid: 'u1' }),
    authedRouters: [connectionRouter(repo, createFakeClock(0))],
  });
  const res = await request(app).delete('/v1/hl/connection').set('Authorization', 'Bearer t');
  expect(res.body).toEqual({ data: { status: 'disconnected' } });
  expect((await repo.getProjection('u1'))?.status).toBe('disconnected');
});
```

- [ ] **Step 2: Implement**

```ts
import express, { type Router } from 'express';
import { requireUid } from '../../../http/define-handler.js';
import { sendData } from '../../../http/respond.js';
import type { Clock } from '../../../shared/clock.js';
import type { ConnectionRepo } from './connection.repo.js';

export function connectionRouter(repo: ConnectionRepo, clock: Clock): Router {
  const r = express.Router();
  r.delete('/v1/hl/connection', async (req, res) => {
    const uid = requireUid(req);
    await repo.deleteConnection(uid, clock.now());
    req.ctx.log.info('hl.disconnect');
    sendData(res, { status: 'disconnected' as const });
  });
  return r;
}
```

Wire: `authedRouters.push(connectionRouter(connections, clock));`

- [ ] **Step 3: Run tests; commit** — `feat(functions): add HighLevel disconnect route`.

---

### Task BE-3.8: Seed an emulator connection from a Private Integration Token (local dev)

**Files:**
- Create: `functions/scripts/seed-pit-connection.ts`

**Interfaces:** Consumes `FirestoreConnectionRepo`, `createTokenCipher`, `createLocationLookup`. Refuses to run against production.

- [ ] **Step 1: Implement**

```ts
// Usage (emulators running, after signing up in the local app to get a uid from the Emulator UI → Authentication):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=genesis-builder-7f3a \
//   HL_PIT=pit-… HL_LOCATION_ID=… FIREBASE_UID=… TOKEN_ENCRYPTION_KEY=… npx tsx scripts/seed-pit-connection.ts
import { FirestoreConnectionRepo } from '../src/modules/highlevel/connection/connection.repo.js';
import { createTokenCipher } from '../src/modules/highlevel/connection/token-cipher.js';
import { createLocationLookup } from '../src/modules/highlevel/oauth/location-lookup.js';
import { DEFAULT_HL_SCOPES } from '../src/config/params.js';
import { firestore } from '../src/shared/firebase-admin.js';

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v; };
if (!process.env['FIRESTORE_EMULATOR_HOST']) throw new Error('Refusing to run without FIRESTORE_EMULATOR_HOST (emulator only).');

const uid = env('FIREBASE_UID');
const pit = env('HL_PIT');
const locationId = env('HL_LOCATION_ID');
const cipher = createTokenCipher(env('TOKEN_ENCRYPTION_KEY'));
const location = await createLocationLookup({ baseUrl: 'https://services.leadconnectorhq.com' }).getLocation(pit, locationId);
const now = Date.now();

await new FirestoreConnectionRepo(firestore()).saveNewConnection({
  uid, source: 'pit', locationId, companyId: null, hlUserId: null, scopes: DEFAULT_HL_SCOPES.split(' '),
  accessToken: cipher.encrypt(pit, uid, 'access'), refreshToken: null,
  expiresAtMs: now + 10 * 365 * 24 * 3_600_000, locationName: location?.name ?? null, timezone: location?.timezone ?? null, nowMs: now,
});
console.log(`Seeded PIT connection for uid=${uid} location=${location?.name ?? locationId}`);
```

> Importing `params.ts` from a script is safe: `defineSecret`/`defineString` only declare params; nothing reads values at import time.

- [ ] **Step 2: Try it** against the emulator (after FE-1 sign-up works): the dashboard badge shows "Connected · <location name>".

- [ ] **Step 3: Commit** — `chore(functions): add emulator-only PIT connection seeding script`.
