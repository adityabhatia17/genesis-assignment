import { z } from 'zod';

export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.coerce.number().int().positive(),
  refresh_token: z.string().min(1),
  scope: z.string().optional().default(''),
  userType: z.string().optional(),
  locationId: z.string().optional(),
  companyId: z.string().optional(),
  userId: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

const ErrorBodySchema = z
  .object({ error: z.string().optional(), message: z.unknown().optional() })
  .passthrough();

export class TokenEndpointError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string | null,
  ) {
    super(`HighLevel token endpoint responded ${status}${errorCode ? ` (${errorCode})` : ''}`);
    this.name = 'TokenEndpointError';
  }
  /** HighLevel rejects a used/revoked refresh token with 400/401; confirmed by spike S4. */
  get isInvalidGrant(): boolean {
    return this.status === 400 || this.status === 401 || this.errorCode === 'invalid_grant';
  }
}

export interface TokenEndpointClient {
  exchangeCode(code: string): Promise<TokenResponse>;
  refresh(refreshToken: string): Promise<TokenResponse>;
}

export interface TokenEndpointOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createTokenEndpointClient(o: TokenEndpointOptions): TokenEndpointClient {
  const doFetch = o.fetchImpl ?? fetch;

  async function post(form: Record<string, string>): Promise<TokenResponse> {
    const res = await doFetch(`${o.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const parsed = ErrorBodySchema.safeParse(json);
      throw new TokenEndpointError(res.status, parsed.success ? (parsed.data.error ?? null) : null);
    }
    return TokenResponseSchema.parse(json);
  }

  const common = {
    client_id: o.clientId,
    client_secret: o.clientSecret,
    user_type: 'Location',
    redirect_uri: o.redirectUri,
  };
  return {
    exchangeCode: (code) => post({ ...common, grant_type: 'authorization_code', code }),
    refresh: (refreshToken) =>
      post({ ...common, grant_type: 'refresh_token', refresh_token: refreshToken }),
  };
}
