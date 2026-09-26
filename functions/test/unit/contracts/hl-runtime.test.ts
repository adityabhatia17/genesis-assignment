import { DEFAULT_HL_SCOPES } from '../../../src/config/params.js';
import {
  availableMethodNames,
  CalendarEventsParams,
  ContactsListParams,
  pathParamNames,
  RUNTIME_METHOD_NAMES,
  RUNTIME_METHODS,
  scopesForMethods,
  SendMessageParams,
} from '../../../src/contracts/hl-runtime.js';

describe('runtime manifest', () => {
  it('has a spec for every method and path params exist in the schema', () => {
    for (const name of RUNTIME_METHOD_NAMES) {
      const spec = RUNTIME_METHODS[name];
      const shape = (spec.params as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      for (const p of pathParamNames(spec.path)) expect(Object.keys(shape)).toContain(p);
    }
  });
  it('is the seven read methods', () => {
    expect([...RUNTIME_METHOD_NAMES]).toEqual([
      'location.get',
      'contacts.list',
      'contacts.get',
      'conversations.list',
      'conversations.messages',
      'calendars.list',
      'calendars.events',
    ]);
    expect(RUNTIME_METHOD_NAMES.every((m) => !RUNTIME_METHODS[m].write)).toBe(true);
  });
  it('keeps the default OAuth scopes equal to what the methods need', () => {
    expect(scopesForMethods(RUNTIME_METHOD_NAMES).join(' ')).toBe(DEFAULT_HL_SCOPES);
  });
  it('offers only methods whose scopes were granted (all when not connected)', () => {
    expect(availableMethodNames(RUNTIME_METHOD_NAMES, null)).toEqual([...RUNTIME_METHOD_NAMES]);
    expect(availableMethodNames(RUNTIME_METHOD_NAMES, ['contacts.readonly', 'locations.readonly'])).toEqual([
      'location.get',
      'contacts.list',
      'contacts.get',
    ]);
  });
  it('coerces and defaults limit', () => {
    expect(ContactsListParams.parse({ limit: '5' })).toEqual({ limit: 5 });
    expect(ContactsListParams.parse({})).toEqual({ limit: 20 });
    expect(() => ContactsListParams.parse({ limit: 500 })).toThrow();
    expect(() => ContactsListParams.parse({ bogus: 1 })).toThrow();
  });
  it('enforces the 31-day calendar window', () => {
    expect(
      CalendarEventsParams.parse({ from: '2026-10-01T00:00:00Z', to: '2026-10-20T00:00:00Z' }),
    ).toBeTruthy();
    expect(() =>
      CalendarEventsParams.parse({ from: '2026-10-01T00:00:00Z', to: '2026-11-15T00:00:00Z' }),
    ).toThrow();
    expect(() =>
      CalendarEventsParams.parse({ from: '2026-10-20T00:00:00Z', to: '2026-10-01T00:00:00Z' }),
    ).toThrow();
  });
  it('requires a subject for email', () => {
    expect(() => SendMessageParams.parse({ contactId: 'c1', type: 'Email', message: 'hi' })).toThrow();
    expect(SendMessageParams.parse({ contactId: 'c1', type: 'SMS', message: 'hi' })).toBeTruthy();
  });
});
