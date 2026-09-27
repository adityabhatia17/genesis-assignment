import { createHash } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import type { RuntimeEventName } from '../../contracts/hl-runtime.js';
import type { Clock } from '../../shared/clock.js';
import { paths } from '../../shared/firestore-paths.js';
import { serializeError, type Logger } from '../../shared/logger.js';
import type { ConnectionRepo } from '../highlevel/connection/connection.repo.js';
import {
  verifyWebhookSignature,
  type WebhookKeys,
  PRODUCTION_WEBHOOK_KEYS,
} from './hl-webhook-signature.js';

const FIVE_MINUTES_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const PAYLOAD_KEYS = [
  'id',
  'locationId',
  'contactId',
  'calendarId',
  'conversationId',
  'appointmentId',
  'messageId',
] as const;

export const HL_EVENT_TYPES = {
  ContactCreate: 'contact.created',
  ContactUpdate: 'contact.updated',
  ContactDelete: 'contact.deleted',
  AppointmentCreate: 'appointment.created',
  AppointmentUpdate: 'appointment.updated',
  AppointmentDelete: 'appointment.deleted',
  InboundMessage: 'message.inbound',
  OutboundMessage: 'message.outbound',
} as const satisfies Record<string, RuntimeEventName>;

const LooseRecord = z.record(z.string(), z.unknown());
const WebhookBody = z.object({
  type: z.string().min(1).max(80),
  webhookId: z.string().min(1).max(200).optional(),
  timestamp: z.union([z.string().min(1), z.number()]).optional(),
  locationId: z.string().min(1).max(200).optional(),
  data: LooseRecord.optional(),
});

export interface WebhookDeps {
  readonly db: Firestore;
  readonly connections: Pick<ConnectionRepo, 'findUidsByLocation' | 'markReauthRequired'>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly keys?: WebhookKeys;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 200) : null;
}

export function webhookDocId(webhookId: string): string {
  return /^[A-Za-z0-9_-]{1,200}$/.test(webhookId)
    ? webhookId
    : createHash('sha256').update(webhookId).digest('hex');
}

function parseTimestamp(value: string | number): number | null {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function payloadFrom(
  body: Record<string, unknown>,
  data: Record<string, unknown>,
  locationId: string,
): Record<string, string> {
  const appointment = asRecord(body['appointment'] ?? data['appointment']);
  const payload: Record<string, string> = { locationId };
  for (const key of PAYLOAD_KEYS) {
    if (key === 'locationId') continue;
    const value = stringField(data, key) ?? stringField(body, key) ?? stringField(appointment, key);
    if (value) payload[key] = value;
  }
  const appointmentId = stringField(appointment, 'id');
  if (appointmentId) {
    payload['appointmentId'] ??= appointmentId;
    payload['id'] ??= appointmentId;
  }
  return payload;
}

/**
 * Verifies a HighLevel webhook and writes one owner-readable event per
 * connected user. Returns the HTTP status to send.
 *
 * Real per-event payloads often omit `timestamp` and `webhookId`. Those are
 * still delivered. Dedupe uses `webhookId` when present, otherwise a hash of
 * the signed body. A timestamp, when present, must be within 5 minutes —
 * HighLevel retries for days, and a late retry is useless in a live preview.
 * Duplicate, stale, unknown, and unmatched events return 200 so HighLevel
 * stops retrying. UNINSTALL is not deduped: marking reauth is idempotent,
 * and a failed update must stay retryable.
 */
export async function ingestWebhook(
  raw: Buffer,
  headers: IncomingHttpHeaders,
  deps: WebhookDeps,
): Promise<number> {
  if (!verifyWebhookSignature(raw, headers, deps.keys ?? PRODUCTION_WEBHOOK_KEYS)) return 401;

  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return 200;
  }
  const parsed = WebhookBody.safeParse(json);
  if (!parsed.success) return 200;

  if (parsed.data.timestamp !== undefined) {
    const at = parseTimestamp(parsed.data.timestamp);
    if (at === null || Math.abs(deps.clock.now() - at) > FIVE_MINUTES_MS) return 200;
  }

  const body = asRecord(json);
  const data = asRecord(parsed.data.data);
  const locationId = stringField(body, 'locationId') ?? stringField(data, 'locationId');
  if (!locationId) return 200;

  const uninstall = parsed.data.type === 'UNINSTALL';
  const eventType = HL_EVENT_TYPES[parsed.data.type as keyof typeof HL_EVENT_TYPES];
  const uids = await deps.connections.findUidsByLocation(locationId);
  if (uids.length === 0) return 200;

  if (uninstall) {
    await Promise.all(
      uids.map((uid) =>
        deps.connections.markReauthRequired(uid, 'hl_uninstalled', deps.clock.now()),
      ),
    );
    deps.logger.info('webhook.uninstall', { locationId, users: uids.length });
    return 200;
  }

  const docId = webhookDocId(
    parsed.data.webhookId ?? createHash('sha256').update(raw).digest('hex'),
  );
  const claimRef = deps.db.doc(paths.webhookEvent(docId));
  let created: boolean;
  try {
    created = await deps.db.runTransaction(async (tx) => {
      const existing = await tx.get(claimRef);
      if (existing.exists) return false;
      const now = deps.clock.now();
      const expiresAt = Timestamp.fromMillis(now + DAY_MS);
      tx.set(claimRef, {
        type: parsed.data.type,
        locationId,
        receivedAt: now,
        expiresAt,
      });
      if (eventType) {
        const payload = payloadFrom(body, data, locationId);
        for (const uid of uids) {
          tx.set(deps.db.doc(paths.userEvent(uid, docId)), {
            type: eventType,
            locationId,
            payload,
            createdAt: Timestamp.fromMillis(now),
            expiresAt,
          });
        }
      }
      return true;
    });
  } catch (err) {
    deps.logger.error('webhook.ingest_failed', {
      type: parsed.data.type,
      webhookId: docId,
      error: serializeError(err),
    });
    return 500;
  }
  if (!created) return 200;
  if (eventType) {
    deps.logger.info('webhook.delivered', { type: eventType, locationId, users: uids.length });
  }
  return 200;
}
