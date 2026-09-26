import type { SnapshotFileEntry, SnapshotKind } from '../../contracts/firestore-docs.js';
import { fileIdForPath } from '../../shared/hash.js';
import type { Tree } from '../generation/validation/validate-project.js';

export function manifestOf(tree: Tree): Record<string, SnapshotFileEntry> {
  const out: Record<string, SnapshotFileEntry> = {};
  for (const f of tree.values())
    out[fileIdForPath(f.path)] = {
      path: f.path,
      blobId: f.sha256,
      sizeBytes: f.sizeBytes,
      language: f.language,
    };
  return out;
}

export function diffManifests(
  parent: Record<string, SnapshotFileEntry> | null,
  next: Record<string, SnapshotFileEntry>,
): { changedPaths: string[]; deletedPaths: string[] } {
  const before = new Map(Object.values(parent ?? {}).map((e) => [e.path, e.blobId]));
  const after = new Map(Object.values(next).map((e) => [e.path, e.blobId]));
  const changedPaths = [...after]
    .filter(([p, blob]) => before.get(p) !== blob)
    .map(([p]) => p)
    .sort();
  const deletedPaths = [...before.keys()].filter((p) => !after.has(p)).sort();
  return { changedPaths, deletedPaths };
}

export const treeBytes = (tree: Tree): number =>
  [...tree.values()].reduce((s, f) => s + f.sizeBytes, 0);

export function snapshotLabel(kind: SnapshotKind, text: string): string {
  const base = kind === 'generation' ? text : kind === 'restore' ? text : `Checkpoint: ${text}`;
  return base.length > 120 ? `${base.slice(0, 117)}…` : base;
}
