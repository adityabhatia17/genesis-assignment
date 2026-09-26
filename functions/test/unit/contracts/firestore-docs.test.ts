import { IssueSchema, TERMINAL_GENERATION_STATUSES, UsageSchema } from '../../../src/contracts/firestore-docs.js';

describe('firestore doc contracts', () => {
  it('validates issues and usage', () => {
    expect(
      IssueSchema.parse({
        code: 'JS_SYNTAX',
        message: 'Unexpected token',
        severity: 'error',
        path: 'app.js',
        line: 3,
        column: 7,
      }),
    ).toBeTruthy();
    expect(() => IssueSchema.parse({ code: 'X', message: 'y', severity: 'fatal' })).toThrow();
    expect(
      UsageSchema.parse({
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: 0.01,
      }),
    ).toBeTruthy();
  });
  it('lists terminal statuses', () => {
    expect(TERMINAL_GENERATION_STATUSES).toEqual(['completed', 'failed', 'interrupted']);
  });
});
