// GENERATED FILE — DO NOT EDIT.
// Source of truth: functions/src/contracts. Run `npm run contracts:sync` from the repo root.

import { z } from 'zod';
import { LocationSchema, type RuntimeEventName } from './hl-runtime.js';

export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export const HelloMessageSchema = z.object({
  source: z.literal('genesis-preview'),
  type: z.literal('hello'),
  protocol: z.literal(BRIDGE_PROTOCOL_VERSION),
  nonce: z.string().min(8).max(128),
});

export const PreviewContextSchema = z.object({
  location: LocationSchema.nullable(),
  project: z.object({ id: z.string(), name: z.string() }),
  hlStatus: z.enum(['connected', 'reauth_required', 'disconnected']),
});
export type PreviewContext = z.infer<typeof PreviewContextSchema>;

export interface InitMessage {
  source: 'genesis-host';
  type: 'init';
  protocol: typeof BRIDGE_PROTOCOL_VERSION;
  nonce: string;
  context: PreviewContext;
}

export const PortInboundSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('rpc'),
    id: z.string().min(1).max(64),
    method: z.string().min(1).max(64),
    params: z.unknown(),
  }),
  z.object({
    type: z.literal('console'),
    level: z.enum(['log', 'info', 'warn', 'error']),
    args: z.array(z.string().max(2_048)).max(20),
  }),
  z.object({
    type: z.literal('runtime-error'),
    message: z.string().max(2_048),
    stack: z.string().max(8_192).optional(),
  }),
]);
export type PortInbound = z.infer<typeof PortInboundSchema>;

export interface RpcErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}
export type RpcResultMessage =
  | { type: 'rpc-result'; id: string; ok: true; result: unknown }
  | { type: 'rpc-result'; id: string; ok: false; error: RpcErrorPayload };
export interface HostEventMessage {
  type: 'event';
  name: RuntimeEventName;
  payload: Record<string, unknown>;
}
