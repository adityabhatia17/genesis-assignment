<script setup lang="ts">
import { SendIcon } from '@lucide/vue';
import { useTextareaAutosize } from '@vueuse/core';
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LIMITS } from '@/contracts/limits';
import { cn } from '@/lib/utils';

const props = defineProps<{
  /** A generation is running (Send disabled). */
  busy: boolean;
  /** Why sending is blocked right now (offline, unsaved edits…), or null. */
  blockedReason: string | null;
  hlConnected: boolean;
}>();
const emit = defineEmits<{ submit: [prompt: string] }>();
const text = defineModel<string>({ default: '' });

const box = ref<HTMLElement | null>(null);
const element = computed(() => box.value?.querySelector('textarea') ?? null);
useTextareaAutosize({ element, input: text, maxHeight: 240 });

const length = computed(() => text.value.length);
const tooLong = computed(() => length.value > LIMITS.promptMaxChars);
const canSend = computed(
  () =>
    !props.busy && props.blockedReason === null && text.value.trim().length > 0 && !tooLong.value,
);
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function send(): void {
  if (!canSend.value) return;
  emit('submit', text.value.trim());
  text.value = '';
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    send();
  }
}
</script>

<template>
  <div class="border-t bg-background p-3">
    <p v-if="!props.hlConnected" class="mb-2 text-xs text-muted-foreground">
      You can generate now — connect HighLevel to see live data in the preview.
    </p>
    <div
      ref="box"
      class="rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring/40"
    >
      <label for="prompt" class="sr-only">Describe what to build or change</label>
      <Textarea
        id="prompt"
        v-model="text"
        rows="3"
        :disabled="props.busy"
        placeholder="Describe the app, or what to change…"
        class="max-h-60 min-h-18 resize-none border-0 shadow-none focus-visible:ring-0"
        :aria-invalid="tooLong"
        @keydown="onKeydown"
      />
      <div class="flex items-center gap-2 px-2 pb-2">
        <span
          :class="
            cn('text-xs tabular-nums', tooLong ? 'text-destructive' : 'text-muted-foreground')
          "
        >
          {{ length }}/{{ LIMITS.promptMaxChars }}
        </span>
        <span
          v-if="props.blockedReason"
          class="truncate text-xs text-muted-foreground"
          role="status"
        >
          {{ props.blockedReason }}
        </span>
        <span v-else class="hidden text-xs text-muted-foreground sm:inline">
          {{ isMac ? '⌘' : 'Ctrl' }}+Enter to send
        </span>
        <Button class="ml-auto" size="sm" :disabled="!canSend || props.busy" @click="send">
          <SendIcon />Send
        </Button>
      </div>
    </div>
  </div>
</template>
