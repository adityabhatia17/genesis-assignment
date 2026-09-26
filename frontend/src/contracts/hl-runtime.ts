// GENERATED FILE — DO NOT EDIT.
// Source of truth: functions/src/contracts. Run `npm run contracts:sync` from the repo root.

import { z } from 'zod';
import { LIMITS } from './limits.js';

export const HL_SCOPES = [
  'contacts.readonly',
  'contacts.write',
  'conversations.readonly',
  'conversations/message.readonly',
  'conversations/message.write',
  'calendars.readonly',
  'calendars/events.readonly',
  'locations.readonly',
] as const;

/** Out of v1 (R-B6). Webhook event names the preview host may push. */
export const RUNTIME_EVENT_NAMES = [] as const;
export type RuntimeEventName = (typeof RUNTIME_EVENT_NAMES)[number];

// ── Models (what generated code receives) ────────────────────────────────────
export const LocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string().nullable(),
});
export type Location = z.infer<typeof LocationSchema>;

export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  companyName: z.string().nullable(),
  tags: z.array(z.string()),
  dateAdded: z.string().nullable(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  contactId: z.string().nullable(),
  contactName: z.string().nullable(),
  lastMessageBody: z.string().nullable(),
  lastMessageType: z.string().nullable(),
  lastMessageDate: z.string().nullable(),
  unreadCount: z.number(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  body: z.string().nullable(),
  direction: z.enum(['inbound', 'outbound']),
  type: z.string().nullable(),
  status: z.string().nullable(),
  dateAdded: z.string().nullable(),
});
export type Message = z.infer<typeof MessageSchema>;

export const CalendarSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
});
export type Calendar = z.infer<typeof CalendarSchema>;

export const CalendarEventSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  contactId: z.string().nullable(),
  startTime: z.string(),
  endTime: z.string(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const FreeSlotsSchema = z.object({
  calendarId: z.string(),
  timezone: z.string().nullable(),
  days: z.array(z.object({ date: z.string(), slots: z.array(z.string()) })),
});
export type FreeSlots = z.infer<typeof FreeSlotsSchema>;

export const SendMessageResultSchema = z.object({
  conversationId: z.string().nullable(),
  messageId: z.string().nullable(),
});
export type SendMessageResult = z.infer<typeof SendMessageResultSchema>;

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable(), hasMore: z.boolean() });
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
export interface ItemsResult<T> {
  items: T[];
}

// ── Params (what generated code sends) ───────────────────────────────────────
const HlId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');
const Limit = z.coerce.number().int().min(1).max(LIMITS.pageLimitMax).default(LIMITS.pageLimitDefault);
const Cursor = z.string().min(1).max(2_048);
const Query = z.string().trim().max(200);
const IsoDateTime = z.iso.datetime({ offset: true });
const MAX_RANGE_MS = LIMITS.calendarRangeMaxDays * 24 * 60 * 60 * 1000;

const rangeOk = (v: { from: string; to: string }) => {
  const span = Date.parse(v.to) - Date.parse(v.from);
  return span > 0 && span <= MAX_RANGE_MS;
};
const RANGE_MESSAGE = {
  message: `"to" must be after "from" and at most ${LIMITS.calendarRangeMaxDays} days later`,
  path: ['to'],
};

const contactFields = {
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.email().max(254).optional(),
  phone: z.string().trim().regex(/^[+0-9 ()-]{3,32}$/, 'Invalid phone').optional(),
  companyName: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
};

export const EmptyParams = z.strictObject({});
export const ContactsListParams = z.strictObject({
  query: Query.optional(),
  limit: Limit,
  cursor: Cursor.optional(),
});
export const ContactGetParams = z.strictObject({ contactId: HlId });
export const ContactCreateParams = z
  .strictObject(contactFields)
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field' });
export const ContactUpdateParams = z
  .strictObject({ contactId: HlId, ...contactFields })
  .refine(
    ({ contactId: _id, ...rest }) => Object.values(rest).some((x) => x !== undefined),
    { message: 'Provide at least one field to update' },
  );
export const ConversationsListParams = z.strictObject({
  query: Query.optional(),
  contactId: HlId.optional(),
  limit: Limit,
  cursor: Cursor.optional(),
});
export const MessagesListParams = z.strictObject({
  conversationId: HlId,
  limit: Limit,
  cursor: Cursor.optional(),
});
export const SendMessageParams = z
  .strictObject({
    contactId: HlId,
    type: z.enum(['SMS', 'Email']),
    message: z.string().trim().min(1).max(1_600),
    subject: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.type !== 'Email' || v.subject !== undefined, {
    message: 'subject is required for Email',
    path: ['subject'],
  });
export const CalendarEventsParams = z
  .strictObject({ from: IsoDateTime, to: IsoDateTime, calendarId: HlId.optional() })
  .refine(rangeOk, RANGE_MESSAGE);
export const FreeSlotsParams = z
  .strictObject({
    calendarId: HlId,
    from: IsoDateTime,
    to: IsoDateTime,
    timezone: z.string().max(64).optional(),
  })
  .refine(rangeOk, RANGE_MESSAGE);

// ── Manifest ─────────────────────────────────────────────────────────────────
export const RUNTIME_METHOD_NAMES = [
  'location.get',
  'contacts.list',
  'contacts.get',
  'conversations.list',
  'conversations.messages',
  'calendars.list',
  'calendars.events',
] as const;
export type RuntimeMethodName = (typeof RUNTIME_METHOD_NAMES)[number];

export interface RuntimeMethodSpec {
  readonly verb: 'GET';
  /** Relative to /v1/projects/:projectId */
  readonly path: string;
  readonly params: z.ZodType;
  readonly write: boolean;
  readonly scopes: readonly (typeof HL_SCOPES)[number][];
}

export const RUNTIME_METHODS = {
  'location.get': {
    verb: 'GET',
    path: '/hl/location',
    params: EmptyParams,
    write: false,
    scopes: ['locations.readonly'],
  },
  'contacts.list': {
    verb: 'GET',
    path: '/hl/contacts',
    params: ContactsListParams,
    write: false,
    scopes: ['contacts.readonly'],
  },
  'contacts.get': {
    verb: 'GET',
    path: '/hl/contacts/:contactId',
    params: ContactGetParams,
    write: false,
    scopes: ['contacts.readonly'],
  },
  'conversations.list': {
    verb: 'GET',
    path: '/hl/conversations',
    params: ConversationsListParams,
    write: false,
    scopes: ['conversations.readonly'],
  },
  'conversations.messages': {
    verb: 'GET',
    path: '/hl/conversations/:conversationId/messages',
    params: MessagesListParams,
    write: false,
    scopes: ['conversations/message.readonly'],
  },
  'calendars.list': {
    verb: 'GET',
    path: '/hl/calendars',
    params: EmptyParams,
    write: false,
    scopes: ['calendars.readonly'],
  },
  'calendars.events': {
    verb: 'GET',
    path: '/hl/calendars/events',
    params: CalendarEventsParams,
    write: false,
    scopes: ['calendars.readonly', 'calendars/events.readonly'],
  },
} as const satisfies Record<RuntimeMethodName, RuntimeMethodSpec>;

export type RuntimeParams<M extends RuntimeMethodName> = z.input<(typeof RUNTIME_METHODS)[M]['params']>;
export type RuntimeParsedParams<M extends RuntimeMethodName> = z.output<(typeof RUNTIME_METHODS)[M]['params']>;

/** OAuth scopes the given methods need, deduplicated, in HL_SCOPES order. */
export const scopesForMethods = (methods: readonly RuntimeMethodName[]): (typeof HL_SCOPES)[number][] => {
  const needed = new Set<(typeof HL_SCOPES)[number]>(methods.flatMap((m) => RUNTIME_METHODS[m].scopes));
  return HL_SCOPES.filter((s) => needed.has(s));
};

/**
 * Methods the connection can actually call. Without a connection (null/empty grant) all
 * methods are described, so generated apps target them and show "connect HighLevel" errors.
 */
export const availableMethodNames = (
  enabled: readonly RuntimeMethodName[],
  grantedScopes: readonly string[] | null,
): RuntimeMethodName[] =>
  !grantedScopes || grantedScopes.length === 0
    ? [...enabled]
    : enabled.filter((m) => RUNTIME_METHODS[m].scopes.every((s) => grantedScopes.includes(s)));

export const pathParamNames = (path: string): string[] =>
  [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] ?? '');
