import Anthropic from '@anthropic-ai/sdk';
import type { Express, Router } from 'express';
import { loadRuntimeConfig, loadSecrets, type RuntimeConfig } from './config/runtime-config.js';
import { LIMITS } from './contracts/limits.js';
import { createHttpApp } from './http/create-http-app.js';
import { sseSmokeRouter } from './http/sse-smoke.routes.js';
import { FileSaveService } from './modules/files/file-save.service.js';
import { filesRouter } from './modules/files/files.routes.js';
import { ContextBuilder } from './modules/generation/context/context-builder.js';
import { generationRouter } from './modules/generation/generate.app.js';
import { AnthropicProvider } from './modules/generation/llm/anthropic.provider.js';
import { FakeProvider } from './modules/generation/llm/fake.provider.js';
import type { ModelProvider } from './modules/generation/llm/model-provider.js';
import { GenerationOrchestrator } from './modules/generation/orchestrator.js';
import { CommitService } from './modules/generation/persistence/commit.service.js';
import { GenerationsRepo } from './modules/generation/persistence/generations.repo.js';
import { generationControlRouter } from './modules/generation/routes/generation-control.routes.js';
import { connectionRouter } from './modules/highlevel/connection/connection.routes.js';
import { FirestoreConnectionRepo } from './modules/highlevel/connection/connection.repo.js';
import { createTokenCipher } from './modules/highlevel/connection/token-cipher.js';
import { TokenManager } from './modules/highlevel/connection/token-manager.js';
import { createHlHttpClient } from './modules/highlevel/client/hl-http.client.js';
import { createLocationLookup } from './modules/highlevel/oauth/location-lookup.js';
import { oauthAuthedRouter, oauthPublicRouter } from './modules/highlevel/oauth/oauth.routes.js';
import { OAuthService } from './modules/highlevel/oauth/oauth.service.js';
import { FirestoreOAuthStateRepo } from './modules/highlevel/oauth/oauth-state.repo.js';
import { createTokenEndpointClient } from './modules/highlevel/oauth/token-endpoint.client.js';
import { LocationContextService } from './modules/highlevel/metadata/location-context.service.js';
import { runtimeRouter } from './modules/highlevel/runtime/runtime.routes.js';
import { RuntimeService } from './modules/highlevel/runtime/runtime.service.js';
import { FirestoreProjectAccess } from './modules/projects/project-access.js';
import { BlobsRepo } from './modules/snapshots/blobs.repo.js';
import { RestoreService } from './modules/snapshots/restore.service.js';
import { snapshotsRouter } from './modules/snapshots/snapshots.routes.js';
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
  const hl = createHlHttpClient({
    baseUrl: config.hlApiBaseUrl,
    logger: logger.child({ component: 'hl' }),
  });
  const tokenManager = new TokenManager({
    repo: connections,
    tokens: tokenEndpoint,
    cipher,
    clock,
    logger,
  });
  const runtime = new RuntimeService({
    projects: new FirestoreProjectAccess(db),
    tokens: tokenManager,
    connections,
    hl,
  });
  const blobs = new BlobsRepo(db);
  const commits = new CommitService(db, blobs);
  const publicRouters: Router[] = [oauthPublicRouter(oauth)];
  const authedRouters: Router[] = [
    oauthAuthedRouter(oauth),
    connectionRouter(connections, clock),
    runtimeRouter(runtime),
    generationControlRouter({ generations: new GenerationsRepo(db), commits, clock }),
    filesRouter(new FileSaveService(db, clock)),
    snapshotsRouter(new RestoreService(db, blobs, commits, clock)),
  ];
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
  const db = firestore();
  const clock = systemClock;
  const secrets = loadSecrets({ anthropic: config.llmProvider === 'anthropic' });
  const cipher = createTokenCipher(secrets.tokenEncryptionKey);
  const connections = new FirestoreConnectionRepo(db);
  const tokenEndpoint = createTokenEndpointClient({
    baseUrl: config.hlApiBaseUrl,
    clientId: secrets.hlClientId,
    clientSecret: secrets.hlClientSecret,
    redirectUri: config.hlRedirectUri,
  });
  const tokens = new TokenManager({
    repo: connections,
    tokens: tokenEndpoint,
    cipher,
    clock,
    logger,
  });
  const hl = createHlHttpClient({
    baseUrl: config.hlApiBaseUrl,
    logger: logger.child({ component: 'hl' }),
  });
  const locationContext = new LocationContextService({ connections, tokens, hl, clock, logger });
  const provider: ModelProvider =
    config.llmProvider === 'fake'
      ? new FakeProvider({ chunkDelayMs: 15 })
      : new AnthropicProvider(
          new Anthropic({ apiKey: secrets.anthropicApiKey ?? '', maxRetries: 2, timeout: 600_000 }),
          {
            model: config.anthropicModel,
            effort: config.anthropicEffort,
            maxTokens: LIMITS.maxOutputTokens,
            fastMode: config.anthropicFastMode,
          },
        );
  const orchestrator = new GenerationOrchestrator({
    generations: new GenerationsRepo(db),
    commits: new CommitService(db, new BlobsRepo(db)),
    context: new ContextBuilder(db, locationContext),
    provider,
    clock,
  });
  const publicRouters: Router[] = config.sseSmokeEnabled ? [sseSmokeRouter()] : [];
  const authedRouters: Router[] = [generationRouter({ orchestrator })];
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
