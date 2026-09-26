import type { ShallowRef, Ref } from 'vue';
import type { FirestoreError } from 'firebase/firestore';
import { useAuth } from '@/composables/useAuth';
import { useFirestoreQuery } from '@/composables/useFirestoreQuery';
import {
  activeProjectsQuery,
  createProject,
  softDeleteProject,
  updateProject,
  type ProjectInput,
} from '@/services/firestore/projects.repo';
import type { Project } from '@/services/firestore/types';
import { useHighLevelConnection } from '@/features/highlevel/useHighLevelConnection';

export interface ProjectsApi {
  projects: ShallowRef<Project[]>;
  loading: Ref<boolean>;
  error: ShallowRef<FirestoreError | null>;
  retry: () => void;
  create: (input: ProjectInput) => Promise<string>;
  rename: (projectId: string, input: ProjectInput) => Promise<void>;
  remove: (projectId: string) => Promise<void>;
}

export function useProjects(): ProjectsApi {
  const { uid } = useAuth();
  const { locationId } = useHighLevelConnection();
  const { data, loading, error, retry } = useFirestoreQuery(() =>
    uid.value ? activeProjectsQuery(uid.value) : null,
  );

  function requireUid(): string {
    if (!uid.value) throw new Error('Not signed in');
    return uid.value;
  }

  return {
    projects: data,
    loading,
    error,
    retry,
    // New projects bind to the connected location (or none); the rules enforce the same.
    create: (input) => createProject(requireUid(), input, locationId.value),
    rename: (projectId, input) => updateProject(requireUid(), projectId, input),
    remove: (projectId) => softDeleteProject(requireUid(), projectId),
  };
}
