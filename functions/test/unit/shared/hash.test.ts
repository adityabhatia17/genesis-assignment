import { fileIdForPath, sha256Hex, utf8Bytes } from '../../../src/shared/hash.js';

describe('hash helpers', () => {
  it('computes stable file ids', () => {
    expect(fileIdForPath('index.html')).toBe(sha256Hex('index.html').slice(0, 20));
    expect(fileIdForPath('index.html')).toHaveLength(20);
  });
  it('counts UTF-8 bytes, not UTF-16 units', () => {
    expect(utf8Bytes('é')).toBe(2);
    expect(utf8Bytes('⟦')).toBe(3);
  });
});
