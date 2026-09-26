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
  tryAcquireRefreshLease(
    uid: string,
    holder: string,
    nowMs: number,
    leaseMs: number,
    skewMs: number,
    force: boolean,
  ): Promise<LeaseOutcome>;
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
    refreshLock: d.refreshLock
      ? { holder: d.refreshLock.holder, leaseUntilMs: d.refreshLock.leaseUntil.toMillis() }
      : null,
  };
};

export class FirestoreConnectionRepo implements ConnectionRepo {
  constructor(private readonly db: Firestore) {}

  private connRef(uid: string) {
    return this.db.doc(paths.connection(uid));
  }
  private projRef(uid: string) {
    return this.db.doc(paths.integration(uid));
  }

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
      uid: i.uid,
      status: 'connected',
      source: i.source,
      locationId: i.locationId,
      companyId: i.companyId,
      hlUserId: i.hlUserId,
      scopes: i.scopes,
      accessToken: i.accessToken,
      refreshToken: i.refreshToken,
      keyVersion: 1,
      expiresAt: Timestamp.fromMillis(i.expiresAtMs),
      refreshLock: null,
      connectedAt: now,
      updatedAt: now,
      lastRefreshAt: null,
      lastErrorCode: null,
    });
    batch.set(this.projRef(i.uid), {
      provider: 'highlevel',
      status: 'connected',
      locationId: i.locationId,
      locationName: i.locationName,
      timezone: i.timezone,
      scopes: i.scopes,
      connectedAt: now,
      updatedAt: now,
      lastErrorCode: null,
    });
    await batch.commit();
  }

  tryAcquireRefreshLease(
    uid: string,
    holder: string,
    nowMs: number,
    leaseMs: number,
    skewMs: number,
    force: boolean,
  ): Promise<LeaseOutcome> {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.connRef(uid));
      if (!snap.exists) return { kind: 'not_connected' } as const;
      const conn = toRecord(snap.data());
      if (conn.status === 'reauth_required') return { kind: 'reauth' } as const;
      if (!force && conn.expiresAtMs - nowMs > skewMs) return { kind: 'fresh', conn } as const;
      if (
        conn.refreshLock &&
        conn.refreshLock.leaseUntilMs > nowMs &&
        conn.refreshLock.holder !== holder
      ) {
        return { kind: 'busy', leaseUntilMs: conn.refreshLock.leaseUntilMs } as const;
      }
      tx.update(this.connRef(uid), {
        refreshLock: { holder, leaseUntil: Timestamp.fromMillis(nowMs + leaseMs) },
      });
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
        accessToken: u.accessToken,
        refreshToken: u.refreshToken,
        expiresAt: Timestamp.fromMillis(u.expiresAtMs),
        scopes: u.scopes.length > 0 ? u.scopes : current.scopes,
        status: 'connected',
        refreshLock: null,
        lastRefreshAt: now,
        updatedAt: now,
        lastErrorCode: null,
        ...(current.refreshLock?.holder !== holder
          ? { lastErrorCode: 'lease_lost_but_committed' }
          : {}),
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
    batch.update(this.connRef(uid), {
      status: 'reauth_required',
      refreshLock: null,
      lastErrorCode: code,
      updatedAt: now,
    });
    batch.set(
      this.projRef(uid),
      { status: 'reauth_required', lastErrorCode: code, updatedAt: now },
      { merge: true },
    );
    await batch.commit();
  }

  async deleteConnection(uid: string, nowMs: number): Promise<void> {
    const batch = this.db.batch();
    batch.delete(this.connRef(uid));
    batch.set(this.projRef(uid), {
      provider: 'highlevel',
      status: 'disconnected',
      locationId: null,
      locationName: null,
      timezone: null,
      scopes: [],
      connectedAt: null,
      updatedAt: Timestamp.fromMillis(nowMs),
      lastErrorCode: null,
    });
    await batch.commit();
  }

  async findUidsByLocation(locationId: string): Promise<string[]> {
    const snap = await this.db
      .collection(paths.connections())
      .where('locationId', '==', locationId)
      .select('uid')
      .get();
    return snap.docs.map((d) => d.id);
  }
}
