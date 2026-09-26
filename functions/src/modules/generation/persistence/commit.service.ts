import {
  Timestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import type { MessageMeta, SnapshotFileEntry } from '../../../contracts/firestore-docs.js';
import type { FileLanguage } from '../../../contracts/paths.js';
import { AppError } from '../../../shared/app-error.js';
import { paths } from '../../../shared/firestore-paths.js';
import { fileIdForPath } from '../../../shared/hash.js';
import {
  isLeaseStale,
  toProjectRecord,
  type ProjectRecord,
} from '../../projects/project-access.js';
import type { BlobsRepo } from '../../snapshots/blobs.repo.js';
import {
  diffManifests,
  manifestOf,
  snapshotLabel,
  treeBytes,
} from '../../snapshots/snapshot-builder.js';
import type { FileOp } from '../validation/validate-file.js';
import { applyOps, validateProject, type TreeFile } from '../validation/validate-project.js';
import { interruptedPatch } from './generations.repo.js';

export interface MessageDraft {
  role: 'assistant' | 'system';
  content: string;
  generationId: string | null;
  meta: MessageMeta | null;
}

export interface CommitResult {
  snapshotId: string;
  snapshotSeq: number;
  checkpointSnapshotId: string | null;
  changedPaths: string[];
  deletedPaths: string[];
  noChanges: boolean;
}

export interface TreeChangeInput {
  uid: string;
  projectId: string;
  nowMs: number;
  ops: readonly FileOp[];
  source: 'ai' | 'restore';
  snapshot: {
    kind: 'generation' | 'restore';
    label: string;
    generationId: string | null;
    restoredFromSnapshotId: string | null;
  };
  lease: { mode: 'must-hold'; generationId: string } | { mode: 'must-be-free' };
  validateNextTree: boolean;
  /** Restore: delete every current file that `ops` does not write. */
  replaceTree?: boolean;
  precondition?: (p: ProjectRecord) => void;
  messages: readonly MessageDraft[];
  generationPatch?: {
    generationId: string;
    build(result: CommitResult): Record<string, unknown>;
  };
}

interface WorkingFile extends TreeFile {
  fileId: string;
  version: number;
}

export class CommitService {
  constructor(
    private readonly db: Firestore,
    private readonly blobs: BlobsRepo,
  ) {}

  applyTreeChange(i: TreeChangeInput): Promise<CommitResult> {
    return this.db.runTransaction((tx) => this.run(tx, i));
  }

  private async run(tx: Transaction, i: TreeChangeInput): Promise<CommitResult> {
    const now = Timestamp.fromMillis(i.nowMs);
    const projectRef = this.db.doc(paths.project(i.uid, i.projectId));

    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists || projectSnap.get('status') !== 'active')
      throw new AppError('PROJECT_NOT_FOUND');
    const project = toProjectRecord(projectSnap.id, projectSnap.data());
    i.precondition?.(project);

    let staleTakeover: { id: string; stagedPaths: string[] } | null = null;
    if (i.lease.mode === 'must-hold') {
      if (project.activeGeneration?.id !== i.lease.generationId)
        throw new AppError('GENERATION_INTERRUPTED', 'The generation lost its project lease.');
    } else if (project.activeGeneration) {
      if (!isLeaseStale(project.activeGeneration, i.nowMs)) {
        throw new AppError('GENERATION_IN_PROGRESS', undefined, {
          activeGenerationId: project.activeGeneration.id,
        });
      }
      const staged = await tx.get(
        this.db.collection(paths.staged(i.uid, i.projectId, project.activeGeneration.id)),
      );
      staleTakeover = {
        id: project.activeGeneration.id,
        stagedPaths: staged.docs.map((d) => d.get('path') as string),
      };
    }

    const filesSnap = await tx.get(this.db.collection(paths.files(i.uid, i.projectId)));
    const current = new Map<string, WorkingFile>();
    for (const d of filesSnap.docs) {
      current.set(d.get('path') as string, {
        fileId: d.id,
        path: d.get('path') as string,
        content: d.get('content') as string,
        sizeBytes: d.get('sizeBytes') as number,
        sha256: d.get('contentHash') as string,
        language: d.get('language') as FileLanguage,
        version: d.get('version') as number,
      });
    }
    const latestSnap = project.latestSnapshotId
      ? await tx.get(this.db.doc(paths.snapshot(i.uid, i.projectId, project.latestSnapshotId)))
      : null;
    const latestManifest =
      (latestSnap?.exists
        ? (latestSnap.get('files') as Record<string, SnapshotFileEntry>)
        : null) ?? null;

    const effectiveOps: FileOp[] = [...i.ops];
    if (i.replaceTree) {
      const written = new Set(i.ops.filter((o) => o.op === 'write').map((o) => o.path));
      for (const path of current.keys())
        if (!written.has(path)) effectiveOps.push({ op: 'delete', path });
    }
    const next = applyOps(current, effectiveOps);
    if (i.validateNextTree) {
      const issues = validateProject(next).filter((x) => x.severity === 'error');
      if (issues.length > 0) throw new AppError('GENERATION_INVALID_OUTPUT', undefined, { issues });
    }

    const checkpoint = project.workingTreeDirty && current.size > 0;
    const neededHashes = new Map<string, string>();
    if (checkpoint) for (const f of current.values()) neededHashes.set(f.sha256, f.content);
    for (const f of next.values()) neededHashes.set(f.sha256, f.content);
    const blobRefs: DocumentReference[] = [...neededHashes.keys()].map((sha) =>
      this.blobs.ref(i.uid, i.projectId, sha),
    );
    const blobSnaps = blobRefs.length
      ? await tx.getAll(...blobRefs, { fieldMask: ['sizeBytes'] })
      : [];

    blobSnaps.forEach((snap, idx) => {
      if (snap.exists) return;
      const sha = blobRefs[idx]!.id;
      const content = neededHashes.get(sha) ?? '';
      tx.create(blobRefs[idx]!, {
        content,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        createdAt: now,
      });
    });

    if (staleTakeover) {
      tx.set(
        this.db.doc(paths.generation(i.uid, i.projectId, staleTakeover.id)),
        interruptedPatch(staleTakeover.stagedPaths, i.nowMs),
        { merge: true },
      );
    }

    const snapshots = this.db.collection(paths.snapshots(i.uid, i.projectId));
    let seq = project.snapshotSeq;
    let parentId = project.latestSnapshotId;
    let parentManifest = latestManifest;
    let checkpointSnapshotId: string | null = null;

    if (checkpoint) {
      seq += 1;
      const cpRef = snapshots.doc();
      const manifest = manifestOf(current);
      tx.create(cpRef, {
        seq,
        kind: 'checkpoint',
        label: snapshotLabel(
          'checkpoint',
          i.snapshot.kind === 'restore'
            ? 'manual edits before restore'
            : 'manual edits before AI changes',
        ),
        generationId: null,
        restoredFromSnapshotId: null,
        parentSnapshotId: parentId,
        files: manifest,
        fileCount: current.size,
        totalBytes: treeBytes(current),
        ...diffManifests(parentManifest, manifest),
        createdAt: now,
      });
      checkpointSnapshotId = cpRef.id;
      parentId = cpRef.id;
      parentManifest = manifest;
    }

    let changedFiles = 0;
    for (const op of effectiveOps) {
      const ref = this.db.doc(paths.file(i.uid, i.projectId, fileIdForPath(op.path)));
      const existing = current.get(op.path);
      if (op.op === 'delete') {
        if (existing) {
          tx.delete(ref);
          changedFiles += 1;
        }
        continue;
      }
      if (existing?.sha256 === op.sha256) continue;
      tx.set(ref, {
        path: op.path,
        language: op.language,
        content: op.content,
        sizeBytes: op.sizeBytes,
        contentHash: op.sha256,
        version: (existing?.version ?? 0) + 1,
        source: i.source,
        updatedAt: now,
        lastGenerationId: i.snapshot.generationId,
      });
      changedFiles += 1;
    }

    seq += 1;
    const snapRef = snapshots.doc();
    const manifest = manifestOf(next);
    const diff = diffManifests(parentManifest, manifest);
    tx.create(snapRef, {
      seq,
      kind: i.snapshot.kind,
      label: snapshotLabel(i.snapshot.kind, i.snapshot.label),
      generationId: i.snapshot.generationId,
      restoredFromSnapshotId: i.snapshot.restoredFromSnapshotId,
      parentSnapshotId: parentId,
      files: manifest,
      fileCount: next.size,
      totalBytes: treeBytes(next),
      ...diff,
      createdAt: now,
    });

    const result: CommitResult = {
      snapshotId: snapRef.id,
      snapshotSeq: seq,
      checkpointSnapshotId,
      changedPaths: diff.changedPaths,
      deletedPaths: diff.deletedPaths,
      noChanges: changedFiles === 0,
    };

    const messages = this.db.collection(paths.messages(i.uid, i.projectId));
    for (const m of i.messages) {
      tx.create(messages.doc(), {
        role: m.role,
        content: m.content,
        generationId: m.generationId,
        createdAt: now,
        meta: {
          ...(m.meta ?? {}),
          snapshotId: result.snapshotId,
          snapshotSeq: result.snapshotSeq,
          changedPaths: result.changedPaths,
          deletedPaths: result.deletedPaths,
        },
      });
    }
    if (i.generationPatch) {
      tx.update(
        this.db.doc(paths.generation(i.uid, i.projectId, i.generationPatch.generationId)),
        i.generationPatch.build(result),
      );
    }
    tx.update(projectRef, {
      latestSnapshotId: snapRef.id,
      snapshotSeq: seq,
      fileCount: next.size,
      totalBytes: treeBytes(next),
      workingTreeDirty: false,
      updatedAt: now,
      ...(i.snapshot.kind === 'generation' ? { lastGenerationAt: now } : {}),
      ...(i.lease.mode === 'must-hold' || staleTakeover ? { activeGeneration: null } : {}),
    });
    return result;
  }
}
