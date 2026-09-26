import { listEvents } from '../../../src/modules/highlevel/adapters/calendars.adapter.js';
import { listContacts } from '../../../src/modules/highlevel/adapters/contacts.adapter.js';
import {
  listConversations,
  listMessages,
} from '../../../src/modules/highlevel/adapters/conversations.adapter.js';
import { decodeCursor } from '../../../src/modules/highlevel/adapters/cursor.js';
import { getLocation } from '../../../src/modules/highlevel/adapters/locations.adapter.js';
import { fakeHl } from '../../helpers/fake-hl.js';

const contact = (i: number) => ({
  id: `c${i}`,
  firstName: `F${i}`,
  lastName: 'L',
  email: `c${i}@x.test`,
  phone: null,
  tags: ['vip', 3],
  dateAdded: '2026-09-01T10:00:00.000Z',
  searchAfter: [1_000 + i, `c${i}`],
});

describe('contacts adapter', () => {
  it('maps search request/response and paginates with searchAfter', async () => {
    const { ctx, calls } = fakeHl(() => ({ contacts: [contact(1), contact(2)], total: 36 }));
    const page = await listContacts(ctx, { limit: 2, query: 'ava' });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/contacts/search',
      version: '2021-07-28',
    });
    expect(calls[0]!.body).toEqual({
      locationId: 'loc_1',
      pageLimit: 2,
      query: 'ava',
      sort: [{ field: 'dateAdded', direction: 'desc' }],
    });
    expect(page.items[0]).toEqual({
      id: 'c1',
      name: 'F1 L',
      firstName: 'F1',
      lastName: 'L',
      email: 'c1@x.test',
      phone: null,
      companyName: null,
      tags: ['vip'],
      dateAdded: '2026-09-01T10:00:00.000Z',
    });
    expect(page.hasMore).toBe(true);
    expect(decodeCursor('contacts', page.nextCursor!)).toEqual({ k: 'contacts', sa: [1002, 'c2'] });

    await listContacts(ctx, { limit: 2, cursor: page.nextCursor! });
    expect((calls[1]!.body as Record<string, unknown>)['searchAfter']).toEqual([1002, 'c2']);
  });
  it('ends pagination on a short page', async () => {
    const { ctx } = fakeHl(() => ({ contacts: [contact(1)] }));
    const page = await listContacts(ctx, { limit: 20 });
    expect(page).toMatchObject({ nextCursor: null, hasMore: false });
  });
});

describe('conversations adapter', () => {
  it('lists with startAfterDate cursor', async () => {
    const rows = [
      {
        id: 'v1',
        contactId: 'c1',
        fullName: 'Ava',
        lastMessageBody: 'hi',
        lastMessageType: 'TYPE_SMS',
        lastMessageDate: 1_700_000_000_000,
        unreadCount: 2,
        sort: [1_700_000_000_000],
      },
    ];
    const { ctx, calls } = fakeHl(() => ({ conversations: rows, total: 5 }));
    const page = await listConversations(ctx, { limit: 1 });
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: '/conversations/search',
      version: '2021-04-15',
      query: { locationId: 'loc_1', limit: 1, sort: 'desc', sortBy: 'last_message_date' },
    });
    expect(page.items[0]).toMatchObject({
      id: 'v1',
      contactName: 'Ava',
      lastMessageType: 'SMS',
      lastMessageDate: '2023-11-14T22:13:20.000Z',
      unreadCount: 2,
    });
    expect(decodeCursor('conversations', page.nextCursor!)).toEqual({
      k: 'conversations',
      sad: 1_700_000_000_000,
    });
  });
  it.each([
    [
      'nested',
      {
        messages: {
          lastMessageId: 'm2',
          nextPage: true,
          messages: [
            {
              id: 'm1',
              body: 'hey',
              direction: 'inbound',
              messageType: 'TYPE_SMS',
              dateAdded: '2026-09-01T00:00:00Z',
            },
          ],
        },
      },
    ],
    [
      'flat',
      {
        lastMessageId: 'm2',
        nextPage: true,
        messages: [
          {
            id: 'm1',
            body: 'hey',
            direction: 'inbound',
            messageType: 'TYPE_SMS',
            dateAdded: '2026-09-01T00:00:00Z',
          },
        ],
      },
    ],
  ])('accepts %s message responses', async (_n, body) => {
    const { ctx } = fakeHl(() => body);
    const page = await listMessages(ctx, { conversationId: 'v1', limit: 20 });
    expect(page.items[0]).toEqual({
      id: 'm1',
      conversationId: 'v1',
      body: 'hey',
      direction: 'inbound',
      type: 'SMS',
      status: null,
      dateAdded: '2026-09-01T00:00:00.000Z',
    });
    expect(decodeCursor('messages', page.nextCursor!)).toEqual({ k: 'messages', lmi: 'm2' });
  });
});

describe('calendars adapter', () => {
  it('fans out across active calendars and sorts events', async () => {
    const { ctx, calls } = fakeHl((req) => {
      if (req.path === '/calendars/') {
        return {
          calendars: [
            { id: 'k1', name: 'A', isActive: true },
            { id: 'k2', name: 'B' },
            { id: 'k3', name: 'Off', isActive: false },
          ],
        };
      }
      const id = req.query?.['calendarId'];
      return {
        events: [
          {
            id: `e-${String(id)}`,
            calendarId: id,
            title: 'Visit',
            appointmentStatus: 'confirmed',
            startTime: id === 'k1' ? '2026-10-03T10:00:00Z' : '2026-10-02T10:00:00Z',
            endTime: '2026-10-03T11:00:00Z',
          },
        ],
      };
    });
    const out = await listEvents(ctx, { from: '2026-10-01T00:00:00Z', to: '2026-10-08T00:00:00Z' });
    expect(out.items.map((e) => e.id)).toEqual(['e-k2', 'e-k1']);
    const eventCalls = calls.filter((c) => c.path === '/calendars/events');
    expect(eventCalls).toHaveLength(2);
    expect(eventCalls[0]!.query).toMatchObject({
      startTime: String(Date.parse('2026-10-01T00:00:00Z')),
      endTime: String(Date.parse('2026-10-08T00:00:00Z')),
    });
  });
});

describe('location adapter', () => {
  it('reads from the connection projection without calling HighLevel', async () => {
    const { ctx, calls } = fakeHl(() => ({}));
    expect(await getLocation(ctx)).toEqual({
      id: 'loc_1',
      name: 'Demo Clinic',
      timezone: 'America/New_York',
    });
    expect(calls).toHaveLength(0);
  });
});
