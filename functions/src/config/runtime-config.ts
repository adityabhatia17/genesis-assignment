import { z } from 'zod';
import * as p from './params.js';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const csv = z.string().transform((s) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
);
const spaced = z.string().transform((s) =>
  s
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean),
);

const RawSchema = z.object({
  APP_BASE_URL: z.url(),
  ALLOWED_ORIGINS: csv.pipe(z.array(z.string().min(1)).min(1)),
  HL_REDIRECT_URI: z.url().refine((u) => !/highlevel|leadconnector|ghl/i.test(u), {
    message:
      'HL_REDIRECT_URI must not contain "highlevel", "leadconnector" or "ghl" (HighLevel rejects it)',
  }),
  HL_SCOPES: spaced.pipe(z.array(z.string()).min(1)),
  HL_API_BASE_URL: z.url(),
  HL_AUTHORIZE_URL: z.url(),
  ANTHROPIC_MODEL: z.string().min(1),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  ANTHROPIC_WORKSPACE_ID: z.string().default(''),
  LLM_PROVIDER: z.enum(['anthropic', 'fake']),
  SSE_SMOKE_ENABLED: bool,
  GENERATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  GENERATION_DAILY_GLOBAL_CAP: z.coerce.number().int().nonnegative().default(200),
});

export interface RuntimeConfig {
  readonly appBaseUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly hlRedirectUri: string;
  readonly hlScopes: readonly string[];
  readonly hlApiBaseUrl: string;
  readonly hlAuthorizeUrl: string;
  readonly anthropicModel: string;
  readonly anthropicEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly anthropicWorkspaceId: string;
  readonly llmProvider: 'anthropic' | 'fake';
  readonly sseSmokeEnabled: boolean;
  readonly generationEnabled: boolean;
  readonly generationDailyGlobalCap: number;
  /** Out of v1 (R-B). Always false. */
  readonly anthropicFastMode: false;
  /** Out of v1. Always false. */
  readonly hlExtendedMethods: false;
}

export function parseRuntimeConfig(raw: Record<string, unknown>): RuntimeConfig {
  const r = RawSchema.parse(raw);
  return Object.freeze({
    appBaseUrl: r.APP_BASE_URL.replace(/\/$/, ''),
    allowedOrigins: r.ALLOWED_ORIGINS,
    hlRedirectUri: r.HL_REDIRECT_URI,
    hlScopes: r.HL_SCOPES,
    hlApiBaseUrl: r.HL_API_BASE_URL.replace(/\/$/, ''),
    hlAuthorizeUrl: r.HL_AUTHORIZE_URL,
    anthropicModel: r.ANTHROPIC_MODEL,
    anthropicEffort: r.ANTHROPIC_EFFORT,
    anthropicWorkspaceId: r.ANTHROPIC_WORKSPACE_ID,
    llmProvider: r.LLM_PROVIDER,
    sseSmokeEnabled: r.SSE_SMOKE_ENABLED,
    generationEnabled: r.GENERATION_ENABLED,
    generationDailyGlobalCap: r.GENERATION_DAILY_GLOBAL_CAP,
    anthropicFastMode: false,
    hlExtendedMethods: false,
  });
}

/** Reads Firebase params. Call only while handling a request (never at module load). */
export function loadRuntimeConfig(): RuntimeConfig {
  return parseRuntimeConfig({
    APP_BASE_URL: p.APP_BASE_URL.value(),
    ALLOWED_ORIGINS: p.ALLOWED_ORIGINS.value(),
    HL_REDIRECT_URI: p.HL_REDIRECT_URI.value(),
    HL_SCOPES: p.HL_SCOPES.value(),
    HL_API_BASE_URL: p.HL_API_BASE_URL.value(),
    HL_AUTHORIZE_URL: p.HL_AUTHORIZE_URL.value(),
    ANTHROPIC_MODEL: p.ANTHROPIC_MODEL.value(),
    ANTHROPIC_EFFORT: p.ANTHROPIC_EFFORT.value(),
    ANTHROPIC_WORKSPACE_ID: p.ANTHROPIC_WORKSPACE_ID.value(),
    LLM_PROVIDER: p.LLM_PROVIDER.value(),
    SSE_SMOKE_ENABLED: p.SSE_SMOKE_ENABLED.value(),
    GENERATION_ENABLED: p.GENERATION_ENABLED.value(),
    GENERATION_DAILY_GLOBAL_CAP: p.GENERATION_DAILY_GLOBAL_CAP.value(),
  });
}

export interface Secrets {
  readonly anthropicApiKey: string | null;
  readonly hlClientId: string;
  readonly hlClientSecret: string;
  readonly tokenEncryptionKey: string;
}

export function loadSecrets(opts: { anthropic: boolean }): Secrets {
  return Object.freeze({
    anthropicApiKey: opts.anthropic ? p.ANTHROPIC_API_KEY.value().trim() || null : null,
    hlClientId: p.HL_CLIENT_ID.value(),
    hlClientSecret: p.HL_CLIENT_SECRET.value(),
    tokenEncryptionKey: p.TOKEN_ENCRYPTION_KEY.value(),
  });
}

/** Why generation cannot run with this model setup, or null when it can. */
export function modelConfigError(
  config: Pick<RuntimeConfig, 'llmProvider'>,
  secrets: Pick<Secrets, 'anthropicApiKey'>,
): string | null {
  if (config.llmProvider === 'fake' || secrets.anthropicApiKey) return null;
  return 'ANTHROPIC_API_KEY is empty. Set it in functions/.secret.local (emulators) or Secret Manager, or set LLM_PROVIDER=fake to use the scripted model.';
}
