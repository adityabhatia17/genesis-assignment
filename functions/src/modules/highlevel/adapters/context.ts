import type { ConnectionProjection } from '../connection/connection.repo.js';
import type { HlHttp } from '../client/hl-http.client.js';

export interface HlCallContext {
  readonly hl: HlHttp;
  readonly accessToken: string;
  readonly locationId: string;
  loadProjection(): Promise<ConnectionProjection | null>;
}

export const call = (ctx: HlCallContext) => ({
  accessToken: ctx.accessToken,
  locationId: ctx.locationId,
});
