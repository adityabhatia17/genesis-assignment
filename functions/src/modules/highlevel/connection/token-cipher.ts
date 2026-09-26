import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const EncryptedValueSchema = z.object({
  v: z.literal(1),
  iv: z.string(),
  tag: z.string(),
  ct: z.string(),
});
export type EncryptedValue = z.infer<typeof EncryptedValueSchema>;
export type TokenField = 'access' | 'refresh';

export interface TokenCipher {
  encrypt(plain: string, uid: string, field: TokenField): EncryptedValue;
  decrypt(value: EncryptedValue, uid: string, field: TokenField): string;
}

export function createTokenCipher(keyBase64: string): TokenCipher {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  const aad = (uid: string, field: TokenField) => Buffer.from(`hl:${uid}:${field}`, 'utf8');

  return {
    encrypt(plain, uid, field) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(uid, field));
      const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return {
        v: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ct: ct.toString('base64'),
      };
    },
    decrypt(value, uid, field) {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
      decipher.setAAD(aad(uid, field));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(value.ct, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
