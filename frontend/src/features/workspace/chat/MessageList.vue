<script setup lang="ts">
import { ArrowDownIcon } from '@lucide/vue';
import { useEventListener } from '@vueuse/core';
import { nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import type { ChatMessage } from '@/services/firestore/types';
import MessageItem from './MessageItem.vue';

const props = defineProps<{
  messages: ChatMessage[];
  loading: boolean;
  liveKey: string;
}>();

const root = ref<HTMLElement | null>(null);
const viewport = shallowRef<HTMLElement | null>(null);
const pinned = ref(true);

function scrollToBottom(): void {
  const el = viewport.value;
  if (el) el.scrollTop = el.scrollHeight;
}

onMounted(() => {
  viewport.value =
    root.value?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null;
  scrollToBottom();
});

useEventListener(viewport, 'scroll', () => {
  const el = viewport.value;
  if (el) pinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
});

// Stick to the bottom as messages and live text arrive, unless the user scrolled up to read.
watch(
  () => [props.messages.length, props.liveKey],
  async () => {
    if (!pinned.value) return;
    await nextTick();
    scrollToBottom();
  },
);
</script>

<template>
  <div ref="root" class="relative min-h-0 flex-1">
    <ScrollArea class="h-full">
      <div class="flex flex-col gap-4 p-4">
        <template v-if="props.loading">
          <Skeleton class="h-14 w-3/4 self-end" />
          <Skeleton class="h-20 w-5/6" />
        </template>
        <MessageItem v-for="message in props.messages" :key="message.id" :message="message" />
        <slot />
      </div>
    </ScrollArea>
    <Button
      v-if="!pinned"
      size="sm"
      variant="secondary"
      class="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-sm"
      @click="scrollToBottom"
    >
      <ArrowDownIcon />Jump to latest
    </Button>
  </div>
</template>
