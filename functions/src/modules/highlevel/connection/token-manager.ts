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
    if (conn.source === 'pit' || conn.expiresAtMs - this.d.clock.now() > this.skewMs)
      return this.grant(conn);
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
      const outcome = await this.d.repo.tryAcquireRefreshLease(
        uid,
        holder,
        this.d.clock.now(),
        this.leaseMs,
        this.skewMs,
        force && attempt === 0,
      );
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

  private async performRefresh(
    uid: string,
    holder: string,
    conn: ConnectionRecord,
  ): Promise<AccessGrant> {
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
      this.d.logger.warn('token.refresh.failed', {
        uidHash: uidHash(uid),
        error: serializeError(err),
      });
      throw new AppError('HL_UNAVAILABLE', undefined, undefined, { cause: err });
    }

    const now = this.d.clock.now();
    const expiresAtMs = now + result.expires_in * 1000;
    await retry(
      () =>
        this.d.repo.commitRefresh(uid, holder, {
          accessToken: this.d.cipher.encrypt(result.access_token, uid, 'access'),
          refreshToken: this.d.cipher.encrypt(result.refresh_token, uid, 'refresh'),
          expiresAtMs,
          scopes: result.scope.split(/\s+/).filter(Boolean),
          nowMs: now,
        }),
      { attempts: 3, baseMs: 200 },
    );
    this.d.logger.info('token.refresh.ok', { uidHash: uidHash(uid) });
    return {
      accessToken: result.access_token,
      locationId: conn.locationId,
      expiresAtMs,
      scopes: conn.scopes,
    };
  }

  private grant(conn: ConnectionRecord): AccessGrant {
    let accessToken: string;
    try {
      accessToken = this.d.cipher.decrypt(conn.accessToken, conn.uid, 'access');
    } catch (err) {
      this.d.logger.error('cipher.decrypt_failed', {
        uidHash: uidHash(conn.uid),
        error: serializeError(err),
      });
      throw new AppError('HL_REAUTH_REQUIRED');
    }
    return {
      accessToken,
      locationId: conn.locationId,
      expiresAtMs: conn.expiresAtMs,
      scopes: conn.scopes,
    };
  }
}
