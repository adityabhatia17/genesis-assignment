import type {
  ConnectionProjection,
  ConnectionRecord,
  ConnectionRepo,
  LeaseOutcome,
  NewConnectionInput,
  RefreshUpdate,
} from '../../src/modules/highlevel/connection/connection.repo.js';
import type { OAuthStateRepo } from '../../src/modules/highlevel/oauth/oauth-state.repo.js';
import type { Logger } from '../../src/shared/logger.js';

export const fakeLogger = (): Logger => {
  const l: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => l,
  };
  return l;
};

export class InMemoryConnectionRepo implements ConnectionRepo {
  readonly docs = new Map<string, ConnectionRecord>();
  readonly projections = new Map<string, ConnectionProjection>();

  get(uid: string) {
    return Promise.resolve(this.docs.get(uid) ?? null);
  }
  getProjection(uid: string) {
    return Promise.resolve(this.projections.get(uid) ?? null);
  }
  saveNewConnection(i: NewConnectionInput) {
    this.docs.set(i.uid, {
      uid: i.uid,
      status: 'connected',
      source: i.source,
      locationId: i.locationId,
      companyId: i.companyId,
      hlUserId: i.hlUserId,
      scopes: i.scopes,
      accessToken: i.accessToken,
      refreshToken: i.refreshToken,
      expiresAtMs: i.expiresAtMs,
      refreshLock: null,
    });
    this.projections.set(i.uid, {
      status: 'connected',
      locationId: i.locationId,
      locationName: i.locationName,
      timezone: i.timezone,
      scopes: i.scopes,
    });
    return Promise.resolve();
  }
  // Synchronous body ⇒ atomic in JS, like a Firestore transaction.
  tryAcquireRefreshLease(
    uid: string,
    holder: string,
    nowMs: number,
    leaseMs: number,
    skewMs: number,
    force: boolean,
  ): Promise<LeaseOutcome> {
    const conn = this.docs.get(uid);
    if (!conn) return Promise.resolve({ kind: 'not_connected' });
    if (conn.status === 'reauth_required') return Promise.resolve({ kind: 'reauth' });
    if (!force && conn.expiresAtMs - nowMs > skewMs)
      return Promise.resolve({ kind: 'fresh', conn });
    if (
      conn.refreshLock &&
      conn.refreshLock.leaseUntilMs > nowMs &&
      conn.refreshLock.holder !== holder
    ) {
      return Promise.resolve({ kind: 'busy', leaseUntilMs: conn.refreshLock.leaseUntilMs });
    }
    this.docs.set(uid, { ...conn, refreshLock: { holder, leaseUntilMs: nowMs + leaseMs } });
    return Promise.resolve({ kind: 'acquired', conn });
  }
  commitRefresh(uid: string, _holder: string, u: RefreshUpdate) {
    const conn = this.docs.get(uid);
    if (!conn) return Promise.reject(new Error('missing'));
    this.docs.set(uid, {
      ...conn,
      accessToken: u.accessToken,
      refreshToken: u.refreshToken,
      expiresAtMs: u.expiresAtMs,
      scopes: u.scopes.length > 0 ? u.scopes : conn.scopes,
      status: 'connected',
      refreshLock: null,
    });
    return Promise.resolve();
  }
  releaseLease(uid: string, holder: string) {
    const conn = this.docs.get(uid);
    if (conn?.refreshLock?.holder === holder) this.docs.set(uid, { ...conn, refreshLock: null });
    return Promise.resolve();
  }
  markReauthRequired(uid: string, _code: string, _nowMs: number) {
    const conn = this.docs.get(uid);
    if (conn) this.docs.set(uid, { ...conn, status: 'reauth_required', refreshLock: null });
    const p = this.projections.get(uid);
    if (p) this.projections.set(uid, { ...p, status: 'reauth_required' });
    return Promise.resolve();
  }
  deleteConnection(uid: string, _nowMs: number) {
    this.docs.delete(uid);
    this.projections.set(uid, {
      status: 'disconnected',
      locationId: null,
      locationName: null,
      timezone: null,
      scopes: [],
    });
    return Promise.resolve();
  }
  findUidsByLocation(locationId: string) {
    return Promise.resolve(
      [...this.docs.values()].filter((d) => d.locationId === locationId).map((d) => d.uid),
    );
  }
}

export class InMemoryOAuthStateRepo implements OAuthStateRepo {
  readonly states = new Map<
    string,
    { uid: string; returnPath: string; expiresAtMs: number; consumed: boolean }
  >();
  create(i: { stateHash: string; uid: string; returnPath: string; nowMs: number; ttlMs: number }) {
    this.states.set(i.stateHash, {
      uid: i.uid,
      returnPath: i.returnPath,
      expiresAtMs: i.nowMs + i.ttlMs,
      consumed: false,
    });
    return Promise.resolve();
  }
  consume(stateHash: string, nowMs: number) {
    const s = this.states.get(stateHash);
    if (!s || s.consumed || s.expiresAtMs <= nowMs) return Promise.resolve(null);
    s.consumed = true;
    return Promise.resolve({ uid: s.uid, returnPath: s.returnPath });
  }
}
