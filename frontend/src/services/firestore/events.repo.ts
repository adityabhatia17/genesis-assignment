import { orderBy, query, Timestamp, where, type Query } from 'firebase/firestore';
import { refs } from './paths';
import type { UserEvent } from './types';

/** Webhook events created after this workspace session opened. */
export const recentEventsQuery = (uid: string, sinceMs: number): Query<UserEvent> =>
  query(
    refs.events(uid),
    where('createdAt', '>', Timestamp.fromMillis(sinceMs)),
    orderBy('createdAt', 'asc'),
  );
