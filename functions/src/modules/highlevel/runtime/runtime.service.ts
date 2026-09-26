import {
  RUNTIME_METHODS,
  type RuntimeMethodName,
  type RuntimeParsedParams,
} from '../../../contracts/hl-runtime.js';
import { AppError } from '../../../shared/app-error.js';
import { serializeError, type Logger } from '../../../shared/logger.js';
import type { ProjectAccessPort } from '../../projects/project-access.js';
import { listCalendars, listEvents } from '../adapters/calendars.adapter.js';
import { getContact, listContacts } from '../adapters/contacts.adapter.js';
import { listConversations, listMessages } from '../adapters/conversations.adapter.js';
import type { HlCallContext } from '../adapters/context.js';
import { getLocation } from '../adapters/locations.adapter.js';
import { HlApiError, hlErrorToAppError } from '../client/hl-errors.js';
import type { HlHttp } from '../client/hl-http.client.js';
import type { ConnectionRepo } from '../connection/connection.repo.js';
import type { AccessGrant, TokenManager } from '../connection/token-manager.js';

export type RuntimeHandler = (ctx: HlCallContext, params: unknown) => Promise<unknown>;

export const RUNTIME_HANDLERS: Record<RuntimeMethodName, RuntimeHandler> = {
  'location.get': (ctx) => getLocation(ctx),
  'contacts.list': (ctx, p) => listContacts(ctx, p as RuntimeParsedParams<'contacts.list'>),
  'contacts.get': (ctx, p) => getContact(ctx, p as RuntimeParsedParams<'contacts.get'>),
  'conversations.list': (ctx, p) =>
    listConversations(ctx, p as RuntimeParsedParams<'conversations.list'>),
  'conversations.messages': (ctx, p) =>
    listMessages(ctx, p as RuntimeParsedParams<'conversations.messages'>),
  'calendars.list': (ctx) => listCalendars(ctx),
  'calendars.events': (ctx, p) => listEvents(ctx, p as RuntimeParsedParams<'calendars.events'>),
};

type TokenPort = Pick<TokenManager, 'getAccessGrant' | 'forceRefresh' | 'markReauth'>;

export interface RuntimeServiceDeps {
  projects: ProjectAccessPort;
  tokens: TokenPort;
  connections: ConnectionRepo;
  hl: HlHttp;
  handlers?: Partial<Record<RuntimeMethodName, RuntimeHandler>>;
}

export class RuntimeService {
  private readonly handlers: Record<RuntimeMethodName, RuntimeHandler>;

  constructor(private readonly d: RuntimeServiceDeps) {
    this.handlers = { ...RUNTIME_HANDLERS, ...d.handlers };
  }

  async invoke(
    uid: string,
    projectId: string,
    method: RuntimeMethodName,
    rawParams: unknown,
    log: Logger,
  ): Promise<unknown> {
    const spec = RUNTIME_METHODS[method];
    const params: unknown = spec.params.parse(rawParams);

    const project = await this.d.projects.getOwnedActive(uid, projectId);
    let grant = await this.d.tokens.getAccessGrant(uid);
    if (grant.scopes.length > 0 && !spec.scopes.every((s) => grant.scopes.includes(s))) {
      throw new AppError('HL_SCOPE_MISSING');
    }
    if (project.locationId && project.locationId !== grant.locationId) {
      throw new AppError('PROJECT_LOCATION_MISMATCH');
    }
    if (!project.locationId) {
      await this.d.projects.bindLocation(uid, projectId, grant.locationId).catch((err: unknown) => {
        log.warn('project.bind_location_failed', { error: serializeError(err) });
      });
    }

    const handler = this.handlers[method];
    const ctxFor = (g: AccessGrant): HlCallContext => ({
      hl: this.d.hl,
      accessToken: g.accessToken,
      locationId: g.locationId,
      loadProjection: () => this.d.connections.getProjection(uid),
    });

    try {
      return await handler(ctxFor(grant), params);
    } catch (err) {
      if (!(err instanceof HlApiError)) throw err;
      if (err.status !== 401) throw hlErrorToAppError(err);
      grant = await this.d.tokens.forceRefresh(uid, grant.expiresAtMs);
      try {
        return await handler(ctxFor(grant), params);
      } catch (err2) {
        if (err2 instanceof HlApiError && err2.status === 401) {
          throw await this.d.tokens.markReauth(uid, 'hl_401_after_refresh');
        }
        throw err2 instanceof HlApiError ? hlErrorToAppError(err2) : err2;
      }
    }
  }
}
