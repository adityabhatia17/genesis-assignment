import type { Express, Router } from 'express';
import { loadRuntimeConfig, type RuntimeConfig } from './config/runtime-config.js';
import { createHttpApp } from './http/create-http-app.js';
import { sseSmokeRouter } from './http/sse-smoke.routes.js';
import { adminAuth } from './shared/firebase-admin.js';
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
  const publicRouters: Router[] = [];
  const authedRouters: Router[] = [];
  // Phase BE-3+ registers routers here.
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
