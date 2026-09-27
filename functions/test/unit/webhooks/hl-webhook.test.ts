import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { HL_WEBHOOK_ED25519_PEM } from '../../../src/modules/webhooks/hl-webhook-keys.js';
import { ingestWebhook, type WebhookDeps } from '../../../src/modules/webhooks/hl-webhook.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { paths } from '../../../src/shared/firestore-paths.js';
import { createLogger } from '../../../src/shared/logger.js';

const NOW = Date.parse('2026-09-27T08:00:00.000Z');

const ed = generateKeyPairSync('ed25519');
const keys = {
  ed25519Pem: ed.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
};
const DAY_MS = 24 * 60 * 60_000;

interface Stored {
  readonly docs: Map<string, Record<string, unknown>>;
  readonly db: Firestore;
}

function store(): Stored {
  const docs = new Map<string, Record<string, unknown>>();
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: async (
      fn: (tx: {
        get: (ref: { path: string }) => Promise<{ exists: boolean }>;
        set: (ref: { path: string }, data: Record<string, unknown>) => void;
      }) => Promise<boolean>,
    ) => {
      const tx = {
        get: async (ref: { path: string }) => ({ exists: docs.has(ref.path) }),
        set: (ref: { path: string }, data: Record<string, unknown>) => {
          docs.set(ref.path, data);
        },
      };
      return fn(tx);
    },
  };
  return { docs, db: db as unknown as Firestore };
}

function deps(
  stored: Stored,
  uids: string[] = ['u1'],
): WebhookDeps & {
  reauth: { uid: string; code: string }[];
} {
  const reauth: { uid: string; code: string }[] = [];
  return {
    db: stored.db,
    clock: createFakeClock(NOW),
    logger: createLogger(),
    keys,
    reauth,
    connections: {
      findUidsByLocation: async () => uids,
      markReauthRequired: async (uid, code) => {
        reauth.push({ uid, code });
      },
    },
  };
}

function body(over: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: 'ContactCreate',
      webhookId: 'wh_1',
      timestamp: new Date(NOW).toISOString(),
      locationId: 'loc_1',
      data: { id: 'c1', contactId: 'c1', firstName: 'Ava' },
      ...over,
    }),
  );
}

function edSig(raw: Buffer): string {
  return sign(null, raw, ed.privateKey).toString('base64');
}

describe('hl webhook', () => {
  it('accepts the published HighLevel public key', () => {
    expect(createPublicKey(HL_WEBHOOK_ED25519_PEM).asymmetricKeyType).toBe('ed25519');
  });

  it('writes contact.created for a valid Ed25519 signature and drops extra fields', async () => {
    const stored = store();
    const raw = body();
    const status = await ingestWebhook(raw, { 'x-ghl-signature': edSig(raw) }, deps(stored));
    expect(status).toBe(200);
    const expiresAt = Timestamp.fromMillis(NOW + DAY_MS);
    expect(stored.docs.get(paths.userEvent('u1', 'wh_1'))).toMatchObject({
      type: 'contact.created',
      locationId: 'loc_1',
      payload: { id: 'c1', locationId: 'loc_1', contactId: 'c1' },
      createdAt: Timestamp.fromMillis(NOW),
      expiresAt,
    });
    expect(stored.docs.get(paths.webhookEvent('wh_1'))).toMatchObject({
      type: 'ContactCreate',
      locationId: 'loc_1',
      expiresAt,
    });
  });

  it('rejects a request that only carries the retired RSA header', async () => {
    const stored = store();
    const raw = body();
    const status = await ingestWebhook(raw, { 'x-wh-signature': edSig(raw) }, deps(stored));
    expect(status).toBe(401);
    expect(stored.docs.size).toBe(0);
  });

  it('stores a flat ContactCreate that has no timestamp or webhook id', async () => {
    const stored = store();
    const raw = Buffer.from(
      JSON.stringify({
        type: 'ContactCreate',
        locationId: 'loc_1',
        id: 'c9',
        firstName: 'John',
        email: 'john@example.com',
      }),
    );
    const status = await ingestWebhook(raw, { 'x-ghl-signature': edSig(raw) }, deps(stored));
    expect(status).toBe(200);
    const events = [...stored.docs.entries()].filter(([path]) => path.includes('/events/'));
    expect(events).toHaveLength(1);
    expect(events[0]?.[1]).toMatchObject({
      type: 'contact.created',
      payload: { id: 'c9', locationId: 'loc_1' },
    });
    expect(events[0]?.[1]?.['payload']).not.toHaveProperty('firstName');
  });

  it('copies appointment ids out of the nested appointment object', async () => {
    const stored = store();
    const raw = Buffer.from(
      JSON.stringify({
        type: 'AppointmentCreate',
        locationId: 'loc_1',
        appointment: {
          id: 'apt_1',
          calendarId: 'cal_1',
          contactId: 'c1',
          title: 'Intro call',
        },
      }),
    );
    const status = await ingestWebhook(raw, { 'x-ghl-signature': edSig(raw) }, deps(stored));
    expect(status).toBe(200);
    const event = [...stored.docs.values()].find((doc) => doc['type'] === 'appointment.created');
    expect(event?.['payload']).toEqual({
      id: 'apt_1',
      locationId: 'loc_1',
      appointmentId: 'apt_1',
      calendarId: 'cal_1',
      contactId: 'c1',
    });
  });

  it('stores an InboundMessage that has no timestamp or webhook id', async () => {
    const stored = store();
    const raw = Buffer.from(
      JSON.stringify({
        type: 'InboundMessage',
        locationId: 'loc_1',
        contactId: 'c1',
        conversationId: 'conv_1',
        messageId: 'msg_1',
        body: 'Hi',
      }),
    );
    const status = await ingestWebhook(raw, { 'x-ghl-signature': edSig(raw) }, deps(stored));
    expect(status).toBe(200);
    const event = [...stored.docs.values()].find((doc) => doc['type'] === 'message.inbound');
    expect(event?.['payload']).toEqual({
      locationId: 'loc_1',
      contactId: 'c1',
      conversationId: 'conv_1',
      messageId: 'msg_1',
    });
  });

  it('rejects a tampered body and does not write', async () => {
    const stored = store();
    const raw = body();
    const status = await ingestWebhook(
      Buffer.from(raw.toString('utf8').replace('Ava', 'Eve')),
      { 'x-ghl-signature': edSig(raw) },
      deps(stored),
    );
    expect(status).toBe(401);
    expect(stored.docs.size).toBe(0);
  });

  it('acks a duplicate webhook without a second user event', async () => {
    const stored = store();
    const raw = body();
    const d = deps(stored);
    expect(await ingestWebhook(raw, { 'x-ghl-signature': edSig(raw) }, d)).toBe(200);
    expect(await ingestWebhook(raw, { 'x-ghl-signature': edSig(raw) }, d)).toBe(200);
    const events = [...stored.docs.keys()].filter((path) => path.includes('/events/'));
    expect(events).toEqual([paths.userEvent('u1', 'wh_1')]);
  });

  it('acks a stale timestamp without writing', async () => {
    const stored = store();
    const raw = body({ timestamp: new Date(NOW - 6 * 60_000).toISOString() });
    const status = await ingestWebhook(raw, { 'x-ghl-signature': edSig(raw) }, deps(stored));
    expect(status).toBe(200);
    expect(stored.docs.size).toBe(0);
  });

  it('marks every connected user for reconnect on UNINSTALL and writes no preview event', async () => {
    const stored = store();
    const raw = body({ type: 'UNINSTALL', webhookId: 'wh_u', data: undefined });
    const d = deps(stored, ['u1', 'u2']);
    const status = await ingestWebhook(raw, { 'x-ghl-signature': edSig(raw) }, d);
    expect(status).toBe(200);
    expect(d.reauth).toEqual([
      { uid: 'u1', code: 'hl_uninstalled' },
      { uid: 'u2', code: 'hl_uninstalled' },
    ]);
    expect([...stored.docs.keys()].some((path) => path.includes('/events/'))).toBe(false);
  });

  it('accepts a location UNINSTALL that has no webhook id or timestamp', async () => {
    const stored = store();
    const raw = Buffer.from(
      JSON.stringify({ type: 'UNINSTALL', appId: 'app', locationId: 'loc_1' }),
    );
    const d = deps(stored, ['u1']);
    const status = await ingestWebhook(raw, { 'x-ghl-signature': edSig(raw) }, d);
    expect(status).toBe(200);
    expect(d.reauth).toEqual([{ uid: 'u1', code: 'hl_uninstalled' }]);
    expect([...stored.docs.keys()].some((path) => path.includes('/events/'))).toBe(false);
  });

  it('acks an unmatched location without claiming it', async () => {
    const stored = store();
    const raw = body();
    const status = await ingestWebhook(raw, { 'x-ghl-signature': edSig(raw) }, deps(stored, []));
    expect(status).toBe(200);
    expect(stored.docs.size).toBe(0);
  });
});
