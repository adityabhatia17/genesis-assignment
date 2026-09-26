import type { Firestore } from 'firebase-admin/firestore';
import type { RestoreResult } from '../../contracts/api.js';
import type { SnapshotFileEntry } from '../../contracts/firestore-docs.js';
import { AppError } from '../../shared/app-error.js';
import type { Clock } from '../../shared/clock.js';
import { paths } from '../../shared/firestore-paths.js';
import type { CommitService } from '../generation/persistence/commit.service.js';
import type { FileOp } from '../generation/validation/validate-file.js';
import type { BlobsRepo } from './blobs.repo.js';

export class RestoreService {
  constructor(
    private readonly db: Firestore,
    private readonly blobs: BlobsRepo,
    private readonly commits: CommitService,
    private readonly clock: Clock,
  ) {}

  async restore(uid: string, projectId: string, snapshotId: string): Promise<RestoreResult> {
    const snap = await this.db.doc(paths.snapshot(uid, projectId, snapshotId)).get();
    if (!snap.exists) throw new AppError('SNAPSHOT_NOT_FOUND');
    const seq = snap.get('seq') as number;
    const manifest = Object.values(snap.get('files') as Record<string, SnapshotFileEntry>);
    const contents = await this.blobs.readMany(
      uid,
      projectId,
      manifest.map((e) => e.blobId),
    );

    const ops: FileOp[] = manifest.map((e) => ({
      op: 'write',
      path: e.path,
      content: contents.get(e.blobId) ?? '',
      sizeBytes: e.sizeBytes,
      sha256: e.blobId,
      language: e.language,
    }));

    const result = await this.commits.applyTreeChange({
      uid,
      projectId,
      nowMs: this.clock.now(),
      ops,
      replaceTree: true,
      source: 'restore',
      validateNextTree: false,
      snapshot: {
        kind: 'restore',
        label: `Restored #${seq}`,
        generationId: null,
        restoredFromSnapshotId: snapshotId,
      },
      lease: { mode: 'must-be-free' },
      precondition: (p) => {
        if (p.latestSnapshotId === snapshotId && !p.workingTreeDirty)
          throw new AppError('SNAPSHOT_ALREADY_CURRENT');
      },
      messages: [
        {
          role: 'system',
          content: `Restored history #${seq}.`,
          generationId: null,
          meta: null,
        },
      ],
    });
    return {
      snapshotId: result.snapshotId,
      snapshotSeq: result.snapshotSeq,
      restoredFromSnapshotId: snapshotId,
      checkpointSnapshotId: result.checkpointSnapshotId,
    };
  }
}
