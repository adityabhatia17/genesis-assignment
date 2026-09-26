import { buildRuntimeRequest } from '@/services/api/hl-runtime.api';

describe('buildRuntimeRequest', () => {
  it('maps reads to GET with path params and query', () => {
    expect(
      buildRuntimeRequest('p1', 'conversations.messages', { conversationId: 'c 1', limit: 5 }),
    ).toEqual({
      method: 'GET',
      path: '/v1/projects/p1/hl/conversations/c%201/messages',
      query: { limit: 5 },
    });
  });
  it('maps a path-only read to GET with an empty query', () => {
    expect(buildRuntimeRequest('p1', 'contacts.get', { contactId: 'c1' })).toEqual({
      method: 'GET',
      path: '/v1/projects/p1/hl/contacts/c1',
      query: {},
    });
  });
  it('refuses a missing path parameter', () => {
    expect(() => buildRuntimeRequest('p1', 'contacts.get', {})).toThrow(/contactId/);
  });
});
