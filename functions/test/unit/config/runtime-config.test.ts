import { parseRuntimeConfig } from '../../../src/config/runtime-config.js';

const raw = {
  APP_BASE_URL: 'https://x.web.app',
  ALLOWED_ORIGINS: 'https://x.web.app, http://localhost:5173',
  HL_REDIRECT_URI: 'https://us-central1-x.cloudfunctions.net/api/v1/hl/oauth/callback',
  HL_SCOPES: 'contacts.readonly locations.readonly',
  HL_API_BASE_URL: 'https://services.leadconnectorhq.com',
  HL_AUTHORIZE_URL: 'https://marketplace.gohighlevel.com/v2/oauth/chooselocation',
  ANTHROPIC_MODEL: 'claude-opus-5',
  ANTHROPIC_EFFORT: 'medium',
  LLM_PROVIDER: 'fake',
  SSE_SMOKE_ENABLED: 'false',
};

describe('parseRuntimeConfig', () => {
  it('parses and normalizes values', () => {
    const c = parseRuntimeConfig(raw);
    expect(c.allowedOrigins).toEqual(['https://x.web.app', 'http://localhost:5173']);
    expect(c.hlScopes).toEqual(['contacts.readonly', 'locations.readonly']);
    expect(c.llmProvider).toBe('fake');
    expect(c.anthropicWorkspaceId).toBe('');
    expect(c.anthropicFastMode).toBe(false);
    expect(c.hlExtendedMethods).toBe(false);
  });
  it('rejects the word highlevel in the redirect URI', () => {
    expect(() =>
      parseRuntimeConfig({ ...raw, HL_REDIRECT_URI: 'https://genesis-highlevel.web.app/cb' }),
    ).toThrow(/highlevel/i);
  });
  it('keeps a workspace id when set', () => {
    expect(
      parseRuntimeConfig({ ...raw, ANTHROPIC_WORKSPACE_ID: 'wrkspc_test' }).anthropicWorkspaceId,
    ).toBe('wrkspc_test');
  });
  it('rejects unknown effort', () => {
    expect(() => parseRuntimeConfig({ ...raw, ANTHROPIC_EFFORT: 'ultra' })).toThrow();
  });
});
