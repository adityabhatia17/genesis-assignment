import type { RuntimeMethodName } from '../../../../contracts/hl-runtime.js';
import { LIMITS } from '../../../../contracts/limits.js';
import type { ChecklistItem, LlmChecklist, LlmProbe } from '../../../../contracts/variants.js';
import type { CatalogMethod } from '../sdk-catalog.js';

const ALLOWED = new Set(['calls', 'rendersFields', 'sortedBy', 'searchCallsWith', 'hasControl']);

export interface DroppedItem {
  id: string;
  reason: string;
}

function probeOk(probe: LlmProbe, catalog: readonly CatalogMethod[]): string | null {
  if (!ALLOWED.has(probe.probe)) return 'probe not allowed';
  if (probe.probe === 'hasControl') return null;
  const method = catalog.find((m) => m.name === probe.method);
  if (!method) return 'method not in catalog';
  if (probe.probe === 'rendersFields') {
    const unknown = probe.fields.filter((f) => !method.fields.includes(f));
    if (unknown.length > 0) return `unknown field ${unknown[0]}`;
  }
  if (probe.probe === 'sortedBy' && !method.fields.includes(probe.field)) return 'unknown field';
  if (probe.probe === 'searchCallsWith' && !method.query) return 'method has no query';
  return null;
}

/** Drops items the model was not allowed to write. Order is preserved. */
export function validateLlmItems(
  llm: LlmChecklist,
  catalog: readonly CatalogMethod[],
): { items: ChecklistItem[]; dropped: DroppedItem[] } {
  const kept: ChecklistItem[] = [];
  const dropped: DroppedItem[] = [];
  let nice = 0;
  const seen = new Set<string>();
  for (const item of llm.items) {
    if (seen.has(item.id)) {
      dropped.push({ id: item.id, reason: 'duplicate id' });
      continue;
    }
    seen.add(item.id);
    if (item.kind === 'nice') {
      nice += 1;
      if (nice > LIMITS.variants.checklistNiceMax) {
        dropped.push({ id: item.id, reason: 'too many nice items' });
        continue;
      }
    }
    if (item.check.type === 'probe') {
      const reason = probeOk(item.check.probe, catalog);
      if (reason) {
        dropped.push({ id: item.id, reason });
        continue;
      }
    }
    kept.push(item);
    if (kept.length >= LIMITS.variants.checklistItemsMax) break;
  }
  return { items: kept, dropped };
}

export function primaryMethodsOf(
  llm: LlmChecklist,
  catalog: readonly CatalogMethod[],
): RuntimeMethodName[] {
  const allowed = new Set(catalog.map((m) => m.name));
  return llm.primaryMethods.filter((m) => allowed.has(m));
}
