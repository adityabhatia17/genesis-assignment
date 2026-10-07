import type { RuntimeMethodName } from '../../../../contracts/hl-runtime.js';
import type { Checklist, ChecklistItem } from '../../../../contracts/variants.js';
import type { CatalogMethod } from '../sdk-catalog.js';
import { baselineItems } from './baseline.js';

const KEYWORD: { test: RegExp; method: RuntimeMethodName; noun: string }[] = [
  { test: /appointment|calendar|schedule|booking/i, method: 'calendars.events', noun: 'appointment' },
  { test: /contact|customer|client|people/i, method: 'contacts.list', noun: 'contact' },
  { test: /message|conversation|inbox|sms|email/i, method: 'conversations.list', noun: 'conversation' },
];

/**
 * Used when the checklist model fails. Covers the obvious method and the
 * baseline states. Deliberately small.
 */
export function templateChecklist(
  prompt: string,
  catalog: readonly CatalogMethod[],
): Checklist {
  const available = new Set(catalog.map((m) => m.name));
  const hit = KEYWORD.find((k) => k.test.test(prompt) && available.has(k.method));
  const method = hit?.method ?? catalog[0]?.name ?? 'location.get';
  const noun = hit?.noun ?? 'record';
  const record = catalog.find((m) => m.name === method);
  const field = record?.fields.find((f) => f === 'name' || f === 'title' || f === 'body') ?? record?.fields[0];
  const items: ChecklistItem[] = [
    {
      id: 'R1',
      text: `Shows each ${noun}`,
      kind: 'core',
      source: 'implied',
      check: field
        ? { type: 'probe', probe: { probe: 'rendersFields', method, fields: [field] } }
        : { type: 'judge' },
    },
    ...baselineItems(catalog),
  ];
  return {
    appType: 'list',
    primaryMethods: [method],
    items,
    unsupported: [],
    origin: 'template',
  };
}
