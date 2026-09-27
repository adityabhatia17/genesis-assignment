export const newId = (): string => crypto.randomUUID();

/** 128-bit hex nonce for preview renders (bridge handshake). */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
