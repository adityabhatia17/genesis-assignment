import { createHash, randomBytes } from 'node:crypto';

export const sha256Hex = (input: string | Buffer): string =>
  createHash('sha256').update(input).digest('hex');
export const fileIdForPath = (path: string): string => sha256Hex(path).slice(0, 20);
export const uidHash = (uid: string): string => sha256Hex(uid).slice(0, 12);
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
