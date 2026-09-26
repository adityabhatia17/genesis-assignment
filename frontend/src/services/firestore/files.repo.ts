import { query, type Query } from 'firebase/firestore';
import { refs } from './paths';
import type { ProjectFile } from './types';

/** The whole working tree (≤ 25 files, ≤ 300 KB) — small enough to listen to in full. */
export const filesQuery = (uid: string, projectId: string): Query<ProjectFile> =>
  query(refs.files(uid, projectId));
