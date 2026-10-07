import { z } from 'zod';
import { LIMITS } from './limits.js';
import { ErrorCodeSchema } from './errors.js';
import { RankedEntrySchema } from './variants.js';

export const DocId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');
const FileId = z.string().regex(/^[0-9a-f]{20}$/, 'Invalid file id');
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const apiSuccess = <T extends z.ZodType>(data: T) => z.object({ data });

// OAuth
export const OAuthStartBody = z.strictObject({
  returnPath: z
    .string()
    .max(200)
    .regex(/^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/, 'Must be an internal path')
    .optional(),
});
export const OAuthStartResult = z.object({ authorizeUrl: z.url() });
export const OAuthCallbackQuery = z.object({
  code: z.string().min(1).max(2_048).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(200).optional(),
});
export const OAUTH_REDIRECT_REASONS = [
  'state_invalid',
  'denied',
  'exchange_failed',
  'not_location_token',
  'internal',
] as const;
export type OAuthRedirectReason = (typeof OAUTH_REDIRECT_REASONS)[number];
export const DisconnectResult = z.object({ status: z.literal('disconnected') });

// Projects / files / snapshots
export const ProjectParams = z.object({ projectId: DocId });
export const FileSaveParams = z.object({ projectId: DocId, fileId: FileId });
export const FileSaveBody = z.strictObject({
  content: z.string().max(LIMITS.maxFileBytes), // UTF-16 length bound; byte bound enforced in the service
  expectedVersion: z.number().int().min(1),
});
export const FileSaveResult = z.object({
  fileId: FileId,
  path: z.string(),
  version: z.number().int(),
  sizeBytes: z.number().int(),
  contentHash: Sha256,
});
export type FileSaveResult = z.infer<typeof FileSaveResult>;

export const RestoreParams = z.object({ projectId: DocId, snapshotId: DocId });
export const RestoreResult = z.object({
  snapshotId: z.string(),
  snapshotSeq: z.number().int(),
  restoredFromSnapshotId: z.string(),
  checkpointSnapshotId: z.string().nullable(),
});
export type RestoreResult = z.infer<typeof RestoreResult>;

// Generations
export const StartGenerationBody = z.strictObject({
  clientRequestId: z.uuid(),
  prompt: z.string().trim().min(1).max(LIMITS.promptMaxChars),
});
export type StartGenerationBody = z.infer<typeof StartGenerationBody>;
export const GenerationParams = z.object({ projectId: DocId, generationId: z.uuid() });
export const ApplyResult = z.object({
  snapshotId: z.string(),
  snapshotSeq: z.number().int(),
  appliedPaths: z.array(z.string()),
  deletedPaths: z.array(z.string()),
});
export type ApplyResult = z.infer<typeof ApplyResult>;
export const DiscardResult = z.object({ discarded: z.literal(true) });
export const CancelResult = z.object({ cancelled: z.literal(true) });
export type CancelResult = z.infer<typeof CancelResult>;

export const VariantsParams = GenerationParams;
export const SelectCandidateBody = z.strictObject({
  candidateId: z.string().regex(/^c[0-9]$/),
});
export type SelectCandidateBody = z.infer<typeof SelectCandidateBody>;
export const SelectCandidateResult = z.object({
  snapshotId: z.string(),
  snapshotSeq: z.number().int(),
  candidateId: z.string(),
  appliedPaths: z.array(z.string()),
});
export type SelectCandidateResult = z.infer<typeof SelectCandidateResult>;

export const VariantsResultDto = z.object({
  generationId: z.string(),
  status: z.enum([
    'streaming',
    'awaiting_selection',
    'completed',
    'failed',
    'interrupted',
    'cancelled',
  ]),
  resolution: z.enum(['selected', 'discarded']).nullable(),
  selectedCandidateId: z.string().nullable(),
  top: z.array(RankedEntrySchema),
  notice: z.enum(['only_one_option', 'unjudged']).nullable(),
  error: z
    .object({ code: ErrorCodeSchema, message: z.string(), retryable: z.boolean() })
    .nullable(),
});
export type VariantsResultDto = z.infer<typeof VariantsResultDto>;

export const HealthResult = z.object({
  ok: z.literal(true),
  service: z.string(),
  version: z.string(),
});
