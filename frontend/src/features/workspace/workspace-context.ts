import { inject, provide, type InjectionKey, type Ref, type ShallowRef } from 'vue';
import type { Project, ProjectFile } from '@/services/firestore/types';

/** Per-project context provided by WorkspacePage to every panel. Editor models arrive with the code editor. */
export interface WorkspaceContext {
  readonly uid: string;
  readonly projectId: string;
  readonly project: ShallowRef<Project | null>;
  readonly files: ShallowRef<ProjectFile[]>;
  readonly filesLoading: Ref<boolean>;
}

const WorkspaceKey: InjectionKey<WorkspaceContext> = Symbol('workspace');

export function provideWorkspace(context: WorkspaceContext): void {
  provide(WorkspaceKey, context);
}

export function useWorkspace(): WorkspaceContext {
  const context = inject(WorkspaceKey);
  if (!context) throw new Error('useWorkspace() must be used inside WorkspacePage');
  return context;
}
