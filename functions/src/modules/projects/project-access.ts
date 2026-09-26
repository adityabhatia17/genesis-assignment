import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { LIMITS } from '../../contracts/limits.js';
import { AppError } from '../../shared/app-error.js';
import { paths } from '../../shared/firestore-paths.js';

const Ts = z.custom<Timestamp>((v) => v instanceof Timestamp);
const ProjectSchema = z
  .object({
    name: z.string(),
    status: z.enum(['active', 'deleted']),
    locationId: z.string().nullable().optional(),
    activeGeneration: z
      .object({ id: z.string(), startedAt: Ts, heartbeatAt: Ts })
      .nullable()
      .optional(),
    workingTreeDirty: z.boolean().optional(),
    latestSnapshotId: z.string().nullable().optional(),
    snapshotSeq: z.number().int().optional(),
    fileCount: z.number().int().optional(),
    totalBytes: z.number().int().optional(),
  })
  .passthrough();

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly status: 'active' | 'deleted';
  readonly locationId: string | null;
  readonly activeGeneration: { id: string; heartbeatAtMs: number } | null;
  readonly workingTreeDirty: boolean;
  readonly latestSnapshotId: string | null;
  readonly snapshotSeq: number;
  readonly fileCount: number;
  readonly totalBytes: number;
}

export function toProjectRecord(id: string, data: unknown): ProjectRecord {
  const d = ProjectSchema.parse(data);
  return {
    id,
    name: d.name,
    status: d.status,
    locationId: d.locationId ?? null,
    activeGeneration: d.activeGeneration
      ? { id: d.activeGeneration.id, heartbeatAtMs: d.activeGeneration.heartbeatAt.toMillis() }
      : null,
    workingTreeDirty: d.workingTreeDirty ?? false,
    latestSnapshotId: d.latestSnapshotId ?? null,
    snapshotSeq: d.snapshotSeq ?? 0,
    fileCount: d.fileCount ?? 0,
    totalBytes: d.totalBytes ?? 0,
  };
}

export const isLeaseStale = (active: { heartbeatAtMs: number } | null, nowMs: number): boolean =>
  active !== null && nowMs - active.heartbeatAtMs > LIMITS.staleLeaseMs;

export interface ProjectAccessPort {
  getOwnedActive(uid: string, projectId: string): Promise<ProjectRecord>;
  bindLocation(uid: string, projectId: string, locationId: string): Promise<void>;
}

export class FirestoreProjectAccess implements ProjectAccessPort {
  constructor(private readonly db: Firestore) {}

  async getOwnedActive(uid: string, projectId: string): Promise<ProjectRecord> {
    const snap = await this.db.doc(paths.project(uid, projectId)).get();
    if (!snap.exists) throw new AppError('PROJECT_NOT_FOUND');
    const p = toProjectRecord(snap.id, snap.data());
    if (p.status !== 'active') throw new AppError('PROJECT_NOT_FOUND');
    return p;
  }

  async bindLocation(uid: string, projectId: string, locationId: string): Promise<void> {
    const ref = this.db.doc(paths.project(uid, projectId));
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && (snap.get('locationId') ?? null) === null) tx.update(ref, { locationId });
    });
  }
}
