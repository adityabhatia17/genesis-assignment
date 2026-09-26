<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/services/firestore/types';
import { describeMessageMeta } from './message-meta';

const props = defineProps<{ message: ChatMessage }>();
const meta = computed(() => describeMessageMeta(props.message.role, props.message.meta));
</script>

<template>
  <div
    v-if="props.message.role === 'system'"
    class="flex items-center gap-3 py-1 text-xs text-muted-foreground"
  >
    <span class="h-px flex-1 bg-border" aria-hidden="true" />
    <span
      >{{ props.message.content }}<template v-if="meta"> · {{ meta.text }}</template></span
    >
    <span class="h-px flex-1 bg-border" aria-hidden="true" />
  </div>
  <div v-else-if="props.message.role === 'user'" class="rounded-lg border bg-muted/40 px-3 py-2">
    <p class="mb-1 text-[11px] font-medium text-muted-foreground">You</p>
    <p class="text-sm whitespace-pre-wrap">{{ props.message.content }}</p>
  </div>
  <div v-else class="px-1">
    <p class="mb-1 text-[11px] font-medium text-muted-foreground">Genesis</p>
    <p class="text-sm whitespace-pre-wrap">{{ props.message.content }}</p>
    <p
      v-if="meta"
      :class="
        cn('mt-1.5 text-xs', {
          'text-muted-foreground': meta.tone === 'muted',
          'text-warning': meta.tone === 'warning',
          'text-destructive': meta.tone === 'error',
        })
      "
    >
      {{ meta.text }}
    </p>
  </div>
</template>
