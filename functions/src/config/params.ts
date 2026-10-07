import { defineInt, defineSecret, defineString } from 'firebase-functions/params';

/**
 * Read-only scopes for the core runtime methods (the assignment requires real data, not writes).
 * BE-1.3's contract test asserts this equals scopesForMethods(RUNTIME_METHOD_NAMES).
 */
export const DEFAULT_HL_SCOPES = [
  'contacts.readonly',
  'conversations.readonly',
  'conversations/message.readonly',
  'calendars.readonly',
  'calendars/events.readonly',
  'locations.readonly',
].join(' ');

export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
export const HL_CLIENT_ID = defineSecret('HL_CLIENT_ID');
export const HL_CLIENT_SECRET = defineSecret('HL_CLIENT_SECRET');
export const TOKEN_ENCRYPTION_KEY = defineSecret('TOKEN_ENCRYPTION_KEY');

export const APP_BASE_URL = defineString('APP_BASE_URL');
export const ALLOWED_ORIGINS = defineString('ALLOWED_ORIGINS');
export const HL_REDIRECT_URI = defineString('HL_REDIRECT_URI');
export const HL_SCOPES = defineString('HL_SCOPES', { default: DEFAULT_HL_SCOPES });
export const HL_API_BASE_URL = defineString('HL_API_BASE_URL', {
  default: 'https://services.leadconnectorhq.com',
});
export const HL_AUTHORIZE_URL = defineString('HL_AUTHORIZE_URL', {
  default: 'https://marketplace.gohighlevel.com/v2/oauth/chooselocation',
});
export const ANTHROPIC_MODEL = defineString('ANTHROPIC_MODEL', { default: 'claude-sonnet-5' });
export const ANTHROPIC_EFFORT = defineString('ANTHROPIC_EFFORT', { default: 'medium' });
/** Required for an org API key that is not already scoped to one workspace. */
export const ANTHROPIC_WORKSPACE_ID = defineString('ANTHROPIC_WORKSPACE_ID', { default: '' });
export const LLM_PROVIDER = defineString('LLM_PROVIDER', { default: 'anthropic' });
export const SSE_SMOKE_ENABLED = defineString('SSE_SMOKE_ENABLED', { default: 'false' });
export const GENERATION_ENABLED = defineString('GENERATION_ENABLED', { default: 'true' });
export const GENERATION_DAILY_GLOBAL_CAP = defineInt('GENERATION_DAILY_GLOBAL_CAP', {
  default: 200,
});
export const VARIANTS_ENABLED = defineString('VARIANTS_ENABLED', { default: 'false' });
export const VARIANTS_COUNT = defineInt('VARIANTS_COUNT', { default: 4 });
export const VARIANTS_USER_PER_10MIN = defineInt('VARIANTS_USER_PER_10MIN', { default: 2 });
export const VARIANTS_USER_PER_DAY = defineInt('VARIANTS_USER_PER_DAY', { default: 3 });
export const VARIANTS_GLOBAL_PER_DAY = defineInt('VARIANTS_GLOBAL_PER_DAY', { default: 10 });
/** $10.00 → 1000. Integer cents avoid float drift in the counter. */
export const VARIANTS_DAILY_BUDGET_CENTS = defineInt('VARIANTS_DAILY_BUDGET_CENTS', {
  default: 1000,
});
export const VARIANTS_CHECKLIST_MODEL = defineString('VARIANTS_CHECKLIST_MODEL', {
  default: 'claude-haiku-4-5',
});
/** Empty until set. It must differ from ANTHROPIC_MODEL. */
export const VARIANTS_JUDGE_MODEL = defineString('VARIANTS_JUDGE_MODEL', { default: '' });
export const API_MIN_INSTANCES = defineInt('API_MIN_INSTANCES', { default: 0 });
export const GENERATE_MIN_INSTANCES = defineInt('GENERATE_MIN_INSTANCES', { default: 0 });
