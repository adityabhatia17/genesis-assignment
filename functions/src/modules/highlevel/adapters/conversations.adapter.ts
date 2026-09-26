import { z } from 'zod';
import type {
  Conversation,
  Message,
  Page,
  RuntimeParsedParams,
} from '../../../contracts/hl-runtime.js';
import { HL_VERSION } from '../client/hl-http.client.js';
import { call, type HlCallContext } from './context.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { messageTypeLabel, nullIfBlank, str, toIso } from './normalize.js';

const RawConversation = z
  .object({
    id: z.string(),
    contactId: z.unknown().optional(),
    contactName: z.unknown().optional(),
    fullName: z.unknown().optional(),
    lastMessageBody: z.unknown().optional(),
    lastMessageType: z.unknown().optional(),
    lastMessageDate: z.unknown().optional(),
    dateUpdated: z.unknown().optional(),
    unreadCount: z.unknown().optional(),
    sort: z.array(z.union([z.number(), z.string()])).optional(),
  })
  .passthrough();
const SearchResponse = z
  .object({
    conversations: z.array(RawConversation).default([]),
    total: z.number().optional(),
  })
  .passthrough();

const RawMessage = z
  .object({
    id: z.string(),
    conversationId: z.unknown().optional(),
    body: z.unknown().optional(),
    direction: z.unknown().optional(),
    messageType: z.unknown().optional(),
    type: z.unknown().optional(),
    status: z.unknown().optional(),
    dateAdded: z.unknown().optional(),
  })
  .passthrough();
const MessagesPage = z
  .object({
    messages: z.array(RawMessage).default([]),
    nextPage: z.boolean().optional(),
    lastMessageId: z.string().optional(),
  })
  .passthrough();
const MessagesResponse = z.union([
  z.object({ messages: MessagesPage }).passthrough(),
  MessagesPage,
]);

export async function listConversations(
  ctx: HlCallContext,
  p: RuntimeParsedParams<'conversations.list'>,
): Promise<Page<Conversation>> {
  const raw = SearchResponse.parse(
    await ctx.hl.request({
      method: 'GET',
      path: '/conversations/search',
      version: HL_VERSION.conversations,
      query: {
        locationId: ctx.locationId,
        limit: p.limit,
        sort: 'desc',
        sortBy: 'last_message_date',
        query: p.query,
        contactId: p.contactId,
        startAfterDate: p.cursor ? decodeCursor('conversations', p.cursor).sad : undefined,
      },
      ...call(ctx),
    }),
  );
  const last = raw.conversations.at(-1);
  const sad = last
    ? (last.sort?.[0] ??
      (typeof last.lastMessageDate === 'number' ? last.lastMessageDate : undefined))
    : undefined;
  const nextCursor =
    last && sad !== undefined && raw.conversations.length === p.limit
      ? encodeCursor({ k: 'conversations', sad })
      : null;
  return {
    items: raw.conversations.map((r) => ({
      id: r.id,
      contactId: str(r.contactId),
      contactName: nullIfBlank(r.contactName) ?? nullIfBlank(r.fullName),
      lastMessageBody: nullIfBlank(r.lastMessageBody),
      lastMessageType: messageTypeLabel(r.lastMessageType),
      lastMessageDate: toIso(r.lastMessageDate ?? r.dateUpdated),
      unreadCount: typeof r.unreadCount === 'number' ? r.unreadCount : 0,
    })),
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

export async function listMessages(
  ctx: HlCallContext,
  p: RuntimeParsedParams<'conversations.messages'>,
): Promise<Page<Message>> {
  const parsed = MessagesResponse.parse(
    await ctx.hl.request({
      method: 'GET',
      path: `/conversations/${encodeURIComponent(p.conversationId)}/messages`,
      version: HL_VERSION.conversations,
      query: {
        limit: p.limit,
        lastMessageId: p.cursor ? decodeCursor('messages', p.cursor).lmi : undefined,
      },
      ...call(ctx),
    }),
  );
  const nested = z.object({ messages: MessagesPage }).safeParse(parsed);
  const page = nested.success ? nested.data.messages : MessagesPage.parse(parsed);
  const nextCursor =
    page.nextPage && page.lastMessageId
      ? encodeCursor({ k: 'messages', lmi: page.lastMessageId })
      : null;
  return {
    items: page.messages.map((m) => ({
      id: m.id,
      conversationId: str(m.conversationId) ?? p.conversationId,
      body: nullIfBlank(m.body),
      direction: m.direction === 'outbound' ? 'outbound' : 'inbound',
      type: messageTypeLabel(m.messageType ?? m.type),
      status: nullIfBlank(m.status),
      dateAdded: toIso(m.dateAdded),
    })),
    nextCursor,
    hasMore: nextCursor !== null,
  };
}
