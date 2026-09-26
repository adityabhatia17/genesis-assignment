import {
  addDoc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Query,
} from 'firebase/firestore';
import { refs } from './paths';
import type { Project } from './types';

export interface ProjectInput {
  name: string;
  description: string;
}

/** Dashboard query; backed by the `status ASC, updatedAt DESC` composite index. */
export const activeProjectsQuery = (uid: string): Query<Project> =>
  query(
    refs.projects(uid),
    where('status', '==', 'active'),
    orderBy('updatedAt', 'desc'),
    limit(50),
  );

/** Exactly the fields the rules accept on create (BE-2.1 validProjectCreate). */
export async function createProject(
  uid: string,
  input: ProjectInput,
  locationId: string | null,
): Promise<string> {
  const ref = await addDoc(refs.projectsRaw(uid), {
    name: input.name,
    description: input.description,
    locationId,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    deletedAt: null,
  });
  return ref.id;
}

export async function updateProject(
  uid: string,
  projectId: string,
  input: ProjectInput,
): Promise<void> {
  await updateDoc(refs.projectRaw(uid, projectId), {
    name: input.name,
    description: input.description,
    updatedAt: serverTimestamp(),
  });
}

export async function softDeleteProject(uid: string, projectId: string): Promise<void> {
  await updateDoc(refs.projectRaw(uid, projectId), {
    status: 'deleted',
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
