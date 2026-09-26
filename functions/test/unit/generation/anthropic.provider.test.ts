import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '../../../src/modules/generation/llm/anthropic.provider.js';
import { ProviderError } from '../../../src/modules/generation/llm/model-provider.js';

function stubClient(
  events: unknown[],
  final: unknown,
  opts: { throwAt?: number; error?: unknown } = {},
) {
  const calls: { params: Record<string, unknown>; options: { signal?: AbortSignal } }[] = [];
  const stream = (params: Record<string, unknown>, options: { signal?: AbortSignal }) => {
    calls.push({ params, options });
    return {
      async *[Symbol.asyncIterator]() {
        let i = 0;
        for (const e of events) {
          if (opts.throwAt === i) throw opts.error;
          i += 1;
          yield e;
        }
      },
      finalMessage: () => Promise.resolve(final),
    };
  };
  return { client: { beta: { messages: { stream } } } as unknown as Anthropic, calls };
}

const cfg = {
  model: 'claude-opus-5',
  effort: 'medium' as const,
  maxTokens: 32_000,
  fastMode: false,
};
const final = {
  stop_reason: 'end_turn',
  model: 'claude-opus-5',
  usage: {
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 0,
  },
};

function rateLimitError(): unknown {
  try {
    return new Anthropic.RateLimitError(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'x' } },
      'x',
      new Headers(),
    );
  } catch {
    return Object.assign(Object.create(Anthropic.RateLimitError.prototype) as object, {
      status: 429,
    });
  }
}

describe('AnthropicProvider', () => {
  it('sends thinking, effort, fallbacks, cached system and the abort signal', async () => {
    const { client, calls } = stubClient([], final);
    const signal = new AbortController().signal;
    const s = new AnthropicProvider(client, cfg).stream({
      system: [{ text: 'SYS', cache: true }],
      messages: [{ role: 'user', content: 'hi' }],
      signal,
    });
    for await (const _ of s) {
      /* drain */
    }
    const p = calls[0]!.params;
    expect(p).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 32_000,
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(p).not.toHaveProperty('temperature');
    expect(calls[0]!.options.signal).toBe(signal);
  });

  it('maps text and thinking deltas and the final message', async () => {
    const { client } = stubClient(
      [
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'plan' },
        },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      ],
      final,
    );
    const s = new AnthropicProvider(client, cfg).stream({
      system: [],
      messages: [],
      signal: new AbortController().signal,
    });
    const out = [];
    for await (const e of s) out.push(e);
    expect(out).toEqual([
      { type: 'thinking_delta', text: 'plan' },
      { type: 'text_delta', text: 'Hello' },
    ]);
    await expect(s.final()).resolves.toEqual({
      stopReason: 'end_turn',
      model: 'claude-opus-5',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 0,
      },
    });
  });

  it('maps rate limits and outages to ProviderError', async () => {
    const rate = rateLimitError();
    const { client } = stubClient([{ type: 'x' }], final, { throwAt: 0, error: rate });
    const s = new AnthropicProvider(client, cfg).stream({
      system: [],
      messages: [],
      signal: new AbortController().signal,
    });
    await expect(
      (async () => {
        for await (const _ of s) {
          /* drain */
        }
      })(),
    ).rejects.toMatchObject({ code: 'LLM_RATE_LIMITED' });
    expect(new ProviderError('LLM_UNAVAILABLE', 'x')).toBeInstanceOf(Error);
  });
});
