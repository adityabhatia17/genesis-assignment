import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { FileSaveResult } from '../../contracts/api.js';
import type { SnapshotFileEntry } from '../../contracts/firestore-docs.js';
import type { FileLanguage } from '../../contracts/paths.js';
import { LIMITS } from '../../contracts/limits.js';
import { AppError } from '../../shared/app-error.js';
import type { Clock } from '../../shared/clock.js';
import { paths } from '../../shared/firestore-paths.js';
import { sha256Hex, utf8Bytes } from '../../shared/hash.js';
import type { TreeFile } from '../generation/validation/validate-project.js';
import { isLeaseStale, toProjectRecord } from '../projects/project-access.js';
import {
  diffManifests,
  manifestOf,
  snapshotLabel,
  treeBytes,
} from '../snapshots/snapshot-builder.js';

export class FileSaveService {
  constructor(
    private readonly db: Firestore,
    private readonly clock: Clock,
  ) {}

  save(
    uid: string,
    projectId: string,
    fileId: string,
    content: string,
    expectedVersion: number,
  ): Promise<FileSaveResult> {
    const projectRef = this.db.doc(paths.project(uid, projectId));
    const fileRef = this.db.doc(paths.file(uid, projectId, fileId));
    return this.db.runTransaction(async (tx) => {
      const [projectSnap, fileSnap] = await tx.getAll(projectRef, fileRef);
      if (!projectSnap?.exists || projectSnap.get('status') !== 'active')
        throw new AppError('PROJECT_NOT_FOUND');
      const project = toProjectRecord(projectSnap.id, projectSnap.data());
      const nowMs = this.clock.now();
      if (project.activeGeneration && !isLeaseStale(project.activeGeneration, nowMs)) {
        throw new AppError('GENERATION_IN_PROGRESS', undefined, {
          activeGenerationId: project.activeGeneration.id,
        });
      }
      if (!fileSnap?.exists) throw new AppError('FILE_NOT_FOUND');
      const version = fileSnap.get('version') as number;
      if (version !== expectedVersion)
        throw new AppError('FILE_VERSION_CONFLICT', undefined, { currentVersion: version });

      const path = fileSnap.get('path') as string;
      const oldBytes = fileSnap.get('sizeBytes') as number;
      const sizeBytes = utf8Bytes(content);
      if (sizeBytes > LIMITS.maxFileBytes)
        throw new AppError(
          'VALIDATION_FAILED',
          `Files are limited to ${LIMITS.maxFileBytes} bytes.`,
        );
      if (content.includes('\u0000'))
        throw new AppError('VALIDATION_FAILED', 'File contains a NUL character.');
      const totalBytes = project.totalBytes - oldBytes + sizeBytes;
      if (totalBytes > LIMITS.maxProjectBytes)
        throw new AppError(
          'VALIDATION_FAILED',
          `Projects are limited to ${LIMITS.maxProjectBytes} bytes.`,
        );

      const contentHash = sha256Hex(content);
      if (contentHash === fileSnap.get('contentHash'))
        return { fileId, path, version, sizeBytes: oldBytes, contentHash };

      const filesSnap = await tx.get(this.db.collection(paths.files(uid, projectId)));
      const parentId = project.latestSnapshotId;
      const parentSnap = parentId
        ? await tx.get(this.db.doc(paths.snapshot(uid, projectId, parentId)))
        : null;
      const blobRef = this.db.doc(paths.blob(uid, projectId, contentHash));
      const blobSnap = await tx.get(blobRef);

      const tree = new Map<string, TreeFile>();
      for (const doc of filesSnap.docs) {
        const saved = doc.id === fileId;
        const filePath = (saved ? path : doc.get('path')) as string;
        const fileContent = saved ? content : (doc.get('content') as string);
        tree.set(filePath, {
          path: filePath,
          content: fileContent,
          sizeBytes: saved ? sizeBytes : (doc.get('sizeBytes') as number),
          sha256: saved ? contentHash : (doc.get('contentHash') as string),
          language: doc.get('language') as FileLanguage,
        });
      }

      const now = Timestamp.fromMillis(nowMs);
      tx.update(fileRef, {
        content,
        sizeBytes,
        contentHash,
        version: version + 1,
        source: 'manual',
        updatedAt: now,
      });
      if (!blobSnap.exists) {
        tx.create(blobRef, { content, sizeBytes, createdAt: now });
      }
      const manifest = manifestOf(tree);
      const seq = project.snapshotSeq + 1;
      const snapRef = this.db.collection(paths.snapshots(uid, projectId)).doc();
      const parentFiles = parentSnap?.exists
        ? (parentSnap.get('files') as Record<string, SnapshotFileEntry>)
        : null;
      tx.create(snapRef, {
        seq,
        kind: 'checkpoint',
        label: snapshotLabel('checkpoint', `Saved ${path}`),
        generationId: null,
        restoredFromSnapshotId: null,
        parentSnapshotId: parentId,
        files: manifest,
        fileCount: tree.size,
        totalBytes: treeBytes(tree),
        ...diffManifests(parentFiles, manifest),
        createdAt: now,
      });
      tx.update(projectRef, {
        workingTreeDirty: false,
        latestSnapshotId: snapRef.id,
        snapshotSeq: seq,
        totalBytes,
        updatedAt: now,
      });
      return { fileId, path, version: version + 1, sizeBytes, contentHash };
    });
  }
}
