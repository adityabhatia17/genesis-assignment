import type { StructuredClient, StructuredRequest, StructuredResult } from './structured-client.js';

const ZERO = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

/** Scripted JSON for emulators. No network. */
export class FakeStructuredClient implements StructuredClient {
  complete<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const data = req.schema.parse(canned(req.schemaName, req.user));
    return Promise.resolve({ data, usage: ZERO, model: req.model, repaired: false });
  }
}

function canned(name: string, user: string): unknown {
  if (name === 'judge') {
    const labels = [...user.matchAll(/label="([A-D])"/g)].map((m) => m[1]);
    const options = (labels.length ? labels : ['A']).map((label) => ({
      label,
      visual: { score: 4, evidence: 'sample' },
      clarity: { score: 4, evidence: 'sample' },
      items: [] as { id: string; met: boolean; evidence: string }[],
    }));
    return { options };
  }
  return {
    appType: 'list',
    primaryMethods: ['contacts.list'],
    items: [
      {
        id: 'R1',
        text: 'Shows each contact by name',
        kind: 'core',
        source: 'explicit',
        check: { type: 'judge' },
      },
    ],
    unsupported: [],
  };
}
