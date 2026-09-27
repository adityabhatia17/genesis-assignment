import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { HL_WEBHOOK_ED25519_PEM } from './hl-webhook-keys.js';

export interface WebhookKeys {
  readonly ed25519Pem: string;
}

export const PRODUCTION_WEBHOOK_KEYS: WebhookKeys = {
  ed25519Pem: HL_WEBHOOK_ED25519_PEM,
};

const ed25519 = createPublicKey(HL_WEBHOOK_ED25519_PEM);

function header(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || raw === 'N/A') return null;
  return raw;
}

function verifyEd25519(raw: Buffer, signature: string, key: KeyObject): boolean {
  try {
    return verify(null, raw, key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

/** Verifies `x-ghl-signature` (Ed25519) over the raw body. */
export function verifyWebhookSignature(
  raw: Buffer,
  headers: IncomingHttpHeaders,
  keys: WebhookKeys = PRODUCTION_WEBHOOK_KEYS,
): boolean {
  const current = header(headers, 'x-ghl-signature');
  if (!current) return false;
  const key = keys === PRODUCTION_WEBHOOK_KEYS ? ed25519 : createPublicKey(keys.ed25519Pem);
  return verifyEd25519(raw, current, key);
}
