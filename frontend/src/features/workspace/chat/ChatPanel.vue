<script setup lang="ts">
import { useOnline } from '@vueuse/core';
import { computed, nextTick, ref } from 'vue';
import { toast } from 'vue-sonner';
import { useHighLevelConnection } from '@/features/highlevel/useHighLevelConnection';
import { useProjectMessages } from '../composables/useProjectMessages';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useWorkspace } from '../workspace-context';
import ExamplePrompts from './ExamplePrompts.vue';
import MessageList from './MessageList.vue';
import PromptComposer from './PromptComposer.vue';

const ws = useWorkspace();
const workspace = useWorkspaceStore();
const { status: hlStatus } = useHighLevelConnection();
const online = useOnline();
const { data: messages, loading } = useProjectMessages(ws.uid, ws.projectId);
const draft = ref('');

const empty = computed(
  () => !loading.value && messages.value.length === 0 && ws.files.value.length === 0,
);

const blockedReason = computed(() => {
  if (!online.value) return "You're offline.";
  if (workspace.dirtyPaths.length > 0) return 'Save or discard unsaved changes first.';
  return null;
});

function onSubmit(prompt: string): void {
  void nextTick(() => {
    draft.value = prompt;
  });
  toast.message('Sending a prompt starts with the generation phase.');
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" aria-label="Chat">
    <MessageList :messages="messages" :loading="loading" live-key="idle"> </MessageList>
    <ExamplePrompts v-if="empty" @pick="draft = $event" />
    <PromptComposer
      v-model="draft"
      :busy="false"
      :blocked-reason="blockedReason"
      :hl-connected="hlStatus === 'connected'"
      @submit="onSubmit"
    />
  </section>
</template>
