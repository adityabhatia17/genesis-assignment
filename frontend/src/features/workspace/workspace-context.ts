import { inject, onScopeDispose, provide, type InjectionKey, type Ref, type ShallowRef } from 'vue';
import type { Project, ProjectFile } from '@/services/firestore/types';
import type { EditorModels } from './editor/editor-models';

/** Per-project context provided by WorkspacePage to every panel. */
export interface WorkspaceContext {
  readonly uid: string;
  readonly projectId: string;
  readonly project: ShallowRef<Project | null>;
  readonly files: ShallowRef<ProjectFile[]>;
  readonly filesLoading: Ref<boolean>;
  readonly models: EditorModels;
}

const WorkspaceKey: InjectionKey<WorkspaceContext> = Symbol('workspace');
let current: WorkspaceContext | null = null;

export function provideWorkspace(context: WorkspaceContext): void {
  current = context;
  provide(WorkspaceKey, context);
  onScopeDispose(() => {
    if (current === context) current = null;
  });
}

export function useWorkspace(): WorkspaceContext {
  const context = inject(WorkspaceKey, null) ?? current;
  if (!context) throw new Error('useWorkspace() must be used inside WorkspacePage');
  return context;
}
