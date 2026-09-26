import { useFirestoreQuery, type FirestoreQueryState } from '@/composables/useFirestoreQuery';
import { filesQuery } from '@/services/firestore/files.repo';
import type { ProjectFile } from '@/services/firestore/types';

export function useProjectFiles(uid: string, projectId: string): FirestoreQueryState<ProjectFile> {
  return useFirestoreQuery(() => filesQuery(uid, projectId));
}
