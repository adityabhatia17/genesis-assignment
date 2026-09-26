import { RUNTIME_METHOD_NAMES } from '../../../src/contracts/hl-runtime.js';
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT_V1,
} from '../../../src/modules/generation/prompt/system-prompt.v1.js';

describe('system prompt v1', () => {
  it('documents every runtime method', () => {
    for (const name of RUNTIME_METHOD_NAMES) expect(SYSTEM_PROMPT_V1).toContain(`${name}(`);
  });
  it('states the protocol and key constraints', () => {
    expect(PROMPT_VERSION).toBe('v2');
    for (const s of [
      '⟦FILE path=',
      '⟦/FILE⟧',
      '⟦DELETE path=',
      'window.genesis.ready.then(start)',
      'textContent',
      'no network access',
      'At most 25 files',
      'show a Load more control',
      'One click loads one page',
      'Do not loop until hasMore is false',
    ]) {
      expect(SYSTEM_PROMPT_V1).toContain(s);
    }
    expect(SYSTEM_PROMPT_V1).not.toContain('do not add a Load more control');
    expect(SYSTEM_PROMPT_V1.length).toBeGreaterThan(2_000); // > 512-token cache minimum
  });
});
