import { z } from 'zod';
import { ErrorCodeSchema } from './errors.js';
import { IssueSchema, PartialResultSchema, UsageSchema } from './firestore-docs.js';
import { FileLanguageSchema } from './paths.js';
import { RankedEntrySchema } from './variants.js';

export const SSE_PROTOCOL_VERSION = 1 as const;

export const GenerationPhaseSchema = z.enum([
  'context',
  'thinking',
  'writing',
  'validating',
  'committing',
]);
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
    z.object({
      projectId: z.string(),
      model: z.string(),
      promptVersion: z.string(),
      startedAt: z.string(),
      mode: z.enum(['single', 'variants']).default('single'),
      /** Present when variants were expected but the run fell back. */
      fallbackReason: z
        .enum(['disabled', 'budget', 'user_limit', 'global_limit', 'busy', 'not_first'])
        .optional(),
    }),
  ),
  envelope('generation.phase', z.object({ phase: GenerationPhaseSchema })),
  envelope('assistant.thinking', z.object({ text: z.string() })),
  envelope('assistant.delta', z.object({ text: z.string() })),
  envelope(
    'file.started',
    z.object({ path: z.string(), language: FileLanguageSchema, op: z.literal('write') }),
  ),
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
    z.object({
      path: z.string(),
      status: z.enum(['valid', 'rejected']),
      issues: z.array(IssueSchema),
    }),
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
  envelope('generation.cancelled', z.object({ partial: PartialResultSchema.nullable() })),
  envelope(
    'variants.phase',
    z.object({
      phase: z.enum(['checklist', 'generating', 'scoring', 'judging', 'ranking']),
    }),
  ),
  envelope(
    'candidate.progress',
    z.object({
      candidateId: z.string().regex(/^c[0-9]$/),
      stage: z.enum([
        'queued',
        'generating',
        'retrying',
        'validating',
        'scoring',
        'done',
        'failed',
      ]),
      filesDone: z.number().int().min(0).optional(),
    }),
  ),
  envelope(
    'variants.ready',
    z.object({
      top: z.array(RankedEntrySchema).max(2),
      notice: z.enum(['only_one_option', 'unjudged']).nullable(),
      usage: UsageSchema,
      durationMs: z.number().min(0),
    }),
  ),
]);

export type GenerationEvent = z.infer<typeof GenerationEventSchema>;
export type GenerationEventType = GenerationEvent['type'];
export type GenerationEventData<T extends GenerationEventType> = Extract<
  GenerationEvent,
  { type: T }
>['data'];

export const TERMINAL_EVENT_TYPES = [
  'generation.completed',
  'generation.failed',
  'generation.cancelled',
  'variants.ready',
] as const;
export const isTerminalEvent = (e: GenerationEvent): boolean =>
  (TERMINAL_EVENT_TYPES as readonly string[]).includes(e.type);
