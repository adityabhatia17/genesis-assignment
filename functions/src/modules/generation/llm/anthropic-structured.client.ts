import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { withTimeout } from '../../../shared/async.js';
import { mapProviderError } from './anthropic.provider.js';
import type { TokenUsage } from './model-provider.js';
import { ProviderError } from './model-provider.js';
import type { StructuredClient, StructuredRequest, StructuredResult } from './structured-client.js';

const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
});

function usageOf(u: Anthropic.Usage | undefined, into: TokenUsage): void {
  if (!u) return;
  into.inputTokens += u.input_tokens;
  into.outputTokens += u.output_tokens;
  into.cacheReadInputTokens += u.cache_read_input_tokens ?? 0;
  into.cacheCreationInputTokens += u.cache_creation_input_tokens ?? 0;
}

function toolInput(msg: Anthropic.Message, name: string): unknown {
  for (const block of msg.content) {
    if (block.type === 'tool_use' && block.name === name) return block.input;
  }
  return undefined;
}

/**
 * Forced tool call, no thinking. One repair call if the tool input fails the schema.
 * If a model rejects forced tool_choice, the thrown ProviderError is the signal to
 * switch that role's model; the port stays the same.
 */
export class AnthropicStructuredClient implements StructuredClient {
  constructor(private readonly client: Anthropic) {}

  async complete<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const usage = emptyUsage();
    try {
      return await withTimeout(
        this.call(req, usage, false),
        req.timeoutMs,
        () => new ProviderError('LLM_UNAVAILABLE', 'Structured call timed out'),
      );
    } catch (err) {
      throw mapProviderError(err);
    }
  }

  private async call<T>(
    req: StructuredRequest<T>,
    usage: TokenUsage,
    repaired: boolean,
    extra?: string,
  ): Promise<StructuredResult<T>> {
    const schema = z.toJSONSchema(req.schema) as Anthropic.Tool.InputSchema;
    const msg = await this.client.messages.create(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [
          {
            role: 'user',
            content: extra ? `${req.user}\n\n${extra}` : req.user,
          },
        ],
        tools: [{ name: req.schemaName, description: 'Return the result.', input_schema: schema }],
        tool_choice: { type: 'tool', name: req.schemaName },
      },
      { signal: req.signal },
    );
    usageOf(msg.usage, usage);
    const parsed = req.schema.safeParse(toolInput(msg, req.schemaName));
    if (parsed.success) {
      return { data: parsed.data, usage, model: msg.model, repaired };
    }
    if (repaired) throw new ProviderError('INTERNAL', 'Structured output invalid');
    return this.call(
      req,
      usage,
      true,
      `The previous JSON did not match the schema: ${parsed.error.message}. Return corrected JSON only.`,
    );
  }
}
