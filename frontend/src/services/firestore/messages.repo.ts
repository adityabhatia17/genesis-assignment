import { limitToLast, orderBy, query, type Query } from 'firebase/firestore';
import { refs } from './paths';
import type { ChatMessage } from './types';

export const MESSAGE_WINDOW = 200;

export const messagesQuery = (uid: string, projectId: string): Query<ChatMessage> =>
  query(refs.messages(uid, projectId), orderBy('createdAt', 'asc'), limitToLast(MESSAGE_WINDOW));
