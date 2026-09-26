import type { LocationQuery } from 'vue-router';
import { OAUTH_REDIRECT_REASONS, type OAuthRedirectReason } from '@/contracts/api';

export type OAuthReturn = { kind: 'connected' } | { kind: 'error'; reason: OAuthRedirectReason };

/** Reads `?hl=connected` / `?hl=error&reason=…` set by the OAuth callback redirect (07 §3.1 A3). */
export function readOAuthReturn(query: LocationQuery): OAuthReturn | null {
  const hl = query['hl'];
  if (hl === 'connected') return { kind: 'connected' };
  if (hl !== 'error') return null;
  const raw = query['reason'];
  const reason = (OAUTH_REDIRECT_REASONS as readonly unknown[]).includes(raw)
    ? (raw as OAuthRedirectReason)
    : 'internal';
  return { kind: 'error', reason };
}

const MESSAGES: Readonly<Record<OAuthRedirectReason, string>> = {
  state_invalid: 'The connection link expired. Please try again.',
  denied: 'Connection was cancelled.',
  exchange_failed: "HighLevel didn't accept the connection. Please try again.",
  not_location_token: 'Please choose a sub-account (location), not an agency.',
  internal: 'Something went wrong while connecting HighLevel. Please try again.',
};

export const oauthErrorMessage = (reason: OAuthRedirectReason): string => MESSAGES[reason];
