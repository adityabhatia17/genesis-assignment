import { useFirestoreQuery, type FirestoreQueryState } from '@/composables/useFirestoreQuery';
import { messagesQuery } from '@/services/firestore/messages.repo';
import type { ChatMessage } from '@/services/firestore/types';

export function useProjectMessages(
  uid: string,
  projectId: string,
): FirestoreQueryState<ChatMessage> {
  return useFirestoreQuery(() => messagesQuery(uid, projectId));
}
