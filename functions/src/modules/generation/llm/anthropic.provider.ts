import Anthropic from '@anthropic-ai/sdk';
import type { ChatTurn, SystemBlock } from '../context/render-context.js';
import type {
  ModelProvider,
  ModelStream,
  ProviderEvent,
  ProviderResult,
} from './model-provider.js';
import { ProviderError } from './model-provider.js';

export interface AnthropicConfig {
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  fastMode: boolean;
}

type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];

export function mapProviderError(e: unknown): unknown {
  if (e instanceof Anthropic.APIUserAbortError) return e; // caller decides via signal.reason
  if (e instanceof Anthropic.RateLimitError)
    return new ProviderError('LLM_RATE_LIMITED', 'Anthropic rate limit', { cause: e });
  if (e instanceof Anthropic.APIConnectionError)
    return new ProviderError('LLM_UNAVAILABLE', 'Anthropic connection error', { cause: e });
  if (e instanceof Anthropic.APIError) {
    const status = typeof e.status === 'number' ? e.status : 0;
    if (status === 529 || status >= 500)
      return new ProviderError('LLM_UNAVAILABLE', `Anthropic ${status}`, { cause: e });
    return new ProviderError('INTERNAL', `Anthropic ${status}`, { cause: e });
  }
  return e;
}

export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic' as const;

  constructor(
    private readonly client: Anthropic,
    private readonly cfg: AnthropicConfig,
  ) {}

  get model(): string {
    return this.cfg.model;
  }
  get effort(): string {
    return this.cfg.effort;
  }

  stream(input: { system: SystemBlock[]; messages: ChatTurn[]; signal: AbortSignal }): ModelStream {
    const params = {
      model: this.cfg.model,
      max_tokens: this.cfg.maxTokens,
      system: input.system.map((b) => ({
        type: 'text' as const,
        text: b.text,
        ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      })),
      messages: input.messages.map((t) => ({ role: t.role, content: t.content })),
      thinking: { type: 'adaptive' as const, display: 'summarized' as const },
      output_config: { effort: this.cfg.effort },
      betas: [
        'server-side-fallback-2026-07-01',
        ...(this.cfg.fastMode ? ['fast-mode-2026-02-01'] : []),
      ],
      fallbacks: 'default' as const,
      ...(this.cfg.fastMode ? { speed: 'fast' as const } : {}),
    } as StreamParams;

    const sdkStream = this.client.beta.messages.stream(params, { signal: input.signal });

    return {
      async *[Symbol.asyncIterator](): AsyncIterator<ProviderEvent> {
        try {
          for await (const ev of sdkStream) {
            if (ev.type !== 'content_block_delta') continue;
            if (ev.delta.type === 'text_delta') yield { type: 'text_delta', text: ev.delta.text };
            else if (ev.delta.type === 'thinking_delta')
              yield { type: 'thinking_delta', text: ev.delta.thinking };
          }
        } catch (err) {
          throw mapProviderError(err);
        }
      },
      async final(): Promise<ProviderResult> {
        try {
          const m = await sdkStream.finalMessage();
          return {
            stopReason: m.stop_reason ?? null,
            model: m.model,
            usage: {
              inputTokens: m.usage.input_tokens,
              outputTokens: m.usage.output_tokens,
              cacheReadInputTokens: m.usage.cache_read_input_tokens ?? 0,
              cacheCreationInputTokens: m.usage.cache_creation_input_tokens ?? 0,
            },
          };
        } catch (err) {
          throw mapProviderError(err);
        }
      },
    };
  }
}
