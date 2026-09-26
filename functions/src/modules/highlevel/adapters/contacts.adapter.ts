import { z } from 'zod';
import type { Contact, Page, RuntimeParsedParams } from '../../../contracts/hl-runtime.js';
import { HL_VERSION } from '../client/hl-http.client.js';
import { call, type HlCallContext } from './context.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { displayName, isoToMs, nullIfBlank, toIso } from './normalize.js';

const RawContact = z
  .object({
    id: z.string(),
    firstName: z.unknown().optional(),
    lastName: z.unknown().optional(),
    contactName: z.unknown().optional(),
    name: z.unknown().optional(),
    email: z.unknown().optional(),
    phone: z.unknown().optional(),
    companyName: z.unknown().optional(),
    tags: z.array(z.unknown()).optional(),
    dateAdded: z.unknown().optional(),
    searchAfter: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .passthrough();
type RawContact = z.infer<typeof RawContact>;

const SearchResponse = z
  .object({
    contacts: z.array(RawContact).default([]),
    total: z.number().optional(),
  })
  .passthrough();
export const SingleResponse = z.object({ contact: RawContact }).passthrough();

export function toContact(r: RawContact): Contact {
  return {
    id: r.id,
    name: displayName(r),
    firstName: nullIfBlank(r.firstName),
    lastName: nullIfBlank(r.lastName),
    email: nullIfBlank(r.email),
    phone: nullIfBlank(r.phone),
    companyName: nullIfBlank(r.companyName),
    tags: (r.tags ?? []).filter((t): t is string => typeof t === 'string'),
    dateAdded: toIso(r.dateAdded),
  };
}

export async function listContacts(
  ctx: HlCallContext,
  p: RuntimeParsedParams<'contacts.list'>,
): Promise<Page<Contact>> {
  const body: Record<string, unknown> = {
    locationId: ctx.locationId,
    pageLimit: p.limit,
  };
  if (p.query) body['query'] = p.query;
  body['sort'] = [{ field: 'dateAdded', direction: 'desc' }];
  if (p.cursor) body['searchAfter'] = decodeCursor('contacts', p.cursor).sa;

  const raw = SearchResponse.parse(
    await ctx.hl.request({
      method: 'POST',
      path: '/contacts/search',
      version: HL_VERSION.contacts,
      body,
      ...call(ctx),
    }),
  );
  const last = raw.contacts.at(-1);
  const nextCursor =
    last && raw.contacts.length === p.limit
      ? encodeCursor({
          k: 'contacts',
          sa: last.searchAfter ?? [
            isoToMs(toIso(last.dateAdded) ?? '1970-01-01T00:00:00Z'),
            last.id,
          ],
        })
      : null;
  return {
    items: raw.contacts.map(toContact),
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

export async function countContacts(ctx: HlCallContext): Promise<number | null> {
  const raw = SearchResponse.parse(
    await ctx.hl.request({
      method: 'POST',
      path: '/contacts/search',
      version: HL_VERSION.contacts,
      body: { locationId: ctx.locationId, pageLimit: 1 },
      ...call(ctx),
    }),
  );
  return raw.total ?? null;
}

export async function getContact(
  ctx: HlCallContext,
  p: RuntimeParsedParams<'contacts.get'>,
): Promise<Contact> {
  const raw = SingleResponse.parse(
    await ctx.hl.request({
      method: 'GET',
      path: `/contacts/${encodeURIComponent(p.contactId)}`,
      version: HL_VERSION.contacts,
      ...call(ctx),
    }),
  );
  return toContact(raw.contact);
}
