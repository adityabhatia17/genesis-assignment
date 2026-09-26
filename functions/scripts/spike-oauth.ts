// Usage: HL_CLIENT_ID=… HL_CLIENT_SECRET=… HL_REDIRECT_URI=… npx tsx scripts/spike-oauth.ts
// Prints an authorize URL; paste the full callback URL back; exchanges the code; refreshes twice; reuses an old token.
// Never prints token values. Stores them in ./spike-tokens.json (git-ignored).
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { DEFAULT_HL_SCOPES } from '../src/config/params.js';
import {
  createTokenEndpointClient,
  TokenEndpointError,
} from '../src/modules/highlevel/oauth/token-endpoint.client.js';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const clientId = env('HL_CLIENT_ID');
const redirectUri = env('HL_REDIRECT_URI');
const client = createTokenEndpointClient({
  baseUrl: 'https://services.leadconnectorhq.com',
  clientId,
  clientSecret: env('HL_CLIENT_SECRET'),
  redirectUri,
});
const state = randomBytes(16).toString('base64url');

const url = new URL('https://marketplace.gohighlevel.com/v2/oauth/chooselocation');
Object.entries({
  response_type: 'code',
  redirect_uri: redirectUri,
  client_id: clientId,
  scope: DEFAULT_HL_SCOPES,
  state,
  loginWindowOpenMode: 'self',
}).forEach(([k, v]) => url.searchParams.set(k, v));
console.log('\n1) Open:\n', url.toString());

const rl = createInterface({ input: process.stdin, output: process.stdout });
const callback = new URL(await rl.question('\n2) Paste the full callback URL: '));
rl.close();
console.log('S1 state echoed:', callback.searchParams.get('state') === state);

const t1 = await client.exchangeCode(callback.searchParams.get('code') ?? '');
console.log('S2 exchange ok:', {
  userType: t1.userType,
  locationId: t1.locationId,
  expiresIn: t1.expires_in,
  scope: t1.scope,
});
const t2 = await client.refresh(t1.refresh_token);
const t3 = await client.refresh(t2.refresh_token);
console.log(
  'S3 rotation ok:',
  t2.refresh_token !== t1.refresh_token && t3.refresh_token !== t2.refresh_token,
);
try {
  await client.refresh(t1.refresh_token);
  console.log('S4 UNEXPECTED: old refresh token still works');
} catch (e) {
  console.log(
    'S4 reuse rejected:',
    e instanceof TokenEndpointError ? { status: e.status, code: e.errorCode } : String(e),
  );
}
writeFileSync(
  'spike-tokens.json',
  JSON.stringify({ access_token: t3.access_token, locationId: t1.locationId }, null, 2),
);
console.log(
  '\nSaved latest access token to spike-tokens.json (git-ignored) for fixture recording.',
);
