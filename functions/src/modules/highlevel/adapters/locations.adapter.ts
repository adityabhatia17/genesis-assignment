import type { Location } from '../../../contracts/hl-runtime.js';
import type { HlCallContext } from './context.js';

/** Served from the connection projection (fetched at connect time) — no HighLevel call per request. */
export async function getLocation(ctx: HlCallContext): Promise<Location> {
  const p = await ctx.loadProjection();
  return {
    id: ctx.locationId,
    name: p?.locationName ?? ctx.locationId,
    timezone: p?.timezone ?? null,
  };
}
