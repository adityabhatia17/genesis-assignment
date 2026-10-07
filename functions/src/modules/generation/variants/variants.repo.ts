import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Issue } from '../../../contracts/firestore-docs.js';
import type { CandidateScore, VariantsRanking } from '../../../contracts/variants.js';
import { AppError } from '../../../shared/app-error.js';
import { paths } from '../../../shared/firestore-paths.js';
import { fileIdForPath, utf8Bytes } from '../../../shared/hash.js';
import { toProjectRecord, type ProjectRecord } from '../../projects/project-access.js';
import type { FileOp } from '../validation/validate-file.js';
import type { FileLanguage } from '../../../contracts/paths.js';

const ts = (ms: number) => Timestamp.fromMillis(ms);

export class VariantsRepo {
  constructor(private readonly db: Firestore) {}

  async loadProject(uid: string, pid: string): Promise<ProjectRecord> {
    const snap = await this.db.doc(paths.project(uid, pid)).get();
    if (!snap.exists || snap.get('status') !== 'active') throw new AppError('PROJECT_NOT_FOUND');
    return toProjectRecord(snap.id, snap.data());
  }

  async initCandidate(
    uid: string,
    pid: string,
    gid: string,
    candidateId: string,
    direction: { id: string; label: string },
    index: number,
    expireAtMs: number,
  ): Promise<void> {
    await this.db.doc(paths.candidate(uid, pid, gid, candidateId)).set({
      index,
      direction,
      status: 'pending',
      attempts: 0,
      startedAt: null,
      completedAt: null,
      stopReason: null,
      error: null,
      usage: null,
      fileCount: 0,
      totalBytes: 0,
      warnings: [],
      score: null,
      expireAt: ts(expireAtMs),
    });
  }

  async patchCandidate(
    uid: string,
    pid: string,
    gid: string,
    candidateId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.db.doc(paths.candidate(uid, pid, gid, candidateId)).set(patch, { merge: true });
  }

  async stageFile(
    uid: string,
    pid: string,
    gid: string,
    candidateId: string,
    op: FileOp,
    warnings: Issue[],
    nowMs: number,
    expireAtMs: number,
  ): Promise<void> {
    await this.db.doc(`${paths.candidateStaged(uid, pid, gid, candidateId)}/${fileIdForPath(op.path)}`).set({
      path: op.path,
      op: op.op,
      content: op.op === 'write' ? op.content : null,
      sizeBytes: op.op === 'write' ? op.sizeBytes : 0,
      contentHash: op.op === 'write' ? op.sha256 : null,
      language: op.op === 'write' ? op.language : null,
      issues: warnings,
      createdAt: ts(nowMs),
      expireAt: ts(expireAtMs),
    });
  }

  async listFiles(uid: string, pid: string, gid: string, candidateId: string): Promise<FileOp[]> {
    const snap = await this.db.collection(paths.candidateStaged(uid, pid, gid, candidateId)).get();
    return snap.docs.map((d): FileOp => {
      const path = d.get('path') as string;
      if (d.get('op') === 'delete') return { op: 'delete', path };
      const content = (d.get('content') as string | null) ?? '';
      return {
        op: 'write',
        path,
        content,
        sizeBytes: utf8Bytes(content),
        sha256: (d.get('contentHash') as string) ?? '',
        language: (d.get('language') as FileLanguage) ?? 'javascript',
      };
    });
  }

  /** Ranking is in. The lease is released so the owner can keep working. */
  async markAwaiting(i: {
    uid: string;
    pid: string;
    gid: string;
    nowMs: number;
    ranking: VariantsRanking;
    notice: 'only_one_option' | 'unjudged' | null;
    checklist: unknown;
    calendarCount: number;
    cost: { candidatesCents: number; checklistCents: number; judgeCents: number; totalCents: number };
  }): Promise<void> {
    const genRef = this.db.doc(paths.generation(i.uid, i.pid, i.gid));
    const projectRef = this.db.doc(paths.project(i.uid, i.pid));
    await this.db.runTransaction(async (tx) => {
      const project = await tx.get(projectRef);
      tx.update(genRef, {
        status: 'awaiting_selection',
        'variants.ranking': i.ranking,
        'variants.notice': i.notice,
        'variants.checklist': i.checklist,
        'variants.calendarCount': i.calendarCount,
        'variants.cost': i.cost,
        completedAt: null,
      });
      if ((project.get('activeGeneration.id') as string | undefined) === i.gid) {
        tx.update(projectRef, { activeGeneration: null, updatedAt: ts(i.nowMs) });
      }
    });
  }

  async failRun(uid: string, pid: string, gid: string, nowMs: number, message: string): Promise<void> {
    const genRef = this.db.doc(paths.generation(uid, pid, gid));
    const projectRef = this.db.doc(paths.project(uid, pid));
    await this.db.runTransaction(async (tx) => {
      const [gen, project] = await tx.getAll(genRef, projectRef);
      if (!gen?.exists || gen.get('status') !== 'streaming') return;
      tx.update(genRef, {
        status: 'failed',
        completedAt: ts(nowMs),
        error: { code: 'INTERNAL', message, retryable: true },
      });
      if (project && (project.get('activeGeneration.id') as string | undefined) === gid) {
        tx.update(projectRef, { activeGeneration: null, updatedAt: ts(nowMs) });
      }
    });
  }

  async discard(uid: string, pid: string, gid: string, nowMs: number): Promise<void> {
    const ref = this.db.doc(paths.generation(uid, pid, gid));
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new AppError('GENERATION_NOT_FOUND');
      const resolution = snap.get('variants.resolution') as string | null;
      if (resolution === 'discarded') return;
      if (snap.get('status') !== 'awaiting_selection') throw new AppError('GENERATION_NOT_AWAITING_SELECTION');
      tx.update(ref, {
        status: 'cancelled',
        completedAt: ts(nowMs),
        'variants.resolution': 'discarded',
      });
    });
  }

  async readSelection(uid: string, pid: string, gid: string): Promise<{
    status: string;
    prompt: string;
    baseSnapshotId: string | null;
    ranking: VariantsRanking | null;
    notice: 'only_one_option' | 'unjudged' | null;
    selectedId: string | null;
    snapshotId: string | null;
    snapshotSeq: number | null;
    error: { code: string; message: string; retryable: boolean } | null;
    resolution: 'selected' | 'discarded' | null;
  }> {
    const snap = await this.db.doc(paths.generation(uid, pid, gid)).get();
    if (!snap.exists) throw new AppError('GENERATION_NOT_FOUND');
    const result = snap.get('result') as { snapshotId?: string; snapshotSeq?: number } | null;
    return {
      status: snap.get('status') as string,
      prompt: (snap.get('prompt') as string) ?? '',
      baseSnapshotId: (snap.get('variants.baseSnapshotId') as string | null) ?? null,
      ranking: (snap.get('variants.ranking') as VariantsRanking | null) ?? null,
      notice: (snap.get('variants.notice') as 'only_one_option' | 'unjudged' | null) ?? null,
      selectedId: (snap.get('variants.selection.candidateId') as string | null) ?? null,
      snapshotId: result?.snapshotId ?? null,
      snapshotSeq: result?.snapshotSeq ?? null,
      error: (snap.get('error') as { code: string; message: string; retryable: boolean } | null) ?? null,
      resolution: (snap.get('variants.resolution') as 'selected' | 'discarded' | null) ?? null,
    };
  }
}

export type { CandidateScore };
