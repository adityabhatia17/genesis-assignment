import type { MessageMeta } from '@/contracts/firestore-docs';

export interface MetaLine {
  text: string;
  tone: 'muted' | 'warning' | 'error';
}

export function formatPaths(paths: readonly string[], max = 3): string {
  const shown = paths.slice(0, max).join(', ');
  return paths.length > max ? `${shown} +${paths.length - max} more` : shown;
}

/** The small line under an assistant/system message: "Changed app.js, styles.css · History #4". */
export function describeMessageMeta(
  role: 'user' | 'assistant' | 'system',
  meta: MessageMeta | null,
): MetaLine | null {
  if (!meta || role === 'user') return null;
  if (meta.status === 'failed') return { text: 'Generation failed', tone: 'error' };
  if (meta.status === 'interrupted') return { text: 'Interrupted', tone: 'warning' };

  const parts: string[] = [];
  const changed = meta.changedPaths ?? [];
  const deleted = meta.deletedPaths ?? [];
  if (changed.length > 0) parts.push(`Changed ${formatPaths(changed)}`);
  if (deleted.length > 0) parts.push(`Deleted ${formatPaths(deleted)}`);
  if (changed.length === 0 && deleted.length === 0 && meta.status === 'completed')
    parts.push('No file changes');
  if (typeof meta.snapshotSeq === 'number') parts.push(`History #${meta.snapshotSeq}`);
  const rejected = meta.rejectedPaths?.length ?? 0;
  if (rejected > 0) parts.push(`${rejected} file${rejected === 1 ? '' : 's'} rejected`);
  return parts.length > 0
    ? { text: parts.join(' · '), tone: rejected > 0 ? 'warning' : 'muted' }
    : null;
}
