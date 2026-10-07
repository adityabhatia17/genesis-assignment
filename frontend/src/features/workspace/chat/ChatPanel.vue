<script setup lang="ts">
import { useOnline } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
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
import VariantsChat from '@/features/variants/VariantsChat.vue';
import { useVariantsStore } from '@/features/variants/stores/variants.store';

const ws = useWorkspace();
const generation = useGenerationStore();
const variants = useVariantsStore();
const workspace = useWorkspaceStore();
const { state } = storeToRefs(generation);
const { confirmation } = storeToRefs(variants);
const { status: hlStatus } = useHighLevelConnection();
const online = useOnline();
const { data: messages, loading, error, retry } = useProjectMessages(ws.uid, ws.projectId);
const draft = ref('');
watch(
  () => workspace.seedPrompt,
  (seed) => {
    if (!seed) return;
    draft.value = seed;
    workspace.seedPrompt = null;
  },
  { immediate: true },
);

const persisted = computed(() =>
  messages.value.some((m) => m.role === 'assistant' && m.generationId === state.value.generationId),
);
const showLive = computed(() => state.value.status !== 'idle' && !persisted.value);
const showVariantsChat = computed(() => {
  if (state.value.mode !== 'variants') return false;
  return [
    'submitting',
    'streaming',
    'reconciling',
    'cancelling',
    'awaiting_selection',
    'failed',
    'cancelled',
    'interrupted',
  ].includes(state.value.status);
});
const busy = computed(() => isActive(state.value.status));
const liveKey = computed(
  () => `${state.value.prose.length}:${state.value.fileOrder.length}:${state.value.status}`,
);
const empty = computed(
  () => !loading.value && messages.value.length === 0 && ws.files.value.length === 0,
);

const blockedReason = computed(() => {
  if (!online.value) return "You're offline.";
  if (state.value.status === 'awaiting_selection') return 'Choose one of the options first.';
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
      <VariantsChat v-if="showVariantsChat" />
      <LiveAssistantMessage v-else-if="showLive" :state="state" @open-file="openFile" />
    </MessageList>
    <p v-if="confirmation" class="px-3 pb-2 text-sm" data-testid="variants-confirmation">
      You picked Option {{ confirmation.rank }}. Score {{ confirmation.total }}. This is now your
      app.
    </p>
    <GenerationOutcomeBanner />
    <ExamplePrompts
      v-if="empty && !busy && !showVariantsChat && !confirmation"
      @pick="draft = $event"
    />
    <PromptComposer
      v-model="draft"
      :busy="busy"
      :cancelling="state.status === 'cancelling'"
      :can-cancel="state.status === 'streaming' || state.status === 'reconciling'"
      :blocked-reason="blockedReason"
      :hl-connected="hlStatus === 'connected'"
      @submit="generation.start($event)"
      @cancel="generation.cancel()"
    />
  </section>
</template>
