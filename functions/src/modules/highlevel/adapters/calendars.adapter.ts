import { z } from 'zod';
import type {
  Calendar,
  CalendarEvent,
  ItemsResult,
  RuntimeParsedParams,
} from '../../../contracts/hl-runtime.js';
import { LIMITS } from '../../../contracts/limits.js';
import { mapWithConcurrency } from '../../../shared/async.js';
import { HL_VERSION } from '../client/hl-http.client.js';
import { call, type HlCallContext } from './context.js';
import { nullIfBlank, str, toIso } from './normalize.js';

const RawCalendar = z
  .object({
    id: z.string(),
    name: z.unknown().optional(),
    description: z.unknown().optional(),
    isActive: z.unknown().optional(),
  })
  .passthrough();
const CalendarsResponse = z.object({ calendars: z.array(RawCalendar).default([]) }).passthrough();
const RawEvent = z
  .object({
    id: z.string(),
    calendarId: z.unknown().optional(),
    title: z.unknown().optional(),
    appointmentStatus: z.unknown().optional(),
    status: z.unknown().optional(),
    contactId: z.unknown().optional(),
    startTime: z.unknown(),
    endTime: z.unknown(),
  })
  .passthrough();
const EventsResponse = z.object({ events: z.array(RawEvent).default([]) }).passthrough();

export async function listCalendars(ctx: HlCallContext): Promise<ItemsResult<Calendar>> {
  const raw = CalendarsResponse.parse(
    await ctx.hl.request({
      method: 'GET',
      path: '/calendars/',
      version: HL_VERSION.calendars,
      query: { locationId: ctx.locationId },
      ...call(ctx),
    }),
  );
  return {
    items: raw.calendars.map((c) => ({
      id: c.id,
      name: nullIfBlank(c.name) ?? 'Untitled calendar',
      description: nullIfBlank(c.description),
      isActive: c.isActive !== false,
    })),
  };
}

export async function listEvents(
  ctx: HlCallContext,
  p: RuntimeParsedParams<'calendars.events'>,
): Promise<ItemsResult<CalendarEvent>> {
  const startTime = String(Date.parse(p.from));
  const endTime = String(Date.parse(p.to));
  const calendarIds = p.calendarId
    ? [p.calendarId]
    : (await listCalendars(ctx)).items
        .filter((c) => c.isActive)
        .slice(0, LIMITS.calendarFanOutMax)
        .map((c) => c.id);

  const pages = await mapWithConcurrency(calendarIds, 3, async (calendarId) =>
    EventsResponse.parse(
      await ctx.hl.request({
        method: 'GET',
        path: '/calendars/events',
        version: HL_VERSION.calendars,
        query: { locationId: ctx.locationId, calendarId, startTime, endTime },
        ...call(ctx),
      }),
    ).events.map((e) => ({ e, calendarId })),
  );

  const byId = new Map<string, CalendarEvent>();
  for (const { e, calendarId } of pages.flat()) {
    const start = toIso(e.startTime);
    const end = toIso(e.endTime);
    if (!start || !end || byId.has(e.id)) continue;
    byId.set(e.id, {
      id: e.id,
      calendarId: str(e.calendarId) ?? calendarId,
      title: nullIfBlank(e.title),
      status: nullIfBlank(e.appointmentStatus) ?? nullIfBlank(e.status),
      contactId: str(e.contactId),
      startTime: start,
      endTime: end,
    });
  }
  return {
    items: [...byId.values()].sort((a, b) => a.startTime.localeCompare(b.startTime)),
  };
}
