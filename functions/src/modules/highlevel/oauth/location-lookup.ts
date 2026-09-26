import { z } from 'zod';

const LocationResponse = z.object({
  location: z
    .object({
      id: z.string(),
      name: z.string().optional(),
      timezone: z.string().nullable().optional(),
    })
    .passthrough(),
});

export interface LocationLookup {
  getLocation(
    accessToken: string,
    locationId: string,
  ): Promise<{ name: string; timezone: string | null } | null>;
}

export function createLocationLookup(o: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): LocationLookup {
  const doFetch = o.fetchImpl ?? fetch;
  return {
    async getLocation(accessToken, locationId) {
      const res = await doFetch(`${o.baseUrl}/locations/${encodeURIComponent(locationId)}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: '2021-07-28',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const parsed = LocationResponse.safeParse(await res.json());
      if (!parsed.success) return null;
      return {
        name: parsed.data.location.name ?? locationId,
        timezone: parsed.data.location.timezone ?? null,
      };
    },
  };
}
