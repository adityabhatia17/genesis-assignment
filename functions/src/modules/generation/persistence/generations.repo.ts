import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type {
  GenerationError,
  Issue,
  MessageMeta,
  PartialResult,
  Usage,
} from '../../../contracts/firestore-docs.js';
import { LIMITS } from '../../../contracts/limits.js';
import type { FileLanguage } from '../../../contracts/paths.js';
import { AppError } from '../../../shared/app-error.js';
import { paths } from '../../../shared/firestore-paths.js';
import { fileIdForPath, utf8Bytes } from '../../../shared/hash.js';
import {
  isLeaseStale,
  toProjectRecord,
  type ProjectRecord,
} from '../../projects/project-access.js';
import type { FileOp } from '../validation/validate-file.js';

const ts = (ms: number) => Timestamp.fromMillis(ms);

export interface StartInput {
  uid: string;
  projectId: string;
  generationId: string;
  prompt: string;
  promptVersion: string;
  model: string;
  effort: string;
  nowMs: number;
}
export interface StartResult {
  project: ProjectRecord;
  projectDescription: string;
}

export interface GenerationTimings {
  ttftMs: number | null;
  totalMs: number | null;
}
export interface GenerationContextStats {
  fileCount: number;
  historyMessages: number;
  externalIncluded: boolean;
  promptChars: number;
}

export interface FinalizeInput {
  uid: string;
  projectId: string;
  generationId: string;
  nowMs: number;
  status: 'failed' | 'cancelled' | 'interrupted';
  error: GenerationError | null;
  partial: PartialResult | null;
  stopReason: string | null;
  usage: Usage | null;
  timings: GenerationTimings;
  context: GenerationContextStats | null;
  assistantText: string;
}

export interface GenerationRecord {
  id: string;
  status: string;
  prompt: string;
  heartbeatAtMs: number;
  partial: (PartialResult & { applied: boolean; discarded: boolean }) | null;
}

export const generationPartial = (p: PartialResult | null) =>
  p ? { ...p, appliedAt: null, appliedSnapshotId: null, discardedAt: null } : null;

export function interruptedPatch(stagedPaths: string[], nowMs: number): Record<string, unknown> {
  return {
    status: 'interrupted',
    completedAt: ts(nowMs),
    error: {
      code: 'GENERATION_INTERRUPTED',
      message: 'The generation stopped unexpectedly.',
      retryable: true,
    },
    partial: generationPartial({
      stagedPaths,
      applyable: stagedPaths.length > 0,
    }),
  };
}

const assistantNote = (
  generationId: string,
  status: string,
  nowMs: number,
  text: string,
  meta: MessageMeta = {},
) => ({
  role: 'assistant',
  content: text,
  generationId,
  createdAt: ts(nowMs),
  meta: { status, ...meta },
});

export class GenerationsRepo {
  constructor(private readonly db: Firestore) {}

  private genRef(uid: string, pid: string, gid: string) {
    return this.db.doc(paths.generation(uid, pid, gid));
  }
  private projectRef(uid: string, pid: string) {
    return this.db.doc(paths.project(uid, pid));
  }

  /**
   * Aborts the in-flight generation when `cancelRequestedAt` is written.
   * Status stays `streaming` until finalize, so a dropped connection is still distinct.
   */
  watchCancel(
    uid: string,
    pid: string,
    gid: string,
    onCancel: () => void,
    onError: (err: unknown) => void,
  ): () => void {
    let stopped = false;
    const unsubscribe = this.genRef(uid, pid, gid).onSnapshot(
      (snap) => {
        if (stopped || !snap.exists || snap.get('cancelRequestedAt') == null) return;
        stopped = true;
        unsubscribe();
        onCancel();
      },
      (err) => onError(err),
    );
    return () => {
      stopped = true;
      unsubscribe();
    };
  }

  /** Marks a running generation for cancellation. A repeat call while the flag is set is a no-op. */
  async requestCancel(uid: string, pid: string, gid: string, nowMs: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.genRef(uid, pid, gid);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new AppError('GENERATION_NOT_FOUND');
      if (snap.get('cancelRequestedAt') != null) return;
      if (snap.get('status') !== 'streaming') throw new AppError('GENERATION_NOT_CANCELLABLE');
      tx.update(ref, { cancelRequestedAt: ts(nowMs) });
    });
  }

  /** Idempotency + lease + stale takeover + generation/user-message docs, in one transaction. */
  start(i: StartInput): Promise<StartResult> {
    const projectRef = this.projectRef(i.uid, i.projectId);
    const genRef = this.genRef(i.uid, i.projectId, i.generationId);
    const messages = this.db.collection(paths.messages(i.uid, i.projectId));
    return this.db.runTransaction(async (tx) => {
      const [projectSnap, genSnap] = await tx.getAll(projectRef, genRef);
      if (!projectSnap?.exists || projectSnap.get('status') !== 'active')
        throw new AppError('PROJECT_NOT_FOUND');
      if (genSnap?.exists)
        throw new AppError('DUPLICATE_REQUEST', undefined, {
          generationId: i.generationId,
          status: genSnap.get('status') as string,
        });
      const project = toProjectRecord(projectSnap.id, projectSnap.data());

      let staleId: string | null = null;
      let staleStaged: string[] = [];
      if (project.activeGeneration) {
        if (!isLeaseStale(project.activeGeneration, i.nowMs)) {
          throw new AppError('GENERATION_IN_PROGRESS', undefined, {
            activeGenerationId: project.activeGeneration.id,
          });
        }
        staleId = project.activeGeneration.id;
        const staged = await tx.get(this.db.collection(paths.staged(i.uid, i.projectId, staleId)));
        staleStaged = staged.docs
          .filter((d) => d.get('op') === 'write')
          .map((d) => d.get('path') as string);
      }

      if (staleId) {
        tx.set(this.genRef(i.uid, i.projectId, staleId), interruptedPatch(staleStaged, i.nowMs), {
          merge: true,
        });
        tx.create(
          messages.doc(),
          assistantNote(
            staleId,
            'interrupted',
            i.nowMs - 1,
            '(This generation stopped unexpectedly.)',
          ),
        );
      }
      const now = ts(i.nowMs);
      tx.create(genRef, {
        status: 'streaming',
        prompt: i.prompt,
        promptVersion: i.promptVersion,
        model: i.model,
        effort: i.effort,
        createdAt: now,
        startedAt: now,
        completedAt: null,
        heartbeatAt: now,
        stopReason: null,
        error: null,
        result: null,
        partial: null,
        usage: null,
        timings: { ttftMs: null, totalMs: null },
        context: {
          fileCount: 0,
          historyMessages: 0,
          externalIncluded: false,
          promptChars: i.prompt.length,
        },
      });
      tx.create(messages.doc(), {
        role: 'user',
        content: i.prompt,
        generationId: i.generationId,
        createdAt: now,
        meta: null,
      });
      tx.update(projectRef, {
        activeGeneration: {
          id: i.generationId,
          startedAt: now,
          heartbeatAt: now,
        },
        updatedAt: now,
      });
      return {
        project,
        projectDescription: (projectSnap.get('description') as string | undefined) ?? '',
      };
    });
  }

  /** Heartbeat on both documents, only while this generation still holds the lease. */
  async touch(uid: string, pid: string, gid: string, nowMs: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.projectRef(uid, pid));
      if ((snap.get('activeGeneration.id') as string | undefined) !== gid) return;
      tx.update(this.projectRef(uid, pid), {
        'activeGeneration.heartbeatAt': ts(nowMs),
      });
      tx.update(this.genRef(uid, pid, gid), { heartbeatAt: ts(nowMs) });
    });
  }

  async stage(
    uid: string,
    pid: string,
    gid: string,
    op: FileOp,
    warnings: Issue[],
    nowMs: number,
  ): Promise<void> {
    await this.db.doc(`${paths.staged(uid, pid, gid)}/${fileIdForPath(op.path)}`).set({
      path: op.path,
      op: op.op,
      content: op.op === 'write' ? op.content : null,
      sizeBytes: op.op === 'write' ? op.sizeBytes : 0,
      contentHash: op.op === 'write' ? op.sha256 : null,
      language: op.op === 'write' ? op.language : null,
      issues: warnings,
      createdAt: ts(nowMs),
    });
  }

  async listStaged(uid: string, pid: string, gid: string): Promise<FileOp[]> {
    const snap = await this.db.collection(paths.staged(uid, pid, gid)).get();
    return snap.docs.map((d): FileOp => {
      const path = d.get('path') as string;
      if (d.get('op') === 'delete') return { op: 'delete', path };
      const content = d.get('content') as string;
      return {
        op: 'write',
        path,
        content,
        sizeBytes: utf8Bytes(content),
        sha256: d.get('contentHash') as string,
        language: d.get('language') as FileLanguage,
      };
    });
  }

  /** Terminal state without touching the working tree. Returns false if already terminal. */
  finalizeWithoutCommit(i: FinalizeInput): Promise<boolean> {
    const genRef = this.genRef(i.uid, i.projectId, i.generationId);
    const projectRef = this.projectRef(i.uid, i.projectId);
    return this.db.runTransaction(async (tx) => {
      const [genSnap, projectSnap] = await tx.getAll(genRef, projectRef);
      if (!genSnap?.exists || genSnap.get('status') !== 'streaming') return false;
      tx.update(genRef, {
        status: i.status,
        completedAt: ts(i.nowMs),
        stopReason: i.stopReason,
        error: i.error,
        partial: generationPartial(i.partial),
        usage: i.usage,
        timings: i.timings,
        ...(i.context ? { context: i.context } : {}),
      });
      tx.create(
        this.db.collection(paths.messages(i.uid, i.projectId)).doc(),
        assistantNote(i.generationId, i.status, i.nowMs, i.assistantText),
      );
      if ((projectSnap?.get('activeGeneration.id') as string | undefined) === i.generationId) {
        tx.update(projectRef, {
          activeGeneration: null,
          updatedAt: ts(i.nowMs),
        });
      }
      return true;
    });
  }

  async saveRawArtifact(
    uid: string,
    pid: string,
    gid: string,
    text: string,
    nowMs: number,
  ): Promise<void> {
    const bytes = Buffer.from(text, 'utf8');
    const truncated = bytes.length > LIMITS.rawArtifactMaxBytes;
    const kept = truncated ? bytes.subarray(0, LIMITS.rawArtifactMaxBytes).toString('utf8') : text;
    await this.db.doc(paths.rawArtifact(uid, pid, gid)).set({
      text: kept,
      truncated,
      sizeBytes: bytes.length,
      createdAt: ts(nowMs),
    });
  }

  async get(uid: string, pid: string, gid: string): Promise<GenerationRecord | null> {
    const snap = await this.genRef(uid, pid, gid).get();
    if (!snap.exists) return null;
    const partial = snap.get('partial') as
      (PartialResult & { appliedAt: unknown; discardedAt: unknown }) | null;
    return {
      id: snap.id,
      status: snap.get('status') as string,
      prompt: snap.get('prompt') as string,
      heartbeatAtMs: (snap.get('heartbeatAt') as Timestamp).toMillis(),
      partial: partial
        ? {
            stagedPaths: partial.stagedPaths,
            applyable: partial.applyable,
            applied: partial.appliedAt != null,
            discarded: partial.discardedAt != null,
          }
        : null,
    };
  }

  async markDiscarded(uid: string, pid: string, gid: string, nowMs: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.genRef(uid, pid, gid));
      if (!snap.exists) throw new AppError('GENERATION_NOT_FOUND');
      const partial = snap.get('partial') as { appliedAt: unknown; discardedAt: unknown } | null;
      if (!partial || partial.appliedAt != null || partial.discardedAt != null)
        throw new AppError('GENERATION_NOT_APPLYABLE');
      tx.update(this.genRef(uid, pid, gid), {
        'partial.discardedAt': ts(nowMs),
        'partial.applyable': false,
      });
    });
    const staged = await this.db.collection(paths.staged(uid, pid, gid)).listDocuments();
    if (staged.length === 0) return;
    const batch = this.db.batch();
    for (const ref of staged) batch.delete(ref);
    await batch.commit();
  }
}
