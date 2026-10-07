import type { RuntimeMethodName } from '../../../contracts/hl-runtime.js';
import {
  CalendarEventSchema,
  CalendarSchema,
  ContactSchema,
  ConversationSchema,
  LocationSchema,
  MessageSchema,
} from '../../../contracts/hl-runtime.js';

const RECORD_FIELDS: Record<string, readonly string[]> = {
  Location: Object.keys(LocationSchema.shape),
  Contact: Object.keys(ContactSchema.shape),
  Conversation: Object.keys(ConversationSchema.shape),
  Message: Object.keys(MessageSchema.shape),
  Calendar: Object.keys(CalendarSchema.shape),
  CalendarEvent: Object.keys(CalendarEventSchema.shape),
};

const METHOD_RECORD: Record<RuntimeMethodName, string> = {
  'location.get': 'Location',
  'contacts.list': 'Contact',
  'contacts.get': 'Contact',
  'conversations.list': 'Conversation',
  'conversations.messages': 'Message',
  'calendars.list': 'Calendar',
  'calendars.events': 'CalendarEvent',
};

const PAGED = new Set<RuntimeMethodName>([
  'contacts.list',
  'conversations.list',
  'conversations.messages',
]);
const QUERY = new Set<RuntimeMethodName>(['contacts.list', 'conversations.list']);

export interface CatalogMethod {
  readonly name: RuntimeMethodName;
  readonly record: string;
  readonly fields: readonly string[];
  readonly paged: boolean;
  readonly query: boolean;
}

export function catalogFor(available: readonly RuntimeMethodName[]): CatalogMethod[] {
  return available.map((name) => {
    const record = METHOD_RECORD[name];
    return {
      name,
      record,
      fields: RECORD_FIELDS[record] ?? [],
      paged: PAGED.has(name),
      query: QUERY.has(name),
    };
  });
}

export function renderCatalog(methods: readonly CatalogMethod[]): string {
  if (methods.length === 0) return '(no HighLevel methods are available)';
  return methods
    .map((m) => {
      const extras = [m.paged ? 'paged' : '', m.query ? 'query' : ''].filter(Boolean).join(', ');
      return `- ${m.name} → ${m.record} { ${m.fields.join(', ')} }${extras ? ` (${extras})` : ''}`;
    })
    .join('\n');
}
