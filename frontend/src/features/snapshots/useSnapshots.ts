import type { Ref } from 'vue';
import { useFirestoreQuery, type FirestoreQueryState } from '@/composables/useFirestoreQuery';
import { snapshotsQuery } from '@/services/firestore/snapshots.repo';
import type { Snapshot } from '@/services/firestore/types';

/** Listens only while `enabled` (the sheet is open) to keep reads low. */
export function useSnapshots(
  uid: string,
  projectId: string,
  enabled: Ref<boolean>,
): FirestoreQueryState<Snapshot> {
  return useFirestoreQuery(() => (enabled.value ? snapshotsQuery(uid, projectId) : null));
}
