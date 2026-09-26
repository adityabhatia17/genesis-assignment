import type { z } from 'zod';
import { OAuthStartResult } from '@/contracts/api';
import { apiFetch } from '@/lib/http';

/** Returns the HighLevel authorize URL; the caller navigates the whole tab there. */
export async function startHighLevelOAuth(returnPath: string): Promise<string> {
  const data = await apiFetch<z.infer<typeof OAuthStartResult>>('api', '/v1/hl/oauth/start', {
    method: 'POST',
    body: { returnPath },
  });
  return OAuthStartResult.parse(data).authorizeUrl;
}

export async function disconnectHighLevel(): Promise<void> {
  await apiFetch<unknown>('api', '/v1/hl/connection', { method: 'DELETE' });
}
