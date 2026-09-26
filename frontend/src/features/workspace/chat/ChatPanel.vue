<script setup lang="ts">
import { useOnline } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import PageState from '@/components/common/PageState.vue';
import { useHighLevelConnection } from '@/features/highlevel/useHighLevelConnection';
import { toUserMessage } from '@/lib/errors';
import { useProjectMessages } from '../composables/useProjectMessages';
import { isActive } from '../stores/generation.reducer';
import { useGenerationStore } from '../stores/generation.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useWorkspace } from '../workspace-context';
import ExamplePrompts from './ExamplePrompts.vue';
import GenerationOutcomeBanner from './GenerationOutcomeBanner.vue';
import LiveAssistantMessage from './LiveAssistantMessage.vue';
import MessageList from './MessageList.vue';
import PromptComposer from './PromptComposer.vue';

const ws = useWorkspace();
const generation = useGenerationStore();
const workspace = useWorkspaceStore();
const { state } = storeToRefs(generation);
const { status: hlStatus } = useHighLevelConnection();
const online = useOnline();
const { data: messages, loading, error, retry } = useProjectMessages(ws.uid, ws.projectId);
const draft = ref('');

const persisted = computed(() =>
  messages.value.some((m) => m.role === 'assistant' && m.generationId === state.value.generationId),
);
const showLive = computed(() => state.value.status !== 'idle' && !persisted.value);
const busy = computed(() => isActive(state.value.status));
const liveKey = computed(
  () => `${state.value.prose.length}:${state.value.fileOrder.length}:${state.value.status}`,
);
const empty = computed(
  () => !loading.value && messages.value.length === 0 && ws.files.value.length === 0,
);

const blockedReason = computed(() => {
  if (!online.value) return "You're offline.";
  if (workspace.dirtyPaths.length > 0) return 'Save or discard unsaved changes first.';
  return null;
});

function openFile(path: string): void {
  workspace.openFile(path);
  workspace.mobileTab = 'code';
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" aria-label="Chat">
    <PageState
      v-if="error && messages.length === 0"
      kind="error"
      title="Couldn't load the conversation"
      :description="toUserMessage(error)"
      action-label="Retry"
      @action="retry"
    />
    <MessageList v-else :messages="messages" :loading="loading" :live-key="liveKey">
      <LiveAssistantMessage v-if="showLive" :state="state" @open-file="openFile" />
    </MessageList>
    <GenerationOutcomeBanner />
    <ExamplePrompts v-if="empty && !busy" @pick="draft = $event" />
    <PromptComposer
      v-model="draft"
      :busy="busy"
      :blocked-reason="blockedReason"
      :hl-connected="hlStatus === 'connected'"
      @submit="generation.start($event)"
    />
  </section>
</template>
