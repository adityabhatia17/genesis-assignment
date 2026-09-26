// Usage: after `npm run spike:oauth` created spike-tokens.json → `npm run record:fixtures`
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const { access_token: token, locationId } = JSON.parse(
  readFileSync('spike-tokens.json', 'utf8'),
) as {
  access_token: string;
  locationId: string;
};
const BASE = 'https://services.leadconnectorhq.com';

async function hl(path: string, version: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const PII_KEYS: Record<string, string> = {
  email: 'person@example.com',
  phone: '+15550000000',
  firstName: 'Test',
  lastName: 'Person',
  contactName: 'Test Person',
  fullName: 'Test Person',
  name: 'Test Name',
  body: 'Sample message body',
  lastMessageBody: 'Sample message body',
  address1: 'Redacted',
  city: 'Redacted',
  postalCode: '00000',
  companyName: 'Example Co',
  title: 'Sample appointment',
};
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [
        k,
        k in PII_KEYS && typeof val === 'string' ? PII_KEYS[k] : scrub(val),
      ]),
    );
  }
  return v;
}

const now = Date.now();
const week = 7 * 24 * 3_600_000;
const out: Record<string, { status: number; body: unknown }> = {};
out['contacts-search-p1'] = await hl('/contacts/search', '2021-07-28', {
  method: 'POST',
  body: { locationId, pageLimit: 20, sort: [{ field: 'dateAdded', direction: 'desc' }] },
});
const p1 = out['contacts-search-p1'].body as {
  contacts?: { searchAfter?: unknown[]; id: string }[];
};
const last = p1.contacts?.at(-1);
if (last?.searchAfter) {
  out['contacts-search-p2'] = await hl('/contacts/search', '2021-07-28', {
    method: 'POST',
    body: { locationId, pageLimit: 20, searchAfter: last.searchAfter },
  });
}
if (last) out['contact-get'] = await hl(`/contacts/${last.id}`, '2021-07-28');
out['conversations-search'] = await hl(
  `/conversations/search?locationId=${locationId}&limit=5&sort=desc&sortBy=last_message_date`,
  '2021-04-15',
);
const conv = (out['conversations-search'].body as { conversations?: { id: string }[] })
  .conversations?.[0];
if (conv)
  out['conversation-messages'] = await hl(
    `/conversations/${conv.id}/messages?limit=5`,
    '2021-04-15',
  );
out['calendars'] = await hl(`/calendars/?locationId=${locationId}`, '2021-04-15');
const cal = (out['calendars'].body as { calendars?: { id: string }[] }).calendars?.[0];
if (cal) {
  out['calendar-events'] = await hl(
    `/calendars/events?locationId=${locationId}&calendarId=${cal.id}&startTime=${now}&endTime=${now + 2 * week}`,
    '2021-04-15',
  );
}
out['location'] = await hl(`/locations/${locationId}`, '2021-07-28');

mkdirSync('test/fixtures/hl/raw', { recursive: true });
for (const [name, value] of Object.entries(out)) {
  writeFileSync(`test/fixtures/hl/raw/${name}.json`, JSON.stringify(value, null, 2));
  writeFileSync(`test/fixtures/hl/${name}.json`, JSON.stringify(scrub(value), null, 2));
  console.log(`${name}: HTTP ${value.status}`);
}
