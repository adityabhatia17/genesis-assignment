import { onRequest } from 'firebase-functions/https';
import { setGlobalOptions } from 'firebase-functions/options';
import { getApiApp, getGenerateApp } from './composition.js';
import {
  ANTHROPIC_API_KEY,
  API_MIN_INSTANCES,
  GENERATE_MIN_INSTANCES,
  HL_CLIENT_ID,
  HL_CLIENT_SECRET,
  TOKEN_ENCRYPTION_KEY,
} from './config/params.js';

setGlobalOptions({ region: 'us-central1' });

export const api = onRequest(
  {
    timeoutSeconds: 60,
    memory: '512MiB',
    concurrency: 80,
    maxInstances: 10,
    minInstances: API_MIN_INSTANCES,
    invoker: 'public',
    secrets: [HL_CLIENT_ID, HL_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  (req, res) => {
    getApiApp()(req, res);
  },
);

export const generate = onRequest(
  {
    timeoutSeconds: 540,
    memory: '1GiB',
    concurrency: 20,
    maxInstances: 5,
    minInstances: GENERATE_MIN_INSTANCES,
    invoker: 'public',
    secrets: [ANTHROPIC_API_KEY, HL_CLIENT_ID, HL_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  (req, res) => {
    getGenerateApp()(req, res);
  },
);
