import { LIMITS } from '../../../../contracts/limits.js';
import type { Checklist, LlmChecklist } from '../../../../contracts/variants.js';
import { LlmChecklistSchema } from '../../../../contracts/variants.js';
import type { RuntimeMethodName } from '../../../../contracts/hl-runtime.js';
import { ProviderError, type TokenUsage } from '../../llm/model-provider.js';
import type { StructuredClient } from '../../llm/structured-client.js';
import type { CatalogMethod } from '../sdk-catalog.js';
import { baselineItems } from './baseline.js';
import { CHECKLIST_PROMPT_VERSION, CHECKLIST_SYSTEM } from './checklist-prompt.v1.js';
import { renderChecklistUser } from './render-checklist-user.js';
import { templateChecklist } from './template.js';
import { primaryMethodsOf, validateLlmItems } from './validate.js';

export interface ChecklistOutcome {
  checklist: Checklist;
  usage: TokenUsage | null;
  model: string | null;
  dropped: { id: string; reason: string }[];
}

const renumber = (items: Checklist['items']): Checklist['items'] => {
  let n = 0;
  return items.map((item) => {
    if (!item.id.startsWith('R')) return item;
    n += 1;
    return { ...item, id: `R${n}` };
  });
};

export class ChecklistService {
  constructor(
    private readonly client: StructuredClient,
    private readonly model: string,
  ) {}

  async build(i: {
    prompt: string;
    calendarCount: number | null;
    catalog: readonly CatalogMethod[];
    signal: AbortSignal;
  }): Promise<ChecklistOutcome> {
    try {
      const result = await this.client.complete<LlmChecklist>({
        model: this.model,
        system: CHECKLIST_SYSTEM,
        user: renderChecklistUser(i),
        schema: LlmChecklistSchema,
        schemaName: 'checklist',
        maxTokens: 2_000,
        signal: i.signal,
        timeoutMs: LIMITS.variants.checklistTimeoutMs,
      });
      const methods = primaryMethodsOf(result.data, i.catalog);
      if (methods.length === 0) throw new ProviderError('INTERNAL', 'no primary method');
      const validated = validateLlmItems(result.data, i.catalog);
      const merged = renumber([...validated.items, ...baselineItems(i.catalog)]);
      const checklist = clamp(merged, methods, result.data);
      if (!checklist) throw new ProviderError('INTERNAL', 'checklist too short');
      return { checklist, usage: result.usage, model: result.model, dropped: validated.dropped };
    } catch {
      return {
        checklist: templateChecklist(i.prompt, i.catalog),
        usage: null,
        model: null,
        dropped: [],
      };
    }
  }
}

function clamp(
  items: Checklist['items'],
  primaryMethods: RuntimeMethodName[],
  llm: LlmChecklist,
): Checklist | null {
  const sliced = items.slice(0, LIMITS.variants.checklistMergedMax);
  if (sliced.length < LIMITS.variants.checklistMergedMin) return null;
  return {
    appType: llm.appType,
    primaryMethods,
    items: sliced,
    unsupported: llm.unsupported,
    origin: 'model',
  };
}

export { CHECKLIST_PROMPT_VERSION };
