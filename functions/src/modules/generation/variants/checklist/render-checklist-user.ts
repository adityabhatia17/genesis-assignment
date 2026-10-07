import { LIMITS } from '../../../../contracts/limits.js';
import type { CatalogMethod } from '../sdk-catalog.js';
import { renderCatalog } from '../sdk-catalog.js';
import { baselineItems } from './baseline.js';

const ALLOWED_PROBES = `calls { method }
rendersFields { method, fields }
sortedBy { method, field, direction: asc|desc }
searchCallsWith { method, param: "query" }
hasControl { control: search|filter|refresh|dateRange }`;

const escape = (s: string) => s.replace(/</g, '\\u003c');

export function renderChecklistUser(i: {
  prompt: string;
  calendarCount: number | null;
  catalog: readonly CatalogMethod[];
}): string {
  const context =
    i.calendarCount === null
      ? 'No HighLevel context is available.'
      : `Calendars connected: ${i.calendarCount}`;
  const baseline = baselineItems(i.catalog)
    .map((b) => `- ${b.text}`)
    .join('\n');
  return [
    `<owner_prompt>\n${escape(i.prompt.slice(0, LIMITS.promptMaxChars))}\n</owner_prompt>`,
    `<highlevel_context>\n${context}\n</highlevel_context>`,
    `<sdk_catalog>\n${renderCatalog(i.catalog)}\n</sdk_catalog>`,
    `<baseline_items>\n${baseline}\n</baseline_items>`,
    `<allowed_probes>\n${ALLOWED_PROBES}\n</allowed_probes>`,
  ].join('\n\n');
}
