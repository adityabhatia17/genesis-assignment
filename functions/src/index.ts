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
import { FirestoreConnectionRepo } from './modules/highlevel/connection/connection.repo.js';
import { ingestWebhook } from './modules/webhooks/hl-webhook.js';
import { systemClock } from './shared/clock.js';
import { firestore } from './shared/firebase-admin.js';
import { createLogger } from './shared/logger.js';

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

const webhookLog = createLogger({ service: 'webhook' });

/** Public HighLevel webhook. Verifies the signature against the raw body. */
export const hlWebhook = onRequest(
  {
    timeoutSeconds: 30,
    memory: '256MiB',
    concurrency: 40,
    maxInstances: 5,
    invoker: 'public',
  },
  (req, res) => {
    const raw = req.rawBody;
    if (req.method !== 'POST' || !Buffer.isBuffer(raw)) {
      res.status(401).json({ ok: false });
      return;
    }
    const db = firestore();
    void ingestWebhook(raw, req.headers, {
      db,
      connections: new FirestoreConnectionRepo(db),
      clock: systemClock,
      logger: webhookLog,
    }).then(
      (status) => {
        if (!res.headersSent) res.status(status).json({ ok: status === 200 });
      },
      () => {
        if (!res.headersSent) res.status(500).json({ ok: false });
      },
    );
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
