import { sleep as defaultSleep } from '../../../shared/async.js';
import type { ChatTurn, SystemBlock } from '../context/render-context.js';
import { selectScript } from './fake-scripts.js';
import {
  ProviderError,
  type ModelProvider,
  type ModelStream,
  type ProviderEvent,
  type ProviderResult,
} from './model-provider.js';

export class FakeProvider implements ModelProvider {
  readonly name = 'fake' as const;
  readonly model = 'fake-model';
  readonly effort = 'n/a';

  constructor(
    private readonly opts: {
      seed?: number;
      sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
      chunkDelayMs?: number;
    } = {},
  ) {}

  stream(input: { system: SystemBlock[]; messages: ChatTurn[]; signal: AbortSignal }): ModelStream {
    const script = selectScript(input.messages.at(-1)?.content ?? '');
    const sleep = this.opts.sleep ?? defaultSleep;
    const defaultDelay = this.opts.chunkDelayMs ?? 0; // captured: `this` inside the generator below is the returned object
    let seed = this.opts.seed ?? 7;
    const rnd = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    let emitted = 0;

    return {
      async *[Symbol.asyncIterator](): AsyncIterator<ProviderEvent> {
        if (script.thinking) yield { type: 'thinking_delta', text: script.thinking };
        for (let i = 0; i < script.text.length;) {
          if (input.signal.aborted)
            throw input.signal.reason instanceof Error ? input.signal.reason : new Error('aborted');
          const n = 3 + Math.floor(rnd() * 25);
          const piece = script.text.slice(i, i + n);
          i += n;
          emitted += piece.length;
          if (script.failAfterChars !== undefined && emitted > script.failAfterChars)
            throw new ProviderError('LLM_UNAVAILABLE', 'Fake provider outage');
          const delay = script.chunkDelayMs ?? defaultDelay;
          if (delay > 0) await sleep(delay, input.signal);
          yield { type: 'text_delta', text: piece };
        }
      },
      final: (): Promise<ProviderResult> =>
        Promise.resolve({
          stopReason: script.stopReason ?? 'end_turn',
          model: 'fake-model',
          usage: {
            inputTokens: 1_000,
            outputTokens: Math.ceil(script.text.length / 4),
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        }),
    };
  }
}
