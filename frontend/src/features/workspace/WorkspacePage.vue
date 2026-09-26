<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import PageState from '@/components/common/PageState.vue';
import { useAuth } from '@/composables/useAuth';
import { useFirestoreDoc } from '@/composables/useFirestoreDoc';
import { toUserMessage } from '@/lib/errors';
import { refs } from '@/services/firestore/paths';
import { useGeneration } from './composables/useGeneration';
import { useProjectFiles } from './composables/useProjectFiles';
import { useRemoteFileSync } from './composables/useRemoteFileSync';
import { useStreamingEditor } from './composables/useStreamingEditor';
import { EditorModels } from './editor/editor-models';
import { setupMonaco } from './editor/monaco-setup';
import { useWorkspaceStore } from './stores/workspace.store';
import { provideWorkspace } from './workspace-context';
import WorkspaceHeader from './WorkspaceHeader.vue';
import WorkspaceLayout from './WorkspaceLayout.vue';

const props = defineProps<{ projectId: string }>();
const { uid: authUid } = useAuth();
const uid = authUid.value ?? '';

const workspace = useWorkspaceStore();
workspace.reset(props.projectId);

const project = useFirestoreDoc(() => refs.project(uid, props.projectId));
const files = useProjectFiles(uid, props.projectId);
const models = new EditorModels(setupMonaco(), props.projectId, {
  onDirtyChange: (path, dirty) => workspace.setDirty(path, dirty),
});

provideWorkspace({
  uid,
  projectId: props.projectId,
  project: project.data,
  files: files.data,
  filesLoading: files.loading,
  models,
});

useGeneration();
useStreamingEditor();
useRemoteFileSync();

onBeforeUnmount(() => models.disposeAll());
</script>

<template>
  <PageState v-if="project.loading.value" kind="loading" title="Opening project" class="h-dvh" />
  <PageState
    v-else-if="project.error.value"
    kind="error"
    class="h-dvh"
    title="Couldn't open this project"
    :description="toUserMessage(project.error.value)"
    action-label="Back to projects"
    :action-to="{ name: 'dashboard' }"
  />
  <PageState
    v-else-if="!project.data.value || project.data.value.status === 'deleted'"
    kind="empty"
    class="h-dvh"
    title="Project not found"
    description="It may have been deleted."
    action-label="Back to projects"
    :action-to="{ name: 'dashboard' }"
  />
  <div v-else class="flex h-dvh flex-col bg-background">
    <WorkspaceHeader />
    <WorkspaceLayout />
  </div>
</template>
