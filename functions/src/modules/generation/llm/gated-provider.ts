import { sleep } from '../../../shared/async.js';
import type { ChatTurn, SystemBlock } from '../context/render-context.js';
import {
  ProviderError,
  type ModelProvider,
  type ModelStream,
  type ProviderEvent,
  type ProviderResult,
} from './model-provider.js';

/** FIFO gate. acquire resolves to a release function that is safe to call twice. */
export class Semaphore {
  private held = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly max: number) {}

  acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      let started = false;
      const fail = () => reject((signal?.reason as Error | undefined) ?? new Error('aborted'));
      const start = () => {
        if (started) return;
        if (signal?.aborted) {
          fail();
          return;
        }
        started = true;
        this.held += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.held -= 1;
          this.waiters.shift()?.();
        });
      };
      if (signal?.aborted) {
        fail();
        return;
      }
      signal?.addEventListener(
        'abort',
        () => {
          if (started) return;
          const i = this.waiters.indexOf(start);
          if (i >= 0) this.waiters.splice(i, 1);
          fail();
        },
        { once: true },
      );
      if (this.held < this.max) start();
      else this.waiters.push(start);
    });
  }
}

const retryable = (err: unknown): boolean =>
  err instanceof ProviderError && (err.code === 'LLM_RATE_LIMITED' || err.code === 'LLM_UNAVAILABLE');

/**
 * Caps how many model streams an instance holds, and retries a stream that
 * fails before its first token. A stream that already produced tokens is never restarted.
 */
export class GatedProvider implements ModelProvider {
  readonly name: ModelProvider['name'];

  constructor(
    private readonly inner: ModelProvider,
    private readonly slots: Semaphore,
  ) {
    this.name = inner.name;
  }

  get model(): string {
    return this.inner.model;
  }
  get effort(): string {
    return this.inner.effort;
  }

  stream(input: { system: SystemBlock[]; messages: ChatTurn[]; signal: AbortSignal }): ModelStream {
    let active: ModelStream | null = null;
    const slots = this.slots;
    const inner = this.inner;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<ProviderEvent> {
        const release = await slots.acquire(input.signal);
        let yielded = false;
        try {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const stream = inner.stream(input);
            active = stream;
            try {
              for await (const ev of stream) {
                yielded = true;
                yield ev;
              }
              return;
            } catch (err) {
              if (yielded || !retryable(err) || attempt === 2) throw err;
              await sleep(1_500 * 2 ** attempt, input.signal);
            }
          }
        } finally {
          release();
        }
      },
      final(): Promise<ProviderResult> {
        if (!active) return Promise.reject(new ProviderError('INTERNAL', 'The model stream never started.'));
        return active.final();
      },
    };
  }
}
