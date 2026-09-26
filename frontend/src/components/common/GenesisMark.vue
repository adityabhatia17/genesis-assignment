<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 32 32"
    aria-hidden="true"
    :class="cn('size-8 shrink-0 text-foreground', props.class)"
  >
    <rect width="32" height="32" rx="8" fill="currentColor" />
    <path
      d="M21.5 11.5a7 7 0 1 0 1.2 7.5H16v-3h9.8"
      fill="none"
      stroke="currentColor"
      class="text-background"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
