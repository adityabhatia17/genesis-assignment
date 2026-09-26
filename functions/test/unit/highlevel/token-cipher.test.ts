import { randomBytes } from 'node:crypto';
import { createTokenCipher } from '../../../src/modules/highlevel/connection/token-cipher.js';

const key = randomBytes(32).toString('base64');

describe('token cipher', () => {
  it('round-trips and never stores plaintext', () => {
    const c = createTokenCipher(key);
    const enc = c.encrypt('secret-token', 'uid1', 'access');
    expect(JSON.stringify(enc)).not.toContain('secret-token');
    expect(c.decrypt(enc, 'uid1', 'access')).toBe('secret-token');
  });
  it('binds ciphertext to user and field (AAD)', () => {
    const c = createTokenCipher(key);
    const enc = c.encrypt('t', 'uid1', 'access');
    expect(() => c.decrypt(enc, 'uid2', 'access')).toThrow();
    expect(() => c.decrypt(enc, 'uid1', 'refresh')).toThrow();
  });
  it('detects tampering', () => {
    const c = createTokenCipher(key);
    const enc = c.encrypt('t', 'u', 'access');
    const tampered = { ...enc, ct: Buffer.from('xx').toString('base64') };
    expect(() => c.decrypt(tampered, 'u', 'access')).toThrow();
  });
  it('requires a 32-byte key', () => {
    expect(() => createTokenCipher(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
