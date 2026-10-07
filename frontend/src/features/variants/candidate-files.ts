import type { PreviewFile } from '@/features/workspace/preview/compile-preview';

export interface CandidateOp {
  path: string;
  op: 'write' | 'delete';
  content: string;
}

/**
 * Applies a candidate's staged ops onto the project's current files.
 * This is what selection will commit, so the preview matches the saved project.
 */
export function overlayOps(
  base: readonly PreviewFile[],
  ops: readonly CandidateOp[],
): PreviewFile[] {
  const byPath = new Map(base.map((file) => [file.path, file.content]));
  for (const op of ops) {
    if (op.op === 'delete') byPath.delete(op.path);
    else byPath.set(op.path, op.content);
  }
  return [...byPath.entries()]
    .map(([path, content]) => ({ path, content }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
