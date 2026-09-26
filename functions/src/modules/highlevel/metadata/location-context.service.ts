import { LIMITS } from '../../../contracts/limits.js';
import {
  availableMethodNames,
  RUNTIME_METHOD_NAMES,
  type RuntimeMethodName,
} from '../../../contracts/hl-runtime.js';
import { withTimeout } from '../../../shared/async.js';
import type { Clock } from '../../../shared/clock.js';
import { serializeError, type Logger } from '../../../shared/logger.js';
import { listCalendars } from '../adapters/calendars.adapter.js';
import { countContacts } from '../adapters/contacts.adapter.js';
import type { HlHttp } from '../client/hl-http.client.js';
import type { ConnectionProjection, ConnectionRepo } from '../connection/connection.repo.js';
import type { TokenManager } from '../connection/token-manager.js';

export interface HighLevelContext {
  status: 'connected' | 'reauth_required' | 'disconnected';
  locationName: string | null;
  timezone: string | null;
  calendars: string[];
  contactsTotal: number | null;
  availableMethods: RuntimeMethodName[];
  note: string | null;
}

export interface LocationContextPort {
  getContext(uid: string): Promise<HighLevelContext>;
}

export interface LocationContextDeps {
  connections: Pick<ConnectionRepo, 'getProjection'>;
  tokens: Pick<TokenManager, 'getAccessGrant'>;
  hl: HlHttp;
  clock: Clock;
  logger: Logger;
  ttlMs?: number;
  timeoutMs?: number;
}

export class LocationContextService implements LocationContextPort {
  private readonly cache = new Map<string, { at: number; value: HighLevelContext }>();

  constructor(private readonly d: LocationContextDeps) {}

  async getContext(uid: string): Promise<HighLevelContext> {
    const p = await this.d.connections.getProjection(uid);
    if (!p || p.status !== 'connected' || !p.locationId) {
      return {
        status: p?.status ?? 'disconnected',
        locationName: null,
        timezone: null,
        calendars: [],
        contactsTotal: null,
        availableMethods: [],
        note: 'HighLevel is not connected yet.',
      };
    }
    const cached = this.cache.get(p.locationId);
    if (cached && this.d.clock.now() - cached.at < (this.d.ttlMs ?? 300_000)) return cached.value;

    let value: HighLevelContext;
    try {
      value = await withTimeout(
        this.fetch(uid, p),
        this.d.timeoutMs ?? 2_500,
        () => new Error('timeout'),
      );
    } catch (err) {
      this.d.logger.warn('hl.context.unavailable', { error: serializeError(err) });
      value = {
        status: 'connected',
        locationName: p.locationName,
        timezone: p.timezone,
        calendars: [],
        contactsTotal: null,
        availableMethods: [...RUNTIME_METHOD_NAMES],
        note: 'HighLevel metadata unavailable right now.',
      };
    }
    this.cache.set(p.locationId, { at: this.d.clock.now(), value });
    return value;
  }

  private async fetch(uid: string, p: ConnectionProjection): Promise<HighLevelContext> {
    const grant = await this.d.tokens.getAccessGrant(uid);
    const ctx = {
      hl: this.d.hl,
      accessToken: grant.accessToken,
      locationId: grant.locationId,
      loadProjection: () => Promise.resolve(p),
    };
    const [calendars, total] = await Promise.all([listCalendars(ctx), countContacts(ctx)]);
    return {
      status: 'connected',
      locationName: p.locationName,
      timezone: p.timezone,
      calendars: calendars.items.slice(0, LIMITS.externalCalendarsMax).map((c) => c.name),
      contactsTotal: total,
      availableMethods: availableMethodNames(RUNTIME_METHOD_NAMES, grant.scopes),
      note: null,
    };
  }
}
