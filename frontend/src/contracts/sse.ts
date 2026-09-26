// GENERATED FILE — DO NOT EDIT.
// Source of truth: functions/src/contracts. Run `npm run contracts:sync` from the repo root.

import { z } from 'zod';
import { ErrorCodeSchema } from './errors.js';
import { IssueSchema, PartialResultSchema, UsageSchema } from './firestore-docs.js';
import { FileLanguageSchema } from './paths.js';

export const SSE_PROTOCOL_VERSION = 1 as const;

export const GenerationPhaseSchema = z.enum(['context', 'thinking', 'writing', 'validating', 'committing']);
export type GenerationPhase = z.infer<typeof GenerationPhaseSchema>;

const envelope = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({
    v: z.literal(SSE_PROTOCOL_VERSION),
    seq: z.number().int().min(1),
    generationId: z.string().min(1),
    ts: z.number(),
    type: z.literal(type),
    data,
  });

const RejectedFile = z.object({ path: z.string(), issues: z.array(IssueSchema) });

export const GenerationEventSchema = z.discriminatedUnion('type', [
  envelope(
    'generation.started',
    z.object({ projectId: z.string(), model: z.string(), promptVersion: z.string(), startedAt: z.string() }),
  ),
  envelope('generation.phase', z.object({ phase: GenerationPhaseSchema })),
  envelope('assistant.thinking', z.object({ text: z.string() })),
  envelope('assistant.delta', z.object({ text: z.string() })),
  envelope('file.started', z.object({ path: z.string(), language: FileLanguageSchema, op: z.literal('write') })),
  envelope('file.delta', z.object({ path: z.string(), text: z.string() })),
  envelope(
    'file.completed',
    z.object({
      path: z.string(),
      status: z.enum(['valid', 'rejected']),
      sizeBytes: z.number().int().min(0),
      sha256: z.string(),
      issues: z.array(IssueSchema),
    }),
  ),
  envelope(
    'file.deleted',
    z.object({ path: z.string(), status: z.enum(['valid', 'rejected']), issues: z.array(IssueSchema) }),
  ),
  envelope('heartbeat', z.object({})),
  envelope(
    'generation.completed',
    z.object({
      snapshotId: z.string(),
      snapshotSeq: z.number().int(),
      changedPaths: z.array(z.string()),
      deletedPaths: z.array(z.string()),
      rejected: z.array(RejectedFile),
      warnings: z.array(IssueSchema),
      noChanges: z.boolean(),
      usage: UsageSchema,
      durationMs: z.number().min(0),
    }),
  ),
  envelope(
    'generation.failed',
    z.object({
      error: z.object({ code: ErrorCodeSchema, message: z.string(), retryable: z.boolean() }),
      partial: PartialResultSchema.nullable(),
    }),
  ),
]);

export type GenerationEvent = z.infer<typeof GenerationEventSchema>;
export type GenerationEventType = GenerationEvent['type'];
export type GenerationEventData<T extends GenerationEventType> = Extract<GenerationEvent, { type: T }>['data'];

export const TERMINAL_EVENT_TYPES = ['generation.completed', 'generation.failed'] as const;
export const isTerminalEvent = (e: GenerationEvent): boolean =>
  (TERMINAL_EVENT_TYPES as readonly string[]).includes(e.type);
