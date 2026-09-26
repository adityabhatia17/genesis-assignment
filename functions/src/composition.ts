import type { Express, Router } from 'express';
import { loadRuntimeConfig, loadSecrets, type RuntimeConfig } from './config/runtime-config.js';
import { createHttpApp } from './http/create-http-app.js';
import { sseSmokeRouter } from './http/sse-smoke.routes.js';
import { connectionRouter } from './modules/highlevel/connection/connection.routes.js';
import { FirestoreConnectionRepo } from './modules/highlevel/connection/connection.repo.js';
import { createTokenCipher } from './modules/highlevel/connection/token-cipher.js';
import { createLocationLookup } from './modules/highlevel/oauth/location-lookup.js';
import { oauthAuthedRouter, oauthPublicRouter } from './modules/highlevel/oauth/oauth.routes.js';
import { OAuthService } from './modules/highlevel/oauth/oauth.service.js';
import { FirestoreOAuthStateRepo } from './modules/highlevel/oauth/oauth-state.repo.js';
import { createTokenEndpointClient } from './modules/highlevel/oauth/token-endpoint.client.js';
import { systemClock } from './shared/clock.js';
import { adminAuth, firestore } from './shared/firebase-admin.js';
import { createLogger } from './shared/logger.js';

export const VERSION =
  process.env['FUNCTIONS_EMULATOR'] === 'true' ? 'dev' : (process.env['K_REVISION'] ?? 'dev');

let apiApp: Express | undefined;
let generateApp: Express | undefined;

const verifyIdToken = async (token: string) => {
  const d = await adminAuth().verifyIdToken(token);
  return { uid: d.uid, email: d.email };
};

function buildApiApp(config: RuntimeConfig): Express {
  const logger = createLogger({ service: 'api' });
  const db = firestore();
  const clock = systemClock;
  const secrets = loadSecrets({ anthropic: false });
  const cipher = createTokenCipher(secrets.tokenEncryptionKey);
  const connections = new FirestoreConnectionRepo(db);
  const tokenEndpoint = createTokenEndpointClient({
    baseUrl: config.hlApiBaseUrl,
    clientId: secrets.hlClientId,
    clientSecret: secrets.hlClientSecret,
    redirectUri: config.hlRedirectUri,
  });
  const oauth = new OAuthService({
    config,
    clientId: secrets.hlClientId,
    states: new FirestoreOAuthStateRepo(db),
    tokens: tokenEndpoint,
    connections,
    locations: createLocationLookup({ baseUrl: config.hlApiBaseUrl }),
    cipher,
    clock,
    logger,
  });
  const publicRouters: Router[] = [oauthPublicRouter(oauth)];
  const authedRouters: Router[] = [oauthAuthedRouter(oauth), connectionRouter(connections, clock)];
  return createHttpApp({
    service: 'api',
    version: VERSION,
    allowedOrigins: config.allowedOrigins,
    logger,
    verifyIdToken,
    publicRouters,
    authedRouters,
  });
}

function buildGenerateApp(config: RuntimeConfig): Express {
  const logger = createLogger({ service: 'generate' });
  const publicRouters: Router[] = [];
  const authedRouters: Router[] = [];
  if (config.sseSmokeEnabled) publicRouters.push(sseSmokeRouter());
  return createHttpApp({
    service: 'generate',
    version: VERSION,
    allowedOrigins: config.allowedOrigins,
    logger,
    verifyIdToken,
    publicRouters,
    authedRouters,
  });
}

export function getApiApp(): Express {
  apiApp ??= buildApiApp(loadRuntimeConfig());
  return apiApp;
}

export function getGenerateApp(): Express {
  generateApp ??= buildGenerateApp(loadRuntimeConfig());
  return generateApp;
}
