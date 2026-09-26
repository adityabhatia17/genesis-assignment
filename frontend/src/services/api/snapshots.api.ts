import type { RestoreResult } from '@/contracts/api';
import { apiFetch } from '@/lib/http';

export function restoreSnapshot(projectId: string, snapshotId: string): Promise<RestoreResult> {
  return apiFetch(
    'api',
    `/v1/projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
    { method: 'POST', body: {} },
  );
}
