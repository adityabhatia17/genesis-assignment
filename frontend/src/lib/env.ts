import { z } from 'zod';

const BaseUrl = z.url().transform((u) => u.replace(/\/+$/, ''));

const EnvSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),
  VITE_FIREBASE_APP_ID: z.string().min(1),
  VITE_API_BASE_URL: BaseUrl,
  VITE_GENERATE_BASE_URL: BaseUrl,
  VITE_USE_EMULATORS: z.enum(['true', 'false']).default('false'),
});

export interface Env {
  readonly firebase: { apiKey: string; authDomain: string; projectId: string; appId: string };
  readonly apiBaseUrl: string;
  readonly generateBaseUrl: string;
  readonly useEmulators: boolean;
}

export type EnvResult = { ok: true; env: Env } | { ok: false; problems: string[] };

/** Validates the Vite env once at startup; invalid config renders a readable screen instead of a blank page. */
export function parseEnv(raw: Record<string, unknown>): EnvResult {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  const e = parsed.data;
  return {
    ok: true,
    env: {
      firebase: {
        apiKey: e.VITE_FIREBASE_API_KEY,
        authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: e.VITE_FIREBASE_PROJECT_ID,
        appId: e.VITE_FIREBASE_APP_ID,
      },
      apiBaseUrl: e.VITE_API_BASE_URL,
      generateBaseUrl: e.VITE_GENERATE_BASE_URL,
      useEmulators: e.VITE_USE_EMULATORS === 'true',
    },
  };
}
