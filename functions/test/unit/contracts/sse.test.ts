import { GenerationEventSchema, isTerminalEvent } from '../../../src/contracts/sse.js';

const base = { v: 1, seq: 1, generationId: 'g', ts: 1 };

describe('SSE contracts', () => {
  it('parses each event family', () => {
    expect(
      GenerationEventSchema.parse({ ...base, type: 'file.delta', data: { path: 'app.js', text: 'x' } }).type,
    ).toBe('file.delta');
    const failed = GenerationEventSchema.parse({
      ...base,
      seq: 9,
      type: 'generation.failed',
      data: {
        error: { code: 'LLM_UNAVAILABLE', message: 'down', retryable: true },
        partial: { stagedPaths: ['index.html'], applyable: true },
      },
    });
    expect(isTerminalEvent(failed)).toBe(true);
  });
  it('rejects unknown types and wrong versions', () => {
    expect(() => GenerationEventSchema.parse({ ...base, type: 'nope', data: {} })).toThrow();
    expect(() => GenerationEventSchema.parse({ ...base, v: 2, type: 'heartbeat', data: {} })).toThrow();
  });
});
