import { z } from 'zod';
import type { ErrorCode } from './errors.js';
import type { RuntimeEventName } from './hl-runtime.js';
import type { FileLanguage } from './paths.js';
import type { CandidateScore, Checklist, VariantsRanking } from './variants.js';

export const IssueSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
  path: z.string().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadInputTokens: z.number().int().min(0),
  cacheCreationInputTokens: z.number().int().min(0),
  costUsd: z.number().min(0),
});
export type Usage = z.infer<typeof UsageSchema>;

export const PartialResultSchema = z.object({
  stagedPaths: z.array(z.string()),
  applyable: z.boolean(),
});
export type PartialResult = z.infer<typeof PartialResultSchema>;

export const GENERATION_STATUSES = [
  'streaming',
  'awaiting_selection',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];
export const TERMINAL_GENERATION_STATUSES = [
  'completed',
  'failed',
  'interrupted',
  'cancelled',
] as const;
export type TerminalGenerationStatus = (typeof TERMINAL_GENERATION_STATUSES)[number];

export type GenerationMode = 'single' | 'variants';

export interface VariantsRunState<T> {
  count: number;
  /** Latest snapshot when the run started. Selection requires it to be unchanged. */
  baseSnapshotId: string | null;
  directionsVersion: string;
  checklistPromptVersion: string;
  judgePromptVersion: string;
  calendarCount: number;
  checklist: Checklist | null;
  ranking: VariantsRanking | null;
  notice: 'only_one_option' | 'unjudged' | null;
  resolution: 'selected' | 'discarded' | null;
  selection: {
    candidateId: string;
    rank: number;
    topPickWasSelected: boolean;
    scores: Record<string, number>;
    selectedAt: T;
  } | null;
  cost: {
    candidatesCents: number;
    checklistCents: number;
    judgeCents: number;
    totalCents: number;
  };
  reservedCents: number;
}

export const CANDIDATE_STATUSES = [
  'pending',
  'generating',
  'retrying',
  'generated',
  'scoring',
  'scored',
  'disqualified',
  'failed',
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export interface CandidateDoc<T> {
  index: number;
  direction: { id: string; label: string };
  status: CandidateStatus;
  attempts: number;
  startedAt: T | null;
  completedAt: T | null;
  stopReason: string | null;
  error: GenerationError | null;
  usage: Usage | null;
  fileCount: number;
  totalBytes: number;
  warnings: Issue[];
  score: CandidateScore | null;
  expireAt: T;
}

export type SnapshotKind = 'generation' | 'checkpoint' | 'restore';
export type FileSource = 'ai' | 'manual' | 'restore';
export type IntegrationStatus = 'connected' | 'reauth_required' | 'disconnected';
export type ProjectStatus = 'active' | 'deleted';
export type MessageRole = 'user' | 'assistant' | 'system';

export interface IntegrationDoc<T> {
  provider: 'highlevel';
  status: IntegrationStatus;
  locationId: string | null;
  locationName: string | null;
  timezone: string | null;
  scopes: string[];
  connectedAt: T | null;
  updatedAt: T;
  lastErrorCode: string | null;
}

export interface ActiveGeneration<T> {
  id: string;
  startedAt: T;
  heartbeatAt: T;
}

export interface ProjectDoc<T> {
  name: string;
  description: string;
  locationId: string | null;
  status: ProjectStatus;
  createdAt: T;
  updatedAt: T;
  deletedAt: T | null;
  // server-owned (absent until the first server write)
  latestSnapshotId?: string | null;
  snapshotSeq?: number;
  fileCount?: number;
  totalBytes?: number;
  workingTreeDirty?: boolean;
  activeGeneration?: ActiveGeneration<T> | null;
  lastGenerationAt?: T | null;
}

export interface FileDoc<T> {
  path: string;
  language: FileLanguage;
  content: string;
  sizeBytes: number;
  contentHash: string;
  version: number;
  source: FileSource;
  updatedAt: T;
  lastGenerationId: string | null;
}

export interface MessageMeta {
  status?: GenerationStatus;
  changedPaths?: string[];
  deletedPaths?: string[];
  rejectedPaths?: string[];
  snapshotId?: string | null;
  snapshotSeq?: number | null;
}

export interface MessageDoc<T> {
  role: MessageRole;
  content: string;
  generationId: string | null;
  createdAt: T;
  meta: MessageMeta | null;
}

export interface GenerationError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface GenerationResult {
  snapshotId: string;
  snapshotSeq: number;
  changedPaths: string[];
  deletedPaths: string[];
  rejected: { path: string; issues: Issue[] }[];
  warnings: Issue[];
  noChanges: boolean;
}

export interface GenerationPartial<T> extends PartialResult {
  appliedAt: T | null;
  appliedSnapshotId: string | null;
  discardedAt: T | null;
}

export interface GenerationDoc<T> {
  status: GenerationStatus;
  /** Absent on documents written before variants. Treat as `single`. */
  mode?: GenerationMode;
  variants?: VariantsRunState<T> | null;
  prompt: string;
  promptVersion: string;
  model: string;
  effort: string;
  createdAt: T;
  startedAt: T;
  completedAt: T | null;
  heartbeatAt: T;
  stopReason: string | null;
  error: GenerationError | null;
  result: GenerationResult | null;
  partial: GenerationPartial<T> | null;
  usage: Usage | null;
  timings: { ttftMs: number | null; totalMs: number | null };
  context: {
    fileCount: number;
    historyMessages: number;
    externalIncluded: boolean;
    promptChars: number;
  };
}

export interface StagedFileDoc<T> {
  path: string;
  op: 'write' | 'delete';
  content: string | null;
  sizeBytes: number;
  contentHash: string | null;
  issues: Issue[];
  createdAt: T;
}

export interface RawArtifactDoc<T> {
  text: string;
  truncated: boolean;
  sizeBytes: number;
  createdAt: T;
}

export interface SnapshotFileEntry {
  path: string;
  blobId: string;
  sizeBytes: number;
  language: FileLanguage;
}

export interface SnapshotDoc<T> {
  seq: number;
  kind: SnapshotKind;
  label: string;
  generationId: string | null;
  restoredFromSnapshotId: string | null;
  parentSnapshotId: string | null;
  files: Record<string, SnapshotFileEntry>;
  fileCount: number;
  totalBytes: number;
  changedPaths: string[];
  deletedPaths: string[];
  createdAt: T;
}

export interface BlobDoc<T> {
  content: string;
  sizeBytes: number;
  createdAt: T;
}

/** Owner-readable relay of one HighLevel webhook. Clients cannot write it. */
export interface UserEventDoc<T> {
  type: RuntimeEventName;
  locationId: string;
  payload: Record<string, string>;
  createdAt: T;
  /** Firestore TTL. Events are live-preview signals and are deleted after a day. */
  expiresAt: T;
}
