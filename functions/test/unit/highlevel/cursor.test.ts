import { decodeCursor, encodeCursor } from '../../../src/modules/highlevel/adapters/cursor.js';

describe('cursor codec', () => {
  it('round-trips with the right kind', () => {
    const c = encodeCursor({ k: 'contacts', sa: [1712345678901, 'abc'] });
    expect(decodeCursor('contacts', c)).toEqual({ k: 'contacts', sa: [1712345678901, 'abc'] });
  });
  it('rejects kind mismatch and garbage as VALIDATION_FAILED', () => {
    const c = encodeCursor({ k: 'messages', lmi: 'm1' });
    expect(() => decodeCursor('contacts', c)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(() => decodeCursor('contacts', '%%%')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});
