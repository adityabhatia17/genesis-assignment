import type { RuntimeConfig } from '../../../config/runtime-config.js';
import type { OAuthRedirectReason } from '../../../contracts/api.js';
import { LIMITS } from '../../../contracts/limits.js';
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
    await this.d.states.create({
      stateHash: sha256Hex(state),
      uid,
      returnPath,
      nowMs: this.d.clock.now(),
      ttlMs: LIMITS.oauthStateTtlMs,
    });
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
  async handleCallback(q: {
    code?: string | undefined;
    state?: string | undefined;
    error?: string | undefined;
  }): Promise<string> {
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
      const location = await this.d.locations
        .getLocation(token.access_token, token.locationId)
        .catch(() => null);
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
      this.d.logger.info('oauth.callback.ok', {
        uidHash: uidHash(uid),
        locationId: token.locationId,
      });
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
